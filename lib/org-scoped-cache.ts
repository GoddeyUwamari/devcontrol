/**
 * Removal of retired browser (localStorage) caches of organization data.
 *
 * localStorage outlives a session: it survives logout, a different user
 * signing in on the same browser, and an organization switch. The retired
 * /dependencies page cached each organization's dependency list under
 * `dependencies_cache:<organizationId>`, and before that under unscoped keys
 * whose data cannot be attributed to an organization. Nothing reads or writes
 * any of these keys any more, but browsers that visited the page may still
 * hold them.
 *
 * clearOrgScopedCaches() removes every such entry, for every organization,
 * plus the pre-scoping keys. It runs on the identity changes AuthProvider and
 * the SSO callback page handle; see AuthProvider for which organization
 * changes reach it.
 */

/** Key prefixes of retired per-organization caches. */
const RETIRED_SCOPED_PREFIXES = ['dependencies_cache:'] as const

/** Keys written before caches were organization-scoped. */
const LEGACY_UNSCOPED_KEYS = ['dependencies_cache', 'dependencies_cache_timestamp'] as const

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage
  } catch {
    return null
  }
}

/** Removes every organization's entries of every retired cache, and the legacy keys. */
export function clearOrgScopedCaches(): void {
  const store = storage()
  if (!store) return
  try {
    const doomed: string[] = []
    for (let i = 0; i < store.length; i++) {
      const key = store.key(i)
      if (key && RETIRED_SCOPED_PREFIXES.some((prefix) => key.startsWith(prefix))) doomed.push(key)
    }
    for (const key of doomed) store.removeItem(key)
    for (const key of LEGACY_UNSCOPED_KEYS) store.removeItem(key)
  } catch {
    // Storage unavailable: there is nothing this tab can read back either.
  }
}
