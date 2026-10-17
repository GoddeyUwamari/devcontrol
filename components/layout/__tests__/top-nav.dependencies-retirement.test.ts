/**
 * /dependencies is retired (it redirects to /services). Nothing in navigation
 * or the breadcrumb registry may still point at it.
 */
import { describe, it, expect } from 'vitest'
import { navItems, mobileSections } from '../top-nav'
import * as navigationConfig from '@/lib/navigation-config'
import { parentPaths } from '@/lib/hooks/useBreadcrumbs'

// Every `href` string anywhere inside a value, however deeply nested.
function collectHrefs(value: unknown, seen = new Set<unknown>()): string[] {
  if (value === null || typeof value !== 'object' || seen.has(value)) return []
  seen.add(value)
  return Object.entries(value).flatMap(([key, v]) =>
    key === 'href' && typeof v === 'string' ? [v] : collectHrefs(v, seen)
  )
}

const isDependencies = (href: string) => href.split(/[?#]/)[0].replace(/\/$/, '') === '/dependencies'

describe('/dependencies retirement in navigation', () => {
  it('desktop navItems have no /dependencies entry', () => {
    expect(collectHrefs(navItems).filter(isDependencies)).toEqual([])
  })

  it('mobileSections have no /dependencies entry', () => {
    expect(collectHrefs(mobileSections).filter(isDependencies)).toEqual([])
  })

  it('navigation-config has no /dependencies entry in any export', () => {
    const hrefs = collectHrefs(navigationConfig)
    expect(hrefs.length).toBeGreaterThan(0)
    expect(hrefs.filter(isDependencies)).toEqual([])
  })

  it('the breadcrumb registry has no /dependencies entry', () => {
    expect(parentPaths['/dependencies']).toBeUndefined()
    expect(parentPaths['/deployments']).toEqual([{ label: 'Services', href: '/services' }])
  })
})
