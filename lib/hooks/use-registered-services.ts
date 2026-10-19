import { useQuery } from '@tanstack/react-query';
import { servicesService } from '@/lib/services/services.service';
import { fetchForOrganization, useSessionOrganizationId } from '@/lib/hooks/use-dependencies';

/**
 * The session organization's registered services (GET
 * /api/services/registered): the services-table rows that deployments,
 * infrastructure and dependencies reference by service_id. Keyed by the
 * access token's organization and refetched on every mount, so a service
 * registered moments ago on /services/new is listed.
 */
export function useRegisteredServices() {
  const organizationId = useSessionOrganizationId();
  return useQuery({
    queryKey: ['registered-services', organizationId],
    queryFn: fetchForOrganization(organizationId ?? '', () => servicesService.getRegistered()),
    enabled: !!organizationId,
    refetchOnMount: 'always',
  });
}
