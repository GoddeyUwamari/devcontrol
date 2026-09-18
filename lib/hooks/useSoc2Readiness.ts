import { useQuery } from '@tanstack/react-query';
import { soc2Service, Soc2Observation, Soc2ReadinessCriterion, Soc2ReadinessDetail } from '@/lib/services/soc2.service';

/**
 * Technical (AWS-observed) SOC 2 readiness -- GET /api/soc2/readiness. This endpoint is
 * authenticated but NOT Enterprise-gated server-side; do not wrap this hook's consumer
 * in any tier check.
 */
export function useSoc2Readiness(enabled = true) {
  return useQuery<Soc2ReadinessCriterion[]>({
    queryKey: ['soc2-readiness'],
    queryFn: () => soc2Service.getReadiness(),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled,
  });
}

export function useSoc2ReadinessDetail(criterionId: string, enabled = true) {
  return useQuery<Soc2ReadinessDetail>({
    queryKey: ['soc2-readiness', criterionId],
    queryFn: () => soc2Service.getReadinessDetail(criterionId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: enabled && !!criterionId,
  });
}

/** AWS-observed evidence (Phase 2), optionally filtered by criterion. Deliberately a
 * separate query key from customer evidence -- see useCustomerEvidence.ts's docblock. */
export function useSoc2Evidence(criterionId?: string, enabled = true) {
  return useQuery<Soc2Observation[]>({
    queryKey: ['soc2-evidence', criterionId ?? null],
    queryFn: () => soc2Service.getEvidence(criterionId),
    staleTime: 5 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled,
  });
}
