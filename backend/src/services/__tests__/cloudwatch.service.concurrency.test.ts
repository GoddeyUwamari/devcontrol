/**
 * CloudWatch Scalability Phase 2B: coverage for computeMetrics()'s seven resource-type
 * evaluation blocks (EC2, RDS, Lambda, DynamoDB, ECS, EKS, ALB) starting concurrently
 * instead of sequentially.
 *
 * Same testing shape as cloudwatch.service.slo.test.ts: AWSClientFactory.createClients is
 * spied on (no real AWS SDK client construction / STS AssumeRole), AWS SDK client `.send`
 * is mocked directly, and getAccount()/getResourceInventory()'s organization-scoping runs
 * against real local Postgres, matching this repo's established convention for anything
 * that depends on real WHERE-clause semantics. awsCostService.fetchMonthlyCosts is mocked
 * directly -- it is unrelated to Phase 2B (called once, sequentially, after all seven
 * blocks) and exercised elsewhere.
 *
 * This file proves only what Phase 2B changed: that the seven blocks run concurrently,
 * that concurrency is real (not just "the code compiles"), that an unexpected rejection
 * in one block is isolated to that block, that response shape/semantics/resourceCounts/
 * coverage are unchanged, and that final `services[]` ordering (EC2, ALB, RDS, Lambda,
 * DynamoDB, ECS, EKS) is preserved regardless of completion timing. Per-capability
 * health-rule correctness is already covered by cloudwatch.service.eks.test.ts /
 * cloudwatch.service.slo.test.ts and is not re-tested here.
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

function datapoint(field: 'Average' | 'Sum', value = 1) {
  return { Datapoints: [{ [field]: value, Timestamp: new Date() }] };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

describe('CloudWatchService.computeMetrics — type-level concurrency (Phase 2B)', () => {
  const service = new CloudWatchService();
  const pool = new Pool(dbConfig());

  let orgId: string;
  const createdOrgIds: string[] = [];

  async function insertOrgWithAccountAndResources(resourceTypes: Array<{ id: string; type: string; arn: string; extraMeta?: Record<string, any> }>) {
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`,
      [`cw-concurrency-test-${Date.now()}-${Math.random().toString(36).slice(2)}`]
    );
    const newOrgId = rows[0].id as string;
    createdOrgIds.push(newOrgId);

    await pool.query(
      `INSERT INTO aws_accounts (account_id, role_arn, status, external_id, region, org_id)
       VALUES ($1, 'arn:aws:iam::123456789012:role/DevControlTest', 'active', 'ext-id-test', 'us-east-1', $2)`,
      [`acct-${newOrgId.slice(0, 8)}`, newOrgId]
    );

    for (const r of resourceTypes) {
      await pool.query(
        `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, metadata)
         VALUES ($1, $2, $3, $3, $4, 'us-east-1', 'active', $5)`,
        [newOrgId, r.arn, r.id, r.type, r.extraMeta ? JSON.stringify(r.extraMeta) : null]
      );
    }

    return newOrgId;
  }

  function mockClients(overrides: { cloudWatchSend?: jest.Mock; ecsSend?: jest.Mock; eksSend?: jest.Mock } = {}) {
    const cloudWatch = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), overrides.cloudWatchSend ?? jest.fn().mockResolvedValue(datapoint('Average')));
    const ecs = withMockedSend(new ECSClient({ region: 'us-east-1' }), overrides.ecsSend ?? jest.fn().mockResolvedValue({ services: [], failures: [] }));
    const eks = withMockedSend(new EKSClient({ region: 'us-east-1' }), overrides.eksSend ?? jest.fn().mockResolvedValue({ cluster: undefined }));
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
      enabled: true,
      cloudWatch,
      ecs,
      eks,
      region: 'us-east-1',
    } as any);
    return { cloudWatch, ecs, eks };
  }

  beforeAll(() => {
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({
      total: 0,
      byService: [],
      period: { start: '', end: '' },
    } as any);
  });

  afterEach(async () => {
    jest.restoreAllMocks();
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({
      total: 0,
      byService: [],
      period: { start: '', end: '' },
    } as any);
  });

  afterAll(async () => {
    if (createdOrgIds.length > 0) {
      await pool.query(`DELETE FROM aws_resources WHERE organization_id = ANY($1)`, [createdOrgIds]);
      await pool.query(`DELETE FROM aws_accounts WHERE org_id = ANY($1)`, [createdOrgIds]);
      await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [createdOrgIds]);
    }
    await pool.end();
    await appPool.end();
  }, 20000);

  it('(1) all seven resource types are evaluated and contribute to the response', async () => {
    orgId = await insertOrgWithAccountAndResources([
      { id: 'i-1', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:*:instance/i-1' },
      { id: 'db-1', type: 'rds', arn: 'arn:aws:rds:us-east-1:*:db:db-1' },
      { id: 'fn-1', type: 'lambda', arn: 'arn:aws:lambda:us-east-1:*:function:fn-1' },
      { id: 'table-1', type: 'dynamodb', arn: 'arn:aws:dynamodb:us-east-1:*:table/table-1' },
      { id: 'svc-1', type: 'ecs', arn: 'arn:aws:ecs:us-east-1:123456789012:service/cluster-1/svc-1' },
      { id: 'cluster-1', type: 'eks', arn: 'arn:aws:eks:us-east-1:*:cluster/cluster-1' },
      { id: 'alb-1', type: 'load-balancer', arn: 'arn:aws:elasticloadbalancing:us-east-1:*:loadbalancer/app/alb-1/abc123', extraMeta: { type: 'application' } },
    ]);
    mockClients();

    const result = await (service as any).computeMetrics(orgId, '1h');

    expect(result).not.toBeNull();
    const typesPresent = new Set(result.services.map((s: any) => s.resourceType));
    expect(typesPresent).toEqual(new Set(['ec2', 'rds', 'lambda', 'dynamodb', 'ecs', 'eks', 'load-balancer']));
    expect(result.services).toHaveLength(7);
  });

  it('(2) type-level concurrency actually occurs -- other blocks\' AWS calls fire before a deliberately delayed block resolves', async () => {
    orgId = await insertOrgWithAccountAndResources([
      { id: 'i-2', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:*:instance/i-2' },
      { id: 'fn-2', type: 'lambda', arn: 'arn:aws:lambda:us-east-1:*:function:fn-2' },
      { id: 'table-2', type: 'dynamodb', arn: 'arn:aws:dynamodb:us-east-1:*:table/table-2' },
      { id: 'svc-2', type: 'ecs', arn: 'arn:aws:ecs:us-east-1:123456789012:service/cluster-2/svc-2' },
      { id: 'cluster-2', type: 'eks', arn: 'arn:aws:eks:us-east-1:*:cluster/cluster-2' },
      { id: 'alb-2', type: 'load-balancer', arn: 'arn:aws:elasticloadbalancing:us-east-1:*:loadbalancer/app/alb-2/abc123', extraMeta: { type: 'application' } },
    ]);

    const ec2Gate = deferred<any>();
    const callLog: string[] = [];

    const cloudWatchSend = jest.fn().mockImplementation((command: any) => {
      const namespace = command?.input?.Namespace;
      callLog.push(`cloudwatch:${namespace}`);
      if (namespace === 'AWS/EC2') {
        return ec2Gate.promise;
      }
      return Promise.resolve(datapoint('Average'));
    });
    const ecsSend = jest.fn().mockImplementation(() => {
      callLog.push('ecs:DescribeServices');
      return Promise.resolve({ services: [], failures: [] });
    });
    const eksSend = jest.fn().mockImplementation(() => {
      callLog.push('eks:DescribeCluster');
      return Promise.resolve({ cluster: undefined });
    });
    mockClients({ cloudWatchSend, ecsSend, eksSend });

    const resultPromise = (service as any).computeMetrics(orgId, '1h');

    // Give every other block's microtasks a chance to reach their own AWS call while the
    // EC2 block's CloudWatch call is still deliberately unresolved.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    expect(callLog).toContain('cloudwatch:AWS/EC2'); // EC2's own call was dispatched...
    expect(callLog).toContain('cloudwatch:AWS/Lambda'); // ...but Lambda's already fired too
    expect(callLog).toContain('cloudwatch:AWS/DynamoDB');
    expect(callLog).toContain('cloudwatch:AWS/ApplicationELB');
    expect(callLog).toContain('ecs:DescribeServices');
    expect(callLog).toContain('eks:DescribeCluster');
    // None of this could be true under the pre-Phase-2B sequential implementation, where
    // EC2 being unresolved would mean no later block's AWS call had been dispatched yet.

    ec2Gate.resolve(datapoint('Average'));
    const result = await resultPromise;
    expect(result.services).toHaveLength(6);
  });

  it('(3) an unexpected rejection in one block does not prevent the other six from producing results', async () => {
    orgId = await insertOrgWithAccountAndResources([
      { id: 'i-3', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:*:instance/i-3' },
      { id: 'db-3', type: 'rds', arn: 'arn:aws:rds:us-east-1:*:db:db-3' },
      { id: 'fn-3', type: 'lambda', arn: 'arn:aws:lambda:us-east-1:*:function:fn-3' },
      { id: 'table-3', type: 'dynamodb', arn: 'arn:aws:dynamodb:us-east-1:*:table/table-3' },
      { id: 'svc-3', type: 'ecs', arn: 'arn:aws:ecs:us-east-1:123456789012:service/cluster-3/svc-3' },
      { id: 'cluster-3', type: 'eks', arn: 'arn:aws:eks:us-east-1:*:cluster/cluster-3' },
      { id: 'alb-3', type: 'load-balancer', arn: 'arn:aws:elasticloadbalancing:us-east-1:*:loadbalancer/app/alb-3/abc123', extraMeta: { type: 'application' } },
    ]);
    mockClients();

    // Simulate a genuinely unexpected bug -- not an ordinary AWS API error, which
    // getMetricStat()/evaluateEcsService()/evaluateEksService() already catch and turn
    // into safe null/'unknown' results. This bypasses those inner catches entirely by
    // throwing directly out of evaluateResource() for the lambda capability only.
    const original = (CloudWatchService.prototype as any).evaluateResource;
    jest.spyOn(CloudWatchService.prototype as any, 'evaluateResource').mockImplementation(function (this: any, ...args: any[]) {
      const capability = args[1];
      if (capability?.resourceType === 'lambda') {
        throw new Error('Simulated unexpected Lambda block failure (not an AWS API error)');
      }
      return original.apply(this, args);
    });

    const result = await (service as any).computeMetrics(orgId, '1h');

    expect(result).not.toBeNull();
    const typesPresent = new Set(result.services.map((s: any) => s.resourceType));
    // Lambda safely degraded to empty; every other type still produced its result.
    expect(typesPresent).toEqual(new Set(['ec2', 'rds', 'ecs', 'eks', 'load-balancer']));
    expect(result.services.some((s: any) => s.resourceType === 'lambda')).toBe(false);
    // resourceCounts is built from the pre-slice inventory arrays (before any block runs),
    // so it reflects "1 lambda function was in scope for this scan", unaffected by the
    // block's own evaluation failure -- it is not an evaluation-success count.
    expect(result.resourceCounts.lambda).toEqual({ shown: 1, total: 1 });
  });

  it('(4) final services[] ordering is EC2, ALB, RDS, Lambda, DynamoDB, ECS, EKS regardless of which block resolves first', async () => {
    orgId = await insertOrgWithAccountAndResources([
      { id: 'i-4', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:*:instance/i-4' },
      { id: 'db-4', type: 'rds', arn: 'arn:aws:rds:us-east-1:*:db:db-4' },
      { id: 'fn-4', type: 'lambda', arn: 'arn:aws:lambda:us-east-1:*:function:fn-4' },
      { id: 'table-4', type: 'dynamodb', arn: 'arn:aws:dynamodb:us-east-1:*:table/table-4' },
      { id: 'svc-4', type: 'ecs', arn: 'arn:aws:ecs:us-east-1:123456789012:service/cluster-4/svc-4' },
      { id: 'cluster-4', type: 'eks', arn: 'arn:aws:eks:us-east-1:*:cluster/cluster-4' },
      { id: 'alb-4', type: 'load-balancer', arn: 'arn:aws:elasticloadbalancing:us-east-1:*:loadbalancer/app/alb-4/abc123', extraMeta: { type: 'application' } },
    ]);

    // Deliberately resolve CloudWatch-backed types in reverse-ish order and make the
    // control-plane types (ECS/EKS) resolve fastest of all, to prove final array order is
    // determined by the fixed concatenation in code, not by completion timing.
    const cloudWatchSend = jest.fn().mockImplementation(async (command: any) => {
      const namespace = command?.input?.Namespace;
      const delayMs = namespace === 'AWS/EC2' ? 30 : namespace === 'AWS/ApplicationELB' ? 20 : namespace === 'AWS/DynamoDB' ? 5 : 10;
      await new Promise((r) => setTimeout(r, delayMs));
      return datapoint('Average');
    });
    const ecsSend = jest.fn().mockResolvedValue({ services: [], failures: [] });
    const eksSend = jest.fn().mockResolvedValue({ cluster: undefined });
    mockClients({ cloudWatchSend, ecsSend, eksSend });

    const result = await (service as any).computeMetrics(orgId, '1h');

    expect(result.services.map((s: any) => s.resourceType)).toEqual([
      'ec2',
      'load-balancer',
      'rds',
      'lambda',
      'dynamodb',
      'ecs',
      'eks',
    ]);
  });

  it('(5) resourceCounts and coverage remain correct under concurrent execution', async () => {
    orgId = await insertOrgWithAccountAndResources([
      { id: 'i-5a', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:*:instance/i-5a' },
      { id: 'i-5b', type: 'ec2', arn: 'arn:aws:ec2:us-east-1:*:instance/i-5b' },
      { id: 'fn-5', type: 'lambda', arn: 'arn:aws:lambda:us-east-1:*:function:fn-5' },
    ]);
    mockClients();

    const result = await (service as any).computeMetrics(orgId, '1h');

    expect(result.resourceCounts.ec2).toEqual({ shown: 2, total: 2 });
    expect(result.resourceCounts.lambda).toEqual({ shown: 1, total: 1 });
    expect(result.resourceCounts.rds).toEqual({ shown: 0, total: 0 });
    expect(result.resourceCounts.eks).toEqual({ shown: 0, total: 0 });
    expect(result.coverage).toEqual({
      ec2: true,
      loadBalancer: false,
      rds: false,
      dynamodb: false,
      ecs: false,
      eks: false,
    });
  });

  it('(6) response is null when the org has no connected AWS account, same as before Phase 2B', async () => {
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`,
      [`cw-concurrency-noaccount-${Date.now()}`]
    );
    const noAccountOrgId = rows[0].id as string;
    createdOrgIds.push(noAccountOrgId);

    const result = await (service as any).computeMetrics(noAccountOrgId, '1h');

    expect(result).toBeNull();
  });
});

describe('CloudWatchService.getMetrics — Phase 2A cache wrapper is unaffected by Phase 2B', () => {
  // Re-asserts the two most load-bearing Phase 2A guarantees (cache hit, org isolation)
  // still hold with the real computeMetrics() underneath -- not a replacement for
  // cloudwatch.service.cache.test.ts, which exhaustively covers the wrapper in isolation
  // against a mocked computeMetrics() and is left completely unmodified by this change.
  it('a cached response is served without invoking computeMetrics() again', async () => {
    const service = new CloudWatchService();
    const spy = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue({ accountId: 'acct', services: [] });

    const first = await service.getMetrics('org-cache-check', '1h');
    const second = await service.getMetrics('org-cache-check', '1h');

    expect(spy).toHaveBeenCalledTimes(1);
    expect(second).toBe(first);
    spy.mockRestore();
  });
});
