import { useQuery } from '@tanstack/react-query';
import { systemIntelligenceService, SystemIntelligenceResult } from '@/lib/services/system-intelligence.service';

/**
 * Backend caches per-org for 2 minutes (SystemIntelligenceService's shared
 * cache, also used by the Infrastructure page) -- staleTime/refetchInterval
 * match that ceiling rather than the default aggressive polling.
 */
export function useSystemIntelligence(organizationId?: string, enabled = true) {
  return useQuery<SystemIntelligenceResult>({
    queryKey: ['system-intelligence', organizationId],
    queryFn: () => systemIntelligenceService.getIntelligence(),
    staleTime: 2 * 60 * 1000,
    refetchInterval: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: enabled && !!organizationId,
  });
}
