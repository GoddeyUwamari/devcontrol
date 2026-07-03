import api, { handleApiResponse } from '../api';
import type { PlatformDashboardStats, ApiResponse } from '../types';

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
    };
  },
};