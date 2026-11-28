/**
 * The shared inventory pricing rule and aggregation (placeholder-costs PR 1,
 * founder rulings F-2, F-6, F-7, F-9, F-10, F-11).
 */
import {
  aggregateInventoryCosts,
  aggregateInventoryRows,
  formatInventoryUsd,
  inventoryCost,
  inventoryCostCell,
  inventoryCoverageText,
  INVENTORY_PRICE_BASIS,
  LAMBDA_PRICE_BASIS,
  inventoryRunRateCoverageText,
  type InventoryCost,
  type InventoryCostRow,
} from '../inventory-cost';
import { estimateLambdaMonthlyCostFromUsage } from '../../config/aws-pricing';

const NOW = new Date('2026-11-28T12:00:00Z');
const cost = (row: InventoryCostRow) => inventoryCost(row, NOW);

// Rows whose every F-2 assumption is established.
const RDS: InventoryCostRow = {
  resource_type: 'rds', region: 'us-east-1', status: 'available', stored_monthly_cost: '24.82',
  metadata: { engine: 'mysql', multi_az: false, db_instance_class: 'db.t3.small' },
};
const EBS: InventoryCostRow = {
  resource_type: 'ebs', region: 'us-east-1', status: 'in-use', stored_monthly_cost: '10.00',
  metadata: { volume_type: 'gp2', size_gb: 100 },
};
const LAMBDA: InventoryCostRow = {
  resource_type: 'lambda', region: 'us-east-1', status: 'Active', stored_monthly_cost: '0.42',
  metadata: { architecture: 'x86_64', cost_basis: 'usage_based: real 30-day CloudWatch Invocations/Duration x published on-demand pricing', usage_state: 'normal_usage', invocations_30d: 1_000_000, avg_duration_ms: 100, memory: 128 },
};
const withMeta = (row: InventoryCostRow, patch: Record<string, unknown>): InventoryCostRow => ({ ...row, metadata: { ...(row.metadata as object), ...patch } });
const without = (row: InventoryCostRow, key: string): InventoryCostRow => {
  const m = { ...(row.metadata as Record<string, unknown>) };
  delete m[key];
  return { ...row, metadata: m };
};

/** Every flat placeholder Stage A lists (P1, P2, P5, P6, P7), stored the legacy way: a value, no basis. */
const PLACEHOLDERS: Array<[string, InventoryCostRow]> = [
  ['ECS service $9 (incl. Fargate, F-9)', { resource_type: 'ecs', region: 'us-east-1', status: 'active', stored_monthly_cost: '9.00', metadata: { launch_type: 'FARGATE' } }],
  ['EKS cluster $73', { resource_type: 'eks', region: 'us-east-1', status: 'active', stored_monthly_cost: '73.00', metadata: {} }],
  ['DynamoDB $3', { resource_type: 'dynamodb', region: 'us-east-1', status: 'active', stored_monthly_cost: '3.00', metadata: { billing_mode: 'PROVISIONED' } }],
  ['API Gateway $3.50', { resource_type: 'api-gateway', region: 'us-east-1', status: 'active', stored_monthly_cost: '3.50', metadata: {} }],
  ['ElastiCache $25', { resource_type: 'elasticache', region: 'us-east-1', status: 'active', stored_monthly_cost: '25.00', metadata: {} }],
  ['Aurora cluster $150 (F-10)', { resource_type: 'aurora', region: 'us-east-1', status: 'available', stored_monthly_cost: '150.00', metadata: { engine: 'aurora-mysql' } }],
  ['SQS $0.40', { resource_type: 'sqs', region: 'us-east-1', status: 'active', stored_monthly_cost: '0.40', metadata: {} }],
  ['SNS $0.50', { resource_type: 'sns', region: 'us-east-1', status: 'not_applicable', stored_monthly_cost: '0.50', metadata: {} }],
  ['S3 $5', { resource_type: 's3', region: 'us-east-1', status: 'not_applicable', stored_monthly_cost: '5.00', metadata: {} }],
  ['load balancer $74.83', { resource_type: 'load-balancer', region: 'us-east-1', status: 'active', stored_monthly_cost: '74.83', metadata: { type: 'network' } }],
  ['CloudFront $8.50', { resource_type: 'cloudfront', region: 'us-east-1', status: 'active', stored_monthly_cost: '8.50', metadata: {} }],
  ['EC2 $50 unknown type', { resource_type: 'ec2', region: 'us-east-1', status: 'running', stored_monthly_cost: '50.00', metadata: { instance_type: 'x9.mega' } }],
  ['EC2 table type, running', { resource_type: 'ec2', region: 'us-east-1', status: 'running', stored_monthly_cost: '60.00', metadata: { instance_type: 't3.large' } }],
  ['RDS $75 unknown class', withMeta(RDS, { db_instance_class: 'db.x9.huge' })],
  ['P7: a Multi-AZ DB cluster reclassified to rds, keeping $150', { resource_type: 'rds', region: 'us-east-1', status: 'available', stored_monthly_cost: '150.00', metadata: { engine: 'postgres', reclassified_from: 'aurora' } }],
  ['EBS unknown type (gp2 rate fallback)', withMeta(EBS, { volume_type: 'unknown' })],
  ['an unknown resource type', { resource_type: 'something-new', region: 'us-east-1', status: 'active', stored_monthly_cost: '12.00', metadata: {} }],
];

describe('inventoryCost: priced only when every F-2 assumption is established', () => {
  it('RDS: us-east-1, MySQL/MariaDB, Single-AZ, available, a table class -> the table price, labelled', () => {
    // Fix round 1 (ruling 2): AWS list price, db.t3.small $0.034/h x 730 = $24.82 (was the hand-typed $24).
    expect(cost(RDS)).toEqual({ kind: 'priced', amount: 24.82, basis: INVENTORY_PRICE_BASIS, detail: 'instance hours only; excludes storage, I/O and backups' });
    expect(cost(withMeta(RDS, { engine: 'mariadb' }))).toMatchObject({ kind: 'priced', amount: 24.82 });
    expect(cost(withMeta(RDS, { db_instance_class: 'db.m5.large' }))).toMatchObject({ kind: 'priced', amount: 124.83 });
    expect(INVENTORY_PRICE_BASIS).toBe('us-east-1 list-price estimate');
  });

  it('RDS: the amount comes from the table, never from the stored figure', () => {
    expect(cost({ ...RDS, stored_monthly_cost: '24.00' })).toMatchObject({ kind: 'priced', amount: 24.82 });
  });

  it.each([
    ['region missing', { ...RDS, region: null }],
    ['region not us-east-1', { ...RDS, region: 'eu-west-1' }],
    ['engine missing', without(RDS, 'engine')],
    ['engine PostgreSQL (the table tracks MySQL/MariaDB)', withMeta(RDS, { engine: 'postgres' })],
    ['engine licensed (SQL Server)', withMeta(RDS, { engine: 'sqlserver-se' })],
    ['Multi-AZ true', withMeta(RDS, { multi_az: true })],
    ['Multi-AZ not recorded', without(RDS, 'multi_az')],
    ['status not available (running state not established)', { ...RDS, status: 'modifying' }],
    ['status unknown', { ...RDS, status: 'unknown' }],
    ['class missing', without(RDS, 'db_instance_class')],
    ['no stored figure', { ...RDS, stored_monthly_cost: null }],
    ['metadata missing', { ...RDS, metadata: null }],
  ])('RDS, one assumption missing (%s) -> no_price', (_name, row) => {
    expect(cost(row).kind).toBe('no_price');
  });

  it('EBS: us-east-1, a fully priced type, in-use or available -> size x rate, storage only', () => {
    expect(cost(EBS)).toEqual({ kind: 'priced', amount: 10, basis: INVENTORY_PRICE_BASIS, detail: 'volume storage only' });
    expect(cost({ ...EBS, status: 'available' })).toMatchObject({ kind: 'priced', amount: 10 });
    expect(cost(withMeta(EBS, { volume_type: 'gp3', iops: 3000, throughput: 125 }))).toMatchObject({ kind: 'priced', amount: 8 });
    expect(cost(withMeta(EBS, { volume_type: 'st1' }))).toMatchObject({ kind: 'priced', amount: 4.5 });
    expect(cost(withMeta(EBS, { volume_type: 'sc1' }))).toMatchObject({ kind: 'priced', amount: 1.5 });
  });

  it.each([
    ['region not us-east-1', { ...EBS, region: 'ap-south-1' }],
    ['region missing', { ...EBS, region: undefined }],
    ['state not established', { ...EBS, status: 'creating' }],
    ['type missing', without(EBS, 'volume_type')],
    ['io1 (provisioned IOPS charged separately)', withMeta(EBS, { volume_type: 'io1' })],
    ['io2', withMeta(EBS, { volume_type: 'io2' })],
    ['magnetic (I/O requests charged separately)', withMeta(EBS, { volume_type: 'standard' })],
    ['gp3 above the IOPS baseline', withMeta(EBS, { volume_type: 'gp3', iops: 6000, throughput: 125 })],
    ['gp3 above the throughput baseline', withMeta(EBS, { volume_type: 'gp3', iops: 3000, throughput: 500 })],
    ['gp3 performance not recorded', withMeta(EBS, { volume_type: 'gp3' })],
    ['size missing', without(EBS, 'size_gb')],
    ['size 0', withMeta(EBS, { size_gb: 0 })],
    ['no stored figure', { ...EBS, stored_monthly_cost: undefined }],
  ])('EBS, one assumption missing (%s) -> no_price', (_name, row) => {
    expect(cost(row).kind).toBe('no_price');
  });

  it('Lambda: us-east-1, x86_64, a recorded usage basis -> recomputed from the stored usage, labelled "before free tier"', () => {
    const expected = estimateLambdaMonthlyCostFromUsage(1_000_000, 100, 128);
    // Fix round 1 (ruling 1): Lambda's own basis label.
    expect(LAMBDA_PRICE_BASIS).toBe('us-east-1 list price, before free tier');
    expect(cost(LAMBDA)).toEqual({ kind: 'priced', amount: expected, basis: 'us-east-1 list price, before free tier', detail: 'requests and duration from 30 days of CloudWatch usage' });
    expect(inventoryCostCell(cost(LAMBDA))).toBe(`${formatInventoryUsd(expected)} (us-east-1 list price, before free tier; requests and duration from 30 days of CloudWatch usage)`);
    expect(cost(withMeta(LAMBDA, { usage_state: 'zero_usage', invocations_30d: 0 }))).toMatchObject({ kind: 'priced', amount: 0 });
  });

  it.each([
    ['region not us-east-1', { ...LAMBDA, region: 'eu-west-1' }],
    ['arm64', withMeta(LAMBDA, { architecture: 'arm64' })],
    ['architecture missing', without(LAMBDA, 'architecture')],
    ['no usage basis recorded', without(LAMBDA, 'cost_basis')],
    ['usage unavailable on the latest discovery', withMeta(LAMBDA, { usage_state: 'unavailable' })],
    ['invocations missing', without(LAMBDA, 'invocations_30d')],
    ['memory missing', without(LAMBDA, 'memory')],
    ['no stored figure', { ...LAMBDA, stored_monthly_cost: null }],
  ])('Lambda, one assumption missing (%s) -> no_price', (_name, row) => {
    expect(cost(row).kind).toBe('no_price');
  });
});

describe('inventoryCost: the other kinds', () => {
  it('F-6: an EC2 instance AWS reports as exactly "stopped" is not running, whatever its stored figure', () => {
    expect(cost({ resource_type: 'ec2', region: 'eu-west-1', status: 'stopped', stored_monthly_cost: '60.00', metadata: { instance_type: 't3.large', instance_state: 'stopped' } }).kind).toBe('not_running');
  });

  it.each([
    ['stopping (billed while hibernating)', 'stopping'],
    ['shutting-down', 'shutting-down'],
    ['a legacy row with no recorded state', undefined],
    ['a null state', null],
  ])('fix round 1 (ruling 8): stored status "stopped" but %s -> No price, never "Not running"', (_name, state) => {
    const row = { resource_type: 'ec2', region: 'us-east-1', status: 'stopped', stored_monthly_cost: '60.00', metadata: { instance_type: 't3.large', ...(state !== undefined ? { instance_state: state } : {}) } };
    expect(cost(row).kind).toBe('no_price');
  });

  it('a running instance with instance_state "stopped" (stale status mismatch) is not treated as stopped', () => {
    expect(cost({ resource_type: 'ec2', region: 'us-east-1', status: 'running', metadata: { instance_type: 't3.large', instance_state: 'stopped' } }).kind).toBe('no_price');
  });

  it('F-6 + AWS RDS docs: a stopped RDS instance observed within seven days is not running; older -> no_price', () => {
    const stopped = { ...RDS, status: 'stopped', region: 'eu-west-1' };
    expect(cost({ ...stopped, last_synced_at: '2026-11-27T12:00:00Z' }).kind).toBe('not_running');
    expect(cost({ ...stopped, last_synced_at: new Date('2026-11-21T12:00:00Z') }).kind).toBe('not_running');
    expect(cost({ ...stopped, last_synced_at: '2026-11-21T11:59:00Z' }).kind).toBe('no_price');
    expect(cost({ ...stopped, last_synced_at: null }).kind).toBe('no_price');
    expect(cost({ ...stopped, last_synced_at: 'not a date' }).kind).toBe('no_price');
  });

  it('F-7: a VPC has no direct charge, whatever its stored figure', () => {
    expect(cost({ resource_type: 'vpc', region: 'us-east-1', status: 'available', stored_monthly_cost: '0.00', metadata: {} }).kind).toBe('no_direct_charge');
    expect(inventoryCostCell(cost({ resource_type: 'vpc' }))).toBe('No direct charge. NAT gateways, endpoints and data transfer are charged separately.');
  });

  it('F-10: an Aurora member instance never carries a figure, even with a table class, and even when stopped', () => {
    const member = withMeta(RDS, { engine: 'aurora-postgresql' });
    expect(cost(member).kind).toBe('no_price');
    expect(cost({ ...member, status: 'stopped', last_synced_at: '2026-11-28T00:00:00Z' }).kind).toBe('no_price');
    expect(cost(withMeta(RDS, { engine: 'aurora' })).kind).toBe('no_price');
  });

  it('F-10: an Aurora cluster row plus its member rows contribute nothing to a total', () => {
    const rows = [PLACEHOLDERS.find(([n]) => n.startsWith('Aurora'))![1], withMeta(RDS, { engine: 'aurora-mysql' }), withMeta(RDS, { engine: 'aurora-mysql', db_instance_class: 'db.r5.large' })];
    expect(aggregateInventoryRows(rows, NOW)).toMatchObject({ pricedResources: 0, totalResources: 3, amount: null });
  });

  it.each(PLACEHOLDERS)('a flat placeholder is never a price: %s', (_name, row) => {
    expect(cost(row).kind).toBe('no_price');
    expect(inventoryCostCell(cost(row))).toBe('No price');
  });

  it('F-11: an old stored value with no basis (any type, any amount, including 0.00 and the column default) is no_price', () => {
    for (const stored of ['0.00', '9.00', '150.00', null]) {
      expect(cost({ resource_type: 'ecs', region: 'us-east-1', status: 'active', stored_monthly_cost: stored, metadata: {} }).kind).toBe('no_price');
      expect(cost({ resource_type: 'rds', region: 'us-east-1', status: 'available', stored_monthly_cost: stored, metadata: {} }).kind).toBe('no_price');
    }
  });

  it('a terminated row is never priced', () => {
    expect(cost({ ...RDS, status: 'terminated' }).kind).toBe('no_price');
  });

  it('metadata stored as a JSON string is read; malformed metadata is no_price', () => {
    expect(cost({ ...RDS, metadata: JSON.stringify(RDS.metadata) }).kind).toBe('priced');
    expect(cost({ ...RDS, metadata: '{not json' }).kind).toBe('no_price');
  });
});

describe('cells and money', () => {
  it('a priced cell carries the amount, its basis and what it covers', () => {
    expect(inventoryCostCell(cost(RDS))).toBe('$24.82 (us-east-1 list-price estimate; instance hours only; excludes storage, I/O and backups)');
  });

  it('a positive amount under a cent is "<$0.01", never "$0.00"; a genuine priced zero is "$0.00"', () => {
    expect(formatInventoryUsd(0.003)).toBe('<$0.01');
    expect(formatInventoryUsd(0)).toBe('$0.00');
    expect(formatInventoryUsd(1234.5)).toBe('$1,234.50');
  });

  it('the exact words for the non-priced kinds', () => {
    expect(inventoryCostCell({ kind: 'no_price', reason: 'x' })).toBe('No price');
    expect(inventoryCostCell({ kind: 'not_running', reason: 'x' })).toBe('Not running: no instance-hour charge');
  });
});

describe('aggregateInventoryCosts: sums only priced amounts, K of N', () => {
  const priced = (amount: number): InventoryCost => ({ kind: 'priced', amount, basis: INVENTORY_PRICE_BASIS, detail: '' });

  it('K of N is correct; not-running and no-direct-charge are outside N (fix round 1, ruling 9)', () => {
    const total = aggregateInventoryCosts([priced(10), priced(2.5), { kind: 'no_price', reason: '' }, { kind: 'not_running', reason: '' }, { kind: 'no_direct_charge', reason: '' }]);
    expect(total).toEqual({ pricedResources: 2, totalResources: 3, excludedResources: 2, amount: 12.5, notRunning: 1, noDirectCharge: 1, noPrice: 1 });
    expect(inventoryCoverageText(total)).toBe('2 of 3 priced · 2 not running or no direct charge');
    expect(inventoryRunRateCoverageText(total)).toBe('Estimated from 2 of 3 priced · 2 not running or no direct charge');
  });

  it('with no excluded resources the M part is omitted', () => {
    const total = aggregateInventoryCosts([priced(1), { kind: 'no_price', reason: '' }]);
    expect(inventoryCoverageText(total)).toBe('1 of 2 priced');
  });

  it('no_price is never counted as 0: a priced total is unchanged by any number of unpriced rows', () => {
    const base = aggregateInventoryCosts([priced(7)]);
    const more = aggregateInventoryCosts([priced(7), ...Array(50).fill({ kind: 'no_price', reason: '' })]);
    expect(more.amount).toBe(base.amount);
    expect(more.pricedResources).toBe(1);
    expect(more.totalResources).toBe(51);
    expect(more.excludedResources).toBe(0);
  });

  it('nothing priced -> no total (null), never $0.00', () => {
    expect(aggregateInventoryCosts(PLACEHOLDERS.map(([, r]) => cost(r))).amount).toBeNull();
    expect(aggregateInventoryCosts([]).amount).toBeNull();
    expect(aggregateInventoryCosts([{ kind: 'no_direct_charge', reason: '' }, { kind: 'not_running', reason: '' }]).amount).toBeNull();
  });

  it('a mixed legacy inventory sums only the defensibly priced rows', () => {
    const rows = [RDS, EBS, ...PLACEHOLDERS.map(([, r]) => r), { resource_type: 'vpc' }];
    const total = aggregateInventoryRows(rows, NOW);
    expect(total.pricedResources).toBe(2);
    expect(total.totalResources).toBe(PLACEHOLDERS.length + 2);
    expect(total.excludedResources).toBe(1);
    expect(total.amount).toBeCloseTo(34.82, 10);
  });
});
