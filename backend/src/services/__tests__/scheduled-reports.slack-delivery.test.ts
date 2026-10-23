/**
 * Scheduled-report Slack delivery goes only to the organization's own
 * webhook (organizations.settings.slack_webhook_url). Without one nothing is
 * posted anywhere, one line naming the organization is logged, and the run
 * records the delivery as not made: failed, or partial when email went out.
 * Every line a skipped run writes is checked: none carries the organization's
 * settings, a webhook URL, the channel or the report name. The one exception
 * is the run's existing "Executing report: <name> (<id>)" line, pinned exactly.
 *
 * Real DB; fetch, email and report generation are stubbed.
 */
import http from 'http';
import { inspect } from 'util';
import express from 'express';
import { Pool } from 'pg';
import { ScheduledReportsService } from '../scheduled-reports.service';
import { ScheduledReport } from '../../repositories/scheduled-reports.repository';
import scheduledReportsRoutes from '../../routes/scheduled-reports.routes';
import { authService } from '../auth.service';
import { pool as appPool } from '../../config/database';

// Listeners issue their own fire-and-forget queries; irrelevant here.
jest.mock('../onboardingEvents', () => ({ emitOnboardingEvent: jest.fn() }));

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
const service = new ScheduledReportsService(pool);
const createdOrgIds: string[] = [];

const PLATFORM_WEBHOOK = 'https://hooks.example.test/platform-sentinel';
const NOT_CONFIGURED = 'Slack: no Slack webhook configured for this organization';
const savedEnv = process.env.SLACK_WEBHOOK_URL;
const savedOtherEnv = process.env.REPORTS_SLACK_WEBHOOK;

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(settings: Record<string, unknown> | null): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status, settings)
     VALUES ($1, $2, $1, 'enterprise', 'active', COALESCE($3::jsonb, '{}'::jsonb))
     RETURNING id`,
    [`Slack Org ${suffix}`, `slack-org-${suffix}`, settings === null ? null : JSON.stringify(settings)]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertSchedule(orgId: string, opts: { email: boolean }): Promise<ScheduledReport> {
  const suffix = uniqueSuffix();
  return service.create({
    organization_id: orgId,
    name: `Slack schedule ${suffix}`,
    report_type: 'cost_summary',
    schedule_type: 'daily',
    schedule_time: '09:00:00',
    timezone: 'UTC',
    delivery_email: opts.email,
    delivery_slack: true,
    email_recipients: opts.email ? ['ops@example.com'] : [],
    slack_channels: [`#reports-${suffix}`],
    format: 'pdf',
  });
}

let fetchSpy: jest.SpyInstance;
let logSpies: jest.SpyInstance[];
let otherEnvWebhook: string;

beforeEach(() => {
  process.env.SLACK_WEBHOOK_URL = PLATFORM_WEBHOOK;
  otherEnvWebhook = `https://hooks.example.test/env-sentinel-${uniqueSuffix()}`;
  process.env.REPORTS_SLACK_WEBHOOK = otherEnvWebhook;
  fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
  logSpies = [
    ...(['log', 'info', 'warn', 'error', 'debug', 'trace'] as const).map((m) =>
      jest.spyOn(console, m).mockImplementation(() => {})
    ),
    ...[process.stdout, process.stderr].map((stream) => jest.spyOn(stream, 'write').mockImplementation(() => true)),
  ];
  jest.spyOn(service as any, 'generateReport').mockResolvedValue({
    pdf: Buffer.from('pdf'),
    recordsProcessed: 0,
    fileSizeBytes: 3,
  });
});

afterEach(() => {
  jest.restoreAllMocks();
  if (savedEnv === undefined) delete process.env.SLACK_WEBHOOK_URL;
  else process.env.SLACK_WEBHOOK_URL = savedEnv;
  if (savedOtherEnv === undefined) delete process.env.REPORTS_SLACK_WEBHOOK;
  else process.env.REPORTS_SLACK_WEBHOOK = savedOtherEnv;
});

const createdUserIds: string[] = [];

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM scheduled_reports WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query(
      'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
      [createdOrgIds, createdUserIds]
    );
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
  await appPool.end();
});

function deliver(report: ScheduledReport) {
  return (service as any).deliverReport(report, { pdf: Buffer.from('pdf') }) as Promise<{
    emailSuccess: boolean;
    slackSuccess: boolean;
    error?: string;
  }>;
}

/** One entry per console call or stream write, every argument rendered in full. */
function allLines(): string[] {
  return logSpies
    .flatMap((spy) => spy.mock.calls)
    .map((args: unknown[]) =>
      args.map((arg) => (typeof arg === 'string' ? arg : inspect(arg, { depth: 8, showHidden: true }))).join(' ')
    );
}

function slackSkipLines(): string[] {
  return allLines().filter((line) => line.includes('Slack delivery skipped'));
}

/** Forget what setup logged; only the run under test is checked. */
function clearLogs(): void {
  for (const spy of logSpies) spy.mockClear();
}

/**
 * Settings that hold a URL under a key delivery doesn't read, so the run
 * still skips; none of it may reach a log line.
 */
function decoySettings() {
  const marker = `settings-sentinel-${uniqueSuffix()}`;
  return { marker, settings: { slack_webhook: `https://hooks.example.test/${marker}`, notes: marker } };
}

function skipLine(orgId: string): string {
  return `[ScheduledReports] Slack delivery skipped: no Slack webhook configured for organization ${orgId}`;
}

/** Nothing about the schedule, the settings or any webhook appears in `lines`. */
function expectNothingSensitive(lines: string[], report: ScheduledReport, marker: string): void {
  const output = lines.join('\n');
  for (const value of [report.name, marker, PLATFORM_WEBHOOK, otherEnvWebhook, ...report.slack_channels]) {
    expect(output).not.toContain(value);
  }
}

/**
 * A full run's lines with its existing "Executing report" line removed. That
 * line is pinned exactly, so it carries nothing beyond the name and id.
 */
function runLinesWithoutStartLine(report: ScheduledReport): string[] {
  const start = `[ScheduledReports] Executing report: ${report.name} (${report.id})`;
  const lines = allLines();
  expect(lines.filter((line) => line.includes(report.name))).toEqual([start]);
  return lines.filter((line) => line !== start);
}

describe('scheduled reports -- Slack delivery uses only the organization webhook', () => {
  it('no organization webhook: nothing is posted, one line names the org, the delivery is recorded as not made', async () => {
    const { marker, settings } = decoySettings();
    const orgId = await insertOrg(settings);
    const report = await insertSchedule(orgId, { email: false });
    clearLogs();

    const result = await deliver(report);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ emailSuccess: false, slackSuccess: false, error: NOT_CONFIGURED });
    // The skip line is the only thing written, and it names only the org.
    expect(allLines()).toEqual([skipLine(orgId)]);
    expect(allLines()[0]).not.toContain(report.id);
    expectNothingSensitive(allLines(), report, marker);
  });

  it('the organization webhook is the only URL posted to', async () => {
    const own = 'https://hooks.example.test/org-own';
    const orgId = await insertOrg({ slack_webhook_url: own });
    const report = await insertSchedule(orgId, { email: false });

    const result = await deliver(report);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy.mock.calls[0][0]).toBe(own);
    expect(result).toEqual({ emailSuccess: false, slackSuccess: true, error: undefined });
    expect(slackSkipLines()).toHaveLength(0);
  });

  it.each([
    ['empty', ''],
    ['whitespace', '   '],
    ['not a string', 42],
  ])('a %s organization value counts as not configured', async (_label, value) => {
    const { marker, settings } = decoySettings();
    const orgId = await insertOrg({ ...settings, slack_webhook_url: value });
    const report = await insertSchedule(orgId, { email: false });
    clearLogs();

    const result = await deliver(report);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.slackSuccess).toBe(false);
    expect(result.error).toBe(NOT_CONFIGURED);
    expect(allLines()).toEqual([skipLine(orgId)]);
    expectNothingSensitive(allLines(), report, marker);
  });

  it("another organization's webhook is never used", async () => {
    const otherOwn = 'https://hooks.example.test/other-org';
    await insertOrg({ slack_webhook_url: otherOwn });
    const orgId = await insertOrg(null);
    const report = await insertSchedule(orgId, { email: false });

    await deliver(report);

    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('email still goes out and the delivery result is partial', async () => {
    const orgId = await insertOrg(null);
    const report = await insertSchedule(orgId, { email: true });
    const emailSpy = jest.spyOn(service as any, 'deliverViaEmail').mockResolvedValue(undefined);

    const result = await deliver(report);

    expect(emailSpy).toHaveBeenCalledTimes(1);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ emailSuccess: true, slackSuccess: false, error: NOT_CONFIGURED });
    expect((service as any).determineExecutionStatus(result)).toBe('partial');
  });

  it('a manual test run records the run as failed with the reason, and posts nothing', async () => {
    const { marker, settings } = decoySettings();
    const orgId = await insertOrg(settings);
    const report = await insertSchedule(orgId, { email: false });
    clearLogs();

    await service.test(report.id, orgId);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(slackSkipLines()).toEqual([skipLine(orgId)]);
    const lines = runLinesWithoutStartLine(report);
    // Grouped by console method, not in time order.
    expect(lines).toHaveLength(2);
    expect(lines).toEqual(
      expect.arrayContaining([
        skipLine(orgId),
        expect.stringMatching(new RegExp(`^\\[ScheduledReports\\] Report ${report.id} completed with status: failed \\(`)),
      ])
    );
    expectNothingSensitive(lines, report, marker);
    const [execution] = await service.getExecutions(report.id, 1);
    expect(execution).toMatchObject({ status: 'failed', slack_sent: false, error_message: NOT_CONFIGURED });
  });

  it('a manual test run with email delivered records the run as partial', async () => {
    const { marker, settings } = decoySettings();
    const orgId = await insertOrg(settings);
    const report = await insertSchedule(orgId, { email: true });
    jest.spyOn(service as any, 'deliverViaEmail').mockResolvedValue(undefined);
    clearLogs();

    await service.test(report.id, orgId);

    const lines = runLinesWithoutStartLine(report);
    // Grouped by console method, not in time order.
    expect(lines).toHaveLength(2);
    expect(lines).toEqual(
      expect.arrayContaining([
        skipLine(orgId),
        expect.stringMatching(new RegExp(`^\\[ScheduledReports\\] Report ${report.id} completed with status: partial \\(`)),
      ])
    );
    expectNothingSensitive(lines, report, marker);

    const [execution] = await service.getExecutions(report.id, 1);
    expect(execution).toMatchObject({ status: 'partial', email_sent: true, slack_sent: false, error_message: NOT_CONFIGURED });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('scheduled reports -- a failed Slack delivery records only the status', () => {
  async function viewerOf(orgId: string): Promise<string> {
    const { rows } = await pool.query(
      `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Slack Viewer') RETURNING id`,
      [`slack-viewer-${uniqueSuffix()}@example.com`]
    );
    createdUserIds.push(rows[0].id);
    await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
       VALUES ($1, $2, 'viewer', NOW(), true)`,
      [orgId, rows[0].id]
    );
    return rows[0].id as string;
  }

  /** GET /api/scheduled-reports/<path> as `userId`, over a real HTTP server. */
  async function getAs(orgId: string, userId: string, path: string): Promise<{ status: number; text: string }> {
    const app = express();
    app.use(express.json());
    app.use('/api/scheduled-reports', scheduledReportsRoutes);
    const server = http.createServer(app);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    try {
      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;
      jest.spyOn(authService, 'verifyToken').mockReturnValue({
        userId,
        email: 'slack-viewer@example.com',
        organizationId: orgId,
        role: 'owner',
        type: 'access',
      } as unknown as ReturnType<typeof authService.verifyToken>);
      // The stub above answers outbound posts; this request goes to the local server.
      fetchSpy.mockRestore();
      const response = await fetch(`http://127.0.0.1:${port}/api/scheduled-reports/${path}`, {
        headers: { Authorization: 'Bearer test-token' },
      });
      return { status: response.status, text: await response.text() };
    } finally {
      await new Promise<void>((resolve) => server.close(() => resolve()));
    }
  }

  it('the response body is neither stored, returned to members, nor logged', async () => {
    const body = `BODY-SENT-${uniqueSuffix()}`;
    const orgId = await insertOrg({ slack_webhook_url: 'https://hooks.example.test/org-own' });
    const report = await insertSchedule(orgId, { email: false });
    fetchSpy.mockResolvedValue(new Response(body, { status: 500 }));
    clearLogs();

    await service.test(report.id, orgId);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [execution] = await service.getExecutions(report.id, 1);
    expect(execution).toMatchObject({ status: 'failed', slack_sent: false, error_message: 'Slack: Slack webhook returned 500' });
    const { rows } = await pool.query('SELECT last_run_error FROM scheduled_reports WHERE id = $1', [report.id]);
    expect(rows[0].last_run_error).toBe('Slack: Slack webhook returned 500');
    expect(allLines().join('\n')).not.toContain(body);

    const viewer = await viewerOf(orgId);
    const executions = await getAs(orgId, viewer, `${report.id}/executions`);
    expect(executions.status).toBe(200);
    expect(executions.text).toContain('Slack webhook returned 500');
    expect(executions.text).not.toContain(body);
    const schedule = await getAs(orgId, viewer, report.id);
    expect(schedule.status).toBe(200);
    expect(schedule.text).not.toContain(body);
  });
});
