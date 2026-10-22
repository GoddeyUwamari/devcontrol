/**
 * Scheduled-report Slack delivery goes only to the organization's own
 * webhook (organizations.settings.slack_webhook_url). Without one nothing is
 * posted anywhere, one line naming the organization is logged, and the run
 * records the delivery as not made: failed, or partial when email went out.
 *
 * Real DB; fetch, email and report generation are stubbed.
 */
import { Pool } from 'pg';
import { ScheduledReportsService } from '../scheduled-reports.service';
import { ScheduledReport } from '../../repositories/scheduled-reports.repository';

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
  return service.create({
    organization_id: orgId,
    name: `Slack schedule ${uniqueSuffix()}`,
    report_type: 'cost_summary',
    schedule_type: 'daily',
    schedule_time: '09:00:00',
    timezone: 'UTC',
    delivery_email: opts.email,
    delivery_slack: true,
    email_recipients: opts.email ? ['ops@example.com'] : [],
    slack_channels: ['#reports'],
    format: 'pdf',
  });
}

let fetchSpy: jest.SpyInstance;
let warnSpy: jest.SpyInstance;

beforeEach(() => {
  process.env.SLACK_WEBHOOK_URL = PLATFORM_WEBHOOK;
  fetchSpy = jest.spyOn(global, 'fetch').mockResolvedValue(new Response('ok', { status: 200 }));
  warnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
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
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM scheduled_reports WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

function deliver(report: ScheduledReport) {
  return (service as any).deliverReport(report, { pdf: Buffer.from('pdf') }) as Promise<{
    emailSuccess: boolean;
    slackSuccess: boolean;
    error?: string;
  }>;
}

function slackSkipLines(): string[] {
  return warnSpy.mock.calls.map((args) => args.join(' ')).filter((line) => line.includes('Slack delivery skipped'));
}

describe('scheduled reports -- Slack delivery uses only the organization webhook', () => {
  it('no organization webhook: nothing is posted, one line names the org, the delivery is recorded as not made', async () => {
    const orgId = await insertOrg(null);
    const report = await insertSchedule(orgId, { email: false });

    const result = await deliver(report);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result).toEqual({ emailSuccess: false, slackSuccess: false, error: NOT_CONFIGURED });
    const lines = slackSkipLines();
    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain(orgId);
    expect(lines[0]).not.toContain(PLATFORM_WEBHOOK);
    expect(lines[0]).not.toContain(report.name);
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
    const orgId = await insertOrg({ slack_webhook_url: value });
    const report = await insertSchedule(orgId, { email: false });

    const result = await deliver(report);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.slackSuccess).toBe(false);
    expect(result.error).toBe(NOT_CONFIGURED);
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
    const orgId = await insertOrg(null);
    const report = await insertSchedule(orgId, { email: false });

    await service.test(report.id, orgId);

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(slackSkipLines()).toHaveLength(1);
    const [execution] = await service.getExecutions(report.id, 1);
    expect(execution).toMatchObject({ status: 'failed', slack_sent: false, error_message: NOT_CONFIGURED });
  });

  it('a manual test run with email delivered records the run as partial', async () => {
    const orgId = await insertOrg(null);
    const report = await insertSchedule(orgId, { email: true });
    jest.spyOn(service as any, 'deliverViaEmail').mockResolvedValue(undefined);

    await service.test(report.id, orgId);

    const [execution] = await service.getExecutions(report.id, 1);
    expect(execution).toMatchObject({ status: 'partial', email_sent: true, slack_sent: false, error_message: NOT_CONFIGURED });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
