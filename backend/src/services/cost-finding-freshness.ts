/**
 * Whether a finding hidden by a Resolved or Dismissed decision is still
 * detected, judged by its own resource's latest observation. Pure: no
 * database, no AWS.
 *
 * Still detected needs all of:
 *  - a cost analysis run that took the scan lease (the latest one, by when it
 *    took it: only a lease holder can reconcile, and the lease orders them),
 *  - that run completed, or was partial,
 *  - its check for this finding's issue completed,
 *  - that run observed this resource and detected it,
 *  - and observed it after the finding's latest decision.
 *
 * Anything else is "not confirmed", never "still detected" and never
 * cleared: a finding a completed check no longer finds has its occurrence
 * ended by reconciliation and is not hidden any more. Historical
 * cost_recommendations rows never prove detection. Other resources' results
 * in the same check (for example another bucket that could not be
 * evaluated) do not affect this finding.
 *
 * Low-activity EC2 (FP2b-Q14): an "Idle Instance" detection only confirms the
 * finding when its evidence carries the low-activity rule's identity. A
 * detection made by the earlier CPU-only check reads "not checked since", so
 * it is never "still detected" and Reopen never copies it into a new finding.
 */
import type { CostAnalysisCheck } from './cost-analysis-outcome';
import type { CostAnalysisRunStatus } from '../repositories/cost-analysis-runs.repository';
import { ISSUE_EC2_IDLE_INSTANCE } from '../config/optimization-rules';
import { hasLowActivityRuleIdentity } from '../config/low-activity-rule';

export type DetectionState = 'still_detected' | 'not_confirmed';

export type NotConfirmedReason =
  /** No analysis has observed this resource since the decision. */
  | 'not_checked_since'
  /** The latest analysis's check for this issue did not complete. */
  | 'check_failed'
  /** The latest analysis's check completed but could not evaluate this resource. */
  | 'not_fully_checked'
  /** The latest analysis did not finish (running, interrupted, failed) or recorded no checks. */
  | 'analysis_incomplete';

/** The anchor: the organization's latest run that took the scan lease. */
export interface FreshnessRun {
  id: string;
  run_state: CostAnalysisRunStatus;
  checks: CostAnalysisCheck[] | null;
}

/** This finding's latest observation (cost_finding_detections). */
export interface FreshnessObservation {
  run_id: string | null;
  outcome: 'detected' | 'unknown';
  observed_at: Date | string;
  /** The latest detection's evidence (cost_finding_detections.metadata). */
  metadata?: unknown;
}

export interface FreshnessInput {
  issue: string;
  /** When the finding's latest Resolved or Dismissed decision was made (its updated_at). */
  decidedAt: Date | string;
  observation: FreshnessObservation | null;
  latestRun: FreshnessRun | null;
}

export interface Freshness {
  state: DetectionState;
  reason: NotConfirmedReason | null;
}

const CONFIRMING_RUN_STATES: ReadonlySet<CostAnalysisRunStatus> = new Set(['completed', 'partial']);

const time = (value: Date | string): number => (value instanceof Date ? value : new Date(value)).getTime();

const notConfirmed = (reason: NotConfirmedReason): Freshness => ({ state: 'not_confirmed', reason });

export function judgeFreshness({ issue, decidedAt, observation, latestRun }: FreshnessInput): Freshness {
  if (!latestRun) return notConfirmed('not_checked_since');
  if (!CONFIRMING_RUN_STATES.has(latestRun.run_state)) return notConfirmed('analysis_incomplete');

  const check = latestRun.checks?.find((entry) => entry.issue === issue);
  if (!check) return notConfirmed('analysis_incomplete');
  if (check.outcome !== 'complete') return notConfirmed('check_failed');

  // This finding's own resource, in this run, after the decision.
  if (!observation || observation.run_id === null || observation.run_id !== latestRun.id) {
    return notConfirmed('not_checked_since');
  }
  if (time(observation.observed_at) <= time(decidedAt)) return notConfirmed('not_checked_since');
  if (observation.outcome !== 'detected') return notConfirmed('not_fully_checked');
  if (issue === ISSUE_EC2_IDLE_INSTANCE && !hasLowActivityRuleIdentity(observation.metadata)) {
    return notConfirmed('not_checked_since');
  }

  return { state: 'still_detected', reason: null };
}
