import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  soc2Service,
  CreateCustomerEvidenceRequest,
  Soc2CustomerEvidence,
  UpdateCustomerEvidenceMetadataRequest,
} from '@/lib/services/soc2.service';

/**
 * Customer-provided evidence (Phase 3) -- a deliberately separate query-key namespace
 * ('soc2-customer-evidence') from technical readiness ('soc2-readiness'/'soc2-evidence',
 * see useSoc2Readiness.ts). Phase 3's backend never writes to soc2_evidence_observations
 * or soc2_control_evaluations (proven by a live-DB isolation test in the backend), so a
 * customer-evidence mutation must never invalidate or refetch technical evidence -- doing
 * so would imply a data dependency that does not exist.
 */
export function useCustomerEvidenceList(criterionId?: string, enabled = true) {
  return useQuery<Soc2CustomerEvidence[]>({
    queryKey: ['soc2-customer-evidence', criterionId ?? null],
    queryFn: () => soc2Service.getCustomerEvidence(criterionId),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled,
  });
}

export function useCustomerEvidenceDetail(evidenceId: string, enabled = true) {
  return useQuery<Soc2CustomerEvidence>({
    queryKey: ['soc2-customer-evidence', 'detail', evidenceId],
    queryFn: () => soc2Service.getCustomerEvidenceById(evidenceId),
    staleTime: 2 * 60 * 1000,
    refetchOnWindowFocus: false,
    retry: false,
    enabled: enabled && !!evidenceId,
  });
}

export function useCreateCustomerEvidence() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (request: CreateCustomerEvidenceRequest) => soc2Service.createCustomerEvidence(request),
    onSuccess: () => {
      // Only customer-evidence queries -- never 'soc2-readiness'/'soc2-evidence'.
      queryClient.invalidateQueries({ queryKey: ['soc2-customer-evidence'] });
    },
  });
}

export function useUpdateCustomerEvidenceMetadata() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: ({ evidenceId, request }: { evidenceId: string; request: UpdateCustomerEvidenceMetadataRequest }) =>
      soc2Service.updateCustomerEvidenceMetadata(evidenceId, request),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['soc2-customer-evidence'] });
    },
  });
}
