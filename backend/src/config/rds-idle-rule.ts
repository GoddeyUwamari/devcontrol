/**
 * The idle RDS rule (C1): the one place its scope, thresholds, window and
 * completeness requirements live.
 *
 * A DB instance is idle only when, on EVERY one of the last 30 complete UTC
 * days (the same window as the low-activity EC2 rule, config/low-activity-rule.ts):
 *   - DatabaseConnections (hourly Maximum) was 0 in every hour,
 *   - its peak hourly CPU (CPUUtilization, hourly Maximum) stayed below 10%,
 *   - its peak hourly ReadIOPS and WriteIOPS (hourly Maximum) each stayed below
 *     20 operations a second,
 * every hour of every day has a datapoint for all four metrics, and the
 * instance was created before the window began.
 *
 * Activity wins: any datapoint at or above a threshold (a connection, or CPU or
 * IOPS at the limit), even on an incomplete day, makes the instance "not idle".
 * Missing or failed data, or an instance created inside the window, otherwise
 * makes it "couldn't check" -- never idle.
 *
 * Only instances in the `available` state are evaluated. Aurora instances
 * (planned aurora_* rules), Multi-AZ DB cluster members, read replicas, the
 * sources of read replicas and RDS Custom instances are excluded; stopped
 * instances are not billed for instance hours and are not evaluated.
 *
 * Known limit: DatabaseConnections is sampled once a minute, so a connection
 * that opens and closes between two samples can be missed. The CPU and IOPS
 * limits are the backstop.
 *
 * No dollar figure: DevControl has no defensible RDS instance or storage price
 * source, so findings carry no savings estimate and a fixed Low severity.
 *
 * RDS_IDLE_RULE is copied verbatim into every finding it produces
 * (metadata.rule), so a finding stays reconstructable after the rule changes.
 * Any change to it must bump `version`: the snapshot test in
 * config/__tests__/c1-rule-identity.test.ts enforces that.
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

export const RDS_IDLE_RULE = deepFreeze({
  id: 'rds_idle',
  version: 1,
  window: { days: 30, basis: 'complete_utc_days', settle_lag_hours: 2 },
  metrics: {
    namespace: 'AWS/RDS',
    dimension: 'DBInstanceIdentifier',
    stat: 'Maximum',
    period_seconds: 3600,
  },
  connections: { metric: 'DatabaseConnections', hourly_max_equals: 0 },
  cpu: { metric: 'CPUUtilization', daily_peak_below_percent: 10 },
  read_iops: { metric: 'ReadIOPS', daily_peak_below_per_second: 20 },
  write_iops: { metric: 'WriteIOPS', daily_peak_below_per_second: 20 },
  completeness: {
    hours_per_day_required: 24,
    metrics_required: ['DatabaseConnections', 'CPUUtilization', 'ReadIOPS', 'WriteIOPS'],
    created_before_window: true,
  },
  activity_wins: true,
  scope: {
    evaluated_status: 'available',
    excluded: ['aurora', 'db_cluster_member', 'read_replica', 'read_replica_source', 'rds_custom', 'stopped'],
  },
  savings: { estimate: 'none', reason: 'no_price_source', severity: 'LOW' },
} as const);

export type RdsIdleRule = typeof RDS_IDLE_RULE;
