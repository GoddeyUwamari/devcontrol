/**
 * FP PR 2b: the low-activity rule on what AWS returned (pure).
 *
 *   - every one of 30 complete UTC days needs hourly CPU Maximum < 10% and
 *     NetworkIn + NetworkOut < 5,000,000 bytes (FP2b-Q1, Q5);
 *   - every hour of every day for all three metrics, launched before the
 *     window, every query complete -- else couldn't check (Q1);
 *   - activity wins: a datapoint at or above a threshold, even on an
 *     incomplete day, is "not low-activity" (Q3);
 *   - the window ends at UTC midnight of (now - 2 h) (Q4);
 *   - topology: load balancer or Auto Scaling membership excludes; a failed
 *     read is couldn't check unless another read already excluded it (Q9).
 */
import {
  formatMaxDailyMb,
  formatPeakPercent,
  judgeLowActivityMetrics,
  judgeLowActivityTopology,
  lowActivityDescription,
  lowActivityFindingMetadata,
  lowActivityWindow,
  type InstanceMetricReadings,
  type LowActivityWindow,
  type MetricReading,
  type TopologyReads,
} from '../low-activity-evaluation';
import { LOW_ACTIVITY_RULE, hasLowActivityRuleIdentity } from '../../config/low-activity-rule';
import type { QueryOutcome } from '../cloudwatch-metric-batch.util';

const HOUR = 3_600_000;
const NOW = new Date('2026-11-07T15:00:00Z');
const WINDOW = lowActivityWindow(NOW);
const LAUNCHED = new Date(WINDOW.start.getTime() - 5 * 86_400_000);
const HOURS = 30 * 24;

/** An hourly series over the window: value(hour) or null to leave the hour out. */
function hourly(value: (hour: number) => number | null, outcome: QueryOutcome = 'complete', window: LowActivityWindow = WINDOW): MetricReading {
  const timestamps: Date[] = [];
  const values: number[] = [];
  for (let h = 0; h < HOURS; h++) {
    const v = value(h);
    if (v === null) continue;
    timestamps.push(new Date(window.start.getTime() + h * HOUR));
    values.push(v);
  }
  return { outcome, series: values.length > 0 ? { timestamps, values } : null };
}

/** Quiet everywhere: CPU 2%, 100,000 bytes in and out each hour (4.8 MB a day). */
function quiet(overrides: Partial<InstanceMetricReadings> = {}): InstanceMetricReadings {
  return {
    cpu: hourly(() => 2),
    networkIn: hourly(() => 100_000),
    networkOut: hourly(() => 100_000),
    ...overrides,
  };
}

const judge = (readings: InstanceMetricReadings, launch: Date | undefined = LAUNCHED) => judgeLowActivityMetrics(readings, launch, WINDOW);

describe('the window (FP2b-Q4)', () => {
  it('is the 30 complete UTC days ending at UTC midnight of now - 2 h', () => {
    expect(WINDOW.end.toISOString()).toBe('2026-11-07T00:00:00.000Z');
    expect(WINDOW.start.toISOString()).toBe('2026-10-08T00:00:00.000Z');
  });

  it('at 01:30 UTC, the day that ended 90 minutes ago is not included yet', () => {
    const w = lowActivityWindow(new Date('2026-11-07T01:30:00Z'));
    expect(w.end.toISOString()).toBe('2026-11-06T00:00:00.000Z');
  });

  it('at 02:00 UTC exactly, yesterday is included', () => {
    expect(lowActivityWindow(new Date('2026-11-07T02:00:00Z')).end.toISOString()).toBe('2026-11-07T00:00:00.000Z');
  });

  it("ignores today's partial day and anything outside the window", () => {
    const cpu = hourly(() => 2);
    cpu.series!.timestamps.push(new Date(WINDOW.end.getTime() + HOUR), new Date(WINDOW.start.getTime() - HOUR));
    cpu.series!.values.push(95, 95);
    expect(judge(quiet({ cpu })).kind).toBe('quiet');
  });
});

describe('low-activity (all conditions met)', () => {
  it('30 complete quiet days -> quiet, with 30 daily entries and the worst days', () => {
    const verdict = judge(quiet({ cpu: hourly((h) => (h === 100 ? 9.9 : 2)) }));
    expect(verdict.kind).toBe('quiet');
    if (verdict.kind !== 'quiet') return;
    expect(verdict.days).toHaveLength(30);
    expect(verdict.days[0]).toEqual({ date: '2026-10-08', cpu_peak_percent: 2, network_in_bytes: 2_400_000, network_out_bytes: 2_400_000 });
    expect(verdict.worst).toEqual({ cpu_peak_percent: 9.9, cpu_peak_date: '2026-10-12', network_bytes_max: 4_800_000, network_max_date: '2026-10-08' });
  });

  it('a genuine 0% CPU and 0 bytes are real values, not missing data', () => {
    expect(judge(quiet({ cpu: hourly(() => 0), networkIn: hourly(() => 0), networkOut: hourly(() => 0) })).kind).toBe('quiet');
  });

  it('launched exactly at the window start counts as running for the whole window', () => {
    expect(judge(quiet(), WINDOW.start).kind).toBe('quiet');
  });
});

describe('CPU (hourly Maximum < 10%)', () => {
  it('one hour at exactly 10.0% on one day -> not low-activity (cpu_peak)', () => {
    expect(judge(quiet({ cpu: hourly((h) => (h === 300 ? 10 : 2)) }))).toEqual({ kind: 'not_low_activity', reason: 'cpu_peak' });
  });

  it('the oldest day of the window counts (hour 0)', () => {
    expect(judge(quiet({ cpu: hourly((h) => (h === 0 ? 62.4 : 2)) }))).toEqual({ kind: 'not_low_activity', reason: 'cpu_peak' });
  });

  it('the newest hour of the window counts', () => {
    expect(judge(quiet({ cpu: hourly((h) => (h === HOURS - 1 ? 12 : 2)) }))).toEqual({ kind: 'not_low_activity', reason: 'cpu_peak' });
  });

  it('a burstable instance at its 10% baseline is not low-activity', () => {
    expect(judge(quiet({ cpu: hourly(() => 10) }))).toEqual({ kind: 'not_low_activity', reason: 'cpu_peak' });
  });
});

describe('network (NetworkIn + NetworkOut < 5,000,000 bytes a day)', () => {
  it('a day of exactly 5,000,000 bytes -> not low-activity (network); decimal MB, not MiB', () => {
    // 24 h x 208,334 bytes in = 5,000,016 on day 3 only.
    const networkIn = hourly((h) => (Math.floor(h / 24) === 3 ? 208_334 : 100_000));
    expect(judge(quiet({ networkIn, networkOut: hourly(() => 0) }))).toEqual({ kind: 'not_low_activity', reason: 'network' });
  });

  it('4,999,999 bytes on the busiest day is still low', () => {
    const networkIn = hourly((h) => (h === 0 ? 4_999_999 : 0));
    expect(judge(quiet({ networkIn, networkOut: hourly(() => 0) })).kind).toBe('quiet');
  });

  it('NetworkIn quiet but NetworkOut busy on one day -> not low-activity (both are summed)', () => {
    const networkOut = hourly((h) => (Math.floor(h / 24) === 17 ? 250_000 : 100_000));
    expect(judge(quiet({ networkIn: hourly(() => 0), networkOut }))).toEqual({ kind: 'not_low_activity', reason: 'network' });
  });

  it('In and Out each under 5 MB but together over it -> not low-activity', () => {
    expect(judge(quiet({ networkIn: hourly(() => 110_000), networkOut: hourly(() => 110_000) }))).toEqual({ kind: 'not_low_activity', reason: 'network' });
  });

  it("the founder's shape (quietest day ~21.6 MB) is never low-activity", () => {
    expect(judge(quiet({ networkIn: hourly(() => 450_000), networkOut: hourly(() => 450_000) }))).toEqual({ kind: 'not_low_activity', reason: 'network' });
  });
});

describe('completeness (FP2b-Q1)', () => {
  it.each(['cpu', 'networkIn', 'networkOut'] as const)('23 of 24 hours of %s on one day -> couldn\'t check', (metric) => {
    const readings = quiet({ [metric]: hourly((h) => (h === 24 * 12 + 5 ? null : metric === 'cpu' ? 2 : 100_000)) });
    expect(judge(readings)).toEqual({ kind: 'couldnt_check', reason: 'cloudwatch_incomplete' });
  });

  it('a whole day missing -> couldn\'t check', () => {
    expect(judge(quiet({ cpu: hourly((h) => (Math.floor(h / 24) === 29 ? null : 2)) }))).toEqual({ kind: 'couldnt_check', reason: 'cloudwatch_incomplete' });
  });

  it.each([
    ['empty', 'cloudwatch_incomplete'],
    ['query_failed', 'cloudwatch_failed'],
    ['throttled', 'cloudwatch_failed'],
    ['access_denied', 'cloudwatch_failed'],
  ] as const)('a %s query (even with a full series) -> couldn\'t check (%s)', (outcome, reason) => {
    expect(judge(quiet({ networkOut: hourly(() => 100_000, outcome) }))).toEqual({ kind: 'couldnt_check', reason });
  });

  it('no datapoints at all is never read as 0 -> couldn\'t check', () => {
    expect(judge(quiet({ cpu: { outcome: 'empty', series: null } }))).toEqual({ kind: 'couldnt_check', reason: 'cloudwatch_incomplete' });
  });

  it.each([
    ['launched one second after the window start', new Date(WINDOW.start.getTime() + 1000)],
    ['no launch time', undefined],
    ['an invalid launch time', new Date('not a date')],
  ])('%s -> couldn\'t check (too_new_or_restarted)', (_label, launch) => {
    expect(judgeLowActivityMetrics(quiet(), launch as Date | undefined, WINDOW)).toEqual({ kind: 'couldnt_check', reason: 'too_new_or_restarted' });
  });

  it('non-finite or negative values are not datapoints', () => {
    expect(judge(quiet({ cpu: hourly((h) => (h === 7 ? Number.NaN : 2)) }))).toEqual({ kind: 'couldnt_check', reason: 'cloudwatch_incomplete' });
    expect(judge(quiet({ networkIn: hourly((h) => (h === 7 ? -1 : 100_000)) }))).toEqual({ kind: 'couldnt_check', reason: 'cloudwatch_incomplete' });
  });
});

describe('activity wins (FP2b-Q3)', () => {
  it('an incomplete day with one hour at 15% -> not low-activity, not couldn\'t check', () => {
    const cpu = hourly((h) => (Math.floor(h / 24) === 4 ? (h % 24 === 3 ? 15 : null) : 2));
    expect(judge(quiet({ cpu }))).toEqual({ kind: 'not_low_activity', reason: 'cpu_peak' });
  });

  it('a partial network day already over 5 MB -> not low-activity', () => {
    const networkIn = hourly((h) => (h < 3 ? 2_000_000 : null), 'query_failed');
    expect(judge(quiet({ networkIn }))).toEqual({ kind: 'not_low_activity', reason: 'network' });
  });

  it('an instance launched inside the window but already busy -> not low-activity', () => {
    const cpu = hourly((h) => (h >= 600 ? 40 : null));
    expect(judgeLowActivityMetrics(quiet({ cpu }), new Date(WINDOW.start.getTime() + 600 * HOUR), WINDOW)).toEqual({ kind: 'not_low_activity', reason: 'cpu_peak' });
  });

  it('activity found in a failed query still counts', () => {
    expect(judge(quiet({ cpu: hourly((h) => (h === 2 ? 30 : null), 'throttled') }))).toEqual({ kind: 'not_low_activity', reason: 'cpu_peak' });
  });

  it('a partial quiet day is not "activity": it stays couldn\'t check', () => {
    // 3 x 500,000 in + 2,400,000 out = 3.9 MB: a lower bound under the threshold proves nothing.
    const networkIn = hourly((h) => (h < 3 ? 500_000 : null), 'query_failed');
    expect(judge(quiet({ networkIn }))).toEqual({ kind: 'couldnt_check', reason: 'cloudwatch_failed' });
  });
});

describe('topology (D3, FP2b-Q9)', () => {
  const facts = { instanceId: 'i-1234567890abcdef0', ipAddresses: ['10.0.1.15', '10.0.1.16'], autoScalingTag: false };
  const clear: TopologyReads = {
    elbv2: { ok: true, instanceIds: new Set(), ipAddresses: new Set(), targetGroupsRead: 3 },
    classic: { ok: true, instanceIds: new Set(), loadBalancersRead: 1 },
    autoScaling: { ok: true, memberIds: new Set() },
  };

  it('no membership in any complete read -> clear, with what was read', () => {
    expect(judgeLowActivityTopology(facts, clear)).toEqual({
      kind: 'clear',
      evidence: { elbv2_target_groups: 'not_registered', target_groups_read: 3, classic_load_balancers: 'not_registered', classic_load_balancers_read: 1, auto_scaling: 'not_member' },
    });
  });

  it.each([
    ['an instance target', { ...clear, elbv2: { ok: true, instanceIds: new Set([facts.instanceId]), ipAddresses: new Set(), targetGroupsRead: 1 } }, 'load_balancer'],
    ['an IP target on a secondary private IP', { ...clear, elbv2: { ok: true, instanceIds: new Set(), ipAddresses: new Set(['10.0.1.16']), targetGroupsRead: 1 } }, 'load_balancer'],
    ['a Classic Load Balancer', { ...clear, classic: { ok: true, instanceIds: new Set([facts.instanceId]), loadBalancersRead: 1 } }, 'load_balancer'],
    ['an Auto Scaling group (API)', { ...clear, autoScaling: { ok: true, memberIds: new Set([facts.instanceId]) } }, 'auto_scaling'],
  ] as const)('registered through %s -> not low-activity', (_label, reads, reason) => {
    expect(judgeLowActivityTopology(facts, reads as TopologyReads)).toEqual({ kind: 'not_low_activity', reason });
  });

  it('the aws:autoscaling:groupName tag alone excludes', () => {
    expect(judgeLowActivityTopology({ ...facts, autoScalingTag: true }, clear)).toEqual({ kind: 'not_low_activity', reason: 'auto_scaling' });
  });

  it.each(['elbv2', 'classic', 'autoScaling'] as const)('a failed %s read -> couldn\'t check, never "not registered"', (source) => {
    expect(judgeLowActivityTopology(facts, { ...clear, [source]: { ok: false } })).toEqual({ kind: 'couldnt_check', reason: 'topology_unreadable' });
  });

  it('an exclusion found by a read that worked wins over another read that failed', () => {
    const reads: TopologyReads = { ...clear, elbv2: { ok: false }, autoScaling: { ok: true, memberIds: new Set([facts.instanceId]) } };
    expect(judgeLowActivityTopology(facts, reads)).toEqual({ kind: 'not_low_activity', reason: 'auto_scaling' });
    expect(judgeLowActivityTopology({ ...facts, autoScalingTag: true }, { ...clear, classic: { ok: false } })).toEqual({ kind: 'not_low_activity', reason: 'auto_scaling' });
  });
});

describe('stored evidence and copy', () => {
  it('stores the rule identity, the full rule object and daily evidence only (FP2b-Q15, Q16)', () => {
    const verdict = judge(quiet());
    if (verdict.kind !== 'quiet') throw new Error('expected quiet');
    const metadata = lowActivityFindingMetadata({
      window: WINDOW, evaluatedAt: NOW, launchTime: LAUNCHED, days: verdict.days, worst: verdict.worst,
      topology: { elbv2_target_groups: 'not_registered', target_groups_read: 0, classic_load_balancers: 'not_registered', classic_load_balancers_read: 0, auto_scaling: 'not_member' },
    });
    expect(metadata.rule_version).toBe(2);
    expect(metadata.rule).toEqual(JSON.parse(JSON.stringify(LOW_ACTIVITY_RULE)));
    expect(hasLowActivityRuleIdentity(metadata)).toBe(true);
    const la = metadata.low_activity as Record<string, any>;
    expect(la.evaluated_at).toBe(NOW.toISOString());
    expect(la.window_start).toBe(WINDOW.start.toISOString());
    expect(la.window_end).toBe(WINDOW.end.toISOString());
    expect(la.completeness).toBe('complete');
    expect(la.days).toHaveLength(30);
    // 30 days x (CPU peak, NetworkIn, NetworkOut): no hourly series anywhere.
    for (const day of la.days) expect(Object.keys(day).sort()).toEqual(['cpu_peak_percent', 'date', 'network_in_bytes', 'network_out_bytes']);
    expect(JSON.stringify(metadata).length).toBeLessThan(8000);
  });

  it('rounds {peak} DOWN to one decimal: a qualifying peak never reads 10.0%', () => {
    expect(formatPeakPercent(9.95)).toBe('9.9');
    expect(formatPeakPercent(9.97)).toBe('9.9');
    expect(formatPeakPercent(9.99)).toBe('9.9');
    expect(formatPeakPercent(4.26)).toBe('4.2');
    expect(formatPeakPercent(2.04)).toBe('2.0');
    expect(formatPeakPercent(2.3)).toBe('2.3');
    expect(formatPeakPercent(3)).toBe('3.0');
    expect(formatPeakPercent(0)).toBe('0.0');
  });

  it('rounds {maxDailyMb} up to one decimal, at least 0.1, always strictly above the total', () => {
    expect(formatMaxDailyMb(0)).toBe('0.1');
    expect(formatMaxDailyMb(3_210_000)).toBe('3.3');
    expect(formatMaxDailyMb(3_200_000)).toBe('3.3');
    expect(formatMaxDailyMb(4_999_999)).toBe('5.0');
    expect(formatMaxDailyMb(50_000)).toBe('0.1');
  });

  it('the description is W2b, word for word', () => {
    expect(lowActivityDescription({ cpu_peak_percent: 4.26, cpu_peak_date: '2026-10-09', network_bytes_max: 3_210_000, network_max_date: '2026-10-10' })).toBe(
      "Over the past 30 days this instance's CPU peaked at 4.2%, its network traffic stayed under 3.3 MB a day, and it isn't registered with a load balancer or part of an Auto Scaling group. It may no longer be needed. Check with its owner before stopping it: low activity doesn't prove nothing depends on it."
    );
  });
});
