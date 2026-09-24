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

function stubConnectedAccount(account: { accountId: string | null; region: string | null } | null = { accountId: ACCOUNT_ID, region: 'us-east-1' }) {
  jest.spyOn(contextRepo as any, 'getConnectedAccount').mockResolvedValue(account);
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
    expect(formatted).toMatch(/scope\.kind: cost_explorer_billing_scope/);
    expect(formatted).toMatch(/scope\.linked_account_filter: none/);
    expect(formatted).toMatch(/scope\.consolidated_billing: unknown/);
    expect(formatted).toMatch(/scope\.regions: all/);
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
    expect(formatted).toMatch(/month_to_date_spend: \$0\.00/);
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
    expect(format(context)).toMatch(/month_to_date_spend: -\$12\.34 \(net negative/);
  });

  it('a sub-dollar total keeps its cents rather than rounding to a "$0" that reads as no spend', async () => {
    const orgId = await insertOrg();
    stubConnectedAccount();
    mockCostExplorer(0.4, [{ service: 'Amazon Simple Storage Service', amount: 0.4 }]);
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.current).toBe(0.4);
    expect(format(context)).toMatch(/month_to_date_spend: \$0\.40/);
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
    expect(formatted).toMatch(/- state: error/);
    expect(formatted).toMatch(/cost_explorer\.state: error/);
    expect(formatted).toMatch(/spend: not available .*not a zero amount/);
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
    expect(formatted).toMatch(/source: DevControl inventory estimate .*NOT AWS billing data/);
    expect(formatted).toMatch(/scope\.kind: resource_inventory/);
    expect(formatted).toMatch(/scope\.regions: us-east-1 only/);
    expect(formatted).toMatch(/estimated_monthly_cost: \$42\.50/);
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
    expect(format(context)).toMatch(/coverage: 1 of 2 discovered resources have a cost estimate/);
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
    expect(formatted).toMatch(/previous period: not available -- do not assume spend was unchanged/);
    expect(formatted).not.toMatch(/previous_window:/);
    expect(formatted).not.toMatch(/- change: /);
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
    expect(formatted).toMatch(/scope\.regions: all/); // cost
    expect(formatted).toMatch(/scope\.regions: eu-west-1 only/); // inventory
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

    await expect((repo as any).getConnectedAccount('org-id')).resolves.toBeNull();

    const orgId = await insertOrg();
    stubConnectedAccount(null);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED: none'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);
    const context = await contextRepo.gatherContext(orgId);

    expect(context.inventoryScope).toEqual({ kind: 'resource_inventory', connectedAccountId: null, discoveryRegion: null });
    expect(format(context)).toMatch(/scope\.connected_account_id: unknown/);
  });
});
