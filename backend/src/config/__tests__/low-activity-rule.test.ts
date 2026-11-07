/**
 * FP PR 2b (FP2b-Q15): the low-activity rule's identity is pinned. Every
 * finding stores LOW_ACTIVITY_RULE verbatim with rule_version, so changing a
 * threshold, the window or a completeness requirement without bumping
 * `version` would make old and new findings claim the same rule. This test
 * fails until the change gets a new version, its own pinned entry here, and
 * the stop allow-list decides about it.
 */
import { LOW_ACTIVITY_RULE, LOW_ACTIVITY_STOP_EVIDENCE_MAX_AGE_HOURS, hasLowActivityRuleIdentity } from '../low-activity-rule';
import { STOP_ELIGIBLE_IDLE_RULE_VERSIONS } from '../../services/stop-instance-eligibility';

/** Every released version of the rule, exactly. Add an entry (never edit one) when the rule changes. */
const PINNED_RULES: Record<number, unknown> = {
  2: {
    id: 'ec2_low_activity',
    version: 2,
    window: { days: 30, basis: 'complete_utc_days', settle_lag_hours: 2 },
    cpu: { namespace: 'AWS/EC2', metric: 'CPUUtilization', stat: 'Maximum', period_seconds: 3600, daily_peak_below_percent: 10 },
    network: { namespace: 'AWS/EC2', metrics: ['NetworkIn', 'NetworkOut'], stat: 'Sum', period_seconds: 3600, daily_total_below_bytes: 5_000_000 },
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
  },
};

describe('LOW_ACTIVITY_RULE identity', () => {
  it('matches the pinned definition of its version exactly (bump the version on any change)', () => {
    const pinned = PINNED_RULES[LOW_ACTIVITY_RULE.version];
    expect(pinned).toBeDefined();
    expect(JSON.parse(JSON.stringify(LOW_ACTIVITY_RULE))).toEqual(pinned);
  });

  it('is version 2, the version the stop allow-list accepts', () => {
    expect(LOW_ACTIVITY_RULE.version).toBe(2);
    expect(STOP_ELIGIBLE_IDLE_RULE_VERSIONS).toContain(LOW_ACTIVITY_RULE.version);
  });

  it('cannot be changed at run time', () => {
    expect(Object.isFrozen(LOW_ACTIVITY_RULE)).toBe(true);
    expect(Object.isFrozen(LOW_ACTIVITY_RULE.cpu)).toBe(true);
    expect(Object.isFrozen(LOW_ACTIVITY_RULE.network.metrics)).toBe(true);
  });

  it('keeps the stop freshness limit at 13 hours (FP2b-Q13)', () => {
    expect(LOW_ACTIVITY_STOP_EVIDENCE_MAX_AGE_HOURS).toBe(13);
  });
});

describe('hasLowActivityRuleIdentity', () => {
  const rule = JSON.parse(JSON.stringify(LOW_ACTIVITY_RULE));
  it('accepts the marker and the rule object together', () => {
    expect(hasLowActivityRuleIdentity({ rule_version: 2, rule })).toBe(true);
  });

  it.each([
    ['no metadata', null],
    ['a CPU-only finding', { average_cpu: 1.2, days_analyzed: 7, cpu_evidence: {} }],
    ['the marker alone', { rule_version: 2 }],
    ['the rule alone', { rule }],
    ['the marker as a string', { rule_version: '2', rule }],
    ['another marker', { rule_version: 3, rule }],
    ['another rule id', { rule_version: 2, rule: { ...rule, id: 'ec2_idle' } }],
    ['a rule object of another version', { rule_version: 2, rule: { ...rule, version: 1 } }],
    ['an array', [{ rule_version: 2, rule }]],
  ])('rejects %s', (_label, metadata) => {
    expect(hasLowActivityRuleIdentity(metadata)).toBe(false);
  });
});
