/**
 * CloudWatch Scalability Phase 2C: coverage for CloudWatchService.evaluateCapabilityBatch()
 * itself -- the orchestration layer between a capability's metric definitions and the
 * shared fetchMetricDataBatch() helper (unit-tested in isolation in
 * cloudwatch-metric-batch.util.test.ts). fetchMetricDataBatch() is mocked at the module
 * level here, so this file exercises only evaluateCapabilityBatch()'s own logic: building
 * deterministic per-resource-per-metric query Ids, splitting current-vs-previous-window
 * metrics into separate batches, dispatching them concurrently, mapping batch results back
 * onto each resource's `values` map, and invoking the SAME unmodified capability.healthRule()
 * evaluateResource() always has.
 *
 * Deliberately does not touch Postgres at all -- evaluateCapabilityBatch() makes zero
 * `pool.query()` calls (only getAccount()/getResourceInventory()/hasConnectedAccount() do,
 * none of which this file calls), so this suite runs independently of local database
 * availability, unlike cloudwatch.service.concurrency.test.ts's equivalent coverage through
 * the full computeMetrics() path.
 */
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CloudWatchService } from '../cloudwatch.service';
import { AWSClientFactory } from '../aws-client-factory.service';
import awsCostService from '../aws-cost.service';
import * as batchUtil from '../cloudwatch-metric-batch.util';

jest.mock('../cloudwatch-metric-batch.util', () => {
  const actual = jest.requireActual('../cloudwatch-metric-batch.util');
  return { ...actual, fetchMetricDataBatch: jest.fn() };
});

const fetchMetricDataBatch = batchUtil.fetchMetricDataBatch as jest.Mock;

function inventoryRow(id: string) {
  return { resource_id: id, resource_name: id, resource_type: 'ec2' as const, resource_arn: `arn:aws:ec2:us-east-1:*:instance/${id}`, status: 'running', metadata: null };
}

// A minimal, self-contained two-metric capability (one current-window, mirroring EC2's
// own shape) used to test the orchestration logic without depending on the real
// resourceTypeRegistry's private capability objects.
function twoMetricCapability() {
  return {
    resourceType: 'ec2' as const,
    cloudwatchNamespace: 'AWS/EC2',
    dimensionKey: 'InstanceId',
    getDimensionValue: (r: any) => r.resource_id,
    metrics: [
      { key: 'a', metricName: 'MetricA', statistic: 'Average' as const },
      { key: 'b', metricName: 'MetricB', statistic: 'Sum' as const },
    ],
    healthRule: (resource: any, values: Record<string, number | null>) => ({
      service: { resourceId: resource.resource_id, name: resource.resource_id, description: '', resourceType: 'ec2' as const, status: 'healthy' as const, uptime: null, responseTimeMs: null, errorRate: null, critical: true, monitored: true, metrics: [{ label: 'a', value: values.a ?? -1 }, { label: 'b', value: values.b ?? -1 }] },
      extra: undefined,
    }),
  };
}

// A capability with one current-window and one previous-window metric, mirroring ALB's
// loadBalancerCapability shape, to test the window-splitting path.
function currentAndPreviousCapability() {
  return {
    resourceType: 'load-balancer' as const,
    cloudwatchNamespace: 'AWS/ApplicationELB',
    dimensionKey: 'LoadBalancer',
    getDimensionValue: (r: any) => r.resource_id,
    metrics: [
      { key: 'now', metricName: 'MetricNow', statistic: 'Average' as const, window: 'current' as const },
      { key: 'before', metricName: 'MetricBefore', statistic: 'Average' as const, window: 'previous' as const },
    ],
    healthRule: (resource: any, values: Record<string, number | null>) => ({
      service: { resourceId: resource.resource_id, name: resource.resource_id, description: '', resourceType: 'load-balancer' as const, status: 'healthy' as const, uptime: null, responseTimeMs: null, errorRate: null, critical: false, monitored: true, metrics: [] },
      extra: { now: values.now, before: values.before },
    }),
  };
}

describe('CloudWatchService.evaluateCapabilityBatch', () => {
  const service = new CloudWatchService();
  const client = new CloudWatchClient({ region: 'us-east-1' });
  const now = new Date('2026-01-01T01:00:00Z');
  const currentStart = new Date('2026-01-01T00:00:00Z');
  const previousStart = new Date('2025-12-31T23:00:00Z');

  afterEach(() => {
    fetchMetricDataBatch.mockReset();
  });

  it('(1) builds one query per resource per metric, with deterministic, charset-valid, index-based Ids', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map());

    await (service as any).evaluateCapabilityBatch(
      client, twoMetricCapability(), [inventoryRow('i-aaa'), inventoryRow('i-bbb')], 'ec2', currentStart, previousStart, now, 300, 3600
    );

    const currentQueries = fetchMetricDataBatch.mock.calls[0][1];
    expect(currentQueries.map((q: any) => q.id)).toEqual(['ec20_0', 'ec20_1', 'ec21_0', 'ec21_1']);
    for (const q of currentQueries) {
      expect(q.id).toMatch(/^[a-z][a-z0-9_]*$/); // valid MetricDataQuery.Id charset, lowercase-leading
    }
  });

  it('(2) query construction: namespace, dimensions (from the resource\'s own id, not the query id), period, and statistic are correct per metric', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map());

    await (service as any).evaluateCapabilityBatch(
      client, twoMetricCapability(), [inventoryRow('i-hyphenated-id')], 'ec2', currentStart, previousStart, now, 300, 3600
    );

    const currentQueries = fetchMetricDataBatch.mock.calls[0][1];
    expect(currentQueries[0]).toMatchObject({ namespace: 'AWS/EC2', metricName: 'MetricA', stat: 'Average', period: 300, dimensions: [{ Name: 'InstanceId', Value: 'i-hyphenated-id' }] });
    expect(currentQueries[1]).toMatchObject({ namespace: 'AWS/EC2', metricName: 'MetricB', stat: 'Sum', period: 300 });
  });

  it('(3) correct current-window StartTime/EndTime are passed to fetchMetricDataBatch', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map());

    await (service as any).evaluateCapabilityBatch(
      client, twoMetricCapability(), [inventoryRow('i-aaa')], 'ec2', currentStart, previousStart, now, 300, 3600
    );

    expect(fetchMetricDataBatch).toHaveBeenCalledWith(client, expect.anything(), currentStart, now);
  });

  it('(4) maps a fetched series back to the correct resource by Id, feeding capability.healthRule with the reduced scalar', async () => {
    fetchMetricDataBatch.mockImplementation(async (_client, queries) => {
      const map = new Map();
      for (const q of queries) {
        if (q.id === 'ec20_0') map.set(q.id, { timestamps: [now], values: [10] });
        if (q.id === 'ec20_1') map.set(q.id, { timestamps: [now], values: [20, 30] }); // Sum -> 50
        if (q.id === 'ec21_0') map.set(q.id, { timestamps: [now], values: [99] });
        // ec21_1 deliberately absent -> null
      }
      return map;
    });

    const { evaluations } = await (service as any).evaluateCapabilityBatch(
      client, twoMetricCapability(), [inventoryRow('i-aaa'), inventoryRow('i-bbb')], 'ec2', currentStart, previousStart, now, 300, 3600
    );

    expect(evaluations[0].service.metrics).toEqual([{ label: 'a', value: 10 }, { label: 'b', value: 50 }]);
    expect(evaluations[1].service.metrics).toEqual([{ label: 'a', value: 99 }, { label: 'b', value: -1 }]); // -1 sentinel for null (b was absent)
  });

  it('(5) a resource whose dimension value cannot be resolved is dropped entirely, same as evaluateResource() before', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map());
    const capability = { ...twoMetricCapability(), getDimensionValue: () => null };

    const { evaluations } = await (service as any).evaluateCapabilityBatch(
      client, capability, [inventoryRow('i-unmappable')], 'ec2', currentStart, previousStart, now, 300, 3600
    );

    expect(evaluations).toHaveLength(0);
    expect(fetchMetricDataBatch).toHaveBeenCalledWith(client, [], currentStart, now); // no queries built for a dropped resource
  });

  it('(6) a capability with no CloudWatch namespace wired (e.g. RDS) never calls fetchMetricDataBatch, and healthRule runs with an empty values map', async () => {
    const capability = { ...twoMetricCapability(), cloudwatchNamespace: null, dimensionKey: null };

    const { evaluations } = await (service as any).evaluateCapabilityBatch(
      client, capability, [inventoryRow('i-no-cw')], 'ec2', currentStart, previousStart, now, 300, 3600
    );

    expect(fetchMetricDataBatch).not.toHaveBeenCalled();
    expect(evaluations[0].service.metrics).toEqual([{ label: 'a', value: -1 }, { label: 'b', value: -1 }]);
  });

  it('(7) current-window and previous-window metrics are NEVER combined into one fetchMetricDataBatch call, and are dispatched concurrently', async () => {
    let currentStarted = false;
    let previousStarted = false;

    fetchMetricDataBatch.mockImplementation(async (_client, queries, startTime) => {
      const isPrevious = startTime.getTime() === previousStart.getTime();
      if (isPrevious) previousStarted = true; else currentStarted = true;
      await new Promise((r) => setImmediate(r));
      // By the time either call resolves, the other has already been dispatched --
      // proving Promise.all() started both before awaiting either.
      expect(currentStarted && previousStarted).toBe(true);
      return new Map(queries.map((q: any) => [q.id, { timestamps: [now], values: [1] }]));
    });

    await (service as any).evaluateCapabilityBatch(
      client, currentAndPreviousCapability(), [inventoryRow('alb-1')], 'alb', currentStart, previousStart, now, 300, 3600
    );

    expect(fetchMetricDataBatch).toHaveBeenCalledTimes(2);
    const calls = fetchMetricDataBatch.mock.calls;
    const currentCall = calls.find((c) => c[2].getTime() === currentStart.getTime() && c[3].getTime() === now.getTime());
    const previousCall = calls.find((c) => c[2].getTime() === previousStart.getTime() && c[3].getTime() === currentStart.getTime());
    expect(currentCall).toBeDefined();
    expect(previousCall).toBeDefined();
    // Independent query-Id spaces per batch (both use metric-index-based Ids, but each
    // batch only ever contains the Ids for its own window's metrics).
    expect(currentCall![1].map((q: any) => q.id)).toEqual(['alb0_0']);
    expect(previousCall![1].map((q: any) => q.id)).toEqual(['alb0_1']);
  });

  it('(8) currentSeriesByResource exposes the raw current-window series per resource, keyed by metric key, for fold-in reuse -- and never exposes a previous-window series', async () => {
    fetchMetricDataBatch.mockImplementation(async (_client, queries, startTime) => {
      const isPrevious = startTime.getTime() === previousStart.getTime();
      return new Map(queries.map((q: any) => [q.id, { timestamps: [now], values: [isPrevious ? 5 : 7] }]));
    });

    const { currentSeriesByResource } = await (service as any).evaluateCapabilityBatch(
      client, currentAndPreviousCapability(), [inventoryRow('alb-1')], 'alb', currentStart, previousStart, now, 300, 3600
    );

    expect(currentSeriesByResource[0]['now']).toEqual({ timestamps: [now], values: [7] });
    expect(currentSeriesByResource[0]['before']).toBeUndefined(); // previous-window metrics are never written into currentSeriesByResource
  });
});

describe('CloudWatchService.computeMetrics — ALB fold-in wiring (DB-independent)', () => {
  // Isolates the one piece of Phase 2C ALB glue that lives in computeMetrics()/albTask
  // itself, not in evaluateCapabilityBatch() (already fully covered above): picking the
  // highest-requestSum ALB as "primary" and reading its chart series out of
  // evaluateCapabilityBatch()'s already-returned currentSeriesByResource, with zero
  // additional CloudWatch calls. Mocks evaluateCapabilityBatch() directly (proven correct
  // in isolation above) plus getAccount()/getResourceInventory() (both private methods,
  // stubbed directly -- neither is ever actually invoked, so this makes no real Postgres
  // query and runs independently of local database availability).
  const service = new CloudWatchService();

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('(9) responseTimeHistory comes from the highest-requestSum ALB\'s already-fetched current-window series, not a new CloudWatch call', async () => {
    jest.spyOn(CloudWatchService.prototype as any, 'getAccount').mockResolvedValue({ account_id: 'acct-1', nickname: null });
    jest.spyOn(CloudWatchService.prototype as any, 'getResourceInventory').mockResolvedValue([
      { resource_id: 'alb-low', resource_name: 'alb-low', resource_type: 'load-balancer', resource_arn: 'arn:aws:elasticloadbalancing:us-east-1:*:loadbalancer/app/alb-low/aaa', status: 'active', metadata: { type: 'application' } },
      { resource_id: 'alb-high', resource_name: 'alb-high', resource_type: 'load-balancer', resource_arn: 'arn:aws:elasticloadbalancing:us-east-1:*:loadbalancer/app/alb-high/bbb', status: 'active', metadata: { type: 'application' } },
    ]);
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({ enabled: true, cloudWatch: {} as any, ecs: {} as any, eks: {} as any, region: 'us-east-1' } as any);
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({ total: 0, byService: [], period: { start: '', end: '' } } as any);

    const cloudWatchBatchSpy = jest.spyOn(CloudWatchService.prototype as any, 'evaluateCapabilityBatch').mockImplementation(async (...args: any[]) => {
      const capability = args[1];
      if (capability.resourceType !== 'load-balancer') {
        return { evaluations: [], currentSeriesByResource: [] };
      }
      return {
        evaluations: [
          { service: { resourceId: 'alb-low', resourceType: 'load-balancer' }, extra: { avgResponseTimeMs: 50, previousAvgResponseTimeMs: null, requestsPerMinute: 1, errorRate: 0, requestSum: 10, dims: [] } },
          { service: { resourceId: 'alb-high', resourceType: 'load-balancer' }, extra: { avgResponseTimeMs: 200, previousAvgResponseTimeMs: null, requestsPerMinute: 5, errorRate: 0, requestSum: 9999, dims: [] } },
        ],
        currentSeriesByResource: [
          { latencySec: { timestamps: [new Date(0)], values: [0.05] } }, // alb-low
          { latencySec: { timestamps: [new Date(1000)], values: [0.2] } }, // alb-high -- the primary
        ],
      };
    });

    const result = await (service as any).computeMetrics('org-fold-in-test', '1h');

    // evaluateCapabilityBatch is called once per CloudWatch-backed type (ec2, load-balancer,
    // lambda, dynamodb) -- never a second time for ALB specifically, proving no extra
    // CloudWatch round trip was made to build the chart series.
    const albCalls = cloudWatchBatchSpy.mock.calls.filter((c) => (c[1] as any).resourceType === 'load-balancer');
    expect(albCalls).toHaveLength(1);
    expect(result.responseTimeHistory).toEqual([{ timestamp: new Date(1000).getTime(), value: 200 }]);
  });
});
