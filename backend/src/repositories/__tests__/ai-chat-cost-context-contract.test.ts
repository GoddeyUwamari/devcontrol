/**
 * The AI Assistant's cost-context contract: every cost figure the model sees
 * carries an explicit state, source, freshness, and scope, decided here --
 * never inferred by the model from a 0, an empty list, or a missing line.
 *
 *   - Cost Explorer success (including a real $0 or a net-negative total) is
 *     'actual' billing data, scoped to the connected role's billing scope:
 *     no linked-account filter, consolidation unknown, all regions.
 *   - Cost Explorer unavailable/failed falls back to the inventory estimate,
 *     which keeps its own inventory scope and coverage and never inherits
 *     Cost Explorer's.
 *   - Nothing at all is a null figure with state 'unavailable' or 'error' --
 *     never 0, never [], never "unchanged".
 *   - The month-over-month comparison has its own state and is never
 *     fabricated from the current figure.
 *
 * awsCostService is mocked (no real AWS call); aws_resources rows are real
 * Postgres, same pattern as ai-chat-context-provenance.test.ts. The connected
 * aws_accounts lookup is stubbed per test (getConnectedAccount) rather than
 * adding another test file that creates/drops the shared aws_accounts
 * fixture table; its own null-on-failure behavior is tested directly below.
 */
import { Pool } from 'pg';
import { AIChatContextRepository } from '../ai-chat-context.repository';
import awsCostService from '../../services/aws-cost.service';
import { AIChatService, ChatContext } from '../../services/ai-chat.service';

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
const contextRepo = new AIChatContextRepository(pool);
const chatService = new AIChatService({} as Pool);
const createdOrgIds: string[] = [];

const ACCOUNT_ID = '111122223333';
const FETCHED_AT = '2026-09-24T09:30:00.000Z';

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'starter', 'active') RETURNING id`,
    [`Cost Contract Org ${suffix}`, `cost-contract-org-${suffix}`, `Cost Contract Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertResource(organizationId: string, estimatedMonthlyCost: number | null): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, estimated_monthly_cost)
     VALUES ($1, $2, $3, 'ec2', 'us-east-1', 'running', $4)`,
    [organizationId, `arn:aws:ec2:us-east-1:${ACCOUNT_ID}:instance/i-${uniqueSuffix()}`, `i-${uniqueSuffix()}`, estimatedMonthlyCost]
  );
}

/** Stubs the aws_accounts lookup as the section getConnectedAccount() returns: a row, or none connected. */
function stubConnectedAccount(account: { accountId: string | null; region: string | null } | null = { accountId: ACCOUNT_ID, region: 'us-east-1' }) {
  jest.spyOn(contextRepo as any, 'getConnectedAccount').mockResolvedValue(
    account
      ? { state: 'available', source: 'DevControl connected AWS account record', asOf: null, scope: null, coverage: null, reason: null, data: account }
      : { state: 'unavailable', source: 'DevControl connected AWS account record', asOf: null, scope: null, coverage: null, reason: 'no AWS account is connected', data: null }
  );
}

function mockCostExplorer(total: number, byService: Array<{ service: string; amount: number }>) {
  jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({
    total,
    byService,
    period: { start: '2026-09-01', end: '2026-09-25' },
    fetchedAt: FETCHED_AT,
  });
}

/** Daily trend points in the same local-date terms computeMonthOverMonthComparison() uses. */
function dailyTrend(currentDaily: number, previousDaily: number | null) {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth();
  const day = now.getDate();
  const lastMonth = month === 0 ? 11 : month - 1;
  const lastMonthYear = month === 0 ? year - 1 : year;
  const previousDays = Math.min(day, new Date(year, month, 0).getDate());
  const iso = (y: number, m: number, d: number) => `${y}-${String(m + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  const point = (date: string, total: number) => ({
    date, total, compute: total, storage: 0, database: 0, network: 0, other: 0, byService: [],
  });

  const points = [];
  if (previousDaily !== null) {
    for (let d = 1; d <= previousDays; d++) points.push(point(iso(lastMonthYear, lastMonth, d), previousDaily));
  }
  for (let d = 1; d <= day; d++) points.push(point(iso(year, month, d), currentDaily));
  return { points: points as any, currentDays: day, previousDays };
}

function format(context: ChatContext): string {
  return (chatService as any).formatContext(context);
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Cost Explorer success', () => {
  it('is state "available", source "actual", with its own asOf, period, and top services intact', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    mockCostExplorer(300, [
      { service: 'AWS Lambda', amount: 20 },
      { service: 'Amazon Elastic Compute Cloud - Compute', amount: 250 },
      { service: 'Amazon Simple Storage Service', amount: 30 },
    ]);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const { costs } = await contextRepo.gatherContext(orgId);

    expect(costs.state).toBe('available');
    expect(costs.source).toBe('actual');
    expect(costs.current).toBe(300);
    expect(costs.asOf).toBe(FETCHED_AT);
    expect(costs.period).toEqual({ start: '2026-09-01', endExclusive: '2026-09-25' });
    expect(costs.costExplorer).toEqual({ state: 'available', reason: null });
    expect(costs.topSpenders!.map(s => s.service)).toEqual([
      'Amazon Elastic Compute Cloud - Compute', 'Amazon Simple Storage Service', 'AWS Lambda',
    ]);
    expect(costs.topSpenders![0].percentage).toBeCloseTo(83.33, 2);
  });

  it('scope is the connected role\'s billing scope: no linked-account filter, consolidation unknown, all regions', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    mockCostExplorer(300, [{ service: 'AWS Lambda', amount: 300 }]);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.scope).toEqual({
      kind: 'cost_explorer',
      connectedAccountId: ACCOUNT_ID,
      linkedAccountFilter: 'none',
      consolidatedBilling: 'unknown',
      regions: 'all',
    });

    const formatted = format(context);
    expect(formatted).toMatch(/Scope: the AWS Cost Explorer billing scope of the connected IAM role/);
    expect(formatted).toMatch(/Linked-account filter: none/);
    expect(formatted).toMatch(/Consolidated billing: unknown/);
    expect(formatted).toMatch(/Regions: all/);
    // Never asserts an account type that DevControl hasn't verified.
    expect(formatted).not.toMatch(/member account|single (AWS )?account|account-wide spend/i);
    expect(formatted).not.toMatch(/is a (management|payer) account/i);
  });

  it('a real $0 total stays $0.00, available and actual -- never replaced by an existing inventory estimate', async () => {
    const orgId = await insertOrg();
    await insertResource(orgId, 80);
    stubConnectedAccount();
    mockCostExplorer(0, []);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.state).toBe('available');
    expect(context.costs.source).toBe('actual');
    expect(context.costs.current).toBe(0);
    expect(context.costs.topSpenders).toEqual([]); // a real, empty breakdown -- not a stand-in for "unknown"
    const formatted = format(context);
    expect(formatted).toMatch(/Month-to-date spend: \$0\.00/);
    expect(formatted).toMatch(/Cost Explorer returned no billed service line items/);
    expect(formatted).not.toMatch(/\$80/);
  });

  it('a net-negative (credit) total stays actual data, and service shares of it are null rather than a fake percentage', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    mockCostExplorer(-12.34, [
      { service: 'Amazon Elastic Compute Cloud - Compute', amount: 7.66 },
      { service: 'Credits', amount: -20 },
    ]);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.state).toBe('available');
    expect(context.costs.source).toBe('actual');
    expect(context.costs.current).toBe(-12.34);
    expect(context.costs.topSpenders!.every(s => s.percentage === null)).toBe(true);
    expect(format(context)).toMatch(/Month-to-date spend: -\$12\.34 \(net negative/);
  });

  it('a sub-dollar total keeps its cents rather than rounding to a "$0" that reads as no spend', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    mockCostExplorer(0.4, [{ service: 'Amazon Simple Storage Service', amount: 0.4 }]);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.current).toBe(0.4);
    expect(format(context)).toMatch(/Month-to-date spend: \$0\.40/);
  });
});

describe('Cost Explorer failure', () => {
  it('a failed request with no estimate is state "error" with a null figure -- not 0, not [], not "none"', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('ThrottlingException: Rate exceeded'));
    const trendSpy = jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.state).toBe('error');
    expect(context.costs.source).toBe('unavailable');
    expect(context.costs.costExplorer).toEqual({ state: 'error', reason: 'the Cost Explorer request failed' });
    expect(context.costs.current).toBeNull();
    expect(context.costs.topSpenders).toBeNull();
    expect(context.costs.scope).toBeNull();
    expect(context.costs.comparison.state).toBe('unavailable');
    expect(context.costs.comparison.previousWindowTotal).toBeNull();
    expect(context.costs.comparison.changePercent).toBeNull();
    expect(trendSpy).not.toHaveBeenCalled();

    const formatted = format(context);
    expect(formatted).toMatch(/- Status: Could not be retrieved/);
    expect(formatted).toMatch(/AWS Cost Explorer status: Could not be retrieved/);
    expect(formatted).toMatch(/Spend: not available .*not a zero amount/);
    expect(formatted).not.toMatch(/\$0\.00/);
  });

  it('no connected AWS account is "unavailable" (nothing to query), distinct from a failed query', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount(null);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error(`AWS_NOT_CONNECTED: org ${orgId} has not connected an AWS account`));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.state).toBe('unavailable');
    expect(context.costs.costExplorer).toEqual({ state: 'unavailable', reason: 'no connected AWS account' });
    expect(context.costs.current).toBeNull();
  });

  it('a failed estimate query is "error", not an unavailable-looking empty result', async () => {
    const throwingPool = { query: jest.fn().mockRejectedValue(new Error('connection terminated')) } as unknown as Pool;
    const repo = new AIChatContextRepository(throwingPool);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED: none'));

    const costs: ChatContext['costs'] = await (repo as any).getCostData(
      'org-id', null, null, { kind: 'resource_inventory', connectedAccountId: null, discoveryRegion: null }
    );

    expect(costs.costExplorer.state).toBe('unavailable');
    expect(costs.state).toBe('error');
    expect(costs.current).toBeNull();
  });
});

describe('Inventory estimate fallback', () => {
  it('is explicitly "estimated", keeps inventory scope (not Cost Explorer scope), and records why Cost Explorer was not used', async () => {
    const orgId = await insertOrg();
    await insertResource(orgId, 40);
    await insertResource(orgId, 2.5);
    stubConnectedAccount();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AccessDeniedException'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.state).toBe('available');
    expect(context.costs.source).toBe('estimated');
    expect(context.costs.current).toBe(42.5);
    expect(context.costs.period).toBeNull();
    expect(context.costs.topSpenders).toBeNull();
    expect(context.costs.costExplorer.state).toBe('error');
    expect(context.costs.estimateCoverage).toEqual({ estimatedResources: 2, totalResources: 2 });
    expect(context.costs.scope).toEqual({ kind: 'resource_inventory', connectedAccountId: ACCOUNT_ID, discoveryRegion: 'us-east-1' });
    expect(context.costs.scope).not.toHaveProperty('regions');
    expect(context.costs.scope).not.toHaveProperty('linkedAccountFilter');
    expect(context.costs.comparison.state).toBe('unavailable');

    const formatted = format(context);
    expect(formatted).toMatch(/Source: DevControl inventory estimate .*NOT AWS billing data/);
    expect(formatted).toMatch(/Scope: AWS resources DevControl discovered under the connected IAM role/);
    expect(formatted).toMatch(/Regions: us-east-1 only/);
    expect(formatted).toMatch(/Estimated monthly cost: \$42\.50/);
    expect(formatted).not.toMatch(/- month_to_date_spend:/);
    expect(formatted).not.toMatch(/scope\.kind: cost_explorer/);
  });

  it('resources without an estimate make the estimate "partial" with its coverage, not a silently complete total', async () => {
    const orgId = await insertOrg();
    await insertResource(orgId, 40);
    await insertResource(orgId, null);
    stubConnectedAccount();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED: none'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.state).toBe('partial');
    expect(context.costs.estimateCoverage).toEqual({ estimatedResources: 1, totalResources: 2 });
    expect(format(context)).toMatch(/Coverage: 1 of 2 discovered resources have a cost estimate/);
  });
});

describe('Month-over-month comparison', () => {
  it('both windows available: deterministic totals, change, and percentage', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    mockCostExplorer(500, [{ service: 'AWS Lambda', amount: 500 }]);
    const trend = dailyTrend(10, 5);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(trend.points);

    const { costs } = await contextRepo.gatherContext(orgId);
    const current = 10 * trend.currentDays;
    const previous = 5 * trend.previousDays;

    expect(costs.comparison.state).toBe('available');
    expect(costs.comparison.currentWindowTotal).toBe(current);
    expect(costs.comparison.previousWindowTotal).toBe(previous);
    expect(costs.comparison.changeAmount).toBe(current - previous);
    expect(costs.comparison.changePercent).toBe(Math.round(((current - previous) / previous) * 1000) / 10);
    expect(costs.comparison.coverage).toEqual({
      currentDays: trend.currentDays, previousDays: trend.previousDays,
      expectedCurrentDays: trend.currentDays, expectedPreviousDays: trend.previousDays,
    });
  });

  it('previous window missing: no previous figure, no change, no percentage -- never "same as current"', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    mockCostExplorer(500, [{ service: 'AWS Lambda', amount: 500 }]);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(dailyTrend(10, null).points);

    const context = await contextRepo.gatherContext(orgId);
    const { comparison } = context.costs;

    expect(comparison.state).toBe('unavailable');
    expect(comparison.previousWindowTotal).toBeNull();
    expect(comparison.currentWindowTotal).toBeNull();
    expect(comparison.changeAmount).toBeNull();
    expect(comparison.changePercent).toBeNull();
    expect(comparison.previousWindowTotal).not.toBe(context.costs.current);

    const formatted = format(context);
    expect(formatted).toMatch(/Previous period: not available -- do not assume spend was unchanged/);
    expect(formatted).not.toMatch(/previous_window:/);
    expect(formatted).not.toMatch(/- Change: /);
  });

  it('a failed trend request makes the comparison "error" while the current figure stays available', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    mockCostExplorer(500, [{ service: 'AWS Lambda', amount: 500 }]);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockRejectedValue(new Error('ThrottlingException'));

    const { costs } = await contextRepo.gatherContext(orgId);

    expect(costs.state).toBe('available');
    expect(costs.current).toBe(500);
    expect(costs.comparison.state).toBe('error');
    expect(costs.comparison.previousWindowTotal).toBeNull();
    expect(costs.comparison.changePercent).toBeNull();
  });

  it('a previous window that really totals $0 is a real comparison whose percentage is undefined (null), not 0', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    mockCostExplorer(500, [{ service: 'AWS Lambda', amount: 500 }]);
    const trend = dailyTrend(10, 0);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(trend.points);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.comparison.state).toBe('available');
    expect(context.costs.comparison.previousWindowTotal).toBe(0);
    expect(context.costs.comparison.changeAmount).toBe(10 * trend.currentDays);
    expect(context.costs.comparison.changePercent).toBeNull();
    expect(format(context)).toMatch(/percentage undefined: previous window total is \$0\.00/);
  });
});

describe('Inventory scope', () => {
  it('context.inventoryScope states the connected account and the single discovery region, separately from cost scope', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount({ accountId: ACCOUNT_ID, region: 'eu-west-1' });
    mockCostExplorer(10, [{ service: 'AWS Lambda', amount: 10 }]);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.inventoryScope).toEqual({ kind: 'resource_inventory', connectedAccountId: ACCOUNT_ID, discoveryRegion: 'eu-west-1' });
    const formatted = format(context);
    expect(formatted).toMatch(/Regions: all/); // cost
    expect(formatted).toMatch(/Regions: eu-west-1 only/); // inventory
  });

  it('a null stored region is the us-east-1 that discovery itself falls back to (AWSClientFactory.createClients)', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount({ accountId: ACCOUNT_ID, region: null });
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED: none'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.inventoryScope.discoveryRegion).toBe('us-east-1');
  });

  it('no connected account (or a failed lookup) is an unknown scope -- never a guessed account ID or region', async () => {
    const throwingPool = { query: jest.fn().mockRejectedValue(new Error('relation "aws_accounts" does not exist')) } as unknown as Pool;
    const repo = new AIChatContextRepository(throwingPool);

    // A failed lookup is 'error' -- distinguishable from "no account connected" -- and carries no guessed row.
    await expect((repo as any).getConnectedAccount('org-id')).resolves.toMatchObject({ state: 'error', data: null });

    const orgId = await insertOrg();
    stubConnectedAccount(null);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED: none'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);
    const context = await contextRepo.gatherContext(orgId);

    expect(context.inventoryScope).toEqual({ kind: 'resource_inventory', connectedAccountId: null, discoveryRegion: null });
    expect(format(context)).toMatch(/Connected AWS account: unknown/);
  });
});

/**
 * A full-coverage daily trend whose windows sum to exactly the given totals:
 * the whole amount on each window's first day, $0 on the rest (a $0 day is
 * still a day of data, so coverage stays complete).
 */
function trendWithTotals(currentTotal: number, previousTotal: number) {
  const { points } = dailyTrend(0, 0);
  const now = new Date();
  const currentPrefix = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-`;
  const firstCurrent = points.find((p: any) => p.date.startsWith(currentPrefix));
  const firstPrevious = points.find((p: any) => !p.date.startsWith(currentPrefix));
  firstCurrent.total = currentTotal;
  firstPrevious.total = previousTotal;
  return points;
}

function compare(currentTotal: number, previousTotal: number) {
  return (contextRepo as any).computeMonthOverMonthComparison(trendWithTotals(currentTotal, previousTotal));
}

describe('Comparison arithmetic is done on the displayed cents', () => {
  it('$14.83 vs $14.33 is a $0.50 change, even when the unrounded sums differ by $0.508', () => {
    // Production 2026-09-25: sums like these produced "$14.83 vs $14.33, +$0.51".
    const comparison = compare(14.834, 14.326);

    expect(comparison.currentWindowTotal).toBe(14.83);
    expect(comparison.previousWindowTotal).toBe(14.33);
    expect(comparison.changeAmount).toBe(0.5);
    expect(comparison.changePercent).toBe(3.5); // 50 / 1433 cents
  });

  it('the change always equals the difference of the two displayed totals', () => {
    for (const [current, previous] of [[15.074, 14.326], [0.3, 0.1], [100.005, 99.994], [7.777, 3.333]]) {
      const comparison = compare(current, previous);
      expect(Math.round(comparison.changeAmount * 100))
        .toBe(Math.round(comparison.currentWindowTotal * 100) - Math.round(comparison.previousWindowTotal * 100));
    }
  });

  it('a zero difference is $0.00 and 0% -- a real, measured "unchanged"', () => {
    const comparison = compare(12.34, 12.34);

    expect(comparison.changeAmount).toBe(0);
    expect(comparison.changePercent).toBe(0);
  });

  it('a decrease keeps its negative sign and cents', () => {
    const comparison = compare(9.99, 12.5);

    expect(comparison.changeAmount).toBe(-2.51);
    expect(comparison.changePercent).toBe(-20.1);
    const formatted = (chatService as any).formatComparisonSection(comparison);
    expect(formatted).toMatch(/- Change: -\$2\.51 \(-20\.1%\)/);
  });

  it('sub-dollar windows keep their cents rather than rounding to $0', () => {
    const comparison = compare(0.07, 0.03);

    expect(comparison.currentWindowTotal).toBe(0.07);
    expect(comparison.previousWindowTotal).toBe(0.03);
    expect(comparison.changeAmount).toBe(0.04);
    expect(comparison.changePercent).toBe(133.3);
  });

  it('a previous window that displays as $0.00 has no percentage, even if its unrounded sum is a fraction of a cent', () => {
    const comparison = compare(0.42, 0.004);

    expect(comparison.previousWindowTotal).toBe(0);
    expect(comparison.changeAmount).toBe(0.42);
    expect(comparison.changePercent).toBeNull();
  });

  it('a net-negative previous window gets no percentage rather than a sign-flipped one', () => {
    const comparison = compare(5, -1);

    expect(comparison.changeAmount).toBe(6);
    expect(comparison.changePercent).toBeNull();
  });
});

describe('Comparison partial-day semantics', () => {
  it('flags that the current window ends on today, which is still in progress, and says so in the formatted context', () => {
    const comparison = compare(14.83, 14.33);
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;

    expect(comparison.currentWindow.end).toBe(today);
    expect(comparison.currentWindowIncludesToday).toBe(true);
    const formatted = (chatService as any).formatComparisonSection(comparison);
    expect(formatted).toMatch(new RegExp(`Partial day: the current window's last day \\(${today}\\) is today and still in progress`));
  });

  it('a comparison with no windows makes no partial-day claim', () => {
    const comparison = (contextRepo as any).computeMonthOverMonthComparison([]);

    expect(comparison.state).toBe('unavailable');
    expect((chatService as any).formatComparisonSection(comparison)).not.toMatch(/partial_day/);
  });
});

describe('DORA context labeling', () => {
  it('lead time carries the metric\'s own description (time between deployments), not an implied commit-to-deploy time', async () => {
    jest.spyOn((contextRepo as any).doraMetricsService, 'getComprehensiveMetrics').mockResolvedValue({
      deploymentFrequency: { value: 3.8, unit: 'per day', description: '114 deployments in 30 days' },
      leadTime: { value: 6.12, unit: 'hours', description: 'Average time between consecutive deployments' },
      mttr: { value: 71.35, unit: 'minutes', description: '1 incidents recovered' },
    });

    const dora = await (contextRepo as any).getDORAMetrics('org-id');

    expect(dora.state).toBe('available');
    expect(dora.data).toEqual({
      deploymentFrequency: '114 deployments in 30 days',
      leadTime: '6.12 hours (Average time between consecutive deployments)',
      mttr: '71.35 minutes (1 incidents recovered)',
    });
  });
});

describe('Comparison provenance: asOf and basis', () => {
  it('carries when its daily trend was fetched, and states that credits are excluded (daily category charges floored to zero)', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    mockCostExplorer(500, [{ service: 'AWS Lambda', amount: 500 }]);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(dailyTrend(10, 5).points);
    const fetchedAt = jest.spyOn(awsCostService, 'getCostTrendFetchedAt').mockReturnValue('2026-09-25T15:17:36.123Z');

    const context = await contextRepo.gatherContext(orgId);
    const { comparison } = context.costs;

    expect(fetchedAt).toHaveBeenCalledWith(orgId, '90d');
    expect(comparison.asOf).toBe('2026-09-25T15:17:36.123Z');
    expect(comparison.basis).toMatch(/daily charges per cost category, with any negative daily category amount floored to zero -- credits and refunds are excluded/);
    const section = (chatService as any).formatComparisonSection(comparison);
    expect(section).toMatch(/- As of: 2026-09-25T15:17:36\.123Z/);
    expect(section).toMatch(/- Basis: sum of AWS Cost Explorer daily charges per cost category/);
    // The calculation itself is unchanged -- only its provenance is new.
    expect(comparison.changeAmount).toBe(10 * dailyTrend(10, 5).currentDays - 5 * dailyTrend(10, 5).previousDays);
  });

  it('an unknown fetch time is null and stated as "unknown", never a guessed timestamp', () => {
    const comparison = compare(14.83, 14.33);

    expect(comparison.asOf).toBeNull();
    expect((chatService as any).formatComparisonSection(comparison)).toMatch(/- As of: unknown/);
  });

  it('a failed or impossible comparison still states its basis and claims no freshness', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    mockCostExplorer(500, [{ service: 'AWS Lambda', amount: 500 }]);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockRejectedValue(new Error('ThrottlingException'));

    const { comparison } = (await contextRepo.gatherContext(orgId)).costs;

    expect(comparison).toMatchObject({ state: 'error', asOf: null, currentWindowTotal: null, previousWindowTotal: null, changeAmount: null, changePercent: null });
    expect(comparison.basis).toBe(dailyBasis());
  });
});

function dailyBasis() {
  return 'sum of AWS Cost Explorer daily charges per cost category, with any negative daily category amount floored to zero -- credits and refunds are excluded, so window totals can differ from month-to-date spend';
}

describe('Credits: month-to-date spend vs the comparison window total', () => {
  it('when credits make them differ, both figures stay as calculated and are never presented as the same total', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    // Cost Explorer's month-to-date total nets a $5 credit: $15 charges - $5 = $10.
    mockCostExplorer(10, [
      { service: 'Amazon Elastic Compute Cloud - Compute', amount: 15 },
      { service: 'Credits', amount: -5 },
    ]);
    // The daily trend floors each negative category amount to zero (D2), so the
    // same days sum to the $15 of charges, credit excluded.
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue(trendWithTotals(15, 12));

    const context = await contextRepo.gatherContext(orgId);

    // The existing calculations are unchanged: two different, correctly-sourced figures.
    expect(context.costs.current).toBe(10);
    expect(context.costs.comparison.currentWindowTotal).toBe(15);
    expect(context.costs.comparison.changeAmount).toBe(3);

    const formatted = format(context);
    expect(formatted).toMatch(/- Month-to-date spend: \$10\.00 \(observed spend for the period above/);
    expect(formatted).toMatch(/- Current window: .* total \$15\.00/);
    expect(formatted).toMatch(/- Basis: .*credits and refunds are excluded, so window totals can differ from month-to-date spend/);
    expect(formatted).toMatch(/- Not the same total as month-to-date spend: this window's total \(\$15\.00\) and the month-to-date spend above \(\$10\.00\) are calculated differently \(see Basis\) -- present them as two different figures, never as the same total/);
  });

  it('when the two agree, no difference is claimed', () => {
    const section = (chatService as any).formatComparisonSection(compare(14.83, 14.33), 14.83);

    expect(section).not.toMatch(/Not the same total/);
  });

  it('with no actual month-to-date figure (estimate or unavailable), no comparison against it is made', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('ThrottlingException'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const formatted = format(await contextRepo.gatherContext(orgId));

    expect(formatted).not.toMatch(/Not the same total/);
  });
});
