/**
 * DORA Metrics page in real mode: only what the deployment records support.
 *
 *   - Lead time for changes and time to restore are "Not tracked", with the
 *     reason from the API -- no value, tier or chart.
 *   - Deployment frequency and change failure rate show their values and
 *     tiers, and the page's data state uses the real finished-deployment
 *     count (it used to be a hardcoded 0, so the page always read "Pipeline
 *     inactive" with N/A tiers).
 *   - No trend sparkline: no trend is computed from real data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import DORAMetricsPage from '../page'

const getDORAMetrics = vi.fn()

vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: 'org-1', subscriptionTier: 'pro' } }),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({
  useSalesDemo: (selector: (state: { enabled: boolean }) => unknown) => selector({ enabled: false }),
}))
vi.mock('@/lib/services/dora-metrics.service', () => ({
  doraMetricsService: { getDORAMetrics: (...args: unknown[]) => getDORAMetrics(...args) },
}))
vi.mock('@/lib/services/services.service', () => ({ servicesService: { getAll: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/services/teams.service', () => ({ teamsService: { getAll: vi.fn().mockResolvedValue([]) } }))
vi.mock('@/lib/api', () => ({ default: { get: vi.fn().mockResolvedValue({ data: { success: true, data: [] } }) } }))
// A sparkline would have to come from recharts: make any use visible.
vi.mock('recharts', () => ({
  AreaChart: () => <div data-testid="sparkline" />,
  Area: () => null,
  ResponsiveContainer: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}))

const LEAD_TIME_REASON = 'Deployment records hold no commit or change timestamp.'
const RESTORE_REASON = 'No incident or service-restoration records are collected.'

function metrics(successful: number, failed: number) {
  const finished = successful + failed
  return {
    success: true,
    data: {
      deploymentFrequency: {
        tracked: true, value: successful / 30, unit: 'per day',
        benchmark: finished > 0 ? 'elite' : null, isCustomBenchmark: false,
        description: `${successful} successful deployments in 30 days`,
      },
      leadTime: { tracked: false, reason: LEAD_TIME_REASON },
      changeFailureRate: {
        tracked: true, value: finished > 0 ? (failed / finished) * 100 : null, unit: 'percentage',
        benchmark: finished > 0 ? 'high' : null, isCustomBenchmark: false,
        description: finished > 0 ? `${failed} failed out of ${finished} finished deployments` : 'No finished deployments in this period',
      },
      mttr: { tracked: false, reason: RESTORE_REASON },
      deployments: { successful, failed, finished },
      period: { start: '2026-01-01', end: '2026-01-31', days: 30 },
    },
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DORAMetricsPage />
    </QueryClientProvider>
  )
}

const card = (name: string) => screen.findByTestId(`dora-card-${name}`)

describe('DORA Metrics page — real mode', () => {
  beforeEach(() => {
    getDORAMetrics.mockReset()
  })

  it('shows lead time and time to restore as "Not tracked" with the reason -- no value, tier or chart', async () => {
    getDORAMetrics.mockResolvedValue(metrics(150, 50))
    renderPage()

    const leadTime = await card('lead-time-for-changes')
    expect(within(leadTime).getByText('Not tracked')).toBeInTheDocument()
    expect(within(leadTime).getByText(LEAD_TIME_REASON)).toBeInTheDocument()
    expect(leadTime).not.toHaveTextContent(/\d/)
    expect(leadTime).not.toHaveTextContent(/elite|high|medium|low|hrs|N\/A/i)

    const restore = await card('mean-time-to-recovery')
    expect(within(restore).getByText('Not tracked')).toBeInTheDocument()
    expect(within(restore).getByText(RESTORE_REASON)).toBeInTheDocument()
    expect(restore).not.toHaveTextContent(/\d/)
    expect(restore).not.toHaveTextContent(/elite|high|medium|low|min\b|N\/A/i)
  })

  it('uses the real finished-deployment count: tiers are shown and the page is not "inactive"', async () => {
    getDORAMetrics.mockResolvedValue(metrics(150, 50))
    renderPage()

    const frequency = await card('deployment-frequency')
    expect(within(frequency).getByText('5.0/day')).toBeInTheDocument()
    expect(within(frequency).getByText('Elite')).toBeInTheDocument()
    expect(within(frequency).getByText('150 successful deployments in 30 days')).toBeInTheDocument()

    const failureRate = await card('change-failure-rate')
    expect(within(failureRate).getByText('25.0%')).toBeInTheDocument()
    expect(within(failureRate).getByText('High')).toBeInTheDocument()
    expect(within(failureRate).getByText('50 failed out of 200 finished deployments')).toBeInTheDocument()

    expect(screen.getByText(/Based on 200 finished deployments/)).toBeInTheDocument()
    expect(screen.getByTestId('dora-real-summary')).toHaveTextContent('200 finished deployments in the last 30 days')
    expect(screen.getByTestId('dora-real-summary')).toHaveTextContent('150 succeeded · 50 failed')
    expect(document.body).not.toHaveTextContent(/pipeline inactive/i)
  })

  it('draws no trend sparkline and shows none of the placeholder analysis', async () => {
    getDORAMetrics.mockResolvedValue(metrics(150, 50))
    renderPage()
    await card('deployment-frequency')

    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/stable|improving|declining|vs last period/i)
    expect(document.body).not.toHaveTextContent(/Decision Intelligence|Engineering Score|Calculating|top 10%/i)
  })

  it('with no finished deployments: an honest empty state -- dashes, no tiers, no zero that reads like data', async () => {
    getDORAMetrics.mockResolvedValue(metrics(0, 0))
    renderPage()

    const failureRate = await card('change-failure-rate')
    expect(within(failureRate).getByText('—')).toBeInTheDocument()
    expect(within(failureRate).getByText('N/A')).toBeInTheDocument()
    expect(failureRate).not.toHaveTextContent('0.0%')

    const frequency = await card('deployment-frequency')
    expect(within(frequency).getByText('—')).toBeInTheDocument()
    expect(within(frequency).getByText('N/A')).toBeInTheDocument()
    expect(frequency).not.toHaveTextContent('0.0/day')

    expect(within(await card('lead-time-for-changes')).getByText('Not tracked')).toBeInTheDocument()
    expect(screen.getByText('No deployments recorded')).toBeInTheDocument()
    expect(screen.getByText(/Connect your CI to record deployments/)).toBeInTheDocument()
    expect(screen.getByText(/No deployments recorded in the selected period/)).toBeInTheDocument()
    // The old link sent "Connect CI/CD" to the AWS connection page.
    expect(document.querySelector('a[href="/connect-aws"]')).toBeNull()
  })

  it('with fewer than 5 finished deployments: says the tier is indicative, using the real count', async () => {
    getDORAMetrics.mockResolvedValue(metrics(2, 1))
    renderPage()

    await card('change-failure-rate')
    expect(screen.getByText(/3 finished deployments in the selected period, fewer than 5/)).toBeInTheDocument()
    expect(within(await card('change-failure-rate')).getByText(/tier is indicative only/)).toBeInTheDocument()
  })

  it('does not claim inactivity while the metrics are loading or have failed', async () => {
    getDORAMetrics.mockRejectedValue(new Error('boom'))
    renderPage()

    await waitFor(() => expect(screen.getByText(/Deployment data could not be loaded/)).toBeInTheDocument())
    expect(document.body).not.toHaveTextContent(/No deployments recorded/)
    expect(screen.queryByTestId('dora-card-lead-time-for-changes')).not.toBeInTheDocument()
  })

  it('has no hardcoded deployment count or random data in real mode', () => {
    const source = readFileSync(resolve(__dirname, '../page.tsx'), 'utf8')
    expect(source).not.toMatch(/isDemoActive \? 847 : 0\b/)
    expect(source.match(/Math\.random/g) ?? []).toHaveLength(1) // generateDemoTrendData only
    expect(source).toMatch(/isDemoActive && metric\.value != null && \(/)
  })
})
