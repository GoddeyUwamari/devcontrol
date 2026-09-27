/**
 * Ask AI executor (nl-query-executor.service.ts) with a recording fake pool
 * and a mocked cost context: SQL placeholders vs bindings, outcome states
 * (answered / no_results / unavailable / not_supported / error), and cost
 * provenance. The live-DB counterpart (nl-query-executor.live.test.ts)
 * proves the SQL runs against the real schema and stays tenant-scoped.
 */
const mockGatherCostContext = jest.fn();
jest.mock('../../repositories/ai-chat-context.repository', () => ({
  AIChatContextRepository: jest.fn().mockImplementation(() => ({ gatherCostContext: mockGatherCostContext })),
}));

import { Pool } from 'pg';
import { NLQueryExecutorService } from '../nl-query-executor.service';
import type { NLQueryIntent } from '../nl-query.service';

const ORG = '11111111-1111-4111-8111-111111111111';

const intent = (target: string, filters?: Record<string, unknown>): NLQueryIntent =>
  ({ target, action: 'filter', filters, explanation: 'MODEL-WRITTEN TEXT', confidence: 'high' } as unknown as NLQueryIntent);

type Responder = (sql: string, params: unknown[]) => { rows: any[] } | Error;

function fakePool(respond: Responder) {
  const calls: Array<{ sql: string; params: unknown[] }> = [];
  const query = jest.fn(async (sql: string, params: unknown[] = []) => {
    calls.push({ sql, params });
    const r = respond(sql, params);
    if (r instanceof Error) throw r;
    return r;
  });
  return { pool: { query } as unknown as Pool, calls };
}

/** Every $n in the SQL is bound, and every bound value is referenced. */
function expectPlaceholdersMatchBindings(sql: string, params: unknown[]) {
  const used = new Set((sql.match(/\$(\d+)/g) ?? []).map(m => Number(m.slice(1))));
  const max = used.size ? Math.max(...used) : 0;
  expect(max).toBe(params.length);
  for (let i = 1; i <= params.length; i++) expect(used.has(i)).toBe(true);
  // No bare numeric comparison left behind by a missing "$" (the old `status = 2` bug).
  expect(sql).not.toMatch(/=\s*\d+\b(?!\s*\))/);
}

/** A ChatContext['costs'] fixture -- only the fields spendSection() reads. */
function costs(overrides: Record<string, unknown>) {
  return {
    costs: {
      state: 'available',
      source: 'actual',
      current: 0,
      asOf: '2026-09-27T08:00:00.000Z',
      period: { start: '2026-09-01', endExclusive: '2026-09-28' },
      scope: { kind: 'cost_explorer', connectedAccountId: null, linkedAccountFilter: 'none', consolidatedBilling: 'unknown', regions: 'all' },
      topSpenders: [],
      costExplorer: { state: 'available', reason: null },
      estimateCoverage: null,
      comparison: { state: 'unavailable' },
      ...overrides,
    },
  };
}

beforeEach(() => {
  mockGatherCostContext.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

describe('placeholders equal bindings for every supported filter', () => {
  const cases: Array<[string, Record<string, unknown>]> = [
    ['infrastructure', {}],
    ['infrastructure', { resourceType: 'ec2' }],
    ['infrastructure', { status: 'stopped' }],
    ['infrastructure', { awsRegion: 'us-west-2' }],
    ['infrastructure', { costMin: 100 }],
    ['infrastructure', { costMax: 50 }],
    ['infrastructure', { encrypted: true }],
    ['infrastructure', { encrypted: false }],
    ['infrastructure', { hasBackup: false }],
    ['infrastructure', { publicAccess: true }],
    ['infrastructure', { resourceType: 'rds', status: 'running', awsRegion: 'us-east-1', costMin: 10, costMax: 900, encrypted: false, hasBackup: false, publicAccess: true }],
    ['services', {}],
    ['services', { status: 'failed' }],
    ['services', { template: 'api' }],
    ['services', { status: 'active', template: 'api' }],
    ['deployments', {}],
    ['deployments', { status: 'failed' }],
    ['deployments', { environment: 'production' }],
    ['deployments', { dateRange: '7d' }],
    ['deployments', { status: 'failed', environment: 'staging', dateRange: '90d' }],
  ];

  it.each(cases)('%s %j', async (target, filters) => {
    const { pool, calls } = fakePool(() => ({ rows: [{ total_matching: '1', estimated_monthly_cost: null, name: 'x' }] }));
    const result = await new NLQueryExecutorService(pool).execute(intent(target, filters), ORG);

    expect(result.data.outcome).toBe('answered');
    const main = calls[0];
    expectPlaceholdersMatchBindings(main.sql, main.params);
    // The organization is always the first binding, from the argument.
    expect(main.params[0]).toBe(ORG);
    expect(main.sql).toMatch(/organization_id = \$1/);
  });

  it('never interpolates a date range into SQL text', async () => {
    const { pool, calls } = fakePool(() => ({ rows: [] }));
    await new NLQueryExecutorService(pool).execute(intent('deployments', { dateRange: '30d' }), ORG);
    expect(calls[0].sql).not.toMatch(/INTERVAL '30/);
    expect(calls[0].params).toContain(30);
  });
});

describe('empty vs unavailable vs error', () => {
  it('successful query + zero rows over an existing inventory is no_results', async () => {
    const { pool } = fakePool(sql => (sql.includes('COUNT(*) AS count') ? { rows: [{ count: '12' }] } : { rows: [] }));
    const result = await new NLQueryExecutorService(pool).execute(intent('infrastructure', { resourceType: 'ec2' }), ORG);
    expect(result.data.outcome).toBe('no_results');
    expect(result.data.summary).toBe('No resources in your current inventory matched this query.');
    expect(result.data.evidence.state).toBe('available');
  });

  it('zero rows because nothing was ever discovered is unavailable, not "none"', async () => {
    const { pool } = fakePool(sql => (sql.includes('COUNT(*) AS count') ? { rows: [{ count: '0' }] } : { rows: [] }));
    const result = await new NLQueryExecutorService(pool).execute(intent('infrastructure', { resourceType: 'ec2' }), ORG);
    expect(result.data.outcome).toBe('unavailable');
    expect(result.data.summary).toMatch(/no resources have been discovered/);
    expect(result.data.summary).not.toMatch(/No resources .* matched/);
  });

  it.each(['infrastructure', 'services', 'deployments'])('a %s query failure is error with a sanitized message, never no_results', async target => {
    const { pool } = fakePool(() => new Error('column "secret_col" does not exist at host db-prod-1.internal'));
    const result = await new NLQueryExecutorService(pool).execute(intent(target), ORG);
    expect(result.data.outcome).toBe('error');
    expect(result.data.evidence.state).toBe('error');
    expect(result.data.rows).toEqual([]);
    expect(JSON.stringify(result)).not.toMatch(/secret_col|db-prod-1|does not exist/);
    expect(result.data.summary).toMatch(/could not be retrieved/);
    expect(result.data.summary).not.toMatch(/no data|no .* matched/i);
  });

  it('services and deployments with zero rows are no_results', async () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    const exec = new NLQueryExecutorService(pool);
    expect((await exec.execute(intent('services'), ORG)).data.outcome).toBe('no_results');
    expect((await exec.execute(intent('deployments'), ORG)).data.outcome).toBe('no_results');
  });

  it('an invalid or unsupported intent is not_supported and runs no query', async () => {
    const { pool, calls } = fakePool(() => ({ rows: [] }));
    const exec = new NLQueryExecutorService(pool);
    for (const bad of [intent('alerts', { severity: 'critical' }), intent('teams'), intent('infrastructure', { organization_id: 'other' })]) {
      const result = await exec.execute(bad, ORG);
      expect(result.data.outcome).toBe('not_supported');
    }
    expect(calls).toHaveLength(0);
  });
});

describe('the displayed explanation is never model-written', () => {
  it('uses the deterministic description of the validated intent', async () => {
    const { pool } = fakePool(() => ({ rows: [] }));
    const result = await new NLQueryExecutorService(pool).execute(intent('services', { status: 'failed' }), ORG);
    expect(result.intent.explanation).toBe('Services with status failed');
    expect(JSON.stringify(result)).not.toContain('MODEL-WRITTEN TEXT');
  });
});

describe('resource costs are labeled as inventory estimates', () => {
  it('never presents the estimate total as AWS billing', async () => {
    const { pool } = fakePool(() => ({
      rows: [
        { resource_name: 'a', estimated_monthly_cost: '120.50', total_matching: '40' },
        { resource_name: 'b', estimated_monthly_cost: null, total_matching: '40' },
      ],
    }));
    const result = await new NLQueryExecutorService(pool).execute(intent('infrastructure', { resourceType: 'ec2' }), ORG);
    expect(result.data.summary).toBe(
      'Showing 2 of 40 matching resources. Estimated monthly cost of the resources shown: $120.50/mo (DevControl list-price estimate, not AWS billing; 1 shown without an estimate).'
    );
    expect(result.data.columns).toContain('Est. Monthly Cost');
    expect(result.data.summary).not.toMatch(/Total cost/);
  });
});

describe('costs: the PR #135 evidence-aware cost path', () => {
  const run = async () => {
    const { pool, calls } = fakePool(() => ({ rows: [] }));
    const result = await new NLQueryExecutorService(pool).execute(intent('costs', undefined), ORG);
    return { result, calls };
  };

  it('uses gatherCostContext for the authenticated org and never aws_resources', async () => {
    mockGatherCostContext.mockResolvedValue(costs({ current: 1234.5 }));
    const { calls } = await run();
    expect(mockGatherCostContext).toHaveBeenCalledWith(ORG);
    expect(calls).toHaveLength(0);
  });

  it('actual $0 stays actual $0 -- answered, not "no data"', async () => {
    mockGatherCostContext.mockResolvedValue(costs({ current: 0 }));
    const { result } = await run();
    expect(result.data.outcome).toBe('answered');
    expect(result.data.evidence.provenance).toBe('actual');
    // asOf falls on the period's last day, so the in-progress day is disclosed.
    expect(result.data.summary).toBe(
      'AWS Cost Explorer month-to-date spend (2026-09-01 through 2026-09-27): $0.00. The current day is still being billed.'
    );
    expect(result.data.summary).not.toMatch(/no (cost )?data|not available/i);
  });

  it('a net-negative (credit) actual stays actual and is labeled', async () => {
    mockGatherCostContext.mockResolvedValue(costs({ current: -12.34 }));
    const { result } = await run();
    expect(result.data.evidence.provenance).toBe('actual');
    expect(result.data.summary).toContain('-$12.34 (net negative: credits and refunds exceed charges)');
  });

  it('a sub-dollar actual keeps its cents', async () => {
    mockGatherCostContext.mockResolvedValue(costs({ current: 0.42, topSpenders: [{ service: 'Amazon S3', cost: 0.42, percentage: 100 }] }));
    const { result } = await run();
    expect(result.data.summary).toContain(': $0.42.');
    expect(result.data.rows).toEqual([{ service: 'Amazon S3', month_to_date_spend: '$0.42', share: '100.0%' }]);
  });

  it('the inventory estimate is labeled estimated and never AWS billed spend', async () => {
    mockGatherCostContext.mockResolvedValue(costs({
      source: 'estimated', current: 812.2, period: null, topSpenders: null,
      scope: { kind: 'resource_inventory', connectedAccountId: null, discoveryRegion: 'us-east-1' },
      costExplorer: { state: 'unavailable', reason: 'no AWS account is connected' },
      estimateCoverage: { estimatedResources: 8, totalResources: 10 },
    }));
    const { result } = await run();
    expect(result.data.outcome).toBe('answered');
    expect(result.data.evidence.provenance).toBe('estimated');
    expect(result.data.summary).toContain('AWS Cost Explorer billing data is not available for this organization.');
    expect(result.data.summary).toContain('Inventory-derived estimated monthly run-rate: approximately $812.20/month');
    expect(result.data.summary).toContain('not AWS billed spend');
    expect(result.data.summary).toContain('Only 8 of 10 discovered resources have a cost estimate.');
  });

  it('no billing data and no estimate is unavailable -- never $0', async () => {
    mockGatherCostContext.mockResolvedValue(costs({
      state: 'unavailable', source: 'unavailable', current: null, period: null, topSpenders: null, scope: null,
      costExplorer: { state: 'unavailable', reason: 'no AWS account is connected' },
    }));
    const { result } = await run();
    expect(result.data.outcome).toBe('unavailable');
    expect(result.data.summary).toMatch(/Cost data is not available/);
    expect(result.data.summary).toMatch(/not a \$0 spend/);
    expect(result.data.summary).not.toMatch(/: \$0/);
  });

  it('a cost context failure is error, sanitized -- never $0 or empty', async () => {
    mockGatherCostContext.mockRejectedValue(new Error('AccessDeniedException: arn:aws:iam::123456789012:role/x'));
    const { result } = await run();
    expect(result.data.outcome).toBe('error');
    expect(JSON.stringify(result)).not.toMatch(/AccessDenied|arn:aws|123456789012/);
    expect(result.data.summary).toBe('Cost data could not be retrieved. Please try again.');
  });
});
