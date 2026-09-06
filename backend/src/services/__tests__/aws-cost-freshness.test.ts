/**
 * Coverage for the cost-freshness metadata added to AWSCostService's shared,
 * per-org Cost Explorer cache: MonthlyCost.fetchedAt now carries the moment
 * a real Cost Explorer call actually succeeded, and cache hits must return
 * that ORIGINAL timestamp, never the current request's own time.
 *
 * STS and Cost Explorer are both mocked (module-level, same pattern as
 * aws-connection-funnel-event.test.ts) so no real AWS call is ever made;
 * aws_accounts and organizations are real Postgres rows, same as every
 * other repository test in this backend.
 *
 * The last test in this file is the explicit regression check requested
 * before landing this change: `awsCostService.fetchMonthlyCosts()` is a
 * shared singleton also consumed directly by stats.controller.ts's
 * getDashboardStats() (and, by the same destructuring pattern, by
 * infrastructure.controller.ts, aws.routes.ts, system-intelligence.service.ts,
 * and cloudwatch.service.ts -- confirmed structurally compatible via
 * `tsc --noEmit`, since MonthlyCost.fetchedAt is additive/optional). This
 * test proves at runtime, not just at the type level, that a second real
 * consumer of the exact same cache entry is unaffected by the new field.
 */
import { Pool } from 'pg';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({
      Credentials: { AccessKeyId: 'AKIATEST', SecretAccessKey: 'secret', SessionToken: 'token' },
    }),
  })),
  AssumeRoleCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

jest.mock('@aws-sdk/client-cost-explorer', () => {
  const actual = jest.requireActual('@aws-sdk/client-cost-explorer');
  return {
    ...actual,
    CostExplorerClient: jest.fn().mockImplementation(() => ({
      send: (...args: unknown[]) => mockSend(...args),
    })),
  };
});

import awsCostService from '../aws-cost.service';
import { StatsController } from '../../controllers/stats.controller';

const statsController = new StatsController();

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

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function randomAccountId(): string {
  return Math.floor(Math.random() * 1e12).toString().padStart(12, '0');
}

async function insertOrgWithAwsAccount(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'starter', 'active') RETURNING id`,
    [`Cost Freshness Org ${suffix}`, `cost-freshness-org-${suffix}`, `Cost Freshness Org ${suffix}`]
  );
  const orgId = rows[0].id as string;
  createdOrgIds.push(orgId);
  await pool.query(
    `INSERT INTO aws_accounts (account_id, role_arn, status, external_id, region, org_id)
     VALUES ($1, 'arn:aws:iam::123456789012:role/DevControlTest', 'active', 'ext-id-test', 'us-east-1', $2)`,
    [randomAccountId(), orgId]
  );
  return orgId;
}

function costExplorerResponse(service: string, amount: string) {
  return {
    ResultsByTime: [{ Groups: [{ Keys: [service], Metrics: { UnblendedCost: { Amount: amount } } }] }],
  };
}

function mockReqRes(organizationId: string) {
  const req = { user: { organizationId } } as any;
  const json = jest.fn();
  const res = { json } as any;
  return { req, res, json };
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

beforeEach(() => {
  mockSend.mockReset();
});

describe('AWSCostService cost-freshness metadata', () => {
  it('cache miss: fetches live Cost Explorer data and records a fetchedAt within this call\'s own window', async () => {
    const orgId = await insertOrgWithAwsAccount();
    mockSend.mockResolvedValueOnce(costExplorerResponse('Amazon Elastic Compute Cloud - Compute', '123.45'));

    const before = Date.now();
    const result = await awsCostService.fetchMonthlyCosts(orgId);
    const after = Date.now();

    expect(result.total).toBeCloseTo(123.45, 2);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(result.fetchedAt).toBeDefined();
    const fetchedAtMs = new Date(result.fetchedAt!).getTime();
    expect(fetchedAtMs).toBeGreaterThanOrEqual(before);
    expect(fetchedAtMs).toBeLessThanOrEqual(after);
  });

  it('cache hit: returns the ORIGINAL fetchedAt, not the current request time, and does not re-call Cost Explorer', async () => {
    const orgId = await insertOrgWithAwsAccount();
    mockSend.mockResolvedValueOnce(costExplorerResponse('Amazon Simple Storage Service', '10.00'));

    const first = await awsCostService.fetchMonthlyCosts(orgId);
    await new Promise((r) => setTimeout(r, 25));
    const second = await awsCostService.fetchMonthlyCosts(orgId); // served from cache -- TTL is 4h

    expect(second.total).toBe(first.total);
    expect(second.fetchedAt).toBe(first.fetchedAt); // exact same original timestamp, not re-stamped
    expect(mockSend).toHaveBeenCalledTimes(1); // Cost Explorer never called a second time
  });

  it('in-flight de-duplication is preserved: concurrent calls for the same org share one Cost Explorer request and one fetchedAt', async () => {
    const orgId = await insertOrgWithAwsAccount();
    let resolveResponse!: (v: unknown) => void;
    const pending = new Promise((resolve) => { resolveResponse = resolve; });
    mockSend.mockReturnValueOnce(pending);

    const p1 = awsCostService.fetchMonthlyCosts(orgId);
    const p2 = awsCostService.fetchMonthlyCosts(orgId);

    resolveResponse(costExplorerResponse('AWS Lambda', '5.00'));

    const [r1, r2] = await Promise.all([p1, p2]);
    expect(mockSend).toHaveBeenCalledTimes(1);
    expect(r1.fetchedAt).toBe(r2.fetchedAt);
  });

  it('regression: stats.controller.ts getDashboardStats() (a second, independent consumer of the same shared cache singleton) is unaffected by the new fetchedAt field', async () => {
    const orgId = await insertOrgWithAwsAccount();
    mockSend.mockResolvedValueOnce(costExplorerResponse('Amazon Relational Database Service', '77.00'));

    const { req, res, json } = mockReqRes(orgId);
    await statsController.getDashboardStats(req, res);

    expect(json).toHaveBeenCalledTimes(1);
    const body = json.mock.calls[0][0];
    expect(body.success).toBe(true);
    expect(body.data.total_infrastructure_cost).toBeCloseTo(77.0, 2);
    expect(body.data.cost_source).toBe('actual');
  });
});
