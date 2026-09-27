/**
 * WeeklyAISummaryJob send path with a fake pool, a stubbed repository, and a
 * stubbed Resend client -- no database, no Cost Explorer, no model call, and
 * no email leaves the process.
 */
import { Pool } from 'pg';
import { WeeklyAISummaryJob } from '../weekly-ai-summary.job';
import { AIInsightsService } from '../../services/ai-insights.service';

// AIInsightsService starts a cache-cleanup setInterval in its constructor; not under test here.
jest.spyOn(AIInsightsService.prototype as any, 'startCacheCleanup').mockImplementation(() => {});

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

  it('P/16: an eligible org is sent only to its own recipient, with the unchanged unsubscribe token scheme', async () => {
    const { job, send, repository } = setup(org => ({ userId: `user-of-${org}`, email: `owner@${org}.test`, fullName: 'Pat Owner' }));
    const { weeklySummaryPeriod } = jest.requireActual('../../repositories/weekly-summary.repository');
    const { notSupported } = jest.requireActual('../../services/ai-context-contract');
    const missing = (source: string) => notSupported({ source }, 'not evaluated in this test');
    const gather = jest.spyOn(repository, 'gatherWeeklyEvidence').mockImplementation(async (...args: any[]) => ({
      period: weeklySummaryPeriod(args[1]),
      currentWeekSpend: missing('AWS Cost Explorer daily trend'),
      previousWeekSpend: missing('AWS Cost Explorer daily trend'),
      weekOverWeek: missing('DevControl week-over-week comparison'),
      inventoryEstimate: null,
      alerts: missing('DevControl alert history'),
      delivery: missing('DevControl deployment records'),
      security: missing('DevControl security posture score and configuration checks'),
      recommendations: missing('DevControl cost recommendations'),
    }));

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
  });
});
