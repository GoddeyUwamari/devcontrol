/**
 * The idle RDS rule (config/rds-idle-rule.ts) applied to what was read from
 * AWS. Pure: no AWS calls, no database, no clock (the caller passes `now`).
 * Same shape as the low-activity EC2 evaluation (low-activity-evaluation.ts),
 * which it does not change.
 *
 * One DB instance goes through, in this order:
 *   0. scope (judgeRdsIdleScope): excluded engines/topologies are skipped;
 *      a status other than `available` is skipped (`stopped`) or couldn't
 *      check (any transitional status);
 *   1. activity (activity wins): any connection, or any CPU/IOPS datapoint at or
 *      above its threshold, makes it "not idle" -- even when that day, or the
 *      whole window, is incomplete;
 *   2. age: created inside the window (or no creation time) -> couldn't check;
 *   3. data: any of the four queries not 'complete' -> couldn't check;
 *   4. completeness: every hour of every day for every metric, else couldn't
 *      check;
 *   5. otherwise idle.
 */
import type { DBInstance } from '@aws-sdk/client-rds';
import { RDS_IDLE_RULE } from '../config/rds-idle-rule';
import { RDS_INSTANCE_HOURLY_PRICE_SOURCE, rdsInstanceHourlyPrice, rdsPricedEngineLicence, rdsPricedRegion } from '../config/aws-pricing';
import type { BatchSeriesResult, QueryOutcome } from './cloudwatch-metric-batch.util';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOURS_PER_DAY = 24;

export interface RdsIdleWindow {
  start: Date;
  end: Date;
}

/** The last `window.days` complete UTC days, ending at UTC midnight of (now - settle lag). */
export function rdsIdleWindow(now: Date): RdsIdleWindow {
  const lagged = now.getTime() - RDS_IDLE_RULE.window.settle_lag_hours * HOUR_MS;
  const endMs = Math.floor(lagged / DAY_MS) * DAY_MS;
  return { start: new Date(endMs - RDS_IDLE_RULE.window.days * DAY_MS), end: new Date(endMs) };
}

// ─── Scope ──────────────────────────────────────────────────────────────────

export type RdsExclusionReason =
  | 'aurora'
  | 'db_cluster_member'
  | 'read_replica'
  | 'read_replica_source'
  | 'rds_custom'
  | 'stopped';

export type RdsScopeVerdict =
  | { kind: 'candidate' }
  | { kind: 'excluded'; reason: RdsExclusionReason }
  | { kind: 'couldnt_check'; reason: 'not_available' };

/** Whether this rule evaluates the instance at all, from DescribeDBInstances alone. */
export function judgeRdsIdleScope(db: DBInstance): RdsScopeVerdict {
  const engine = (db.Engine ?? '').toLowerCase();
  if (engine.startsWith('aurora')) return { kind: 'excluded', reason: 'aurora' };
  if (engine.startsWith('custom-')) return { kind: 'excluded', reason: 'rds_custom' };
  // Aurora members and Multi-AZ DB cluster members both carry their cluster's id.
  if (db.DBClusterIdentifier) return { kind: 'excluded', reason: 'db_cluster_member' };
  if (db.ReadReplicaSourceDBInstanceIdentifier || db.ReadReplicaSourceDBClusterIdentifier) {
    return { kind: 'excluded', reason: 'read_replica' };
  }
  if ((db.ReadReplicaDBInstanceIdentifiers ?? []).length > 0 || (db.ReadReplicaDBClusterIdentifiers ?? []).length > 0) {
    return { kind: 'excluded', reason: 'read_replica_source' };
  }
  if (db.DBInstanceStatus === 'stopped') return { kind: 'excluded', reason: 'stopped' };
  if (db.DBInstanceStatus !== RDS_IDLE_RULE.scope.evaluated_status) return { kind: 'couldnt_check', reason: 'not_available' };
  return { kind: 'candidate' };
}

// ─── Metrics ────────────────────────────────────────────────────────────────

export type RdsMetric = 'connections' | 'cpu' | 'readIops' | 'writeIops';

export interface RdsMetricReading {
  outcome: QueryOutcome;
  series: BatchSeriesResult | null;
}

export type RdsMetricReadings = Record<RdsMetric, RdsMetricReading>;

/** CloudWatch metric name of each reading. */
export const RDS_IDLE_METRIC_NAMES: Readonly<Record<RdsMetric, string>> = Object.freeze({
  connections: RDS_IDLE_RULE.connections.metric,
  cpu: RDS_IDLE_RULE.cpu.metric,
  readIops: RDS_IDLE_RULE.read_iops.metric,
  writeIops: RDS_IDLE_RULE.write_iops.metric,
});

const METRICS: readonly RdsMetric[] = ['connections', 'cpu', 'readIops', 'writeIops'];

/** One day's stored evidence: daily peaks only, never the hourly series. */
export interface RdsDayEvidence {
  /** The UTC day, YYYY-MM-DD. */
  date: string;
  connections_max: number;
  cpu_peak_percent: number;
  read_iops_peak: number;
  write_iops_peak: number;
}

export interface RdsWorstDays {
  cpu_peak_percent: number;
  cpu_peak_date: string;
  read_iops_peak: number;
  read_iops_peak_date: string;
  write_iops_peak: number;
  write_iops_peak_date: string;
}

export type RdsNotIdleReason = 'connections' | 'cpu_peak' | 'read_iops' | 'write_iops';
export type RdsCouldntCheckReason = 'not_available' | 'too_new' | 'cloudwatch_failed' | 'cloudwatch_incomplete';
/** Why a flagged instance has no dollar figure (rdsIdleSavings); also its finding's metadata.savings_note. */
export type RdsNoPriceReason =
  | 'missing_engine_or_class'
  | 'missing_license_model'
  | 'missing_deployment'
  | 'unknown_placement'
  | 'outposts'
  | 'local_zone'
  | 'unsupported_engine_or_license'
  | 'no_price_for_region'
  | 'no_price_for_configuration';

/**
 * What one run of the rule decided, by reason (Stage A §6), stored on the run's
 * check as `rds_idle`. Counts only, never instance identifiers. Every listed DB
 * instance is counted exactly once: evaluated = flagged + not_flagged +
 * couldnt_check + excluded (each summed over its reasons). Every flagged
 * instance is counted once more by its figure (C1b): flagged = priced +
 * no_price (summed over its reasons).
 */
export interface RdsIdleCheckCounts {
  evaluated: number;
  flagged: number;
  not_flagged: Record<RdsNotIdleReason, number>;
  couldnt_check: Record<RdsCouldntCheckReason, number>;
  excluded: Record<RdsExclusionReason, number>;
  /** Flagged instances with an exact instance-hour price. */
  priced: number;
  /** Flagged instances with no dollar figure, by reason. */
  no_price: Record<RdsNoPriceReason, number>;
}

export function emptyRdsIdleCounts(): RdsIdleCheckCounts {
  return {
    evaluated: 0,
    flagged: 0,
    not_flagged: { connections: 0, cpu_peak: 0, read_iops: 0, write_iops: 0 },
    couldnt_check: { not_available: 0, too_new: 0, cloudwatch_failed: 0, cloudwatch_incomplete: 0 },
    excluded: { aurora: 0, db_cluster_member: 0, read_replica: 0, read_replica_source: 0, rds_custom: 0, stopped: 0 },
    priced: 0,
    no_price: {
      missing_engine_or_class: 0,
      missing_license_model: 0,
      missing_deployment: 0,
      unknown_placement: 0,
      outposts: 0,
      local_zone: 0,
      unsupported_engine_or_license: 0,
      no_price_for_region: 0,
      no_price_for_configuration: 0,
    },
  };
}

export type RdsMetricVerdict =
  | { kind: 'not_idle'; reason: RdsNotIdleReason }
  | { kind: 'couldnt_check'; reason: Exclude<RdsCouldntCheckReason, 'not_available'> }
  | { kind: 'idle'; days: RdsDayEvidence[]; worst: RdsWorstDays };

interface DayBucket {
  peak: Record<RdsMetric, number | null>;
  hours: Record<RdsMetric, Set<number>>;
}

function emptyBuckets(): DayBucket[] {
  return Array.from({ length: RDS_IDLE_RULE.window.days }, () => ({
    peak: { connections: null, cpu: null, readIops: null, writeIops: null },
    hours: { connections: new Set<number>(), cpu: new Set<number>(), readIops: new Set<number>(), writeIops: new Set<number>() },
  }));
}

/** Each valid datapoint inside the window, with its hour index (0 .. days*24-1). */
function* datapoints(series: BatchSeriesResult | null, window: RdsIdleWindow): Generator<{ hour: number; value: number }> {
  if (!series) return;
  const start = window.start.getTime();
  const end = window.end.getTime();
  for (let i = 0; i < series.values.length; i++) {
    const ts = series.timestamps[i];
    const value = series.values[i];
    if (!(ts instanceof Date) || Number.isNaN(ts.getTime())) continue;
    if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) continue;
    const t = ts.getTime();
    if (t < start || t >= end) continue;
    yield { hour: Math.floor((t - start) / HOUR_MS), value };
  }
}

function bucketize(readings: RdsMetricReadings, window: RdsIdleWindow): DayBucket[] {
  const days = emptyBuckets();
  for (const metric of METRICS) {
    for (const { hour, value } of datapoints(readings[metric].series, window)) {
      const day = days[Math.floor(hour / HOURS_PER_DAY)];
      const current = day.peak[metric];
      day.peak[metric] = current === null ? value : Math.max(current, value);
      day.hours[metric].add(hour);
    }
  }
  return days;
}

function utcDate(window: RdsIdleWindow, dayIndex: number): string {
  return new Date(window.start.getTime() + dayIndex * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Steps 1-4 for one in-scope instance. `createTime` is RDS's InstanceCreateTime,
 * undefined when AWS did not return one.
 */
export function judgeRdsIdleMetrics(readings: RdsMetricReadings, createTime: Date | undefined, window: RdsIdleWindow): RdsMetricVerdict {
  const days = bucketize(readings, window);
  const exceeds = (metric: RdsMetric, limit: number, atOrAbove: boolean) =>
    days.some((day) => day.peak[metric] !== null && (atOrAbove ? (day.peak[metric] as number) >= limit : (day.peak[metric] as number) > limit));

  // 1. Activity wins, whatever else is missing.
  if (exceeds('connections', RDS_IDLE_RULE.connections.hourly_max_equals, false)) return { kind: 'not_idle', reason: 'connections' };
  if (exceeds('cpu', RDS_IDLE_RULE.cpu.daily_peak_below_percent, true)) return { kind: 'not_idle', reason: 'cpu_peak' };
  if (exceeds('readIops', RDS_IDLE_RULE.read_iops.daily_peak_below_per_second, true)) return { kind: 'not_idle', reason: 'read_iops' };
  if (exceeds('writeIops', RDS_IDLE_RULE.write_iops.daily_peak_below_per_second, true)) return { kind: 'not_idle', reason: 'write_iops' };

  // 2. Created before the window.
  if (!(createTime instanceof Date) || Number.isNaN(createTime.getTime()) || createTime.getTime() > window.start.getTime()) {
    return { kind: 'couldnt_check', reason: 'too_new' };
  }

  // 3. Every query completed.
  const outcomes = METRICS.map((metric) => readings[metric].outcome);
  if (outcomes.some((outcome) => outcome !== 'complete' && outcome !== 'empty')) return { kind: 'couldnt_check', reason: 'cloudwatch_failed' };
  if (outcomes.some((outcome) => outcome !== 'complete')) return { kind: 'couldnt_check', reason: 'cloudwatch_incomplete' };

  // 4. Every hour of every day, for every metric.
  const required = RDS_IDLE_RULE.completeness.hours_per_day_required;
  if (days.some((day) => METRICS.some((metric) => day.hours[metric].size < required))) {
    return { kind: 'couldnt_check', reason: 'cloudwatch_incomplete' };
  }

  const evidence: RdsDayEvidence[] = days.map((day, i) => ({
    date: utcDate(window, i),
    connections_max: day.peak.connections as number,
    cpu_peak_percent: day.peak.cpu as number,
    read_iops_peak: day.peak.readIops as number,
    write_iops_peak: day.peak.writeIops as number,
  }));
  const worstOf = (field: 'cpu_peak_percent' | 'read_iops_peak' | 'write_iops_peak') =>
    evidence.reduce((best, day) => (day[field] > best[field] ? day : best), evidence[0]);
  const cpu = worstOf('cpu_peak_percent');
  const read = worstOf('read_iops_peak');
  const write = worstOf('write_iops_peak');
  return {
    kind: 'idle',
    days: evidence,
    worst: {
      cpu_peak_percent: cpu.cpu_peak_percent,
      cpu_peak_date: cpu.date,
      read_iops_peak: read.read_iops_peak,
      read_iops_peak_date: read.date,
      write_iops_peak: write.write_iops_peak,
      write_iops_peak_date: write.date,
    },
  };
}

// ─── Savings (C1b) ───────────────────────────────────────────────────────────

/**
 * Where the instance runs, from DescribeDBInstances alone: on an Outpost (any
 * subnet of its DB subnet group on an Outpost), and its Availability Zones.
 * `on_outposts` is null when the response carries no subnets to tell.
 */
export interface RdsPlacement {
  on_outposts: boolean | null;
  availability_zone: string | null;
  secondary_availability_zone: string | null;
}

export function rdsPlacement(db: DBInstance): RdsPlacement {
  const subnets = db.DBSubnetGroup?.Subnets;
  return {
    on_outposts: Array.isArray(subnets) && subnets.length > 0 ? subnets.some((subnet) => !!subnet.SubnetOutpost?.Arn) : null,
    availability_zone: typeof db.AvailabilityZone === 'string' && db.AvailabilityZone ? db.AvailabilityZone : null,
    secondary_availability_zone: typeof db.SecondaryAvailabilityZone === 'string' && db.SecondaryAvailabilityZone ? db.SecondaryAvailabilityZone : null,
  };
}

/** A zone of the region itself ("us-east-1a"), not a Local Zone ("us-west-2-lax-1a") or a Wavelength Zone. */
function isRegionalZone(zone: string, region: string): boolean {
  return zone.length === region.length + 1 && zone.startsWith(region) && /^[a-z]$/.test(zone.slice(region.length));
}

/** How the engine and licence model read in the finding's explanation (the approved C1b labels). */
const ENGINE_LABELS: Readonly<Record<string, string>> = Object.freeze({
  'mysql|general-public-license': 'MySQL',
  'mariadb|general-public-license': 'MariaDB',
  'postgres|postgresql-license': 'PostgreSQL',
  'oracle-ee|bring-your-own-license': 'Oracle EE, BYOL',
  'oracle-se2|bring-your-own-license': 'Oracle SE2, BYOL',
  'oracle-se2|license-included': 'Oracle SE2, licence included',
  'sqlserver-ee|license-included': 'SQL Server EE, licence included',
  'sqlserver-se|license-included': 'SQL Server SE, licence included',
  'sqlserver-web|license-included': 'SQL Server Web, licence included',
  'sqlserver-ex|license-included': 'SQL Server Express, licence included',
  'db2-se|bring-your-own-license': 'Db2 SE, BYOL',
  'db2-ae|bring-your-own-license': 'Db2 AE, BYOL',
});

export type RdsDeployment = 'Single-AZ' | 'Multi-AZ';

export type RdsIdleSavings =
  | {
      kind: 'estimate';
      monthly: number;
      pricePerHour: number;
      engine: string;
      licenseModel: string;
      instanceClass: string;
      deployment: RdsDeployment;
      engineLabel: string;
    }
  | { kind: 'none'; note: RdsNoPriceReason };

/**
 * The instance's monthly instance-hour estimate: the exact on-demand price for
 * its region, engine, licence model, class and deployment x 730 hours, rounded
 * to cents -- or no figure, with the reason. Nothing is inferred: a missing
 * licence model or deployment, an Outposts or Local Zone placement (or one the
 * response can't show), an engine/licence pair the table doesn't price, or a key
 * the table doesn't have gives no figure. Never another key's price.
 */
export function rdsIdleSavings(db: DBInstance, region: string): RdsIdleSavings {
  const engine = typeof db.Engine === 'string' ? db.Engine : '';
  const instanceClass = typeof db.DBInstanceClass === 'string' ? db.DBInstanceClass : '';
  const licenseModel = typeof db.LicenseModel === 'string' ? db.LicenseModel : '';
  if (!engine || !instanceClass) return { kind: 'none', note: 'missing_engine_or_class' };
  if (!licenseModel) return { kind: 'none', note: 'missing_license_model' };
  if (typeof db.MultiAZ !== 'boolean') return { kind: 'none', note: 'missing_deployment' };

  const placement = rdsPlacement(db);
  if (placement.on_outposts === true) return { kind: 'none', note: 'outposts' };
  if (placement.on_outposts === null || placement.availability_zone === null) return { kind: 'none', note: 'unknown_placement' };
  if (!isRegionalZone(placement.availability_zone, region)) return { kind: 'none', note: 'local_zone' };
  if (placement.secondary_availability_zone !== null && !isRegionalZone(placement.secondary_availability_zone, region)) return { kind: 'none', note: 'local_zone' };

  if (!rdsPricedEngineLicence(engine, licenseModel)) return { kind: 'none', note: 'unsupported_engine_or_license' };
  if (!rdsPricedRegion(region)) return { kind: 'none', note: 'no_price_for_region' };
  const pricePerHour = rdsInstanceHourlyPrice({ region, engine, licenseModel, instanceClass, multiAz: db.MultiAZ });
  if (pricePerHour === null) return { kind: 'none', note: 'no_price_for_configuration' };
  const engineLabel = ENGINE_LABELS[`${engine}|${licenseModel}`];
  if (!engineLabel) return { kind: 'none', note: 'unsupported_engine_or_license' };
  return {
    kind: 'estimate',
    monthly: Math.round(pricePerHour * RDS_IDLE_RULE.savings.hours_per_month * 100) / 100,
    pricePerHour,
    engine,
    licenseModel,
    instanceClass,
    deployment: db.MultiAZ ? 'Multi-AZ' : 'Single-AZ',
    engineLabel,
  };
}

/** metadata.savings_basis of an estimate: what the figure is, and what it leaves out. */
export function rdsIdleSavingsBasis(region: string, savings: Extract<RdsIdleSavings, { kind: 'estimate' }>): string {
  const hours = RDS_IDLE_RULE.savings.hours_per_month;
  return `estimated: the ${region} on-demand list price for ${savings.instanceClass} ${savings.engineLabel} ${savings.deployment} instance hours ($${savings.pricePerHour}/hour, ${hours} hours); storage, Provisioned IOPS, backups and snapshots are not included and are still billed while the instance is stopped; no reservation or discount applied; not billed cost`;
}

/** The rest of an estimate's savings metadata (the basis is set by the detector): the exact price key and where the price came from. */
export function rdsIdleSavingsMetadata(region: string, resourceId: string, savings: Extract<RdsIdleSavings, { kind: 'estimate' }>): Record<string, unknown> {
  return {
    savings_claim: { kind: 'full_resource_cost', resource_ids: [resourceId] },
    price_per_hour: savings.pricePerHour,
    hours_per_month: RDS_IDLE_RULE.savings.hours_per_month,
    price_region: region,
    price_engine: savings.engine,
    price_license_model: savings.licenseModel,
    price_instance_class: savings.instanceClass,
    price_deployment: savings.deployment,
    price_engine_label: savings.engineLabel,
    price_source: RDS_INSTANCE_HOURLY_PRICE_SOURCE.url,
    price_version: RDS_INSTANCE_HOURLY_PRICE_SOURCE.version,
    price_published: RDS_INSTANCE_HOURLY_PRICE_SOURCE.published,
  };
}

// ─── Evidence, description ──────────────────────────────────────────────────

function ruleSnapshot(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(RDS_IDLE_RULE)) as Record<string, unknown>;
}

/** The rule identity and evidence stored on an idle RDS finding. */
export function rdsIdleFindingMetadata(input: {
  db: DBInstance;
  window: RdsIdleWindow;
  evaluatedAt: Date;
  createTime: Date;
  days: RdsDayEvidence[];
  worst: RdsWorstDays;
}): Record<string, unknown> {
  const { db } = input;
  return {
    rule_version: RDS_IDLE_RULE.version,
    rule: ruleSnapshot(),
    rds_idle: {
      evaluated_at: input.evaluatedAt.toISOString(),
      window_start: input.window.start.toISOString(),
      window_end: input.window.end.toISOString(),
      instance_create_time: input.createTime.toISOString(),
      completeness: 'complete',
      days: input.days,
      worst: input.worst,
      scope_checks: { aurora: false, db_cluster_member: false, read_replica: false, read_replica_source: false, rds_custom: false },
    },
    db_instance_arn: db.DBInstanceArn ?? null,
    dbi_resource_id: db.DbiResourceId ?? null,
    engine: db.Engine ?? null,
    engine_version: db.EngineVersion ?? null,
    db_instance_class: db.DBInstanceClass ?? null,
    multi_az: typeof db.MultiAZ === 'boolean' ? db.MultiAZ : null,
    allocated_storage_gb: typeof db.AllocatedStorage === 'number' ? db.AllocatedStorage : null,
    storage_type: db.StorageType ?? null,
    // C1b: what the price key and placement checks read, as DescribeDBInstances returned them.
    license_model: db.LicenseModel ?? null,
    ...rdsPlacement(db),
  };
}

/** Rounded DOWN to one decimal, so a qualifying peak (always under its limit) never reads as the limit. */
function floorTenth(value: number): string {
  return (Math.floor(value * 10 + 1e-9) / 10).toFixed(1);
}

/** The finding description. */
export function rdsIdleDescription(worst: RdsWorstDays): string {
  const iops = Math.max(worst.read_iops_peak, worst.write_iops_peak);
  return `Over the past 30 days this database had no client connections in any hourly sample, its CPU peaked at ${floorTenth(worst.cpu_peak_percent)}%, and its read and write activity peaked at ${floorTenth(iops)} IOPS. It may no longer be needed. Check with its owner and take a final snapshot before deleting or stopping it: no connections in the samples doesn't prove nothing depends on it, and a very short connection between samples can be missed.`;
}
