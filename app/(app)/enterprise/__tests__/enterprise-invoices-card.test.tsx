/**
 * CAT-3 (§4.3, C3-D10, C3-D11): the /enterprise "Invoices & Billing" card names
 * the real plan (Cost Control was told "Free plan"), says where invoices are
 * (its own /api/billing/invoices request has no backend route), and links to
 * the Billing page that exists.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const push = vi.fn()
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-1' }, user: { id: 'u1' } }) }))
const plan = vi.hoisted(() => ({ tier: 'starter' as string }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ tier: plan.tier, isEnterprise: plan.tier === 'enterprise', isPro: plan.tier === 'pro' || plan.tier === 'enterprise' }),
}))
vi.mock('@/lib/services/subscriptions.service', () => ({ subscriptionsService: { getAll: vi.fn(async () => []) } }))
vi.mock('@/lib/services/organizations.service', () => ({ organizationsService: { getMembers: vi.fn(async () => []), inviteMember: vi.fn() } }))
vi.mock('@/lib/services/invoices.service', () => ({ invoicesService: { getAll: vi.fn(async () => { throw new Error('HTTP 404') }) } }))

import EnterprisePage from '../page'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><EnterprisePage /></QueryClientProvider>)
}
const card = () => screen.getByText('Invoices & Billing').parentElement as HTMLElement

beforeEach(() => {
  vi.clearAllMocks()
  plan.tier = 'starter'
})

describe('/enterprise Invoices & Billing card', () => {
  it.each([['starter', 'Cost Control'], ['pro', 'Optimization Engine'], ['enterprise', 'Revenue Protection']])(
    '%s: shows the plan name %s and where invoices are, never "Free plan"',
    (tier, name) => {
      plan.tier = tier
      renderPage()
      expect(card().textContent).toContain(`Your plan: ${name}`)
      expect(card().textContent).toContain('Self-serve plans: your invoices are under Manage Billing on the Billing page. Plans billed by our team: invoices come from us by email.')
      expect(card().textContent).not.toMatch(/free plan|\$0|Upgrade to Pro|Your next invoice|Your plan: (Starter|Pro|Enterprise)\b/i)
    },
  )

  it('free: no invoices, and they appear on the Billing page after a first payment', () => {
    plan.tier = 'free'
    renderPage()
    expect(card().textContent).toContain("You're on the free plan, so there are no invoices.")
    expect(card().textContent).toContain('Invoices appear on the Billing page after your first payment on a paid plan.')
    expect(card().textContent).not.toMatch(/Upgrade to Pro|Your next invoice/)
  })

  it('"View billing details →" goes to /settings/billing, not the missing /billing', () => {
    renderPage()
    fireEvent.click(screen.getByRole('button', { name: 'View billing details →' }))
    expect(push).toHaveBeenCalledWith('/settings/billing')
    expect(push).not.toHaveBeenCalledWith('/billing')
  })
})
