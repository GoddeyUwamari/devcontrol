/**
 * Tenants is reachable from the desktop and mobile top nav at its real route,
 * /tenants -- the mobile drawer formerly linked to /infrastructure/tenants,
 * which doesn't exist -- and its breadcrumb is Infrastructure > Tenants.
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { navItems, mobileSections } from '../top-nav'
import { useBreadcrumbs } from '@/lib/hooks/useBreadcrumbs'

vi.mock('next/navigation', () => ({ usePathname: () => '/tenants' }))

const allHrefs = () => [
  ...navItems.flatMap((item) => [item.href, ...(item.children ?? []).map((c) => c.href)]),
  ...mobileSections.flatMap((s) => s.items.map((i) => i.href)),
].filter(Boolean) as string[]

describe('Tenants in navigation', () => {
  it('mobile: one entry, in the Infrastructure section, at /tenants', () => {
    const infra = mobileSections.find((s) => s.key === 'infrastructure')!
    expect(infra.items.filter((i) => i.label === 'Tenants')).toEqual([{ label: 'Tenants', href: '/tenants' }])
  })

  it('desktop: one entry at /tenants', () => {
    const desktop = navItems.flatMap((item) => item.children ?? []).filter((c) => c.href === '/tenants')
    expect(desktop).toHaveLength(1)
  })

  it('nothing links to /infrastructure/tenants', () => {
    expect(allHrefs().filter((h) => h.startsWith('/infrastructure/tenants'))).toEqual([])
  })

  it('breadcrumb: Infrastructure (linked) > Tenants', () => {
    const { result } = renderHook(() => useBreadcrumbs())
    const crumbs = result.current.map((c: { label: string; href?: string }) => ({ label: c.label, href: c.href }))
    const infraAt = crumbs.findIndex((c) => c.label === 'Infrastructure')
    expect(infraAt).toBeGreaterThanOrEqual(0)
    expect(crumbs[infraAt].href).toBe('/infrastructure')
    expect(crumbs[crumbs.length - 1].label).toBe('Tenants')
    expect(crumbs.indexOf(crumbs[crumbs.length - 1])).toBeGreaterThan(infraAt)
  })
})
