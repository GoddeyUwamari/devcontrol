/**
 * WeeklyAISummaryJob send path with a fake pool, a stubbed repository, and a
 * stubbed Resend client -- no database, no Cost Explorer, no model call, and
 * no email leaves the process.
 */
import { Pool } from 'pg';
import { WeeklyAISummaryJob, WEEKLY_SUMMARY_SUBJECT } from '../weekly-ai-summary.job';
import { AIInsightsService } from '../../services/ai-insights.service';

const ORG_A = 'c0000000-0000-4000-8000-00000000000a';
const ORG_B = 'c0000000-0000-4000-8000-00000000000b';

function fakePool() {
  const clients: Array<{ query: jest.Mock; release: jest.Mock }> = [];
  const pool = {
    connect: jest.fn(async () => {
      const c = { query: jest.fn(async () => ({ rows: [] })), release: jest.fn() };
      clients.push(c);
      return c;
    }),
  };
  return { pool: pool as unknown as Pool, clients };
}

const originalAnthropicKey = process.env.ANTHROPIC_API_KEY;

beforeAll(() => {
  delete process.env.ANTHROPIC_API_KEY;
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterAll(() => {
  if (originalAnthropicKey) process.env.ANTHROPIC_API_KEY = originalAnthropicKey;
});

function setup(recipientFor: (org: string) => unknown) {
  const { pool, clients } = fakePool();
  const job = new WeeklyAISummaryJob(pool);
  const send = jest.fn(async () => ({ data: { id: 'email-id' } }));
  (job as any).resend = { emails: { send } };
  const repository = (job as any).repository;
  const getUserInfo = jest.spyOn(repository, 'getUserInfo').mockImplementation(async (org: any) => recipientFor(org));
  const gatherWeeklyEvidence = jest.spyOn(repository, 'gatherWeeklyEvidence').mockImplementation(async () => {
    throw new Error('evidence should not be gathered in this test');
  });
  return { job, send, clients, getUserInfo, gatherWeeklyEvidence, repository };
}

describe('WeeklyAISummaryJob recipient eligibility', () => {
  it('R: the manual trigger never sends or gathers data when no owner is eligible', async () => {
    const { job, send, gatherWeeklyEvidence, getUserInfo, clients } = setup(() => null);

    const result = await job.triggerManual(ORG_A);

    expect(result).toEqual({ sent: 0, skipped: 1, errors: 0 });
    expect(getUserInfo).toHaveBeenCalledWith(ORG_A, clients[0]);
    expect(gatherWeeklyEvidence).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    // The eligibility query ran on this org's tenant-tagged connection.
    expect(clients[0].query).toHaveBeenCalledWith("SELECT set_config('app.current_organization_id', $1, false)", [ORG_A]);
    expect(clients[0].release).toHaveBeenCalled();
  });

  it('R: the scheduled run counts an ineligible org as skipped, not sent', async () => {
    const { job, send, repository } = setup(() => null);
    jest.spyOn(repository, 'getActiveOrganizations').mockResolvedValue([ORG_A, ORG_B]);

    const result = await (job as any).sendWeeklySummaries();

    expect(result).toEqual({ sent: 0, skipped: 2, errors: 0 });
    expect(send).not.toHaveBeenCalled();
  });

  it('15: the manual trigger requires an organization -- it never falls through to every org', async () => {
    const { job, repository } = setup(() => null);
    const all = jest.spyOn(repository, 'getActiveOrganizations');
    await expect(job.triggerManual('' as any)).rejects.toThrow(/organizationId is required/);
    await expect(job.triggerManual(undefined as any)).rejects.toThrow(/organizationId is required/);
    expect(all).not.toHaveBeenCalled();
  });

  /** Evidence with every source missing, except open recommendations and active findings (what used to trigger a model call). */
  function stubEvidence(repository: any) {
    const { weeklySummaryPeriod } = jest.requireActual('../../repositories/weekly-summary.repository');
    const { notSupported, collectSection } = jest.requireActual('../../services/ai-context-contract');
    const missing = (source: string) => notSupported({ source }, 'not evaluated in this test');
    return jest.spyOn(repository, 'gatherWeeklyEvidence').mockImplementation(async (...args: any[]) => ({
      period: weeklySummaryPeriod(args[1]),
      currentWeekSpend: missing('AWS Cost Explorer daily trend'),
      previousWeekSpend: missing('AWS Cost Explorer daily trend'),
      weekOverWeek: missing('DevControl week-over-week comparison'),
      inventoryEstimate: null,
      alerts: missing('DevControl alert history'),
      delivery: missing('DevControl deployment records'),
      security: await collectSection({ source: 'DevControl security posture score and configuration checks' }, async () => ({
        state: 'available', data: { score: 70, accountLevelFindings: 2, resourceComplianceIssues: 3 },
      })),
      recommendations: await collectSection({ source: 'DevControl cost recommendations' }, async () => ({
        state: 'available', data: { active: 3, totalEstimatedMonthlySavings: 845 },
      })),
    }));
  }

  it('P/16/B1: an eligible org is sent only to its own recipient, with no model call, no AI section, and a subject with no AI claim', async () => {
    const { job, send, repository } = setup(org => ({ userId: `user-of-${org}`, email: `owner@${org}.test`, fullName: 'Pat Owner' }));
    const gather = stubEvidence(repository);
    const modelCall = jest.spyOn(AIInsightsService.prototype, 'generateDashboardSummary');

    const result = await job.triggerManual(ORG_B);

    expect(result).toEqual({ sent: 1, skipped: 0, errors: 0 });
    expect(gather).toHaveBeenCalledWith(ORG_B, expect.any(Date), expect.anything());
    expect(send).toHaveBeenCalledTimes(1);
    const payload = (send.mock.calls[0] as any[])[0];
    expect(payload.to).toBe(`owner@${ORG_B}.test`);
    const token = Buffer.from(`user-of-${ORG_B}`).toString('base64');
    expect(payload.headers['List-Unsubscribe']).toContain(`token=${token}`);
    expect(payload.text).toContain('Cloud spend data was unavailable for this period');
    expect(payload.text).not.toMatch(/No cloud spend recorded|No alerts|DORA|lead time/i);

    // B1: no model call; nothing model-written or "AI"-claimed reaches the email.
    expect(modelCall).not.toHaveBeenCalled();
    expect(payload.subject).toBe(WEEKLY_SUMMARY_SUBJECT);
    expect(payload.subject).not.toMatch(/\bAI\b/);
    for (const body of [payload.html, payload.text]) {
      expect(body).not.toMatch(/AI recommendation|AI-Powered/i);
      expect(body).toContain('Estimated savings opportunity: $845/month');
    }
    modelCall.mockRestore();
  });

  it('H1: a Resend { error } result is a failed send -- counted as an error, never as sent, with a sanitized log', async () => {
    const { job, send, repository } = setup(org => ({ userId: `user-of-${org}`, email: `owner@${org}.test`, fullName: 'Pat Owner' }));
    stubEvidence(repository);
    send.mockResolvedValue({
      data: null,
      error: { name: 'validation_error', message: `Invalid \`to\` field: owner@${ORG_A}.test is not allowed` },
    } as any);
    jest.spyOn(repository, 'getActiveOrganizations').mockResolvedValue([ORG_A, ORG_B]);
    const errorLog = console.error as jest.Mock;
    const logLine = console.log as jest.Mock;
    errorLog.mockClear();
    logLine.mockClear();

    const scheduled = await (job as any).sendWeeklySummaries();
    expect(scheduled).toEqual({ sent: 0, skipped: 0, errors: 2 });

    const manual = await job.triggerManual(ORG_A);
    expect(manual).toEqual({ sent: 0, skipped: 0, errors: 1 });

    // Never logged as a success, and Resend's raw message never reaches the logs.
    const logged = [...errorLog.mock.calls, ...logLine.mock.calls].map(call => call.map(String).join(' ')).join('\n');
    expect(logged).not.toContain('✅ Sent');
    expect(logged).toContain('Resend rejected the send (validation_error)');
    expect(logged).not.toContain('is not allowed');
    const complete = logLine.mock.calls.map(c => String(c[0])).find(l => l.includes('[Weekly AI Summary] COMPLETE'));
    expect(complete).toContain('"sent":0');
    expect(complete).toContain('"errors":2');
  });
});
