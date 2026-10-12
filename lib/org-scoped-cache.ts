/**
 * Browser (localStorage) caches of organization data, keyed by organization.
 *
 * localStorage outlives a session: it survives logout, a different user
 * signing in on the same browser, and an organization switch. So a cache of
 * one organization's data must never be readable as another organization's.
 * Every entry here is stored under a key that includes the organization id,
 * and also records that id inside the value; a read returns the entry only
 * when both match the organization asked for. Anything else -- no
 * organization, a different one, an unparseable value -- reads as no cache,
 * so the caller shows its normal loading or error state instead.
 *
 * clearOrgScopedCaches() removes every entry, for every organization, plus
 * the pre-scoping keys that held unattributed data. It runs on every identity
 * or organization change (see AuthProvider).
 */

/** The browser caches of organization data. Each name is a key prefix. */
export const ORG_SCOPED_CACHES = {
  dependencies: 'dependencies_cache',
} as const

export type OrgScopedCacheName = keyof typeof ORG_SCOPED_CACHES

/**
 * Keys written before caches were organization-scoped. Their data cannot be
 * attributed to an organization, so it is never read -- only removed.
 */
const LEGACY_UNSCOPED_KEYS = ['dependencies_cache', 'dependencies_cache_timestamp'] as const

export interface OrgScopedCacheEntry<T> {
  organizationId: string
  savedAt: string
  data: T
}

export function orgScopedCacheKey(name: OrgScopedCacheName, organizationId: string): string {
  return `${ORG_SCOPED_CACHES[name]}:${organizationId}`
}

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

function removeLegacyKeys(store: Storage): void {
  for (const key of LEGACY_UNSCOPED_KEYS) store.removeItem(key)
}

/** The cached entry for exactly this organization, or null. */
export function readOrgScopedCache<T>(
  name: OrgScopedCacheName,
  organizationId: string | null | undefined
): OrgScopedCacheEntry<T> | null {
  const store = storage()
  if (!store || !organizationId) return null
  try {
    removeLegacyKeys(store)
    const raw = store.getItem(orgScopedCacheKey(name, organizationId))
    if (!raw) return null
    const entry = JSON.parse(raw) as Partial<OrgScopedCacheEntry<T>>
    if (entry?.organizationId !== organizationId || typeof entry.savedAt !== 'string' || !('data' in entry)) {
      return null
    }
    return entry as OrgScopedCacheEntry<T>
  } catch {
    return null
  }
}

/** Stores data for this organization. Without an organization, nothing is stored. */
export function writeOrgScopedCache<T>(
  name: OrgScopedCacheName,
  organizationId: string | null | undefined,
  data: T,
  savedAt: Date = new Date()
): OrgScopedCacheEntry<T> | null {
  const store = storage()
  if (!store || !organizationId) return null
  const entry: OrgScopedCacheEntry<T> = { organizationId, savedAt: savedAt.toISOString(), data }
  try {
    removeLegacyKeys(store)
    store.setItem(orgScopedCacheKey(name, organizationId), JSON.stringify(entry))
    return entry
  } catch {
    return null
  }
}

/** Removes every organization's entries of every cache, and the legacy keys. */
export function clearOrgScopedCaches(): void {
  const store = storage()
  if (!store) return
  try {
    const prefixes = Object.values(ORG_SCOPED_CACHES).map((prefix) => `${prefix}:`)
    const doomed: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key && prefixes.some((prefix) => key.startsWith(prefix))) doomed.push(key)
    }
    for (const key of doomed) store.removeItem(key)
    removeLegacyKeys(store)
  } catch {
    // Storage unavailable: there is nothing this tab can read back either.
  }
}
