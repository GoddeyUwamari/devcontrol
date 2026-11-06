/**
 * DORA page and the plan (lib/plan/entitlements.ts):
 *   - DORA metrics are on Pro and above. Below, the page shows the upgrade
 *     state and asks the server for neither the metrics nor the benchmarks.
 *   - Custom benchmarks (reads included) are on Enterprise. Pro sees the
 *     existing lock and the benchmarks are never requested.
 *   - While the plan is loading or cannot be read: the shared plan states,
 *     never the upgrade state, and no DORA request.
 *
 * The real page, services and shared axios client, with only the transport
 * stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import api from '@/lib/api'
import DORAMetricsPage from '../page'

const auth = vi.hoisted(() => ({ tier: 'pro' as string, status: 'ready' as string }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({
    organization: { id: 'org-1', subscriptionTier: auth.tier },
    organizationStatus: auth.status,
    retryOrganizationLoad: async () => {},
    logout: async () => {},
  }),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({
  useSalesDemo: (selector: (state: { enabled: boolean }) => unknown) => selector({ enabled: false }),
}))
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  Area: () => null,
}))

const requests: InternalAxiosRequestConfig[] = []
const originalAdapter = api.defaults.adapter
const adapter: AxiosAdapter = async (config) => {
  requests.push(config)
  const data = (config.url ?? '').startsWith('/api/metrics/dora')
    ? { success: true, data: null }
    : { success: true, data: [] }
  return { data, status: 200, statusText: 'OK', headers: {}, config }
}

const asked = (prefix: string) => requests.some((r) => (r.url ?? '').startsWith(prefix))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DORAMetricsPage />
    </QueryClientProvider>
  )
}

describe('DORA page — plan', () => {
  beforeEach(() => {
    requests.length = 0
    auth.status = 'ready'
    localStorage.setItem('accessToken', 'test-access-token')
    api.defaults.adapter = adapter
  })
  afterEach(() => {
    api.defaults.adapter = originalAdapter
    localStorage.clear()
  })

  it.each(['free', 'starter'])('on %s: the upgrade state, and no DORA or benchmark request', async (tier) => {
    auth.tier = tier
    renderPage()

    const notice = screen.getByTestId('dora-plan-required')
    expect(notice).toHaveTextContent('This feature is on the Optimization Engine plan.')
    expect(screen.getByText('See plans').closest('a')).toHaveAttribute('href', '/settings/billing/upgrade')
    expect(screen.getByText('Engineering Intelligence')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(asked('/api/metrics/dora')).toBe(false)
    expect(asked('/api/dora/benchmarks')).toBe(false)
  })

  it('on pro: the metrics are requested; the benchmarks are not, and the existing lock is shown', async () => {
    auth.tier = 'pro'
    renderPage()

    await waitFor(() => expect(asked('/api/metrics/dora')).toBe(true))
    expect(screen.queryByTestId('dora-plan-required')).not.toBeInTheDocument()
    expect(screen.getByText('Custom DORA Benchmarking')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(asked('/api/dora/benchmarks')).toBe(false)
  })

  it('on pro: the benchmark lock names the plan by its customer-facing name', async () => {
    auth.tier = 'pro'
    renderPage()

    const lock = screen.getByText('Custom DORA Benchmarking').parentElement as HTMLElement
    expect(lock).toHaveTextContent('Available on the Revenue Protection plan.')
    expect(within(lock).getByRole('link', { name: 'Upgrade to Revenue Protection →' })).toHaveAttribute('href', '/settings/billing')
    expect(lock.textContent).not.toMatch(/Enterprise/)
    // The section label uses the customer-facing name; the active badge is Enterprise-only.
    expect(screen.getByText('Revenue Protection · Custom Benchmarks')).toBeInTheDocument()
    expect(screen.queryByText('Revenue Protection active')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Enterprise · Custom Benchmarks|Enterprise Active/)
  })

  it('on enterprise: both are requested', async () => {
    auth.tier = 'enterprise'
    renderPage()

    await waitFor(() => expect(asked('/api/metrics/dora')).toBe(true))
    await waitFor(() => expect(asked('/api/dora/benchmarks')).toBe(true))
    expect(screen.queryByText('Custom DORA Benchmarking')).not.toBeInTheDocument()
    expect(screen.getByText('Revenue Protection · Custom Benchmarks')).toBeInTheDocument()
    expect(screen.getByText('Revenue Protection active')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Enterprise · Custom Benchmarks|Enterprise Active/)
  })

  it('while the plan is loading: the loading state, no upgrade state, no request', async () => {
    auth.tier = 'free'
    auth.status = 'loading'
    renderPage()

    expect(screen.getByTestId('plan-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('dora-plan-required')).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(asked('/api/metrics/dora')).toBe(false)
  })

  it('when the plan cannot be read: the workspace error, never the upgrade state', async () => {
    auth.tier = 'team'
    renderPage()

    expect(screen.queryByTestId('dora-plan-required')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plan-loading')).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(asked('/api/metrics/dora')).toBe(false)
  })
})
