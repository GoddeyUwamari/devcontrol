/**
 * useAIInsights Hook
 * Custom hook for fetching AI-powered cost insights
 */

import { useState, useEffect } from 'react';
import { aiInsightsService, type CostAnalysisRequest, type AIInsight } from '@/lib/services/ai-insights.service';

interface UseAIInsightsOptions {
  enabled?: boolean;
  onSuccess?: (data: AIInsight) => void;
  onError?: (error: Error) => void;
}

export function useAIInsights(
  costData: CostAnalysisRequest | null,
  options: UseAIInsightsOptions = {}
) {
  const [data, setData] = useState<AIInsight | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  const { enabled = true, onSuccess, onError } = options;

  useEffect(() => {
    if (!costData || !enabled) {
      return;
    }

    const fetchInsights = async () => {
      setIsLoading(true);
      setError(null);

      try {
        const result = await aiInsightsService.analyzeCost(costData);
        setData(result);
        onSuccess?.(result);
      } catch (err) {
        const error = err instanceof Error ? err : new Error('Failed to fetch AI insights');
        setError(error);
        onError?.(error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchInsights();
  }, [
    costData?.currentCost,
    costData?.previousCost,
    costData?.percentageIncrease,
    enabled
  ]);

  const refetch = async () => {
    if (!costData) return;

    setIsLoading(true);
    setError(null);

    try {
      const result = await aiInsightsService.analyzeCost(costData);
      setData(result);
      onSuccess?.(result);
    } catch (err) {
      const error = err instanceof Error ? err : new Error('Failed to fetch AI insights');
      setError(error);
      onError?.(error);
    } finally {
      setIsLoading(false);
    }
  };

  return {
    data,
    isLoading,
    error,
    refetch
  };
}
