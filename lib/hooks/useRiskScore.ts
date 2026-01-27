import { useQuery } from '@tanstack/react-query';
import { riskScoreService, DateRange, RiskScoreTrendResponse, RiskScore } from '@/lib/services/risk-score.service';

/**
 * Hook to fetch risk score trend with historical data
 */
export function useRiskScoreTrend(dateRange: DateRange = '30d') {
  return useQuery<RiskScoreTrendResponse>({
    queryKey: ['risk-score-trend', dateRange],
    queryFn: () => riskScoreService.getTrend(dateRange),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });
}

/**
 * Hook to fetch current risk score only
 */
export function useCurrentRiskScore() {
  return useQuery<RiskScore>({
    queryKey: ['risk-score-current'],
    queryFn: () => riskScoreService.getCurrent(),
    staleTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });
}
