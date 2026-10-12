import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@/lib/contexts/auth-context';
import { tokenManager } from '@/lib/services/auth.service';
import {
  readOrgScopedCache,
  writeOrgScopedCache,
  type OrgScopedCacheEntry,
  type OrgScopedCacheName,
} from '@/lib/org-scoped-cache';

/**
 * The organization this session's API responses belong to: the access
 * token's `organizationId` claim (tokenManager.getCurrentOrganizationId).
 * Null when there is no token or claim, before the first client effect, and
 * whenever AuthContext's current organization names a different one -- an
 * ambiguous session gets no browser cache at all rather than a guess.
 * Re-read on every user or organization change.
 */
export function useSessionOrganizationId(): string | null {
  const { user, organization } = useAuth();
  const contextOrganizationId = organization?.id ?? null;
  const userId = user?.id ?? null;
  const [organizationId, setOrganizationId] = useState<string | null>(null);

  useEffect(() => {
    const tokenOrganizationId = userId ? tokenManager.getCurrentOrganizationId() : null;
    setOrganizationId(
      tokenOrganizationId && (!contextOrganizationId || contextOrganizationId === tokenOrganizationId)
        ? tokenOrganizationId
        : null
    );
  }, [userId, contextOrganizationId]);

  return organizationId;
}

/**
 * A browser cache of one organization's data (lib/org-scoped-cache.ts).
 * `entry` is only ever the given organization's own entry: null with no
 * organization, after an organization change until that organization's
 * entry is read, and when it has none -- never another organization's.
 * `save` stores data under the given organization; without one it does nothing.
 * It also does nothing once the access token names a different organization:
 * the token lives in localStorage, shared by every tab, so another tab's
 * sign-in changes whose data this tab's requests return while the given
 * organization is still the one captured here.
 */
export function useOrgScopedCache<T>(
  name: OrgScopedCacheName,
  organizationId: string | null
): { entry: OrgScopedCacheEntry<T> | null; save: (data: T) => void } {
  const [entry, setEntry] = useState<OrgScopedCacheEntry<T> | null>(null);

  useEffect(() => {
    setEntry(readOrgScopedCache<T>(name, organizationId));
  }, [name, organizationId]);

  const save = useCallback(
    (data: T) => {
      if (!organizationId || tokenManager.getCurrentOrganizationId() !== organizationId) return;
      const saved = writeOrgScopedCache(name, organizationId, data);
      if (saved) setEntry(saved);
    },
    [name, organizationId]
  );

  // State can lag an organization change by one render; never return it then.
  const current = entry && organizationId && entry.organizationId === organizationId ? entry : null;
  return { entry: current, save };
}
