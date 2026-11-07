/**
 * The low-activity rule (config/low-activity-rule.ts) applied to what was read
 * from AWS. Pure: no AWS calls, no database, no clock (the caller passes `now`).
 *
 * One instance goes through, in this order:
 *   1. activity (FP2b-Q3, activity wins): any CPU datapoint at or above the CPU
 *      threshold, or any day whose network datapoints already add up to the
 *      network threshold, makes it "not low-activity" -- even when that day, or
 *      the whole window, is incomplete. A partial sum is a lower bound, so it
 *      can prove activity but never its absence;
 *   2. age: launched inside the window (or no launch time) -> couldn't check;
 *   3. data: any of the three queries not 'complete' -> couldn't check;
 *   4. completeness (FP2b-Q1): every hour of every day for every metric, else
 *      couldn't check;
 *   5. topology (only for instances that pass 1-4, FP2b-Q9): registered with a
 *      load balancer or in an Auto Scaling group -> not low-activity; any read
 *      that failed, and no exclusion found by the reads that worked ->
 *      couldn't check;
 *   6. otherwise low-activity.
 */
import { LOW_ACTIVITY_RULE } from '../config/low-activity-rule';
import type { BatchSeriesResult, QueryOutcome } from './cloudwatch-metric-batch.util';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const HOURS_PER_DAY = 24;

export interface LowActivityWindow {
  start: Date;
  end: Date;
}

/**
 * The window: the last `window.days` complete UTC days, ending at UTC midnight
 * of (now - settle lag), so the last day's late datapoints have arrived and
 * today's partial day is never included (FP2b-Q4).
 */
export function lowActivityWindow(now: Date): LowActivityWindow {
  const lagged = now.getTime() - LOW_ACTIVITY_RULE.window.settle_lag_hours * HOUR_MS;
  const endMs = Math.floor(lagged / DAY_MS) * DAY_MS;
  return { start: new Date(endMs - LOW_ACTIVITY_RULE.window.days * DAY_MS), end: new Date(endMs) };
}

export type LowActivityMetric = 'cpu' | 'networkIn' | 'networkOut';

/** One query's result: how it ended, and whatever datapoints came back. */
export interface MetricReading {
  outcome: QueryOutcome;
  series: BatchSeriesResult | null;
}

export type InstanceMetricReadings = Record<LowActivityMetric, MetricReading>;

/** One day's stored evidence (FP2b-Q16): daily values only, never the hourly series. */
export interface DayEvidence {
  /** The UTC day, YYYY-MM-DD. */
  date: string;
  cpu_peak_percent: number;
  network_in_bytes: number;
  network_out_bytes: number;
}

export interface WorstDays {
  cpu_peak_percent: number;
  cpu_peak_date: string;
  network_bytes_max: number;
  network_max_date: string;
}

export type NotLowActivityReason = 'cpu_peak' | 'network' | 'load_balancer' | 'auto_scaling';
export type CouldntCheckReason = 'too_new_or_restarted' | 'cloudwatch_failed' | 'cloudwatch_incomplete' | 'topology_unreadable';

export type MetricVerdict =
  | { kind: 'not_low_activity'; reason: 'cpu_peak' | 'network' }
  | { kind: 'couldnt_check'; reason: Exclude<CouldntCheckReason, 'topology_unreadable'> }
  | { kind: 'quiet'; days: DayEvidence[]; worst: WorstDays };

interface DayBucket {
  cpuPeak: number | null;
  cpuHours: Set<number>;
  inBytes: number;
  inHours: Set<number>;
  outBytes: number;
  outHours: Set<number>;
}

function emptyBuckets(): DayBucket[] {
  return Array.from({ length: LOW_ACTIVITY_RULE.window.days }, () => ({
    cpuPeak: null,
    cpuHours: new Set<number>(),
    inBytes: 0,
    inHours: new Set<number>(),
    outBytes: 0,
    outHours: new Set<number>(),
  }));
}

/** Each valid datapoint inside the window, with its hour index (0 .. days*24-1). */
function* datapoints(series: BatchSeriesResult | null, window: LowActivityWindow): Generator<{ hour: number; value: number }> {
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

function bucketize(readings: InstanceMetricReadings, window: LowActivityWindow): DayBucket[] {
  const days = emptyBuckets();
  for (const { hour, value } of datapoints(readings.cpu.series, window)) {
    const day = days[Math.floor(hour / HOURS_PER_DAY)];
    day.cpuPeak = day.cpuPeak === null ? value : Math.max(day.cpuPeak, value);
    day.cpuHours.add(hour);
  }
  for (const { hour, value } of datapoints(readings.networkIn.series, window)) {
    const day = days[Math.floor(hour / HOURS_PER_DAY)];
    day.inBytes += value;
    day.inHours.add(hour);
  }
  for (const { hour, value } of datapoints(readings.networkOut.series, window)) {
    const day = days[Math.floor(hour / HOURS_PER_DAY)];
    day.outBytes += value;
    day.outHours.add(hour);
  }
  return days;
}

function utcDate(window: LowActivityWindow, dayIndex: number): string {
  return new Date(window.start.getTime() + dayIndex * DAY_MS).toISOString().slice(0, 10);
}

/**
 * Steps 1-4 for one instance. `launchTime` is EC2's LaunchTime (the last
 * launch or start), undefined when AWS did not return one.
 */
export function judgeLowActivityMetrics(
  readings: InstanceMetricReadings,
  launchTime: Date | undefined,
  window: LowActivityWindow
): MetricVerdict {
  const days = bucketize(readings, window);
  const cpuThreshold = LOW_ACTIVITY_RULE.cpu.daily_peak_below_percent;
  const networkThreshold = LOW_ACTIVITY_RULE.network.daily_total_below_bytes;

  // 1. Activity wins, whatever else is missing.
  if (days.some((day) => day.cpuPeak !== null && day.cpuPeak >= cpuThreshold)) {
    return { kind: 'not_low_activity', reason: 'cpu_peak' };
  }
  if (days.some((day) => day.inBytes + day.outBytes >= networkThreshold)) {
    return { kind: 'not_low_activity', reason: 'network' };
  }

  // 2. Running since before the window.
  if (!(launchTime instanceof Date) || Number.isNaN(launchTime.getTime()) || launchTime.getTime() > window.start.getTime()) {
    return { kind: 'couldnt_check', reason: 'too_new_or_restarted' };
  }

  // 3. Every query completed.
  const outcomes = [readings.cpu.outcome, readings.networkIn.outcome, readings.networkOut.outcome];
  if (outcomes.some((outcome) => outcome !== 'complete' && outcome !== 'empty')) {
    return { kind: 'couldnt_check', reason: 'cloudwatch_failed' };
  }
  if (outcomes.some((outcome) => outcome !== 'complete')) {
    return { kind: 'couldnt_check', reason: 'cloudwatch_incomplete' };
  }

  // 4. Every hour of every day, for every metric.
  const required = LOW_ACTIVITY_RULE.completeness.hours_per_day_required;
  if (days.some((day) => day.cpuHours.size < required || day.inHours.size < required || day.outHours.size < required)) {
    return { kind: 'couldnt_check', reason: 'cloudwatch_incomplete' };
  }

  const evidence: DayEvidence[] = days.map((day, i) => ({
    date: utcDate(window, i),
    cpu_peak_percent: day.cpuPeak as number,
    network_in_bytes: day.inBytes,
    network_out_bytes: day.outBytes,
  }));
  let cpuWorst = 0;
  let networkWorst = 0;
  evidence.forEach((day, i) => {
    if (day.cpu_peak_percent > evidence[cpuWorst].cpu_peak_percent) cpuWorst = i;
    if (day.network_in_bytes + day.network_out_bytes > evidence[networkWorst].network_in_bytes + evidence[networkWorst].network_out_bytes) networkWorst = i;
  });
  return {
    kind: 'quiet',
    days: evidence,
    worst: {
      cpu_peak_percent: evidence[cpuWorst].cpu_peak_percent,
      cpu_peak_date: evidence[cpuWorst].date,
      network_bytes_max: evidence[networkWorst].network_in_bytes + evidence[networkWorst].network_out_bytes,
      network_max_date: evidence[networkWorst].date,
    },
  };
}

/** What the region's load balancer and Auto Scaling reads returned. A failed read is `{ ok: false }`. */
export interface TopologyReads {
  elbv2: { ok: true; instanceIds: ReadonlySet<string>; ipAddresses: ReadonlySet<string>; targetGroupsRead: number } | { ok: false };
  classic: { ok: true; instanceIds: ReadonlySet<string>; loadBalancersRead: number } | { ok: false };
  autoScaling: { ok: true; memberIds: ReadonlySet<string> } | { ok: false };
}

/** What an instance's own DescribeInstances entry says about its topology. */
export interface InstanceTopologyFacts {
  instanceId: string;
  /** Every private IPv4 and IPv6 address on the instance's interfaces (an ip target group registers these). */
  ipAddresses: readonly string[];
  /** The instance carries the aws:autoscaling:groupName tag. */
  autoScalingTag: boolean;
}

export interface TopologyEvidence {
  elbv2_target_groups: 'not_registered';
  target_groups_read: number;
  classic_load_balancers: 'not_registered';
  classic_load_balancers_read: number;
  auto_scaling: 'not_member';
}

export type TopologyVerdict =
  | { kind: 'not_low_activity'; reason: 'load_balancer' | 'auto_scaling' }
  | { kind: 'couldnt_check'; reason: 'topology_unreadable' }
  | { kind: 'clear'; evidence: TopologyEvidence };

/**
 * Step 5. An exclusion found by any read that worked wins; otherwise a read
 * that failed means couldn't check -- never "not registered".
 */
export function judgeLowActivityTopology(facts: InstanceTopologyFacts, reads: TopologyReads): TopologyVerdict {
  const behindElbv2 = reads.elbv2.ok
    && (reads.elbv2.instanceIds.has(facts.instanceId) || facts.ipAddresses.some((ip) => (reads.elbv2 as { ipAddresses: ReadonlySet<string> }).ipAddresses.has(ip)));
  const behindClassic = reads.classic.ok && reads.classic.instanceIds.has(facts.instanceId);
  if (behindElbv2 || behindClassic) return { kind: 'not_low_activity', reason: 'load_balancer' };

  const inAutoScaling = facts.autoScalingTag || (reads.autoScaling.ok && reads.autoScaling.memberIds.has(facts.instanceId));
  if (inAutoScaling) return { kind: 'not_low_activity', reason: 'auto_scaling' };

  if (!reads.elbv2.ok || !reads.classic.ok || !reads.autoScaling.ok) return { kind: 'couldnt_check', reason: 'topology_unreadable' };

  return {
    kind: 'clear',
    evidence: {
      elbv2_target_groups: 'not_registered',
      target_groups_read: reads.elbv2.targetGroupsRead,
      classic_load_balancers: 'not_registered',
      classic_load_balancers_read: reads.classic.loadBalancersRead,
      auto_scaling: 'not_member',
    },
  };
}

/** checked / couldn't check counts by reason, for cost_analysis_runs.checks (FP2b-Q21). No resource IDs. */
export interface LowActivityCheckCounts {
  evaluated: number;
  low_activity: number;
  not_low_activity: Record<NotLowActivityReason, number>;
  couldnt_check: Record<CouldntCheckReason, number>;
}

export function emptyLowActivityCounts(): LowActivityCheckCounts {
  return {
    evaluated: 0,
    low_activity: 0,
    not_low_activity: { cpu_peak: 0, network: 0, load_balancer: 0, auto_scaling: 0 },
    couldnt_check: { too_new_or_restarted: 0, cloudwatch_failed: 0, cloudwatch_incomplete: 0, topology_unreadable: 0 },
  };
}

/** A plain, mutable-free copy of the rule, as stored in every finding. */
function ruleSnapshot(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(LOW_ACTIVITY_RULE));
}

/**
 * The rule identity and evidence stored on a low-activity finding (D6): the
 * stop marker rule_version, the full rule object, and the daily evidence with
 * its worst-day summary, window, launch time and topology checks.
 */
export function lowActivityFindingMetadata(input: {
  window: LowActivityWindow;
  evaluatedAt: Date;
  launchTime: Date;
  days: DayEvidence[];
  worst: WorstDays;
  topology: TopologyEvidence;
}): { rule_version: number; rule: Record<string, unknown>; low_activity: Record<string, unknown> } {
  return {
    rule_version: LOW_ACTIVITY_RULE.version,
    rule: ruleSnapshot(),
    low_activity: {
      evaluated_at: input.evaluatedAt.toISOString(),
      window_start: input.window.start.toISOString(),
      window_end: input.window.end.toISOString(),
      launch_time: input.launchTime.toISOString(),
      completeness: 'complete',
      days: input.days,
      worst: input.worst,
      topology: input.topology,
    },
  };
}

/**
 * {peak}: the highest hourly peak, rounded DOWN to one decimal, so a
 * qualifying peak (always under 10%) never reads "10.0%": 9.97 reads "9.9".
 * The tiny epsilon keeps binary floating point from dropping an exact tenth
 * (e.g. 2.3 * 10 = 22.999...).
 */
export function formatPeakPercent(percent: number): string {
  return (Math.floor(percent * 10 + 1e-9) / 10).toFixed(1);
}

/**
 * {maxDailyMb}: the busiest day's total in MB (10^6 bytes), rounded up to one
 * decimal, at least 0.1, and always strictly above the total so "stayed under"
 * is true (an exact 3,200,000 bytes reads 3.3, not 3.2).
 */
export function formatMaxDailyMb(bytes: number): string {
  const tenths = Math.floor(Math.max(0, bytes) / 100_000) + 1;
  return (tenths / 10).toFixed(1);
}

/** The finding description (W2b, founder-approved). */
export function lowActivityDescription(worst: WorstDays): string {
  return `Over the past 30 days this instance's CPU peaked at ${formatPeakPercent(worst.cpu_peak_percent)}%, its network traffic stayed under ${formatMaxDailyMb(worst.network_bytes_max)} MB a day, and it isn't registered with a load balancer or part of an Auto Scaling group. It may no longer be needed. Check with its owner before stopping it: low activity doesn't prove nothing depends on it.`;
}
