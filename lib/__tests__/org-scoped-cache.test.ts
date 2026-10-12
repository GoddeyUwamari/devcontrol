/**
 * lib/org-scoped-cache.ts: browser caches of organization data are keyed by
 * organization and never readable as another organization's.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import {
  clearOrgScopedCaches,
  orgScopedCacheKey,
  readOrgScopedCache,
  writeOrgScopedCache,
} from '../org-scoped-cache'

const ORG_A = '00000000-0000-4000-8000-00000000000a'
const ORG_B = '00000000-0000-4000-8000-00000000000b'

beforeEach(() => localStorage.clear())

describe('org-scoped browser cache', () => {
  it('stores each organization under a key that includes its id', () => {
    writeOrgScopedCache('dependencies', ORG_A, [{ id: 'dep-a' }])
    expect(orgScopedCacheKey('dependencies', ORG_A)).toBe(`dependencies_cache:${ORG_A}`)
    expect(JSON.parse(localStorage.getItem(`dependencies_cache:${ORG_A}`)!)).toMatchObject({
      organizationId: ORG_A,
      data: [{ id: 'dep-a' }],
    })
  })

  it("reads back an organization's own entry", () => {
    const savedAt = new Date('2026-10-11T12:00:00.000Z')
    writeOrgScopedCache('dependencies', ORG_A, [{ id: 'dep-a' }], savedAt)
    expect(readOrgScopedCache('dependencies', ORG_A)).toEqual({
      organizationId: ORG_A,
      savedAt: savedAt.toISOString(),
      data: [{ id: 'dep-a' }],
    })
  })

  it("never returns another organization's entry", () => {
    writeOrgScopedCache('dependencies', ORG_A, [{ id: 'dep-a' }])
    expect(readOrgScopedCache('dependencies', ORG_B)).toBeNull()
  })

  it('rejects an entry whose recorded organization does not match its key', () => {
    localStorage.setItem(
      `dependencies_cache:${ORG_B}`,
      JSON.stringify({ organizationId: ORG_A, savedAt: new Date().toISOString(), data: [{ id: 'dep-a' }] })
    )
    expect(readOrgScopedCache('dependencies', ORG_B)).toBeNull()
  })

  it('without an organization, stores nothing and reads nothing', () => {
    expect(writeOrgScopedCache('dependencies', null, [{ id: 'dep' }])).toBeNull()
    expect(localStorage.length).toBe(0)
    expect(readOrgScopedCache('dependencies', null)).toBeNull()
    expect(readOrgScopedCache('dependencies', undefined)).toBeNull()
  })

  it('treats an unreadable entry as no cache', () => {
    localStorage.setItem(`dependencies_cache:${ORG_A}`, '{not json')
    expect(readOrgScopedCache('dependencies', ORG_A)).toBeNull()
  })

  it('never reads the pre-scoping unattributed keys, and removes them', () => {
    localStorage.setItem('dependencies_cache', JSON.stringify([{ id: 'dep-unknown-org' }]))
    localStorage.setItem('dependencies_cache_timestamp', new Date().toISOString())

    expect(readOrgScopedCache('dependencies', ORG_A)).toBeNull()
    expect(localStorage.getItem('dependencies_cache')).toBeNull()
    expect(localStorage.getItem('dependencies_cache_timestamp')).toBeNull()
  })

  it("clearOrgScopedCaches removes every organization's entries and the legacy keys, nothing else", () => {
    writeOrgScopedCache('dependencies', ORG_A, [{ id: 'dep-a' }])
    writeOrgScopedCache('dependencies', ORG_B, [{ id: 'dep-b' }])
    localStorage.setItem('dependencies_cache', '[]')
    localStorage.setItem('dependencies_cache_timestamp', 'x')
    localStorage.setItem('announcement-dismissed', 'true')

    clearOrgScopedCaches()

    expect(readOrgScopedCache('dependencies', ORG_A)).toBeNull()
    expect(readOrgScopedCache('dependencies', ORG_B)).toBeNull()
    expect(Object.keys(localStorage)).toEqual(['announcement-dismissed'])
  })
})
