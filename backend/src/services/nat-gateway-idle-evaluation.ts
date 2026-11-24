/**
 * The idle NAT gateway rule (config/nat-gateway-idle-rule.ts) applied to what
 * was read from AWS. Pure: no AWS calls, no database, no clock (the caller
 * passes `now`). Same shape as the idle RDS evaluation (rds-idle-evaluation.ts),
 * which it does not change.
 *
 * One NAT gateway goes through, in this order:
 *   0. scope (judgeNatScope): deleting/deleted/failed and regional gateways are
 *      excluded; pending, or a state or availability mode this rule does not
 *      know, is couldn't check;
 *   1. activity (activity wins): any datapoint above 0 in the window, on any of
 *      the five metrics, makes it "not idle" -- even when the data is
 *      otherwise incomplete;
 *   2. age: created inside the window (or no creation time) -> couldn't check;
 *   3. data: any of the five queries not 'complete' -> couldn't check;
 *   4. completeness: each metric, on its own, has exactly one datapoint for
 *      every hour of the window and nothing else (no missing, repeated,
 *      off-the-hour or out-of-window datapoint, no malformed value) -> else
 *      couldn't check. A missing datapoint is never read as zero;
 *   5. routes: the route listing could not be read completely -> couldn't
 *      check (the finding states its routes, so it is not made without them);
 *   6. otherwise idle.
 */
import type { NatGateway, RouteTable } from '@aws-sdk/client-ec2';
import { NAT_GATEWAY_IDLE_RULE } from '../config/nat-gateway-idle-rule';
import { NAT_GATEWAY_HOURLY_PRICE_SOURCE, natGatewayHourlyPrice } from '../config/aws-pricing';
import type { BatchSeriesResult, QueryOutcome } from './cloudwatch-metric-batch.util';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface NatIdleWindow {
  start: Date;
  end: Date;
}

/** The last `window.days` complete UTC days, ending at UTC midnight of (now - settle lag), half-open [start, end). */
export function natIdleWindow(now: Date): NatIdleWindow {
  const lagged = now.getTime() - NAT_GATEWAY_IDLE_RULE.window.settle_lag_hours * HOUR_MS;
  const endMs = Math.floor(lagged / DAY_MS) * DAY_MS;
  return { start: new Date(endMs - NAT_GATEWAY_IDLE_RULE.window.days * DAY_MS), end: new Date(endMs) };
}

/** Hourly datapoints every metric must have: 24 a day for every day of the window (768). */
export const NAT_IDLE_HOURS_REQUIRED = NAT_GATEWAY_IDLE_RULE.window.days * NAT_GATEWAY_IDLE_RULE.completeness.hours_per_day_required;

// ─── Scope ──────────────────────────────────────────────────────────────────

export type NatExclusionReason = 'regional' | 'deleting' | 'deleted' | 'failed';

export type NatScopeVerdict =
  | { kind: 'candidate' }
  | { kind: 'excluded'; reason: NatExclusionReason }
  | { kind: 'couldnt_check'; reason: 'pending' | 'unrecognised' };

const EXCLUDED_STATES: ReadonlySet<string> = new Set(NAT_GATEWAY_IDLE_RULE.scope.excluded_states);

/**
 * Whether this rule evaluates the gateway at all, from DescribeNatGateways alone.
 * A gateway with no AvailabilityMode is zonal: the field is newer than zonal
 * gateways, and every gateway created before regional mode existed is zonal.
 */
export function judgeNatScope(gateway: NatGateway): NatScopeVerdict {
  const state = gateway.State;
  if (state && EXCLUDED_STATES.has(state)) return { kind: 'excluded', reason: state as Exclude<NatExclusionReason, 'regional'> };
  const mode = gateway.AvailabilityMode;
  if (mode === 'regional') return { kind: 'excluded', reason: 'regional' };
  if (mode !== undefined && mode !== 'zonal') return { kind: 'couldnt_check', reason: 'unrecognised' };
  if (state === 'pending') return { kind: 'couldnt_check', reason: 'pending' };
  if (state !== NAT_GATEWAY_IDLE_RULE.scope.evaluated_state) return { kind: 'couldnt_check', reason: 'unrecognised' };
  return { kind: 'candidate' };
}

// ─── Metrics ────────────────────────────────────────────────────────────────

export type NatMetric = 'connections' | 'packetsFromSource' | 'packetsFromDestination' | 'bytesFromSource' | 'bytesFromDestination';

/** The five gate metrics, in the rule's order (activity is reported for the first one with traffic). */
export const NAT_METRICS: readonly NatMetric[] = Object.freeze(['connections', 'packetsFromSource', 'packetsFromDestination', 'bytesFromSource', 'bytesFromDestination']);

/** CloudWatch metric name and statistic of each reading, straight from the rule. */
export const NAT_METRIC_DEFINITIONS: Readonly<Record<NatMetric, { metric: string; stat: 'Maximum' | 'Sum' }>> = Object.freeze(
  Object.fromEntries(NAT_METRICS.map((metric, i) => [metric, { metric: NAT_GATEWAY_IDLE_RULE.metrics.gate[i].metric, stat: NAT_GATEWAY_IDLE_RULE.metrics.gate[i].stat }])) as Record<NatMetric, { metric: string; stat: 'Maximum' | 'Sum' }>
);

export type NatNotIdleReason = 'active_connections' | 'packets_from_source' | 'packets_from_destination' | 'bytes_from_source' | 'bytes_from_destination';

const NOT_IDLE_REASON: Readonly<Record<NatMetric, NatNotIdleReason>> = Object.freeze({
  connections: 'active_connections',
  packetsFromSource: 'packets_from_source',
  packetsFromDestination: 'packets_from_destination',
  bytesFromSource: 'bytes_from_source',
  bytesFromDestination: 'bytes_from_destination',
});

export type NatCouldntCheckReason = 'pending' | 'unrecognised' | 'too_new' | 'cloudwatch_failed' | 'cloudwatch_incomplete' | 'routes_unreadable';

/**
 * What one run of the rule decided, by reason (Stage A §5.2), stored on the
 * run's check as `nat_idle`. Counts only, never gateway identifiers. Every
 * listed gateway with an id is counted exactly once: evaluated = flagged +
 * not_flagged + couldnt_check + excluded (each summed over its reasons).
 * `unrecognised` (a state or availability mode the rule does not know) is the
 * one reason Stage A did not name; it fails safe.
 */
export interface NatIdleCheckCounts {
  evaluated: number;
  flagged: number;
  not_flagged: Record<NatNotIdleReason, number>;
  couldnt_check: Record<NatCouldntCheckReason, number>;
  excluded: Record<NatExclusionReason, number>;
}

export function emptyNatIdleCounts(): NatIdleCheckCounts {
  return {
    evaluated: 0,
    flagged: 0,
    not_flagged: { active_connections: 0, packets_from_source: 0, packets_from_destination: 0, bytes_from_source: 0, bytes_from_destination: 0 },
    couldnt_check: { pending: 0, unrecognised: 0, too_new: 0, cloudwatch_failed: 0, cloudwatch_incomplete: 0, routes_unreadable: 0 },
    excluded: { regional: 0, deleting: 0, deleted: 0, failed: 0 },
  };
}

export interface NatMetricReading {
  outcome: QueryOutcome;
  series: BatchSeriesResult | null;
}

export type NatMetricReadings = Record<NatMetric, NatMetricReading>;

export type NatMetricVerdict =
  | { kind: 'not_idle'; reason: NatNotIdleReason }
  | { kind: 'couldnt_check'; reason: 'too_new' | 'cloudwatch_failed' | 'cloudwatch_incomplete' }
  | { kind: 'idle' };

function inWindow(ts: unknown, window: NatIdleWindow): ts is Date {
  if (!(ts instanceof Date) || Number.isNaN(ts.getTime())) return false;
  const t = ts.getTime();
  return t >= window.start.getTime() && t < window.end.getTime();
}

/** Any datapoint above 0 inside the window: the gateway carried traffic. */
function hasActivity(series: BatchSeriesResult | null, window: NatIdleWindow): boolean {
  if (!series) return false;
  return series.values.some((value, i) => typeof value === 'number' && Number.isFinite(value) && value > 0 && inWindow(series.timestamps[i], window));
}

/**
 * True only when the series holds exactly one datapoint for every hour of the
 * window and nothing else: as many timestamps as values, each timestamp on the
 * hour (the 3600 s period: GetMetricData returns no per-datapoint period, so the
 * hour grid is how the period is checked) and inside [start, end), no hour
 * twice, every value a finite number >= 0, and NAT_IDLE_HOURS_REQUIRED of them.
 */
export function seriesCoversEveryHour(series: BatchSeriesResult | null, window: NatIdleWindow): boolean {
  if (!series) return false;
  const { timestamps, values } = series;
  if (timestamps.length !== values.length || values.length !== NAT_IDLE_HOURS_REQUIRED) return false;
  const start = window.start.getTime();
  const seen = new Set<number>();
  for (let i = 0; i < values.length; i++) {
    const ts = timestamps[i];
    const value = values[i];
    if (!inWindow(ts, window)) return false;
    const offset = ts.getTime() - start;
    if (offset % HOUR_MS !== 0) return false;
    if (seen.has(offset)) return false;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return false;
    seen.add(offset);
  }
  return seen.size === NAT_IDLE_HOURS_REQUIRED;
}

/**
 * Steps 1-4 for one in-scope gateway. `createTime` is the gateway's CreateTime,
 * undefined when AWS did not return one.
 */
export function judgeNatMetrics(readings: NatMetricReadings, createTime: Date | undefined, window: NatIdleWindow): NatMetricVerdict {
  // 1. Activity wins, whatever else is missing.
  for (const metric of NAT_METRICS) {
    if (hasActivity(readings[metric].series, window)) return { kind: 'not_idle', reason: NOT_IDLE_REASON[metric] };
  }

  // 2. Created before the window.
  if (!(createTime instanceof Date) || Number.isNaN(createTime.getTime()) || createTime.getTime() > window.start.getTime()) {
    return { kind: 'couldnt_check', reason: 'too_new' };
  }

  // 3. Every query completed.
  const outcomes = NAT_METRICS.map((metric) => readings[metric].outcome);
  if (outcomes.some((outcome) => outcome !== 'complete' && outcome !== 'empty')) return { kind: 'couldnt_check', reason: 'cloudwatch_failed' };
  if (outcomes.some((outcome) => outcome !== 'complete')) return { kind: 'couldnt_check', reason: 'cloudwatch_incomplete' };

  // 4. Each metric, independently: one datapoint for every hour, nothing else.
  if (NAT_METRICS.some((metric) => !seriesCoversEveryHour(readings[metric].series, window))) {
    return { kind: 'couldnt_check', reason: 'cloudwatch_incomplete' };
  }

  return { kind: 'idle' };
}

// ─── Routes ─────────────────────────────────────────────────────────────────

/** One route table with at least one route whose target is the gateway (evidence, not eligibility). */
export interface NatRouteTableEvidence {
  id: string;
  /** The table's Name tag, or null when it has none. */
  name: string | null;
  /** The VPC's main route table: it serves every subnet with no table of its own. */
  main: boolean;
  /** Subnets explicitly associated with the table. */
  subnet_ids: string[];
  /** Each route to the gateway: its destination (IPv4 / IPv6 CIDR or prefix list) and state. */
  routes: Array<{ destination: string | null; state: string | null }>;
}

// An association that has ended no longer routes anything; every other state
// (associated, associating, disassociating, or none given) still may.
const ENDED_ASSOCIATION_STATES: ReadonlySet<string> = new Set(['disassociated', 'failed']);

/**
 * The route tables whose routes target `natGatewayId`, from a complete
 * DescribeRouteTables listing, sorted by id. Only a route's own NatGatewayId
 * counts: nothing is inferred from subnets, VPCs or the gateway's existence.
 * Null when a table that routes to the gateway has no id (it could not be named,
 * so the route evidence is incomplete).
 */
export function natGatewayRouteTables(routeTables: readonly RouteTable[], natGatewayId: string): NatRouteTableEvidence[] | null {
  const found: NatRouteTableEvidence[] = [];
  for (const table of routeTables) {
    const routes = (table.Routes ?? []).filter((route) => route.NatGatewayId === natGatewayId);
    if (routes.length === 0) continue;
    if (!table.RouteTableId) return null;
    const live = (table.Associations ?? []).filter((association) => !ENDED_ASSOCIATION_STATES.has(association.AssociationState?.State ?? ''));
    const name = table.Tags?.find((tag) => tag.Key === 'Name')?.Value;
    found.push({
      id: table.RouteTableId,
      name: name ? name : null,
      main: live.some((association) => association.Main === true),
      subnet_ids: [...new Set(live.flatMap((association) => (association.SubnetId ? [association.SubnetId] : [])))].sort(),
      routes: routes.map((route) => ({
        destination: route.DestinationCidrBlock ?? route.DestinationIpv6CidrBlock ?? route.DestinationPrefixListId ?? null,
        state: route.State ?? null,
      })),
    });
  }
  return found.sort((a, b) => a.id.localeCompare(b.id));
}

// ─── Savings ────────────────────────────────────────────────────────────────

export type NatIdleSavings =
  | { kind: 'estimate'; monthly: number; pricePerHour: number }
  | { kind: 'none'; note: 'no_price_for_region' | 'provisioned_bandwidth' };

/** Provisioned bandwidth is set when any of its fields carries a value (AWS: "Reserved"; its price model is undocumented). */
export function hasProvisionedBandwidth(gateway: NatGateway): boolean {
  const pb = gateway.ProvisionedBandwidth;
  if (!pb || typeof pb !== 'object') return false;
  return Object.values(pb).some((value) => value !== undefined && value !== null && value !== '');
}

/** The region's hourly list price x 730 hours, rounded to cents; never another region's price. */
export function natIdleSavings(gateway: NatGateway, region: string): NatIdleSavings {
  if (hasProvisionedBandwidth(gateway)) return { kind: 'none', note: 'provisioned_bandwidth' };
  const pricePerHour = natGatewayHourlyPrice(region);
  if (pricePerHour === null) return { kind: 'none', note: 'no_price_for_region' };
  return { kind: 'estimate', pricePerHour, monthly: Math.round(pricePerHour * NAT_GATEWAY_IDLE_RULE.savings.hours_per_month * 100) / 100 };
}

/** metadata.savings_basis of an estimate (Stage A §5.2); the Elastic IP clause only for a gateway that has one. */
export function natIdleSavingsBasis(region: string, pricePerHour: number, hasElasticIp: boolean): string {
  const hours = NAT_GATEWAY_IDLE_RULE.savings.hours_per_month;
  return `estimated: the ${region} NAT gateway hourly list price ($${pricePerHour}/hour, ${hours} hours) for a gateway that is available but processed no traffic; data processing was $0; ${hasElasticIp ? 'the Elastic IP is not included; ' : ''}not billed cost`;
}

// ─── Evidence, description ──────────────────────────────────────────────────

/** Elastic IP allocations on the gateway (public gateways; a private gateway has none). */
export function natElasticIpCount(gateway: NatGateway): number {
  return new Set((gateway.NatGatewayAddresses ?? []).flatMap((address) => (address.AllocationId ? [address.AllocationId] : []))).size;
}

/** The gateway's Availability Zone, from its addresses, when they name exactly one. */
function availabilityZoneOf(gateway: NatGateway): string | null {
  const zones = new Set((gateway.NatGatewayAddresses ?? []).flatMap((address) => (address.AvailabilityZone ? [address.AvailabilityZone] : [])));
  return zones.size === 1 ? [...zones][0] : null;
}

function ruleSnapshot(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(NAT_GATEWAY_IDLE_RULE)) as Record<string, unknown>;
}

/** The rule identity and evidence stored on an idle NAT gateway finding. */
export function natIdleFindingMetadata(input: {
  gateway: NatGateway;
  window: NatIdleWindow;
  evaluatedAt: Date;
  createTime: Date;
  routeTables: NatRouteTableEvidence[];
}): Record<string, unknown> {
  const { gateway } = input;
  return {
    rule_version: NAT_GATEWAY_IDLE_RULE.version,
    rule: ruleSnapshot(),
    nat_gateway_idle: {
      evaluated_at: input.evaluatedAt.toISOString(),
      window_start: input.window.start.toISOString(),
      window_end: input.window.end.toISOString(),
      create_time: input.createTime.toISOString(),
      state: gateway.State ?? null,
      connectivity_type: gateway.ConnectivityType ?? null,
      availability_mode: gateway.AvailabilityMode ?? null,
      vpc_id: gateway.VpcId ?? null,
      subnet_id: gateway.SubnetId ?? null,
      availability_zone: availabilityZoneOf(gateway),
      addresses: (gateway.NatGatewayAddresses ?? []).map((address) => ({
        allocation_id: address.AllocationId ?? null,
        public_ip: address.PublicIp ?? null,
        private_ip: address.PrivateIp ?? null,
      })),
      completeness: 'complete',
      hours_checked: NAT_IDLE_HOURS_REQUIRED,
      // Every hourly datapoint was exactly 0 (judgeNatMetrics), so each 32-day total is 0.
      totals: {
        active_connection_count_max: 0,
        packets_in_from_source: 0,
        packets_in_from_destination: 0,
        bytes_in_from_source: 0,
        bytes_in_from_destination: 0,
      },
      routes: {
        checked: true,
        route_table_count: input.routeTables.length,
        route_tables: input.routeTables,
      },
    },
  };
}

/** The price source stored with an estimate: where the hourly price came from, and its publication date. */
export const NAT_PRICE_EVIDENCE = Object.freeze({ price_source: NAT_GATEWAY_HOURLY_PRICE_SOURCE.url, price_published: NAT_GATEWAY_HOURLY_PRICE_SOURCE.published });

const MAX_NAMED_TABLES = 5;
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many);

function tableLabel(table: NatRouteTableEvidence): string {
  return `${table.name ?? table.id}${table.main ? ' (main)' : ''}`;
}

/**
 * The finding description (Stage A §5.2, Unrouted / Routed). Route tables are
 * named (Name tag, else id; at most five, then "and N more"). The subnets a main
 * route table serves implicitly are not listed: DevControl does not read the
 * VPC's subnets, so they are described, never counted.
 */
export function natIdleDescription(input: { routeTables: NatRouteTableEvidence[]; elasticIpCount: number }): string {
  const days = NAT_GATEWAY_IDLE_RULE.window.days;
  const opening = `In the last ${days} days this NAT gateway had no connections and processed no traffic`;
  const releaseIp = input.elasticIpCount > 0 ? plural(input.elasticIpCount, ' release its Elastic IP', ' release its Elastic IPs') : '';
  const tables = input.routeTables;

  if (tables.length === 0) {
    const tail = releaseIp ? `otherwise delete it, and${releaseIp} to stop that charge too.` : 'otherwise delete it.';
    return `${opening}, and no route table sends traffic to it. Check whether it is a disaster-recovery standby; ${tail}`;
  }

  const named = tables.slice(0, MAX_NAMED_TABLES).map(tableLabel);
  const more = tables.length - named.length;
  const list = more > 0 ? `${named.join(', ')} and ${more} more` : named.join(', ');
  const subnetCount = new Set(tables.flatMap((table) => table.subnet_ids)).size;
  const hasMain = tables.some((table) => table.main);
  const coverage =
    subnetCount > 0 && hasMain ? `, covering ${subnetCount} associated ${plural(subnetCount, 'subnet', 'subnets')} plus every subnet that uses the VPC's main route table`
    : subnetCount > 0 ? `, covering ${subnetCount} associated ${plural(subnetCount, 'subnet', 'subnets')}`
    : hasMain ? `, including the VPC's main route table, used by every subnet without its own`
    : `; no subnet is associated with ${plural(tables.length, 'it', 'them')}`;
  const sends = plural(tables.length, 'route table still sends', 'route tables still send');
  const afterDelete = releaseIp ? ` After deleting it,${releaseIp} to stop that charge too.` : '';
  return `${opening}, although ${tables.length} ${sends} traffic to it (${list})${coverage}. Check whether those subnets still need outbound access and whether it is a standby. Before deleting it, remove or redirect those routes, or they will be left blackholed.${afterDelete}`;
}
