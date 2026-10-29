/**
 * /tenants waits for a known plan: a skeleton while the organization loads,
 * "Couldn't load your workspace" if it can't, the Enterprise gate only for a
 * known non-Enterprise plan, and GET /api/tenants only for a known
 * Enterprise plan.
 */
import { describe, it, expect, vi } from 'vitest'
import { screen } from '@testing-library/react'
import { api } from '@/lib/api'
import {
  describePlanStates, fakeOrgSources, flush, org, renderWithAuth, seedSession,
} from '@/lib/contexts/__tests__/org-load-harness'
import TenantsPage from '../page'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), prefetch: vi.fn() }),
  usePathname: () => '/tenants',
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

let tenantCalls: unknown[] = []
function stubTenantsApi() {
  tenantCalls = []
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    tenantCalls.push(url)
    return { data: { success: true, data: [] } } as never
  })
  vi.spyOn(api, 'post').mockImplementation(async (url: string) => {
    tenantCalls.push(url)
    return { data: { success: true } } as never
  })
}

describePlanStates('/tenants', {
  render: () => <TenantsPage />,
  entitledTier: 'enterprise',
  notEntitledTier: 'pro',
  reset: stubTenantsApi,
  paidCalls: () => tenantCalls.filter((u) => String(u).startsWith('/api/tenants')).length,
  content: 'Add Your First Tenant',
  gate: 'Upgrade to Enterprise',
})

describe('/tenants: unmounting while the plan loads', () => {
  it('never calls /api/tenants', async () => {
    localStorage.clear()
    vi.spyOn(console, 'log').mockImplementation(() => {})
    seedSession()
    stubTenantsApi()
    const src = fakeOrgSources()
    const view = renderWithAuth(<TenantsPage />)
    await flush()
    expect(screen.getByTestId('plan-loading')).toBeTruthy()
    view.unmount()
    await src.meOk(0, [org('enterprise')])
    await src.orgsOk(0, [org('enterprise')])
    expect(tenantCalls).toHaveLength(0)
    vi.restoreAllMocks()
  })
})
