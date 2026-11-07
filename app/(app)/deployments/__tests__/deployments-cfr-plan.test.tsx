/**
 * Deployments page and the plan: the change failure rate is a DORA metric
 * (Pro and above, lib/plan/entitlements.ts). Below Pro the server leaves it out
 * of GET /api/deployments/stats; its card shows the upgrade state and the
 * summary sentence leaves the rate out. The counts, the last deployment and
 * the deployment list are on every plan, and the page asks for no DORA data.
 * "Below Pro" is the tier the server enforces (organization.effectiveTier), so
 * a restricted or lapsed paid organization is below Pro.
 *
 * While the plan is loading or could not be loaded, the card shows no upgrade
 * state (so a Pro organization never sees one flash) and states only what the
 * server sent: below Pro it sends no rate, and the card then shows neither the
 * rate nor the failed-of-finished line.
 *
 * The real page, service and shared axios client, with only the transport
 * stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import api from '@/lib/api'
import DeploymentsPage from '../page'

// tier: stored; effective: what the server enforces (it decides the stats answer);
// status: the organization load. While it is not 'ready' there is no organization yet.
const auth = vi.hoisted(() => ({ tier: 'free' as string, effective: 'free' as string, status: 'ready' as string, staleRate: false }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({
    organization: auth.status === 'ready' ? { id: 'org-1', subscriptionTier: auth.tier, effectiveTier: auth.effective } : null,
    organizationStatus: auth.status,
    retryOrganizationLoad: async () => {},
  }),
}))
const setPlan = (stored: string, enforced: string, status = 'ready') => {
  auth.tier = stored
  auth.effective = enforced
  auth.status = status
}
vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}))
vi.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: null }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({
  useSalesDemo: (selector: (state: { enabled: boolean }) => unknown) => selector({ enabled: false }),
}))

const HOUR = 3_600_000
const iso = (msAgo: number) => new Date(Date.now() - msAgo).toISOString()

const COUNTS = {
  window_days: 30, total: 10, success: 8, failed: 2, in_progress: 0, no_completion_recorded: 0, unknown: 0,
  organization_has_deployments: true, last_deployment: { status: 'success', deployed_at: iso(2 * HOUR) },
}

const requests: InternalAxiosRequestConfig[] = []
const originalAdapter = api.defaults.adapter

const adapter: AxiosAdapter = async (config) => {
  requests.push(config)
  const url = config.url ?? ''
  let data: unknown = { success: true }
  if (url.startsWith('/api/deployments/stats')) {
    // What the server sends for the plan: the rate only from Pro.
    // staleRate: the answer still carries the rate (e.g. the plan changed after the page loaded).
    const entitled = auth.staleRate || auth.effective === 'pro' || auth.effective === 'enterprise'
    data = { success: true, stats: entitled ? { ...COUNTS, change_failure_rate: 20 } : COUNTS }
  } else if (url.startsWith('/api/deployments')) {
    data = { success: true, data: [], total: 0 }
  }
  return { data, status: 200, statusText: 'OK', headers: {}, config }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const tree = () => (
    <QueryClientProvider client={queryClient}>
      <DeploymentsPage />
    </QueryClientProvider>
  )
  const result = render(tree())
  /** Render again with the same cache, e.g. after the plan finished loading. */
  return { ...result, rerenderPage: () => result.rerender(tree()) }
}

const card = (name: string) => screen.getByTestId(`deployment-card-${name}`)
const doraRequested = () => requests.some((r) => (r.url ?? '').startsWith('/api/metrics/dora'))

describe('Deployments page — change failure rate and the plan', () => {
  beforeEach(() => {
    requests.length = 0
    auth.staleRate = false
    setPlan('free', 'free')
    localStorage.setItem('accessToken', 'test-access-token')
    api.defaults.adapter = adapter
  })
  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
  })

  it.each([
    ['free', 'free', 'free'],
    ['starter', 'starter', 'starter'],
    ['pro, restricted', 'pro', 'free'],
    ['enterprise, grace period ended', 'enterprise', 'free'],
  ])('on %s: the counts and last deployment are shown; the rate card shows the upgrade state', async (_name, stored, enforced) => {
    setPlan(stored, enforced)
    renderPage()

    expect(await within(card('succeeded')).findByText('8')).toBeInTheDocument()
    expect(within(card('failed-deploys')).getByText('2')).toBeInTheDocument()
    expect(card('last-deployment')).toHaveTextContent('Succeeded')

    const rate = card('change-failure-rate')
    expect(within(rate).getByTestId('deployment-cfr-plan-required')).toHaveTextContent('This feature is on the Optimization Engine plan.')
    expect(within(rate).getByText('See plans').closest('a')).toHaveAttribute('href', '/settings/billing/upgrade')
    // Neither the rate nor the raw failed-of-finished line that states it in another form.
    expect(rate.textContent).toBe('Change Failure RateThis feature is on the Optimization Engine plan.See plans')
    expect(rate).not.toHaveTextContent('%')
    expect(rate).not.toHaveTextContent(/\d+ of \d+|finished deployment/)

    // The summary sentence keeps the counts and leaves the rate out.
    const summary = screen.getByText(/8 of 10 finished deployments in the last 30 days succeeded and 2 failed/)
    expect(summary.textContent).toBe('8 of 10 finished deployments in the last 30 days succeeded and 2 failed.')

    // No DORA endpoint is called; the Deployments data is.
    expect(requests.some((r) => (r.url ?? '').startsWith('/api/metrics/dora'))).toBe(false)
    expect(requests.some((r) => (r.url ?? '').startsWith('/api/deployments/stats'))).toBe(true)
  })

  it('below Pro, a rate the answer still carries is shown nowhere (card or summary)', async () => {
    setPlan('free', 'free')
    auth.staleRate = true
    renderPage()

    expect(await within(card('succeeded')).findByText('8')).toBeInTheDocument()
    expect(within(card('change-failure-rate')).getByTestId('deployment-cfr-plan-required')).toBeInTheDocument()
    expect(card('change-failure-rate')).not.toHaveTextContent(/20%|\d+ of \d+/)
    expect(screen.getByText(/succeeded and 2 failed/).textContent).toBe('8 of 10 finished deployments in the last 30 days succeeded and 2 failed.')
    expect(document.body.textContent).not.toContain('20%')
  })

  it.each(['pro', 'enterprise'])('on %s: the rate is shown as before', async (tier) => {
    setPlan(tier, tier)
    renderPage()

    expect(await within(card('change-failure-rate')).findByText('20%')).toBeInTheDocument()
    expect(card('change-failure-rate')).toHaveTextContent('2 of 10 finished deployments failed')
    expect(screen.queryByTestId('deployment-cfr-plan-required')).not.toBeInTheDocument()
    expect(screen.getByText(/\(change failure rate 20%\)\./)).toBeInTheDocument()
  })

  // ─── Plan loading / failed to load (no organization yet) ───────────────────

  it.each(['loading', 'error'])('plan %s, Pro organization: no upgrade state, the rate the server sent is shown, no DORA request', async (status) => {
    setPlan('pro', 'pro', status)
    renderPage()

    expect(await within(card('change-failure-rate')).findByText('20%')).toBeInTheDocument()
    expect(screen.queryByTestId('deployment-cfr-plan-required')).not.toBeInTheDocument()
    expect(doraRequested()).toBe(false)
  })

  it.each(['loading', 'error'])('plan %s, below Pro: no upgrade state and no rate data -- neither the rate nor the failed-of-finished line', async (status) => {
    setPlan('free', 'free', status)
    renderPage()

    expect(await within(card('succeeded')).findByText('8')).toBeInTheDocument()
    const rate = card('change-failure-rate')
    expect(within(rate).queryByTestId('deployment-cfr-plan-required')).not.toBeInTheDocument()
    expect(rate.textContent).toBe('Change Failure Rate—Last 30 days')
    expect(rate).not.toHaveTextContent(/%|\d+ of \d+|finished deployment/)
    expect(screen.getByText(/succeeded and 2 failed/).textContent).toBe('8 of 10 finished deployments in the last 30 days succeeded and 2 failed.')
    expect(doraRequested()).toBe(false)
  })

  it('Pro organization: no upgrade state while the plan loads, nor once it is known', async () => {
    setPlan('pro', 'pro', 'loading')
    const { rerenderPage } = renderPage()
    expect(await within(card('change-failure-rate')).findByText('20%')).toBeInTheDocument()
    expect(screen.queryByTestId('deployment-cfr-plan-required')).not.toBeInTheDocument()

    setPlan('pro', 'pro', 'ready')
    rerenderPage()
    expect(within(card('change-failure-rate')).getByText('20%')).toBeInTheDocument()
    expect(card('change-failure-rate')).toHaveTextContent('2 of 10 finished deployments failed')
    expect(screen.queryByTestId('deployment-cfr-plan-required')).not.toBeInTheDocument()
    expect(doraRequested()).toBe(false)
  })
})
