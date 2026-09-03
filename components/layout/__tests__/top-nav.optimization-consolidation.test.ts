/**
 * Focused coverage for the Cost Intelligence IA cleanup: top-nav previously
 * exposed the same /cost-optimization destination under two different
 * labels -- "Infrastructure > Recommendations" and "Costs > Optimization"
 * (desktop), with mobile only ever having had the latter. Both surfaces now
 * express exactly one canonical "Optimization" concept, and the
 * Infrastructure > Recommendations entry (desktop and mobile) is gone.
 */
import { describe, it, expect } from 'vitest'
import { navItems, mobileSections } from '../top-nav'

describe('top-nav Optimization consolidation', () => {
  it('desktop nav has exactly one entry pointing at /cost-optimization, labeled Optimization', () => {
    const matches = navItems
      .flatMap((item) => item.children ?? [])
      .filter((child) => child.href === '/cost-optimization')
    expect(matches).toHaveLength(1)
    expect(matches[0].label).toBe('Optimization')
  })

  it('mobile nav has exactly one entry pointing at /cost-optimization, labeled Optimization', () => {
    const matches = mobileSections
      .flatMap((section) => section.items)
      .filter((item) => item.href === '/cost-optimization')
    expect(matches).toHaveLength(1)
    expect(matches[0].label).toBe('Optimization')
  })

  it('no desktop or mobile nav entry is labeled "Recommendations" anymore', () => {
    const desktopLabels = navItems.flatMap((item) => item.children ?? []).map((c) => c.label)
    const mobileLabels = mobileSections.flatMap((section) => section.items).map((i) => i.label)
    expect(desktopLabels).not.toContain('Recommendations')
    expect(mobileLabels).not.toContain('Recommendations')
  })

  it('desktop Infrastructure group no longer links to /cost-optimization or /infrastructure/recommendations', () => {
    const infra = navItems.find((item) => item.label === 'Infrastructure')
    expect(infra?.children?.some((c) => c.href === '/cost-optimization')).toBe(false)
    expect(infra?.children?.some((c) => c.href === '/infrastructure/recommendations')).toBe(false)
  })

  it('mobile Infrastructure section no longer links to /cost-optimization or /infrastructure/recommendations', () => {
    const infra = mobileSections.find((section) => section.key === 'infrastructure')
    expect(infra?.items.some((i) => i.href === '/cost-optimization')).toBe(false)
    expect(infra?.items.some((i) => i.href === '/infrastructure/recommendations')).toBe(false)
  })

  it('nothing in top-nav links to the retired /infrastructure/recommendations route', () => {
    const desktopHrefs = navItems.flatMap((item) => item.children ?? []).map((c) => c.href)
    const mobileHrefs = mobileSections.flatMap((section) => section.items).map((i) => i.href)
    expect(desktopHrefs).not.toContain('/infrastructure/recommendations')
    expect(mobileHrefs).not.toContain('/infrastructure/recommendations')
  })
})
