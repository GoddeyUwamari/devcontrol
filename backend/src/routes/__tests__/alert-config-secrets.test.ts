/**
 * Alert configuration credentials are write-only.
 *
 *   - GET returns every non-credential field, and for each credential only
 *     whether one is saved, to every role (owner and admin included).
 *   - PUT merges into the saved configuration: a blank or omitted credential
 *     keeps the saved one, a new value replaces it, clearSecrets removes it
 *     (a new value sent with it wins), and channels the body leaves out are
 *     kept. Validation runs on the merged result; a rejected save changes
 *     nothing. The answer never carries the configuration.
 *   - POST /test sends only to the channel under test and reports whether it
 *     was delivered, with a fixed message. A non-2xx answer is a failure, and
 *     its body is not read. Neither the answer nor any log line carries a
 *     credential or the underlying error.
 *
 * Real routes over an in-process HTTP server against live Postgres, in a Pro
 * organization. Stubbed: authService.verifyToken (to choose the caller) and
 * every outbound channel (DNS and https.request via the fake-outbound helper,
 * nodemailer, the Jira client). The network guard fails any connect that
 * would leave the machine.
 */
import http from 'http';
import { inspect } from 'util';
import express from 'express';
import nodemailer from 'nodemailer';
import { Pool } from 'pg';
import alertConfigRoutes from '../alert-config.routes';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { JiraClient } from '../../services/jira-client.service';
import { alertConfigs } from '../../controllers/alert-config.controller';
import { pool as appPool } from '../../config/database';
import { FakeAnswer, NetworkGuard, PUBLIC_V4, fakeHttpsRequest, guardNetwork, stubDns } from '../../__tests__/helpers/fake-outbound';

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

const run = uniqueSuffix();
const S_SMTP = `smtp-pass-SENT-${run}`;
const S_SLACK = `https://hooks.slack.com/services/SENT-${run}`;
const S_HOOK = `https://hooks.example/SENT-${run}`;
const S_HDR = `hdr-SENT-${run}`;
const S_HDR2 = `hdr2-SENT-${run}`;
const S_JIRA = `jira-token-SENT-${run}`;
const SENTINELS = [S_SMTP, S_SLACK, S_HOOK, S_HDR, S_HDR2, S_JIRA];

const ALERT_TYPES = [{ id: 'cost_threshold', name: 'Cost', description: 'Cost alerts', enabled: true, severities: ['critical'] }];

function fullConfig() {
  return {
    email: {
      enabled: true,
      recipients: ['ops@example.com'],
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'alerts@example.com',
      smtpPass: S_SMTP,
    },
    slack: { enabled: true, webhookUrl: S_SLACK, channel: '#alerts' },
    webhook: { enabled: true, url: S_HOOK, headers: { 'X-Auth': S_HDR } },
    jira: {
      enabled: true,
      baseUrl: 'https://example.atlassian.net',
      email: 'jira@example.com',
      apiToken: S_JIRA,
      projectKey: 'OPS',
      issueType: 'Task',
    },
    alertTypes: ALERT_TYPES,
  };
}

/** fullConfig with every credential blank: what the page sends back untouched. */
function blankConfig() {
  const config = fullConfig();
  config.email.smtpPass = '';
  config.slack.webhookUrl = '';
  config.webhook.url = '';
  config.webhook.headers = { 'X-Auth': '' };
  config.jira.apiToken = '';
  return config;
}

async function buildOrg() {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'pro', 'active') RETURNING id`,
    [`Alert Secrets ${suffix}`, `alert-secrets-${suffix}`]
  );
  const orgId = rows[0].id as string;
  createdOrgIds.push(orgId);
  const users: Record<Role, string> = {} as Record<Role, string>;
  for (const role of ['owner', 'admin', 'member', 'viewer'] as const) {
    const user = await pool.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Alert Secrets User') RETURNING id`,
      [`alert-secrets-${role}-${uniqueSuffix()}@example.com`]
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

type Role = 'owner' | 'admin' | 'member' | 'viewer';
type Org = Awaited<ReturnType<typeof buildOrg>>;

let server: http.Server;
let baseUrl: string;
let org: Org;

interface OutboundCall {
  url: string;
  headers: Record<string, string>;
}
let outbound: OutboundCall[];
let outboundAnswer: FakeAnswer;
let outboundFake: ReturnType<typeof fakeHttpsRequest>;
let guard: NetworkGuard;
let transportOptions: any[];
let sendMail: jest.Mock;
let jiraTokens: string[];
let testConnection: jest.SpyInstance;
let logSpies: jest.SpyInstance[];

beforeAll(async () => {
  org = await buildOrg();
  const app = express();
  app.use(express.json());
  app.use('/api/alert-config', alertConfigRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
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

function loggedLines(): string[] {
  return logSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args: unknown[]) =>
      args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 8, showHidden: true }))).join(' ')
    );
}

beforeEach(() => {
  logSpies = captureLogs();
  guard = guardNetwork();
  stubDns({
    'hooks.slack.com': [PUBLIC_V4],
    'hooks.example': [PUBLIC_V4],
    'smtp.example.com': [PUBLIC_V4],
    'example.atlassian.net': [PUBLIC_V4],
  });
  outbound = [];
  outboundAnswer = { status: 200, body: 'ok' };
  outboundFake = fakeHttpsRequest((options: any) => {
    outbound.push({ url: `https://${options.hostname}${options.path}`, headers: { ...(options.headers ?? {}) } });
    return outboundAnswer;
  });
  transportOptions = [];
  sendMail = jest.fn().mockResolvedValue({ messageId: 'stub' });
  jest.spyOn(nodemailer, 'createTransport').mockImplementation(((options: any) => {
    transportOptions.push(options);
    return { sendMail, close: jest.fn() } as any;
  }) as any);
  jiraTokens = [];
  testConnection = jest.spyOn(JiraClient.prototype, 'testConnection').mockImplementation(async function (this: any) {
    jiraTokens.push(this.apiToken);
    return true;
  });
  jest.spyOn(JiraClient.prototype, 'createIssue').mockResolvedValue({ key: 'OPS-1', url: 'https://example.atlassian.net/browse/OPS-1' });
  alertConfigs.delete(org.orgId);
});

afterEach(async () => {
  jest.restoreAllMocks();
  guard.restore();
  expect(guard.attempts).toEqual([]);
  // No credential reaches the audit trail either.
  const { rows } = await pool.query(
    `SELECT metadata::text AS m FROM audit_logs WHERE organization_id = $1`,
    [org.orgId]
  );
  for (const row of rows) for (const s of SENTINELS) expect(row.m ?? '').not.toContain(s);
});

afterAll(async () => {
  for (const id of createdOrgIds) alertConfigs.delete(id);
  await new Promise<void>((resolve) => server.close(() => resolve()));
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

async function sendAs(role: Role, method: string, route: string, body?: unknown) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: org[role],
    email: 'alert-secrets-caller@example.com',
    organizationId: org.orgId,
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

/** A save; an accepted one answers with a fixed message and never the configuration. */
async function save(body: unknown, role: Role = 'admin') {
  const res = await sendAs(role, 'PUT', '/alert-config/config', body);
  if (res.status === 200) expect(res.body).toEqual({ success: true, message: 'Alert configuration updated' });
  expectNoSentinel(res.text);
  return res;
}
const read = (role: Role = 'admin') => sendAs(role, 'GET', '/alert-config/config');
const test = (type: string, role: Role = 'admin') => sendAs(role, 'POST', '/alert-config/test', { type });

function expectNoSentinel(text: string): void {
  for (const s of SENTINELS) expect(text).not.toContain(s);
}

/** What each channel actually used when sent to, one test per channel. */
async function credentialsUsed() {
  outbound = [];
  transportOptions = [];
  jiraTokens = [];
  expect((await test('slack')).status).toBe(200);
  const slackUrl = outbound.map((call) => call.url);
  outbound = [];
  expect((await test('webhook')).status).toBe(200);
  const webhook = outbound.map((call) => ({ url: call.url, auth: call.headers['X-Auth'] }));
  expect((await test('email')).status).toBe(200);
  const smtpPass = transportOptions.map((options) => options.auth?.pass);
  expect((await test('jira')).status).toBe(200);
  return { slackUrl, webhook, smtpPass, jiraTokens: [...jiraTokens] };
}

const ORIGINAL = {
  slackUrl: [S_SLACK],
  webhook: [{ url: S_HOOK, auth: S_HDR }],
  smtpPass: [S_SMTP],
  jiraTokens: [S_JIRA],
};

describe('GET /api/alert-config/config -- credentials are never returned', () => {
  it.each(['owner', 'admin', 'member', 'viewer'] as const)('a %s sees every setting except the credentials', async (role) => {
    expect((await save(fullConfig())).status).toBe(200);

    const res = await read(role);

    expect(res.status).toBe(200);
    expectNoSentinel(res.text);
    const data = res.body.data;
    expect(data.email).toEqual({
      enabled: true,
      recipients: ['ops@example.com'],
      smtpHost: 'smtp.example.com',
      smtpPort: 587,
      smtpUser: 'alerts@example.com',
      smtpPass: '',
      smtpPassSet: true,
    });
    expect(data.slack).toEqual({ enabled: true, webhookUrl: '', webhookUrlSet: true, channel: '#alerts' });
    expect(data.webhook).toEqual({ enabled: true, url: '', urlSet: true, headers: { 'X-Auth': '' }, headersSet: ['X-Auth'] });
    expect(data.jira).toEqual({
      enabled: true,
      baseUrl: 'https://example.atlassian.net',
      email: 'jira@example.com',
      apiToken: '',
      apiTokenSet: true,
      projectKey: 'OPS',
      issueType: 'Task',
    });
    expect(data.alertTypes).toEqual(ALERT_TYPES);
    expectNoSentinel(loggedLines().join('\n'));
  });

  it('with nothing saved, every credential is reported as not set', async () => {
    const res = await read('viewer');

    expect(res.status).toBe(200);
    expect(res.body.data.email.smtpPassSet).toBe(false);
    expect(res.body.data.slack.webhookUrlSet).toBe(false);
    expect(res.body.data.webhook.urlSet).toBe(false);
    expect(res.body.data.webhook.headersSet).toEqual([]);
    expect(res.body.data.jira.apiTokenSet).toBe(false);
  });
});

describe('PUT /api/alert-config/config -- merge on save', () => {
  it('blank credentials keep the saved ones, and each channel still sends with them', async () => {
    expect((await save(fullConfig())).status).toBe(200);

    const res = await save(blankConfig());

    expect(res.status).toBe(200);
    expect(await credentialsUsed()).toEqual(ORIGINAL);
  });

  it('omitted credentials keep the saved ones', async () => {
    expect((await save(fullConfig())).status).toBe(200);
    const omitted: any = blankConfig();
    delete omitted.email.smtpPass;
    delete omitted.slack.webhookUrl;
    delete omitted.webhook.url;
    delete omitted.webhook.headers;
    delete omitted.jira.apiToken;

    expect((await save(omitted)).status).toBe(200);

    expect(await credentialsUsed()).toEqual(ORIGINAL);
  });

  it('a new value replaces the saved one', async () => {
    expect((await save(fullConfig())).status).toBe(200);
    const next = blankConfig();
    next.slack.webhookUrl = `${S_SLACK}-new`;
    next.jira.apiToken = `${S_JIRA}-new`;

    expect((await save(next)).status).toBe(200);

    const used = await credentialsUsed();
    expect(used.slackUrl).toEqual([`${S_SLACK}-new`]);
    expect(used.jiraTokens).toEqual([`${S_JIRA}-new`]);
    expect(used.smtpPass).toEqual([S_SMTP]);
  });

  it('clearSecrets removes saved credentials; an unknown path is refused and changes nothing', async () => {
    expect((await save(fullConfig())).status).toBe(200);

    const refused = await save({ clearSecrets: ['slack.channel'] });
    expect(refused.status).toBe(400);
    expect((await read()).body.data.slack.webhookUrlSet).toBe(true);

    const cleared = await save({ clearSecrets: ['slack.webhookUrl', 'webhook.headers.X-Auth'] });
    expect(cleared.status).toBe(200);

    const data = (await read()).body.data;
    expect(data.slack.webhookUrlSet).toBe(false);
    expect(data.webhook.headersSet).toEqual([]);
    expect(data.webhook.headers).toEqual({});
    expect(data.webhook.urlSet).toBe(true);
    const slack = await test('slack');
    expect(slack.status).toBe(400);
    expect(slack.body).toEqual({ success: false, error: 'slack is not enabled' });
    expect(outbound).toHaveLength(0);
  });

  it.each([
    ['clearSecrets first', (values: Record<string, any>, clearSecrets: string[]) => ({ clearSecrets, ...values })],
    ['clearSecrets last', (values: Record<string, any>, clearSecrets: string[]) => ({ ...values, clearSecrets })],
  ])('a new value sent with a clear of the same credential is saved (%s)', async (_order, body) => {
    expect((await save(fullConfig())).status).toBe(200);
    const values = {
      slack: { webhookUrl: `${S_SLACK}-new` },
      webhook: { headers: { 'X-Auth': `${S_HDR}-new` } },
    };

    expect((await save(body(values, ['slack.webhookUrl', 'webhook.headers.X-Auth']))).status).toBe(200);

    const data = (await read()).body.data;
    expect(data.slack.webhookUrlSet).toBe(true);
    expect(data.webhook.headersSet).toEqual(['X-Auth']);
    const used = await credentialsUsed();
    expect(used.slackUrl).toEqual([`${S_SLACK}-new`]);
    expect(used.webhook).toEqual([{ url: S_HOOK, auth: `${S_HDR}-new` }]);
  });

  it('clearing one webhook header keeps the others', async () => {
    const config = fullConfig();
    config.webhook.headers = { 'X-Auth': S_HDR, 'X-Other': S_HDR2 } as any;
    expect((await save(config)).status).toBe(200);

    expect((await save({ clearSecrets: ['webhook.headers.X-Auth'] })).status).toBe(200);

    const data = (await read()).body.data;
    expect(data.webhook.headersSet).toEqual(['X-Other']);
    expect(data.webhook.headers).toEqual({ 'X-Other': '' });
    expect((await test('webhook')).status).toBe(200);
    expect(outbound).toHaveLength(1);
    expect(outbound[0].headers['X-Other']).toBe(S_HDR2);
    expect(outbound[0].headers).not.toHaveProperty('X-Auth');
  });

  it('a Jira token that is too short is refused without echoing it', async () => {
    const config = fullConfig();
    config.jira.apiToken = 'short-SENT-token';

    const res = await save(config);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Valid API token required' });
    expect(res.text).not.toContain('short-SENT-token');
  });

  it('a body with only alert types keeps every channel', async () => {
    expect((await save(fullConfig())).status).toBe(200);
    const types = [{ ...ALERT_TYPES[0], enabled: false }];

    expect((await save({ alertTypes: types })).status).toBe(200);

    expect((await read()).body.data.alertTypes).toEqual(types);
    expect(await credentialsUsed()).toEqual(ORIGINAL);
  });

  it('an invalid merged configuration is refused and the saved one is unchanged', async () => {
    expect((await save(fullConfig())).status).toBe(200);
    const invalid = blankConfig();
    invalid.jira.baseUrl = 'http://example.atlassian.net';
    invalid.slack.webhookUrl = `${S_SLACK}-unsaved`;

    const res = await save(invalid);

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'Jira URL must be a public https:// address.' });
    expect((await read()).body.data.jira.baseUrl).toBe('https://example.atlassian.net');
    expect(await credentialsUsed()).toEqual(ORIGINAL);
  });

  it.each(['member', 'viewer'] as const)('a %s cannot save or test, and the saved configuration is unchanged', async (role) => {
    expect((await save(fullConfig())).status).toBe(200);

    expect((await save({ slack: { webhookUrl: `${S_SLACK}-x` } }, role)).status).toBe(403);
    expect((await test('slack', role)).status).toBe(403);

    expect(outbound).toHaveLength(0);
    expect(await credentialsUsed()).toEqual(ORIGINAL);
  });
});

describe('POST /api/alert-config/test -- real outcome, fixed message', () => {
  const failed = (channel: string) => ({
    success: false,
    error: `Test alert to ${channel} failed. Check the channel settings and try again.`,
  });

  it('succeeds only for the channel under test', async () => {
    expect((await save(fullConfig())).status).toBe(200);

    const res = await test('slack');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({ success: true, message: 'Test alert sent successfully to slack' });
    expect(outbound.map((call) => call.url)).toEqual([S_SLACK]);
    expect(sendMail).not.toHaveBeenCalled();
  });

  /** A non-2xx answer whose body would carry a sentinel if anything read it. */
  let expectUnread: boolean;
  function unreadAnswer(status: number): FakeAnswer {
    expectUnread = true;
    return { status, body: `body ${S_HOOK}` };
  }

  beforeEach(() => {
    expectUnread = false;
  });

  it.each([
    ['slack 500', 'slack', () => { outboundAnswer = unreadAnswer(500); }],
    ['webhook 500', 'webhook', () => { outboundAnswer = unreadAnswer(500); }],
    ['webhook unreachable', 'webhook', () => { outboundAnswer = { error: new Error(`connect failed ${S_HOOK} ${S_HDR}`) }; }],
    ['email', 'email', () => { sendMail.mockRejectedValue(new Error(`535 auth failed ${S_SMTP}`)); }],
    ['jira', 'jira', () => { testConnection.mockRejectedValue(new Error(`timeout ${S_JIRA}`)); }],
  ])('a %s failure answers 502 with a fixed message and logs only the org and channel', async (_label, channel, fail) => {
    expect((await save(fullConfig())).status).toBe(200);
    fail();
    for (const spy of logSpies) spy.mockClear();

    const res = await test(channel);

    if (expectUnread) {
      const answered = outboundFake.calls[outboundFake.calls.length - 1].res!;
      expect({ pulled: answered.pulled, destroyed: answered.destroyed }).toEqual({ pulled: false, destroyed: true });
    }
    expect(res.status).toBe(502);
    expect(res.body).toEqual(failed(channel));
    expectNoSentinel(res.text);
    expect(res.text).not.toMatch(/timeout|535|connect failed|returned/);
    const lines = loggedLines();
    expectNoSentinel(lines.join('\n'));
    expect(lines.join('\n')).not.toContain('hooks.');
    const failures = lines.filter((line) => line.includes('[AlertConfig] test failed'));
    expect(failures).toHaveLength(1);
    expect(failures[0]).toContain(org.orgId);
    expect(failures[0]).toContain(channel);
  });

  it('a channel that is not enabled is refused without sending', async () => {
    const config = fullConfig();
    config.webhook.enabled = false;
    expect((await save(config)).status).toBe(200);

    const res = await test('webhook');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({ success: false, error: 'webhook is not enabled' });
    expect(outbound).toHaveLength(0);
  });
});
