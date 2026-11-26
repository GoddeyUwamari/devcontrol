import { useQuery } from '@tanstack/react-query';
import { servicesService } from '@/lib/services/services.service';
import { fetchForOrganization, useSessionOrganizationId } from '@/lib/hooks/use-dependencies';

export const serviceLimitKey = (organizationId: string | null) => ['service-limit', organizationId] as const;

/**
 * The session organization's services limit (GET /api/services/limit),
 * refetched on every mount so it is current after a service is created.
 * Explanatory only: POST /api/services enforces the limit. `enabled: false`
 * makes no request.
 */
export function useServiceLimit({ enabled = true }: { enabled?: boolean } = {}) {
  const organizationId = useSessionOrganizationId();
  return useQuery({
    queryKey: serviceLimitKey(organizationId),
    queryFn: fetchForOrganization(organizationId ?? '', () => servicesService.getLimit()),
    enabled: enabled && !!organizationId,
    refetchOnMount: 'always',
    retry: false,
  });
}
