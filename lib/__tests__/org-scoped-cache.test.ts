/**
 * lib/org-scoped-cache.ts: clearOrgScopedCaches removes the retired
 * per-organization caches and the pre-scoping keys, and nothing else.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { clearOrgScopedCaches } from '../org-scoped-cache'

const ORG_A = '00000000-0000-4000-8000-00000000000a'
const ORG_B = '00000000-0000-4000-8000-00000000000b'

beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

describe('clearOrgScopedCaches', () => {
  it("removes every organization's retired entries and the legacy keys, nothing else", () => {
    localStorage.setItem(`dependencies_cache:${ORG_A}`, JSON.stringify({ organizationId: ORG_A, data: [] }))
    localStorage.setItem(`dependencies_cache:${ORG_B}`, JSON.stringify({ organizationId: ORG_B, data: [] }))
    localStorage.setItem('dependencies_cache', '[]')
    localStorage.setItem('dependencies_cache_timestamp', 'x')
    localStorage.setItem('announcement-dismissed', 'true')

    clearOrgScopedCaches()

    expect(Object.keys(localStorage)).toEqual(['announcement-dismissed'])
    expect(localStorage.getItem('announcement-dismissed')).toBe('true')
  })

  it('does not throw when storage is unavailable', () => {
    vi.spyOn(window, 'localStorage', 'get').mockImplementation(() => {
      throw new Error('storage disabled')
    })
    expect(() => clearOrgScopedCaches()).not.toThrow()
  })
})
