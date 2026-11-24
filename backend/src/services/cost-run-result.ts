/**
 * The facts the Cost Optimization scan result banner shows for ONE manual run
 * (founder-locked behaviour, Nov 23): built from that run's own record, never
 * from live totals or from another run, so a later scheduled run can't change
 * what the banner says. Pure: no database, no AWS.
 */
import {
  OPTIMIZATION_RULE_SERVICES,
  getOptimizationRules,
  serviceDisplayName,
} from '../config/optimization-rules';
import { CHECK_FAILURE_REASONS, type CheckFailureReason, type CostAnalysisCheck } from './cost-analysis-outcome';

export type CostRunResultState = 'running' | 'completed' | 'partial' | 'failed' | 'interrupted';

export interface CostRunResult {
  /** The run row's id; null only when the row couldn't be created (that result is never acknowledged). */
  id: string | null;
  state: CostRunResultState;
  completedAt: string | null;
  checksTotal: number;
  checksRan: number;
  /** Failed checks by reason, largest count first (ties in CHECK_FAILURE_REASONS order). */
  failedChecks: { reason: CheckFailureReason; count: number }[];
  /** Display names of the services whose checks ran, in the registry's service order. */
  services: string[];
  newCount: number | null;
  /** ACTIVE findings right after the run; null when not recorded. */
  openCount: number | null;
  /** Open findings that were already open before this run: openCount - newCount; null when either is unknown. */
  stillOpen: number | null;
  /** A failed or interrupted run's fixed text (never the raw error); null otherwise. */
  message: string | null;
  /** True only for a failure known to happen before anything was written (founder ruling 4). */
  findingsUnchanged: boolean;
}

export interface CostRunResultInput {
  id: string | null;
  state: CostRunResultState;
  completedAt: string | null;
  checks: CostAnalysisCheck[] | null;
  newCount: number | null;
  openCount: number | null;
  message: string | null;
  findingsUnchanged: boolean;
}

/** The services of the checks that ran, by each check's rule, in OPTIMIZATION_RULE_SERVICES order. */
export function servicesOfChecks(checks: readonly CostAnalysisCheck[]): string[] {
  const rules = getOptimizationRules();
  const ran = new Set<string>();
  for (const check of checks) {
    if (check.outcome !== 'complete') continue;
    const rule = rules.find((r) => (check.rule_id ? r.id === check.rule_id : r.issue === check.issue));
    if (rule) ran.add(rule.service);
  }
  return OPTIMIZATION_RULE_SERVICES.filter((service) => ran.has(service)).map(serviceDisplayName);
}

/** Failed checks grouped by reason; a check recorded before reasons existed counts as 'error'. */
export function failedChecksByReason(checks: readonly CostAnalysisCheck[]): { reason: CheckFailureReason; count: number }[] {
  const counts = new Map<CheckFailureReason, number>();
  for (const check of checks) {
    if (check.outcome !== 'failed') continue;
    const reason = check.failure_reason && CHECK_FAILURE_REASONS.includes(check.failure_reason) ? check.failure_reason : 'error';
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  }
  return CHECK_FAILURE_REASONS
    .filter((reason) => counts.has(reason))
    .map((reason) => ({ reason, count: counts.get(reason)! }))
    .sort((a, b) => b.count - a.count); // stable: ties keep CHECK_FAILURE_REASONS order
}

export function buildCostRunResult(input: CostRunResultInput): CostRunResult {
  const checks = Array.isArray(input.checks) ? input.checks : [];
  const newCount = typeof input.newCount === 'number' ? input.newCount : null;
  const openCount = typeof input.openCount === 'number' ? input.openCount : null;
  const failed = input.state === 'failed' || input.state === 'interrupted';
  return {
    id: input.id,
    state: input.state,
    completedAt: input.completedAt,
    checksTotal: checks.length,
    checksRan: checks.filter((check) => check.outcome === 'complete').length,
    failedChecks: failedChecksByReason(checks),
    services: servicesOfChecks(checks),
    newCount,
    openCount,
    stillOpen: newCount !== null && openCount !== null ? Math.max(0, openCount - newCount) : null,
    message: failed ? input.message : null,
    findingsUnchanged: input.state === 'failed' && input.findingsUnchanged,
  };
}
