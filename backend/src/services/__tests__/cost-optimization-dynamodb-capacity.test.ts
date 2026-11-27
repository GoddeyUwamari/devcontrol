/**
 * Phase 3E, `dynamodb_capacity`: CostOptimizationService.detectDynamoDBCapacityOptimization().
 *
 * Critical properties under test, per the locked methodology/architecture
 * checkpoints: cheap eligibility gates run against persisted aws_resources
 * metadata BEFORE any live AWS call (proving no wasted API cost on obviously
 * ineligible tables); fresh live DescribeTable/DescribeScalableTargets data
 * -- not stale metadata -- is what the final decision and cost calculation
 * are actually built on; read/write are evaluated fully independently;
 * throttling (confirmed OR simply unproven) disqualifies; the regional
 * client getters are used with the table's own persisted region, never a
 * default; no exact recommended RCU/WCU is ever produced; savings_basis
 * starts with `ceiling:` (the figure is an upper bound on the saving, kept
 * out of estimated totals); the generic $3
 * aws_resources.estimated_monthly_cost placeholder is never read.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { ApplicationAutoScalingClient } from '@aws-sdk/client-application-auto-scaling';
import costOptimizationService from '../cost-optimization.service';
import { ISSUE_DYNAMODB_CAPACITY } from '../../config/optimization-rules';
import { classifySavingsBasis, countSavingsFindings } from '../estimated-savings';
import { estimateDynamoDBProvisionedMonthlyCost } from '../../config/aws-pricing';
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

/** A fully-eligible base metadata row: PROVISIONED, autoscaling disabled, no GSI/replica, old table, no recent change. */
function eligibleMetadata(overrides: Record<string, any> = {}) {
  return {
    billing_mode: 'PROVISIONED',
    autoscaling_state: 'AUTOSCALING_DISABLED',
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

/** Uniform series: `count` valid intervals at a fixed consumed-per-second/provisioned/throttle value. */
function uniformSeries(count: number, consumedPerSecond: number, provisioned: number, throttle: number | null = 0) {
  return {
    intervalStartTimes: new Array(count).fill(''),
    values: new Array(count).fill(consumedPerSecond) as Array<number | null>,
    provisioned: new Array(count).fill(provisioned) as Array<number | null>,
    throttle: new Array(count).fill(throttle) as Array<number | null>,
  };
}

function mockMetrics(read: ReturnType<typeof uniformSeries>, write: ReturnType<typeof uniformSeries>) {
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

describe('CostOptimizationService.detectDynamoDBCapacityOptimization', () => {
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

  describe('cheap eligibility gates (must reject before any live AWS call)', () => {
    const cases: Array<[string, Record<string, any>]> = [
      ['PAY_PER_REQUEST billing mode', { billing_mode: 'PAY_PER_REQUEST' }],
      ['UNKNOWN billing mode', { billing_mode: 'UNKNOWN' }],
      ['AUTOSCALING_ENABLED', { autoscaling_state: 'AUTOSCALING_ENABLED' }],
      ['AUTOSCALING_UNKNOWN', { autoscaling_state: 'AUTOSCALING_UNKNOWN' }],
      ['a GSI present', { global_secondary_indexes: [{ index_name: 'gsi1' }] }],
      ['a replica region present', { replica_regions: ['eu-west-1'] }],
      ['table younger than the 30-day window', { creation_date_time: isoDaysAgo(10) }],
      ['creation timestamp missing', { creation_date_time: undefined }],
      ['a capacity increase inside the window', { last_increase_date_time: isoDaysAgo(5) }],
      ['a capacity decrease inside the window', { last_decrease_date_time: isoDaysAgo(5) }],
    ];

    it.each(cases)('excludes a table with %s, with zero live API calls', async (_label, override) => {
      const { query } = mockAwsResourcesRows([
        { resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata(override) },
      ]);
      const awsClients = makeAwsClients();

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', awsClients);

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
      expect(awsClients.getDynamoDBClientForRegion).not.toHaveBeenCalled();
      expect(mockedDescribeDynamoDBTable).not.toHaveBeenCalled();
      expect(query).toHaveBeenCalledTimes(2); // set_config + the SELECT, nothing else
    });
  });

  it('never selects the generic aws_resources.estimated_monthly_cost placeholder', async () => {
    const { query } = mockAwsResourcesRows([]);
    await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

    const selectSql = query.mock.calls[1][0];
    expect(selectSql).not.toMatch(/estimated_monthly_cost/);
  });

  describe('live re-confirmation', () => {
    it('excludes a table whose fresh billing mode no longer matches PROVISIONED, even though persisted metadata said PROVISIONED', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({ billing_mode: 'PAY_PER_REQUEST', creation_date_time: isoDaysAgo(400) });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues).toHaveLength(0);
      expect(mockedFetchMetrics).not.toHaveBeenCalled();
    });

    it('excludes a table whose fresh autoscaling state is now ENABLED, even though persisted metadata said DISABLED', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_ENABLED');

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues).toHaveLength(0);
    });

    it('fails closed (excludes, no fabricated evidence) when live DescribeTable itself is unavailable', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockedDescribeDynamoDBTable.mockResolvedValueOnce({ status: 'unavailable', reason: 'Throttled' });

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues).toHaveLength(0);
      expect(mockedDescribeDynamoDBAutoscaling).not.toHaveBeenCalled();
    });

    it('fails closed when live Application Auto Scaling check is unavailable -- never assumes DISABLED', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockedDescribeDynamoDBAutoscaling.mockResolvedValueOnce({ status: 'unavailable', reason: 'AccessDenied' });

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues).toHaveLength(0);
    });

    it('uses the FRESH provisioned capacity for cost calculation, not the stale persisted metadata value', async () => {
      mockAwsResourcesRows([
        {
          resource_id: 'table-1',
          region: 'us-east-1',
          metadata: eligibleMetadata({ provisioned_read_capacity: 9999, provisioned_write_capacity: 9999 }),
        },
      ]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(uniformSeries(1000, 10, 500), uniformSeries(1000, 10, 200)); // both well below 20%, all-zero throttle

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].metadata.read.provisioned_read_capacity).toBe(500);
      expect(result.issues[0].metadata.write.provisioned_write_capacity).toBe(200);
      const expectedCurrentCost = estimateDynamoDBProvisionedMonthlyCost(500, 200, 'STANDARD');
      expect(result.issues[0].metadata.current_monthly_cost).toBeCloseTo(expectedCurrentCost, 5);
    });
  });

  describe('regional client usage', () => {
    it("uses the table's own persisted region for every regional client getter, not a default", async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'ap-southeast-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(uniformSeries(1000, 10, 500), uniformSeries(1000, 10, 200));
      const awsClients = makeAwsClients();

      await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', awsClients);

      expect(awsClients.getDynamoDBClientForRegion).toHaveBeenCalledWith('ap-southeast-1');
      expect(awsClients.getApplicationAutoScalingClientForRegion).toHaveBeenCalledWith('ap-southeast-1');
      expect(awsClients.getCloudWatchClientForRegion).toHaveBeenCalledWith('ap-southeast-1');
    });
  });

  describe('utilization eligibility boundaries', () => {
    async function runWithReadSeries(read: ReturnType<typeof uniformSeries>) {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      // Write dimension deliberately never qualifies (utilization at 90%, well above the 20% threshold) so each test isolates the read dimension's boundary behavior.
      mockMetrics(read, uniformSeries(1000, 180, 200));
      return (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());
    }

    it('qualifies at exactly the 85% low-utilization-interval threshold', async () => {
      // 1000 valid intervals: 850 at 10% (below 20%), 150 at 50% (at/above 20%) -> exactly 85%.
      const values = [...new Array(850).fill(10), ...new Array(150).fill(50)];
      const read = { intervalStartTimes: new Array(1000).fill(''), values, provisioned: new Array(1000).fill(100), throttle: new Array(1000).fill(0) };

      const result = await runWithReadSeries(read as any);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].metadata.read.qualifies).toBe(true);
      expect(result.issues[0].metadata.read.low_utilization_interval_percentage).toBeCloseTo(85, 5);
    });

    it('does not qualify at 84.9% (just below the 85% threshold)', async () => {
      const values = [...new Array(849).fill(10), ...new Array(151).fill(50)];
      const read = { intervalStartTimes: new Array(1000).fill(''), values, provisioned: new Array(1000).fill(100), throttle: new Array(1000).fill(0) };

      const result = await runWithReadSeries(read as any);

      expect(result.issues).toHaveLength(0);
    });

    it('qualifies at exactly 576 valid intervals (the minimum valid sample)', async () => {
      const read = uniformSeries(576, 10, 100); // 100% below threshold, satisfies the percentage gate trivially
      const result = await runWithReadSeries(read);

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].metadata.read.valid_intervals).toBe(576);
    });

    it('does not qualify at 575 valid intervals -- one short of the minimum valid sample', async () => {
      const read = uniformSeries(575, 10, 100);
      const result = await runWithReadSeries(read);

      expect(result.issues).toHaveLength(0);
    });
  });

  describe('read/write independence', () => {
    it('creates one recommendation when only the read dimension qualifies', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(uniformSeries(1000, 10, 500), uniformSeries(1000, 180, 200)); // read: 2% util (qualifies); write: 90% util (doesn't)

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].metadata.read.qualifies).toBe(true);
      expect(result.issues[0].metadata.write.qualifies).toBe(false);
      // The non-qualifying write dimension must contribute its own current (unchanged) capacity to the scenario.
      expect(result.issues[0].metadata.scenario_monthly_cost).toBeCloseTo(
        estimateDynamoDBProvisionedMonthlyCost(10, 200, 'STANDARD'),
        5
      );
    });

    it('creates one recommendation when only the write dimension qualifies', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(uniformSeries(1000, 450, 500), uniformSeries(1000, 10, 200)); // read: 90% util (doesn't qualify); write: 5% util (qualifies)

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].metadata.read.qualifies).toBe(false);
      expect(result.issues[0].metadata.write.qualifies).toBe(true);
    });

    it('creates one recommendation, not two, when both dimensions independently qualify', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(uniformSeries(1000, 10, 500), uniformSeries(1000, 10, 200));

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues).toHaveLength(1);
      expect(result.issues[0].metadata.read.qualifies).toBe(true);
      expect(result.issues[0].metadata.write.qualifies).toBe(true);
    });

    it('creates no recommendation when neither dimension qualifies', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(uniformSeries(1000, 450, 500), uniformSeries(1000, 180, 200));

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues).toHaveLength(0);
    });
  });

  describe('throttling gate', () => {
    it('disqualifies the read dimension when table-level read throttling is confirmed, even though utilization otherwise qualifies', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      const read = uniformSeries(1000, 10, 500);
      read.throttle[5] = 1; // one confirmed throttle event
      mockMetrics(read, uniformSeries(1000, 180, 200));

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues).toHaveLength(0); // read disqualified, write never qualified -> no recommendation at all
    });

    it('disqualifies a dimension when throttle datapoints are entirely missing -- never claims confirmed zero throttling from no evidence', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      const read = uniformSeries(1000, 10, 500, null); // utilization qualifies, but zero throttle evidence
      mockMetrics(read, uniformSeries(1000, 180, 200));

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues).toHaveLength(0);
    });

    it("evidence text says exactly 'no table-level provisioned-throughput ... throttling', never the broader 'no throttling occurred'", async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(uniformSeries(1000, 10, 500), uniformSeries(1000, 10, 200));

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues[0].description).toMatch(/Table-level provisioned-throughput read throttling: none observed/);
      expect(result.issues[0].description).not.toMatch(/no throttling occurred/i);
      expect(result.issues[0].description).toMatch(/do not by themselves rule out partition-level or account-level throttling/);
    });
  });

  describe('scenario / savings semantics', () => {
    it("savings_basis begins with 'ceiling:' -- an upper bound on the saving, never counted as an estimate", async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(uniformSeries(1000, 10, 500), uniformSeries(1000, 10, 200));

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues[0].metadata.savings_basis).toMatch(/^ceiling: highest_observed_hourly_average — upper bound on the monthly saving/);
      expect(classifySavingsBasis(result.issues[0].metadata.savings_basis)).toBe('ceiling');
      expect(result.issues[0].description).toMatch(/up to \$[0-9.]+\/month \(an upper bound/);
    });

    it('description explicitly states this is a scenario, not a recommended capacity setting, and invents no recommended_rcu/wcu fields', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(uniformSeries(1000, 10, 500), uniformSeries(1000, 10, 200));

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues[0].description).toMatch(/illustrative cost scenario, not a recommended capacity setting/);
      expect((result.issues[0].metadata as any).recommended_rcu).toBeUndefined();
      expect((result.issues[0].metadata as any).recommended_wcu).toBeUndefined();
      expect((result.issues[0].metadata as any).recommended_read_capacity).toBeUndefined();
      expect((result.issues[0].metadata as any).recommended_write_capacity).toBeUndefined();
    });

    it('issue string matches the registered ISSUE_DYNAMODB_CAPACITY identity', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockMetrics(uniformSeries(1000, 10, 500), uniformSeries(1000, 10, 200));

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues[0].issue).toBe(ISSUE_DYNAMODB_CAPACITY);
    });
  });

  // F-1 (never-zero/f1-build.md): a modeled saving that rounds to $0.00 (exactly 0, or float
  // residue) prints no dollar figure in the description; the finding, its stored figure, basis,
  // severity and counts are unchanged. A saving that rounds to $0.01 or more keeps the original
  // text byte for byte.
  describe('F-1: description when the modeled saving rounds to $0.00', () => {
    /** `count` intervals: the first `busy` at `busyPerSecond`, the rest at `quietPerSecond`, all against `provisioned`. */
    function mixedSeries(count: number, busy: number, busyPerSecond: number, quietPerSecond: number, provisioned: number) {
      const series = uniformSeries(count, quietPerSecond, provisioned);
      for (let i = 0; i < busy; i++) series.values[i] = busyPerSecond;
      return series;
    }

    async function detectZeroSavingTable() {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      // Read: 90% of intervals at 2% utilization (qualifies), plus 100 busy intervals at 100%, so the
      // highest hourly average equals the current 500 RCU and the scenario lowers nothing.
      // Write: 90% utilization (does not qualify, keeps its current 200 WCU).
      mockMetrics(mixedSeries(1000, 100, 500, 10, 500), uniformSeries(1000, 180, 200));
      return (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());
    }

    it('(a) saving 0: no dollar figure for the saving, and no "0.00" anywhere in the description', async () => {
      const result = await detectZeroSavingTable();
      expect(result.issues).toHaveLength(1);
      const description: string = result.issues[0].description;
      const savingsLine = description.split('\n').find((l) => l.startsWith('- Modeled monthly savings'));
      expect(savingsLine).toBe(
        '- Modeled monthly savings if provisioned capacity matched the highest hourly-average demand observed during the analysis window: ' +
          'none, because matching that demand would not lower the modeled monthly cost'
      );
      expect(savingsLine).not.toContain('$');
      expect(savingsLine).not.toContain('0.00');
      expect(description).not.toContain('0.00');
      expect(description).not.toMatch(/up to \$/);
      // The one dollar amount left is the genuine current modeled cost, not a saving.
      expect(description.match(/\$/g)).toHaveLength(1);
      expect(description).toContain('- Current modeled monthly cost: $142.35/month');
    });

    it('(c) saving 0: the finding is still created, with the same figure, basis, severity and count', async () => {
      const result = await detectZeroSavingTable();
      expect(result.issues).toHaveLength(1);
      const issue = result.issues[0];
      expect(issue.issue).toBe(ISSUE_DYNAMODB_CAPACITY);
      expect(issue.resourceType).toBe('DynamoDB');
      expect(issue.potentialSavings).toBe(0);
      expect(issue.severity).toBe('LOW');
      expect(issue.metadata.read.qualifies).toBe(true);
      expect(issue.metadata.write.qualifies).toBe(false);
      expect(classifySavingsBasis(issue.metadata.savings_basis)).toBe('ceiling');
      // Stored as NUMERIC(10,2) "0.00": counted exactly as before this fix (as a ceiling finding).
      const counts = countSavingsFindings([
        { resource_type: 'DynamoDB', potential_savings: '0.00', metadata: { savings_basis: issue.metadata.savings_basis } } as any,
      ]);
      expect(counts).toEqual({ estimatedFindings: 0, ceilingFindings: 1, unestimatedFindings: 0 });
    });

    it('float residue: a standard table at 1 RCU / 2 WCU modeled at 6 RCU / 1 WCU gets the no-figure line; the stored figure is unchanged', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 1,
        provisioned_write_capacity: 2,
        table_class: 'STANDARD',
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      // Read: 90% of intervals at 10% of 1 RCU (qualifies), highest hourly average 5.5/s -> 6 RCU.
      // Write: every interval at 5% of 2 WCU (qualifies), highest 0.1/s -> 1 WCU.
      // On STANDARD one WCU costs exactly five RCUs, so +5 RCU / -1 WCU is no change, but the float
      // subtraction leaves a positive residue of about 2.2e-16.
      mockMetrics(mixedSeries(1000, 100, 5.5, 0.1, 1), uniformSeries(1000, 0.1, 2));

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.issues).toHaveLength(1);
      const issue = result.issues[0];
      expect(issue.metadata.read.qualifies).toBe(true);
      expect(issue.metadata.write.qualifies).toBe(true);
      expect(issue.metadata.scenario_monthly_cost).toBe(estimateDynamoDBProvisionedMonthlyCost(6, 1, 'STANDARD'));
      // Stored figure, severity and basis: exactly what the detector computed before F-1.
      const residue = estimateDynamoDBProvisionedMonthlyCost(1, 2, 'STANDARD') - estimateDynamoDBProvisionedMonthlyCost(6, 1, 'STANDARD');
      expect(residue).toBeGreaterThan(0);
      expect(residue).toBeLessThan(0.005);
      expect(issue.potentialSavings).toBe(residue);
      expect(issue.severity).toBe('LOW');
      expect(classifySavingsBasis(issue.metadata.savings_basis)).toBe('ceiling');

      const description: string = issue.description;
      expect(description).toContain(
        'analysis window: none, because matching that demand would not lower the modeled monthly cost\n\n'
      );
      expect(description).not.toContain('0.00');
      expect(description).not.toMatch(/up to \$/);
      expect(description.match(/\$/g)).toHaveLength(1);
      expect(description).toContain('- Current modeled monthly cost: $1.04/month');
    });

    describe('(b) builder text: $0.01 or more keeps the original description byte for byte; $0.00 gets the no-figure text', () => {
      const analysis = {
        validUtilizationIntervals: 700,
        totalIntervals: 720,
        lowUtilizationPercentage: 97.4,
        highestHourlyAverageUtilizationPercent: 31.2,
        throttleValidIntervals: 700,
        throttleConfirmedIntervals: 0,
      };
      const input = {
        currentReadCapacity: 500,
        currentWriteCapacity: 200,
        readAnalysis: analysis,
        writeAnalysis: { ...analysis, lowUtilizationPercentage: 12, highestHourlyAverageUtilizationPercent: 90 },
        readQualifies: true,
        writeQualifies: false,
        billingMode: 'PROVISIONED',
        autoscalingState: 'AUTOSCALING_DISABLED',
        tableAgeDays: 400,
        currentMonthlyCost: 142.35,
      };
      const build = (modeledMonthlySavings: number): string =>
        (costOptimizationService as any).buildDynamoDBCapacityDescription({ ...input, modeledMonthlySavings });
      const ZERO_PHRASE = 'none, because matching that demand would not lower the modeled monthly cost';

      it('a positive saving: identical to the text before F-1 (captured at a8e46336)', () => {
        expect(build(12.345)).toBe(
          "DynamoDB capacity review identified\n\nRead capacity\n- Provisioned: 500 RCU\n- Valid intervals: 700/720\n- Intervals below 20% hourly-average utilization: 97%\n- Highest hourly-average utilization observed: 31%\n- Table-level provisioned-throughput read throttling: none observed\n- Qualifies for review: YES\n\nWrite capacity\n- Provisioned: 200 WCU\n- Valid intervals: 700/720\n- Intervals below 20% hourly-average utilization: 12%\n- Highest hourly-average utilization observed: 90%\n- Table-level provisioned-throughput write throttling: none observed\n- Qualifies for review: NO\n\nTable context\n- Billing mode: PROVISIONED\n- Autoscaling: AUTOSCALING_DISABLED\n- Global Secondary Indexes: none\n- Global Table replicas: none\n- Table age: 400 days\n- Capacity changes inside analysis window: none\n\nAnalysis\n- Window: 30 days\n- Period: 1 hour\n- Reference threshold: 20% hourly-average utilization -- AWS's own documented reference point for investigating possible over-provisioning, adopted by DevControl as its v1 investigation threshold. Not independently validated against DevControl's own customer base, and not an AWS-mandated rule.\n- DevControl qualification policy: >=85% of valid intervals below threshold, >=576/720 valid utilization sample required\n\nPotential cost scenario\n- Current modeled monthly cost: $142.35/month\n- Modeled monthly savings if provisioned capacity matched the highest hourly-average demand observed during the analysis window: up to $12.35/month (an upper bound: a safe setting needs headroom above that demand, so the real saving is lower)\n\nThis is an illustrative cost scenario, not a recommended capacity setting. Short-lived spikes narrower than one hour, workload growth, burst capacity, and other DynamoDB capacity considerations are not fully modeled. Table-level throttle metrics confirm no provisioned-throughput throttling at the table level; they do not by themselves rule out partition-level or account-level throttling."
        );
      });

      it.each([
        [0.005, '0.01'],
        [0.0051, '0.01'],
        [0.01, '0.01'],
        [0.0949, '0.09'],
        [1234.5, '1234.50'],
      ])('saving %p keeps "up to $%s/month (an upper bound ...)"', (saving, figure) => {
        const oldPhrase = `up to $${figure}/month (an upper bound: a safe setting needs headroom above that demand, so the real saving is lower)`;
        const text = build(saving);
        expect(text).toContain(`analysis window: ${oldPhrase}\n\n`);
        // Outside the savings phrase, the text is the same as the zero case.
        expect(text.split(oldPhrase)).toEqual(build(0).split(ZERO_PHRASE));
      });

      it.each([2.220446049250313e-16, 0.0049, 0.004999999999999999])(
        'saving %p rounds to $0.00: the same no-figure text as exactly 0',
        (saving) => {
          const text = build(saving);
          expect(text).toBe(build(0));
          expect(text).toContain(`analysis window: ${ZERO_PHRASE}\n\n`);
          expect(text).not.toContain('0.00');
        }
      );
    });
  });

  describe('failure handling', () => {
    it('returns success:false (never fabricates issues) when the aws_resources query itself fails', async () => {
      const client = { query: jest.fn().mockRejectedValueOnce(new Error('connection lost')), release: jest.fn() };
      (pool.connect as jest.Mock).mockResolvedValueOnce(client);

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.success).toBe(false);
      expect(result.issues).toEqual([]);
    });

    it('skips a table whose CloudWatch metrics are unavailable without failing the whole detector', async () => {
      mockAwsResourcesRows([{ resource_id: 'table-1', region: 'us-east-1', metadata: eligibleMetadata() }]);
      mockLiveDescribeTable({
        billing_mode: 'PROVISIONED',
        creation_date_time: isoDaysAgo(400),
        provisioned_read_capacity: 500,
        provisioned_write_capacity: 200,
      });
      mockLiveAutoscaling('AUTOSCALING_DISABLED');
      mockedFetchMetrics.mockResolvedValueOnce({ status: 'unavailable', reason: 'Throttled' });

      const result = await (costOptimizationService as any).detectDynamoDBCapacityOptimization('org-1', makeAwsClients());

      expect(result.success).toBe(true);
      expect(result.issues).toHaveLength(0);
    });
  });
});
