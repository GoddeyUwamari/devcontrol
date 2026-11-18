/**
 * Trend-lag round 2 review L-1 (as the founder scoped it for the weekly email,
 * brief-build.md Q12 (b)): the weekly email and the Dashboard classify each
 * day with the same per-day helper. Both read the reportState that
 * costReportStates() (cost-trend-report-state.ts) stamps on every trend point
 * when AWSCostService fetches it; neither recomputes it.
 *
 * Cost Explorer, STS and the database are stubs: the shared ledger
 * (dashboard-money-fixtures.ts) charges every day through Nov 13 and nothing
 * after, the production shape of 2026-11-17 (trend-lag-r2-build.md). At
 * 2026-11-17 12:00 UTC, Nov 13 is past today-3 but still updating, because
 * the later days are not reported (round 2). A calendar rule would call it
 * finished; the email must not.
 */
const mockCostExplorerSend = jest.fn();

jest.mock('@aws-sdk/client-sts', () => ({
  ...jest.requireActual('@aws-sdk/client-sts'),
  STSClient: class {
    send = jest.fn(async () => ({ Credentials: { AccessKeyId: 'ASIATESTTEMP', SecretAccessKey: 'test-secret', SessionToken: 'test-session' } }));
  },
}));
jest.mock('@aws-sdk/client-cost-explorer', () => ({
  ...jest.requireActual('@aws-sdk/client-cost-explorer'),
  CostExplorerClient: class {
    send = (...args: unknown[]) => mockCostExplorerSend(...args);
  },
}));
jest.mock('../../config/database', () => ({ pool: { query: jest.fn() } }));

import type { Pool } from 'pg';
import awsCostService, { type CostTrendPoint, type CostTrendRange } from '../../services/aws-cost.service';
import { costReportStates } from '../../services/cost-trend-report-state';
import { StatsController } from '../stats.controller';
import { WeeklySummaryRepository, weeklySummaryPeriod } from '../../repositories/weekly-summary.repository';
import { costFacts } from '../../services/weekly-brief/facts';
import { ACCOUNT_ROW, ceLedgerResponse, type CeInput } from './dashboard-money-fixtures';
import * as database from '../../config/database';

const ambientPool = database.pool as unknown as { query: jest.Mock };
const ORG = ACCOUNT_ROW.org_id;
const NOW = new Date('2026-11-17T12:00:00.000Z');
const THROUGH = '2026-11-13';

function clearCostCaches(): void {
  for (const key of ['monthlyCostCache', 'monthlyCostInFlight', 'costTrendCache', 'costTrendInFlight']) {
    ((awsCostService as unknown as Record<string, Map<string, unknown>>)[key]).clear();
  }
}

/** The Dashboard's source: GET /api/platform/costs/trend?range=…, through the real controller. */
async function dashboardTrend(range: CostTrendRange): Promise<CostTrendPoint[]> {
  const json = jest.fn();
  const controller = new StatsController({ query: ambientPool.query } as unknown as Pool);
  await controller.getCostTrend({ user: { organizationId: ORG }, query: { range } } as never, { json, status: jest.fn(() => ({ json })) } as never);
  const body = json.mock.calls[0][0];
  expect(body.success).toBe(true);
  return body.data;
}

beforeEach(() => {
  jest.useFakeTimers({ doNotFake: ['nextTick', 'setImmediate', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'queueMicrotask'] });
  jest.setSystemTime(NOW);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  clearCostCaches();
  ambientPool.query.mockReset().mockImplementation(async () => ({ rows: [ACCOUNT_ROW] }));
  mockCostExplorerSend.mockReset().mockImplementation(async (command: { input: CeInput }) => ceLedgerResponse(command.input, THROUGH));
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('L-1: the weekly email and the Dashboard share the per-day report state', () => {
  it("every day of the email's week has exactly the state the Dashboard's trend points carry", async () => {
    const section = await new WeeklySummaryRepository({} as Pool).getCostTrendSection(ORG);
    const period = weeklySummaryPeriod(NOW);
    const facts = costFacts(section, period.cost);
    if (facts.state !== 'available') throw new Error(`expected available cost facts, got ${facts.state}`);
    const emailState = (day: string) =>
      facts.finished.days.includes(day) ? 'final' : facts.updating.days.includes(day) ? 'updating' : facts.notReported.includes(day) ? 'not_reported' : 'missing';

    const week = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16'];
    const dashboard7d = Object.fromEntries((await dashboardTrend('7d')).map(p => [p.date.slice(0, 10), p.reportState]));
    const dashboard30d = await dashboardTrend('30d');
    const by30d = Object.fromEntries(dashboard30d.map(p => [p.date.slice(0, 10), p.reportState]));
    // The helper itself, over the same 30-day series the email reads.
    const helper = costReportStates(
      dashboard30d.map(p => ({ lastDay: p.date.slice(0, 10), lineItems: p.lineItems ?? 0, estimated: p.estimated ?? null })),
      NOW
    );
    const byHelper = Object.fromEntries(dashboard30d.map((p, i) => [p.date.slice(0, 10), helper[i]]));

    for (const day of week) {
      expect([day, emailState(day)]).toEqual([day, by30d[day]]);
      expect([day, emailState(day)]).toEqual([day, dashboard7d[day]]);
      expect([day, emailState(day)]).toEqual([day, byHelper[day]]);
    }
    // The round-2 case a calendar rule gets wrong: Nov 13 is past today-3 and still updating.
    expect(facts.finished.days).toEqual(['2026-11-10', '2026-11-11', '2026-11-12']);
    expect(facts.updating.days).toEqual(['2026-11-13']);
    expect(facts.notReported).toEqual(['2026-11-14', '2026-11-15', '2026-11-16']);
  });

  it('the email reads the same cached series the Dashboard fetched: no second Cost Explorer call', async () => {
    await dashboardTrend('30d');
    const calls = mockCostExplorerSend.mock.calls.length;
    await new WeeklySummaryRepository({} as Pool).getCostTrendSection(ORG);
    expect(mockCostExplorerSend.mock.calls.length).toBe(calls);
  });
});
