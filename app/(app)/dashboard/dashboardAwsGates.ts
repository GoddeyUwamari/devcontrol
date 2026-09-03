import type { PlatformDashboardStats } from '@/lib/types'

/**
 * Pure, extracted-for-testability version of the AWS/billing-state gates used
 * throughout the dashboard. hasBillingData/hasServicesOnly/isBillingSyncing
 * track the separate, much slower (24-48h) AWS Cost Explorer billing sync --
 * showRecommendationSections tracks readiness of cost_recommendations
 * (populated by the fast, ~30-120s discovery scan) and is deliberately NOT
 * gated on billing-data readiness, so the Cost-saving-opportunities and
 * Executive ROI summary sections don't wait on an unrelated, much slower
 * system for data they don't actually depend on.
 *
 * Lives in its own module (not exported from page.tsx) because Next.js's App
 * Router only permits a fixed set of named exports from a page file.
 */
export function computeDashboardAwsGates(params: {
  isDemoActive: boolean
  isAwsConnected: boolean
  statsLoading: boolean
  stats: Pick<PlatformDashboardStats, 'totalServices' | 'monthlyAwsCost' | 'costSource'> | undefined
}) {
  const { isDemoActive, isAwsConnected, statsLoading, stats } = params
  const hasBillingData = !isDemoActive && !!stats && (stats.costSource === 'actual' || stats.monthlyAwsCost > 0)
  const hasServicesOnly = !isDemoActive && !!stats && stats.totalServices > 0 && !hasBillingData
  const isBillingSyncing = !isDemoActive && isAwsConnected && !statsLoading && !!stats && stats.totalServices === 0 && !hasBillingData
  // Requires stats to have loaded at least once (or demo mode, where the
  // stats query never runs) -- otherwise this would show real-looking
  // "no recommendations yet" content during the brief window before the
  // first stats response arrives, since isBillingSyncing itself is also
  // false during that same window.
  const showRecommendationSections = isDemoActive || (isAwsConnected && !statsLoading && !isBillingSyncing)
  return { hasBillingData, hasServicesOnly, isBillingSyncing, showRecommendationSections }
}
