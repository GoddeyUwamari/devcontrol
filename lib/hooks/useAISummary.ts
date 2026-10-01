import { useQuery } from '@tanstack/react-query';
import { aiSummaryService, AISummaryResult } from '@/lib/services/ai-summary.service';

/**
 * Refetches on the same 5-minute cadence as the Dashboard's security finding
 * queries, so Top Risk (built from those same findings) is not hours behind
 * Security Key Findings. The backend rebuilds the evidence on each call but
 * only regenerates the summary when that evidence's fingerprint changes, and
 * its Cost Explorer inputs are cached for 4h, so this adds no Cost Explorer
 * calls and no model call while nothing has changed.
 */
export function useAISummary(organizationId?: string, enabled = true) {
  return useQuery<AISummaryResult>({
    queryKey: ['ai-summary', organizationId],
    queryFn: () => aiSummaryService.getSummary(),
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: enabled && !!organizationId,
  });
}
