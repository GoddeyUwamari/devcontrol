/**
 * The low-activity EC2 rule (false-positives PR 2b): the one place its
 * thresholds, window and completeness requirements live.
 *
 * An instance is a low-activity instance only when, on EVERY one of the last
 * 30 complete UTC days:
 *   - its peak hourly CPU (CloudWatch CPUUtilization, hourly Maximum) stayed
 *     below 10%, and
 *   - its total network traffic (NetworkIn + NetworkOut, hourly Sums added up
 *     per day) stayed below 5,000,000 bytes,
 * every hour of every day has a datapoint for all three metrics, the instance
 * has been running since before the window began, and it is not registered with
 * a load balancer (ELBv2 target group or Classic Load Balancer) nor a member of
 * an Auto Scaling group.
 *
 * Activity wins: any datapoint at or above a threshold, even on an incomplete
 * day, makes the instance "not low-activity". Missing or failed data, or an
 * instance launched inside the window, otherwise makes it "couldn't check" --
 * never low-activity.
 *
 * LOW_ACTIVITY_RULE is copied verbatim into every finding it produces
 * (metadata.rule), so a finding stays reconstructable after the rule changes.
 * Any change to it must bump `version` (and the stop allow-list): the snapshot
 * test in config/__tests__/low-activity-rule.test.ts enforces that.
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

export const LOW_ACTIVITY_RULE = deepFreeze({
  id: 'ec2_low_activity',
  version: 2,
  window: { days: 30, basis: 'complete_utc_days', settle_lag_hours: 2 },
  cpu: {
    namespace: 'AWS/EC2',
    metric: 'CPUUtilization',
    stat: 'Maximum',
    period_seconds: 3600,
    daily_peak_below_percent: 10,
  },
  network: {
    namespace: 'AWS/EC2',
    metrics: ['NetworkIn', 'NetworkOut'],
    stat: 'Sum',
    period_seconds: 3600,
    daily_total_below_bytes: 5_000_000,
  },
  completeness: {
    hours_per_day_required: 24,
    metrics_required: ['CPUUtilization', 'NetworkIn', 'NetworkOut'],
    launched_before_window: true,
    sample_count_required: false,
  },
  activity_wins: true,
  topology: {
    elbv2_target_groups: 'exclude',
    classic_load_balancers: 'exclude',
    auto_scaling_groups: 'exclude',
    on_read_failure: 'couldnt_check',
  },
} as const);

export type LowActivityRule = typeof LOW_ACTIVITY_RULE;

/**
 * How old (hours) a low-activity finding's evaluation may be for DevControl to
 * offer or run "stop instance" on it (FP2b-Q13). Two 6-hourly scans plus slack.
 * Stop policy, not part of the rule's identity.
 */
export const LOW_ACTIVITY_STOP_EVIDENCE_MAX_AGE_HOURS = 13;

/** Display label of a finding produced by this rule (W1). Historical rows keep their stored issue text. */
export const LOW_ACTIVITY_DISPLAY_LABEL = 'Low-activity instance';

/**
 * True when `metadata` carries this rule's identity: the stop marker
 * rule_version (a number) equal to the rule's version, and the stored rule
 * object naming this rule and version. Anything else -- including every
 * CPU-only finding written before PR 2b -- is not a low-activity finding.
 */
export function hasLowActivityRuleIdentity(metadata: unknown): boolean {
  if (metadata === null || typeof metadata !== 'object' || Array.isArray(metadata)) return false;
  const m = metadata as Record<string, unknown>;
  if (typeof m.rule_version !== 'number' || m.rule_version !== LOW_ACTIVITY_RULE.version) return false;
  const rule = m.rule;
  if (rule === null || typeof rule !== 'object' || Array.isArray(rule)) return false;
  const r = rule as Record<string, unknown>;
  return r.id === LOW_ACTIVITY_RULE.id && r.version === LOW_ACTIVITY_RULE.version;
}
