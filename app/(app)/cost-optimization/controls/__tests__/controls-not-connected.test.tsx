/**
 * PR4b empty states, /cost-optimization/controls (Optimization Controls): with no AWS account connected, a
 * plan below Revenue Protection gets the shared NotConnectedCard in place of the plan lock. The lock is
 * untouched underneath (connected, it shows again), the Revenue Protection page is unchanged and makes no
 * connection request, and until the check answers the plan-loading skeleton shows.
 *
 * The network answers are the backend's for a new org (backend/src): GET /api/aws/accounts (aws.routes.ts,
 * not plan-gated) and /api/cost-recommendations/optimization-rules/configuration (requireEnterprise; the
 * registry's adjustable rule). They go through the real services and parsers. All figures are test fixtures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/lib/api'
import OptimizationControlsPage from '../page'

const m = vi.hoisted(() => ({ tier: 'free' as 'free' | 'pro' | 'enterprise', connection: 'not_connected' as 'not_connected' | 'connected' | 'PENDING' }))

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ status: 'known', isKnown: true, isFree: m.tier === 'free', isPro: m.tier !== 'free', isEnterprise: m.tier === 'enterprise', tier: m.tier }),
}))
vi.mock('sonner', () => ({ toast: Object.assign(vi.fn(), { success: vi.fn(), error: vi.fn(), info: vi.fn() }) }))

// aws.routes.ts GET /accounts
const ACCOUNTS_NOT_CONNECTED = { success: true, data: [], connection: { state: 'not_connected' }, home_region_proposal: null, previous_home_region: null, home_region_changed_at: null, can_change_home_region: true }
const ACCOUNTS_CONNECTED = {
  success: true,
  data: [{ id: 1, org_id: 'org-test', account_id: '111122223333', role_arn: 'arn:aws:iam::111122223333:role/DevControl', nickname: null, external_id: 'ext', region: 'us-east-1', connected_at: '2026-11-20T09:00:00.000Z', status: 'active' }],
  connection: { state: 'connected', health: { state: 'ok', since: '2026-11-23T08:00:00.000Z' } },
  home_region_proposal: null, previous_home_region: null, home_region_changed_at: null, can_change_home_region: true,
}
const CONFIGURATION = '/api/cost-recommendations/optimization-rules/configuration'
const LAMBDA_RULE = { ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default', default: 10, min: 0, max: 1000, unit: 'invocations_per_30d', type: 'integer' }

beforeEach(() => {
  m.tier = 'free'
  m.connection = 'not_connected'
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/aws/accounts') {
      if (m.connection === 'PENDING') return new Promise(() => {}) as never
      return { data: m.connection === 'connected' ? ACCOUNTS_CONNECTED : ACCOUNTS_NOT_CONNECTED } as never
    }
    if (url.startsWith(CONFIGURATION)) return { data: { success: true, data: [LAMBDA_RULE] } } as never
    throw new Error('unexpected GET ' + url)
  })
})
afterEach(() => { vi.restoreAllMocks() })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><OptimizationControlsPage /></QueryClientProvider>)
}

const PLAN_LOCK = 'Revenue Protection feature'
const configurationCalls = () => (api.get as unknown as { mock: { calls: unknown[][] } }).mock.calls.filter(([url]) => String(url).startsWith(CONFIGURATION)).length

describe.each(['free', 'pro'] as const)('PR4b: /cost-optimization/controls with no AWS account connected (%s plan)', (tier) => {
  beforeEach(() => { m.tier = tier })

  it('title, subtitle and the shared card in place of the plan lock; no configuration read', async () => {
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(screen.getByRole('heading', { level: 1, name: 'Optimization Controls' })).toBeInTheDocument()
    expect(screen.getByText('Tune how DevControl identifies selected cost optimization opportunities for your organization.')).toBeInTheDocument()
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
    expect(configurationCalls()).toBe(0)
  })

  it('connection loading: the skeleton only, no card or lock', async () => {
    m.connection = 'PENDING'
    renderPage()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/aws/accounts'))
    expect(screen.getByTestId('plan-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
  })
})

describe('PR4b: /cost-optimization/controls connected, and Revenue Protection, are unchanged', () => {
  it.each(['free', 'pro'] as const)('%s plan, connected: the plan lock again (entitlement untouched), no card', async (tier) => {
    m.tier = tier
    m.connection = 'connected'
    renderPage()
    expect(await screen.findByText(PLAN_LOCK)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/settings/billing/upgrade')
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(configurationCalls()).toBe(0)
  })

  it.each(['not_connected', 'connected'] as const)('Revenue Protection, %s: the controls, no card, and no connection request', async (connection) => {
    m.tier = 'enterprise'
    m.connection = connection
    renderPage()
    expect(await screen.findByText('Low-usage Lambda functions')).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
    expect(api.get).not.toHaveBeenCalledWith('/api/aws/accounts')
  })
})
