import type { DiscoveryJob } from '@/lib/services/aws-resources.service'
import type { CostAnalysisRun } from '@/lib/services/cost-recommendations.service'
import type { AnalysisSource } from './costOptimizationStatus'

/**
 * The Cost Optimization page's scan state (pr2-step1.md §1, founder-approved
 * 2026-11-02). The scan status comes only from cost analysis runs, manual and
 * scheduled (GET /analysis-runs?source=all). A discovery job is read only when
 * the organization has no run row at all, and then only its
 * cost_analysis_completed flag: never its status or its error text.
 */
export type CostScanStateKey =
  | 'loading'
  | 'status_unavailable'
  | 'not_connected'
  | 'never_analyzed'
  | 'running'
  | 'completed_new'
  | 'completed_open'
  | 'completed_hidden'
  | 'completed_unchecked'
  | 'completed_clean'
  | 'completed_unrecorded'
  | 'completed_other'
  | 'partial'
  | 'failed'
  | 'interrupted'

/** Counts from the latest run only: never carried over from an earlier run or read from stats. */
export interface CostScanCounts {
  new: number
  refreshed: number
  persisted: number
  detected: number
  hidden: number
  unknown: number
  checksTotal: number
  allChecksComplete: boolean
}

export interface CostScanState {
  key: CostScanStateKey
  source: AnalysisSource | null
  completedAt: string | null
  /** A failed run's message, only when it is one of the fixed texts below; otherwise null. */
  errorMessage: string | null
  counts: CostScanCounts | null
}

/** What a react-query result tells this derivation. */
export interface QueryView<T> {
  data: T | undefined
  isError: boolean
}

export interface CostScanInput {
  accounts: QueryView<readonly unknown[]>
  runs: QueryView<readonly CostAnalysisRun[]>
  jobs: QueryView<readonly Pick<DiscoveryJob, 'status' | 'cost_analysis_completed' | 'completed_at'>[]>
  isAnalyzing: boolean
}

/**
 * The only failure texts the page shows from a run: the backend's fixed
 * messages (cost-recommendations.controller.ts, platform-sts.ts), matched
 * exactly. Anything else falls back to fixed page text.
 */
export const SAFE_RUN_MESSAGES: readonly string[] = [
  "The analysis ran, but its results couldn't be saved. Try again.",
  'None of the cost checks could complete. Try again.',
  "Some cost checks didn't complete, so these results may be incomplete.",
  'The analysis was interrupted before it finished. Run it again.',
  'The analysis did not complete due to an unexpected error.',
  'DevControl cannot reach AWS right now. This is not a problem with your AWS account or role; please try again shortly.',
  'No AWS account connected for this organization.',
  'AWS Cost Explorer or CloudWatch is not enabled for this account.',
]

export function safeRunMessage(message: string | null | undefined): string | null {
  return typeof message === 'string' && SAFE_RUN_MESSAGES.includes(message) ? message : null
}

function state(key: CostScanStateKey, extra: Partial<CostScanState> = {}): CostScanState {
  return { key, source: null, completedAt: null, errorMessage: null, counts: null, ...extra }
}

const isLoading = <T>(query: QueryView<T>) => !query.isError && query.data === undefined

/** A run's counts, or null when any of them was not recorded. */
export function runCounts(run: CostAnalysisRun): CostScanCounts | null {
  const values = [
    run.new_count,
    run.refreshed_count,
    run.persisted_count,
    run.detected_count,
    run.suppressed_resolved_count,
    run.suppressed_dismissed_count,
    run.unknown_resource_count,
  ]
  if (!values.every((value) => typeof value === 'number')) return null
  if (!Array.isArray(run.checks) || run.checks.length === 0) return null
  return {
    new: run.new_count as number,
    refreshed: run.refreshed_count as number,
    persisted: run.persisted_count as number,
    detected: run.detected_count as number,
    hidden: (run.suppressed_resolved_count as number) + (run.suppressed_dismissed_count as number),
    unknown: run.unknown_resource_count as number,
    checksTotal: run.checks.length,
    allChecksComplete: run.checks.every((check) => check.outcome === 'complete'),
  }
}

function completedKey(counts: CostScanCounts | null): CostScanStateKey {
  if (!counts) return 'completed_unrecorded'
  if (counts.new > 0) return 'completed_new'
  if (counts.refreshed > 0) return 'completed_open'
  if (counts.hidden > 0) return 'completed_hidden'
  if (counts.detected === 0 && counts.unknown > 0) return 'completed_unchecked'
  if (counts.detected === 0 && counts.unknown === 0 && counts.allChecksComplete) return 'completed_clean'
  return 'completed_other'
}

function fromRun(run: CostAnalysisRun): CostScanState {
  const runState = run.run_state ?? run.status
  const source: AnalysisSource = run.source === 'discovery' ? 'scheduled' : 'manual'
  const base = { source, completedAt: run.completed_at }
  switch (runState) {
    case 'running':
      return state('running', { source })
    case 'interrupted':
      return state('interrupted', base)
    case 'failed':
      return state('failed', { ...base, errorMessage: safeRunMessage(run.error_message) })
    case 'partial':
      return state('partial', { ...base, counts: runCounts(run) })
    case 'completed': {
      const counts = runCounts(run)
      return state(completedKey(counts), { ...base, counts })
    }
    default:
      return state('failed', base)
  }
}

/** Only for an organization with no run row at all: its latest finished job's cost flag. */
function fromLegacyJobs(jobs: CostScanInput['jobs']['data']): CostScanState {
  const job = jobs?.find((j) => j.status === 'completed' || j.status === 'failed')
  if (!job) return state('never_analyzed')
  const base = { source: 'scheduled' as const, completedAt: job.completed_at }
  return job.cost_analysis_completed ? state('completed_unrecorded', base) : state('failed', base)
}

export function deriveCostScanState(input: CostScanInput): CostScanState {
  const { accounts, runs, jobs, isAnalyzing } = input

  if (accounts.isError) return state('status_unavailable')
  if (isLoading(accounts)) return state('loading')
  if ((accounts.data ?? []).length === 0) return state('not_connected')

  if (isAnalyzing) return state('running', { source: 'manual' })

  if (runs.isError) return state('status_unavailable')
  if (isLoading(runs)) return state('loading')

  const latest = runs.data?.[0]
  if (latest) return fromRun(latest)

  if (jobs.isError) return state('status_unavailable')
  if (isLoading(jobs)) return state('loading')
  return fromLegacyJobs(jobs.data)
}

/** The runs query polls while the latest run is still running (decision 9). */
export const RUNNING_REFETCH_MS = 15_000

export function runsRefetchInterval(runs: readonly CostAnalysisRun[] | undefined): number | false {
  const latest = runs?.[0]
  return latest && (latest.run_state ?? latest.status) === 'running' ? RUNNING_REFETCH_MS : false
}
