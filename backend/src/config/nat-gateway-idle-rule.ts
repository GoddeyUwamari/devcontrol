/**
 * The idle NAT gateway rule (C2): the one place its scope, metrics, window,
 * completeness requirements and savings basis live.
 *
 * A NAT gateway is idle only when, in EVERY hour of the last 32 complete UTC
 * days (AWS Compute Optimizer's NAT lookback; it also always contains a
 * fixed-day monthly job, which a 30-day window can miss in a 31-day month):
 *   - ActiveConnectionCount (hourly Maximum) was 0,
 *   - PacketsInFromSource, PacketsInFromDestination, BytesInFromSource and
 *     BytesInFromDestination (hourly Sum) were each 0,
 * each of those five metrics has exactly one datapoint for every hour of the
 * window (24 a day, 768 in all; none missing, repeated, off the hour or outside
 * the window), and the gateway was created before the window began.
 *
 * Activity wins: any datapoint above 0 in the window, even on incomplete data,
 * makes the gateway "not idle". Missing, partial, malformed or failed data, an
 * unreadable route listing, or a gateway created inside the window otherwise
 * makes it "couldn't check" -- never idle, and never read as zero.
 *
 * Founder G1 (2026-11-24, outcome 1): an idle, available gateway with no routes
 * reported an hourly datapoint of exactly 0 for all five metrics, every hour,
 * status Complete. So zeros are evidence of no traffic; an absent datapoint is
 * not.
 *
 * Only `available` zonal gateways are evaluated. `pending` is couldn't check;
 * `deleting`, `deleted` and `failed` (not billed, or already going) and regional
 * gateways (per-AZ metrics and billing, deferred) are excluded. Routes that
 * still point at the gateway are evidence, not eligibility (founder ruling R1):
 * the finding names the route tables.
 *
 * Savings: an estimate, the region's NAT gateway hourly list price x 730 hours
 * (config/aws-pricing.ts natGatewayHourlyPrice). No price for the region, or a
 * gateway with provisioned bandwidth (an undocumented price model): no dollar
 * figure. The Elastic IP is not included (deleting the gateway does not release
 * it; the unused Elastic IP rule covers it afterwards).
 *
 * NAT_GATEWAY_IDLE_RULE is copied verbatim into every finding it produces
 * (metadata.rule), so a finding stays reconstructable after the rule changes.
 * Any change to it must bump `version`: the snapshot test in
 * config/__tests__/c2-rule-identity.test.ts enforces that.
 *
 * Pure data: no AWS calls, no database.
 */

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/** The resource type C2 findings are stored under (its rule's service, OPTIMIZATION_RULE_SERVICES). */
export const NAT_GATEWAY_RESOURCE_TYPE = 'NAT Gateway';

export const NAT_GATEWAY_IDLE_RULE = deepFreeze({
  id: 'nat_gateway_idle',
  version: 1,
  window: { days: 32, basis: 'complete_utc_days', settle_lag_hours: 2 },
  metrics: {
    namespace: 'AWS/NATGateway',
    dimension: 'NatGatewayId',
    period_seconds: 3600,
    every_hour_equals: 0,
    gate: [
      { metric: 'ActiveConnectionCount', stat: 'Maximum' },
      { metric: 'PacketsInFromSource', stat: 'Sum' },
      { metric: 'PacketsInFromDestination', stat: 'Sum' },
      { metric: 'BytesInFromSource', stat: 'Sum' },
      { metric: 'BytesInFromDestination', stat: 'Sum' },
    ],
  },
  completeness: {
    hours_per_day_required: 24,
    every_metric: true,
    one_datapoint_per_hour: true,
    on_missing_duplicate_or_out_of_window_datapoint: 'couldnt_check',
    created_before_window: true,
  },
  activity_wins: true,
  scope: {
    evaluated_state: 'available',
    couldnt_check_states: ['pending'],
    excluded_states: ['deleting', 'deleted', 'failed'],
    excluded_availability_modes: ['regional'],
    on_unrecognised_state_or_mode: 'couldnt_check',
  },
  routes: { source: 'describe_route_tables', role: 'evidence', on_read_failure: 'couldnt_check' },
  savings: {
    basis: 'estimate',
    price: 'regional_nat_gateway_hourly',
    hours_per_month: 730,
    missing_price: 'no_estimate',
    provisioned_bandwidth: 'no_estimate',
    includes_elastic_ip: false,
  },
} as const);

export type NatGatewayIdleRule = typeof NAT_GATEWAY_IDLE_RULE;
