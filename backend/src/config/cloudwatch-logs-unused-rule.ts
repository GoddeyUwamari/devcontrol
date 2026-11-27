/**
 * The unused CloudWatch log group rule (C3a, Rule B): the one place its scope,
 * floor, window, metric and newest-stream check live. Founder rulings:
 * c3-stage-a.md Addenda 1 and 2.
 *
 * A log group is unused only when ALL of these hold:
 *   - DescribeLogGroups reported its storedBytes, and it is at least the floor
 *     (config/cloudwatch-logs-size.ts, ruling D9; below it the group is counted
 *     in the run's below-floor summary line, never listed -- whatever its
 *     class: the floor is checked first, fix round 1 ruling B1(b));
 *   - it is not a Delivery-class group (kept one day by AWS; at or above the
 *     floor it is counted as excluded, never a finding);
 *   - it was created before the 90-day window began (younger groups are excluded);
 *   - its name fits the finding identity (255 characters; longer names are
 *     skipped and counted, ruling D10);
 *   - AWS/Logs IncomingBytes (Sum, by LogGroupName, daily) has no datapoint
 *     above 0 in the last 90 complete UTC days;
 *   - AND its newest log stream (DescribeLogStreams, newest event first, one
 *     stream) has both its last event time and its last ingestion time before
 *     the window began (ruling D5: required, because an empty metric alone does
 *     not prove inactivity).
 *
 * Activity wins: any IncomingBytes datapoint above 0, or a newest stream with a
 * time inside the window, makes the group "not unused" even when other data is
 * missing. Otherwise a failed or partial metric read, no streams, a stream
 * without both times, or a failed stream read makes it "couldn't check" --
 * never unused.
 *
 * No dollar figure (ruling D3): whether storedBytes is the billed size is not
 * confirmed (gate G-S), so no saving is claimed, the card says "No dollar
 * estimate", and severity is fixed Low (ruling D4).
 *
 * CLOUDWATCH_LOGS_UNUSED_RULE is copied verbatim into every finding it produces
 * (metadata.rule). Any change to it must bump `version`: the snapshot test in
 * config/__tests__/c3-rule-identity.test.ts enforces that.
 *
 * Pure data: no AWS calls, no database.
 */
import { BYTES_PER_GB, CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES } from './cloudwatch-logs-size';

function deepFreeze<T>(value: T): T {
  if (value && typeof value === 'object') {
    for (const inner of Object.values(value as Record<string, unknown>)) deepFreeze(inner);
    Object.freeze(value);
  }
  return value;
}

/** The resource type C3 findings are stored under (their rule's service, OPTIMIZATION_RULE_SERVICES). */
export const CLOUDWATCH_LOG_GROUP_RESOURCE_TYPE = 'CloudWatch';

/** cost_recommendations.resource_id is VARCHAR(255): a longer log group name can't be a finding identity (ruling D10). */
export const MAX_LOG_GROUP_NAME_LENGTH = 255;

export const CLOUDWATCH_LOGS_UNUSED_RULE = deepFreeze({
  id: 'cloudwatch_unused_logs',
  version: 1,
  window: { days: 90, basis: 'complete_utc_days', settle_lag_hours: 2 },
  listing: { api: 'DescribeLogGroups', page_size: 50, name_pattern_filter: false, linked_accounts: false, region: 'home' },
  scope: {
    excluded_log_group_classes: ['DELIVERY'],
    created_before_window: true,
    max_name_length: MAX_LOG_GROUP_NAME_LENGTH,
    on_longer_name: 'skip_and_count',
    on_missing_stored_bytes: 'couldnt_check',
    on_missing_creation_time: 'couldnt_check',
  },
  floor: {
    stored_bytes_min: CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES,
    bytes_per_gb: BYTES_PER_GB,
    source: 'DescribeLogGroups.storedBytes',
    below_floor: 'summary_line',
  },
  metric: {
    namespace: 'AWS/Logs',
    metric: 'IncomingBytes',
    dimension: 'LogGroupName',
    stat: 'Sum',
    period_seconds: 86400,
    unused_when: 'no_datapoint_above_zero',
    on_failed_read: 'couldnt_check',
  },
  newest_stream: {
    api: 'DescribeLogStreams',
    order_by: 'LastEventTime',
    descending: true,
    limit: 1,
    required: true,
    last_event_before_window: true,
    last_ingestion_before_window: true,
    on_no_streams: 'couldnt_check',
    on_missing_time: 'couldnt_check',
    on_failed_read: 'couldnt_check',
  },
  activity_wins: true,
  savings: { dollar_figure: false, reason: 'stored_size_billing_basis_unconfirmed', severity: 'LOW' },
} as const);

export type CloudWatchLogsUnusedRule = typeof CLOUDWATCH_LOGS_UNUSED_RULE;
