/**
 * What one cost analysis found, from what its detectors reported: per-detector
 * outcomes, the run's state, and the counts recorded on cost_analysis_runs.
 * Pure: no database, no AWS.
 *
 * The retired oversized-RDS category is not a detector: it always reports a
 * successful, empty observation so reconciliation retires its old rows, and
 * counting it would make "every detector failed" impossible to see.
 */
import { getOptimizationRules, ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY, ISSUE_RDS_OVERSIZED_INSTANCE } from '../config/optimization-rules';
import type { CreateRecommendationRequest } from '../types';
import type { DetectorObservation } from './cost-optimization.service';

export type CheckOutcome = 'complete' | 'failed';
export type CostAnalysisTerminalState = 'completed' | 'partial' | 'failed';

/** One detector's result. Stored as JSON: never error text, ARNs or resource IDs. */
export interface CostAnalysisCheck {
  rule_id: string | null;
  issue: string;
  outcome: CheckOutcome;
  detected: number;
  unknown: number;
}

/** How one reconciliation's findings ended. Reserved Instances use new, refreshed and duplicate only. */
export interface ReconcileCounts {
  detected: number;
  new: number;
  refreshed: number;
  suppressedResolved: number;
  suppressedDismissed: number;
  duplicate: number;
  persisted: number;
}

export const EMPTY_RECONCILE_COUNTS: Readonly<ReconcileCounts> = Object.freeze({
  detected: 0,
  new: 0,
  refreshed: 0,
  suppressedResolved: 0,
  suppressedDismissed: 0,
  duplicate: 0,
  persisted: 0,
});

export function addReconcileCounts(a: ReconcileCounts, b: ReconcileCounts): ReconcileCounts {
  return {
    detected: a.detected + b.detected,
    new: a.new + b.new,
    refreshed: a.refreshed + b.refreshed,
    suppressedResolved: a.suppressedResolved + b.suppressedResolved,
    suppressedDismissed: a.suppressedDismissed + b.suppressedDismissed,
    duplicate: a.duplicate + b.duplicate,
    persisted: a.persisted + b.persisted,
  };
}

/** The run's detector summary, independent of what was saved. */
export interface DetectorSummary {
  state: CostAnalysisTerminalState;
  checks: CostAnalysisCheck[];
  failedDetectorCount: number;
  unknownResourceCount: number;
}

function ruleIdForIssue(issue: string): string | null {
  return getOptimizationRules().find((rule) => rule.issue === issue)?.id ?? null;
}

/**
 * completed: every detector completed. partial: some completed, some failed.
 * failed: none completed, or none reported at all. Unknown resources are
 * counted and do not change the state.
 */
export function summarizeDetectors(
  observations: DetectorObservation[],
  riSucceeded: boolean,
  riRecommendations: CreateRecommendationRequest[]
): DetectorSummary {
  const checks: CostAnalysisCheck[] = observations
    .filter((observation) => observation.issue !== ISSUE_RDS_OVERSIZED_INSTANCE)
    .map((observation) => ({
      rule_id: ruleIdForIssue(observation.issue),
      issue: observation.issue,
      outcome: observation.success ? 'complete' : 'failed',
      detected: observation.success ? observation.recommendations.length : 0,
      unknown: observation.unknownResourceIds?.length ?? 0,
    }));
  checks.push({
    rule_id: ruleIdForIssue(ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY),
    issue: ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY,
    outcome: riSucceeded ? 'complete' : 'failed',
    detected: riSucceeded ? riRecommendations.length : 0,
    unknown: 0,
  });

  const failedDetectorCount = checks.filter((check) => check.outcome === 'failed').length;
  const state: CostAnalysisTerminalState =
    failedDetectorCount === 0 ? 'completed' : failedDetectorCount === checks.length ? 'failed' : 'partial';

  return {
    state,
    checks,
    failedDetectorCount,
    unknownResourceCount: checks.reduce((sum, check) => sum + check.unknown, 0),
  };
}
