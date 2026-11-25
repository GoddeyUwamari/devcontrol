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
 * Savings (version 2, C1b): an estimate of instance hours only -- the exact
 * on-demand instance-hour price for the instance's region, engine, licence
 * model, instance class and deployment (Single-AZ / Multi-AZ), from
 * config/aws-pricing.ts rdsInstanceHourlyPrice, x 730 hours. Storage,
 * Provisioned IOPS, storage throughput, backups, snapshots, Extended Support,
 * the public IPv4 address and any reservation or discount are outside the
 * figure. Severity comes from the estimate (the NAT gateway rule's policy). A
 * key with no exact price (unknown licence model or deployment, an Outposts or
 * Local Zone instance, Oracle CDB, SQL Server Developer, Db2 marketplace, a
 * region or class the table doesn't have) gets no dollar figure and a fixed Low
 * severity -- never $0 as a figure and never another key's price. Version 1
 * stored no figure at all.
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
  version: 2,
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
  savings: {
    basis: 'estimate',
    price: 'regional_on_demand_instance_hour',
    key: ['region', 'engine', 'license_model', 'instance_class', 'deployment'],
    hours_per_month: 730,
    includes: ['instance_hours'],
    excludes: ['storage', 'provisioned_iops', 'storage_throughput', 'backup_storage', 'snapshots', 'extended_support', 'public_ipv4', 'reservations_and_discounts'],
    not_priced: ['outposts', 'local_zone', 'oracle_cdb', 'sqlserver_developer', 'db2_marketplace', 'unknown_license_model', 'unknown_deployment'],
    missing_price: 'no_estimate',
    severity: 'from_estimate',
    severity_without_price: 'LOW',
  },
} as const);

export type RdsIdleRule = typeof RDS_IDLE_RULE;
