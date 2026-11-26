/**
 * The services limit on the pricing surfaces (service-limits Addendum 1, FQ2
 * C11 Option A): every plan card says it, right after the resources line, and
 * the comparison table's Limits group has a Services row. The numbers come
 * from plan-limits.json, which backend/src/config/__tests__/
 * plan-catalog-parity.test.ts compares with TIER_LIMITS.maxServices.
 */
import { describe, expect, it } from 'vitest'
import limits from '../plan-limits.json'
import { PLANS, TIERS, VALUE_ROWS, cardFeatures, comparisonGroups, feature } from '../plan-catalog'

describe('services limit on the pricing surfaces', () => {
  it('plan-limits.json: Visibility 5, Cost Control 20, Optimization Engine 100, Revenue Protection unlimited', () => {
    expect(limits.services).toEqual({ free: 5, starter: 20, pro: 100, enterprise: null })
  })

  it.each([
    ['free', 'Up to 5 services'],
    ['starter', 'Up to 20 services'],
    ['pro', 'Up to 100 services'],
    ['enterprise', 'Unlimited services'],
  ] as const)('%s card: "%s", second line, after the resources line', (tier, label) => {
    const lines = cardFeatures(tier)
    expect(lines[0].id).toBe(`limits-${tier}`)
    expect(lines[1]).toMatchObject({ id: `services-${tier}`, label, tier, group: 'limits', table: false })
    expect(feature(`services-${tier}`).badge).toBeUndefined()
  })

  it('the comparison table\'s Limits group has a Services row with every plan\'s number', () => {
    const row = VALUE_ROWS.find((r) => r.id === 'row-services')
    expect(row).toMatchObject({ group: 'limits', label: 'Services', values: { free: '5', starter: '20', pro: '100', enterprise: 'Unlimited' } })
    const limitsGroup = comparisonGroups().find((g) => g.id === 'limits')!
    expect(limitsGroup.rows.map((r) => (r.kind === 'value' ? r.row.id : r.feature.id))).toContain('row-services')
  })

  it('every plan has exactly one services line', () => {
    for (const tier of TIERS) {
      expect(PLANS.find((p) => p.tier === tier)!.card.filter((id) => id.startsWith('services-'))).toEqual([`services-${tier}`])
    }
  })
})
