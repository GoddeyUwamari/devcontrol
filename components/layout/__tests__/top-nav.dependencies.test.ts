/**
 * /dependencies is reachable again from the desktop and mobile top nav,
 * navigation-config and the breadcrumb registry -- each exactly once, under
 * Services (breadcrumb: Dashboard > Services > Dependencies).
 */
import { describe, it, expect, vi } from 'vitest'
import { renderHook } from '@testing-library/react'
import { navItems, mobileSections } from '../top-nav'
import { appNav } from '@/lib/navigation-config'
import { parentPaths, useBreadcrumbs } from '@/lib/hooks/useBreadcrumbs'

vi.mock('next/navigation', () => ({ usePathname: () => '/dependencies' }))

describe('/dependencies in navigation', () => {
  it('desktop: one entry, in the Services menu after Deployments', () => {
    const services = navItems.find((item) => item.label === 'Services')!
    const hrefs = services.children!.map((c) => c.href)
    expect(hrefs.filter((h) => h === '/dependencies')).toHaveLength(1)
    expect(hrefs.indexOf('/dependencies')).toBe(hrefs.indexOf('/deployments') + 1)
    expect(services.children!.find((c) => c.href === '/dependencies')).toEqual(
      expect.objectContaining({ label: 'Dependencies', desc: 'Service dependency map' })
    )
    const elsewhere = navItems.filter((item) => item !== services).flatMap((item) => item.children ?? [])
    expect(elsewhere.filter((c) => c.href === '/dependencies')).toEqual([])
  })

  it('mobile: one entry, in the Services section', () => {
    const services = mobileSections.find((s) => s.key === 'services')!
    expect(services.items.filter((i) => i.href === '/dependencies')).toEqual([{ label: 'Dependencies', href: '/dependencies' }])
    const elsewhere = mobileSections.filter((s) => s !== services).flatMap((s) => s.items)
    expect(elsewhere.filter((i) => i.href === '/dependencies')).toEqual([])
  })

  it('navigation-config: one Core Features entry', () => {
    const items = appNav.sections!.flatMap((s) => s.items)
    expect(items.filter((i) => i.href === '/dependencies')).toEqual([
      expect.objectContaining({ label: 'Dependencies', href: '/dependencies', description: 'Service dependencies and relationships' }),
    ])
  })

  it('navigation-config: Services is described as the service catalog', () => {
    const items = appNav.sections!.flatMap((s) => s.items)
    expect(items.find((i) => i.href === '/services')).toEqual(
      expect.objectContaining({ label: 'Services', description: 'Service catalog and management' })
    )
  })

  it('breadcrumbs: Dashboard > Services > Dependencies', () => {
    expect(parentPaths['/dependencies']).toEqual([{ label: 'Services', href: '/services' }])
    const { result } = renderHook(() => useBreadcrumbs())
    expect(result.current.map((b: { label: string }) => b.label)).toEqual(['Dashboard', 'Services', 'Dependencies'])
  })
})
