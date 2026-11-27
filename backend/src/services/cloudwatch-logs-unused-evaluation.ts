/**
 * The unused CloudWatch log group rule (config/cloudwatch-logs-unused-rule.ts)
 * applied to what was read from AWS. Pure: no AWS calls, no database, no clock
 * (the caller passes `now`). Same shape as the idle NAT gateway evaluation.
 *
 * One log group goes through, in this order:
 *   0. scope (judgeLogGroupScope), from DescribeLogGroups alone:
 *        a stored size below the floor -> below floor (summary line, never a
 *        card), whatever its class (fix round 1, founder ruling B1(b));
 *        Delivery class -> excluded; storedBytes missing -> couldn't check;
 *        no creation time -> couldn't check; created inside the window ->
 *        excluded (too new); name over 255 characters -> skipped (ruling D10);
 *   1. metric (judgeIncomingBytes): any IncomingBytes datapoint above 0 in the
 *      window -> not unused (activity wins, even on a failed or partial read);
 *      a read that did not complete -> couldn't check; otherwise (no datapoint,
 *      or only zeros) the stream check decides;
 *   2. newest stream (judgeNewestStream, ruling D5, required): a time inside
 *      the window -> not unused; no stream, a missing time or a failed read ->
 *      couldn't check; both times before the window -> unused.
 */
import type { LogGroup, LogStream } from '@aws-sdk/client-cloudwatch-logs';
import { CLOUDWATCH_LOGS_UNUSED_RULE, MAX_LOG_GROUP_NAME_LENGTH } from '../config/cloudwatch-logs-unused-rule';
import {
  CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES,
  CLOUDWATCH_LOGS_UNUSED_FLOOR_GB,
  formatStoredGb,
  isStoredBytes,
  meetsStoredSizeFloor,
} from '../config/cloudwatch-logs-size';
import type { BatchSeriesResult, QueryOutcome } from './cloudwatch-metric-batch.util';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export interface LogGroupUnusedWindow {
  start: Date;
  end: Date;
}

/** The last 90 complete UTC days, ending at UTC midnight of (now - settle lag), half-open [start, end). */
export function logGroupUnusedWindow(now: Date): LogGroupUnusedWindow {
  const lagged = now.getTime() - CLOUDWATCH_LOGS_UNUSED_RULE.window.settle_lag_hours * HOUR_MS;
  const endMs = Math.floor(lagged / DAY_MS) * DAY_MS;
  return { start: new Date(endMs - CLOUDWATCH_LOGS_UNUSED_RULE.window.days * DAY_MS), end: new Date(endMs) };
}

// ─── Counts ─────────────────────────────────────────────────────────────────

export type LogGroupNotUnusedReason = 'ingested_metric' | 'ingested_stream';
export type LogGroupCouldntCheckReason = 'no_stored_bytes' | 'no_creation_time' | 'cloudwatch_failed' | 'no_streams' | 'stream_incomplete' | 'stream_failed';
export type LogGroupExclusionReason = 'delivery_class' | 'too_new';
export type LogGroupSkipReason = 'name_too_long';

/**
 * What one run of the rule decided, stored on the run's check as
 * `cloudwatch_logs_unused`. Counts and sizes only, never log group names.
 * Every listed log group with a name is counted exactly once:
 * evaluated = flagged + below_floor.count + not_flagged + couldnt_check +
 * excluded + skipped (each summed over its reasons). `below_floor` also carries
 * the floor itself, in bytes and as displayed (one shared conversion, ruling
 * D9), for the run's below-floor summary line.
 */
export interface CloudWatchLogsUnusedCheckCounts {
  evaluated: number;
  flagged: number;
  below_floor: { count: number; stored_bytes: number; floor_bytes: number; floor_gb: string };
  not_flagged: Record<LogGroupNotUnusedReason, number>;
  couldnt_check: Record<LogGroupCouldntCheckReason, number>;
  excluded: Record<LogGroupExclusionReason, number>;
  skipped: Record<LogGroupSkipReason, number>;
}

export function emptyCloudWatchLogsUnusedCounts(): CloudWatchLogsUnusedCheckCounts {
  return {
    evaluated: 0,
    flagged: 0,
    below_floor: { count: 0, stored_bytes: 0, floor_bytes: CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES, floor_gb: CLOUDWATCH_LOGS_UNUSED_FLOOR_GB },
    not_flagged: { ingested_metric: 0, ingested_stream: 0 },
    couldnt_check: { no_stored_bytes: 0, no_creation_time: 0, cloudwatch_failed: 0, no_streams: 0, stream_incomplete: 0, stream_failed: 0 },
    excluded: { delivery_class: 0, too_new: 0 },
    skipped: { name_too_long: 0 },
  };
}

// ─── Scope ──────────────────────────────────────────────────────────────────

export type LogGroupScopeVerdict =
  | { kind: 'candidate'; storedBytes: number; createdAt: Date }
  | { kind: 'excluded'; reason: LogGroupExclusionReason }
  | { kind: 'below_floor'; storedBytes: number }
  | { kind: 'couldnt_check'; reason: 'no_stored_bytes' | 'no_creation_time' }
  | { kind: 'skipped'; reason: LogGroupSkipReason };

const EXCLUDED_CLASSES: ReadonlySet<string> = new Set(CLOUDWATCH_LOGS_UNUSED_RULE.scope.excluded_log_group_classes);

/**
 * Whether this rule evaluates the group at all, from DescribeLogGroups alone.
 * Every class but Delivery stores logs at the same storage price (Standard,
 * Infrequent Access, Essentials: AWS "Log classes"), so any other value,
 * including one this SDK doesn't model yet, is evaluated.
 *
 * The floor comes first (fix round 1, founder ruling B1(b)): a group with a
 * reported size below the floor joins the below-floor summary line whatever
 * its class, Delivery included. A Delivery group at or above the floor, or
 * with no reported size, is excluded (counted as delivery_class, never a
 * finding, never "couldn't check").
 */
export function judgeLogGroupScope(group: LogGroup & { logGroupName: string }, window: LogGroupUnusedWindow): LogGroupScopeVerdict {
  if (isStoredBytes(group.storedBytes) && !meetsStoredSizeFloor(group.storedBytes)) return { kind: 'below_floor', storedBytes: group.storedBytes };
  if (typeof group.logGroupClass === 'string' && EXCLUDED_CLASSES.has(group.logGroupClass)) return { kind: 'excluded', reason: 'delivery_class' };
  if (!isStoredBytes(group.storedBytes)) return { kind: 'couldnt_check', reason: 'no_stored_bytes' };
  const created = group.creationTime;
  if (typeof created !== 'number' || !Number.isFinite(created)) return { kind: 'couldnt_check', reason: 'no_creation_time' };
  if (created > window.start.getTime()) return { kind: 'excluded', reason: 'too_new' };
  if (group.logGroupName.length > MAX_LOG_GROUP_NAME_LENGTH) return { kind: 'skipped', reason: 'name_too_long' };
  return { kind: 'candidate', storedBytes: group.storedBytes, createdAt: new Date(created) };
}

// ─── Metric ─────────────────────────────────────────────────────────────────

export interface IncomingBytesReading {
  outcome: QueryOutcome;
  series: BatchSeriesResult | null;
}

export type IncomingBytesVerdict =
  | { kind: 'not_unused' }
  | { kind: 'couldnt_check' }
  | { kind: 'no_ingestion'; observed: 'empty' | 'zeros' };

function inWindow(ts: unknown, window: LogGroupUnusedWindow): boolean {
  if (!(ts instanceof Date) || Number.isNaN(ts.getTime())) return false;
  const t = ts.getTime();
  return t >= window.start.getTime() && t < window.end.getTime();
}

/** Step 1: IncomingBytes over the window. "No ingestion" is never the verdict alone: the stream check follows. */
export function judgeIncomingBytes(reading: IncomingBytesReading, window: LogGroupUnusedWindow): IncomingBytesVerdict {
  const series = reading.series;
  const activity = series !== null && series.values.some((value, i) => typeof value === 'number' && Number.isFinite(value) && value > 0 && inWindow(series.timestamps[i], window));
  if (activity) return { kind: 'not_unused' };
  if (reading.outcome === 'empty') return { kind: 'no_ingestion', observed: 'empty' };
  if (reading.outcome !== 'complete' || series === null) return { kind: 'couldnt_check' };
  // Complete with datapoints, none above 0: each must be a finite 0 (anything else isn't evidence of no ingestion).
  if (series.timestamps.length !== series.values.length) return { kind: 'couldnt_check' };
  if (!series.values.every((value) => value === 0)) return { kind: 'couldnt_check' };
  return { kind: 'no_ingestion', observed: 'zeros' };
}

// ─── Newest stream (ruling D5, required) ────────────────────────────────────

/** What DescribeLogStreams (newest event first, limit 1) answered: the first stream, none, or a failed read. */
export type NewestStreamRead = { kind: 'stream'; stream: LogStream } | { kind: 'none' } | { kind: 'failed' };

export type NewestStreamVerdict =
  | { kind: 'not_unused' }
  | { kind: 'couldnt_check'; reason: 'no_streams' | 'stream_incomplete' | 'stream_failed' }
  | { kind: 'unused'; lastEventTime: Date; lastIngestionTime: Date };

const isTime = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0;

/** Step 2: the newest stream's last event AND last ingestion time must both be before the window. */
export function judgeNewestStream(read: NewestStreamRead, window: LogGroupUnusedWindow): NewestStreamVerdict {
  if (read.kind === 'failed') return { kind: 'couldnt_check', reason: 'stream_failed' };
  if (read.kind === 'none') return { kind: 'couldnt_check', reason: 'no_streams' };
  const { lastEventTimestamp, lastIngestionTime } = read.stream;
  const start = window.start.getTime();
  // Activity wins: either time inside (or after the start of) the window.
  if ((isTime(lastEventTimestamp) && lastEventTimestamp >= start) || (isTime(lastIngestionTime) && lastIngestionTime >= start)) {
    return { kind: 'not_unused' };
  }
  if (!isTime(lastEventTimestamp) || !isTime(lastIngestionTime)) return { kind: 'couldnt_check', reason: 'stream_incomplete' };
  return { kind: 'unused', lastEventTime: new Date(lastEventTimestamp), lastIngestionTime: new Date(lastIngestionTime) };
}

// ─── Description, evidence ──────────────────────────────────────────────────

/** "Never expire": DescribeLogGroups returns no retentionInDays. */
export function neverExpires(group: LogGroup): boolean {
  return group.retentionInDays === undefined || group.retentionInDays === null;
}

/**
 * The finding description: the approved copy (c3-stage-a.md §A1.5, Rule B),
 * with the size from the shared conversion and its AWS source named. No
 * dollar amount, ever (binding condition 1).
 */
export function logGroupUnusedDescription(input: { storedBytes: number; neverExpire: boolean; deletionProtection: boolean }): string {
  const days = CLOUDWATCH_LOGS_UNUSED_RULE.window.days;
  const parts = [
    `No new log events reached this log group in the last ${days} days, and its newest log stream was last written before then.`,
    `AWS reports that it still stores ${formatStoredGb(input.storedBytes)} GB.`,
    'Check that nothing writes to it only rarely, such as a yearly job or a recovery runbook.',
    'If you might need its contents, export them to Amazon S3 before deleting it.',
  ];
  if (input.neverExpire) parts.push('It is set to keep logs forever.');
  if (input.deletionProtection) parts.push('Deletion protection is on: turn it off before deleting.');
  return parts.join(' ');
}

function ruleSnapshot(): Record<string, unknown> {
  return JSON.parse(JSON.stringify(CLOUDWATCH_LOGS_UNUSED_RULE)) as Record<string, unknown>;
}

/** The rule identity and evidence stored on an unused log group finding. No stream names. */
export function logGroupUnusedFindingMetadata(input: {
  group: LogGroup;
  storedBytes: number;
  createdAt: Date;
  window: LogGroupUnusedWindow;
  evaluatedAt: Date;
  metricObserved: 'empty' | 'zeros';
  lastEventTime: Date;
  lastIngestionTime: Date;
}): Record<string, unknown> {
  const group = input.group;
  const metric = CLOUDWATCH_LOGS_UNUSED_RULE.metric;
  return {
    rule_version: CLOUDWATCH_LOGS_UNUSED_RULE.version,
    rule: ruleSnapshot(),
    cloudwatch_logs_unused: {
      evaluated_at: input.evaluatedAt.toISOString(),
      window_start: input.window.start.toISOString(),
      window_end: input.window.end.toISOString(),
      creation_time: input.createdAt.toISOString(),
      stored_bytes: input.storedBytes,
      stored_gb: formatStoredGb(input.storedBytes),
      stored_bytes_source: CLOUDWATCH_LOGS_UNUSED_RULE.floor.source,
      floor_bytes: CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES,
      incoming_bytes: {
        namespace: metric.namespace,
        metric: metric.metric,
        stat: metric.stat,
        period_seconds: metric.period_seconds,
        days: CLOUDWATCH_LOGS_UNUSED_RULE.window.days,
        observed: input.metricObserved,
      },
      newest_stream: {
        last_event_time: input.lastEventTime.toISOString(),
        last_ingestion_time: input.lastIngestionTime.toISOString(),
      },
      retention_in_days: neverExpires(group) ? null : group.retentionInDays,
      never_expire: neverExpires(group),
      deletion_protection: typeof group.deletionProtectionEnabled === 'boolean' ? group.deletionProtectionEnabled : null,
      log_group_class: group.logGroupClass ?? null,
    },
  };
}
