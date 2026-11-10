/**
 * Trial PR: the upgrade page offers the trial line (S8) only when the server
 * says the organization is eligible, only on Cost Control and Optimization
 * Engine, and decides Checkout vs change-plan from the server's actions.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, fireEvent } from '@testing-library/react'

const h = vi.hoisted(() => ({ data: null as unknown, checkout: vi.fn(), change: vi.fn() }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/services/stripe.service', () => ({
  getSubscription: vi.fn(async () => ({ success: true, data: h.data })),
  createCheckoutSession: (...args: unknown[]) => h.checkout(...args),
  changePlan: (...args: unknown[]) => h.change(...args),
}))
vi.mock('@/lib/hooks/use-current-role', () => ({ useIsBillingAdmin: () => true }))
vi.mock('@/lib/gtag', () => ({ trackLeadQualified: vi.fn() }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))

import UpgradePage from '../upgrade/page'

const S8 = "14-day free trial. Card required; you're charged when the trial ends unless you cancel."

const data = (eligible: boolean, selfServe: 'checkout' | 'change_plan' | 'none' = 'checkout', tier = 'free') => ({
  tier, status: null, cancelAtPeriodEnd: false,
  trial: { used: false, active: false, endsAt: null, eligible },
  actions: { selfServe, showUpgrade: true, manageSubscription: selfServe === 'change_plan' },
})

beforeEach(() => {
  vi.clearAllMocks()
  h.checkout.mockResolvedValue({ success: false, error: 'x' })
  h.change.mockResolvedValue({ success: false, error: 'x' })
})

describe('upgrade page', () => {
  it('S8 under Cost Control and Optimization Engine only, when the server offers the trial', async () => {
    h.data = data(true)
    render(<UpgradePage />)
    await waitFor(() => expect(screen.getAllByText(S8)).toHaveLength(2))
  })

  it('no S8 when the server does not offer the trial (switch off or ineligible)', async () => {
    h.data = data(false)
    render(<UpgradePage />)
    await waitFor(() => expect(screen.getAllByText('Upgrade Now').length).toBeGreaterThan(0))
    expect(screen.queryByText(S8)).not.toBeInTheDocument()
  })

  it('Checkout vs change-plan is the server\'s decision (a recorded subscription changes in place)', async () => {
    h.data = data(false, 'change_plan', 'starter')
    render(<UpgradePage />)
    const button = await screen.findByText('Upgrade Now')
    fireEvent.click(button)
    await waitFor(() => expect(h.change).toHaveBeenCalled())
    expect(h.checkout).not.toHaveBeenCalled()
  })
})
