/**
 * useOrgScopedCache: the hook never hands back another organization's entry,
 * including on the render where the organization has changed and its own
 * state has not caught up yet.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useOrgScopedCache } from '../use-org-scoped-cache'
import { writeOrgScopedCache, type OrgScopedCacheEntry } from '@/lib/org-scoped-cache'

vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ user: null, organization: null }) }))

const ORG_A = '00000000-0000-4000-8000-00000000000a'
const ORG_B = '00000000-0000-4000-8000-00000000000b'

beforeEach(() => localStorage.clear())

describe('useOrgScopedCache', () => {
  it("on every render after an organization change, returns the new organization's entry or none", () => {
    writeOrgScopedCache('dependencies', ORG_A, [{ id: 'dep-a' }])
    writeOrgScopedCache('dependencies', ORG_B, [{ id: 'dep-b' }])
    const renders: { organizationId: string | null; entry: OrgScopedCacheEntry<unknown> | null }[] = []

    const { rerender } = renderHook(
      ({ organizationId }: { organizationId: string | null }) => {
        const { entry } = useOrgScopedCache<unknown>('dependencies', organizationId)
        renders.push({ organizationId, entry })
        return entry
      },
      { initialProps: { organizationId: ORG_A as string | null } }
    )
    expect(renders.at(-1)?.entry?.organizationId).toBe(ORG_A)

    rerender({ organizationId: ORG_B })
    rerender({ organizationId: null })

    // The first render with org B still holds org A's entry in state.
    const firstAsB = renders.find((r) => r.organizationId === ORG_B)
    expect(firstAsB?.entry).toBeNull()
    for (const r of renders) {
      expect(r.entry === null || r.entry.organizationId === r.organizationId).toBe(true)
    }
    expect(renders.filter((r) => r.organizationId === ORG_B).at(-1)?.entry?.organizationId).toBe(ORG_B)
    expect(renders.at(-1)).toEqual({ organizationId: null, entry: null })
  })
})
