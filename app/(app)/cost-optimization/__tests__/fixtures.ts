import type { CostAnalysisCheck, CostAnalysisRun } from '@/lib/services/cost-recommendations.service'
import type { DiscoveryJob } from '@/lib/services/aws-resources.service'

/** Fixture data for the Cost Optimization scan-state tests. Placeholder IDs only. */

export const ISSUES = [
  'Idle Instance',
  'Unused Elastic IP',
  'Unattached Volume',
  'Old Snapshot',
  'S3 Lifecycle',
  'Idle Lambda',
  'DynamoDB Capacity',
  'Underused Load Balancer',
  'Reserved Instance Opportunity',
]

export function checks(failed: number = 0): CostAnalysisCheck[] {
  return ISSUES.map((issue, index) => ({
    rule_id: `rule-${index}`,
    issue,
    outcome: index < failed ? 'failed' : 'complete',
    detected: 0,
    unknown: 0,
  }))
}

/** A completed manual run that found nothing, all checks complete; override what a test needs. */
export function run(overrides: Partial<CostAnalysisRun> = {}): CostAnalysisRun {
  return {
    id: 'run-placeholder',
    status: 'completed',
    run_state: 'completed',
    source: 'manual',
    recommendations_found: 0,
    total_potential_savings: null,
    started_at: '2026-11-02T08:00:00.000Z',
    completed_at: '2026-11-02T08:00:01.000Z',
    created_at: '2026-11-02T08:00:00.000Z',
    error_message: null,
    detected_count: 0,
    new_count: 0,
    refreshed_count: 0,
    suppressed_resolved_count: 0,
    suppressed_dismissed_count: 0,
    duplicate_count: 0,
    persisted_count: 0,
    failed_detector_count: 0,
    unknown_resource_count: 0,
    checks: checks(),
    ...overrides,
  }
}

/** Production today: 2 findings detected, both hidden by earlier decisions, nothing persisted. */
export const PRODUCTION_HIDDEN = run({ detected_count: 2, suppressed_resolved_count: 1, suppressed_dismissed_count: 1 })

/** Production now (pr3-p1-p6-results.txt): 2 detected, both hidden by a RESOLVED latest decision, 0 dismissed. */
export const PRODUCTION_RESOLVED_ONLY = run({ detected_count: 2, suppressed_resolved_count: 2, suppressed_dismissed_count: 0, unknown_resource_count: 1 })

/** A run row from before PR 1: no counts recorded. */
export const LEGACY_RUN = run({
  run_state: undefined,
  source: undefined,
  detected_count: undefined,
  new_count: undefined,
  refreshed_count: undefined,
  suppressed_resolved_count: undefined,
  suppressed_dismissed_count: undefined,
  duplicate_count: undefined,
  persisted_count: undefined,
  failed_detector_count: undefined,
  unknown_resource_count: undefined,
  checks: undefined,
})

export function job(overrides: Partial<DiscoveryJob> = {}): DiscoveryJob {
  return {
    id: 'job-placeholder',
    organization_id: 'org-placeholder',
    status: 'completed',
    resources_discovered: 0,
    resources_updated: 0,
    resources_deleted: 0,
    regions: [],
    resource_types: [],
    error_message: null,
    warnings: [],
    started_at: '2026-11-01T08:00:00.000Z',
    completed_at: '2026-11-01T08:05:00.000Z',
    created_at: '2026-11-01T08:00:00.000Z',
    compliance_scan_completed: true,
    cost_analysis_completed: true,
    ...overrides,
  }
}

export const RAW_JOB_TEXT = 'Cost analysis: AccessDenied: arn:aws:iam::123456789012:role/placeholder-role is not authorized; SELECT * FROM cost_recommendations'
