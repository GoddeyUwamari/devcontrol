import { useSyncExternalStore } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/lib/contexts/auth-context';
import { tokenManager } from '@/lib/services/auth.service';
import { dependenciesService } from '@/lib/services/dependencies.service';
import { servicesService } from '@/lib/services/services.service';

/**
 * Queries behind the /dependencies page. Each key starts with
 * ['dependencies', organizationId], where organizationId is the access
 * token's organization -- the organization the backend scopes every one of
 * these responses to. A different organization therefore never shares a
 * cache entry, and invalidating ['dependencies', organizationId] refreshes
 * all of them for that organization only.
 *
 * Nothing here is written to localStorage (see lib/org-scoped-cache.ts for
 * the retired browser cache this page used to keep).
 */

/**
 * The access token's organization, or null with no signed-in user or no
 * claim. Null on the server and while hydrating (the token lives in
 * localStorage), then re-read on every render: a sign-in can replace the
 * token without changing the user id or AuthContext's organization (which
 * can name a different organization than the token -- see AuthProvider's
 * refreshOrganizations).
 */
export function useSessionOrganizationId(): string | null {
  const { user } = useAuth();
  // false on the server and while hydrating, true on the client after that
  const onClient = useSyncExternalStore(subscribeToNothing, () => true, () => false);

  return onClient && user ? tokenManager.getCurrentOrganizationId() : null;
}

function subscribeToNothing(): () => void {
  return () => {};
}

/** The session's token now names a different organization than the query's key. */
export class SessionOrganizationChangedError extends Error {
  constructor() {
    super('The session now belongs to a different organization');
    this.name = 'SessionOrganizationChangedError';
  }
}

/**
 * Runs fetch only while the access token still names organizationId, and
 * discards its result if the token changed while it was in flight (another
 * tab's sign-in replaces the shared token). The response would belong to the
 * new organization, so it must not be stored under this organization's key.
 */
export function fetchForOrganization<T>(organizationId: string, fetch: () => Promise<T>): () => Promise<T> {
  return async () => {
    if (tokenManager.getCurrentOrganizationId() !== organizationId) throw new SessionOrganizationChangedError();
    const data = await fetch();
    if (tokenManager.getCurrentOrganizationId() !== organizationId) throw new SessionOrganizationChangedError();
    return data;
  };
}

export const dependencyKeys = {
  all: (organizationId: string | null) => ['dependencies', organizationId] as const,
  list: (organizationId: string | null) => ['dependencies', organizationId, 'list'] as const,
  graph: (organizationId: string | null) => ['dependencies', organizationId, 'graph'] as const,
  cycles: (organizationId: string | null) => ['dependencies', organizationId, 'cycles'] as const,
  services: (organizationId: string | null) => ['dependencies', organizationId, 'services'] as const,
  impact: (organizationId: string | null, serviceId: string | null) =>
    ['dependencies', organizationId, 'impact', serviceId] as const,
};

export function useDependencyList(organizationId: string | null) {
  return useQuery({
    queryKey: dependencyKeys.list(organizationId),
    queryFn: fetchForOrganization(organizationId ?? '', () => dependenciesService.getAll()),
    enabled: !!organizationId,
  });
}

export function useDependencyGraph(organizationId: string | null) {
  return useQuery({
    queryKey: dependencyKeys.graph(organizationId),
    queryFn: fetchForOrganization(organizationId ?? '', () => dependenciesService.getGraph()),
    enabled: !!organizationId,
  });
}

export function useDependencyCycles(organizationId: string | null) {
  return useQuery({
    queryKey: dependencyKeys.cycles(organizationId),
    queryFn: fetchForOrganization(organizationId ?? '', () => dependenciesService.detectCircularDependencies()),
    enabled: !!organizationId,
  });
}

/** The organization's services, for the impact selector and the add dialog. */
export function useDependencyServices(organizationId: string | null) {
  return useQuery({
    queryKey: dependencyKeys.services(organizationId),
    queryFn: fetchForOrganization(organizationId ?? '', () => servicesService.getAll()),
    enabled: !!organizationId,
  });
}

export function useImpactAnalysis(organizationId: string | null, serviceId: string | null) {
  return useQuery({
    queryKey: dependencyKeys.impact(organizationId, serviceId),
    queryFn: fetchForOrganization(organizationId ?? '', () => dependenciesService.getImpactAnalysis(serviceId!)),
    enabled: !!organizationId && !!serviceId,
  });
}
