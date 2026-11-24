/**
 * DORA page and the plan (lib/plan/entitlements.ts):
 *   - DORA metrics are on Pro and above. Below, the page shows the upgrade
 *     state and asks the server for neither the metrics nor the benchmarks.
 *   - Custom benchmarks (reads included) are on Enterprise. Pro sees the
 *     locked "Your targets" card and the benchmarks are never requested.
 *   - While the plan is loading or cannot be read: the shared plan states,
 *     never the upgrade state, and no DORA request.
 *
 * The real page, services and shared axios client, with only the transport
 * stubbed.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, renderHook, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { AxiosAdapter, InternalAxiosRequestConfig } from 'axios'
import api from '@/lib/api'
import DORAMetricsPage from '../page'
import { useBreadcrumbs } from '@/lib/hooks/useBreadcrumbs'

// effective: the tier the server enforces (organization.effectiveTier); null = the same as the stored tier.
// hold: organization.entitlementHold (a billing hold on a plan that includes the feature).
const auth = vi.hoisted(() => ({ tier: 'pro' as string, effective: null as string | null, status: 'ready' as string, hold: null as string | null }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({
    organization: { id: 'org-1', subscriptionTier: auth.tier, effectiveTier: auth.effective ?? auth.tier, entitlementHold: auth.hold ?? undefined },
    organizationStatus: auth.status,
    retryOrganizationLoad: async () => {},
    logout: async () => {},
  }),
}))
vi.mock('next/navigation', () => ({ usePathname: () => '/app/dora-metrics' }))
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
    auth.effective = null
    auth.hold = null
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
  ])('on %s: the locked board, and no DORA or benchmark request', async (_name, stored, enforced) => {
    auth.tier = stored
    auth.effective = enforced
    renderPage()

    // PR3: what the page will measure, in place of the one-line lock.
    const board = screen.getByTestId('dora-locked-board')
    expect(board).toHaveTextContent('Available on the Optimization Engine plan.')
    expect(within(board).getByRole('link', { name: 'See plans →' })).toHaveAttribute('href', '/settings/billing/upgrade')
    expect(screen.queryByTestId('dora-plan-required')).not.toBeInTheDocument()
    expect(screen.getByText('Engineering Intelligence')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(asked('/api/metrics/dora')).toBe(false)
    expect(asked('/api/dora/benchmarks')).toBe(false)
  })

  it('PR3 lower plan: the locked board (four items, plan labels, one See plans), the breadcrumb; a billing hold keeps the billing notice', async () => {
    auth.tier = 'starter'
    const { unmount } = renderPage()

    expect(screen.getByRole('heading', { level: 1, name: 'Engineering Intelligence' })).toBeInTheDocument()
    expect(screen.getByText('How often you ship and how often a deploy fails, from the deployment records DevControl holds.')).toBeInTheDocument()
    const board = screen.getByTestId('dora-locked-board')
    expect(within(board).getByRole('heading', { level: 2, name: "What you'll be able to measure" })).toBeInTheDocument()
    expect(within(board).getByTestId('dora-board-plan')).toHaveTextContent(/^Optimization Engine$/)
    // In-app polish: the board's own plan stays the solid label; the Custom targets chip is the light one
    // (the same classes as Your targets' Revenue Protection chip), so it no longer weighs the same.
    expect(within(board).getByTestId('dora-board-plan').className).toBe('text-label leading-none rounded-full px-3 py-1.5 bg-foreground text-background')
    expect(within(board).getByTestId('dora-board-item-plan').className).toBe('text-label leading-none rounded-full px-3 py-1.5 bg-violet-50 border border-violet-200 text-ink-accent')
    expect(within(board).getAllByTestId('dora-board-item').map((item) => item.textContent)).toEqual([
      'Deployment frequencyHow often your team ships changes.',
      'Change failure rateHow often a deployment fails.',
      'Performance levelsDirectional comparison bands informed by the DORA 2023 clusters.',
      'Custom targetsRevenue ProtectionYour own goals for both metrics.',
    ])
    expect(within(board).getByText('Measured from your deployment records, from your pipeline or recorded by hand.')).toBeInTheDocument()
    expect(within(board).getByTestId('dora-board-footer')).toHaveTextContent('Available on the Optimization Engine plan.See plans →')
    expect(screen.getAllByRole('link', { name: /See plans/ })).toHaveLength(1)
    expect(document.body).not.toHaveTextContent(/merge-to-production|recovery time/i)
    expect(screen.queryByTestId('dora-plan-required')).not.toBeInTheDocument()
    expect(renderHook(() => useBreadcrumbs()).result.current.map((c) => c.label)).toEqual(['Dashboard', 'DevOps', 'Engineering Intelligence'])
    unmount()

    // A Pro plan on a billing hold: the plan includes the metrics, so the billing notice, not the board.
    auth.tier = 'pro'
    auth.effective = 'free'
    auth.hold = 'payment'
    renderPage()
    expect(screen.getByTestId('dora-plan-required')).toBeInTheDocument()
    expect(screen.queryByTestId('dora-locked-board')).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(asked('/api/metrics/dora')).toBe(false)
  })

  it('on pro: the metrics are requested; the benchmarks are not, and the existing lock is shown', async () => {
    auth.tier = 'pro'
    renderPage()

    await waitFor(() => expect(asked('/api/metrics/dora')).toBe(true))
    expect(screen.queryByTestId('dora-plan-required')).not.toBeInTheDocument()
    expect(await screen.findByTestId('dora-targets-locked')).toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(asked('/api/dora/benchmarks')).toBe(false)
  })

  it('on pro: the benchmark lock names the plan by its customer-facing name', async () => {
    auth.tier = 'pro'
    renderPage()

    // D5: the targets card's locked variant (Benchmark Settings moved there).
    const lock = await screen.findByTestId('dora-targets-locked')
    expect(lock).toHaveTextContent('Your targetsRevenue Protection')
    expect(lock).toHaveTextContent('Available on the Revenue Protection plan')
    expect(within(lock).getByRole('link', { name: 'Upgrade to Revenue Protection →' })).toHaveAttribute('href', '/settings/billing')
    expect(screen.queryByRole('button', { name: 'Set targets →' })).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Enterprise/)
  })

  it('on enterprise: both are requested', async () => {
    auth.tier = 'enterprise'
    renderPage()

    await waitFor(() => expect(asked('/api/metrics/dora')).toBe(true))
    await waitFor(() => expect(asked('/api/dora/benchmarks')).toBe(true))
    const targets = await screen.findByTestId('dora-targets')
    expect(targets).toHaveTextContent('Your targetsRevenue Protection')
    expect(within(targets).getByRole('button', { name: 'Set targets →' })).toBeEnabled()
    expect(screen.queryByTestId('dora-targets-locked')).not.toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/Enterprise/)
  })

  it('while the plan is loading: the loading state, no upgrade state, no request', async () => {
    auth.tier = 'free'
    auth.status = 'loading'
    renderPage()

    expect(screen.getByTestId('plan-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('dora-plan-required')).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(asked('/api/metrics/dora')).toBe(false)
    expect(asked('/api/dora/benchmarks')).toBe(false)
  })

  it('when the plan cannot be read: the workspace error, never the upgrade state', async () => {
    auth.tier = 'team'
    renderPage()

    expect(screen.queryByTestId('dora-plan-required')).not.toBeInTheDocument()
    expect(screen.queryByTestId('plan-loading')).not.toBeInTheDocument()
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(asked('/api/metrics/dora')).toBe(false)
    expect(asked('/api/dora/benchmarks')).toBe(false)
  })
})
