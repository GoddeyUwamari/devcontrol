/**
 * Phase 3E, `dynamodb_on_demand_vs_provisioned`: CostOptimizationService.detectDynamoDBOnDemandVsProvisionedOptimization().
 *
 * Critical properties under test, per the locked methodology checkpoint:
 * HARD gates (PROVISIONED-only, no GSI, no replicas, full-window age,
 * recognized table class) reject before any live AWS call and emit no row
 * at all -- the cost model itself is invalid for these. SOFT gates
 * (autoscaling state, a recent manual capacity change, confirmed/unproven
 * throttling) still emit a row with the full modeled comparison, but with
 * `potentialSavings = 0` and `metadata.recommendation.recommended = false`
 * -- Layers 1-2 succeed, Layer 3 (the recommendation) does not. Both
 * economic gates (>=20% modeled percentage advantage AND >=$15/month
 * modeled absolute advantage) are independently required. Read and write
 * are evaluated fully independently and BOTH must satisfy the
 * utilization/workload-shape/throttle policy for a recommendation. Data
 * completeness (576/720 per series) is a hard gate with no extrapolation.
 * The generic `$3` aws_resources.estimated_monthly_cost placeholder is
 * never read.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { ApplicationAutoScalingClient } from '@aws-sdk/client-application-auto-scaling';
import costOptimizationService from '../cost-optimization.service';
import * as dynamoTableUtil from '../dynamodb-table.util';
import * as dynamoAutoscalingUtil from '../dynamodb-autoscaling.util';
import * as capacityAnalysisUtil from '../dynamodb-capacity-analysis.util';

jest.mock('../../config/database', () => ({ pool: { connect: jest.fn() } }));
jest.mock('../dynamodb-table.util');
jest.mock('../dynamodb-autoscaling.util');
jest.mock('../dynamodb-capacity-analysis.util', () => {
  const actual = jest.requireActual('../dynamodb-capacity-analysis.util');
  return { ...actual, fetchDynamoDBCapacityMetrics: jest.fn() };
});

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { pool } = require('../../config/database');
const mockedDescribeDynamoDBTable = dynamoTableUtil.describeDynamoDBTable as jest.Mock;
const mockedDescribeDynamoDBAutoscaling = dynamoAutoscalingUtil.describeDynamoDBAutoscaling as jest.Mock;
const mockedFetchMetrics = capacityAnalysisUtil.fetchDynamoDBCapacityMetrics as jest.Mock;

const NOW = new Date('2026-09-07T00:00:00.000Z');
const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysAgo(days: number): string {
  return new Date(NOW.getTime() - days * DAY_MS).toISOString();
}

/** A fully-eligible base metadata row: PROVISIONED, no GSI/replica, old table, recognized class. */
function eligibleMetadata(overrides: Record<string, any> = {}) {
  return {
    billing_mode: 'PROVISIONED',
    table_status: 'ACTIVE',
    creation_date_time: isoDaysAgo(400),
    provisioned_read_capacity: 500,
    provisioned_write_capacity: 200,
    table_class: 'STANDARD',
    ...overrides,
  };
}

function mockAwsResourcesRows(rows: Array<{ resource_id: string; resource_name?: string; region: string; metadata: Record<string, any> }>) {
  const query = jest.fn().mockResolvedValue({ rows });
  const client = { query, release: jest.fn() };
  (pool.connect as jest.Mock).mockResolvedValueOnce(client);
  return { query, client };
}

function mockLiveDescribeTable(config: Record<string, any>) {
  mockedDescribeDynamoDBTable.mockResolvedValueOnce({ status: 'described', config });
}

function mockLiveAutoscaling(state: string) {
  mockedDescribeDynamoDBAutoscaling.mockResolvedValueOnce({
    status: 'described',
    config: { autoscaling_state: state, read_capacity_autoscaled: state === 'AUTOSCALING_ENABLED', write_capacity_autoscaled: false },
  });
}

type Series = { intervalStartTimes: string[]; values: Array<number | null>; provisioned: Array<number | null>; throttle: Array<number | null> };

/** Uniform series: `count` valid intervals at a fixed consumed-per-second/provisioned/throttle value. */
function uniformSeries(count: number, consumedPerSecond: number, provisioned: number, throttle: number | null = 0): Series {
  return {
    intervalStartTimes: new Array(count).fill(''),
    values: new Array(count).fill(consumedPerSecond),
    provisioned: new Array(count).fill(provisioned),
    throttle: new Array(count).fill(throttle),
  };
}

/** Two-level series: `lowCount` intervals at lowValue, then `peakCount` at peakValue -- lets a test independently control average utilization and the "% of hours below 30% of peak" workload-shape signal. */
function twoLevelSeries(lowCount: number, lowValue: number, peakCount: number, peakValue: number, provisioned: number, throttle: number | null = 0): Series {
  const total = lowCount + peakCount;
  return {
    intervalStartTimes: new Array(total).fill(''),
    values: [...new Array(lowCount).fill(lowValue), ...new Array(peakCount).fill(peakValue)],
    provisioned: new Array(total).fill(provisioned),
    throttle: new Array(total).fill(throttle),
  };
}

/** `validCount` real consumed datapoints followed by nulls out to `totalCount` -- provisioned stays fully valid throughout, isolating a Consumed-series completeness failure. */
function sparseConsumedSeries(totalCount: number, validCount: number, value: number, provisioned: number): Series {
  return {
    intervalStartTimes: new Array(totalCount).fill(''),
    values: [...new Array(validCount).fill(value), ...new Array(totalCount - validCount).fill(null)],
    provisioned: new Array(totalCount).fill(provisioned),
    throttle: new Array(totalCount).fill(0),
  };
}

/** `validCount` real provisioned datapoints followed by nulls out to `totalCount` -- consumed stays fully valid throughout, isolating a Provisioned-series completeness failure. */
function sparseProvisionedSeries(totalCount: number, validCount: number, value: number, provisioned: number): Series {
  return {
    intervalStartTimes: new Array(totalCount).fill(''),
    values: new Array(totalCount).fill(value),
    provisioned: [...new Array(validCount).fill(provisioned), ...new Array(totalCount - validCount).fill(null)],
    throttle: new Array(totalCount).fill(0),
  };
}

function mockMetrics(read: Series, write: Series) {
  mockedFetchMetrics.mockResolvedValueOnce({
    status: 'fetched',
    series: {
      intervalStartTimes: read.intervalStartTimes,
      consumedReadPerSecond: read.values,
      consumedWritePerSecond: write.values,
      provisionedRead: read.provisioned,
      provisionedWrite: write.provisioned,
      readThrottleEvents: read.throttle,
      writeThrottleEvents: write.throttle,
    },
  });
}

const dynamoDBClient = new DynamoDBClient({ region: 'us-east-1' });
const cloudWatchClient = new CloudWatchClient({ region: 'us-east-1' });
const autoscalingClient = new ApplicationAutoScalingClient({ region: 'us-east-1' });

function makeAwsClients() {
  return {
    getDynamoDBClientForRegion: jest.fn().mockReturnValue(dynamoDBClient),
    getCloudWatchClientForRegion: jest.fn().mockReturnValue(cloudWatchClient),
    getApplicationAutoScalingClientForRegion: jest.fn().mockReturnValue(autoscalingClient),
  };
}

async function run(awsClients = makeAwsClients()) {
  return (costOptimizationService as any).detectDynamoDBOnDemandVsProvisionedOptimization('org-1', awsClients);
}

/** Shape that qualifies for a full recommendation on both dimensions: ~6% average utilization, exactly 40% of hours below 30% of the observed peak, zero confirmed throttling, 1000 valid intervals. */
const QUALIFYING_READ = twoLevelSeries(400, 1, 600, 100, 1000);
const QUALIFYING_WRITE = twoLevelSeries(400, 1, 600, 100, 1000);

describe('CostOptimizationService.detectDynamoDBOnDemandVsProvisionedOptimization', () => {
  beforeEach(() => {
    jest.useFakeTimers().setSystemTime(NOW);
    mockedDescribeDynamoDBTable.mockReset();
    mockedDescribeDynamoDBAutoscaling.mockReset();
    mockedFetchMetrics.mockReset();
    (pool.connect as jest.Mock).mockReset();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('hard eligibility gates (invalid cost model -- reject before any live AWS call, no row emitted)', () => {
    const cases: Array<[string, Record<string, any>]> = [
      ['PAY_PER_REQUEST billing mode', { billing_mode: 'PAY_PER_REQUEST' }],
      ['UNKNOWN billing mode', { billing_mode: 'UNKNOWN' }],
      ['a GSI present', { global_secondary_indexes: [{ index_name: 'gsi1' }] }],
      ['a replica region present', { replica_regions: ['eu-west-1'] }],
      ['table younger than the 30-day window', { creation_date_time: isoDaysAgo(10) }],
      ['creation timestamp missing', { creation_date_time: undefined }],
      ['an unrecognized table class', { table_class: 'SOME_FUTURE_CLASS' }],
    ];

    it.each(cases)('excludes a table with %s, with zero live API calls', async (_label, override) => {
      const { query } = mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata(override) }]);
      const awsClients = makeAwsClients();

      const result = await run(awsClients);

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(awsClients.getDynamoDBClientForRegion).not.toHaveBeenCalled();
      expect(mockedDescribeDynamoDBTable).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(2); // set_config + the SELECT, nothing else
    });

    it('an undefined table_class is treated as AWS\'s own STANDARD default, not "unrecognized"', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata({ table_class: undefined }) }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: undefined,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(QUALIFYING_READ, QUALIFYING_WRITE);

      const result = await run();
      expect(result.issues).toHaveLength(1);
    });

    it('excludes a table whose fresh billing mode no longer matches PROVISIONED, even though persisted metadata said PROVISIONED', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({ billing_mode: 'PAY_PER_REQUEST', creation_date_time: isoDaysAgo(400) });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');

      const result = await run();
      expect(result.issues).toHaveLength(0);
      expect(mockedFetchMetrics).not.toHaveBeenCalled();
    });

    it('fails closed (no fabricated evidence) when live DescribeTable itself is unavailable', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockedDescribeDynamoDBTable.mockResolvedValueOnce({ status: 'unavailable', reason: 'Throttled' });

      const result = await run();
      expect(result.issues).toHaveLength(0);
      expect(mockedDescribeDynamoDBAutoscaling).not.toHaveBeenCalled();
    });
  });

  it('never selects the generic aws_resources.estimated_monthly_cost placeholder', async () => {
    const { query } = mockAwsResourcesRows([]);
    await run();
    const selectSql = query.mock.calls[1][0];
    expect(selectSql).not.toMatch(/estimated_monthly_cost/);
  });

  describe('regional client usage', () => {
    it("uses the table's own persisted region for every regional client getter, not a default", async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'ap-southeast-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(QUALIFYING_READ, QUALIFYING_WRITE);
      const awsClients = makeAwsClients();

      await run(awsClients);

      expect(awsClients.getDynamoDBClientForRegion).toHaveBeenCalledWith('ap-southeast-1');
      expect(awsClients.getApplicationAutoScalingClientForRegion).toHaveBeenCalledWith('ap-southeast-1');
      expect(awsClients.getCloudWatchClientForRegion).toHaveBeenCalledWith('ap-southeast-1');
    });
  });

  describe('data completeness (hard gate -- Layers 1-2 cannot be built below the floor, never extrapolated)', () => {
    async function runWithRead(read: Series) {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(read, uniformSeries(1000, 10, 1000));
      return run();
    }

    it('emits a row at exactly 576 valid consumed+provisioned intervals (the minimum valid sample)', async () => {
      const result = await runWithRead(uniformSeries(576, 10, 1000));
      expect(result.issues).toHaveLength(1);
    });

    it('emits no row at 575 valid intervals -- one short of the minimum, never extrapolated', async () => {
      const result = await runWithRead(uniformSeries(575, 10, 1000));
      expect(result.issues).toHaveLength(0);
    });

    it('emits no row when consumed data is missing below the completeness floor, even though provisioned data is fully present', async () => {
      const result = await runWithRead(sparseConsumedSeries(1000, 500, 10, 1000));
      expect(result.issues).toHaveLength(0);
    });

    it('emits no row when provisioned data is missing below the completeness floor, even though consumed data is fully present', async () => {
      const result = await runWithRead(sparseProvisionedSeries(1000, 500, 10, 1000));
      expect(result.issues).toHaveLength(0);
    });
  });

  describe('qualifying recommendation', () => {
    it('produces a real modeled recommendation when utilization, workload-shape, throttle, and economic gates all pass', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(QUALIFYING_READ, QUALIFYING_WRITE);

      const result = await run();

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].metadata.recommendation.recommended).toBe(true);
      expect(result.issues[0].metadata.recommendation.blocked_reasons).toHaveLength(0);
      expect(result.issues[0].potentialSavings).toBeGreaterThan(0);
      expect(result.issues[0].metadata.modeled_cost_difference).toBeCloseTo(result.issues[0].potentialSavings, 5);
      expect(result.issues[0].metadata.modeled_percentage_difference).toBeGreaterThanOrEqual(20);
    });
  });

  describe('utilization policy (AWS reference: below ~35%)', () => {
    it('blocks the recommendation when average utilization is at/above 35%, even with qualifying workload shape', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      // 50% of hours near-zero, 50% at 80% utilization -> average ~40% (>=35%), but still 50% below-peak (>=40%, workload shape passes).
      const series = twoLevelSeries(500, 1, 500, 800, 1000);
      mockMetrics(series, series);

      const result = await run();

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].potentialSavings).toBe(0);
      expect(result.issues[0].metadata.recommendation.recommended).toBe(false);
      expect(result.issues[0].metadata.recommendation.blocked_reasons.some((r: string) => /average utilization/.test(r))).toBe(true);
    });
  });

  describe('workload-variability policy (DevControl policy, not AWS guidance)', () => {
    it('qualifies at exactly the 40% DevControl variability threshold', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      const series = twoLevelSeries(400, 1, 600, 100, 1000); // 400/1000 = exactly 40%
      mockMetrics(series, series);

      const result = await run();

      expect(result.issues[0].metadata.read.percent_hours_below_30_percent_peak).toBeCloseTo(40, 5);
      expect(result.issues[0].metadata.recommendation.recommended).toBe(true);
    });

    it('does not qualify at 39.9% -- just below the 40% threshold', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      const series = twoLevelSeries(399, 1, 601, 100, 1000); // 399/1000 = 39.9%
      mockMetrics(series, series);

      const result = await run();

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].potentialSavings).toBe(0);
      expect(result.issues[0].metadata.recommendation.blocked_reasons.some((r: string) => /workload-variability policy not met/.test(r))).toBe(true);
    });
  });

  describe('economic confidence gates (DevControl policy: both required, independently)', () => {
    it('blocks a tiny-dollar table even when the percentage advantage is large (percentage passes, absolute floor fails)', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1, // tiny capacity -> tiny dollars even at a huge relative advantage
        provisioned_write_capacity: 1,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      const series = twoLevelSeries(500, 0, 500, 0.02, 1);
      mockMetrics(series, series);

      const result = await run();

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].potentialSavings).toBe(0);
      expect(result.issues[0].metadata.modeled_percentage_difference).toBeGreaterThanOrEqual(20);
      expect(result.issues[0].metadata.modeled_cost_difference).toBeLessThan(15);
      expect(
        result.issues[0].metadata.recommendation.blocked_reasons.some((r: string) => /DevControl policy floor/.test(r) && /\$/.test(r))
      ).toBe(true);
    });

    it('blocks a large table whose percentage advantage is small, even though the absolute dollar difference is large (absolute passes, percentage floor fails)', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 100000,
        provisioned_write_capacity: 100000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      const series = twoLevelSeries(500, 0, 500, 55000, 100000);
      mockMetrics(series, series);

      const result = await run();

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].potentialSavings).toBe(0);
      expect(result.issues[0].metadata.modeled_cost_difference).toBeGreaterThanOrEqual(15);
      expect(result.issues[0].metadata.modeled_percentage_difference).toBeLessThan(20);
      expect(
        result.issues[0].metadata.recommendation.blocked_reasons.some((r: string) => /percentage advantage/.test(r))
      ).toBe(true);
    });
  });

  describe('autoscaling (soft exclusion -- comparison still emitted)', () => {
    it('emits a comparison-only row (potentialSavings = 0) when autoscaling is ENABLED', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_ENABLED');
      mockMetrics(QUALIFYING_READ, QUALIFYING_WRITE);

      const result = await run();

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].potentialSavings).toBe(0);
      expect(result.issues[0].metadata.autoscaling_state).toBe('AUTOSCALING_ENABLED');
      expect(result.issues[0].metadata.modeled_cost_difference).toBeGreaterThan(0); // Layer 1-2 evidence still computed
      expect(result.issues[0].metadata.recommendation.blocked_reasons.some((r: string) => /AUTOSCALING_DISABLED/.test(r))).toBe(true);
    });

    it('emits a comparison-only row when the live Application Auto Scaling check fails -- never assumes DISABLED', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockedDescribeDynamoDBAutoscaling.mockResolvedValueOnce({ status: 'unavailable', reason: 'AccessDenied' });
      mockMetrics(QUALIFYING_READ, QUALIFYING_WRITE);

      const result = await run();

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].potentialSavings).toBe(0);
      expect(result.issues[0].metadata.autoscaling_state).toBe('AUTOSCALING_UNKNOWN');
    });
  });

  describe('recent capacity change (soft exclusion -- comparison still emitted)', () => {
    it('emits a comparison-only row when a manual capacity increase occurred inside the analysis window', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        last_increase_date_time: isoDaysAgo(5),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(QUALIFYING_READ, QUALIFYING_WRITE);

      const result = await run();

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].potentialSavings).toBe(0);
      expect(result.issues[0].metadata.recommendation.blocked_reasons.some((r: string) => /capacity change/.test(r))).toBe(true);
    });

    it('does not block on a capacity-change timestamp with no known change -- absence means no known change, never invented', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(QUALIFYING_READ, QUALIFYING_WRITE);

      const result = await run();
      expect(result.issues[0].metadata.recommendation.recommended).toBe(true);
    });
  });

  describe('throttling policy (deliberately NOT dynamodb_capacity\'s blanket exclusion)', () => {
    it('blocks the recommendation but still exposes the full comparison when throttling is confirmed', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      const throttledRead = twoLevelSeries(400, 1, 600, 100, 1000, 1); // throttle=1 every interval -> confirmed
      mockMetrics(throttledRead, QUALIFYING_WRITE);

      const result = await run();

      expect(result.issues).toHaveLength(1); // comparison layer still available
      expect(result.issues[0].potentialSavings).toBe(0);
      expect(result.issues[0].metadata.modeled_cost_difference).toBeGreaterThan(0); // Layer 1-2 evidence intact
      expect(result.issues[0].metadata.read.throttled_read_intervals).toBeGreaterThan(0);
      expect(result.issues[0].metadata.recommendation.blocked_reasons.some((r: string) => /confirmed table-level provisioned-throughput throttling/.test(r))).toBe(true);
    });

    it('blocks the recommendation and never claims "no throttling" when throttle telemetry itself is missing', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      const noThrottleDataRead = twoLevelSeries(400, 1, 600, 100, 1000, null);
      mockMetrics(noThrottleDataRead, QUALIFYING_WRITE);

      const result = await run();

      expect(result.issues[0].potentialSavings).toBe(0);
      expect(result.issues[0].metadata.read.throttle_read_valid_intervals).toBe(0);
      expect(result.issues[0].metadata.recommendation.blocked_reasons.some((r: string) => /cannot confirm absence of throttling/.test(r))).toBe(true);
      expect(result.issues[0].description).not.toMatch(/no throttling/i);
    });
  });

  describe('read/write independence', () => {
    it('blocks the overall recommendation when only the write dimension fails, and names write specifically', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      const failingWrite = twoLevelSeries(300, 1, 700, 100, 1000); // 30% below peak -- fails variability
      mockMetrics(QUALIFYING_READ, failingWrite);

      const result = await run();

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].potentialSavings).toBe(0);
      const reasons: string[] = result.issues[0].metadata.recommendation.blocked_reasons;
      expect(reasons.some((r) => r.startsWith('write:'))).toBe(true);
      expect(reasons.some((r) => r.startsWith('read:'))).toBe(false);
    });
  });

  describe('separate evidence counts', () => {
    it('tracks utilization, read-throttle, and write-throttle completeness as distinct counts, never conflated', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1000,
        provisioned_write_capacity: 1000,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      // Read has no throttle telemetry at all; write has full throttle telemetry -- the two counts must not be conflated with each other or with utilization validity.
      const readNoThrottleData = twoLevelSeries(400, 1, 600, 100, 1000, null);
      mockMetrics(readNoThrottleData, QUALIFYING_WRITE);

      const result = await run();

      expect(result.issues[0].metadata.read.utilization_valid_intervals).toBe(1000);
      expect(result.issues[0].metadata.read.throttle_read_valid_intervals).toBe(0);
      expect(result.issues[0].metadata.write.throttle_write_valid_intervals).toBe(1000);
    });
  });
});
