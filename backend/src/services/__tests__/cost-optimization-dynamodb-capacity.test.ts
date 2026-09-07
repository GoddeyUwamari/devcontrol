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
 * always starts with `scenario:`, never `ceiling:`; the generic $3
 * aws_resources.estimated_monthly_cost placeholder is never read.
 */
import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { ApplicationAutoScalingClient } from '@aws-sdk/client-application-auto-scaling';
import costOptimizationService from '../cost-optimization.service';
import { ISSUE_DYNAMODB_CAPACITY } from '../../config/optimization-rules';
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
    it("savings_basis begins with 'scenario:' and never 'ceiling:'", async () => {
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

      expect(result.issues[0].metadata.savings_basis).toMatch(/^scenario:/);
      expect(result.issues[0].metadata.savings_basis).not.toMatch(/^ceiling:/);
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
