/**
 * DORA Metrics page in real mode: only what the deployment records support.
 *
 *   - Merge-to-production time and failed deployment recovery time are
 *     "Planned" (the API reports them not tracked) -- no value or level.
 *   - Deployment frequency and change failure rate show their values and
 *     levels from the real finished-deployment count (it used to be a
 *     hardcoded 0, so the page always read "Pipeline inactive").
 *   - No trend sparkline and none of the old placeholder analysis.
 * D5 rewrote the page (review-logs/deployments/d5-build.md); this file keeps
 * the original guarantees against the new copy.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import DORAMetricsPage from '../page'

const getDORAMetrics = vi.fn()

vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: 'org-1', subscriptionTier: 'pro' }, organizationStatus: 'ready' }),
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
// Any sparkline or area chart would have to come from recharts: make any use visible.
vi.mock('recharts', () => ({
  AreaChart: () => <div data-testid="sparkline" />,
  Area: () => null,
  BarChart: () => <div data-testid="bar-chart" />,
  Bar: () => null,
  Cell: () => null,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
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
        tracked: true, value: finished > 0 ? successful / 30 : null, unit: 'per day',
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

  it('shows merge-to-production and recovery time as Planned -- no value or level', async () => {
    getDORAMetrics.mockResolvedValue(metrics(150, 50))
    renderPage()

    for (const name of ['merge-to-production-time', 'failed-deployment-recovery-time']) {
      const planned = await card(name)
      expect(within(planned).getByText('Planned')).toBeInTheDocument()
      expect(planned).not.toHaveTextContent(/\d/)
      expect(planned).not.toHaveTextContent(/elite|\bhigh\b|medium|\blow\b|hrs|min\b|N\/A|Not tracked/i)
    }
    // The API's reasons are kept for the CSV export, not shown on the cards.
    expect(document.body).not.toHaveTextContent(LEAD_TIME_REASON)
  })

  it('uses the real finished-deployment count: levels are shown and the page is not "inactive"', async () => {
    getDORAMetrics.mockResolvedValue(metrics(150, 50))
    renderPage()

    const frequency = await card('deployment-frequency')
    expect(within(frequency).getByText('5.0 / day')).toBeInTheDocument()
    expect(within(frequency).getByText('Elite')).toBeInTheDocument()
    expect(within(frequency).getByText('150 successful deploys in 30 days')).toBeInTheDocument()

    const failureRate = await card('change-failure-rate')
    expect(within(failureRate).getByText('25.0%')).toBeInTheDocument()
    expect(within(failureRate).getByText('High')).toBeInTheDocument()
    expect(within(failureRate).getByText('50 of 200 finished deploys failed')).toBeInTheDocument()

    expect(document.body).not.toHaveTextContent(/pipeline inactive|No finished deployments recorded/i)
  })

  it('draws no trend sparkline and shows none of the placeholder analysis', async () => {
    getDORAMetrics.mockResolvedValue(metrics(150, 50))
    renderPage()
    await card('deployment-frequency')

    expect(screen.queryByTestId('sparkline')).not.toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/stable|improving|declining|vs last period/i)
    expect(document.body).not.toHaveTextContent(/Decision Intelligence|Engineering Score|Calculating|top 10%|percentile|Service Breakdown/i)
  })

  it('with no finished deployments: an honest empty state -- dashes, no levels, no zero that reads like data', async () => {
    getDORAMetrics.mockResolvedValue(metrics(0, 0))
    renderPage()

    const failureRate = await card('change-failure-rate')
    expect(within(failureRate).getByText('—')).toBeInTheDocument()
    expect(failureRate).not.toHaveTextContent(/0\.0%|N\/A|Elite|High/)

    const frequency = await card('deployment-frequency')
    expect(within(frequency).getByText('—')).toBeInTheDocument()
    expect(frequency).not.toHaveTextContent(/0\.0|N\/A|Elite/)
    expect(within(frequency).getByText('No finished deployments recorded in this period.')).toBeInTheDocument()

    expect(within(await card('merge-to-production-time')).getByText('Planned')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/Connect your CI/i)
    // The old link sent "Connect CI/CD" to the AWS connection page.
    expect(document.querySelector('a[href="/connect-aws"]')).toBeNull()
  })

  it('with fewer than 5 finished deployments: says the level is indicative, using the real count', async () => {
    getDORAMetrics.mockResolvedValue(metrics(2, 1))
    renderPage()

    expect(within(await card('change-failure-rate')).getByText('1 of 3 finished deploys failed · fewer than 5 finished, so the level is indicative')).toBeInTheDocument()
    expect(within(await card('deployment-frequency')).getByText(/2 successful deploys in 30 days · fewer than 5 finished/)).toBeInTheDocument()
  })

  it('does not claim inactivity while the metrics are loading or have failed', async () => {
    getDORAMetrics.mockRejectedValue(new Error('boom'))
    renderPage()

    await waitFor(() => expect(screen.getByText('Failed to load metrics.', { exact: false })).toBeInTheDocument())
    expect(document.body).not.toHaveTextContent(/No finished deployments|isn't connected/)
    expect(screen.queryByTestId('dora-card-merge-to-production-time')).not.toBeInTheDocument()
  })

  it('has no hardcoded deployment count or random data in the page or its components', () => {
    const dir = resolve(__dirname, '..')
    for (const file of ['page.tsx', ...readdirSync(resolve(dir, '_components')).map((f) => `_components/${f}`)]) {
      const source = readFileSync(resolve(dir, file), 'utf8')
      expect(source, file).not.toMatch(/\b847\b/)
      expect(source, file).not.toMatch(/Math\.random/)
    }
  })
})
