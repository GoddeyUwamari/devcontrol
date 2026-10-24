/**
 * Organization-configured destinations (alert Slack, webhook, Jira and SMTP,
 * and the scheduled-report Slack webhook) are checked when they are used, not
 * only when saved, and are reached only at the addresses just checked.
 *
 *   - E: real sockets. A name that resolved to a public address at save time
 *     and to loopback at send time gets no connection (a local server counts
 *     them); the Jira client ignores proxy settings from the environment; a
 *     stored report webhook that now resolves privately is not posted to.
 *   - J: the Jira client. No redirects, no proxy, a checked agent, a checked
 *     base URL; a created issue yields only its validated key and a link built
 *     from the base URL; a failed request is reported by status code alone,
 *     and its body is never read.
 *   - N: the mail transport connects to the checked address, verifies the
 *     certificate against the configured host, requires TLS, and announces a
 *     fixed client name.
 *
 * Real routes over an in-process HTTP server against live Postgres, in a Pro
 * organization. DNS is stubbed for every name; the network guard fails any
 * connect that would leave the machine.
 */
import http from 'http';
import https from 'node:https';
import net from 'node:net';
import os from 'os';
import { inspect } from 'util';
import express from 'express';
import nodemailer from 'nodemailer';
import SMTPConnection from 'nodemailer/lib/smtp-connection';
import { Pool } from 'pg';
import alertConfigRoutes from '../alert-config.routes';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { JIRA_FAILURE_MESSAGES, JiraClient, JiraFailureReason, JiraRequestError } from '../../services/jira-client.service';
import { AlertNotificationService, buildSmtpTransportOptions } from '../../services/alert-notification.service';
import { ScheduledReportsService } from '../../services/scheduled-reports.service';
import { alertConfigs } from '../../controllers/alert-config.controller';
import { OutboundRefused, SMTP_CLIENT_NAME, safeLookup } from '../../utils/safe-outbound';
import { pool as appPool } from '../../config/database';
import {
  DnsAnswer,
  FakeAnswer,
  NetworkGuard,
  PUBLIC_V4,
  fakeHttpsRequest,
  guardNetwork,
  stubDns,
} from '../../__tests__/helpers/fake-outbound';

// Listeners issue their own fire-and-forget queries; irrelevant here.
jest.mock('../../services/onboardingEvents', () => ({ emitOnboardingEvent: jest.fn() }));

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

const SENT = `SENT-${uniqueSuffix()}`;
const JIRA_TOKEN = `jira-token-${SENT}`;
const JIRA_BASE = 'https://jira.example';

type Role = 'owner' | 'admin' | 'member' | 'viewer';

async function buildOrg(tier: 'pro' | 'enterprise' = 'pro') {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, $3, 'active') RETURNING id`,
    [`Outbound ${suffix}`, `outbound-${suffix}`, tier]
  );
  const orgId = rows[0].id as string;
  createdOrgIds.push(orgId);
  const users: Record<Role, string> = {} as Record<Role, string>;
  for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
    const user = await pool.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Outbound User') RETURNING id`,
      [`outbound-${role}-${uniqueSuffix()}@example.com`]
    );
    createdUserIds.push(user.rows[0].id);
    users[role] = user.rows[0].id;
    await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
       VALUES ($1, $2, $3, NOW(), true)`,
      [orgId, users[role], role]
    );
  }
  return { orgId, ...users };
}

type Org = Awaited<ReturnType<typeof buildOrg>>;

let server: http.Server;
let baseUrl: string;
let org: Org;
let dns: Record<string, DnsAnswer>;
let guard: NetworkGuard;
let logSpies: jest.SpyInstance[];

beforeAll(async () => {
  org = await buildOrg();
  const app = express();
  app.use(express.json());
  app.use('/api/alert-config', alertConfigRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

/** Every console method (own and anywhere up the prototype chain) plus both output streams. */
function captureLogs(): jest.SpyInstance[] {
  const names = new Set<string>();
  for (let level: object | null = console; level && level !== Object.prototype; level = Object.getPrototypeOf(level)) {
    for (const name of Object.getOwnPropertyNames(level)) names.add(name);
  }
  const spies: jest.SpyInstance[] = [];
  for (const name of names) {
    if (name === 'constructor' || typeof (console as any)[name] !== 'function') continue;
    spies.push(jest.spyOn(console as any, name).mockImplementation(() => {}));
  }
  for (const stream of [process.stdout, process.stderr]) {
    spies.push(jest.spyOn(stream, 'write').mockImplementation(() => true));
  }
  return spies;
}

function loggedText(): string {
  return logSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args: unknown[]) =>
      args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 8, showHidden: true }))).join(' ')
    )
    .join('\n');
}

beforeEach(() => {
  logSpies = captureLogs();
  guard = guardNetwork();
  dns = {
    'jira.example': [PUBLIC_V4],
    'smtp.example.com': [PUBLIC_V4],
    'hooks.slack.com': [PUBLIC_V4],
    'hooks.example': [PUBLIC_V4],
    'rebind.example': [PUBLIC_V4],
  };
  stubDns(dns);
  alertConfigs.delete(org.orgId);
});

afterEach(async () => {
  jest.restoreAllMocks();
  guard.restore();
  expect(guard.attempts).toEqual([]);
  const { rows } = await pool.query(`SELECT metadata::text AS m FROM audit_logs WHERE organization_id = ANY($1)`, [createdOrgIds]);
  for (const row of rows) expect(row.m ?? '').not.toContain(SENT);
});

afterAll(async () => {
  for (const id of createdOrgIds) alertConfigs.delete(id);
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM scheduled_reports WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
  await appPool.end();
});

async function sendAs(role: Role, method: string, route: string, body?: unknown, target: Org = org) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: target[role],
    email: 'outbound-caller@example.com',
    organizationId: target.orgId,
    role: 'owner',
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await response.text();
  return { status: response.status, text, body: text ? JSON.parse(text) : undefined };
}

const save = (body: unknown) => sendAs('admin', 'PUT', '/alert-config/config', body);
const testChannel = (type: string) => sendAs('admin', 'POST', '/alert-config/test', { type });
const genericFailure = (channel: string) => ({
  success: false,
  error: `Test alert to ${channel} failed. Check the channel settings and try again.`,
});

function jiraConfig(baseUrlValue = JIRA_BASE) {
  return {
    jira: { enabled: true, baseUrl: baseUrlValue, email: 'jira@example.com', apiToken: JIRA_TOKEN, projectKey: 'OPS', issueType: 'Task' },
  };
}

/** A TCP server on loopback that counts the connections it is offered and closes them. */
async function connectionCounter(): Promise<{ port: number; count: () => number; close: () => Promise<void> }> {
  let connections = 0;
  const counter = net.createServer((socket) => {
    connections += 1;
    socket.destroy();
  });
  await new Promise<void>((resolve) => counter.listen(0, '127.0.0.1', resolve));
  const address = counter.address();
  return {
    port: typeof address === 'object' && address ? address.port : 0,
    count: () => connections,
    close: () => new Promise<void>((resolve) => counter.close(() => resolve())),
  };
}

const TEST_ALERT = {
  severity: 'info' as const,
  title: 'Outbound test',
  message: 'Outbound test',
  source: 'test',
  timestamp: new Date('2026-01-01T00:00:00Z'),
};

describe('E: a destination is checked again when it is used (real sockets)', () => {
  it('E1: a webhook name that now resolves to loopback gets no connection', async () => {
    const counter = await connectionCounter();
    try {
      expect((await save({ webhook: { enabled: true, url: `https://rebind.example:${counter.port}/x` } })).status).toBe(200);
      dns['rebind.example'] = ['127.0.0.1'];

      const res = await testChannel('webhook');

      expect(res.status).toBe(502);
      expect(res.body).toEqual(genericFailure('webhook'));
      expect(counter.count()).toBe(0);
      const logged = loggedText();
      expect(logged).toContain('[SafeOutbound] refused');
      expect(logged).not.toContain('rebind.example');
      expect(logged).not.toContain('127.0.0.1');
    } finally {
      await counter.close();
    }
  });

  it('E2: a Jira name that now resolves to loopback gets no connection', async () => {
    const counter = await connectionCounter();
    try {
      expect((await save(jiraConfig(`https://rebind.example:${counter.port}`))).status).toBe(200);
      dns['rebind.example'] = ['127.0.0.1'];

      const res = await testChannel('jira');

      expect(res.status).toBe(502);
      expect(res.body).toEqual(genericFailure('jira'));
      expect(counter.count()).toBe(0);
      expect(loggedText()).not.toContain('rebind.example');
    } finally {
      await counter.close();
    }
  });

  it('E3: the Jira client connects directly, ignoring a proxy in the environment', async () => {
    const proxy = await connectionCounter();
    const saved = { HTTPS_PROXY: process.env.HTTPS_PROXY, https_proxy: process.env.https_proxy, NO_PROXY: process.env.NO_PROXY, no_proxy: process.env.no_proxy };
    process.env.HTTPS_PROXY = `http://127.0.0.1:${proxy.port}`;
    process.env.https_proxy = `http://127.0.0.1:${proxy.port}`;
    delete process.env.NO_PROXY;
    delete process.env.no_proxy;
    try {
      const client = new JiraClient(JIRA_BASE, 'jira@example.com', JIRA_TOKEN);

      await expect(client.testConnection()).rejects.toThrow('Jira request failed');

      expect(proxy.count()).toBe(0);
      // The direct connect to the checked public address was the only attempt, and the guard stopped it.
      expect(guard.attempts).toEqual([`jira.example=${PUBLIC_V4}:443`]);
      guard.attempts.length = 0;
    } finally {
      for (const [name, value] of Object.entries(saved)) {
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
      }
      await proxy.close();
    }
  });

  it('E4: an SMTP host that now resolves to loopback is not connected to', async () => {
    const transport = jest.spyOn(nodemailer, 'createTransport');
    expect(
      (await save({ email: { enabled: true, recipients: ['ops@example.com'], smtpHost: 'rebind.example', smtpPort: 587, smtpUser: 'u@example.com', smtpPass: `pw-${SENT}` } })).status
    ).toBe(200);
    dns['rebind.example'] = ['127.0.0.1'];

    const res = await testChannel('email');

    expect(res.status).toBe(502);
    expect(res.body).toEqual(genericFailure('email'));
    expect(transport).not.toHaveBeenCalled();
    const logged = loggedText();
    expect(logged).toContain('[SafeOutbound] refused');
    expect(logged).not.toContain('rebind.example');
  });

  it('E5: a stored report webhook that now resolves privately is not posted to; email still goes out', async () => {
    const enterprise = await buildOrg('enterprise');
    await pool.query(`UPDATE organizations SET settings = $2::jsonb WHERE id = $1`, [
      enterprise.orgId,
      JSON.stringify({ slack_webhook_url: 'https://hooks.slack.com/services/stored' }),
    ]);
    dns['hooks.slack.com'] = ['10.0.0.5'];
    // The real https.request: the refusal has to come from the lookup at connect time.
    const request = jest.spyOn(https, 'request');
    const service = new ScheduledReportsService(pool);
    jest.spyOn(service as any, 'generateReport').mockResolvedValue({ pdf: Buffer.from('pdf'), recordsProcessed: 0, fileSizeBytes: 3 });
    const email = jest.spyOn(service as any, 'deliverViaEmail').mockResolvedValue(undefined);
    const report = await service.create({
      organization_id: enterprise.orgId,
      name: `Outbound schedule ${uniqueSuffix()}`,
      report_type: 'cost_summary',
      schedule_type: 'daily',
      schedule_time: '09:00:00',
      timezone: 'UTC',
      delivery_email: true,
      delivery_slack: true,
      email_recipients: ['ops@example.com'],
      slack_channels: ['#reports'],
      format: 'pdf',
    });

    const result = await (service as any).deliverReport(report, { pdf: Buffer.from('pdf') });

    expect(result).toEqual({ emailSuccess: true, slackSuccess: false, error: 'Slack: Slack webhook destination not allowed' });
    expect(email).toHaveBeenCalledTimes(1);
    expect(request).toHaveBeenCalledTimes(1);
    // A connect to 10.0.0.5 would have been recorded by the network guard (checked after each test).
    expect(guard.attempts).toEqual([]);
    const logged = loggedText();
    expect(logged).toContain('[SafeOutbound] refused');
    expect(logged).not.toContain('hooks.slack.com');
    expect(logged).not.toContain('10.0.0.5');
  });
});

describe('J: the Jira client', () => {
  const client = () => new JiraClient(JIRA_BASE, 'jira@example.com', JIRA_TOKEN);
  const ISSUE = { projectKey: 'OPS', summary: 's', description: {}, issueType: 'Task', priority: 'High', labels: [] };

  it('J1: no redirects, no proxy, a checked agent, relative paths only, nothing buffered', () => {
    const defaults = (client() as any).axios.defaults;
    expect(defaults.maxRedirects).toBe(0);
    expect(defaults.proxy).toBe(false);
    expect(defaults.httpsAgent.options.lookup).toBe(safeLookup);
    expect(defaults.allowAbsoluteUrls).toBe(false);
    expect(defaults.responseType).toBe('stream');
    expect(defaults.adapter).toBe('http');
  });

  it('J2: a redirect is not followed', async () => {
    const outbound = fakeHttpsRequest({ status: 302, headers: { location: 'http://127.0.0.1/' } });

    await expect(client().testConnection()).rejects.toThrow(new JiraRequestError('failed'));

    expect(outbound.spy).toHaveBeenCalledTimes(1);
  });

  it.each(['http://x.example', 'https://10.0.0.1', 'https://intranet', 'https://user:pw@jira.example'])(
    'J3: base URL %s is refused when the client is built, and the channel reports a failed delivery',
    async (value) => {
      const outbound = fakeHttpsRequest({ status: 200 });
      expect(() => new JiraClient(value, 'jira@example.com', JIRA_TOKEN)).toThrow(OutboundRefused);

      const service = new AlertNotificationService({ jira: { ...jiraConfig(value).jira } }, { organizationId: org.orgId });

      expect(await service.sendAlert(TEST_ALERT)).toEqual([{ channel: 'jira', ok: false }]);
      expect(outbound.spy).not.toHaveBeenCalled();
    }
  );

  it('J4: a created issue yields only its validated key and a link built from the base URL', async () => {
    fakeHttpsRequest({
      status: 201,
      body: JSON.stringify({ id: '10001', key: 'OPS-123', self: 'https://evil.example/x', extra: SENT }),
    });

    const created = await client().createIssue(ISSUE);

    expect(created).toEqual({ key: 'OPS-123', url: 'https://jira.example/browse/OPS-123' });
    expect(Object.keys(created)).toEqual(['key', 'url']);
    expect(JSON.stringify(created)).not.toContain(SENT);
    expect(loggedText()).not.toContain(SENT);
  });

  it('J5: a 2xx body over 16 KB is refused and not read further', async () => {
    const chunks = Array.from({ length: 20 }, () => Buffer.alloc(1024, 'a'));
    const outbound = fakeHttpsRequest({ status: 201, body: chunks });

    await expect(client().createIssue(ISSUE)).rejects.toThrow(new JiraRequestError('failed'));

    const res = outbound.calls[0].res!;
    expect(res.destroyed).toBe(true);
    expect(res.chunksPulled).toBeLessThanOrEqual(17);
  });

  // J6 (as amended) and J8: a failed request is reported by status code alone, and its body is never read.
  const ISSUE_REJECTED = JIRA_FAILURE_MESSAGES.issue_rejected;
  const CREDENTIALS_REJECTED = JIRA_FAILURE_MESSAGES.credentials_rejected;
  const FAILED = JIRA_FAILURE_MESSAGES.failed;

  it.each([
    ['createIssue', 400, JSON.stringify({ errors: { summary: SENT } }), ISSUE_REJECTED],
    ['createIssue', 401, SENT, CREDENTIALS_REJECTED],
    ['createIssue', 403, SENT, CREDENTIALS_REJECTED],
    ['createIssue', 404, SENT, FAILED],
    ['createIssue', 500, SENT, FAILED],
    ['testConnection', 400, SENT, FAILED],
    ['testConnection', 401, SENT, CREDENTIALS_REJECTED],
    ['testConnection', 403, SENT, CREDENTIALS_REJECTED],
    ['testConnection', 404, SENT, FAILED],
    ['testConnection', 500, SENT, FAILED],
    ['validateProject', 400, SENT, FAILED],
    ['validateProject', 401, SENT, CREDENTIALS_REJECTED],
    ['validateProject', 403, SENT, CREDENTIALS_REJECTED],
    ['validateProject', 404, SENT, FAILED],
    ['validateProject', 500, SENT, FAILED],
  ] as const)('J6/J8: %s answered %i: fixed message, body never read', async (call, status, body, expected) => {
    const outbound = fakeHttpsRequest({ status, body });
    const jira = client();
    const run =
      call === 'createIssue' ? () => jira.createIssue(ISSUE) : call === 'testConnection' ? () => jira.testConnection() : () => jira.validateProject('OPS');

    let error: unknown;
    try {
      await run();
    } catch (caught) {
      error = caught;
    }

    expect(error).toBeInstanceOf(JiraRequestError);
    expect((error as Error).message).toBe(expected);
    expect(inspect(error, { showHidden: true, depth: 8 })).not.toContain(SENT);
    const res = outbound.calls[0].res!;
    expect({ pulled: res.pulled, data: res.dataListened, destroyed: res.destroyed }).toEqual({ pulled: false, data: false, destroyed: true });
    expect(loggedText()).not.toContain(SENT);
  });

  it('J7: a 2xx answer without a well-formed issue key is refused', async () => {
    for (const body of ['not json', '{}', '{"key":42}', '{"key":"ops-1"}', '{"key":"OPS-1\\nX"}', '{"key":"OPS-0"}', '[]', 'null']) {
      fakeHttpsRequest({ status: 201, body });
      await expect(client().createIssue(ISSUE)).rejects.toThrow(new JiraRequestError('failed'));
    }
  });

  it('a JiraRequestError can only carry one of the three fixed messages', async () => {
    const allowed = new Set(Object.values(JIRA_FAILURE_MESSAGES));
    expect(allowed.size).toBe(3);
    expect(Object.isFrozen(JIRA_FAILURE_MESSAGES)).toBe(true);
    for (const reason of ['issue_rejected', 'credentials_rejected', 'failed', 'bogus', '', 'toString', '__proto__'] as JiraFailureReason[]) {
      const error = new JiraRequestError(reason);
      expect(allowed.has(error.message)).toBe(true);
      expect(Object.keys(JIRA_FAILURE_MESSAGES)).toContain(error.reason);
    }
    // Whatever Jira answers, for any call.
    const outbound = fakeHttpsRequest({ status: 500, body: SENT });
    const jira = client();
    for (let status = 300; status <= 599; status += 1) {
      outbound.answer({ status, body: SENT });
      for (const run of [() => jira.createIssue(ISSUE), () => jira.testConnection(), () => jira.validateProject('OPS')]) {
        const error = await run().then(
          () => undefined,
          (caught) => caught
        );
        expect(error).toBeInstanceOf(JiraRequestError);
        expect(allowed.has(error.message)).toBe(true);
      }
    }
  });

  describe('POST /api/alert-config/test for Jira reports the mapped reason, and nothing else', () => {
    /** Answers the connection test with `myself` and issue creation with `issue`. */
    function jiraAnswers(myself: FakeAnswer, issue: FakeAnswer = { status: 201, body: '{"key":"OPS-1"}' }) {
      return fakeHttpsRequest((options: any) => (String(options.path).endsWith('/myself') ? myself : issue));
    }

    it.each([
      ['the connection test is answered 401', { status: 401, body: SENT }, undefined, CREDENTIALS_REJECTED],
      ['the connection test is answered 403', { status: 403, body: SENT }, undefined, CREDENTIALS_REJECTED],
      ['the connection test is answered 400', { status: 400, body: SENT }, undefined, null],
      ['the connection test is answered 500', { status: 500, body: SENT }, undefined, null],
      ['issue creation is answered 400', { status: 200, body: '{}' }, { status: 400, body: JSON.stringify({ errors: { project: SENT } }) }, ISSUE_REJECTED],
      ['issue creation is answered 401', { status: 200, body: '{}' }, { status: 401, body: SENT }, CREDENTIALS_REJECTED],
      ['issue creation is answered 404', { status: 200, body: '{}' }, { status: 404, body: SENT }, null],
      ['issue creation answers without a key', { status: 200, body: '{}' }, { status: 201, body: `{"self":"${SENT}"}` }, null],
      ['the connection fails', { error: new Error(`connect ECONNREFUSED ${PUBLIC_V4} ${SENT}`) }, undefined, null],
    ] as const)('%s', async (_label, myself, issue, message) => {
      expect((await save(jiraConfig())).status).toBe(200);
      const outbound = jiraAnswers(myself as FakeAnswer, issue as FakeAnswer | undefined);

      const res = await testChannel('jira');

      expect(res.status).toBe(502);
      expect(res.body).toEqual(message === null ? genericFailure('jira') : { success: false, error: message });
      expect(res.text).not.toContain(SENT);
      expect(loggedText()).not.toContain(SENT);
      for (const call of outbound.calls) {
        if (call.res && call.res.statusCode >= 300) expect(call.res.pulled).toBe(false);
      }
    });

    it('a successful test does not return the issue key or link', async () => {
      expect((await save(jiraConfig())).status).toBe(200);
      jiraAnswers({ status: 200, body: '{}' }, { status: 201, body: JSON.stringify({ key: 'OPS-77', self: SENT }) });

      const res = await testChannel('jira');

      expect(res.status).toBe(200);
      expect(res.body).toEqual({ success: true, message: 'Test alert sent successfully to jira' });
      expect(res.text).not.toContain('OPS-77');
    });
  });
});

describe('N: the mail transport', () => {
  function emailConfig(port: number) {
    return {
      email: { enabled: true, recipients: ['ops@example.com'], smtpHost: 'smtp.example.com', smtpPort: port, smtpUser: 'u@example.com', smtpPass: `pw-${SENT}` },
    };
  }

  it.each([25, 465, 587, 2525])('N1: on port %i it connects to the checked address, with TLS verified against the host', async (port) => {
    const options: any[] = [];
    const sendMail = jest.fn().mockResolvedValue({ messageId: 'stub' });
    const close = jest.fn();
    jest.spyOn(nodemailer, 'createTransport').mockImplementation(((value: any) => {
      options.push(value);
      return { sendMail, close } as any;
    }) as any);

    const results = await new AlertNotificationService(emailConfig(port)).sendAlert(TEST_ALERT);

    expect(results).toEqual([{ channel: 'email', ok: true }]);
    expect(options).toHaveLength(1);
    const used = options[0];
    expect(used.host).toBe(PUBLIC_V4);
    expect(used.port).toBe(port);
    expect(used.servername).toBe('smtp.example.com');
    expect(used.tls).toEqual({ servername: 'smtp.example.com', rejectUnauthorized: true, minVersion: 'TLSv1.2' });
    expect(used.secure).toBe(port === 465);
    expect(used.requireTLS).toBe(port !== 465);
    expect(used.ignoreTLS).toBe(false);
    expect(used).toMatchObject({ connectionTimeout: 10_000, greetingTimeout: 10_000, socketTimeout: 15_000, dnsTimeout: 5_000 });
    expect(used.name).toBe(SMTP_CLIENT_NAME);
    expect(used).not.toHaveProperty('proxy');
    expect(used).not.toHaveProperty('getSocket');
    expect(used).not.toHaveProperty('pool');
    expect(close).toHaveBeenCalledTimes(1);
  });

  it('N2: the mail server sees the fixed client name and the certificate name, never this host', async () => {
    const received: string[] = [];
    const smtpServer = net.createServer((socket) => {
      socket.write('220 test\r\n');
      socket.on('data', (data) => {
        received.push(data.toString('utf8'));
        socket.end();
      });
    });
    await new Promise<void>((resolve) => smtpServer.listen(0, '127.0.0.1', resolve));
    const address = smtpServer.address();
    const port = typeof address === 'object' && address ? address.port : 0;
    const seen: Array<{ servername: unknown; name: unknown }> = [];
    const realConnect = SMTPConnection.prototype.connect;
    jest.spyOn(SMTPConnection.prototype, 'connect').mockImplementation(function (this: any, ...args: any[]) {
      seen.push({ servername: this.servername, name: this.name });
      return (realConnect as any).apply(this, args);
    });
    try {
      const options = {
        ...buildSmtpTransportOptions({ address: PUBLIC_V4, servername: 'smtp.example.com', port: 587, secure: false }),
        host: '127.0.0.1',
        port,
        requireTLS: false,
      };
      const transport = nodemailer.createTransport(options);

      await transport.verify().catch(() => undefined);
      transport.close();

      expect(received.length).toBeGreaterThan(0);
      expect(received[0].split('\r\n')[0]).toBe(`EHLO ${SMTP_CLIENT_NAME}`);
      const everything = received.join('');
      expect(everything).not.toContain(os.hostname());
      for (const entries of Object.values(os.networkInterfaces())) {
        for (const entry of entries ?? []) expect(everything).not.toContain(entry.address);
      }
      expect(seen).toEqual([{ servername: 'smtp.example.com', name: SMTP_CLIENT_NAME }]);
    } finally {
      await new Promise<void>((resolve) => smtpServer.close(() => resolve()));
    }
  });
});
