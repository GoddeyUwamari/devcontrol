/**
 * /tenants when the server refuses for the plan although the client thinks
 * Enterprise (a restricted or changed plan): the page's own gate naming the
 * plan from details.requiredTier, with "See plans" to the upgrade page --
 * never "status code 402", a generic error, or an empty list. Any other
 * failure keeps the error state.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, screen } from '@testing-library/react'
import { api } from '@/lib/api'
import { renderWithKnownPlan } from '@/lib/contexts/__tests__/org-load-harness'
import { axiosError, resourceLimitBody, tierRequiredBody } from '@/lib/plan/__tests__/tier-required-fixture'
import { toast } from 'sonner'
import TenantsPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/tenants',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let getCalls = 0
function stubGet(impl: () => Promise<unknown>) {
  getCalls = 0
  vi.spyOn(api, 'get').mockImplementation(async () => {
    getCalls += 1
    return impl() as never
  })
}

const expectPlanGate = (planName: string) => {
  expect(screen.getByRole('heading', { level: 1, name: 'Tenant Intelligence' })).toBeTruthy()
  expect(screen.getByText(`This feature is on the ${planName} plan.`)).toBeTruthy()
  const link = screen.getByRole('link', { name: 'See plans' })
  expect(link.getAttribute('href')).toBe('/settings/billing/upgrade')
  expect(screen.queryByText(/status code 402/)).toBeNull()
  expect(screen.queryByText('Retry')).toBeNull()
  expect(screen.queryByText('No tenants added yet')).toBeNull()
  expect(screen.queryByText('Add Your First Tenant')).toBeNull()
}

describe('/tenants: the server requires a higher plan', () => {
  beforeEach(() => {
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    vi.spyOn(console, 'error').mockImplementation(() => {})
  })
  afterEach(() => vi.restoreAllMocks())

  it('GET 402 TIER_REQUIRED → the gate naming the required plan, linking to the upgrade page (not upgrade.url)', async () => {
    stubGet(() => Promise.reject(axiosError(402, tierRequiredBody('enterprise', '/settings/billing?upgrade=starter'))))
    await renderWithKnownPlan(<TenantsPage />, 'enterprise')
    await screen.findByText('This feature is on the Revenue Protection plan.')
    expectPlanGate('Revenue Protection')
    expect(getCalls).toBe(1)
  })

  it('names the plan the server asked for', async () => {
    stubGet(() => Promise.reject(axiosError(402, tierRequiredBody('pro'))))
    await renderWithKnownPlan(<TenantsPage />, 'enterprise')
    await screen.findByText('This feature is on the Optimization Engine plan.')
    expectPlanGate('Optimization Engine')
  })

  it.each([
    ['another 402', axiosError(402, resourceLimitBody())],
    ['a TIER_REQUIRED body with an unknown plan', axiosError(402, tierRequiredBody('platinum'))],
    ['a 500', axiosError(500, { success: false, error: 'Failed to load tenants' })],
  ])('%s keeps the error state, never the gate', async (_label, err) => {
    stubGet(() => Promise.reject(err))
    await renderWithKnownPlan(<TenantsPage />, 'enterprise')
    expect(await screen.findByText('Retry')).toBeTruthy()
    expect(screen.queryByText(/This feature is on/)).toBeNull()
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
  })

  it('adding a tenant refused for the plan → the gate, not the "Failed to add tenant" toast', async () => {
    stubGet(() => Promise.resolve({ data: { success: true, data: [] } }))
    vi.spyOn(api, 'post').mockRejectedValue(axiosError(402, tierRequiredBody('enterprise')))
    await renderWithKnownPlan(<TenantsPage />, 'enterprise')
    fireEvent.click((await screen.findAllByRole('button', { name: /Add Your First Tenant/ }))[0])
    fireEvent.change(screen.getByPlaceholderText('Acme Corporation'), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByPlaceholderText('admin@company.com'), { target: { value: 'a@acme.test' } })
    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText('admin@company.com').closest('form')!)
    })
    await screen.findByText('This feature is on the Revenue Protection plan.')
    expectPlanGate('Revenue Protection')
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('adding a tenant failing otherwise → the toast, no gate', async () => {
    stubGet(() => Promise.resolve({ data: { success: true, data: [] } }))
    vi.spyOn(api, 'post').mockRejectedValue(axiosError(500, { success: false }))
    await renderWithKnownPlan(<TenantsPage />, 'enterprise')
    fireEvent.click((await screen.findAllByRole('button', { name: /Add Your First Tenant/ }))[0])
    fireEvent.change(screen.getByPlaceholderText('Acme Corporation'), { target: { value: 'Acme' } })
    fireEvent.change(screen.getByPlaceholderText('admin@company.com'), { target: { value: 'a@acme.test' } })
    await act(async () => {
      fireEvent.submit(screen.getByPlaceholderText('admin@company.com').closest('form')!)
    })
    expect(toast.error).toHaveBeenCalledWith('Failed to add tenant')
    expect(screen.queryByText(/This feature is on/)).toBeNull()
  })
})

describe('/tenants gate copy (client gate, known non-Enterprise plan)', () => {
  afterEach(() => vi.restoreAllMocks())

  it('is titled Tenant Intelligence and describes tenants, not AWS accounts', async () => {
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    stubGet(() => Promise.resolve({ data: { success: true, data: [] } }))
    await renderWithKnownPlan(<TenantsPage />, 'pro')
    expect(await screen.findByRole('heading', { level: 1, name: 'Tenant Intelligence' })).toBeTruthy()
    expect(screen.getByText('Enterprise Feature')).toBeTruthy()
    expect(screen.getByText(
      'Tenant Intelligence is available on the Enterprise plan. Track tenant health, churn risk, and expansion signals across your tenants.'
    )).toBeTruthy()
    expect(screen.getByRole('link', { name: 'Upgrade to Enterprise' }).getAttribute('href')).toBe('/settings/billing/upgrade')
    expect(screen.queryByText(/Multi-Account Monitoring/i)).toBeNull()
    expect(screen.queryByText(/accounts/i)).toBeNull()
    expect(getCalls).toBe(0)
  })
})
