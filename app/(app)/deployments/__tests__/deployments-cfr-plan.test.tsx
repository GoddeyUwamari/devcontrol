/**
 * Deployments page and the plan: the change failure rate is a DORA metric
 * (Pro and above, lib/plan/entitlements.ts). Below Pro the server leaves it out
 * of GET /api/deployments/stats; its card shows the upgrade state and the
 * summary sentence leaves the rate out. The counts, the last deployment and
 * the deployment list are on every plan, and the page asks for no DORA data.
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

const auth = vi.hoisted(() => ({ tier: 'free' as string }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({
    organization: { id: 'org-1', subscriptionTier: auth.tier },
    organizationStatus: 'ready',
    retryOrganizationLoad: async () => {},
  }),
}))
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
    const entitled = auth.tier === 'pro' || auth.tier === 'enterprise'
    data = { success: true, stats: entitled ? { ...COUNTS, change_failure_rate: 20 } : COUNTS }
  } else if (url.startsWith('/api/deployments')) {
    data = { success: true, data: [], total: 0 }
  }
  return { data, status: 200, statusText: 'OK', headers: {}, config }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DeploymentsPage />
    </QueryClientProvider>
  )
}

const card = (name: string) => screen.getByTestId(`deployment-card-${name}`)

describe('Deployments page — change failure rate and the plan', () => {
  beforeEach(() => {
    requests.length = 0
    localStorage.setItem('accessToken', 'test-access-token')
    api.defaults.adapter = adapter
  })
  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
  })

  it.each(['free', 'starter'])('on %s: the counts and last deployment are shown; the rate card shows the upgrade state', async (tier) => {
    auth.tier = tier
    renderPage()

    expect(await within(card('succeeded')).findByText('8')).toBeInTheDocument()
    expect(within(card('failed-deploys')).getByText('2')).toBeInTheDocument()
    expect(card('last-deployment')).toHaveTextContent('Succeeded')

    const rate = card('change-failure-rate')
    expect(within(rate).getByTestId('deployment-cfr-plan-required')).toHaveTextContent('This feature is on the Optimization Engine plan.')
    expect(within(rate).getByText('See plans').closest('a')).toHaveAttribute('href', '/settings/billing/upgrade')
    expect(rate).not.toHaveTextContent('%')

    // The summary sentence keeps the counts and leaves the rate out.
    const summary = screen.getByText(/8 of 10 finished deployments in the last 30 days succeeded and 2 failed/)
    expect(summary.textContent).toBe('8 of 10 finished deployments in the last 30 days succeeded and 2 failed.')

    // No DORA endpoint is called; the Deployments data is.
    expect(requests.some((r) => (r.url ?? '').startsWith('/api/metrics/dora'))).toBe(false)
    expect(requests.some((r) => (r.url ?? '').startsWith('/api/deployments/stats'))).toBe(true)
  })

  it.each(['pro', 'enterprise'])('on %s: the rate is shown as before', async (tier) => {
    auth.tier = tier
    renderPage()

    expect(await within(card('change-failure-rate')).findByText('20%')).toBeInTheDocument()
    expect(screen.queryByTestId('deployment-cfr-plan-required')).not.toBeInTheDocument()
    expect(screen.getByText(/\(change failure rate 20%\)\./)).toBeInTheDocument()
  })
})
