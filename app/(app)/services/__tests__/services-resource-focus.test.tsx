/**
 * /services?resource=<id> (infra-overview-plan.md §17.4, §18.1 Q-R3, §19.6
 * C2): one card for the inventoried resource, read with GET
 * /api/services/:id. The state uses the Services wording (STATUS_LABEL); no
 * cost is shown; anything that isn't this organization's AWS resource reads as
 * not found. DL-6 (no parameter) is in services-resource-focus-none.test.tsx.
 *
 * The zone is pinned to UTC and Date frozen before the page module loads.
 */
const m = vi.hoisted(() => {
  process.env.TZ = 'UTC'
  const now = Date.parse('2026-10-22T15:00:00Z')
  vi.useFakeTimers({ toFake: ['Date'], now })
  return { now, param: null as string | null, demo: false, salesDemo: false, replace: vi.fn(), getResource: vi.fn(), apiGet: vi.fn() }
})

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, waitFor, fireEvent, within } from '@testing-library/react'
import { emptyPage, prodCoverage, renderPage, billed, STATS } from './m6-fixtures'
import { STATUS_LABEL } from '../AttentionTable'
import { RESOURCE_NOT_FOUND_TEXT } from '../ResourceFocus'

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn(), replace: m.replace }),
  useSearchParams: () => new URLSearchParams(m.param === null ? '' : `resource=${encodeURIComponent(m.param)}`),
  usePathname: () => '/services',
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => m.demo }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: (s: { enabled: boolean }) => unknown) => selector({ enabled: m.salesDemo }) }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ tier: 'pro', isPro: true }) }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' } }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'owner' }))
vi.mock('@/lib/hooks/use-registered-services', () => ({
  useRegisteredServices: () => ({ isPending: false, isError: false, isSuccess: true, data: [], refetch: vi.fn() }),
}))
vi.mock('@/lib/services/aws-services.service', async (importOriginal) => {
  const real = (await importOriginal()) as { default: Record<string, unknown> }
  return {
    default: {
      // The real client method, over the mocked API below (DL-5 shapes).
      realGetResource: real.default.getResource,
      getServices: async (req: { limit?: number } = {}) => emptyPage(req.limit ?? 50),
      getStats: async () => STATS,
      getCoverage: async () => prodCoverage(m.now),
      discoverServices: vi.fn(),
      getResource: (...args: unknown[]) => m.getResource(...args),
    },
  }
})
vi.mock('@/lib/api', () => ({ default: { get: (...args: unknown[]) => m.apiGet(...args) } }))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccounts: async () => [{ id: 'acct-1' }] } }))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: async () => billed() } }))

const UUID = '3f2b8c4e-9a1d-4e5f-8b7c-6d5e4f3a2b1c'
const ROW = {
  id: UUID, resource_type: 'rds', resource_id: 'orders-db', resource_name: 'orders-db', region: 'us-east-1',
  status: 'critical' as const, last_synced_at: new Date(m.now - 2 * 3600_000).toISOString(), estimated_monthly_cost: '5.00',
}

beforeEach(() => {
  vi.setSystemTime(m.now)
  m.param = UUID
  m.demo = false
  m.salesDemo = false
  m.replace.mockReset()
  m.getResource.mockReset().mockResolvedValue(ROW)
  m.apiGet.mockReset()
})
afterEach(() => { vi.unstubAllEnvs() })

const card = () => screen.findByTestId('resource-focus')

describe.each(['false', 'true'])('NEXT_PUBLIC_SERVICES_V2=%s', (flag) => {
  beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_SERVICES_V2', flag) })

  it('DL-3 / DL-3b one request for the same id; the card shows the row in the Services wording, with no cost', async () => {
    renderPage()
    const el = await card()
    await within(el).findAllByText('orders-db', { selector: 'dd' })
    expect(m.getResource).toHaveBeenCalledTimes(1)
    expect(m.getResource).toHaveBeenCalledWith(UUID)
    const values = Object.fromEntries([...el.querySelectorAll('dl > div')].map((d) => [d.querySelector('dt')!.textContent, d.querySelector('dd')!.textContent]))
    expect(values).toEqual({
      Resource: 'orders-db', Type: 'RDS', Region: 'us-east-1', 'AWS ID': 'orders-db',
      'Last seen': 'Oct 22, 1:00 PM (2 h ago)', 'Lifecycle state': STATUS_LABEL.critical,
    })
    expect(el.textContent).not.toMatch(/\$|healthy|warning|critical/)
  })
  it('DL-8 Close replaces the URL with /services', async () => {
    renderPage()
    fireEvent.click(within(await card()).getByRole('button', { name: 'Close' }))
    expect(m.replace).toHaveBeenCalledWith('/services')
  })
  it('DL-9 demo and sales demo: no card, no request', async () => {
    m.demo = true
    const a = renderPage()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByTestId('resource-focus')).toBeNull()
    a.unmount()
    m.demo = false
    m.salesDemo = true
    renderPage()
    await screen.findByRole('heading', { level: 1 })
    expect(screen.queryByTestId('resource-focus')).toBeNull()
    expect(m.getResource).not.toHaveBeenCalled()
  })
})

describe('DL-4 refresh', () => {
  it('a new mount with the same URL reads it again and shows the same card', async () => {
    const first = renderPage()
    await within(await card()).findAllByText('orders-db', { selector: 'dd' })
    first.unmount()
    renderPage()
    await within(await card()).findAllByText('orders-db', { selector: 'dd' })
    expect(m.getResource).toHaveBeenCalledTimes(2)
  })
})

describe('DL-5 not found', () => {
  it.each([
    ['a 404', () => Promise.reject(Object.assign(new Error('404'), { response: { status: 404 } }))],
    ['a 400 (not a UUID)', () => Promise.reject(Object.assign(new Error('400'), { response: { status: 400 } }))],
    ['a 403', () => Promise.reject(Object.assign(new Error('403'), { response: { status: 403 } }))],
    ['a network error', () => Promise.reject(new Error('Network Error'))],
    ['no AWS resource (null from the client)', () => Promise.resolve(null)],
  ])('%s: the not-found card, no details, one request', async (_, respond) => {
    m.getResource.mockImplementation(respond)
    renderPage()
    const el = await card()
    await within(el).findByText(RESOURCE_NOT_FOUND_TEXT)
    expect(el.querySelector('dl')).toBeNull()
    expect(within(el).getByRole('button', { name: 'Show all resources' })).toBeInTheDocument()
    expect(m.getResource).toHaveBeenCalledTimes(1)
  })

  it('the client accepts only { success, service } with a string resource_type', async () => {
    const { default: client } = await import('@/lib/services/aws-services.service') as unknown as { default: { realGetResource: (id: string) => Promise<unknown> } }
    m.apiGet.mockResolvedValueOnce({ data: { success: true, service: ROW } })
    expect(await client.realGetResource(UUID)).toEqual(ROW)
    m.apiGet.mockResolvedValueOnce({ data: { success: true, data: { id: UUID, name: 'registered service' } } })
    expect(await client.realGetResource(UUID)).toBeNull()
    m.apiGet.mockResolvedValueOnce({ data: { success: true, service: { id: UUID, name: 'x' } } })
    expect(await client.realGetResource(UUID)).toBeNull()
    m.apiGet.mockResolvedValueOnce({ data: { success: false } })
    expect(await client.realGetResource(UUID)).toBeNull()
    // DL-7: the id is encoded once into the path.
    m.apiGet.mockResolvedValueOnce({ data: { success: false } })
    await client.realGetResource('a/b#c')
    expect(m.apiGet).toHaveBeenLastCalledWith('/api/services/a%2Fb%23c')
  })
})

describe('no parameter', () => {
  it('no card and no request', async () => {
    m.param = null
    renderPage()
    await waitFor(() => expect(screen.getByRole('heading', { level: 1 })).toBeInTheDocument())
    expect(screen.queryByTestId('resource-focus')).toBeNull()
    expect(m.getResource).not.toHaveBeenCalled()
  })
})
