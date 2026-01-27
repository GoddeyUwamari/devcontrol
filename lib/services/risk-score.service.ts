import api, { handleApiResponse } from '../api';

export interface RiskScoreFactors {
  encryption: number;
  publicAccess: number;
  backup: number;
  compliance: number;
  resourceManagement: number;
}

export interface RiskScore {
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  color: string;
  factors: RiskScoreFactors;
  frameworksAtRisk: string[];
}

export interface RiskScoreTrendPoint {
  date: string;
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  factors: RiskScoreFactors;
}

export interface RiskScoreTrendResponse {
  current: RiskScore;
  trend: 'improving' | 'stable' | 'declining';
  trendPercentage: number;
  history: RiskScoreTrendPoint[];
  period: {
    start: string;
    end: string;
    days: number;
  };
}

export type DateRange = '7d' | '30d' | '90d';

export const riskScoreService = {
  /**
   * Get current risk score without historical data
   */
  getCurrent: async (): Promise<RiskScore> => {
    const response = await api.get('/api/risk-score/current');
    return handleApiResponse(response);
  },

  /**
   * Get risk score trend with historical data
   * @param dateRange - Time period: 7d, 30d, or 90d
   */
  getTrend: async (dateRange: DateRange = '30d'): Promise<RiskScoreTrendResponse> => {
    const response = await api.get(`/api/risk-score/trend?date_range=${dateRange}`);
    return handleApiResponse(response);
  },
};
