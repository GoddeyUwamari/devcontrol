/**
 * Engineering Intelligence page (D5), rendered from D4-shaped responses.
 * Approved mapping and copy: review-logs/deployments/d5-build.md §1.
 *
 *   - Every card, the chart, What changed and Performance levels read the one
 *     DORA query; the filters drive it.
 *   - Nothing is measured in the browser: values, levels, previous values,
 *     daily buckets, busiest day and bands come from the response.
 *   - null stays "—"; no comparison → no %; no "Connect your CI".
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within, waitFor, fireEvent } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { readFileSync, readdirSync } from 'node:fs'
import { resolve } from 'node:path'
import type { ReactNode } from 'react'
import DORAMetricsPage from '../page'
import { emptyData, founderData, mixedData, ODD_BANDS, PIPELINE_ROW, STATS_BASE } from './d4-fixture'

const env = vi.hoisted(() => ({ tier: 'pro', demo: false }))
const getDORAMetrics = vi.fn()
const getStats = vi.fn()
const getAll = vi.fn()
const apiGet = vi.fn()

vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: 'org-1', subscriptionTier: env.tier }, organizationStatus: 'ready' }),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => env.demo }))
vi.mock('@/lib/demo/sales-demo-data', () => ({
  useSalesDemo: (selector: (state: { enabled: boolean }) => unknown) => selector({ enabled: false }),
}))
vi.mock('@/lib/services/dora-metrics.service', () => ({
  doraMetricsService: { getDORAMetrics: (...args: unknown[]) => getDORAMetrics(...args) },
}))
vi.mock('@/lib/services/deployments.service', () => ({
  deploymentsService: { getStats: (...a: unknown[]) => getStats(...a), getAll: (...a: unknown[]) => getAll(...a) },
}))
vi.mock('@/lib/services/services.service', () => ({
  servicesService: { getAll: vi.fn().mockResolvedValue([{ id: 'svc-1', name: 'checkout-api' }]) },
}))
vi.mock('@/lib/services/teams.service', () => ({
  teamsService: { getAll: vi.fn().mockResolvedValue([{ id: 'team-1', name: 'Payments' }]) },
}))
vi.mock('@/lib/api', () => ({
  default: { get: (...a: unknown[]) => apiGet(...a), post: vi.fn().mockResolvedValue({ data: { success: true } }), delete: vi.fn() },
}))
// The chart is recharts: expose exactly what it is given.
vi.mock('recharts', () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  BarChart: ({ data, children }: { data: unknown; children: ReactNode }) => (
    <div data-testid="bar-chart" data-points={JSON.stringify(data)}>{children}</div>
  ),
  Bar: ({ dataKey, children }: { dataKey: string; children: ReactNode }) => <div data-testid={`bar-${dataKey}`}>{children}</div>,
  Cell: ({ fillOpacity }: { fillOpacity: number }) => <span data-testid="cell" data-opacity={fillOpacity} />,
  XAxis: () => null,
  YAxis: () => null,
  CartesianGrid: () => null,
  Tooltip: () => null,
}))

const ok = (data: unknown) => ({ success: true, data })

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <DORAMetricsPage />
    </QueryClientProvider>
  )
}

const card = (name: string) => screen.findByTestId(`dora-card-${name}`)
const chartPoints = () => JSON.parse(screen.getByTestId('bar-chart').getAttribute('data-points')!)

beforeEach(() => {
  env.tier = 'pro'
  env.demo = false
  getDORAMetrics.mockReset().mockResolvedValue(ok(founderData()))
  getStats.mockReset().mockResolvedValue({ ...STATS_BASE })
  getAll.mockReset().mockResolvedValue([PIPELINE_ROW])
  apiGet.mockReset().mockResolvedValue({ data: { success: true, data: [] } })
})

describe('Engineering Intelligence — own account, populated', () => {
  it('four cards from the response: values, levels, change, fact, links', async () => {
    renderPage()
    const frequency = await card('deployment-frequency')
    expect(within(frequency).getByTestId('dora-card-deployment-frequency-value')).toHaveTextContent('3.9 / day')
    expect(within(frequency).getByText('Elite')).toBeInTheDocument()
    expect(within(frequency).getByText('Up 18% vs previous 30 days')).toBeInTheDocument()
    expect(within(frequency).getByText('116 successful deploys in 30 days')).toBeInTheDocument()
    expect(within(frequency).getByRole('link', { name: 'View deployments →' })).toHaveAttribute('href', '/deployments')

    const failure = await card('change-failure-rate')
    expect(within(failure).getByTestId('dora-card-change-failure-rate-value')).toHaveTextContent('0.0%')
    expect(within(failure).getByText('Elite')).toBeInTheDocument()
    expect(within(failure).getByText('Same as previous 30 days')).toBeInTheDocument()
    expect(within(failure).getByText('0 of 116 finished deploys failed')).toBeInTheDocument()

    const merge = await card('merge-to-production-time')
    expect(within(merge).getByText('Planned')).toBeInTheDocument()
    expect(merge).toHaveTextContent("Time from a pull request's merge to that change running in production. Starts at the merge because changes are squash-merged.")
    const recovery = await card('failed-deployment-recovery-time')
    expect(within(recovery).getByText('Planned')).toBeInTheDocument()
    expect(within(recovery).getByText('No qualifying failures in this period')).toBeInTheDocument()
    expect(recovery).toHaveTextContent('DORA: time to recover from a deployment that impaired production.')
  })

  it('header: subtitle, source line from the records (no render-time "Last updated"), exports enabled', async () => {
    renderPage()
    expect(screen.getByText('How often you ship and how often a deploy fails, from the deployment records DevControl holds.')).toBeInTheDocument()
    const source = await screen.findByTestId('dora-source-line')
    await waitFor(() => expect(source).toHaveTextContent(/^Last record from GitHub Actions \(deploy-backend job\) · Nov 1[89], \d{1,2}:\d{2} [AP]M$/))
    expect(document.body).not.toHaveTextContent(/Last updated/)
    await card('deployment-frequency')
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeEnabled()
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeEnabled()
    expect(screen.queryByTestId('dora-no-data-banner')).not.toBeInTheDocument()
  })

  it('hand-recorded latest record names it so', async () => {
    getAll.mockResolvedValue([{ ...PIPELINE_ROW, metadata: { source: 'manual' } }])
    renderPage()
    await waitFor(() => expect(screen.getByTestId('dora-source-line')).toHaveTextContent(/^Last record entered by hand · /))
    expect(screen.getByTestId('dora-method-source')).toHaveTextContent('Records come from deployments recorded by hand on the Deployments page.')
  })

  it('What changed, from D4 fields, with the fixed footer', async () => {
    renderPage()
    const panel = await screen.findByTestId('dora-what-changed')
    const items = within(panel).getAllByTestId('dora-what-changed-item').map((i) => i.textContent)
    expect(items).toEqual([
      'Deploys up 18%116 successful in the last 30 days, 98 in the 30 days before.',
      'No failed deploysNone in either period.',
      'Busiest day: Nov 117 deploys.',
    ])
    expect(panel).toHaveTextContent('Written from fixed rules over the records on this page.')
  })

  it('Performance levels: API level and band label, Planned row, bands description', async () => {
    renderPage()
    const levels = await screen.findByTestId('dora-performance-levels')
    expect(within(levels).getByTestId('dora-levels-deploymentFrequency')).toHaveTextContent('Deployment frequencyElite· More than once a day')
    expect(within(levels).getByTestId('dora-levels-changeFailureRate')).toHaveTextContent('Change failure rateElite· 5% or less')
    expect(levels).toHaveTextContent('Merge to production, recovery timePlanned')
    expect(within(levels).getByTestId('dora-bands-description')).toHaveTextContent('These are directional benchmarks, not official DORA cutoffs.')
    expect(document.body).not.toHaveTextContent(/DORA thresholds|2024 DORA|33,000|percentile/i)
  })
})

describe('the chart draws the API daily buckets exactly', () => {
  it('31 entries for 30 days, zero days included, part days flagged, no day generated or dropped', async () => {
    const d = founderData()
    renderPage()
    await screen.findByTestId('bar-chart')
    const points = chartPoints()
    expect(points).toEqual(d.daily)
    expect(points.filter((p: { total: number }) => p.total === 0).map((p: { date: string }) => p.date)).toEqual(['2026-10-25', '2026-11-01', '2026-11-08', '2026-11-15'])
    const rows = within(screen.getByTestId('dora-daily-table')).getAllByRole('row').slice(1)
    expect(rows).toHaveLength(31)
    expect(rows[0]).toHaveAttribute('data-partial', 'true')
    expect(rows[30]).toHaveAttribute('data-partial', 'true')
    expect(rows.filter((r) => r.getAttribute('data-partial') === 'true')).toHaveLength(2)
    const opacities = within(screen.getByTestId('bar-succeeded')).getAllByTestId('cell').map((c) => Number(c.getAttribute('data-opacity')))
    expect(opacities[0]).toBeLessThan(1)
    expect(opacities[30]).toBeLessThan(1)
    expect(opacities.slice(1, 30).every((o) => o === 1)).toBe(true)
    expect(screen.getByText('Part day (the period starts or ends mid-day)')).toBeInTheDocument()
    expect(screen.getByText('Deploys per day · last 30 days')).toBeInTheDocument()
  })

  it('a shorter series is drawn as sent (7 days → 8 entries)', async () => {
    const d = founderData()
    d.period = { ...d.period, days: 7 }
    d.daily = d.daily!.slice(23)
    getDORAMetrics.mockResolvedValue(ok(d))
    renderPage()
    await screen.findByTestId('bar-chart')
    expect(chartPoints()).toEqual(d.daily)
    expect(screen.getByText('Deploys per day · last 7 days')).toBeInTheDocument()
  })

  it('Full report link only with 5 or more finished deployments', async () => {
    renderPage()
    expect(await screen.findByTestId('dora-full-report')).toHaveAttribute('href', '/ai-reports')
  })

  it('no Full report link under 5 finished', async () => {
    const d = founderData()
    d.deployments = { successful: 4, failed: 0, finished: 4 }
    getDORAMetrics.mockResolvedValue(ok(d))
    renderPage()
    await card('deployment-frequency')
    expect(screen.queryByTestId('dora-full-report')).not.toBeInTheDocument()
    expect(within(await card('deployment-frequency')).getByText(/fewer than 5 finished, so the level is indicative/)).toBeInTheDocument()
  })
})

describe('read, never recomputed', () => {
  it('frequency change is the API percentage even when the counts would say otherwise', async () => {
    const d = founderData()
    d.previousPeriod!.deployments = { successful: 58, failed: 0, finished: 58 } // counts alone would be +100%
    getDORAMetrics.mockResolvedValue(ok(d))
    renderPage()
    expect(within(await card('deployment-frequency')).getByText('Up 18% vs previous 30 days')).toBeInTheDocument()
  })

  it('failure-rate change is in percentage points from the two API rates, not the relative %', async () => {
    getDORAMetrics.mockResolvedValue(ok(mixedData())) // 4.0% vs 2.5%; relative change 60%
    renderPage()
    const failure = await card('change-failure-rate')
    expect(within(failure).getByText('Up 1.5 points vs previous 30 days')).toBeInTheDocument()
    expect(failure).not.toHaveTextContent('60')
  })

  it('busiest day is the API field', async () => {
    const d = founderData()
    d.busiestDay = { date: '2026-10-30', total: 4, succeeded: 4, failed: 0, partial: false, tiedDays: 1 }
    getDORAMetrics.mockResolvedValue(ok(d))
    renderPage()
    expect(await screen.findByText('Busiest day: Oct 30')).toBeInTheDocument()
    expect(screen.queryByText('Busiest day: Nov 11')).not.toBeInTheDocument()
  })

  it('band labels come from the API response, in the levels card and the all-levels dialog', async () => {
    const d = founderData()
    d.bands = ODD_BANDS
    getDORAMetrics.mockResolvedValue(ok(d))
    renderPage()
    const levels = await screen.findByTestId('dora-performance-levels')
    expect(within(levels).getByTestId('dora-levels-deploymentFrequency')).toHaveTextContent('API elite frequency label')
    expect(within(levels).getByTestId('dora-bands-description')).toHaveTextContent('Test bands description from the API.')
    fireEvent.click(within(levels).getByRole('button', { name: 'See all four levels →' }))
    const table = await screen.findByTestId('dora-bands-table')
    for (const level of ['elite', 'high', 'medium', 'low']) {
      expect(table).toHaveTextContent(`API ${level} frequency label`)
      expect(table).toHaveTextContent(`API ${level} failure label`)
    }
    expect(table).not.toHaveTextContent('More than once a day')
  })

  it('no band threshold, label or previous-period arithmetic in the page or its components', () => {
    const dir = resolve(__dirname, '..')
    const files = ['page.tsx', ...readdirSync(resolve(dir, '_components')).map((f) => `_components/${f}`)]
    for (const f of files) {
      const src = readFileSync(resolve(dir, f), 'utf8')
      expect(src, f).not.toMatch(/0\.14|0\.03|More than once a day|5% or less|industryElite|DORA thresholds/)
      expect(src, f).not.toMatch(/Math\.random|previousPeriod[^\n]*\/|deployments\.successful\s*\//)
    }
  })
})

describe('no data, deploying-only and filters', () => {
  it('nothing finished: "—", no level, no %, no zero that reads like data', async () => {
    getDORAMetrics.mockResolvedValue(ok(emptyData()))
    renderPage()
    const frequency = await card('deployment-frequency')
    expect(within(frequency).getByTestId('dora-card-deployment-frequency-value')).toHaveTextContent(/^—$/)
    expect(within(frequency).getByText('No finished deployments recorded in this period.')).toBeInTheDocument()
    expect(within(frequency).queryByTestId('dora-card-deployment-frequency-chip')).not.toBeInTheDocument()
    expect(frequency).not.toHaveTextContent(/%|0\.0|N\/A|Elite|High|Medium|Low/)
    const failure = await card('change-failure-rate')
    expect(within(failure).getByTestId('dora-card-change-failure-rate-value')).toHaveTextContent(/^—$/)
    expect(within(failure).getByText('Needs finished deployments, succeeded or failed.')).toBeInTheDocument()
    expect(failure).not.toHaveTextContent(/%|N\/A|Elite|High|Medium|Low/)
    expect(await card('merge-to-production-time')).not.toHaveTextContent('squash-merged')
    expect(await card('failed-deployment-recovery-time')).not.toHaveTextContent('No qualifying failures')
    expect(screen.getByTestId('dora-what-changed-empty')).toHaveTextContent('Nothing to compare yet. This panel fills in once two periods have finished deployments.')
    expect(within(screen.getByTestId('dora-levels-deploymentFrequency')).getByText('No finished deployments')).toBeInTheDocument()
  })

  it('no deployment ever: banner with the record link, hollow dot, exports disabled, never "Connect your CI"', async () => {
    getDORAMetrics.mockResolvedValue(ok(emptyData()))
    getStats.mockResolvedValue({ ...STATS_BASE, total: 0, success: 0, organization_has_deployments: false, last_deployment: null })
    getAll.mockResolvedValue([])
    renderPage()
    const banner = await screen.findByTestId('dora-no-data-banner')
    expect(banner).toHaveTextContent("Deployment tracking isn't connected for this workspace yet")
    expect(banner).toHaveTextContent('Connecting your CI/CD pipeline is coming soon. Until then, you can record deployments by hand and mark each one succeeded or failed.')
    expect(within(banner).getByRole('link', { name: /Record a deployment/ })).toHaveAttribute('href', '/deployments?record=1')
    const source = screen.getByTestId('dora-source-line')
    expect(source).toHaveTextContent('No deployment source connected')
    expect(source.querySelector('[data-dot]')).toHaveAttribute('data-dot', 'hollow')
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeDisabled()
    expect(screen.getByRole('button', { name: /Download PDF/ })).toBeDisabled()
    expect(document.body).not.toHaveTextContent(/Connect your CI/i)
    expect(document.querySelector('a[href="/connect-aws"]')).toBeNull()
  })

  it('only rows without a result: no banner, dashes, and the honest sentence', async () => {
    getDORAMetrics.mockResolvedValue(ok(emptyData()))
    getStats.mockResolvedValue({ ...STATS_BASE, total: 3, success: 0, in_progress: 1, no_completion_recorded: 2, last_deployment: null })
    getAll.mockResolvedValue([{ ...PIPELINE_ROW, status: 'deploying', metadata: { source: 'manual' } }])
    renderPage()
    await waitFor(() => expect(screen.getByTestId('dora-what-changed-empty')).toHaveTextContent('No deployment finished in this period; 3 were recorded without a result. Only finished deploys are counted.'))
    expect(screen.queryByTestId('dora-no-data-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId('dora-card-deployment-frequency-value')).toHaveTextContent('—')
    expect(screen.getByTestId('dora-source-line')).toHaveTextContent('Deployments recorded, none with a result yet')
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeDisabled()
  })

  it('with a service filter, the deploying-only sentence is not claimed', async () => {
    getDORAMetrics.mockResolvedValue(ok(emptyData()))
    getStats.mockResolvedValue({ ...STATS_BASE, total: 3, success: 0, in_progress: 3, last_deployment: null })
    renderPage()
    await card('deployment-frequency')
    await screen.findByRole('option', { name: 'checkout-api' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Service' }), { target: { value: 'svc-1' } })
    await waitFor(() => expect(getDORAMetrics).toHaveBeenLastCalledWith({ dateRange: '30d', serviceId: 'svc-1' }))
    await waitFor(() => expect(screen.getByTestId('dora-what-changed-empty')).toHaveTextContent('Nothing to compare yet.'))
    expect(document.body).not.toHaveTextContent('without a result')
  })

  it('filters go to the API, and every section is redrawn from that one response', async () => {
    const filtered = mixedData()
    filtered.daily = filtered.daily!.map((x, i) => (i === 5 ? { ...x, succeeded: 2, total: 2 } : x))
    getDORAMetrics.mockImplementation(async (f: { serviceId?: string; teamId?: string }) => ok(f.serviceId || f.teamId ? filtered : founderData()))
    renderPage()
    await card('deployment-frequency')
    expect(getDORAMetrics).toHaveBeenLastCalledWith({ dateRange: '30d' })

    await screen.findByRole('option', { name: 'checkout-api' })
    fireEvent.change(screen.getByRole('combobox', { name: 'Service' }), { target: { value: 'svc-1' } })
    await waitFor(() => expect(getDORAMetrics).toHaveBeenLastCalledWith({ dateRange: '30d', serviceId: 'svc-1' }))
    await waitFor(() => expect(screen.getByTestId('dora-card-deployment-frequency-value')).toHaveTextContent('1.6 / day'))
    expect(chartPoints()).toEqual(filtered.daily)
    expect(screen.getByText('Busiest day: Nov 20')).toBeInTheDocument()
    expect(screen.getByTestId('dora-card-change-failure-rate-value')).toHaveTextContent('4.0%')

    fireEvent.change(screen.getByRole('combobox', { name: 'Team' }), { target: { value: 'team-1' } })
    await waitFor(() => expect(getDORAMetrics).toHaveBeenLastCalledWith({ dateRange: '30d', serviceId: 'svc-1', teamId: 'team-1' }))
    fireEvent.click(screen.getByRole('button', { name: '7d' }))
    await waitFor(() => expect(getDORAMetrics).toHaveBeenLastCalledWith({ dateRange: '7d', serviceId: 'svc-1', teamId: 'team-1' }))
    for (const [f] of getDORAMetrics.mock.calls) expect(f).not.toHaveProperty('environment')
  })
})

describe('targets and plans', () => {
  it('Optimization Engine: locked targets card, no benchmark request', async () => {
    renderPage()
    const locked = await screen.findByTestId('dora-targets-locked')
    expect(locked).toHaveTextContent('Available on the Revenue Protection plan')
    expect(locked).toHaveTextContent('Set your own deployment frequency and failure-rate targets instead of the comparison bands.')
    expect(within(locked).getByRole('link', { name: 'Upgrade to Revenue Protection →' })).toHaveAttribute('href', '/settings/billing')
    expect(apiGet).not.toHaveBeenCalledWith('/api/dora/benchmarks')
  })

  it('custom target set: purple chip, target line, levels row graded against the target', async () => {
    env.tier = 'enterprise'
    const d = founderData()
    d.changeFailureRate = { ...d.changeFailureRate, value: 1.5, benchmark: 'elite', isCustomBenchmark: true }
    d.deploymentFrequency = { ...d.deploymentFrequency, value: 3.87, benchmark: 'high', isCustomBenchmark: true }
    getDORAMetrics.mockResolvedValue(ok(d))
    apiGet.mockResolvedValue({ data: { success: true, data: [
      { metric_name: 'change_failure_rate', target_value: '2.00', target_unit: 'percentage', performance_label: 'Elite' },
      { metric_name: 'deployment_frequency', target_value: 5, target_unit: 'per_day', performance_label: 'Elite' },
    ] } })
    renderPage()
    const failure = await card('change-failure-rate')
    await waitFor(() => expect(within(failure).getByTestId('dora-card-change-failure-rate-target')).toHaveTextContent('Your target ≤ 2.0% · Level: Elite'))
    expect(within(failure).getByTestId('dora-card-change-failure-rate-target-chip')).toHaveTextContent('Meets your target')
    const frequency = await card('deployment-frequency')
    expect(within(frequency).getByTestId('dora-card-deployment-frequency-target-chip')).toHaveTextContent('Misses your target')
    expect(within(frequency).getByTestId('dora-card-deployment-frequency-target')).toHaveTextContent('Your target ≥ 5.0 / day · Level: High')
    expect(screen.getByTestId('dora-levels-changeFailureRate')).toHaveTextContent('Graded against your target · see Your targets')
    expect(screen.getByTestId('dora-target-change_failure_rate')).toHaveTextContent('Target ≤ 2.0%')
  })

  it('Set targets: the default is the API comparison band, never a hard-coded "Industry default"', async () => {
    env.tier = 'enterprise'
    const d = founderData()
    d.bands = ODD_BANDS
    getDORAMetrics.mockResolvedValue(ok(d))
    renderPage()
    const targets = await screen.findByTestId('dora-targets')
    expect(within(targets).getByTestId('dora-target-deployment_frequency')).toHaveTextContent('No target · comparison band used')
    fireEvent.click(within(targets).getByRole('button', { name: 'Set targets →' }))
    expect(await screen.findByTestId('dora-target-default-change_failure_rate')).toHaveTextContent('Default: comparison band · Elite: API elite failure label')
    expect(screen.getByTestId('dora-target-default-deployment_frequency')).toHaveTextContent('Default: comparison band · Elite: API elite frequency label')
    expect(screen.getByTestId('dora-targets-dialog')).not.toHaveTextContent(/Industry default|15 %|15%/)
  })
})

describe('loading, error, demo', () => {
  it('loading: skeletons, no data claims', async () => {
    getDORAMetrics.mockReturnValue(new Promise(() => {}))
    renderPage()
    expect(await screen.findByTestId('dora-loading')).toBeInTheDocument()
    expect(document.body).not.toHaveTextContent(/No finished deployments|Deployment tracking isn't connected/)
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeDisabled()
  })

  it('error: the error card with Retry, no dashes or banner', async () => {
    getDORAMetrics.mockRejectedValue(new Error('boom'))
    renderPage()
    const err = await screen.findByTestId('dora-error')
    expect(err).toHaveTextContent('Failed to load metrics.')
    expect(within(err).getByRole('button', { name: 'Retry →' })).toBeInTheDocument()
    expect(screen.queryByTestId('dora-metric-cards')).not.toBeInTheDocument()
    expect(screen.queryByTestId('dora-no-data-banner')).not.toBeInTheDocument()
  })

  it('demo: the fixed fixture through the same components, labelled, and no request for real metrics', async () => {
    env.demo = true
    renderPage()
    expect(await screen.findByTestId('dora-source-line')).toHaveTextContent('Demo data · not your workspace')
    expect(screen.getByTestId('dora-card-deployment-frequency-value')).toHaveTextContent('4.2 / day')
    expect(screen.getByTestId('dora-card-change-failure-rate-value')).toHaveTextContent('1.6%') // 1.56 at one decimal is still Elite
    expect(getDORAMetrics).not.toHaveBeenCalled()
    expect(getStats).not.toHaveBeenCalled()
    expect(document.body).not.toHaveTextContent(/92nd|33,000|Decision Intelligence|Engineering Score|Service Breakdown|percentile/i)
  })
})

describe('Planned cards follow the API', () => {
  it('a metric the API reports as tracked is not shown as Planned', async () => {
    const d = founderData() as unknown as { leadTime: unknown }
    d.leadTime = { tracked: true, value: 2, unit: 'hours', benchmark: 'elite', isCustomBenchmark: false }
    getDORAMetrics.mockResolvedValue(ok(d))
    renderPage()
    await card('deployment-frequency')
    expect(screen.queryByTestId('dora-card-merge-to-production-time')).not.toBeInTheDocument()
    expect(screen.getByTestId('dora-card-failed-deployment-recovery-time')).toBeInTheDocument()
  })
})
