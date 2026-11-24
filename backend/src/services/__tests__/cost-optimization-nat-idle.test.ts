/**
 * C2: the idle NAT gateway detector (config/nat-gateway-idle-rule.ts,
 * nat-gateway-idle-evaluation.ts) against fake DescribeNatGateways,
 * DescribeRouteTables and GetMetricData answers. No network. Every identifier
 * is an invented placeholder; IPs are documentation ranges (RFC 5737).
 *
 * Covers: an idle gateway; busy gateways (each of the five metrics on its own);
 * activity winning on incomplete data; the completeness contract per metric
 * (a missing, repeated, off-the-hour or out-of-window datapoint, mismatched
 * arrays, malformed values, an empty series -- never read as zero);
 * PartialData / Forbidden / InternalError / throttled / denied reads; age
 * (created inside the window, at its start, no create time); state and
 * availability mode scope; route evidence (named tables, main table, subnets,
 * destinations, blackhole routes, other gateways' routes, ended associations,
 * no inference from subnets) and unreadable routes; regional pricing, no price
 * for the region, provisioned bandwidth, private gateways; listing failures and
 * paging; attribution and home-region wiring; the run's counts by reason.
 */
import costOptimizationService from '../cost-optimization.service';
import { AWSClientFactory } from '../aws-client-factory.service';
import { OptimizationRuleConfigService } from '../optimization-rule-config.service';
import { natIdleWindow, NAT_IDLE_HOURS_REQUIRED } from '../nat-gateway-idle-evaluation';
import { NAT_GATEWAY_IDLE_RULE } from '../../config/nat-gateway-idle-rule';
import { ISSUE_NAT_GATEWAY_IDLE } from '../../config/optimization-rules';
import { classifySavingsBasis } from '../estimated-savings';
import { summarizeDetectors } from '../cost-analysis-outcome';
import { fakeClient, accessDenied } from './helpers/low-activity-aws';

const service = costOptimizationService as any;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-11-24T12:00:00.000Z');
const WINDOW = natIdleWindow(NOW);
const OLD = new Date(WINDOW.start.getTime() - 10 * DAY);

const METRICS = ['ActiveConnectionCount', 'PacketsInFromSource', 'PacketsInFromDestination', 'BytesInFromSource', 'BytesInFromDestination'] as const;
type MetricName = (typeof METRICS)[number];
type HourValue = (hour: number) => number | null;
interface RawResult { Timestamps: Date[]; Values: number[]; StatusCode?: string }
interface FakeNatMetrics {
  /** Hourly value per metric (null: no datapoint that hour); default 0 every hour. */
  values?: Partial<Record<MetricName, HourValue>>;
  /** StatusCode for every query of this gateway (default Complete). */
  status?: 'Complete' | 'PartialData' | 'Forbidden' | 'InternalError';
  /** Per-metric raw answer, replacing the generated one. */
  raw?: Partial<Record<MetricName, RawResult>>;
  /** Per-metric StatusCode. */
  statusOf?: Partial<Record<MetricName, string>>;
}

function gateway(id: string, overrides: Record<string, unknown> = {}) {
  return {
    NatGatewayId: id,
    State: 'available',
    ConnectivityType: 'public',
    VpcId: 'vpc-placeholder-a',
    SubnetId: 'subnet-placeholder-public-a',
    CreateTime: OLD,
    NatGatewayAddresses: [{ AllocationId: `eipalloc-placeholder-${id}`, PublicIp: '192.0.2.10', PrivateIp: '10.0.0.10', AvailabilityZone: 'us-east-1a', NetworkInterfaceId: 'eni-placeholder-a' }],
    ...overrides,
  };
}

function routeTable(id: string, routesTo: Array<{ nat?: string; cidr?: string; ipv6?: string; prefixList?: string; state?: string }>, options: { name?: string; main?: boolean; subnets?: string[]; associations?: unknown[] } = {}) {
  return {
    RouteTableId: id,
    VpcId: 'vpc-placeholder-a',
    Routes: [
      { DestinationCidrBlock: '10.0.0.0/16', GatewayId: 'local', State: 'active' },
      ...routesTo.map((r) => ({
        ...(r.cidr ? { DestinationCidrBlock: r.cidr } : {}),
        ...(r.ipv6 ? { DestinationIpv6CidrBlock: r.ipv6 } : {}),
        ...(r.prefixList ? { DestinationPrefixListId: r.prefixList } : {}),
        ...(r.nat ? { NatGatewayId: r.nat } : { GatewayId: 'igw-placeholder' }),
        State: r.state ?? 'active',
      })),
    ],
    Associations: options.associations ?? [
      ...(options.main ? [{ Main: true, RouteTableId: id, AssociationState: { State: 'associated' } }] : []),
      ...(options.subnets ?? []).map((subnet) => ({ Main: false, SubnetId: subnet, RouteTableId: id, AssociationState: { State: 'associated' } })),
    ],
    ...(options.name ? { Tags: [{ Key: 'Name', Value: options.name }, { Key: 'team', Value: 'placeholder' }] } : {}),
  };
}

type RouteAnswer = unknown[] | Error | 'incomplete';
function fakeNatEc2(gateways: unknown[] | Error, routes: RouteAnswer = []) {
  return fakeClient((command: any) => {
    const name = command.constructor.name;
    if (name === 'DescribeNatGatewaysCommand') {
      if (gateways instanceof Error) throw gateways;
      return { NatGateways: gateways };
    }
    if (name === 'DescribeRouteTablesCommand') {
      if (routes instanceof Error) throw routes;
      if (routes === 'incomplete') return { RouteTables: [], NextToken: 'always-more' };
      return { RouteTables: routes };
    }
    throw new Error(`unexpected ${name}`);
  });
}

function hourly(fn: HourValue): RawResult {
  const Timestamps: Date[] = [];
  const Values: number[] = [];
  for (let h = 0; h < NAT_IDLE_HOURS_REQUIRED; h++) {
    const v = fn(h);
    if (v === null) continue;
    Timestamps.push(new Date(WINDOW.start.getTime() + h * HOUR));
    Values.push(v);
  }
  return { Timestamps, Values };
}

function fakeNatCloudWatch(byGateway: Record<string, FakeNatMetrics> | Error) {
  return fakeClient((command: any) => {
    if (byGateway instanceof Error) throw byGateway;
    const results = (command.input.MetricDataQueries as any[]).map((q) => {
      const id = q.MetricStat.Metric.Dimensions[0].Value as string;
      const metric = q.MetricStat.Metric.MetricName as MetricName;
      const spec = byGateway[id] ?? {};
      const raw = spec.raw?.[metric] ?? hourly(spec.values?.[metric] ?? (() => 0));
      return { Id: q.Id, Label: metric, Timestamps: raw.Timestamps, Values: raw.Values, StatusCode: raw.StatusCode ?? spec.statusOf?.[metric] ?? spec.status ?? 'Complete' };
    });
    return { MetricDataResults: results };
  });
}

async function detect(gateways: unknown[] | Error, metrics: Record<string, FakeNatMetrics> | Error = {}, options: { routes?: RouteAnswer; region?: string; now?: Date } = {}) {
  const ec2 = fakeNatEc2(gateways, options.routes ?? []);
  const cloudWatch = fakeNatCloudWatch(metrics);
  const result = await service.detectIdleNatGateways({ ec2, cloudWatch }, options.region ?? 'us-east-1', options.now ?? NOW);
  return { result, ec2, cloudWatch };
}

const ids = (result: any) => result.issues.map((i: any) => i.resourceId);
const sumCounts = (c: any) =>
  c.flagged + [c.not_flagged, c.couldnt_check, c.excluded].reduce((sum: number, bucket: Record<string, number>) => sum + Object.values(bucket).reduce((a, b) => a + b, 0), 0);

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('idle NAT gateways: an idle gateway', () => {
  it('finds an available zonal gateway with an hourly 0 for all five metrics in every hour of 32 complete days', async () => {
    const { result, cloudWatch } = await detect([gateway('nat-placeholder-idle')]);
    expect(result.success).toBe(true);
    expect(result.endActiveForUnknown).toBe(true);
    expect(result.unknownResourceIds).toEqual([]);
    expect(ids(result)).toEqual(['nat-placeholder-idle']);

    const [query] = cloudWatch.send.mock.calls[0];
    const sent = (query.input.MetricDataQueries as any[]).map((q) => [q.MetricStat.Metric.Namespace, q.MetricStat.Metric.MetricName, q.MetricStat.Stat, q.MetricStat.Period, q.MetricStat.Metric.Dimensions]);
    expect(sent).toEqual([
      ['AWS/NATGateway', 'ActiveConnectionCount', 'Maximum', 3600, [{ Name: 'NatGatewayId', Value: 'nat-placeholder-idle' }]],
      ['AWS/NATGateway', 'PacketsInFromSource', 'Sum', 3600, [{ Name: 'NatGatewayId', Value: 'nat-placeholder-idle' }]],
      ['AWS/NATGateway', 'PacketsInFromDestination', 'Sum', 3600, [{ Name: 'NatGatewayId', Value: 'nat-placeholder-idle' }]],
      ['AWS/NATGateway', 'BytesInFromSource', 'Sum', 3600, [{ Name: 'NatGatewayId', Value: 'nat-placeholder-idle' }]],
      ['AWS/NATGateway', 'BytesInFromDestination', 'Sum', 3600, [{ Name: 'NatGatewayId', Value: 'nat-placeholder-idle' }]],
    ]);
    expect(query.input.StartTime).toEqual(WINDOW.start);
    expect(query.input.EndTime).toEqual(WINDOW.end);
  });

  it('the window is the last 32 complete UTC days ending at UTC midnight of (now - 2 h); 768 hours', () => {
    expect(WINDOW.end.toISOString()).toBe('2026-11-24T00:00:00.000Z');
    expect(WINDOW.start.toISOString()).toBe('2026-10-23T00:00:00.000Z');
    expect(NAT_IDLE_HOURS_REQUIRED).toBe(768);
    // 01:30 UTC is inside the 2 h settle lag: the window still ends at the previous midnight.
    expect(natIdleWindow(new Date('2026-11-24T01:30:00.000Z')).end.toISOString()).toBe('2026-11-23T00:00:00.000Z');
  });

  it('stores the rule identity, the evidence, an estimate at the regional hourly list price and the attribution', async () => {
    const { result } = await detect([gateway('nat-placeholder-idle', { Tags: [{ Key: 'Name', Value: 'placeholder-nat' }, { Key: 'owner', Value: 'placeholder' }] })]);
    const [finding] = result.issues;
    expect(finding).toMatchObject({
      resourceId: 'nat-placeholder-idle',
      resourceName: 'placeholder-nat',
      resourceType: 'NAT Gateway',
      issue: ISSUE_NAT_GATEWAY_IDLE,
      potentialSavings: 32.85,
      severity: 'LOW',
      awsRegion: 'us-east-1',
    });
    const m = finding.metadata;
    expect(m.rule_version).toBe(1);
    expect(m.rule).toEqual(JSON.parse(JSON.stringify(NAT_GATEWAY_IDLE_RULE)));
    expect(m.nat_gateway_idle).toEqual({
      evaluated_at: NOW.toISOString(),
      window_start: WINDOW.start.toISOString(),
      window_end: WINDOW.end.toISOString(),
      create_time: OLD.toISOString(),
      state: 'available',
      connectivity_type: 'public',
      availability_mode: null,
      vpc_id: 'vpc-placeholder-a',
      subnet_id: 'subnet-placeholder-public-a',
      availability_zone: 'us-east-1a',
      addresses: [{ allocation_id: 'eipalloc-placeholder-nat-placeholder-idle', public_ip: '192.0.2.10', private_ip: '10.0.0.10' }],
      completeness: 'complete',
      hours_checked: 768,
      totals: { active_connection_count_max: 0, packets_in_from_source: 0, packets_in_from_destination: 0, bytes_in_from_source: 0, bytes_in_from_destination: 0 },
      routes: { checked: true, route_table_count: 0, route_tables: [] },
    });
    expect(m.savings_basis).toBe('estimated: the us-east-1 NAT gateway hourly list price ($0.045/hour, 730 hours) for a gateway that is available but processed no traffic; data processing was $0; the Elastic IP is not included; not billed cost');
    expect(classifySavingsBasis(m.savings_basis)).toBe('estimate');
    expect(m).toMatchObject({ price_per_hour: 0.045, price_region: 'us-east-1', price_published: '2026-11-23T17:10:05Z' });
    expect(m.price_source).toBe('https://b0.p.awsstatic.com/pricing/2.0/meteredUnitMaps/ec2/USD/current/natgateway.json');
    expect(m.savings_note).toBeUndefined();
    // Only the Name tag reaches the finding; no other tag value is stored.
    expect(JSON.stringify(m)).not.toContain('owner');
    expect(finding.description).toBe('In the last 32 days this NAT gateway had no connections and processed no traffic, and no route table sends traffic to it. Check whether it is a disaster-recovery standby; otherwise delete it, and release its Elastic IP to stop that charge too.');
  });

  it('a gateway created exactly at the window start is evaluated; an explicit zonal mode is evaluated', async () => {
    const { result } = await detect([gateway('nat-placeholder-a', { CreateTime: WINDOW.start }), gateway('nat-placeholder-b', { AvailabilityMode: 'zonal' })]);
    expect(ids(result)).toEqual(['nat-placeholder-a', 'nat-placeholder-b']);
  });

  it('a private gateway is evaluated the same way, with no Elastic IP in its description or basis', async () => {
    const { result } = await detect([gateway('nat-placeholder-private', { ConnectivityType: 'private', NatGatewayAddresses: [{ PrivateIp: '10.0.0.20', NetworkInterfaceId: 'eni-placeholder-b' }] })]);
    const [finding] = result.issues;
    expect(finding.description).toBe('In the last 32 days this NAT gateway had no connections and processed no traffic, and no route table sends traffic to it. Check whether it is a disaster-recovery standby; otherwise delete it.');
    expect(finding.metadata.savings_basis).not.toContain('Elastic IP');
    expect(finding.metadata.nat_gateway_idle.connectivity_type).toBe('private');
    expect(finding.potentialSavings).toBe(32.85);
  });
});

describe('idle NAT gateways: activity wins', () => {
  it('a busy gateway (traffic on every metric) is not idle', async () => {
    const busy = Object.fromEntries(METRICS.map((m) => [m, () => 1200])) as FakeNatMetrics['values'];
    const { result } = await detect([gateway('nat-placeholder-busy')], { 'nat-placeholder-busy': { values: busy } });
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([]);
    expect(result.natIdle.not_flagged.active_connections).toBe(1);
  });

  it.each([
    ['ActiveConnectionCount', 'active_connections'],
    ['PacketsInFromSource', 'packets_from_source'],
    ['PacketsInFromDestination', 'packets_from_destination'],
    ['BytesInFromSource', 'bytes_from_source'],
    ['BytesInFromDestination', 'bytes_from_destination'],
  ] as const)('one non-zero hour of %s alone (value 1) makes it not idle, counted under %s', async (metric, reason) => {
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { values: { [metric]: (h: number) => (h === 500 ? 1 : 0) } } });
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([]);
    expect(result.natIdle.not_flagged[reason]).toBe(1);
    expect(result.natIdle.flagged).toBe(0);
  });

  it('a fraction above 0 is traffic too (exactly 0 is the threshold)', async () => {
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { values: { BytesInFromDestination: (h: number) => (h === 3 ? 0.5 : 0) } } });
    expect(result.natIdle.not_flagged.bytes_from_destination).toBe(1);
  });

  it('activity wins on incomplete data: a non-zero hour on a series with missing hours and a PartialData status', async () => {
    const { result } = await detect([gateway('nat-placeholder-a')], {
      'nat-placeholder-a': { values: { PacketsInFromSource: (h: number) => (h < 10 ? null : h === 20 ? 4 : 0) }, statusOf: { PacketsInFromSource: 'PartialData' } },
    });
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([]);
    expect(result.natIdle.not_flagged.packets_from_source).toBe(1);
  });

  it('activity wins over age: traffic on a gateway created inside the window is not idle (not couldn\'t check)', async () => {
    const { result } = await detect([gateway('nat-placeholder-a', { CreateTime: new Date(WINDOW.start.getTime() + 5 * DAY) })], { 'nat-placeholder-a': { values: { ActiveConnectionCount: () => 3 } } });
    expect(result.natIdle.not_flagged.active_connections).toBe(1);
    expect(result.unknownResourceIds).toEqual([]);
  });
});

describe('idle NAT gateways: completeness -- missing or malformed data is couldn\'t check, never zero', () => {
  const unknownOnly = (result: any, reason: string) => {
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['nat-placeholder-a']);
    expect(result.natIdle.couldnt_check[reason]).toBe(1);
    expect(result.natIdle.flagged).toBe(0);
  };

  it.each(METRICS)('one missing hour of %s alone (the other four complete) is couldn\'t check', async (metric) => {
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { values: { [metric]: (h: number) => (h === 767 ? null : 0) } } });
    unknownOnly(result, 'cloudwatch_incomplete');
  });

  it('a whole missing day on one metric is couldn\'t check', async () => {
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { values: { BytesInFromSource: (h: number) => (h >= 24 && h < 48 ? null : 0) } } });
    unknownOnly(result, 'cloudwatch_incomplete');
  });

  it('an empty series (status Complete, no datapoints) is never read as zero', async () => {
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { raw: { PacketsInFromDestination: { Timestamps: [], Values: [] } } } });
    unknownOnly(result, 'cloudwatch_incomplete');
  });

  it('a metric AWS never returned (its query Id missing from the answer) is couldn\'t check', async () => {
    const ec2 = fakeNatEc2([gateway('nat-placeholder-a')]);
    const cloudWatch = fakeClient((command: any) => ({
      MetricDataResults: (command.input.MetricDataQueries as any[])
        .filter((q) => q.MetricStat.Metric.MetricName !== 'BytesInFromSource')
        .map((q) => ({ Id: q.Id, ...hourly(() => 0), StatusCode: 'Complete' })),
    }));
    const result = await service.detectIdleNatGateways({ ec2, cloudWatch }, 'us-east-1', NOW);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['nat-placeholder-a']);
    expect(result.natIdle.couldnt_check.cloudwatch_failed).toBe(1);
  });

  it('a repeated hour replacing a missing one (768 datapoints, 767 distinct hours) is couldn\'t check', async () => {
    const raw = hourly(() => 0);
    raw.Timestamps[767] = new Date(WINDOW.start.getTime() + 766 * HOUR);
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { raw: { ActiveConnectionCount: raw } } });
    unknownOnly(result, 'cloudwatch_incomplete');
  });

  it('an extra, repeated hour (769 datapoints) is couldn\'t check', async () => {
    const raw = hourly(() => 0);
    raw.Timestamps.push(new Date(WINDOW.start.getTime() + 100 * HOUR));
    raw.Values.push(0);
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { raw: { PacketsInFromSource: raw } } });
    unknownOnly(result, 'cloudwatch_incomplete');
  });

  it('a datapoint off the hour (a different period) is couldn\'t check, even with 768 datapoints', async () => {
    const raw = hourly(() => 0);
    raw.Timestamps[200] = new Date(WINDOW.start.getTime() + 200 * HOUR + 30 * 60 * 1000);
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { raw: { BytesInFromDestination: raw } } });
    unknownOnly(result, 'cloudwatch_incomplete');
  });

  it('a datapoint at the window end (outside the half-open window) is couldn\'t check', async () => {
    const raw = hourly(() => 0);
    raw.Timestamps[767] = new Date(WINDOW.end.getTime());
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { raw: { PacketsInFromDestination: raw } } });
    unknownOnly(result, 'cloudwatch_incomplete');
  });

  it('a datapoint before the window start is couldn\'t check', async () => {
    const raw = hourly(() => 0);
    raw.Timestamps[0] = new Date(WINDOW.start.getTime() - HOUR);
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { raw: { ActiveConnectionCount: raw } } });
    unknownOnly(result, 'cloudwatch_incomplete');
  });

  it('more values than timestamps is couldn\'t check', async () => {
    const raw = hourly(() => 0);
    raw.Timestamps.pop();
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { raw: { BytesInFromSource: raw } } });
    unknownOnly(result, 'cloudwatch_incomplete');
  });

  it.each([['NaN', Number.NaN], ['negative', -1], ['infinite', Number.POSITIVE_INFINITY]])('a %s value is couldn\'t check, never idle', async (_label, bad) => {
    const raw = hourly(() => 0);
    raw.Values[10] = bad as number;
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { raw: { PacketsInFromSource: raw } } });
    unknownOnly(result, 'cloudwatch_incomplete');
  });

  it.each([['PartialData'], ['InternalError'], ['Forbidden']])('a %s status on one metric (values all 0) is couldn\'t check', async (status) => {
    const { result } = await detect([gateway('nat-placeholder-a')], { 'nat-placeholder-a': { statusOf: { BytesInFromDestination: status } } });
    unknownOnly(result, 'cloudwatch_failed');
  });

  it.each([
    ['throttling', Object.assign(new Error('slow down'), { name: 'ThrottlingException' })],
    ['permission denied', accessDenied()],
    ['a failed request', new Error('boom')],
  ])('%s on GetMetricData makes every candidate couldn\'t check', async (_label, error) => {
    const { result } = await detect([gateway('nat-placeholder-a'), gateway('nat-placeholder-b')], error as Error);
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['nat-placeholder-a', 'nat-placeholder-b']);
    expect(result.natIdle.couldnt_check.cloudwatch_failed).toBe(2);
  });

  it('one gateway\'s bad data does not affect another\'s finding', async () => {
    const { result } = await detect([gateway('nat-placeholder-a'), gateway('nat-placeholder-b')], { 'nat-placeholder-a': { values: { ActiveConnectionCount: (h: number) => (h === 0 ? null : 0) } } });
    expect(ids(result)).toEqual(['nat-placeholder-b']);
    expect(result.unknownResourceIds).toEqual(['nat-placeholder-a']);
  });
});

describe('idle NAT gateways: age and scope', () => {
  it('created one second after the window start is couldn\'t check (too new), even with complete zeros', async () => {
    const { result } = await detect([gateway('nat-placeholder-a', { CreateTime: new Date(WINDOW.start.getTime() + 1000) })]);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['nat-placeholder-a']);
    expect(result.natIdle.couldnt_check.too_new).toBe(1);
  });

  it('no create time is couldn\'t check (too new)', async () => {
    const { result } = await detect([gateway('nat-placeholder-a', { CreateTime: undefined })]);
    expect(result.unknownResourceIds).toEqual(['nat-placeholder-a']);
    expect(result.natIdle.couldnt_check.too_new).toBe(1);
  });

  it('pending is couldn\'t check, with no metric or route read', async () => {
    const { result, cloudWatch, ec2 } = await detect([gateway('nat-placeholder-a', { State: 'pending' })]);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['nat-placeholder-a']);
    expect(result.natIdle.couldnt_check.pending).toBe(1);
    expect(cloudWatch.send).not.toHaveBeenCalled();
    expect(ec2.count('DescribeRouteTablesCommand')).toBe(0);
  });

  it.each(['deleting', 'deleted', 'failed'])('%s is excluded: no finding, not unknown, no metric read', async (state) => {
    const { result, cloudWatch } = await detect([gateway('nat-placeholder-a', { State: state })]);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([]);
    expect(result.natIdle.excluded[state]).toBe(1);
    expect(cloudWatch.send).not.toHaveBeenCalled();
  });

  it('a regional gateway is excluded (counted, never flagged, never unknown), whatever its state', async () => {
    const { result, cloudWatch } = await detect([gateway('nat-placeholder-a', { AvailabilityMode: 'regional' }), gateway('nat-placeholder-b', { AvailabilityMode: 'regional', State: 'pending' })]);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([]);
    expect(result.natIdle.excluded.regional).toBe(2);
    expect(cloudWatch.send).not.toHaveBeenCalled();
  });

  it('a state or availability mode the rule does not know, or no state, is couldn\'t check (unrecognised)', async () => {
    const { result } = await detect([
      gateway('nat-placeholder-a', { State: 'resizing' }),
      gateway('nat-placeholder-b', { AvailabilityMode: 'multi-zone' }),
      gateway('nat-placeholder-c', { State: undefined }),
    ]);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['nat-placeholder-a', 'nat-placeholder-b', 'nat-placeholder-c']);
    expect(result.natIdle.couldnt_check.unrecognised).toBe(3);
  });

  it('a gateway with no id is skipped and not counted', async () => {
    const { result } = await detect([{ State: 'available', CreateTime: OLD }]);
    expect(result.natIdle.evaluated).toBe(0);
    expect(result.issues).toEqual([]);
  });
});

describe('idle NAT gateways: routes are evidence, not eligibility (ruling R1)', () => {
  it('a gateway that route tables still send traffic to is flagged, naming them: Name tag else id, main table marked, subnets, destinations, states', async () => {
    const routes = [
      routeTable('rtb-placeholder-b', [{ nat: 'nat-placeholder-a', cidr: '0.0.0.0/0' }], { subnets: ['subnet-placeholder-2', 'subnet-placeholder-1'] }),
      routeTable('rtb-placeholder-a', [{ nat: 'nat-placeholder-a', cidr: '0.0.0.0/0', state: 'blackhole' }, { nat: 'nat-placeholder-a', ipv6: '64:ff9b::/96' }], { name: 'placeholder-private-rt', main: true }),
      routeTable('rtb-placeholder-c', [{ nat: 'nat-placeholder-other', cidr: '0.0.0.0/0' }], { subnets: ['subnet-placeholder-9'] }),
    ];
    const { result } = await detect([gateway('nat-placeholder-a')], {}, { routes });
    const [finding] = result.issues;
    expect(finding.resourceId).toBe('nat-placeholder-a');
    expect(finding.metadata.nat_gateway_idle.routes).toEqual({
      checked: true,
      route_table_count: 2,
      route_tables: [
        { id: 'rtb-placeholder-a', name: 'placeholder-private-rt', main: true, subnet_ids: [], routes: [{ destination: '0.0.0.0/0', state: 'blackhole' }, { destination: '64:ff9b::/96', state: 'active' }] },
        { id: 'rtb-placeholder-b', name: null, main: false, subnet_ids: ['subnet-placeholder-1', 'subnet-placeholder-2'], routes: [{ destination: '0.0.0.0/0', state: 'active' }] },
      ],
    });
    expect(finding.description).toBe(
      'In the last 32 days this NAT gateway had no connections and processed no traffic, although 2 route tables still send traffic to it (placeholder-private-rt (main), rtb-placeholder-b), covering 2 associated subnets plus every subnet that uses the VPC\'s main route table. Check whether those subnets still need outbound access and whether it is a standby. Before deleting it, remove or redirect those routes, or they will be left blackholed. After deleting it, release its Elastic IP to stop that charge too.'
    );
    // The routes don't change the dollar figure.
    expect(finding.potentialSavings).toBe(32.85);
  });

  it('only the main route table: described without counting the subnets it serves', async () => {
    const routes = [routeTable('rtb-placeholder-main', [{ nat: 'nat-placeholder-a', cidr: '0.0.0.0/0' }], { main: true })];
    const { result } = await detect([gateway('nat-placeholder-a')], {}, { routes });
    expect(result.issues[0].description).toContain('although 1 route table still sends traffic to it (rtb-placeholder-main (main)), including the VPC\'s main route table, used by every subnet without its own.');
  });

  it('a route table with a route to the gateway but no subnet associated', async () => {
    const routes = [routeTable('rtb-placeholder-a', [{ nat: 'nat-placeholder-a', prefixList: 'pl-placeholder' }])];
    const { result } = await detect([gateway('nat-placeholder-a')], {}, { routes });
    expect(result.issues[0].description).toContain('(rtb-placeholder-a); no subnet is associated with it.');
    expect(result.issues[0].metadata.nat_gateway_idle.routes.route_tables[0].routes).toEqual([{ destination: 'pl-placeholder', state: 'active' }]);
  });

  it('ended associations (disassociated, failed) are not counted; associating and disassociating still are', async () => {
    const routes = [routeTable('rtb-placeholder-a', [{ nat: 'nat-placeholder-a', cidr: '0.0.0.0/0' }], {
      associations: [
        { SubnetId: 'subnet-placeholder-gone', AssociationState: { State: 'disassociated' } },
        { Main: true, AssociationState: { State: 'failed' } },
        { SubnetId: 'subnet-placeholder-new', AssociationState: { State: 'associating' } },
        { SubnetId: 'subnet-placeholder-leaving', AssociationState: { State: 'disassociating' } },
      ],
    })];
    const { result } = await detect([gateway('nat-placeholder-a')], {}, { routes });
    expect(result.issues[0].metadata.nat_gateway_idle.routes.route_tables[0]).toMatchObject({ main: false, subnet_ids: ['subnet-placeholder-leaving', 'subnet-placeholder-new'] });
  });

  it('never infers a route: the gateway\'s own subnet\'s table and the VPC\'s main table without a route to it are not listed', async () => {
    const routes = [
      routeTable('rtb-placeholder-public', [{ cidr: '0.0.0.0/0' }], { subnets: ['subnet-placeholder-public-a'] }),
      routeTable('rtb-placeholder-main', [], { main: true }),
    ];
    const { result } = await detect([gateway('nat-placeholder-a')], {}, { routes });
    expect(result.issues[0].metadata.nat_gateway_idle.routes).toEqual({ checked: true, route_table_count: 0, route_tables: [] });
    expect(result.issues[0].description).toContain('no route table sends traffic to it');
  });

  it('names at most five route tables, then says how many more', async () => {
    const routes = Array.from({ length: 7 }, (_, i) => routeTable(`rtb-placeholder-${i}`, [{ nat: 'nat-placeholder-a', cidr: '0.0.0.0/0' }], { subnets: [`subnet-placeholder-${i}`] }));
    const { result } = await detect([gateway('nat-placeholder-a')], {}, { routes });
    expect(result.issues[0].description).toContain('7 route tables still send traffic to it (rtb-placeholder-0, rtb-placeholder-1, rtb-placeholder-2, rtb-placeholder-3, rtb-placeholder-4 and 2 more), covering 7 associated subnets.');
    expect(result.issues[0].metadata.nat_gateway_idle.routes.route_table_count).toBe(7);
  });

  it.each([
    ['permission denied', accessDenied()],
    ['throttling', Object.assign(new Error('slow down'), { name: 'ThrottlingException' })],
    ['an incomplete listing (page limit)', 'incomplete' as const],
  ])('a route read that fails (%s) makes every idle candidate couldn\'t check -- never "no routes"', async (_label, routes) => {
    const { result } = await detect([gateway('nat-placeholder-a'), gateway('nat-placeholder-b')], { 'nat-placeholder-b': { values: { ActiveConnectionCount: () => 1 } } }, { routes });
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['nat-placeholder-a']);
    expect(result.natIdle.couldnt_check.routes_unreadable).toBe(1);
    // A busy gateway is still answered by its metrics.
    expect(result.natIdle.not_flagged.active_connections).toBe(1);
  });

  it('a route table without an id that routes to the gateway makes that gateway couldn\'t check; another gateway is still found', async () => {
    const nameless = { ...routeTable('rtb-placeholder-x', [{ nat: 'nat-placeholder-a', cidr: '0.0.0.0/0' }]), RouteTableId: undefined };
    const { result } = await detect([gateway('nat-placeholder-a'), gateway('nat-placeholder-b')], {}, { routes: [nameless] });
    expect(ids(result)).toEqual(['nat-placeholder-b']);
    expect(result.unknownResourceIds).toEqual(['nat-placeholder-a']);
    expect(result.natIdle.couldnt_check.routes_unreadable).toBe(1);
  });

  it('reads every route table page, passing the token on (MaxResults 100)', async () => {
    const ec2 = fakeClient((command: any) => {
      const name = command.constructor.name;
      if (name === 'DescribeNatGatewaysCommand') return { NatGateways: [gateway('nat-placeholder-a')] };
      if (command.input.NextToken === undefined) return { RouteTables: [], NextToken: 'rtb-page-2' };
      if (command.input.NextToken === 'rtb-page-2') return { RouteTables: [routeTable('rtb-placeholder-p2', [{ nat: 'nat-placeholder-a', cidr: '0.0.0.0/0' }], { subnets: ['subnet-placeholder-1'] })] };
      throw new Error('unexpected token');
    });
    const result = await service.detectIdleNatGateways({ ec2, cloudWatch: fakeNatCloudWatch({}) }, 'us-east-1', NOW);
    expect(result.issues[0].metadata.nat_gateway_idle.routes.route_tables.map((t: any) => t.id)).toEqual(['rtb-placeholder-p2']);
    const routeCalls = ec2.send.mock.calls.filter(([c]: any[]) => c.constructor.name === 'DescribeRouteTablesCommand');
    expect(routeCalls.map(([c]: any[]) => c.input)).toEqual([{ MaxResults: 100, NextToken: undefined }, { MaxResults: 100, NextToken: 'rtb-page-2' }]);
  });
});

describe('idle NAT gateways: pricing per region, never another region\'s', () => {
  it.each([
    ['eu-west-1', 0.048, 35.04, 'LOW'],
    ['ap-southeast-5', 0.05015, 36.61, 'LOW'],
    ['sa-east-1', 0.093, 67.89, 'MEDIUM'],
  ])('%s: $%s/hour x 730 = $%s/month, severity %s', async (region, price, monthly, severity) => {
    const { result } = await detect([gateway('nat-placeholder-a')], {}, { region });
    const [finding] = result.issues;
    expect(finding.awsRegion).toBe(region);
    expect(finding.potentialSavings).toBe(monthly);
    expect(finding.severity).toBe(severity);
    expect(finding.metadata).toMatchObject({ price_per_hour: price, price_region: region });
    expect(finding.metadata.savings_basis).toContain(`the ${region} NAT gateway hourly list price ($${price}/hour, 730 hours)`);
  });

  it.each(['us-gov-west-1', 'xx-nowhere-1'])('%s (no price in the table): no dollar estimate, fixed Low -- never a fallback price', async (region) => {
    const { result } = await detect([gateway('nat-placeholder-a')], {}, { region });
    const [finding] = result.issues;
    expect(finding.potentialSavings).toBe(0);
    expect(finding.severity).toBe('LOW');
    expect(finding.metadata.savings_basis).toBeUndefined();
    expect(finding.metadata.savings_note).toBe('no_price_for_region');
    expect(finding.metadata.severity_basis).toBe('fixed_low_unknown_price');
    expect(finding.metadata.price_per_hour).toBeUndefined();
    expect(classifySavingsBasis(finding.metadata.savings_basis)).toBeNull();
  });

  it('a gateway with provisioned bandwidth: no dollar estimate (undocumented price model)', async () => {
    const { result } = await detect([gateway('nat-placeholder-a', { ProvisionedBandwidth: { Provisioned: '10', Status: 'provisioned' } })]);
    const [finding] = result.issues;
    expect(finding.potentialSavings).toBe(0);
    expect(finding.metadata.savings_basis).toBeUndefined();
    expect(finding.metadata.savings_note).toBe('provisioned_bandwidth');
    expect(finding.severity).toBe('LOW');
  });

  it('an empty provisioned-bandwidth object carries no setting and does not block the estimate', async () => {
    const { result } = await detect([gateway('nat-placeholder-a', { ProvisionedBandwidth: {} })]);
    expect(result.issues[0].potentialSavings).toBe(32.85);
  });
});

describe('idle NAT gateways: listing', () => {
  it('a failed DescribeNatGateways (permission denied) fails the category: no finding, rows untouched, classed as permissions', async () => {
    const { result } = await detect(accessDenied());
    expect(result).toEqual({ success: false, issues: [], failureReason: 'permissions' });
  });

  it('a throttled DescribeNatGateways is classed rate_limited', async () => {
    const { result } = await detect(Object.assign(new Error('slow down'), { name: 'ThrottlingException' }));
    expect(result).toEqual({ success: false, issues: [], failureReason: 'rate_limited' });
  });

  it('an incomplete listing (page limit) fails the category, classed too_many_resources', async () => {
    const ec2 = fakeClient(() => ({ NatGateways: [gateway('nat-placeholder-a')], NextToken: 'always-more' }));
    const result = await service.detectIdleNatGateways({ ec2, cloudWatch: fakeNatCloudWatch({}) }, 'us-east-1', NOW);
    expect(result).toEqual({ success: false, issues: [], failureReason: 'too_many_resources' });
  });

  it('reads every page (MaxResults 1000), passing the token on; page 2 data takes effect', async () => {
    const ec2 = fakeClient((command: any) => {
      if (command.constructor.name === 'DescribeRouteTablesCommand') return { RouteTables: [] };
      if (command.input.NextToken === undefined) return { NatGateways: [gateway('nat-placeholder-p1')], NextToken: 'nat-page-2' };
      if (command.input.NextToken === 'nat-page-2') return { NatGateways: [gateway('nat-placeholder-p2')] };
      throw new Error('unexpected token');
    });
    const result = await service.detectIdleNatGateways({ ec2, cloudWatch: fakeNatCloudWatch({}) }, 'us-east-1', NOW);
    expect(ids(result)).toEqual(['nat-placeholder-p1', 'nat-placeholder-p2']);
    const natCalls = ec2.send.mock.calls.filter(([c]: any[]) => c.constructor.name === 'DescribeNatGatewaysCommand');
    expect(natCalls.map(([c]: any[]) => c.input)).toEqual([{ MaxResults: 1000, NextToken: undefined }, { MaxResults: 1000, NextToken: 'nat-page-2' }]);
  });

  it('no gateways: success with nothing found, and no route or metric read', async () => {
    const { result, ec2, cloudWatch } = await detect([]);
    expect(result).toMatchObject({ success: true, issues: [], unknownResourceIds: [] });
    expect(ec2.count('DescribeRouteTablesCommand')).toBe(0);
    expect(cloudWatch.send).not.toHaveBeenCalled();
  });
});

describe('idle NAT gateways: the run\'s counts by reason', () => {
  it('counts every listed gateway exactly once (evaluated = the sum of every bucket)', async () => {
    const { result } = await detect([
      gateway('nat-placeholder-idle'),
      gateway('nat-placeholder-busy'),
      gateway('nat-placeholder-gap'),
      gateway('nat-placeholder-new', { CreateTime: new Date(WINDOW.end.getTime() - DAY) }),
      gateway('nat-placeholder-pending', { State: 'pending' }),
      gateway('nat-placeholder-deleted', { State: 'deleted' }),
      gateway('nat-placeholder-regional', { AvailabilityMode: 'regional' }),
    ], {
      'nat-placeholder-busy': { values: { BytesInFromSource: () => 10 } },
      'nat-placeholder-gap': { values: { PacketsInFromDestination: (h: number) => (h === 1 ? null : 0) } },
    });
    const counts = result.natIdle;
    expect(counts).toEqual({
      evaluated: 7,
      flagged: 1,
      not_flagged: { active_connections: 0, packets_from_source: 0, packets_from_destination: 0, bytes_from_source: 1, bytes_from_destination: 0 },
      couldnt_check: { pending: 1, unrecognised: 0, too_new: 1, cloudwatch_failed: 0, cloudwatch_incomplete: 1, routes_unreadable: 0 },
      excluded: { regional: 1, deleting: 0, deleted: 1, failed: 0 },
    });
    expect(sumCounts(counts)).toBe(counts.evaluated);
    expect(result.unknownResourceIds.sort()).toEqual(['nat-placeholder-gap', 'nat-placeholder-new', 'nat-placeholder-pending']);
    expect(JSON.stringify(counts)).not.toContain('nat-placeholder');
  });

  it('a failed listing carries no counts', async () => {
    expect((await detect(accessDenied())).result.natIdle).toBeUndefined();
  });
});

describe('C2 wiring in analyzeAllResources', () => {
  it('the idle NAT check runs on the home-region clients; rows it could not check are dropped (endActiveForUnknown), with its counts', async () => {
    const clients = { enabled: true, region: 'eu-west-1', ec2: {}, rds: {}, s3: {}, lambda: {}, cloudWatch: {}, backup: {} };
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clients as any);
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockResolvedValue({ ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default' } as any);
    for (const detector of [
      'detectLowActivityEC2Instances', 'detectUnusedElasticIPs', 'detectUnattachedEBSVolumes', 'detectGp2ToGp3Migrations',
      'detectS3LifecycleOptimization', 'detectLowUsageLambdaFunctions', 'detectDynamoDBCapacityOptimization',
      'detectDynamoDBOnDemandVsProvisionedOptimization', 'detectReservedInstanceOpportunities', 'detectIdleRDSInstances', 'detectOldEBSSnapshots',
    ]) {
      jest.spyOn(service, detector).mockResolvedValue({ success: true, issues: [] });
    }
    const natCounts = { evaluated: 1, flagged: 0, not_flagged: {}, couldnt_check: { routes_unreadable: 1 }, excluded: {} };
    const nat = jest.spyOn(service, 'detectIdleNatGateways').mockResolvedValue({ success: true, issues: [], unknownResourceIds: ['nat-placeholder-a'], endActiveForUnknown: true, natIdle: natCounts });

    const analysis = await costOptimizationService.analyzeAllResources('org-c2-wiring');

    expect(analysis.homeRegion).toBe('eu-west-1');
    expect(nat).toHaveBeenCalledTimes(1);
    expect(nat.mock.calls[0][1]).toBe('eu-west-1');
    expect((nat.mock.calls[0][0] as any).region).toBe('eu-west-1');
    expect(analysis.observations.find((o) => o.issue === ISSUE_NAT_GATEWAY_IDLE)).toEqual({
      issue: ISSUE_NAT_GATEWAY_IDLE, success: true, recommendations: [], unknownResourceIds: ['nat-placeholder-a'], endActiveForUnknown: true, natIdle: natCounts,
    });
  });

  it('a failed NAT check carries its failure class to the run record (failure_reason, never error text)', async () => {
    const clients = { enabled: true, region: 'eu-west-1', ec2: {}, rds: {}, s3: {}, lambda: {}, cloudWatch: {}, backup: {} };
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clients as any);
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockResolvedValue({ ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default' } as any);
    for (const detector of [
      'detectLowActivityEC2Instances', 'detectUnusedElasticIPs', 'detectUnattachedEBSVolumes', 'detectGp2ToGp3Migrations',
      'detectS3LifecycleOptimization', 'detectLowUsageLambdaFunctions', 'detectDynamoDBCapacityOptimization',
      'detectDynamoDBOnDemandVsProvisionedOptimization', 'detectReservedInstanceOpportunities', 'detectIdleRDSInstances', 'detectOldEBSSnapshots',
    ]) {
      jest.spyOn(service, detector).mockResolvedValue({ success: true, issues: [] });
    }
    const real = service.detectIdleNatGateways.bind(service);
    jest.spyOn(service, 'detectIdleNatGateways').mockImplementation((_clients: any, region: any) =>
      real({ ec2: fakeNatEc2(accessDenied()), cloudWatch: fakeNatCloudWatch({}) }, region, NOW));

    const analysis = await costOptimizationService.analyzeAllResources('org-c2-wiring');
    const observation = analysis.observations.find((o) => o.issue === ISSUE_NAT_GATEWAY_IDLE)!;
    expect(observation).toMatchObject({ success: false, failureReason: 'permissions', recommendations: [] });
    const check = summarizeDetectors(analysis.observations, true, []).checks.find((c) => c.issue === ISSUE_NAT_GATEWAY_IDLE)!;
    expect(check).toMatchObject({ rule_id: 'nat_gateway_idle', outcome: 'failed', failure_reason: 'permissions' });
    expect(check).not.toHaveProperty('nat_idle');
  });

  it('a finding is passed to reconciliation with its region, resource type, id and estimate', async () => {
    const clients = { enabled: true, region: 'eu-west-1', ec2: {}, rds: {}, s3: {}, lambda: {}, cloudWatch: {}, backup: {} };
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clients as any);
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockResolvedValue({ ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default' } as any);
    for (const detector of [
      'detectLowActivityEC2Instances', 'detectUnusedElasticIPs', 'detectUnattachedEBSVolumes', 'detectGp2ToGp3Migrations',
      'detectS3LifecycleOptimization', 'detectLowUsageLambdaFunctions', 'detectDynamoDBCapacityOptimization',
      'detectDynamoDBOnDemandVsProvisionedOptimization', 'detectReservedInstanceOpportunities', 'detectIdleRDSInstances', 'detectOldEBSSnapshots',
    ]) {
      jest.spyOn(service, detector).mockResolvedValue({ success: true, issues: [] });
    }
    const real = service.detectIdleNatGateways.bind(service);
    jest.spyOn(service, 'detectIdleNatGateways').mockImplementation((_clients: any, region: any) =>
      real({ ec2: fakeNatEc2([gateway('nat-placeholder-a')]), cloudWatch: fakeNatCloudWatch({}) }, region, NOW));

    const analysis = await costOptimizationService.analyzeAllResources('org-c2-wiring');
    const observation = analysis.observations.find((o) => o.issue === ISSUE_NAT_GATEWAY_IDLE)!;
    expect(observation.recommendations).toHaveLength(1);
    expect(observation.recommendations[0]).toMatchObject({
      resource_id: 'nat-placeholder-a', resource_type: 'NAT Gateway', issue: ISSUE_NAT_GATEWAY_IDLE, aws_region: 'eu-west-1', potential_savings: 35.04, severity: 'LOW',
    });
  });
});
