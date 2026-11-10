/**
 * Trial PR: the Billing page renders only the server's billing summary --
 * stored plan, subscription state, trial, usage and limit, and what it may
 * offer -- and never a made-up number. Approved copy only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import type { Subscription } from '@/types/billing'

const h = vi.hoisted(() => ({
  subscription: null as unknown,
  apiGet: vi.fn(),
  isAdmin: true,
}))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }), usePathname: () => '/settings/billing' }))
vi.mock('@/lib/services/stripe.service', () => ({
  getSubscription: vi.fn(async () => ({ success: true, data: h.subscription })),
  getInvoices: vi.fn(async () => ({ success: true, data: [] })),
  openCustomerPortal: vi.fn(),
  resumeSubscription: vi.fn(),
  cancelSubscription: vi.fn(),
}))
vi.mock('@/lib/api', () => ({ api: { get: (...args: unknown[]) => h.apiGet(...args) } }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useIsBillingAdmin: () => h.isAdmin }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import BillingPage from '../page'

const TRIAL_END = Math.floor(new Date('2026-11-23T12:00:00Z').getTime() / 1000)

function summary(overrides: Partial<Subscription> = {}): Subscription {
  return {
    tier: 'free',
    status: null,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
    cancelAt: null,
    billingLifecycleState: 'healthy',
    isRestricted: false,
    plan: { storedTier: 'free', effectiveTier: 'free', entitlementHold: null, source: 'none', isTopPlan: false },
    subscription: null,
    trial: { used: false, active: false, endsAt: null, eligible: false },
    usage: { awsResources: { used: 7, limit: 20 } },
    actions: { selfServe: 'checkout', showUpgrade: true, manageSubscription: false },
    ...overrides,
  }
}

const managedEnterprise = () => summary({
  tier: 'enterprise',
  plan: { storedTier: 'enterprise', effectiveTier: 'enterprise', entitlementHold: null, source: 'managed', isTopPlan: true },
  usage: { awsResources: { used: 0, limit: null } },
  actions: { selfServe: 'none', showUpgrade: false, manageSubscription: false },
})

async function renderPage(data: Subscription) {
  h.subscription = data
  const view = render(<BillingPage />)
  await waitFor(() => expect(screen.queryByText('Loading billing information...')).not.toBeInTheDocument())
  await waitFor(() => expect(h.apiGet).toHaveBeenCalled())
  return view
}

beforeEach(() => {
  vi.clearAllMocks()
  h.isAdmin = true
  h.apiGet.mockResolvedValue({ data: { data: { requestsThisHour: 12, limit: 500 } } })
})

describe('Billing page', () => {
  it('the founder\'s case: a Revenue Protection workspace our team manages -- its plan, Managed, no Free, no 0 / 20, no upgrade', async () => {
    const { container } = await renderPage(managedEnterprise())
    const text = container.textContent ?? ''
    expect(text).toContain('Revenue Protection')
    expect(text).toContain('Managed by our team')
    expect(text).toContain('Your plan is set up and billed by our team. Contact us to make changes.')
    expect(screen.getByRole('link', { name: 'Contact us' })).toHaveAttribute('href', '/contact')
    expect(text).toContain('0 · Unlimited')
    expect(text).not.toMatch(/Free|0 \/ 20|Upgrade Plan|Want more resources|Cancel Subscription|Manage Billing/)
  })

  it('a hand-provisioned Optimization Engine workspace: no upgrade, no Checkout prompt, its real limit', async () => {
    const { container } = await renderPage(summary({
      tier: 'pro',
      plan: { storedTier: 'pro', effectiveTier: 'pro', entitlementHold: null, source: 'managed', isTopPlan: false },
      usage: { awsResources: { used: 450, limit: 500 } },
      actions: { selfServe: 'none', showUpgrade: false, manageSubscription: false },
    }))
    const text = container.textContent ?? ''
    expect(text).toContain('450 / 500')
    expect(text).not.toMatch(/Upgrade Plan|Want more resources|Consider upgrading/)
  })

  it('free: real usage against the real limit, Upgrade Plan and the free upsell', async () => {
    const { container } = await renderPage(summary())
    const text = container.textContent ?? ''
    expect(text).toContain('7 / 20')
    expect(text).toContain('12 / 500')
    expect(screen.getByRole('button', { name: /Upgrade Plan/ })).toBeInTheDocument()
    expect(text).toContain('Want more resources?')
    expect(text).not.toMatch(/Cancel Subscription|Manage Billing/)
  })

  it('S5a/S5c: usage that cannot be read says so, never 0 / 20', async () => {
    h.apiGet.mockRejectedValue(new Error('500'))
    const { container } = await renderPage(summary({ usage: { awsResources: null } }))
    const text = container.textContent ?? ''
    expect(screen.getByText('Usage')).toBeInTheDocument()
    expect(text).not.toContain('Usage This Month')
    expect(screen.getAllByText('Usage unavailable right now.')).toHaveLength(2)
    expect(text).not.toMatch(/0 \/ 20|0 \/ 500/)
  })

  it('trialing: the trial date, cancel and Manage Billing for an admin, Upgrade Plan still offered below the top plan', async () => {
    const { container } = await renderPage(summary({
      tier: 'starter',
      status: 'trialing',
      currentPeriodEnd: TRIAL_END,
      plan: { storedTier: 'starter', effectiveTier: 'starter', entitlementHold: null, source: 'subscription', isTopPlan: false },
      subscription: { status: 'trialing', currentPeriodEnd: TRIAL_END, cancelAtPeriodEnd: false, cancelAt: null, price: { amount: 4900, currency: 'usd', interval: 'month' } },
      trial: { used: true, active: true, endsAt: TRIAL_END, eligible: false },
      usage: { awsResources: { used: 3, limit: 60 } },
      actions: { selfServe: 'change_plan', showUpgrade: true, manageSubscription: true },
    }))
    const text = container.textContent ?? ''
    expect(text).toContain('Trial ends on November 23, 2026. Your card on file will be charged then unless you cancel.')
    expect(text).toContain('Cost Control')
    expect(text).toContain('3 / 60')
    expect(screen.getByRole('button', { name: 'Cancel Subscription' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Upgrade Plan/ })).toBeInTheDocument()
  })

  it('Revenue Protection with a subscription: managed in the portal, but no Upgrade Plan', async () => {
    const { container } = await renderPage(summary({
      tier: 'enterprise',
      status: 'active',
      plan: { storedTier: 'enterprise', effectiveTier: 'enterprise', entitlementHold: null, source: 'subscription', isTopPlan: true },
      subscription: { status: 'active', currentPeriodEnd: TRIAL_END, cancelAtPeriodEnd: false, cancelAt: null, price: null },
      usage: { awsResources: { used: 900, limit: null } },
      actions: { selfServe: 'none', showUpgrade: false, manageSubscription: true },
    }))
    expect(screen.getByRole('button', { name: /Manage Billing/ })).toBeInTheDocument()
    expect(container.textContent).not.toContain('Upgrade Plan')
    expect(container.textContent).toContain('900 · Unlimited')
  })

  it('payment hold: the restricted banner from the server\'s decision, and the free limits', async () => {
    const { container } = await renderPage(summary({
      tier: 'pro',
      status: 'past_due',
      plan: { storedTier: 'pro', effectiveTier: 'free', entitlementHold: 'payment', source: 'subscription', isTopPlan: false },
      subscription: { status: 'past_due', currentPeriodEnd: TRIAL_END, cancelAtPeriodEnd: false, cancelAt: null, price: null },
      usage: { awsResources: { used: 25, limit: 20 } },
      actions: { selfServe: 'change_plan', showUpgrade: true, manageSubscription: true },
    }))
    expect(container.textContent).toContain('Access restricted due to a payment issue.')
    expect(container.textContent).toContain('25 / 20')
  })

  it('a member sees the plan and usage but not the billing controls', async () => {
    h.isAdmin = false
    await renderPage(summary({
      tier: 'pro',
      status: 'active',
      plan: { storedTier: 'pro', effectiveTier: 'pro', entitlementHold: null, source: 'subscription', isTopPlan: false },
      subscription: { status: 'active', currentPeriodEnd: TRIAL_END, cancelAtPeriodEnd: false, cancelAt: null, price: null },
      actions: { selfServe: 'change_plan', showUpgrade: true, manageSubscription: true },
    }))
    expect(screen.queryByRole('button', { name: 'Cancel Subscription' })).not.toBeInTheDocument()
    expect(screen.getByText('Only organization owners and admins can cancel, resume, or manage billing.')).toBeInTheDocument()
  })
})
