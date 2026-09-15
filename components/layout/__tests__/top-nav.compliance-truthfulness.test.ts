/**
 * Product-truthfulness coverage for the live "Compliance" nav entry.
 *
 * This entry previously described its destination (/compliance/frameworks) as
 * "CIS, NIST, SOC 2 frameworks" — but NIST 800-53 Rev. 5 and SOC 2 are not
 * implemented (see the Phase 5 compliance audit). This is the one nav entry
 * that actually renders in the app (sidebar.tsx and risk-score-card.tsx also
 * link to the legacy /compliance route but are unreferenced dead code), so an
 * overclaim here is a real, always-visible customer-facing issue.
 */
import { describe, it, expect } from 'vitest'
import { navItems, mobileSections } from '../top-nav'

describe('top-nav Compliance entry truthfulness', () => {
  it('desktop Compliance entry never claims NIST or SOC 2 support', () => {
    const compliance = navItems
      .flatMap((item) => item.children ?? [])
      .find((child) => child.href === '/compliance/frameworks')
    expect(compliance).toBeDefined()
    expect(compliance!.desc).toBeDefined()
    expect(compliance!.desc).not.toMatch(/NIST/)
    expect(compliance!.desc).not.toMatch(/SOC\s*2/)
  })

  it('desktop Compliance entry describes only Security Hub-backed CIS/PCI, matching current capability', () => {
    const compliance = navItems
      .flatMap((item) => item.children ?? [])
      .find((child) => child.href === '/compliance/frameworks')
    expect(compliance!.desc).toBe('Security Hub-backed CIS and PCI frameworks')
  })

  it('no desktop nav entry anywhere links to the retired legacy /compliance route', () => {
    const desktopHrefs = navItems.flatMap((item) => item.children ?? []).map((c) => c.href)
    expect(desktopHrefs).not.toContain('/compliance')
  })

  it('mobile Compliance entry is unchanged (label/href only, no overclaiming description field)', () => {
    const compliance = mobileSections
      .flatMap((section) => section.items)
      .find((item) => item.href === '/compliance/frameworks')
    expect(compliance).toBeDefined()
    expect(compliance!.label).toBe('Compliance')
  })
})
