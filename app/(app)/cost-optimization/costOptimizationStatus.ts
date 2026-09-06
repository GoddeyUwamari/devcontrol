import type { DiscoveryJob } from '@/lib/services/aws-resources.service'
import type { CostAnalysisRun } from '@/lib/services/cost-recommendations.service'

/**
 * Pure, extracted-for-testability derivation of the Cost Optimization page's
 * Analysis Status, mirroring the pattern in
 * app/(app)/dashboard/dashboardAwsGates.ts.
 *
 * Grounded entirely in data three already-shipped/newly-added endpoints provide:
 *   - GET /api/aws/accounts                     -> is AWS connected at all
 *   - GET /api/aws-resources/discovery/jobs     -> scheduled discovery+cost-analysis (6-hourly cron)
 *   - GET /api/cost-recommendations/analysis-runs -> manual "Run cost analysis" runs
 *   - GET /api/cost-recommendations/stats       -> active vs. total-ever counts
 *
 * IMPORTANT ARCHITECTURE NOTE: scheduled discovery and manual cost analysis
 * are genuinely different operations (see
 * database/migrations/202609060900_create_cost_analysis_runs.sql) --
 * pickLatestAnalysis() below merges their two independent histories into one
 * "most recent analysis, whichever kind" view without claiming a manual run
 * ever performed resource discovery, or vice versa. NormalizedAnalysis.source
 * is what the UI uses to say "Manual cost analysis" vs "Scheduled analysis"
 * truthfully.
 *
 * 'in_progress' is not one of the 5 product-approved states (A-E) but is a
 * real, schema-backed value for both sources (resource_discovery_jobs.status
 * and cost_analysis_runs.status both support 'running') -- disclosed as an
 * addition in the implementation report, not fabricated.
 */
export type AnalysisStatusKey =
  | 'not_connected'
  | 'never_analyzed'
  | 'in_progress'
  | 'failed'
  | 'completed_with_opportunities'
  | 'completed_clean'
  | 'completed_all_resolved'

export type AnalysisSource = 'scheduled' | 'manual'

export interface NormalizedAnalysis {
  source: AnalysisSource
  status: 'running' | 'completed' | 'failed'
  completedAt: string | null
  errorMessage: string | null
}

/**
 * Merges the scheduled discovery cron's latest job with the manual
 * cost-analysis endpoint's latest run, picking whichever is more recent by
 * created_at. Each source already returns its own latest-first (ORDER BY
 * created_at DESC LIMIT N), so only the two [0] entries need comparing.
 *
 * A discovery job whose own status is 'completed' but whose
 * cost_analysis_completed is false means cost analysis specifically did not
 * finish in that cycle even though the job's overall status looks fine
 * (a rare/legacy edge case -- see the column's own migration comment) --
 * normalized to 'failed' here so the UI never claims a successful cost
 * analysis that didn't actually happen.
 */
export function pickLatestAnalysis(params: {
  latestDiscoveryJob?: Pick<DiscoveryJob, 'status' | 'cost_analysis_completed' | 'completed_at' | 'error_message' | 'created_at'>
  latestAnalysisRun?: Pick<CostAnalysisRun, 'status' | 'completed_at' | 'error_message' | 'created_at'>
}): NormalizedAnalysis | undefined {
  const { latestDiscoveryJob: j, latestAnalysisRun: r } = params

  const scheduled: NormalizedAnalysis | undefined = j
    ? {
        source: 'scheduled',
        status:
          j.status === 'pending' ? 'running'
          : j.status === 'completed' && !j.cost_analysis_completed ? 'failed'
          : j.status,
        completedAt: j.completed_at,
        errorMessage: j.error_message,
      }
    : undefined

  const manual: NormalizedAnalysis | undefined = r
    ? { source: 'manual', status: r.status, completedAt: r.completed_at, errorMessage: r.error_message }
    : undefined

  if (scheduled && manual && j && r) {
    return new Date(r.created_at).getTime() >= new Date(j.created_at).getTime() ? manual : scheduled
  }
  return manual ?? scheduled
}

export interface AnalysisStatusInput {
  /** undefined while the AWS-accounts check is still loading */
  awsConnected: boolean | undefined
  /** result of pickLatestAnalysis() above */
  latestAnalysis: NormalizedAnalysis | undefined
  /** cost_recommendations.stats.activeRecommendations */
  activeCount: number
  /** cost_recommendations.stats.totalRecommendations (all statuses, ever) */
  totalEverCount: number
}

export function deriveAnalysisStatus(input: AnalysisStatusInput): AnalysisStatusKey | 'loading' {
  const { awsConnected, latestAnalysis, activeCount, totalEverCount } = input

  if (awsConnected === undefined) return 'loading'
  if (!awsConnected) return 'not_connected'
  if (!latestAnalysis) return 'never_analyzed'
  if (latestAnalysis.status === 'running') return 'in_progress'
  if (latestAnalysis.status === 'failed') return 'failed'

  // status === 'completed'
  if (activeCount > 0) return 'completed_with_opportunities'
  if (totalEverCount > 0) return 'completed_all_resolved'
  return 'completed_clean'
}
