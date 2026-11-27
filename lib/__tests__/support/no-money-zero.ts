/**
 * "Never show $0" (founder rulings 2026-11-26, review-logs/never-zero/stage-a.md
 * Addendum 1): the shared no-figure fixtures and the money-zero matcher every
 * findings-surface render test uses. A new surface added to the sweep inherits
 * the fixtures. Synthetic data only (placeholder IDs, no real account).
 */
import { expect } from 'vitest'

/**
 * A money zero in rendered text: "$0", "$0.0" or "$0.00" not followed by
 * another digit (so "$0.01", "$0.08" and "<$0.01" pass), or a bare "0/mo".
 * A genuine AWS spend of $0.00 is allowed only on spend surfaces, which use
 * their own assertions.
 */
export const MONEY_ZERO = /(?<![<\d.,])\$0(?:\.0{1,2})?(?![.\d])|(?<![\d.$])0\/mo\b/

/** The first money zero in `text`, with some context, or null. */
export function moneyZeroIn(text: string | null | undefined): string | null {
  const match = MONEY_ZERO.exec(text ?? '')
  if (!match) return null
  const at = match.index
  return (text ?? '').slice(Math.max(0, at - 60), at + 20)
}

export function expectNoMoneyZero(text: string | null | undefined): void {
  expect(moneyZeroIn(text), 'rendered text shows a money zero').toBeNull()
}

const base = (id: string, resourceType: string, issue: string, metadata: Record<string, unknown>) => ({
  id, organizationId: 'org-placeholder', resourceId: id, resourceName: id, resourceType, issue,
  description: 'Placeholder description.', potentialSavings: 0, severity: 'LOW', status: 'ACTIVE', awsRegion: 'us-east-1',
  metadata, createdAt: '2026-11-18T06:00:00.000Z', updatedAt: '2026-11-18T06:00:00.000Z', resolvedAt: null,
})

/** Open findings with no dollar figure, as the frontend mapper delivers them (stored 0.00 -> 0). */
export const NO_FIGURE_RECS = [
  base('db-placeholder-1', 'RDS', 'Idle RDS Instance', { rule_version: 2 }),
  base('log-group-placeholder', 'CloudWatch', 'Unused CloudWatch Log Group', {}),
  base('table-placeholder', 'DynamoDB', 'DynamoDB Capacity Mode Comparison', { savings_basis: 'comparison: on_demand_vs_provisioned_observed_workload; blocked by the confidence gate' }),
  base('fn-placeholder', 'Lambda', 'Low-Usage Lambda Function', { invocations_30d: 3, savings_basis: 'estimated: us-east-1 x86 request and duration list price' }),
  base('bucket-placeholder', 'S3', 'S3 Lifecycle Optimization', { standard_storage_gb: 0.2, savings_basis: 'ceiling: assumes 100% of current Standard storage transitions to Standard-IA' }),
  base('ri-placeholder', 'EC2', 'Reserved Instance Opportunity', {}),
]

/** The same Lambda and S3 rows WITH a recorded sub-cent amount: these read "Less than $0.01/mo". */
export const SUB_CENT_RECS = [
  base('fn-subcent', 'Lambda', 'Low-Usage Lambda Function', { savings_basis: 'estimated: lambda', savings_unrounded_usd: 0.0012 }),
  base('bucket-subcent', 'S3', 'S3 Lifecycle Optimization', { savings_basis: 'ceiling: s3', savings_unrounded_usd: 0.0021 }),
]

/** /stats for open findings none of which has a figure. */
export const STATS_OPEN_NO_FIGURE = {
  totalRecommendations: NO_FIGURE_RECS.length, activeRecommendations: NO_FIGURE_RECS.length, totalPotentialSavings: 0,
  potentialSavingsByResourceType: { RDS: 0, Lambda: 0, DynamoDB: 0 }, potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: { S3: 0 },
  estimatedFindings: 0, unestimatedFindings: NO_FIGURE_RECS.length - 1, bySeverity: { high: 0, medium: 0, low: NO_FIGURE_RECS.length },
}

/** /stats for nothing open after an analysis. */
export const STATS_NONE_OPEN = {
  totalRecommendations: 3, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
  potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, estimatedFindings: 0, unestimatedFindings: 0,
  bySeverity: { high: 0, medium: 0, low: 0 },
}
