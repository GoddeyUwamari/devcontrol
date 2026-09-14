/**
 * Aurora Service Health: coverage for evaluateAuroraClusters(). Mocks both AWS SDK
 * surfaces it uses:
 * - RDSClient.send (via describeAuroraClusters()'s real paginateDescribeDBClusters
 *   paginator) -- same withMockedSend convention as cloudwatch.service.ebs.test.ts /
 *   awsResourceDiscovery.ebs.test.ts.
 * - fetchMetricDataBatch, mocked at module level -- same convention as
 *   cloudwatch.service.cloudfront.test.ts, since this file exercises only
 *   evaluateAuroraClusters()'s own multi-signal logic, not the already-unit-tested
 *   batching utility.
 *
 * Deliberately does not touch Postgres -- evaluateAuroraClusters() makes zero
 * pool.query() calls.
 */
import { RDSClient } from '@aws-sdk/client-rds';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CloudWatchService } from '../cloudwatch.service';
import * as batchUtil from '../cloudwatch-metric-batch.util';

jest.mock('../cloudwatch-metric-batch.util', () => {
  const actual = jest.requireActual('../cloudwatch-metric-batch.util');
  return { ...actual, fetchMetricDataBatch: jest.fn() };
});

const fetchMetricDataBatch = batchUtil.fetchMetricDataBatch as jest.Mock;

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

function clusterRow(overrides: Partial<{
  id: string;
  resource_id: string;
  resource_name: string | null;
  status: string;
  metadata: Record<string, any> | null;
}> = {}) {
  return {
    id: 'db-uuid-aurora-1',
    resource_id: 'prod-aurora-cluster',
    resource_name: 'prod-aurora-cluster',
    resource_type: 'aurora' as const,
    resource_arn: 'arn:aws:rds:us-east-1:*:cluster:prod-aurora-cluster',
    status: 'unknown',
    metadata: { source: 'resource-explorer', service: 'rds' },
    ...overrides,
  };
}

function dbClustersResponse(clusters: Array<{
  DBClusterIdentifier: string;
  Engine?: string;
  EngineMode?: string;
  Status?: string;
  hasReader?: boolean;
}>) {
  return {
    DBClusters: clusters.map((c) => ({
      DBClusterIdentifier: c.DBClusterIdentifier,
      Engine: c.Engine ?? 'aurora-postgresql',
      EngineMode: c.EngineMode ?? 'provisioned',
      Status: c.Status ?? 'available',
      DBClusterMembers: c.hasReader
        ? [
            { DBInstanceIdentifier: `${c.DBClusterIdentifier}-writer`, IsClusterWriter: true },
            { DBInstanceIdentifier: `${c.DBClusterIdentifier}-reader`, IsClusterWriter: false },
          ]
        : [{ DBInstanceIdentifier: `${c.DBClusterIdentifier}-writer`, IsClusterWriter: true }],
    })),
  };
}

// Builds a fetchMetricDataBatch-shaped result map matching the id scheme
// evaluateAuroraClusters() builds internally (`aur${clusterIndex}_${metricIndex}`,
// metric order [cpu, lag]).
function seriesMap(clusterIndex: number, values: { cpu?: number | null; lag?: number | null }) {
  const asSeries = (v: number | null | undefined) => (v == null ? null : { timestamps: [new Date()], values: [v] });
  return [
    [`aur${clusterIndex}_0`, asSeries(values.cpu)],
    [`aur${clusterIndex}_1`, asSeries(values.lag)],
  ] as [string, any][];
}

describe('CloudWatchService.evaluateAuroraClusters', () => {
  const service = new CloudWatchService();
  const cwClient = new CloudWatchClient({ region: 'us-east-1' });
  const now = new Date('2026-01-01T01:00:00Z');
  const currentStart = new Date('2026-01-01T00:00:00Z');

  afterEach(() => {
    fetchMetricDataBatch.mockReset();
  });

  it('(1) available cluster, healthy CPU and lag -> healthy', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', hasReader: true }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { cpu: 20, lag: 100 })));

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe('healthy');
    expect(result.monitored).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.resourceType).toBe('aurora');
    expect(result.uptime).toBeNull();
  });

  it('(2) failing-over status is degraded regardless of metrics', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', Status: 'failing-over', hasReader: true }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { cpu: 5, lag: 10 })));

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe('degraded');
    expect(result.monitored).toBe(true);
    expect(result.reason).toContain('failing over');
  });

  it.each(['deleting', 'stopped', 'stopping'])('(3) %s status is down', async (status) => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', Status: status, hasReader: false }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map());

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe('down');
    expect(result.monitored).toBe(true);
  });

  it('(4) an unrecognized/unknown status is unknown, not guessed at', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', Status: 'some-future-aws-status', hasReader: false }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map());

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe('unknown');
    expect(result.monitored).toBe(true);
    expect(result.reason).toContain('some-future-aws-status');
  });

  it('(5) a whole DescribeDBClusters API failure yields unknown/monitored:false for every cluster, not fabricated healthy', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('AccessDeniedException'));
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);

    const results = await (service as any).evaluateAuroraClusters(
      rds, cwClient, [clusterRow({ resource_id: 'c1' }), clusterRow({ resource_id: 'c2' })], currentStart, now, 300
    );

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe('unknown');
      expect(r.monitored).toBe(false);
      expect(r.reason).toContain('Failed to reach the RDS API');
    }
    expect(fetchMetricDataBatch).not.toHaveBeenCalled();
  });

  it('(6) a cluster absent from this cycle\'s DescribeDBClusters result is unknown/monitored:false, never fabricated', async () => {
    const send = jest.fn().mockResolvedValueOnce(dbClustersResponse([]));
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe('unknown');
    expect(result.monitored).toBe(false);
  });

  it('(7) classification defense-in-depth: a stale row whose live Engine is NOT Aurora is unknown, not evaluated as Aurora', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', Engine: 'postgres', hasReader: false }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe('unknown');
    expect(result.monitored).toBe(false);
    expect(result.reason).toContain('not an Aurora engine');
    expect(fetchMetricDataBatch).not.toHaveBeenCalled();
  });

  it.each([
    [79.9, 'healthy'],
    [80, 'degraded'],
    [90, 'degraded'],
    [90.1, 'critical'],
  ])('(8) CPU boundary: %s%% -> %s', async (cpu, expected) => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', hasReader: false }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { cpu })));

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe(expected);
  });

  it.each([
    [999, 'healthy'],
    [1000, 'degraded'],
    [5000, 'degraded'],
    [5000.1, 'critical'],
  ])('(9) replica lag boundary: %sms -> %s (cluster has a reader)', async (lag, expected) => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', hasReader: true }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { cpu: 10, lag })));

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe(expected);
  });

  it('(10) worst-signal-wins: CPU critical + lag healthy -> critical', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', hasReader: true }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { cpu: 95, lag: 50 })));

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe('critical');
    expect(result.reason).toContain('CPU');
  });

  it('(11) worst-signal-wins: CPU healthy + lag critical -> critical', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', hasReader: true }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { cpu: 10, lag: 6000 })));

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe('critical');
    expect(result.reason).toContain('lag');
  });

  it('(12) no reader: lag is not applicable, never treated as missing/failure -- health derives from CPU alone', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', hasReader: false }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    // Even if a lag series were somehow returned, a writer-only cluster must ignore it.
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { cpu: 15, lag: 9999 })));

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe('healthy');
    expect(result.signals.lagMs).toBeNull();
    expect(result.metrics ?? []).not.toEqual(expect.arrayContaining([expect.objectContaining({ label: 'Replica lag' })]));
  });

  it('(13) reader exists but lag has no datapoints: treated as an ambiguous gap, not forced to unknown -- health derives from CPU + control-plane', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', hasReader: true }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { cpu: 15, lag: null })));

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe('healthy');
    expect(result.monitored).toBe(true);
  });

  it('(14) both CloudWatch signals unavailable, control-plane available: unknown, not fabricated healthy -- monitored true since real control-plane evidence exists', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', hasReader: false }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, {})));

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe('unknown');
    expect(result.monitored).toBe(true);
    expect(result.reason).toContain('no CloudWatch telemetry');
  });

  it('(15) CPU unavailable + lag available: health derives from lag + control-plane', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', hasReader: true }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { lag: 6000 })));

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.status).toBe('critical');
    expect(result.monitored).toBe(true);
  });

  it('(16) queries use DBClusterIdentifier + Role=WRITER dimensions, AWS/RDS namespace, correct metric names/statistics', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'my-cluster', hasReader: true }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map());

    await (service as any).evaluateAuroraClusters(
      rds, cwClient, [clusterRow({ resource_id: 'my-cluster' })], currentStart, now, 300
    );

    const [, queries] = fetchMetricDataBatch.mock.calls[0];
    expect(queries).toHaveLength(2);
    for (const q of queries) {
      expect(q.namespace).toBe('AWS/RDS');
      expect(q.dimensions).toEqual([
        { Name: 'DBClusterIdentifier', Value: 'my-cluster' },
        { Name: 'Role', Value: 'WRITER' },
      ]);
    }
    const cpuQuery = queries.find((q: any) => q.metricName === 'CPUUtilization');
    const lagQuery = queries.find((q: any) => q.metricName === 'AuroraReplicaLagMaximum');
    expect(cpuQuery.stat).toBe('Average');
    expect(lagQuery.stat).toBe('Maximum');
  });

  it('(17) multiple clusters are fetched in a single batched GetMetricData call, never one request per cluster', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([
        { DBClusterIdentifier: 'c1', hasReader: false },
        { DBClusterIdentifier: 'c2', hasReader: false },
        { DBClusterIdentifier: 'c3', hasReader: false },
      ])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map());

    await (service as any).evaluateAuroraClusters(
      rds, cwClient,
      [clusterRow({ resource_id: 'c1' }), clusterRow({ resource_id: 'c2' }), clusterRow({ resource_id: 'c3' })],
      currentStart, now, 300
    );

    expect(fetchMetricDataBatch).toHaveBeenCalledTimes(1);
    const [, queries] = fetchMetricDataBatch.mock.calls[0];
    // 3 clusters x 2 metrics each = 6 queries in that one call.
    expect(queries).toHaveLength(6);
  });

  it('(18) resource identity fields are populated from the inventory row, not fabricated', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-db', hasReader: false }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { cpu: 5 })));

    const [result] = await (service as any).evaluateAuroraClusters(
      rds, cwClient,
      [clusterRow({ resource_id: 'prod-db', resource_name: 'Production DB' })],
      currentStart, now, 300
    );

    expect(result.resourceId).toBe('prod-db');
    expect(result.resourceDbId).toBe('db-uuid-aurora-1');
    expect(result.resourceSortName).toBe('Production DB');
    expect(result.name).toBe('Production DB');
  });

  it('(19) an empty cluster list makes zero AWS calls', async () => {
    const send = jest.fn();
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);

    const results = await (service as any).evaluateAuroraClusters(rds, cwClient, [], currentStart, now, 300);

    expect(results).toEqual([]);
    expect(send).not.toHaveBeenCalled();
    expect(fetchMetricDataBatch).not.toHaveBeenCalled();
  });

  it('(20) no fabricated uptime/responseTime/errorRate -- Aurora has no such concepts in this evaluation', async () => {
    const send = jest.fn().mockResolvedValueOnce(
      dbClustersResponse([{ DBClusterIdentifier: 'prod-aurora-cluster', hasReader: true }])
    );
    const rds = withMockedSend(new RDSClient({ region: 'us-east-1' }), send);
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { cpu: 20, lag: 100 })));

    const [result] = await (service as any).evaluateAuroraClusters(rds, cwClient, [clusterRow()], currentStart, now, 300);

    expect(result.uptime).toBeNull();
    expect(result.responseTimeMs).toBeNull();
    expect(result.errorRate).toBeNull();
  });
});
