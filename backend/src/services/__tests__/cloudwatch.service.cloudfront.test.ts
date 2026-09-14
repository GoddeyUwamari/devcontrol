/**
 * Service Health Coverage Expansion: coverage for CloudFront distribution health
 * evaluation (evaluateCloudFrontDistributions). Mocks fetchMetricDataBatch at the module
 * level, mirroring cloudwatch.service.batching.test.ts's convention for testing an
 * orchestration layer independently of the already-unit-tested batching utility
 * (cloudwatch-metric-batch.util.test.ts) -- this file exercises only
 * evaluateCloudFrontDistributions()'s own logic: building the two-dimension
 * (DistributionId + Region=Global) queries, converting CloudFront's fractional error
 * rates to percentages, and applying the deployment-status/enabled-state/error-rate
 * health rule.
 *
 * Deliberately does not touch Postgres -- evaluateCloudFrontDistributions() makes zero
 * pool.query() calls.
 */
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CloudWatchService } from '../cloudwatch.service';
import * as batchUtil from '../cloudwatch-metric-batch.util';

jest.mock('../cloudwatch-metric-batch.util', () => {
  const actual = jest.requireActual('../cloudwatch-metric-batch.util');
  return { ...actual, fetchMetricDataBatch: jest.fn() };
});

const fetchMetricDataBatch = batchUtil.fetchMetricDataBatch as jest.Mock;

function distributionRow(overrides: Partial<{
  resource_id: string;
  resource_name: string | null;
  status: string;
  metadata: Record<string, any> | null;
}> = {}) {
  return {
    id: 'db-uuid-cf-1',
    resource_id: 'E1AAAAAAAA',
    resource_name: 'd111.cloudfront.net',
    resource_type: 'cloudfront' as const,
    resource_arn: 'arn:aws:cloudfront::*:distribution/E1AAAAAAAA',
    status: 'active',
    metadata: { domain_name: 'd111.cloudfront.net', is_enabled: true, price_class: 'PriceClass_All' },
    ...overrides,
  };
}

// Builds a fetchMetricDataBatch-shaped result map from {totalErrorRate, rate4xx, rate5xx}
// fractional values (or null), matching the id scheme evaluateCloudFrontDistributions()
// builds internally (`cf${distIndex}_${metricIndex}`, metric order
// [totalErrorRate, rate4xx, rate5xx]).
function seriesMap(distIndex: number, values: { total?: number | null; r4xx?: number | null; r5xx?: number | null }) {
  const entries: [string, any][] = [];
  const asSeries = (v: number | null | undefined) => (v == null ? null : { timestamps: [new Date()], values: [v] });
  entries.push([`cf${distIndex}_0`, asSeries(values.total)]);
  entries.push([`cf${distIndex}_1`, asSeries(values.r4xx)]);
  entries.push([`cf${distIndex}_2`, asSeries(values.r5xx)]);
  return entries;
}

describe('CloudWatchService.evaluateCloudFrontDistributions', () => {
  const service = new CloudWatchService();
  const client = new CloudWatchClient({ region: 'us-east-1' });
  const now = new Date('2026-01-01T01:00:00Z');
  const currentStart = new Date('2026-01-01T00:00:00Z');

  afterEach(() => {
    fetchMetricDataBatch.mockReset();
  });

  it('(1) a low error rate (well under 5%) is healthy and monitored', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { total: 0.01, r4xx: 0.008, r5xx: 0.002 })));

    const [result] = await (service as any).evaluateCloudFrontDistributions(client, [distributionRow()], currentStart, now, 300);

    expect(result.status).toBe('healthy');
    expect(result.monitored).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.resourceType).toBe('cloudfront');
    // No fabricated uptime -- CloudFront has no uptime concept in this evaluation.
    expect(result.uptime).toBeNull();
  });

  it('(2) an error rate between 5% and 25% is degraded', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { total: 0.1 })));

    const [result] = await (service as any).evaluateCloudFrontDistributions(client, [distributionRow()], currentStart, now, 300);

    expect(result.status).toBe('degraded');
    expect(result.monitored).toBe(true);
    expect(result.errorRate).toBe(10);
  });

  it('(3) an error rate at or above 25% is critical', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { total: 0.4 })));

    const [result] = await (service as any).evaluateCloudFrontDistributions(client, [distributionRow()], currentStart, now, 300);

    expect(result.status).toBe('critical');
    expect(result.monitored).toBe(true);
  });

  it('(4) a disabled distribution is down regardless of its error rate', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { total: 0 })));

    const [result] = await (service as any).evaluateCloudFrontDistributions(
      client,
      [distributionRow({ metadata: { is_enabled: false } })],
      currentStart,
      now,
      300
    );

    expect(result.status).toBe('down');
    expect(result.monitored).toBe(true);
    expect(result.reason).toContain('disabled');
  });

  it('(5) a distribution that is not yet Deployed (still propagating) is degraded, not healthy', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { total: 0 })));

    const [result] = await (service as any).evaluateCloudFrontDistributions(
      client,
      [distributionRow({ status: 'inactive' })],
      currentStart,
      now,
      300
    );

    expect(result.status).toBe('degraded');
    expect(result.monitored).toBe(true);
    expect(result.reason).toContain('propagating');
  });

  it('(6) no CloudWatch datapoints for a deployed, enabled distribution is unknown and NOT monitored -- missing data never becomes healthy', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, {})));

    const [result] = await (service as any).evaluateCloudFrontDistributions(client, [distributionRow()], currentStart, now, 300);

    expect(result.status).toBe('unknown');
    expect(result.monitored).toBe(false);
  });

  it('(7) a batch-level AWS/GetMetricData failure (fetchMetricDataBatch returns all-null, matching its own documented failure contract) yields unknown, not fabricated healthy', async () => {
    // fetchMetricDataBatch never throws for a failed request -- it resolves every
    // submitted id to null (see cloudwatch-metric-batch.util.ts's own doc comment).
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, {})));

    const [result] = await (service as any).evaluateCloudFrontDistributions(client, [distributionRow()], currentStart, now, 300);

    expect(result.status).toBe('unknown');
    expect(result.errorRate).toBeNull();
  });

  it('(8) queries use both the DistributionId AND the fixed Region=Global dimension, in the AWS/CloudFront namespace', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map());

    await (service as any).evaluateCloudFrontDistributions(client, [distributionRow({ resource_id: 'E2BBBBBBBB' })], currentStart, now, 300);

    const [, queries] = fetchMetricDataBatch.mock.calls[0];
    expect(queries.length).toBe(3);
    for (const q of queries) {
      expect(q.namespace).toBe('AWS/CloudFront');
      expect(q.dimensions).toEqual([
        { Name: 'DistributionId', Value: 'E2BBBBBBBB' },
        { Name: 'Region', Value: 'Global' },
      ]);
    }
    expect(queries.map((q: any) => q.metricName).sort()).toEqual(['4xxErrorRate', '5xxErrorRate', 'TotalErrorRate']);
  });

  it('(9) resource identity fields are populated from the inventory row, not fabricated', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { total: 0 })));

    const [result] = await (service as any).evaluateCloudFrontDistributions(
      client,
      [distributionRow({ resource_id: 'E3CCCCCCCC', resource_name: 'prod-cdn' })],
      currentStart,
      now,
      300
    );

    expect(result.resourceId).toBe('E3CCCCCCCC');
    expect(result.resourceDbId).toBe('db-uuid-cf-1');
    expect(result.resourceSortName).toBe('prod-cdn');
    expect(result.name).toBe('prod-cdn');
  });

  it('(10) multiple distributions are fetched in a single batched GetMetricData call, never one request per distribution', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map());

    await (service as any).evaluateCloudFrontDistributions(
      client,
      [distributionRow({ resource_id: 'E1' }), distributionRow({ resource_id: 'E2' }), distributionRow({ resource_id: 'E3' })],
      currentStart,
      now,
      300
    );

    expect(fetchMetricDataBatch).toHaveBeenCalledTimes(1);
    const [, queries] = fetchMetricDataBatch.mock.calls[0];
    // 3 distributions x 3 metrics each = 9 queries in that one call.
    expect(queries.length).toBe(9);
  });

  it('(11) an empty distribution list makes zero CloudWatch calls', async () => {
    const results = await (service as any).evaluateCloudFrontDistributions(client, [], currentStart, now, 300);

    expect(results).toEqual([]);
    expect(fetchMetricDataBatch).not.toHaveBeenCalled();
  });

  it('(12) 4xx/5xx rates are surfaced as display metrics without driving status on their own', async () => {
    fetchMetricDataBatch.mockResolvedValue(new Map(seriesMap(0, { total: 0.01, r4xx: 0.008, r5xx: 0.002 })));

    const [result] = await (service as any).evaluateCloudFrontDistributions(client, [distributionRow()], currentStart, now, 300);

    expect(result.metrics).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: '4xx rate', value: 0.8 }),
        expect.objectContaining({ label: '5xx rate', value: 0.2 }),
      ])
    );
  });
});
