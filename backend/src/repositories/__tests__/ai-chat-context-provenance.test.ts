/**
 * Coverage for AIChatContextRepository's cost-provenance and discovery-
 * freshness metadata: gatherContext() must distinguish actual/estimated/
 * unavailable cost data (mirroring stats.controller.ts's own Dashboard
 * fallback logic, not a new definition), and must surface the latest
 * *completed* discovery run's timestamp -- never a fabricated one, and
 * never one taken from a still-running or failed job.
 *
 * awsCostService.fetchMonthlyCosts/fetchCostTrend are mocked (no real AWS
 * call); aws_resources and resource_discovery_jobs rows are real Postgres,
 * same pattern as every other repository test in this backend.
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
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'starter', 'active') RETURNING id`,
    [`Context Provenance Org ${suffix}`, `context-provenance-org-${suffix}`, `Context Provenance Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertDiscoveryJob(
  organizationId: string,
  status: 'completed' | 'running' | 'failed',
  completedAt: Date | null
): Promise<void> {
  await pool.query(
    `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, completed_at, resource_types, regions)
     VALUES ($1, $2, NOW(), $3, ARRAY['ec2'], ARRAY['us-east-1'])`,
    [organizationId, status, completedAt]
  );
}

async function insertAwsResourceWithEstimate(organizationId: string, estimatedMonthlyCost: number): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, estimated_monthly_cost)
     VALUES ($1, $2, $3, 'ec2', 'us-east-1', 'running', $4)`,
    [organizationId, `arn:aws:ec2:us-east-1:123456789012:instance/i-${uniqueSuffix()}`, `i-${uniqueSuffix()}`, estimatedMonthlyCost]
  );
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM resource_discovery_jobs WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('AIChatContextRepository -- discovery freshness', () => {
  it('a completed discovery job\'s completed_at is surfaced as the discovery section\'s data and asOf', async () => {
    const orgId = await insertOrg();
    const completedAt = new Date('2026-09-06T05:00:00.000Z');
    await insertDiscoveryJob(orgId, 'completed', completedAt);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.discovery.state).toBe('available');
    expect(context.discovery.data?.completedAt).toBe(completedAt.toISOString());
    expect(context.discovery.asOf).toBe(completedAt.toISOString());
  });

  it('a still-running (not yet completed) job is "unavailable" with no timestamp', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'running', null);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.discovery.state).toBe('unavailable');
    expect(context.discovery.data).toBeNull();
    expect(context.discovery.asOf).toBeNull();
  });

  it('a failed job is "unavailable" with no timestamp', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'failed', null);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.discovery.state).toBe('unavailable');
    expect(context.discovery.data).toBeNull();
    expect(context.discovery.asOf).toBeNull();
  });

  it('no discovery job at all is "unavailable", never a fabricated timestamp', async () => {
    const orgId = await insertOrg();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.discovery.state).toBe('unavailable');
    expect(context.discovery.data).toBeNull();
    expect(context.discovery.asOf).toBeNull();
  });
});

describe('AIChatContextRepository -- cost provenance (actual / estimated / unavailable)', () => {
  it('a real positive Cost Explorer total is reported as source "actual" with its own fetchedAt', async () => {
    const orgId = await insertOrg();
    const fetchedAt = '2026-09-06T09:30:00.000Z';
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({
      total: 250.5,
      byService: [{ service: 'Amazon Elastic Compute Cloud - Compute', amount: 250.5 }],
      period: { start: '2026-09-01', end: '2026-09-07' },
      fetchedAt,
    });
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.state).toBe('available');
    expect(context.costs.source).toBe('actual');
    expect(context.costs.asOf).toBe(fetchedAt);
    expect(context.costs.current).toBe(250.5); // cents precision, never whole-dollar rounding
  });

  it('Cost Explorer failing, with a usable aws_resources estimate present, falls back to source "estimated" using discovery freshness as its asOf', async () => {
    const orgId = await insertOrg();
    const completedAt = new Date('2026-09-06T04:00:00.000Z');
    await insertDiscoveryJob(orgId, 'completed', completedAt);
    await insertAwsResourceWithEstimate(orgId, 42);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED: no account'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.state).toBe('available');
    expect(context.costs.source).toBe('estimated');
    expect(context.costs.current).toBe(42);
    expect(context.costs.asOf).toBe(completedAt.toISOString());
  });

  it('Cost Explorer failing AND no usable estimate produces source "unavailable" with a null figure -- never a bare $0 masquerading as confirmed spend', async () => {
    const orgId = await insertOrg();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED: no account'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.state).toBe('unavailable');
    expect(context.costs.source).toBe('unavailable');
    expect(context.costs.current).toBeNull();
    expect(context.costs.asOf).toBeNull();
  });

  // Deliberately inverted from the prior rule ("total > 0 is the only condition
  // that counts as 'actual'", mirroring getDashboardStats()): a successful Cost
  // Explorer response of $0 is real billing data, and routing it into the
  // list-price estimate replaced a true $0 with a fabricated figure. The
  // Dashboard's own getMonthlySpendWithFallback() is unchanged.
  it('Cost Explorer returning a real zero total is actual billing data -- $0, state available, never replaced by an estimate', async () => {
    const orgId = await insertOrg();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({
      total: 0,
      byService: [],
      period: { start: '2026-09-01', end: '2026-09-07' },
      fetchedAt: '2026-09-06T09:30:00.000Z',
    });
    jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);

    await insertAwsResourceWithEstimate(orgId, 42); // an estimate exists, and must NOT be used

    const context = await contextRepo.gatherContext(orgId);

    expect(context.costs.state).toBe('available');
    expect(context.costs.source).toBe('actual');
    expect(context.costs.current).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// PR A: every non-cost section is a ContextSection whose state -- not an
// empty list, a 0, or a missing key -- says whether data was measured, is
// absent, failed, or has no source (services/ai-context-contract.ts).
// ---------------------------------------------------------------------------

const chatService = new AIChatService({} as Pool);
const INVENTORY_SCOPE = { kind: 'resource_inventory', connectedAccountId: null, discoveryRegion: 'us-east-1' };
const COMPLETED_AT = '2026-09-06T05:00:00.000Z';
const COMPLETED_DISCOVERY = {
  state: 'available', source: 'DevControl resource discovery runs', asOf: COMPLETED_AT,
  scope: null, coverage: null, reason: null, data: { completedAt: COMPLETED_AT },
};

async function insertResource(
  organizationId: string,
  resourceType: 'ec2' | 'rds',
  estimatedMonthlyCost: number | null,
  tags: Record<string, string> = {}
): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, estimated_monthly_cost, tags)
     VALUES ($1, $2, $3, $4, 'us-east-1', 'running', $5, $6)`,
    [organizationId, `arn:aws:${resourceType}:us-east-1:123456789012:r-${uniqueSuffix()}`, `r-${uniqueSuffix()}`, resourceType, estimatedMonthlyCost, JSON.stringify(tags)]
  );
}

/** gatherContext() with Cost Explorer not connected -- these tests are about the other sections. */
async function contextFor(orgId: string) {
  jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('AWS_NOT_CONNECTED'));
  jest.spyOn(awsCostService, 'fetchCostTrend').mockResolvedValue([]);
  return contextRepo.gatherContext(orgId);
}

function format(context: ChatContext): string {
  return (chatService as any).formatContext(context);
}

describe('Services section', () => {
  it('a completed discovery that found nothing is "available" with a real empty list', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'completed', new Date(COMPLETED_AT));

    const context = await contextFor(orgId);

    expect(context.services).toMatchObject({ state: 'available', data: [], asOf: COMPLETED_AT, source: 'DevControl resource inventory (periodic AWS discovery)' });
    expect(format(context)).toMatch(/types: none -- discovery completed and found no resources/);
  });

  it('with no completed discovery, an empty inventory is "unavailable" -- not a confirmed "none"', async () => {
    const orgId = await insertOrg();

    const context = await contextFor(orgId);

    expect(context.services).toMatchObject({ state: 'unavailable', data: null });
    expect(format(context)).not.toMatch(/No services detected|types: none/);
  });

  it('a failed query is "error" with data null -- never [] or "No services detected"', async () => {
    jest.spyOn(pool, 'query').mockRejectedValueOnce(new Error('relation "aws_resources" does not exist') as never);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const services = await (contextRepo as any).getServices('org-id', COMPLETED_DISCOVERY, INVENTORY_SCOPE);

    expect(services).toMatchObject({ state: 'error', data: null });
    expect(services.data).not.toEqual([]);
  });
});

describe('Resources section', () => {
  it('a genuine zero after a completed discovery is "available" with every count explicitly 0', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'completed', new Date(COMPLETED_AT));

    const context = await contextFor(orgId);
    const data = context.resources.data!;

    expect(context.resources.state).toBe('available');
    expect(data.ec2.count).toBe(0);
    expect(data.rds).toEqual({ count: 0, estimatedMonthlyCost: null, estimatedForCount: 0 });
    expect(data.lambda).toEqual({ count: 0, invocations: 0, invocationsKnownForCount: 0 });
    const formatted = format(context);
    expect(formatted).toMatch(/- EC2: 0 instances/);
    expect(formatted).toMatch(/- RDS: 0 databases/);
    expect(formatted).toMatch(/- Lambda: 0 functions/);
  });

  it('a failed query is "error" with data null -- never {} or "No resource data"', async () => {
    jest.spyOn(pool, 'query').mockRejectedValue(new Error('connection terminated') as never);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const resources = await (contextRepo as any).getResourceData('org-id', COMPLETED_DISCOVERY, INVENTORY_SCOPE);

    expect(resources).toMatchObject({ state: 'error', data: null });
    expect(resources.data).not.toEqual({});
  });

  it('EC2 utilization is "not_supported" -- a cpu_utilization tag is never read as a measurement, and "0 underutilized" is never stated', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'completed', new Date(COMPLETED_AT));
    await insertResource(orgId, 'ec2', null, { cpu_utilization: '5' });

    const context = await contextFor(orgId);
    const ec2 = context.resources.data!.ec2;

    expect(ec2.count).toBe(1);
    expect(ec2.utilization).toMatchObject({ state: 'not_supported', data: null });
    expect(ec2.utilization.reason).toMatch(/does not collect EC2 CPU utilization/);
    const formatted = format(context);
    expect(formatted).toMatch(/EC2 utilization: Not supported/);
    expect(formatted).not.toMatch(/\d+ underutilized|underutilized: \d/);
  });

  it('RDS cost is an explicitly estimated figure in cents over only the databases that carry an estimate -- not "storage cost"', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'completed', new Date(COMPLETED_AT));
    await insertResource(orgId, 'rds', 12.34);
    await insertResource(orgId, 'rds', 0.5);
    await insertResource(orgId, 'rds', null);

    const context = await contextFor(orgId);

    expect(context.resources.data!.rds).toEqual({ count: 3, estimatedMonthlyCost: 12.84, estimatedForCount: 2 });
    const formatted = format(context);
    expect(formatted).toMatch(/- RDS: 3 databases; DevControl estimated monthly cost \$12\.84 across the 2 of 3 databases with a stored estimate value \(list-price estimate for the whole database -- not AWS billed spend\)/);
    expect(formatted).not.toMatch(/storage cost/);
  });
});

describe('Alerts section', () => {
  it('is "not_supported" with a reason -- never a fabricated "0 active alerts" or "No recent incidents"', async () => {
    const orgId = await insertOrg();

    const context = await contextFor(orgId);

    expect(context.alerts).toMatchObject({ state: 'not_supported', data: null, source: 'DevControl alert history' });
    expect(context.alerts.reason).toMatch(/does not yet associate alerts with an organization/);
    const formatted = format(context);
    expect(formatted).not.toMatch(/active alerts: 0|Total active alerts|No recent incidents/i);
  });
});

describe('Anomalies section', () => {
  it('is "not_supported" even when resources meet the old cost_spike threshold -- those rows are never shown as anomalies', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'completed', new Date(COMPLETED_AT));
    // Two EC2 resources at $300 each: >$100 per resource and >$500 per type --
    // exactly what the former fixed-threshold query reported as a "cost_spike".
    await insertResource(orgId, 'ec2', 300);
    await insertResource(orgId, 'ec2', 300);

    const context = await contextFor(orgId);

    expect(context.anomalies).toEqual({
      state: 'not_supported', source: 'DevControl anomaly detection', asOf: null, scope: null,
      coverage: null, reason: "No anomaly detection is connected to the assistant's context.", data: null,
    });
    const formatted = format(context);
    expect(formatted).not.toMatch(/cost_spike|Detected Anomalies|resources with high spend/);
  });
});

describe('DORA section', () => {
  const METRICS = {
    deploymentFrequency: { value: 3.8, unit: 'per day', description: '114 deployments in 30 days' },
    leadTime: { value: 6.12, unit: 'hours', description: 'Average time between consecutive deployments' },
    mttr: { value: 71.35, unit: 'minutes', description: '1 incidents recovered' },
  };

  it('success is "available" with deployment-record provenance, a computed-at asOf, and an explicit 30-day organization scope', async () => {
    jest.spyOn((contextRepo as any).doraMetricsService, 'getComprehensiveMetrics').mockResolvedValue(METRICS);
    const before = Date.now();

    const dora = await (contextRepo as any).getDORAMetrics('org-id');

    expect(dora.state).toBe('available');
    expect(dora.source).toBe('DevControl deployment records');
    expect(dora.scope).toEqual({ kind: 'organization', window: 'last 30 days' });
    expect(dora.coverage).toMatch(/recorded in DevControl for this organization/);
    expect(Date.parse(dora.asOf)).toBeGreaterThanOrEqual(before - 1000);
    expect(dora.data.leadTime).toBe('6.12 hours (Average time between consecutive deployments)');
  });

  it('no deployments in the window is "unavailable" -- not an omitted section', async () => {
    jest.spyOn((contextRepo as any).doraMetricsService, 'getComprehensiveMetrics').mockResolvedValue({
      ...METRICS, deploymentFrequency: { value: 0, unit: 'per day', description: '0 deployments in 30 days' },
    });

    const dora = await (contextRepo as any).getDORAMetrics('org-id');

    expect(dora).toMatchObject({ state: 'unavailable', data: null, reason: 'no deployments were recorded for this organization in the last 30 days' });
  });

  it('a failed computation is "error" with data null -- not undefined', async () => {
    jest.spyOn((contextRepo as any).doraMetricsService, 'getComprehensiveMetrics').mockRejectedValue(new Error('deployments query failed'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const dora = await (contextRepo as any).getDORAMetrics('org-id');

    expect(dora).toBeDefined();
    expect(dora).toMatchObject({ state: 'error', data: null });
  });
});

describe('Connected account and discovery prerequisites', () => {
  it('a failed lookup is "error", distinguishable from "no account" / "never ran" ("unavailable")', async () => {
    const throwingPool = { query: jest.fn().mockRejectedValue(new Error('connection refused')) } as unknown as Pool;
    const repo = new AIChatContextRepository(throwingPool);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect((repo as any).getConnectedAccount('org-id')).resolves.toMatchObject({ state: 'error', data: null });
    await expect((repo as any).getDiscoveryFreshness('org-id')).resolves.toMatchObject({ state: 'error', data: null });

    // A lookup that succeeds with no rows. Stubbed rather than using the real
    // aws_accounts table, which the CI test schema does not create (see
    // stubConnectedAccount in ai-chat-cost-context-contract.test.ts).
    const emptyPool = { query: jest.fn().mockResolvedValue({ rows: [] }) } as unknown as Pool;
    const emptyRepo = new AIChatContextRepository(emptyPool);
    await expect((emptyRepo as any).getConnectedAccount('org-id')).resolves.toMatchObject({ state: 'unavailable', data: null, reason: 'no AWS account is connected' });
    await expect((emptyRepo as any).getDiscoveryFreshness('org-id')).resolves.toMatchObject({ state: 'unavailable', data: null, reason: 'no discovery run has ever run for this account' });
  });
});

describe('gatherContext() negative control: every getter throws', () => {
  it('every queried section is "error" with data null; nothing silently becomes zero, empty, or an estimate', async () => {
    const throwingPool = { query: jest.fn().mockRejectedValue(new Error('database unavailable')) } as unknown as Pool;
    const repo = new AIChatContextRepository(throwingPool);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(new Error('ThrottlingException'));
    jest.spyOn(awsCostService, 'fetchCostTrend').mockRejectedValue(new Error('ThrottlingException'));
    // DORA is not mocked: the real DORAMetricsService runs against the failing pool.
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    const context = await repo.gatherContext('org-id');

    for (const name of ['discovery', 'account', 'services', 'resources', 'dora'] as const) {
      expect({ name, state: context[name].state, data: context[name].data }).toEqual({ name, state: 'error', data: null });
    }
    // Alerts/anomalies have no source to fail -- not_supported, still no data.
    expect(context.alerts).toMatchObject({ state: 'not_supported', data: null });
    expect(context.anomalies).toMatchObject({ state: 'not_supported', data: null });
    // Cost stays an error: no Cost Explorer figure and no estimate -- never $0.
    expect(context.costs).toMatchObject({ state: 'error', source: 'unavailable', current: null, topSpenders: null });
    expect(context.costs.costExplorer.state).toBe('error');
    expect(context.costs.comparison.currentWindowTotal).toBeNull();

    const formatted = format(context);
    expect(formatted).not.toMatch(/\$0\.00|No services detected|active alerts: 0|No recent incidents|underutilized: \d|types: none|- EC2: 0/);
    expect(formatted.match(/Data: could not be retrieved/g)?.length).toBe(3); // services, resources, DORA
    expect(formatted).not.toMatch(/database unavailable/); // raw error text stays out of the prompt
  });
});

describe('Inventory freshness: completed vs incomplete vs unknown discovery', () => {
  it('a completed latest discovery run makes existing inventory "available" with that run as its asOf', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'completed', new Date(COMPLETED_AT));
    await insertResource(orgId, 'ec2', null);

    const context = await contextFor(orgId);

    expect(context.resources).toMatchObject({ state: 'available', asOf: COMPLETED_AT, reason: null });
    expect(context.services).toMatchObject({ state: 'available', asOf: COMPLETED_AT, data: ['ec2'] });
  });

  it('an incomplete latest discovery run keeps existing inventory as "partial" -- possibly stale, not an error and not "available"', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'running', null);
    await insertResource(orgId, 'ec2', null);

    const context = await contextFor(orgId);

    for (const section of [context.resources, context.services]) {
      expect(section.state).toBe('partial');
      expect(section.asOf).toBeNull();
      expect(section.reason).toBe('Latest discovery run is incomplete; inventory data may be stale or incomplete.');
      expect(section.data).not.toBeNull();
    }
    expect(context.resources.data!.ec2.count).toBe(1);

    const formatted = format(context);
    const inventory = formatted.slice(formatted.indexOf('Resource inventory ('), formatted.indexOf('Alerts & incidents'));
    expect(inventory).toMatch(/- Status: Partial/);
    expect(inventory).toMatch(/- Limitation: Latest discovery run is incomplete; inventory data may be stale or incomplete\./);
    expect(inventory).toMatch(/- EC2: 1 instances/);
    // Natural language only -- no raw state or field labels.
    expect(inventory).not.toMatch(/\bpartial\b|asOf|as_of|state:/);
  });

  it('a failed discovery lookup is "error" for discovery itself, and existing inventory is "partial" with unknown freshness', async () => {
    const orgId = await insertOrg();
    await insertResource(orgId, 'ec2', null);
    jest.spyOn((contextRepo as any).awsResourcesRepository, 'getLatestDiscoveryJob').mockRejectedValue(new Error('relation "resource_discovery_jobs" does not exist'));
    jest.spyOn(console, 'error').mockImplementation(() => undefined);

    const context = await contextFor(orgId);

    expect(context.discovery).toMatchObject({ state: 'error', data: null });
    expect(context.resources).toMatchObject({
      state: 'partial', asOf: null,
      reason: 'The status of the latest discovery run could not be determined; inventory data may be stale or incomplete.',
    });
    expect(format(context)).not.toMatch(/resource_discovery_jobs/);
  });

  it('no discovered inventory with no completed run stays "unavailable" (unchanged)', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'running', null);

    const context = await contextFor(orgId);

    expect(context.resources).toMatchObject({ state: 'unavailable', data: null });
    expect(context.services).toMatchObject({ state: 'unavailable', data: null });
  });
});

describe('RDS estimate of $0.00 (column default vs recorded zero)', () => {
  it('is never presented as a confirmed zero-cost estimate, because databases without an estimate are stored as $0.00', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'completed', new Date(COMPLETED_AT));
    // One database with an explicit $0 estimate, one relying on the column default (0.00).
    await insertResource(orgId, 'rds', 0);
    await pool.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status)
       VALUES ($1, $2, $3, 'rds', 'us-east-1', 'running')`,
      [orgId, `arn:aws:rds:us-east-1:123456789012:db:default-${uniqueSuffix()}`, `default-${uniqueSuffix()}`]
    );

    const context = await contextFor(orgId);

    // The two are indistinguishable in the data...
    expect(context.resources.data!.rds).toEqual({ count: 2, estimatedMonthlyCost: 0, estimatedForCount: 2 });
    // ...so the wording must not claim a measured $0.
    const formatted = format(context);
    expect(formatted).toMatch(/- RDS: 2 databases; DevControl estimated monthly cost \$0\.00 across the 2 of 2 databases with a stored estimate value \(list-price estimate for the whole database -- not AWS billed spend; a \$0\.00 total may mean no estimate was recorded, since databases without an estimate are stored as \$0\.00 by default -- do not present it as a confirmed zero cost\)/);
  });

  it('a non-zero estimate carries no zero-value caveat', async () => {
    const orgId = await insertOrg();
    await insertDiscoveryJob(orgId, 'completed', new Date(COMPLETED_AT));
    await insertResource(orgId, 'rds', 25);

    const formatted = format(await contextFor(orgId));

    expect(formatted).toMatch(/DevControl estimated monthly cost \$25\.00 across the 1 of 1 databases with a stored estimate value \(list-price estimate for the whole database -- not AWS billed spend\)/);
    expect(formatted).not.toMatch(/may mean no estimate was recorded/);
  });
});
