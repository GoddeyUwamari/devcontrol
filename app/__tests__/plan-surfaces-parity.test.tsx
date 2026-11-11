/**
 * Every plan list renders the catalog, so the surfaces can't drift (CAT-1):
 * the pricing cards and the in-app upgrade page show the same lines, in the
 * same order, with the same names and the same computed prices; the
 * comparison table shows every catalog row; the homepage teaser, the
 * /enterprise cards, the mid-market card and the team-limit upgrade modal show
 * their curated catalog subsets verbatim. No surface has free-text plan lines.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'

const push = vi.fn()
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push, replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn(), info: vi.fn() } }))
vi.mock('@/lib/gtag', () => ({ trackLeadQualified: vi.fn() }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useIsBillingAdmin: () => true, useCurrentRole: () => 'owner' }))
vi.mock('@/lib/services/stripe.service', () => ({
  getSubscription: vi.fn(async () => ({ success: true, data: { tier: 'free', actions: { selfServe: 'checkout' }, trial: { eligible: false } } })),
  createCheckoutSession: vi.fn(),
  changePlan: vi.fn(),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' }, user: { id: 'u1' } }) }))
const planState = vi.hoisted(() => ({ tier: 'free' as string }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ tier: planState.tier, isEnterprise: planState.tier === 'enterprise', isPro: planState.tier === 'pro' || planState.tier === 'enterprise' }),
}))
vi.mock('@/lib/services/subscriptions.service', () => ({ subscriptionsService: { getAll: vi.fn(async () => []) } }))
vi.mock('@/lib/services/organizations.service', () => ({ organizationsService: { getMembers: vi.fn(async () => []), inviteMember: vi.fn() } }))
vi.mock('@/lib/services/invoices.service', () => ({ invoicesService: { getAll: vi.fn(async () => []) } }))

import PricingPage from '@/app/(marketing)/pricing/page'
import UpgradePage from '@/app/(app)/settings/billing/upgrade/page'
import EnterprisePage from '@/app/(app)/enterprise/page'
import MidMarketPage from '@/app/(marketing)/solutions/mid-market/page'
import { PricingPreview } from '@/components/landing/PricingPreview'
import { UpgradeModal } from '@/components/billing/upgrade-modal'
import {
  PLANS, FEATURES, VALUE_ROWS, TEASER, ENTERPRISE_PAGE, UPGRADE_MODAL, MID_MARKET, feature, annualBillingLine, priceLabel,
} from '@/lib/plan/plan-catalog'
import { resetBillingOfferForTests } from '@/lib/billing/offer'

globalThis.ResizeObserver ??= class {
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver

function withQuery(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>
}

/** Feature ids rendered inside `root`, in order, after checking each label is the catalog's. */
function renderedIds(root: ParentNode): string[] {
  return [...root.querySelectorAll('[data-feature-id]')].map((el) => {
    const id = el.getAttribute('data-feature-id')!
    expect(el.querySelector('[data-feature-label]')?.textContent, id).toBe(feature(id).label)
    return id
  })
}

beforeEach(() => {
  resetBillingOfferForTests()
  planState.tier = 'free'
  vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
    new Response(JSON.stringify({ trial: { enabled: false } }), { headers: { 'Content-Type': 'application/json' } }))
})
afterEach(() => vi.restoreAllMocks())

describe('pricing cards (M) and in-app upgrade page (U)', () => {
  it('M: every card is its catalog card, in order, with the catalog name and price', () => {
    const { container } = render(<PricingPage />)
    for (const p of PLANS) {
      const card = container.querySelector(`div[data-plan="${p.tier}"]`) as HTMLElement
      expect(card, p.tier).not.toBeNull()
      expect(card.textContent).toContain(p.name)
      expect(card.textContent).toContain(priceLabel(p.tier, 'monthly'))
      expect(renderedIds(card)).toEqual([...p.card])
    }
  })

  it('U shows exactly the M lines of each paid plan, and the same annual figures', async () => {
    const pricing = render(<PricingPage />)
    fireEvent.click(within(pricing.container).getByRole('button', { name: /^Annual/ }))
    const mText = pricing.container.textContent ?? ''
    const mIds = PLANS.filter((p) => p.tier !== 'free').map((p) =>
      renderedIds(pricing.container.querySelector(`div[data-plan="${p.tier}"]`)!))
    pricing.unmount()

    const { container } = render(<UpgradePage />)
    await screen.findByRole('heading', { name: 'Cost Control' })
    const uIds = renderedIds(container)
    expect(uIds).toEqual(mIds.flat())

    fireEvent.click(screen.getByRole('button', { name: /^Annual/ }))
    for (const tier of ['starter', 'pro'] as const) {
      const line = annualBillingLine(tier)!
      expect(mText).toContain(line)
      expect(container.textContent).toContain(line)
    }
    expect(mText).toContain('2 months free')
    expect(container.textContent).toContain('2 months free')
  })
})

describe('comparison table (T)', () => {
  it('shows every catalog row (value rows and table features) and every plan name', () => {
    const { container } = render(<PricingPage />)
    const table = container.querySelector('table')!
    const rowIds = [...table.querySelectorAll('tr[data-row]')].map((r) => r.getAttribute('data-row'))
    const expected = [...VALUE_ROWS.map((r) => r.id), ...FEATURES.filter((f) => f.table !== false).map((f) => f.id)]
    expect([...rowIds].sort()).toEqual([...expected].sort())
    const headers = [...table.querySelectorAll('th[data-plan]')].map((th) => th.textContent ?? '')
    PLANS.forEach((p, i) => expect(headers[i]).toContain(p.name))
  })

  it('a feature that is not built shows "Soon", never a check mark', () => {
    const { container } = render(<PricingPage />)
    const row = container.querySelector('tr[data-row="rightsizing"]')!
    const cells = [...row.querySelectorAll('td')].slice(1)
    expect(cells.map((c) => c.textContent)).toEqual(['', '', 'Soon', 'Soon'])
  })
})

describe('curated subsets', () => {
  it('homepage teaser (L)', () => {
    const { container } = render(<PricingPreview />)
    expect(renderedIds(container)).toEqual(PLANS.flatMap((p) => [...TEASER[p.tier]]))
    for (const p of PLANS) expect(container.textContent).toContain(p.name)
  })

  it('/enterprise plan cards (E), for a free organization', async () => {
    planState.tier = 'free'
    const { container } = render(withQuery(<EnterprisePage />))
    await waitFor(() => expect(container.textContent).toContain('Visibility'))
    expect(renderedIds(container)).toEqual([...ENTERPRISE_PAGE.pro, ...ENTERPRISE_PAGE.enterprise])
    expect(container.textContent).toContain(ENTERPRISE_PAGE.free.map((id) => feature(id).label).join(' · '))
  })

  it('mid-market plan card', () => {
    const { container } = render(<MidMarketPage />)
    expect(renderedIds(container)).toEqual([...MID_MARKET])
    expect(container.textContent).toContain('Optimization Engine')
    expect(container.textContent).not.toContain('Growth Plan')
  })

  it.each(['starter', 'pro', 'enterprise'] as const)('team-limit upgrade modal: %s', (tier) => {
    render(<UpgradeModal open onOpenChange={() => {}} currentTier="free" requiredTier={tier} currentLimit={1} nextLimit={5} resourceType="team members" />)
    const dialog = screen.getByRole('dialog')
    expect(renderedIds(dialog)).toEqual([...UPGRADE_MODAL[tier]])
    const name = PLANS.find((p) => p.tier === tier)!.name
    expect(dialog.textContent).toContain(`What you get on ${name}:`)
    fireEvent.click(within(dialog).getByRole('button', { name: `Upgrade to ${name}` }))
    expect(push).toHaveBeenCalledWith('/settings/billing/upgrade')
  })
})
