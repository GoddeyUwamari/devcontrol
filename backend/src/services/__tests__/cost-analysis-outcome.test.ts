import { addReconcileCounts, EMPTY_RECONCILE_COUNTS, summarizeDetectors } from '../cost-analysis-outcome';
import { getOptimizationRules, ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY, ISSUE_RDS_OVERSIZED_INSTANCE } from '../../config/optimization-rules';
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

  it('every implemented rule can be named by a check', () => {
    const implemented = getOptimizationRules().filter((rule) => rule.status === 'implemented');
    expect(implemented).toHaveLength(9);
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
