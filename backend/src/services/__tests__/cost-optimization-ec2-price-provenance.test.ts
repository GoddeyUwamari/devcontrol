/**
 * Cost Optimization PR 4 (founder decision 11 / Q7): the idle EC2 detector's
 * $50 default for an instance type missing from DevControl's list-price table.
 *
 *   - The figure stays $50 and stays an estimate (counted in totals).
 *   - It is marked metadata.price_source = 'default_unlisted_type', and it
 *     never sets severity: fixed LOW, metadata.severity_basis says why.
 *   - A listed type is marked 'list_table' and keeps the savings-threshold
 *     severity -- including a genuine list price of exactly $50, which is
 *     never treated as the default.
 *
 * Mock-only: no network calls to AWS.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import costOptimizationService, { EC2_MONTHLY_LIST_PRICES, EC2_UNLISTED_DEFAULT_MONTHLY_COST } from '../cost-optimization.service';
import {
  EC2_PRICE_SOURCE_DEFAULT,
  EC2_PRICE_SOURCE_LIST_TABLE,
  SEVERITY_BASIS_FIXED_LOW_UNKNOWN_PRICE,
  aggregateEstimatedSavings,
  classifySavingsBasis,
} from '../estimated-savings';

const LONG_RUNNING = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const CONFIG = { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 5, source: 'default' };
const GENUINE_FIFTY = 'x9.placeholder-fifty';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

/** `instanceType: undefined` omits InstanceType entirely. */
async function detect(instanceType: string | undefined, instanceId = 'i-pr4') {
  const ec2 = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({
    Reservations: [{ Instances: [{ InstanceId: instanceId, InstanceType: instanceType, LaunchTime: LONG_RUNNING, Placement: { AvailabilityZone: 'us-east-1a' } }] }],
  }));
  const cw = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({
    Datapoints: Array.from({ length: 168 }, () => ({ Average: 1 })),
  }));
  const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2, cw, CONFIG);
  expect(result.success).toBe(true);
  expect(result.issues).toHaveLength(1);
  return result.issues[0];
}

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => {
  jest.restoreAllMocks();
  delete EC2_MONTHLY_LIST_PRICES[GENUINE_FIFTY];
});

describe('idle EC2 price provenance', () => {
  it('1. a listed type: list price, threshold severity, list_table, and no severity_basis', async () => {
    const issue = await detect('m5.large');
    expect(issue.potentialSavings).toBe(70);
    expect(issue.severity).toBe('MEDIUM');
    expect(issue.metadata.price_source).toBe(EC2_PRICE_SOURCE_LIST_TABLE);
    expect(issue.metadata).not.toHaveProperty('severity_basis');

    const high = await detect('m5.xlarge');
    expect(high.potentialSavings).toBe(140);
    expect(high.severity).toBe('HIGH');

    const low = await detect('t3.micro');
    expect(low.severity).toBe('LOW');
    expect(low.metadata.price_source).toBe(EC2_PRICE_SOURCE_LIST_TABLE);
  });

  it('1b. a listed row is otherwise unchanged: same basis text and claim as before PR 4', async () => {
    const issue = await detect('m5.large');
    const { price_source: _added, cpu_evidence: _evidence, ...rest } = issue.metadata;
    expect(rest).toEqual({
      instance_type: 'm5.large',
      average_cpu: 1,
      days_analyzed: 7,
      savings_basis: 'estimated: compute cost from DevControl\'s list-price table (a default estimate for unlisted instance types); not billed cost or guaranteed savings',
      savings_claim: { kind: 'full_resource_cost', resource_ids: ['i-pr4'] },
      configuration: { parameter: 'cpu_threshold_percent', value: 5, source: 'default' },
    });
  });

  it('2. an unlisted type: $50, fixed LOW, marked as the default with its severity basis', async () => {
    const issue = await detect('z9.unlisted');
    expect(EC2_UNLISTED_DEFAULT_MONTHLY_COST).toBe(50);
    expect(issue.potentialSavings).toBe(50);
    expect(issue.severity).toBe('LOW');
    expect(issue.metadata.price_source).toBe(EC2_PRICE_SOURCE_DEFAULT);
    expect(issue.metadata.severity_basis).toBe(SEVERITY_BASIS_FIXED_LOW_UNKNOWN_PRICE);
  });

  it('3. the default would have been MEDIUM by the threshold rule -- proves it is excluded from severity', async () => {
    expect((costOptimizationService as any).calculateSeverity(EC2_UNLISTED_DEFAULT_MONTHLY_COST)).toBe('MEDIUM');
    expect((await detect('z9.unlisted')).severity).toBe('LOW');
  });

  it('4. a missing or empty instance type is the default, never a listed price', async () => {
    for (const type of [undefined, '']) {
      const issue = await detect(type);
      expect(issue.potentialSavings).toBe(50);
      expect(issue.severity).toBe('LOW');
      expect(issue.metadata.price_source).toBe(EC2_PRICE_SOURCE_DEFAULT);
    }
  });

  it('4b. an Object.prototype key is not a listed type', async () => {
    const issue = await detect('constructor');
    expect(issue.potentialSavings).toBe(50);
    expect(issue.metadata.price_source).toBe(EC2_PRICE_SOURCE_DEFAULT);
  });

  it('5. a genuine $50 list price is NOT the default: MEDIUM, list_table, no severity_basis', async () => {
    EC2_MONTHLY_LIST_PRICES[GENUINE_FIFTY] = 50;
    const issue = await detect(GENUINE_FIFTY);
    expect(issue.potentialSavings).toBe(50);
    expect(issue.severity).toBe('MEDIUM');
    expect(issue.metadata.price_source).toBe(EC2_PRICE_SOURCE_LIST_TABLE);
    expect(issue.metadata).not.toHaveProperty('severity_basis');
  });

  it('6. the default still classifies as an estimate and counts in totals (decision D2/D4)', async () => {
    const fallback = await detect('z9.unlisted', 'i-default');
    const listed = await detect('t3.micro', 'i-listed');
    expect(classifySavingsBasis(fallback.metadata.savings_basis)).toBe('estimate');
    expect(fallback.metadata.savings_basis).toBe(listed.metadata.savings_basis);
    const aggregate = aggregateEstimatedSavings([fallback, listed].map((i) => ({
      resource_type: i.resourceType, potential_savings: i.potentialSavings, metadata: i.metadata,
    })));
    expect(aggregate.total).toBe(57.5);
  });
});
