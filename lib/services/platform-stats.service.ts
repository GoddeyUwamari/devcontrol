import api, { handleApiResponse } from '../api';
import type { PlatformDashboardStats, ApiResponse, CostSummary } from '../types';

/** The stats endpoint's K of N (snake_case), or null when it is absent or malformed. */
function estimateCoverageOf(raw: unknown): PlatformDashboardStats['costEstimateCoverage'] {
  if (!raw || typeof raw !== 'object') return null
  const { priced_resources: priced, total_resources: total, excluded_resources: excluded, priced_lambda_resources: lambda } = raw as Record<string, unknown>
  if (!(Number.isInteger(priced) && Number.isInteger(total) && (priced as number) >= 0 && (priced as number) <= (total as number))) return null
  const coverage: NonNullable<PlatformDashboardStats['costEstimateCoverage']> = { pricedResources: priced as number, totalResources: total as number }
  // M (not running, with no direct charge, or with no billable usage, outside N): kept only when well-formed.
  if (Number.isInteger(excluded) && (excluded as number) >= 0) coverage.excludedResources = excluded as number
  // S-2: priced Lambda figures (before free tier) in the estimate, kept only when well-formed.
  if (Number.isInteger(lambda) && (lambda as number) >= 0 && (lambda as number) <= (priced as number)) coverage.pricedLambdaResources = lambda as number
  return coverage
}

export const platformStatsService = {
  // Get dashboard statistics
  getDashboardStats: async (): Promise<PlatformDashboardStats> => {
    const response = await api.get<ApiResponse<any>>('/api/platform/stats/dashboard');
    const result = handleApiResponse(response);
    
    // Transform backend snake_case to frontend camelCase
    return {
      totalServices: result.total_services || 0,
      activeDeployments: result.active_deployments || 0,
      monthlyAwsCost: parseFloat(result.total_infrastructure_cost) || 0,
      totalTeams: result.total_teams || 0,
      servicesChange: 0, // TODO: Calculate from historical data
      deploymentsChange: 0,
      costChange: 0,
      teamsChange: 0,
      costSource: (result.cost_source as 'actual' | 'estimated') ?? 'estimated',
      costEstimateCoverage: estimateCoverageOf(result.cost_estimate_coverage),
    };
  },

  // Month-to-date spend and month-over-month comparison as evidence sections --
  // actual / estimated / unavailable / error are distinct, never a 0 fallback.
  getCostSummary: async (): Promise<CostSummary> => {
    const response = await api.get<ApiResponse<CostSummary>>('/api/platform/costs/summary');
    return handleApiResponse(response);
  },
};