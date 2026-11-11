/**
 * Binding rule (catalog CAT-1..3): fixing a claim never removes a capability.
 * Not-ready features stay in the navigation with a "Coming soon" badge. The
 * full href lists below are the navigation at 5dd5e593 (#312, before CAT-3);
 * removing or renaming an entry fails here. Adding one is fine: add it here
 * too.
 */
import { describe, it, expect } from 'vitest'
import { navItems, mobileSections } from '../top-nav'

const DESKTOP_HREFS_AT_5DD5E593 = [
  '/services', '/services/new', '/deployments', '/dependencies',
  '/infrastructure', '/infrastructure/new', '/tenants',
  '/costs', '/cost-optimization', '/cost-optimization/controls', '/forecast', '/invoices', '/ai-reports', '/costs/efficiency', '/costs/by-team',
  '/security', '/anomalies', '/anomalies/rules', '/compliance/frameworks', '/audit-logs',
  '/monitoring', '/observability/alerts', '/observability/alert-history', '/monitoring/slos', '/status',
  '/app/dora-metrics', '/teams', '/enterprise', '/remediation', '/developers',
]

const MOBILE_HREFS_AT_5DD5E593 = DESKTOP_HREFS_AT_5DD5E593.filter((href) => href !== '/services/new' && href !== '/infrastructure/new')

type Entry = { href?: string; badge?: string; desc?: string }
const desktop = navItems.flatMap((item): Entry[] => item.children ?? [item])
const mobile = mobileSections.flatMap((section) => section.items)

const COMING_SOON_HREFS = ['/costs/by-team', '/anomalies', '/anomalies/rules', '/developers']

describe('no capability left the navigation', () => {
  it('desktop: every entry at 5dd5e593 is still there (a capability must stay listed as Coming soon)', () => {
    const hrefs = desktop.map((c) => c.href)
    for (const href of DESKTOP_HREFS_AT_5DD5E593) expect(hrefs, `missing ${href}`).toContain(href)
  })

  it('phone drawer: every entry at 5dd5e593 is still there (a capability must stay listed as Coming soon)', () => {
    const hrefs = mobile.map((i) => i.href)
    for (const href of MOBILE_HREFS_AT_5DD5E593) expect(hrefs, `missing ${href}`).toContain(href)
  })

  it('the four not-ready items carry "Coming soon" on desktop and in the phone drawer', () => {
    for (const href of COMING_SOON_HREFS) {
      expect(desktop.find((c) => c.href === href)?.badge, href).toBe('Coming soon')
      expect(mobile.find((i) => i.href === href)?.badge, href).toBe('Coming soon')
    }
  })

  it('the corrected descriptions make no real-time, AI or "detected threats" claim', () => {
    const desc = (href: string) => desktop.find((c) => c.href === href)?.desc
    expect(desc('/costs')).toBe('Spend from AWS Cost Explorer')
    expect(desc('/cost-optimization')).toBe('Savings recommendations')
    expect(desc('/forecast')).toBe('Forecast future AWS spend')
    expect(desc('/anomalies')).toBe('Cost and usage anomaly detection')
  })
})
