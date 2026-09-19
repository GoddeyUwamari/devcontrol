/**
 * Regression coverage for the Compliance breadcrumb routing defect: on
 * /compliance/frameworks/soc2, the visible "Compliance" breadcrumb had
 * href="/frameworks" (a 404) instead of "/compliance/frameworks", because the
 * 'compliance' segment was filtered out of the segments array before currentPath was
 * reconstructed from it. Exercises the real hook (not just the parentPaths constant),
 * mocking next/navigation's usePathname the same way other tests in this repo mock
 * next/navigation (see soc2-detail-page.test.tsx's useRouter mock).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'

let mockPathname = '/dashboard'
vi.mock('next/navigation', () => ({
  usePathname: () => mockPathname,
}))

import { useBreadcrumbs } from '../useBreadcrumbs'

beforeEach(() => {
  mockPathname = '/dashboard'
})

describe('useBreadcrumbs — /compliance/frameworks/soc2', () => {
  it('the visible "Compliance" breadcrumb points at /compliance/frameworks, never /frameworks', () => {
    mockPathname = '/compliance/frameworks/soc2'
    const { result } = renderHook(() => useBreadcrumbs())

    const compliance = result.current.find((b) => b.label === 'Compliance')
    expect(compliance).toBeDefined()
    expect(compliance?.href).toBe('/compliance/frameworks')
    expect(compliance?.current).toBe(false)

    expect(result.current.some((b) => b.href === '/frameworks')).toBe(false)
  })

  it('retains the Security parent breadcrumb, matching /compliance/frameworks', () => {
    mockPathname = '/compliance/frameworks/soc2'
    const { result } = renderHook(() => useBreadcrumbs())

    const security = result.current.find((b) => b.label === 'Security')
    expect(security).toBeDefined()
    expect(security?.href).toBe('/security')
  })

  it('the last segment (soc2) remains the current, non-clickable crumb', () => {
    mockPathname = '/compliance/frameworks/soc2'
    const { result } = renderHook(() => useBreadcrumbs())

    const last = result.current[result.current.length - 1]
    expect(last.current).toBe(true)
    expect(last.href).toBeUndefined()
  })
})

describe('useBreadcrumbs — /compliance/frameworks (no regression)', () => {
  it('the current-page "Compliance" breadcrumb remains non-clickable, with no href', () => {
    mockPathname = '/compliance/frameworks'
    const { result } = renderHook(() => useBreadcrumbs())

    const compliance = result.current.find((b) => b.label === 'Compliance')
    expect(compliance).toBeDefined()
    expect(compliance?.current).toBe(true)
    expect(compliance?.href).toBeUndefined()

    expect(result.current.some((b) => b.href === '/frameworks')).toBe(false)
  })

  it('retains the existing Security parent breadcrumb', () => {
    mockPathname = '/compliance/frameworks'
    const { result } = renderHook(() => useBreadcrumbs())

    const security = result.current.find((b) => b.label === 'Security')
    expect(security).toBeDefined()
    expect(security?.href).toBe('/security')
  })
})
