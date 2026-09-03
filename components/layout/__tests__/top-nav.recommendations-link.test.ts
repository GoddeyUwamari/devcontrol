/**
 * Focused coverage for PR 30 item 3: desktop top-nav's Infrastructure ->
 * Recommendations entry pointed at the retired-application-layer page
 * (/infrastructure/recommendations) while the mobile drawer's equivalent
 * entry already correctly pointed at /cost-optimization -- a live,
 * discoverable duplicate destination for the same job. This proves the
 * desktop entry now matches mobile, without rendering the full nav
 * component (which needs useAuth/useRouter/usePathname/anomalyService
 * mocking unrelated to this specific fix).
 */
import { describe, it, expect } from 'vitest'
import { navItems, mobileSections } from '../top-nav'

function findDesktopChild(groupLabel: string, childLabel: string) {
  const group = navItems.find((item) => item.label === groupLabel)
  if (!group || !group.children) throw new Error(`Desktop nav group "${groupLabel}" not found or has no children`)
  const child = group.children.find((c) => c.label === childLabel)
  if (!child) throw new Error(`Desktop nav child "${childLabel}" not found under "${groupLabel}"`)
  return child
}

function findMobileItem(sectionKey: string, itemLabel: string) {
  const section = mobileSections.find((s) => s.key === sectionKey)
  if (!section) throw new Error(`Mobile nav section "${sectionKey}" not found`)
  const item = section.items.find((i) => i.label === itemLabel)
  if (!item) throw new Error(`Mobile nav item "${itemLabel}" not found in section "${sectionKey}"`)
  return item
}

describe('top-nav Infrastructure -> Recommendations destination', () => {
  it('desktop points at /cost-optimization, not the retired /infrastructure/recommendations destination', () => {
    const desktop = findDesktopChild('Infrastructure', 'Recommendations')
    expect(desktop.href).toBe('/cost-optimization')
  })

  it('desktop and mobile now agree on the same destination', () => {
    const desktop = findDesktopChild('Infrastructure', 'Recommendations')
    const mobile = findMobileItem('infrastructure', 'Recommendations')
    expect(desktop.href).toBe(mobile.href)
  })
})
