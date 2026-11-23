import { addReconcileCounts, EMPTY_RECONCILE_COUNTS, summarizeDetectors } from '../cost-analysis-outcome';
import { getOptimizationRules, ISSUE_EBS_OLD_SNAPSHOT, ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY, ISSUE_RDS_IDLE_INSTANCE, ISSUE_RDS_OVERSIZED_INSTANCE } from '../../config/optimization-rules';
import { emptyRdsIdleCounts } from '../rds-idle-evaluation';
import { emptyOldSnapshotCounts } from '../ebs-old-snapshot-evaluation';
import type { DetectorObservation } from '../cost-optimization.service';
import type { CreateRecommendationRequest } from '../../types';

const finding = { resource_id: 'i-1234567890abcdef0', resource_type: 'EC2', potential_savings: 1, severity: 'LOW' } as CreateRecommendationRequest;
const retiredRds: DetectorObservation = { issue: ISSUE_RDS_OVERSIZED_INSTANCE, success: true, recommendations: [] };
const ok = (issue: string, recommendations: CreateRecommendationRequest[] = [], unknownResourceIds?: string[]): DetectorObservation => ({ issue, success: true, recommendations, unknownResourceIds });
const bad = (issue: string): DetectorObservation => ({ issue, success: false, recommendations: [] });

describe('summarizeDetectors', () => {
  it('completed: every detector completed', () => {
    const summary = summarizeDetectors([ok('Idle Instance'), retiredRds], true, []);
    expect(summary.state).toBe('completed');
    expect(summary.failedDetectorCount).toBe(0);
  });

  it('partial: some detectors failed', () => {
    const summary = summarizeDetectors([ok('Idle Instance'), bad('Unused Elastic IP'), retiredRds], true, []);
    expect(summary.state).toBe('partial');
    expect(summary.failedDetectorCount).toBe(1);
  });

  it('failed: every real detector failed, although the retired RDS observation reports success', () => {
    const summary = summarizeDetectors([bad('Idle Instance'), bad('Unused Elastic IP'), retiredRds], false, []);
    expect(summary.state).toBe('failed');
    expect(summary.failedDetectorCount).toBe(3);
  });

  it('failed: nothing reported at all', () => {
    expect(summarizeDetectors([], false, []).state).toBe('failed');
  });

  it('never lists the retired RDS category as a check', () => {
    const { checks } = summarizeDetectors([ok('Idle Instance'), retiredRds], true, []);
    expect(checks.map((c) => c.issue)).toEqual(['Idle Instance', ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY]);
  });

  it('unknown resources are counted and do not make a run partial', () => {
    const summary = summarizeDetectors([ok('Idle Instance', [], ['i-1234567890abcdef0', 'i-0123456789abcdef0'])], true, []);
    expect(summary.state).toBe('completed');
    expect(summary.unknownResourceCount).toBe(2);
  });

  it('a failed detector reports nothing detected', () => {
    const { checks } = summarizeDetectors([bad('Idle Instance')], true, [finding]);
    expect(checks[0]).toMatchObject({ outcome: 'failed', detected: 0 });
    expect(checks[1]).toMatchObject({ outcome: 'complete', detected: 1 });
  });

  it('names each check by its registry rule, and holds nothing but the agreed fields', () => {
    const { checks } = summarizeDetectors([ok('Idle Instance', [finding])], true, []);
    expect(checks[0].rule_id).toBe('ec2_idle');
    expect(Object.keys(checks[0]).sort()).toEqual(['detected', 'issue', 'outcome', 'rule_id', 'unknown']);
    expect(JSON.stringify(checks)).not.toContain(finding.resource_id);
  });

  it('FP PR 2b (FP2b-Q21): the low-activity check adds its counts by reason -- counts only, no resource IDs', () => {
    const lowActivity = {
      evaluated: 4, low_activity: 1,
      not_low_activity: { cpu_peak: 1, network: 0, load_balancer: 1, auto_scaling: 0 },
      couldnt_check: { too_new_or_restarted: 1, cloudwatch_failed: 0, cloudwatch_incomplete: 0, topology_unreadable: 0 },
    };
    const { checks } = summarizeDetectors([{ ...ok('Idle Instance', [finding], ['i-0123456789abcdef0']), lowActivity }], true, []);
    expect(checks[0]).toEqual({ rule_id: 'ec2_idle', issue: 'Idle Instance', outcome: 'complete', detected: 1, unknown: 1, low_activity: lowActivity });
    expect(JSON.stringify(checks)).not.toContain('i-0123456789abcdef0');
    expect(JSON.stringify(checks)).not.toContain(finding.resource_id);
  });

  it('a failed low-activity check records no counts (they would describe no complete answer)', () => {
    const lowActivity = { evaluated: 0, low_activity: 0, not_low_activity: { cpu_peak: 0, network: 0, load_balancer: 0, auto_scaling: 0 }, couldnt_check: { too_new_or_restarted: 0, cloudwatch_failed: 0, cloudwatch_incomplete: 0, topology_unreadable: 0 } };
    const { checks } = summarizeDetectors([{ ...bad('Idle Instance'), lowActivity }], true, []);
    expect(checks[0]).not.toHaveProperty('low_activity');
  });

  it('C1 review S-1: the idle RDS and old snapshot checks add their counts by reason -- counts only, no resource IDs', () => {
    const rdsIdle = emptyRdsIdleCounts();
    Object.assign(rdsIdle, { evaluated: 3, flagged: 1 });
    rdsIdle.couldnt_check.cloudwatch_failed = 1;
    rdsIdle.excluded.aurora = 1;
    const oldSnapshots = emptyOldSnapshotCounts();
    Object.assign(oldSnapshots, { evaluated: 4, flagged: 1 });
    oldSnapshots.not_flagged.too_recent = 1;
    oldSnapshots.excluded.locked = 1;
    oldSnapshots.excluded.ami = 1;
    const { checks } = summarizeDetectors([
      { ...ok(ISSUE_RDS_IDLE_INSTANCE, [], ['placeholder-db-1']), rdsIdle },
      { ...ok(ISSUE_EBS_OLD_SNAPSHOT, [], []), oldSnapshots },
    ], true, []);
    expect(checks[0]).toEqual({ rule_id: 'rds_idle', issue: ISSUE_RDS_IDLE_INSTANCE, outcome: 'complete', detected: 0, unknown: 1, rds_idle: rdsIdle });
    expect(checks[1]).toEqual({ rule_id: 'ebs_old_snapshots', issue: ISSUE_EBS_OLD_SNAPSHOT, outcome: 'complete', detected: 0, unknown: 0, old_snapshots: oldSnapshots });
    expect(JSON.stringify(checks)).not.toContain('placeholder-db-1');
    // Every reason Stage A §6 names is a key, even at zero.
    expect(Object.keys(rdsIdle.excluded).sort()).toEqual(['aurora', 'db_cluster_member', 'rds_custom', 'read_replica', 'read_replica_source', 'stopped']);
    expect(Object.keys(oldSnapshots.excluded).sort()).toEqual(['ami', 'aws_backup', 'dlm', 'locked']);
  });

  it('a failed idle RDS or old snapshot check records no counts', () => {
    const { checks } = summarizeDetectors([
      { ...bad(ISSUE_RDS_IDLE_INSTANCE), rdsIdle: emptyRdsIdleCounts() },
      { ...bad(ISSUE_EBS_OLD_SNAPSHOT), oldSnapshots: emptyOldSnapshotCounts() },
    ], true, []);
    expect(checks[0]).not.toHaveProperty('rds_idle');
    expect(checks[1]).not.toHaveProperty('old_snapshots');
  });

  it('every implemented rule can be named by a check', () => {
    const implemented = getOptimizationRules().filter((rule) => rule.status === 'implemented');
    expect(implemented).toHaveLength(11);
    for (const rule of implemented) expect(rule.issue).toEqual(expect.any(String));
  });
});

describe('addReconcileCounts', () => {
  it('adds every field', () => {
    const one = { detected: 1, new: 1, refreshed: 1, suppressedResolved: 1, suppressedDismissed: 1, duplicate: 1, persisted: 1 };
    expect(addReconcileCounts(one, one)).toEqual({ detected: 2, new: 2, refreshed: 2, suppressedResolved: 2, suppressedDismissed: 2, duplicate: 2, persisted: 2 });
    expect(addReconcileCounts(one, EMPTY_RECONCILE_COUNTS)).toEqual(one);
  });
});
