import { useQuery } from '@tanstack/react-query';
import { aiSummaryService, AISummaryResult } from '@/lib/services/ai-summary.service';

/**
 * Backend caches per-org for up to 4h (keyed on the org's latest completed scan),
 * so polling more often than that just re-hits the cache — staleTime/refetchInterval
 * match that ceiling rather than the default aggressive polling.
 */
export function useAISummary(organizationId?: string, costDeltaPct?: number | null, enabled = true) {
  return useQuery<AISummaryResult>({
    queryKey: ['ai-summary', organizationId],
    queryFn: () => aiSummaryService.getSummary(costDeltaPct),
    staleTime: 4 * 60 * 60 * 1000,
    refetchInterval: 4 * 60 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: enabled && !!organizationId,
  });
}
