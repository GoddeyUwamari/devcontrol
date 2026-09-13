/**
 * CloudWatch Scalability Phase 2D: coverage for the per-type evaluation cap removal
 * (ec2Instances.slice(0, 15), etc. -- now gone) and the new server-side
 * healthSummary/systemStatus complete-fleet aggregate in computeMetrics().
 *
 * Same testing shape as cloudwatch.service.concurrency.test.ts: AWSClientFactory.
 * createClients is spied (no real AWS SDK client construction), AWS SDK client `.send`
 * is mocked directly, and getAccount()/getResourceInventory() run against real local
 * Postgres, matching this repo's established convention for anything depending on real
 * WHERE-clause/ORDER BY semantics -- which matters here specifically, since this file
 * also exercises the new `id ASC` ORDER BY tiebreaker against real duplicate/null
 * resource_name rows.
 *
 * Deliberately NOT re-tested here (already covered elsewhere, unaffected by this phase):
 * seven-block concurrency and failure isolation (cloudwatch.service.concurrency.test.ts),
 * GetMetricData batching/chunking/NextToken mechanics (cloudwatch-metric-batch.util.test.ts),
 * per-capability health-rule correctness (cloudwatch.service.eks.test.ts /
 * cloudwatch.service.slo.test.ts), the 45s response cache itself
 * (cloudwatch.service.cache.test.ts). Pure pagination-slicing/cursor mechanics are covered
 * in isolation in cloudwatch-pagination.util.test.ts.
 */

import { Pool } from 'pg';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { ECSClient } from '@aws-sdk/client-ecs';
import { EKSClient } from '@aws-sdk/client-eks';
import { CloudWatchService } from '../cloudwatch.service';
import { AWSClientFactory } from '../aws-client-factory.service';
import awsCostService from '../aws-cost.service';
import { pool as appPool } from '../../config/database';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

// Mirrors cloudwatch.service.concurrency.test.ts's own echo mock: every submitted
// GetMetricData query id comes back with one Complete datapoint of `value`, matching how
// a real GetMetricData response is keyed (one MetricDataResult per MetricDataQuery, by
// Id) regardless of how many queries/chunks a large fleet produces.
function metricDataEcho(value = 1) {
  return async (command: any) => {
    const queries = command?.input?.MetricDataQueries ?? [];
    return {
      MetricDataResults: queries.map((q: any) => ({ Id: q.Id, StatusCode: 'Complete', Timestamps: [new Date()], Values: [value] })),
    };
  };
}

describe('CloudWatchService.computeMetrics — fleet completeness & server-side aggregate health (Phase 2D)', () => {
  const service = new CloudWatchService();
  const pool = new Pool(dbConfig());

  const createdOrgIds: string[] = [];
  const fixtureTablesCreated: string[] = [];

  async function tableExists(tableName: string): Promise<boolean> {
    const { rows } = await pool.query('SELECT to_regclass($1) AS reg', [`public.${tableName}`]);
    return rows[0].reg !== null;
  }

  // Verbatim from cloudwatch.service.concurrency.test.ts -- see that file's comment for
  // why aws_accounts needs manual reconstruction in this sandbox.
  async function ensureFixtureSchema(): Promise<void> {
    if (!(await tableExists('aws_accounts'))) {
      await pool.query(`
        CREATE TABLE aws_accounts (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          org_id UUID NOT NULL,
          role_arn TEXT NOT NULL,
          account_id VARCHAR(32) NOT NULL,
          nickname VARCHAR(255),
          external_id VARCHAR(64),
          region VARCHAR(32) DEFAULT 'us-east-1',
          connected_at TIMESTAMPTZ,
          status VARCHAR(32),
          CONSTRAINT aws_accounts_org_id_key UNIQUE (org_id),
          CONSTRAINT aws_accounts_account_id_key UNIQUE (account_id)
        )
      `);
      fixtureTablesCreated.push('aws_accounts');
    }
  }

  async function insertOrgWithAccount(): Promise<string> {
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`,
      [`cw-fleet-test-${Date.now()}-${Math.random().toString(36).slice(2)}`]
    );
    const orgId = rows[0].id as string;
    createdOrgIds.push(orgId);
    await pool.query(
      `INSERT INTO aws_accounts (account_id, role_arn, status, external_id, region, org_id)
       VALUES ($1, 'arn:aws:iam::123456789012:role/DevControlTest', 'active', 'ext-id-test', 'us-east-1', $2)`,
      [`acct-${orgId.slice(0, 8)}`, orgId]
    );
    return orgId;
  }

  async function insertResources(
    orgId: string,
    resources: Array<{ id: string; type: string; arn: string; name?: string | null; extraMeta?: Record<string, any> }>
  ) {
    for (const r of resources) {
      await pool.query(
        `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, metadata)
         VALUES ($1, $2, $3, $4, $5, 'us-east-1', 'active', $6)`,
        [orgId, r.arn, r.id, r.name === undefined ? r.id : r.name, r.type, r.extraMeta ? JSON.stringify(r.extraMeta) : null]
      );
    }
  }

  function mockClients(overrides: { cloudWatchSend?: jest.Mock; ecsSend?: jest.Mock; eksSend?: jest.Mock } = {}) {
    const cloudWatch = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), overrides.cloudWatchSend ?? jest.fn().mockImplementation(metricDataEcho()));
    const ecs = withMockedSend(new ECSClient({ region: 'us-east-1' }), overrides.ecsSend ?? jest.fn().mockResolvedValue({ services: [], failures: [] }));
    const eks = withMockedSend(new EKSClient({ region: 'us-east-1' }), overrides.eksSend ?? jest.fn().mockResolvedValue({ cluster: undefined }));
    jest.spyOn(AWSClientFactory, 'createClients').mockImplementation(async () => ({
      enabled: true,
      cloudWatch,
      ecs,
      eks,
      region: 'us-east-1',
    } as any));
    return { cloudWatch, ecs, eks };
  }

  beforeAll(async () => {
    await ensureFixtureSchema();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 0, byService: [], period: { start: '', end: '' } } as any);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 0, byService: [], period: { start: '', end: '' } } as any);
  });

  afterAll(async () => {
    if (createdOrgIds.length > 0) {
      await pool.query(`DELETE FROM aws_resources WHERE organization_id = ANY($1)`, [createdOrgIds]);
      await pool.query(`DELETE FROM aws_accounts WHERE org_id = ANY($1)`, [createdOrgIds]);
      await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [createdOrgIds]);
    }
    if (fixtureTablesCreated.includes('aws_accounts')) {
      await pool.query('DROP TABLE IF EXISTS aws_accounts');
    }
    await pool.end();
    await appPool.end();
  }, 20000);

  it('(1) full-fleet evaluation: every EC2/RDS/Lambda/DynamoDB/ECS/EKS instance beyond the former 15-cap, and every ALB beyond the former 5-cap, is evaluated and returned', async () => {
    const orgId = await insertOrgWithAccount();
    const makeMany = (type: string, count: number, arnFn: (i: number) => string) =>
      Array.from({ length: count }, (_, i) => ({ id: `${type}-${i}`, type, arn: arnFn(i), name: `${type}-${i}` }));

    const resources = [
      ...makeMany('ec2', 20, (i) => `arn:aws:ec2:us-east-1:*:instance/ec2-${i}`),
      ...makeMany('rds', 20, (i) => `arn:aws:rds:us-east-1:*:db:rds-${i}`),
      ...makeMany('lambda', 20, (i) => `arn:aws:lambda:us-east-1:*:function:lambda-${i}`),
      ...makeMany('dynamodb', 20, (i) => `arn:aws:dynamodb:us-east-1:*:table/dynamodb-${i}`),
      ...makeMany('ecs', 20, (i) => `arn:aws:ecs:us-east-1:123456789012:service/cluster-x/ecs-${i}`),
      ...makeMany('eks', 20, (i) => `arn:aws:eks:us-east-1:*:cluster/eks-${i}`),
      ...Array.from({ length: 8 }, (_, i) => ({
        id: `alb-${i}`,
        type: 'load-balancer',
        arn: `arn:aws:elasticloadbalancing:us-east-1:*:loadbalancer/app/alb-${i}/abc${i}`,
        name: `alb-${i}`,
        extraMeta: { type: 'application' },
      })),
    ];
    await insertResources(orgId, resources);
    mockClients();

    const result = await (service as any).computeMetrics(orgId, '1h');

    expect(result).not.toBeNull();
    const countByType = (t: string) => result.services.filter((s: any) => s.resourceType === t).length;
    expect(countByType('ec2')).toBe(20);
    expect(countByType('rds')).toBe(20);
    expect(countByType('lambda')).toBe(20);
    expect(countByType('dynamodb')).toBe(20);
    expect(countByType('ecs')).toBe(20);
    expect(countByType('eks')).toBe(20);
    expect(countByType('load-balancer')).toBe(8);
    expect(result.services).toHaveLength(20 * 6 + 8);
    // resourceCounts is the complete discovered inventory -- shown === total now that
    // evaluation is uncapped, for every type.
    expect(result.resourceCounts.ec2).toEqual({ shown: 20, total: 20 });
    expect(result.resourceCounts.loadBalancer).toEqual({ shown: 8, total: 8 });
  });

  it('(2) healthSummary is computed from the COMPLETE fleet, and resources beyond the former 15-instance cap affect it', async () => {
    const orgId = await insertOrgWithAccount();
    // 20 EC2 instances: the 16th-20th (beyond the old cap of 15) are 'stopped', which
    // ec2Capability.healthRule() maps to status 'down' -- this only proves complete-fleet
    // evaluation if those specific instances are actually evaluated and counted.
    const resources = Array.from({ length: 20 }, (_, i) => ({
      id: `ec2-${i}`,
      type: 'ec2',
      arn: `arn:aws:ec2:us-east-1:*:instance/ec2-${i}`,
      name: `ec2-${i}`,
    }));
    await insertResources(orgId, resources);

    // Instances index 15-19 (the 5 beyond the old cap) are set to 'stopped' directly in
    // aws_resources.status after insertion, since insertResources() always inserts
    // 'active'.
    await pool.query(
      `UPDATE aws_resources SET status = 'stopped' WHERE organization_id = $1 AND resource_id = ANY($2)`,
      [orgId, ['ec2-15', 'ec2-16', 'ec2-17', 'ec2-18', 'ec2-19']]
    );

    mockClients();
    const result = await (service as any).computeMetrics(orgId, '1h');

    expect(result.services).toHaveLength(20);
    expect(result.healthSummary.total).toBe(20);
    expect(result.healthSummary.monitored).toBe(20); // ec2Capability always sets monitored: true when instance.status is stopped (down branch), or via uptime/cpu otherwise
    expect(result.healthSummary.down).toBe(5); // the 5 stopped instances beyond the old cap
    expect(result.healthSummary.healthy + result.healthSummary.degraded + result.healthSummary.critical + result.healthSummary.down).toBe(result.healthSummary.monitored);
  });

  it('(3) systemStatus reflects a down resource that exists only beyond the former evaluation cap', async () => {
    const orgId = await insertOrgWithAccount();
    const resources = Array.from({ length: 18 }, (_, i) => ({
      id: `ec2-${i}`,
      type: 'ec2',
      arn: `arn:aws:ec2:us-east-1:*:instance/ec2-${i}`,
      name: `ec2-${i}`,
    }));
    await insertResources(orgId, resources);
    // Only the 17th instance (index 16, beyond the old 15-cap) is stopped.
    await pool.query(`UPDATE aws_resources SET status = 'stopped' WHERE organization_id = $1 AND resource_id = $2`, [orgId, 'ec2-16']);

    mockClients();
    const result = await (service as any).computeMetrics(orgId, '1h');

    expect(result.systemStatus).toBe('down');
    expect(result.healthSummary.down).toBe(1);
  });

  it('(4) aggregate vs page separation: healthSummary/systemStatus are not derived from services.length -- computeMetrics() itself returns the complete fleet with no re-cap, independent of how a caller later paginates it', async () => {
    const orgId = await insertOrgWithAccount();
    const resources = Array.from({ length: 30 }, (_, i) => ({
      id: `ec2-${i}`,
      type: 'ec2',
      arn: `arn:aws:ec2:us-east-1:*:instance/ec2-${i}`,
      name: `ec2-${i}`,
    }));
    await insertResources(orgId, resources);
    mockClients();

    const result = await (service as any).computeMetrics(orgId, '1h');

    // The full 30 are present in `services` (computeMetrics() never re-applies a cap) --
    // healthSummary.total counts the SAME complete set, not a slice of it. This is the
    // property that makes downstream pagination (applied only in the route layer) safe:
    // it slices `services` for display without ever touching healthSummary/systemStatus.
    expect(result.services).toHaveLength(30);
    expect(result.healthSummary.total).toBe(30);
  });

  it('(5) ALB is uncapped: more than 5 ALBs are all evaluated, and the busiest ALB beyond the former first-5 is correctly selected as primary for the response-time chart', async () => {
    const orgId = await insertOrgWithAccount();
    const albs = Array.from({ length: 8 }, (_, i) => ({
      id: `alb-${i}`,
      type: 'load-balancer',
      arn: `arn:aws:elasticloadbalancing:us-east-1:*:loadbalancer/app/alb-${i}/abc${i}`,
      // Named so plain alphabetical order puts alb-7 (the busiest, see below) OUTSIDE the
      // old first-5-by-name cap.
      name: `alb-${i}`,
      extraMeta: { type: 'application' },
    }));
    await insertResources(orgId, albs);

    // alb-7 (index 7, the 8th by name -- well beyond the old cap of 5) gets by far the
    // highest RequestCount; every other ALB gets a small, equal value. The busiest-ALB
    // selection (`primary` in computeMetrics()'s albTask) must pick alb-7's current-window
    // latency series for the response-time chart, which is only possible if alb-7 was
    // actually evaluated at all.
    const cloudWatchSend = jest.fn().mockImplementation(async (command: any) => {
      const queries = command?.input?.MetricDataQueries ?? [];
      return {
        MetricDataResults: queries.map((q: any) => {
          const isRequestSum = String(q.Id).includes('_1'); // requestSum is metricIndex 1 in loadBalancerCapability.metrics
          const isAlb7 = String(q.Id).startsWith('alb7_');
          const value = isRequestSum ? (isAlb7 ? 100000 : 1) : isAlb7 ? 0.777 : 0.001; // distinct latency for alb-7 so the chart series is identifiable
          return { Id: q.Id, StatusCode: 'Complete', Timestamps: [new Date()], Values: [value] };
        }),
      };
    });
    mockClients({ cloudWatchSend });

    const result = await (service as any).computeMetrics(orgId, '1h');

    const albServices = result.services.filter((s: any) => s.resourceType === 'load-balancer');
    expect(albServices).toHaveLength(8);
    // The primary/busiest ALB's response-time series drives responseTimeHistory -- with
    // alb-7 at ~777ms and every other ALB at ~1ms, a chart point near 777ms proves alb-7
    // (beyond the old 5-cap) was correctly selected as primary.
    expect(result.responseTimeHistory.length).toBeGreaterThan(0);
    expect(result.responseTimeHistory.some((p: any) => p.value > 500)).toBe(true);
  });

  it('(6) deterministic ordering survives real Postgres duplicate and null resource_name rows: type -> resource_name ASC NULLS LAST -> id ASC', async () => {
    const orgId = await insertOrgWithAccount();
    // Two EC2 rows share a resource_name; one EC2 row has a null resource_name (must sort
    // last within the ec2 bucket, before the ALB bucket starts).
    await insertResources(orgId, [
      { id: 'ec2-dup-a', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:*:instance/ec2-dup-a', name: 'shared-name' },
      { id: 'ec2-dup-b', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:*:instance/ec2-dup-b', name: 'shared-name' },
      { id: 'ec2-null', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:*:instance/ec2-null', name: null },
      { id: 'ec2-aaa', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:*:instance/ec2-aaa', name: 'aaa-first' },
    ]);
    mockClients();

    const result = await (service as any).computeMetrics(orgId, '1h');
    const ec2Ids = result.services.filter((s: any) => s.resourceType === 'ec2').map((s: any) => s.resourceId);

    // 'aaa-first' sorts before 'shared-name' (both non-null); the two 'shared-name' rows
    // are ordered by their underlying DB id (not asserted numerically here since ids are
    // real UUIDs -- only that both appear, adjacently, before the null-named row); the
    // null-named row sorts last.
    expect(ec2Ids[0]).toBe('ec2-aaa');
    expect(new Set(ec2Ids.slice(1, 3))).toEqual(new Set(['ec2-dup-a', 'ec2-dup-b']));
    expect(ec2Ids[3]).toBe('ec2-null');
  });

  it('(7) SLO regression: evaluateResourceForSlo() is unaffected by the evaluation-cap removal -- it never applied a cap and does not use healthSummary/pagination', async () => {
    const orgId = await insertOrgWithAccount();
    await insertResources(orgId, [{ id: 'ec2-slo', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:*:instance/ec2-slo', name: 'ec2-slo' }]);
    mockClients();

    const observation = await service.evaluateResourceForSlo(orgId, 'ec2', 'ec2-slo', '24h');

    expect(observation).not.toBeNull();
    expect(observation!.resourceExists).toBe(true);
    expect(observation).not.toHaveProperty('healthSummary');
    expect(observation).not.toHaveProperty('pagination');
  });
});
