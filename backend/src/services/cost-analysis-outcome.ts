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
import type { LowActivityCheckCounts } from './low-activity-evaluation';
import type { RdsIdleCheckCounts } from './rds-idle-evaluation';
import type { OldSnapshotCheckCounts } from './ebs-old-snapshot-evaluation';
import { AwsCallTimeoutError, isAccessDeniedError, isThrottlingError } from '../utils/awsCallPolicy';
import type { NatIdleCheckCounts } from './nat-gateway-idle-evaluation';

export type CheckOutcome = 'complete' | 'failed';

/**
 * Why a check couldn't run (scan result banner, founder ruling 3): a class,
 * never error text. permissions: AWS said "not allowed". rate_limited: AWS said
 * "slow down" and the retries ran out. timeout: a call or the scan's deadline
 * ran out. too_many_resources: a listing stopped at its page cap. error:
 * anything else, including DevControl's own failures.
 */
export type CheckFailureReason = 'permissions' | 'rate_limited' | 'timeout' | 'too_many_resources' | 'error';

export const CHECK_FAILURE_REASONS: readonly CheckFailureReason[] = ['permissions', 'rate_limited', 'timeout', 'too_many_resources', 'error'];

// ScanDeadlineError (region-run.ts): the whole scan's deadline ran out, a timeout by ruling 3 (review N-4).
const TIMEOUT_ERROR_NAMES = new Set(['TimeoutError', 'AbortError', 'RequestTimeout', 'RequestTimeoutException', 'ScanDeadlineError']);

/** The class of a detector's caught error. Reads the error's name/code/status only, never its message. */
export function classifyCheckFailure(error: unknown): CheckFailureReason {
  if (error instanceof AwsCallTimeoutError) return 'timeout';
  const name = (error as { name?: unknown } | null)?.name;
  if (typeof name === 'string' && TIMEOUT_ERROR_NAMES.has(name)) return 'timeout';
  if (isThrottlingError(error)) return 'rate_limited';
  if (isAccessDeniedError(error)) return 'permissions';
  return 'error';
}
export type CostAnalysisTerminalState = 'completed' | 'partial' | 'failed';

/** One detector's result. Stored as JSON: never error text, ARNs or resource IDs. */
export interface CostAnalysisCheck {
  rule_id: string | null;
  issue: string;
  outcome: CheckOutcome;
  detected: number;
  unknown: number;
  /** A failed check only: why it couldn't run. Absent on runs recorded before it existed. */
  failure_reason?: CheckFailureReason;
  /**
   * The low-activity EC2 check only (FP2b-Q21): how many instances it
   * evaluated, found low-activity, found active (by reason) and couldn't check
   * (by reason). Counts only.
   */
  low_activity?: LowActivityCheckCounts;
  /**
   * The idle RDS check only (C1, Stage A §6): evaluated, flagged, not flagged
   * by reason, couldn't check by reason, excluded by reason. Counts only.
   */
  rds_idle?: RdsIdleCheckCounts;
  /** The old EBS snapshot check only (C1), in the same shape. Counts only. */
  old_snapshots?: OldSnapshotCheckCounts;
  /** The idle NAT gateway check only (C2, Stage A §5.2), in the same shape. Counts only. */
  nat_idle?: NatIdleCheckCounts;
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
  riRecommendations: CreateRecommendationRequest[],
  riFailureReason?: CheckFailureReason
): DetectorSummary {
  const checks: CostAnalysisCheck[] = observations
    .filter((observation) => observation.issue !== ISSUE_RDS_OVERSIZED_INSTANCE)
    .map((observation) => ({
      rule_id: ruleIdForIssue(observation.issue),
      issue: observation.issue,
      outcome: observation.success ? 'complete' : 'failed',
      detected: observation.success ? observation.recommendations.length : 0,
      unknown: observation.unknownResourceIds?.length ?? 0,
      ...(observation.success ? {} : { failure_reason: observation.failureReason ?? 'error' }),
      ...(observation.success && observation.lowActivity ? { low_activity: observation.lowActivity } : {}),
      ...(observation.success && observation.rdsIdle ? { rds_idle: observation.rdsIdle } : {}),
      ...(observation.success && observation.oldSnapshots ? { old_snapshots: observation.oldSnapshots } : {}),
      ...(observation.success && observation.natIdle ? { nat_idle: observation.natIdle } : {}),
    }));
  checks.push({
    rule_id: ruleIdForIssue(ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY),
    issue: ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY,
    outcome: riSucceeded ? 'complete' : 'failed',
    detected: riSucceeded ? riRecommendations.length : 0,
    unknown: 0,
    ...(riSucceeded ? {} : { failure_reason: riFailureReason ?? 'error' }),
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
