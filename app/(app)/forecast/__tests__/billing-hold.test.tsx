/**
 * Billing safety PR B (B4), the shared 402 TIER_REQUIRED handling on a real
 * page: when the server's refusal carries details.reason, /forecast says the
 * feature is paused for billing (the approved copy) with Go to billing for an
 * owner or admin and the ask-an-admin sentence for everyone else; without a
 * reason it names the plan, as before. Real AuthProvider; fetch stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen } from '@testing-library/react'
import { renderWithKnownPlan } from '@/lib/contexts/__tests__/org-load-harness'
import { tierRequiredBody } from '@/lib/plan/__tests__/tier-required-fixture'
import { tokenManager } from '@/lib/services/auth.service'
import ForecastPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/forecast',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

const PAYMENT =
  'This feature is paused because of a payment issue. Your Optimization Engine plan is unchanged — update your payment details to restore access.'
const INACTIVE =
  "This feature is paused because your Optimization Engine subscription isn't active. Go to billing to complete or resume it."
const ASK = 'Ask an organization owner or admin to update billing.'

function refuse(reason?: string) {
  const body = tierRequiredBody('pro')
  const payload = reason ? { ...body, details: { ...body.details, currentTier: 'free', reason } } : body
  vi.stubGlobal('fetch', vi.fn(async (url: string) =>
    String(url).includes('/api/forecast')
      ? new Response(JSON.stringify(payload), { status: 402, headers: { 'Content-Type': 'application/json' } })
      : new Response('{}', { status: 404 })
  ))
}

beforeEach(() => {
  localStorage.clear()
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'error').mockImplementation(() => {})
})
afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('/forecast: a 402 with a billing reason', () => {
  it.each([
    ['BILLING_RESTRICTED', PAYMENT],
    ['SUBSCRIPTION_INACTIVE', INACTIVE],
  ])('%s, admin: the approved sentence and Go to billing', async (reason, text) => {
    vi.spyOn(tokenManager, 'getCurrentRole').mockReturnValue('admin')
    refuse(reason)
    await renderWithKnownPlan(<ForecastPage />, 'pro')
    expect(await screen.findByText(text)).toBeTruthy()
    const link = screen.getByRole('link', { name: 'Go to billing' })
    expect(link.getAttribute('href')).toBe('/settings/billing')
    expect(screen.queryByText(ASK)).toBeNull()
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
  })

  it.each([
    ['BILLING_RESTRICTED', PAYMENT],
    ['SUBSCRIPTION_INACTIVE', INACTIVE],
  ])('%s, member: the approved sentence and the ask-an-admin sentence, no link', async (reason, text) => {
    vi.spyOn(tokenManager, 'getCurrentRole').mockReturnValue('member')
    refuse(reason)
    await renderWithKnownPlan(<ForecastPage />, 'pro')
    expect(await screen.findByText(text)).toBeTruthy()
    expect(screen.getByText(ASK)).toBeTruthy()
    expect(screen.queryByRole('link', { name: 'Go to billing' })).toBeNull()
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
  })

  it('no reason: the plan sentence and See plans, for an admin too', async () => {
    vi.spyOn(tokenManager, 'getCurrentRole').mockReturnValue('admin')
    refuse()
    await renderWithKnownPlan(<ForecastPage />, 'pro')
    expect(await screen.findByText('This feature is on the Optimization Engine plan.')).toBeTruthy()
    expect(screen.getByRole('link', { name: 'See plans' })).toBeTruthy()
    expect(screen.queryByText(/paused/)).toBeNull()
  })
})
