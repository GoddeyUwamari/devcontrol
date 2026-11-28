import api, { handleApiResponse } from '../api';
import type { PlatformDashboardStats, ApiResponse, CostSummary } from '../types';

/** The stats endpoint's K of N (snake_case), or null when it is absent or malformed. */
function estimateCoverageOf(raw: unknown): PlatformDashboardStats['costEstimateCoverage'] {
  if (!raw || typeof raw !== 'object') return null
  const { priced_resources: priced, total_resources: total } = raw as Record<string, unknown>
  return Number.isInteger(priced) && Number.isInteger(total) && (priced as number) >= 0 && (priced as number) <= (total as number)
    ? { pricedResources: priced as number, totalResources: total as number }
    : null
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