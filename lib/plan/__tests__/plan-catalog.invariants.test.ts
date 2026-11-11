/**
 * The plan catalog's own rules: badges match statuses, built lines sit at the
 * plan the server gates them on, prices and annual figures are computed from
 * the real Stripe amounts ($49/$199 monthly, $490/$1,990 annual), and the
 * server's plan names equal the UI's.
 */
import { describe, it, expect } from 'vitest'
import {
  FEATURES, PLANS, TIERS, VALUE_ROWS, TEASER, ENTERPRISE_PAGE, UPGRADE_MODAL, MID_MARKET,
  annual, annualToggleLabel, annualBillingLine, priceLabel, includesPrevious, cardFeatures, comparisonGroups,
  FOUNDING_OFFER_VISIBLE, feature,
} from '../plan-catalog'
import { PLAN_ENTITLEMENTS } from '../entitlements'
import { PLAN_NAME } from '../plan-names'
import { PLAN_NAME as SERVER_PLAN_NAME } from '../../../backend/src/config/plan-names'

describe('statuses and badges', () => {
  it('"Coming soon" exactly on the features that are not built', () => {
    for (const f of FEATURES) {
      expect(f.status === 'coming_soon', f.id).toBe(f.badge === 'Coming soon')
    }
  })

  it('"Beta" only for resource efficiency and remediation (Pricing Mock)', () => {
    expect(FEATURES.filter((f) => f.badge === 'Beta').map((f) => f.id).sort()).toEqual(['efficiency', 'remediation'])
  })

  it('service promises (claims) are only support lines and custom integrations', () => {
    expect(FEATURES.filter((f) => f.status === 'claim').map((f) => f.id).sort()).toEqual(
      ['custom-integrations', 'support-enterprise', 'support-free', 'support-pro', 'support-starter'],
    )
  })

  it('ids and labels are unique, and no label carries its own badge text', () => {
    expect(new Set(FEATURES.map((f) => f.id)).size).toBe(FEATURES.length)
    expect(new Set(FEATURES.map((f) => f.label)).size).toBe(FEATURES.length)
    for (const f of FEATURES) expect(f.label, f.id).not.toMatch(/\(Coming soon\)$|— Coming soon$|\(Beta\)$|✨/)
  })

  it('every feature has evidence', () => {
    for (const f of FEATURES) expect(f.evidence.length, f.id).toBeGreaterThan(5)
  })
})

describe('built lines sit at their server gate', () => {
  it('entitlement-backed lines equal PLAN_ENTITLEMENTS (= the server table)', () => {
    const withEntitlement = FEATURES.filter((f) => f.entitlement)
    expect(withEntitlement.length).toBeGreaterThanOrEqual(6)
    for (const f of withEntitlement) expect(f.tier, f.id).toBe(PLAN_ENTITLEMENTS[f.entitlement!])
  })

  // Explicit requireTier/requirePro/requireEnterprise gates (not in PLAN_ENTITLEMENTS; catalog-step1 §1.5).
  it.each([
    ['ai-chat', 'pro'], ['nl-search', 'pro'], ['ai-reports', 'pro'], ['forecast', 'pro'],
    ['sso', 'enterprise'], ['slo', 'enterprise'], ['remediation', 'enterprise'], ['scheduled-reports', 'enterprise'],
    ['soc2-evidence', 'enterprise'], ['optimization-rules', 'enterprise'], ['idle-orphaned', 'starter'],
  ])('%s is listed on %s', (id, tier) => {
    expect(feature(id).tier).toBe(tier)
  })

  it('Pricing Mock placements: team cost attribution on Optimization Engine, scheduled AI reports on Revenue Protection', () => {
    expect(feature('team-attribution').tier).toBe('pro')
    expect(feature('scheduled-ai-reports').tier).toBe('enterprise')
    expect(feature('dora-benchmarks').tier).toBe('enterprise')
  })
})

describe('plans and cards', () => {
  it('four plans, in order, with the customer names', () => {
    expect(PLANS.map((p) => p.tier)).toEqual([...TIERS])
    expect(PLANS.map((p) => p.name)).toEqual(['Visibility', 'Cost Control', 'Optimization Engine', 'Revenue Protection'])
  })

  it('the server uses the same plan names', () => {
    expect(SERVER_PLAN_NAME).toEqual(PLAN_NAME)
  })

  it('every card line is a catalog feature of that plan', () => {
    for (const p of PLANS) {
      for (const f of cardFeatures(p.tier)) expect(f.tier, `${p.tier}: ${f.id}`).toBe(p.tier)
    }
  })

  it('every feature is on a card or in the comparison table', () => {
    const tableIds = new Set(comparisonGroups().flatMap((g) => g.rows.map((r) => (r.kind === 'feature' ? r.feature.id : r.row.id))))
    const cardIds = new Set(PLANS.flatMap((p) => p.card))
    for (const f of FEATURES) expect(tableIds.has(f.id) || cardIds.has(f.id), f.id).toBe(true)
    for (const r of VALUE_ROWS) expect(tableIds.has(r.id), r.id).toBe(true)
  })

  it('curated subsets use catalog ids only', () => {
    for (const ids of [...Object.values(TEASER), ...Object.values(ENTERPRISE_PAGE), ...Object.values(UPGRADE_MODAL), MID_MARKET]) {
      for (const id of ids) expect(() => feature(id)).not.toThrow()
    }
  })

  it('"Everything in {previous plan}, plus:"', () => {
    expect(TIERS.map(includesPrevious)).toEqual([null, 'Visibility', 'Cost Control', 'Optimization Engine'])
  })
})

describe('prices are computed from the real amounts (C1-D1)', () => {
  it('monthly and annual-per-month prices', () => {
    expect(TIERS.map((t) => priceLabel(t, 'monthly'))).toEqual(['$0', '$49', '$199', 'Custom'])
    expect(TIERS.map((t) => priceLabel(t, 'annual'))).toEqual(['$0', '$41', '$166', 'Custom'])
  })

  it('annual saving = 12 × monthly − annual total; "2 months free"', () => {
    expect(annual('starter')).toEqual({ perMonth: 41, total: 490, savingPerYear: 98, monthsFree: 2 })
    expect(annual('pro')).toEqual({ perMonth: 166, total: 1990, savingPerYear: 398, monthsFree: 2 })
    expect(annual('free')).toBeNull()
    expect(annual('enterprise')).toBeNull()
    expect(annualToggleLabel()).toBe('2 months free')
    expect(annualBillingLine('starter')).toBe('$490 billed yearly · save $98/year')
    expect(annualBillingLine('pro')).toBe('$1,990 billed yearly · save $398/year')
  })
})

describe('founding-member offer', () => {
  it('is hidden on every surface until prices and Stripe billing rules are final (C1-D9)', () => {
    expect(FOUNDING_OFFER_VISIBLE).toBe(false)
  })
})
