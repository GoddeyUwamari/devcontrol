/**
 * Trial PR: the trial lines on the Checkout-cancel page (S9) and the success
 * page date (S10) follow the server's billing summary only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ result: null as unknown }))

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => ({ get: () => 'cs_test_session' }),
}))
vi.mock('@/lib/services/stripe.service', () => ({ getSubscription: vi.fn(async () => h.result) }))
vi.mock('@/lib/gtag', () => ({ trackPurchase: vi.fn(), trackLeadConverted: vi.fn() }))

import CheckoutCancelPage from '../cancel/page'

const eligible = (value: boolean) => ({ success: true, data: { tier: 'free', status: null, cancelAtPeriodEnd: false, trial: { used: false, active: false, endsAt: null, eligible: value } } })

beforeEach(() => vi.clearAllMocks())

describe('Checkout cancel page', () => {
  it('trial switch off (not eligible): no trial line at all, and never "no credit card required"', async () => {
    h.result = eligible(false)
    const { container } = render(<CheckoutCancelPage />)
    await waitFor(() => expect(screen.getByText('Cancel anytime, no long-term contracts')).toBeInTheDocument())
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container.textContent).not.toMatch(/trial|credit card/i)
  })

  it('summary unreadable: no trial line', async () => {
    h.result = { success: false, error: 'x' }
    const { container } = render(<CheckoutCancelPage />)
    await new Promise(resolve => setTimeout(resolve, 0))
    expect(container.textContent).not.toMatch(/trial/i)
  })

  it('S9: offered (switch on, eligible): exactly the two approved lines', async () => {
    h.result = eligible(true)
    render(<CheckoutCancelPage />)
    expect(await screen.findByText('14-day free trial on Cost Control and Optimization Engine (card required)')).toBeInTheDocument()
    expect(screen.getByText("Full access to your plan's features during the trial")).toBeInTheDocument()
    expect(screen.queryByText(/no credit card/i)).not.toBeInTheDocument()
  })
})
