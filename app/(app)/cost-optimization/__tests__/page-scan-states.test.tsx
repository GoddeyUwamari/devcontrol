/**
 * The Cost Optimization page renders each approved scan state (pr2-step1.md,
 * founder decisions 2026-11-02): banner at the top, failures never shown as
 * 0, $0, Never or an endless skeleton, zero values muted, no raw job text,
 * and the Run cost analysis result built from the run's counts (a banner in
 * the top slot since the light-lane layout, Nov 20, never a toast). Real page,
 * mocked services, fixture data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import CostOptimizationPage from '../page'
import { PRODUCTION_HIDDEN, RAW_JOB_TEXT, job, run } from './fixtures'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))

const svc = vi.hoisted(() => ({
  getAll: vi.fn(),
  getStats: vi.fn(),
  getAnalysisRuns: vi.fn(),
  analyze: vi.fn(),
  getAccounts: vi.fn(),
  getDiscoveryJobs: vi.fn(),
  getHidden: vi.fn(),
}))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: () => svc.getAll(),
    getStats: () => svc.getStats(),
    getOptimizationRules: async () => ({ rules: [], summary: { totalRules: 0, implementedCount: 0, plannedCount: 0, services: [] } }),
    getAnalysisRuns: (...args: unknown[]) => svc.getAnalysisRuns(...args),
    getHidden: () => svc.getHidden(),
    analyze: () => svc.analyze(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => { const accounts = await (svc.getAccounts()); return { accounts, connection: accounts.length > 0 ? 'connected' : 'not_connected' } } } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: () => svc.getDiscoveryJobs() } }))

function stats(overrides: Record<string, unknown> = {}) {
  return {
    totalRecommendations: 40, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
    potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 0 },
    ...overrides,
  }
}

const counts = (c: Record<string, number>) => ({ detected: 0, new: 0, refreshed: 0, suppressedResolved: 0, suppressedDismissed: 0, duplicate: 0, persisted: 0, ...c })

let queryClient: QueryClient

function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CostOptimizationPage />
    </QueryClientProvider>
  )
}

const banner = () => screen.getByTestId('scan-status-banner')
const subline = () => within(banner()).getByTestId('scan-status-subline')
/** /hidden with `count` resolved findings still detected (the items themselves don't matter to the banner). */
const hiddenWith = (count: number) => ({
  latestRun: null,
  summary: { resolved: count, dismissed: 0, stillDetected: { count, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 },
  items: [],
})
const kpiCard = (label: string) => screen.getByText(label).parentElement as HTMLElement
const runBanner = () => screen.getByTestId('run-result-banner')

async function settled() {
  await waitFor(() => expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy'))
}

beforeEach(() => {
  vi.clearAllMocks()
  svc.getAll.mockResolvedValue([])
  svc.getStats.mockResolvedValue(stats())
  svc.getAnalysisRuns.mockResolvedValue([run()])
  svc.getAccounts.mockResolvedValue([{ id: 'account-placeholder' }])
  svc.getDiscoveryJobs.mockResolvedValue([])
  svc.getHidden.mockResolvedValue({ latestRun: null, summary: { resolved: 0, dismissed: 0, stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 }, items: [] })
})

describe('placement and source', () => {
  it('the banner sits above the summary cards', async () => {
    renderPage()
    await settled()
    const kpi = screen.getByText('Open opportunities')
    expect(banner().compareDocumentPosition(kpi) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('reads every source of runs, under its own query key', async () => {
    renderPage()
    await settled()
    expect(svc.getAnalysisRuns).toHaveBeenCalledWith(5, 'all')
    expect(queryClient.getQueryCache().find({ queryKey: ['cost-analysis-runs', 'all', 5], exact: true })).toBeDefined()
    expect(queryClient.getQueryCache().find({ queryKey: ['cost-analysis-runs', 5], exact: true })).toBeUndefined()
  })

  it('a failed discovery job does not turn a completed run red', async () => {
    svc.getDiscoveryJobs.mockResolvedValue([job({ status: 'failed', error_message: RAW_JOB_TEXT, created_at: '2026-11-03T00:00:00.000Z' })])
    renderPage()
    await settled()
    expect(banner()).toHaveAttribute('data-tone', 'success')
    expect(screen.queryByText(/failed/i)).not.toBeInTheDocument()
  })
})

describe('raw job text never reaches the page', () => {
  it('not when a run exists', async () => {
    svc.getDiscoveryJobs.mockResolvedValue([job({ status: 'failed', cost_analysis_completed: false, error_message: RAW_JOB_TEXT })])
    const { container } = renderPage()
    await settled()
    expect(container.textContent).not.toContain('arn:aws')
    expect(container.textContent).not.toContain('SELECT')
  })

  it('not through the legacy fallback either', async () => {
    svc.getAnalysisRuns.mockResolvedValue([])
    svc.getDiscoveryJobs.mockResolvedValue([job({ status: 'completed', cost_analysis_completed: false, error_message: RAW_JOB_TEXT })])
    const { container } = renderPage()
    await settled()
    expect(within(banner()).getByText('Last scheduled analysis failed')).toBeInTheDocument()
    expect(subline()).toHaveTextContent(/^Scheduled analysis, .+ · The most recent analysis did not complete\.$/)
    expect(container.textContent).not.toContain('arn:aws')
    expect(container.textContent).not.toContain('AccessDenied')
    expect(container.innerHTML).not.toContain('arn:aws')
  })

  it('a run message outside the allowlist is replaced by fixed text', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'failed', status: 'failed', error_message: 'Failed to analyze AWS resources: AccessDenied arn:aws:iam::123456789012:role/placeholder-role' })])
    const { container } = renderPage()
    await settled()
    expect(subline()).toHaveTextContent(/· The most recent analysis did not complete\.$/)
    expect(container.innerHTML).not.toContain('arn:aws')
  })
})

describe('banner states', () => {
  it('production today (2 hidden, 1 still detected per /hidden) is blue, never green', async () => {
    svc.getAnalysisRuns.mockResolvedValue([PRODUCTION_HIDDEN])
    svc.getHidden.mockResolvedValue(hiddenWith(1))
    renderPage()
    await settled()
    expect(banner()).toHaveAttribute('data-tone', 'info')
    expect(banner().className).not.toMatch(/green/)
    expect(within(banner()).getByText('Analysis complete · 1 finding you resolved was found again.')).toBeInTheDocument()
    expect(subline()).toHaveTextContent(/^Analysis you ran, .+ · nothing new besides this · 1 finding you dismissed was found again and is still hidden\.$/)
  })

  it('a hidden count is not carried over from an older run', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'failed', status: 'failed', error_message: 'None of the cost checks could complete. Try again.', detected_count: null }), PRODUCTION_HIDDEN])
    const { container } = renderPage()
    await settled()
    expect(banner()).toHaveAttribute('data-tone', 'danger')
    expect(container.textContent).not.toMatch(/found again|still hidden/)
  })

  it('interrupted shows the approved text', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'interrupted', status: 'failed', completed_at: null })])
    renderPage()
    await settled()
    expect(within(banner()).getByText('Last manual cost analysis was interrupted')).toBeInTheDocument()
    expect(within(banner()).getByText('The analysis was interrupted before it finished. Run it again.')).toBeInTheDocument()
  })

  it('shows running the moment the button is clicked; closing the run banner brings back the latest analysis, running', async () => {
    svc.analyze.mockReturnValue(new Promise(() => undefined))
    renderPage()
    await settled()
    fireEvent.click(screen.getByRole('button', { name: /run cost analysis/i }))
    await waitFor(() => expect(within(runBanner()).getByText('Cost analysis running. This can take a few minutes.')).toBeInTheDocument())
    // One banner in the slot, never both.
    expect(screen.queryByTestId('scan-status-banner')).not.toBeInTheDocument()
    fireEvent.click(within(runBanner()).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(within(banner()).getByText('Analysis in progress')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  })
})

describe('fetch failures are never 0, $0, Never or an endless skeleton', () => {
  it('stats failed: every stats card says Unavailable, with a retry', async () => {
    svc.getStats.mockRejectedValue(new Error('boom'))
    const { container } = renderPage()
    await waitFor(() => expect(within(kpiCard('Open opportunities')).getByText('Unavailable')).toBeInTheDocument())
    expect(within(kpiCard('Estimated monthly savings')).getByText('Unavailable')).toBeInTheDocument()
    expect(within(kpiCard('Open opportunities')).queryByText('0')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\$0/)
    expect(container.textContent).not.toMatch(/\/mo/)
    expect(screen.getByText("Totals couldn't load. This doesn't mean there are no savings.")).toBeInTheDocument()
    svc.getStats.mockResolvedValue(stats())
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0])
    await waitFor(() => expect(svc.getStats).toHaveBeenCalledTimes(2))
  })

  it('stats failed while recommendations exist: the open card is still Unavailable, not the list length; severity shows dashes', async () => {
    svc.getStats.mockRejectedValue(new Error('boom'))
    svc.getAll.mockResolvedValue([{ id: 'rec-1', resourceId: 'i-1234567890abcdef0', issue: 'Idle Instance', severity: 'LOW', status: 'ACTIVE', potentialSavings: 5, metadata: { savings_basis: 'estimated: placeholder' } }])
    renderPage()
    await waitFor(() => expect(within(kpiCard('Open opportunities')).getByText('Unavailable')).toBeInTheDocument())
    expect(within(kpiCard('Open opportunities')).queryByText('1')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('severity-chips')).getAllByText('—').length).toBe(3)
    // The filter chips: no count for All, High, Medium or Low (never the list length, never 0).
    expect(within(screen.getByTestId('severity-filter')).getAllByText('—').length).toBe(4)
  })

  it('run history failed: Unavailable, never "Never"', async () => {
    svc.getAnalysisRuns.mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(within(banner()).getByText("Couldn't load analysis status")).toBeInTheDocument())
    expect(within(banner()).getByText("This doesn't mean nothing was found. Try again.")).toBeInTheDocument()
    expect(within(screen.getByTestId('last-analysis')).getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Never')).not.toBeInTheDocument()
    expect(screen.queryByText('Never analyzed')).not.toBeInTheDocument()
    svc.getAnalysisRuns.mockResolvedValue([run()])
    fireEvent.click(within(banner()).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
  })

  it('no run rows and discovery jobs failed: Unavailable, and Try again fetches the jobs again', async () => {
    svc.getAnalysisRuns.mockResolvedValue([])
    svc.getDiscoveryJobs.mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(within(banner()).getByText("Couldn't load analysis status")).toBeInTheDocument())
    expect(screen.queryByText('Never analyzed')).not.toBeInTheDocument()
    svc.getDiscoveryJobs.mockResolvedValue([])
    fireEvent.click(within(banner()).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(within(banner()).getByText('Never analyzed')).toBeInTheDocument())
  })

  it('accounts failed: no endless skeleton, no Connect AWS, the Run button stays enabled', async () => {
    svc.getAccounts.mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(within(banner()).getByText("Couldn't load analysis status")).toBeInTheDocument())
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy')
    expect(screen.queryByText('Connect AWS')).not.toBeInTheDocument()
    expect(screen.queryByText('Connect AWS to check for savings')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('last-analysis')).getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run cost analysis/i })).toBeEnabled()
  })
})

describe('the recommendations list fails to load', () => {
  it('shows the fixed text with the retry, never axios transport text or the response body', async () => {
    const transport = new AxiosError('Request failed with status code 500', 'ERR_BAD_RESPONSE', undefined, undefined, {
      status: 500,
      data: { success: false, error: 'AccessDenied: arn:aws:iam::123456789012:role/placeholder-role' },
    } as AxiosResponse)
    expect(transport.message).toBe('Request failed with status code 500')
    svc.getAll.mockRejectedValue(transport)
    const { container } = renderPage()

    expect(await screen.findByText("Couldn't load recommendations. Try again.")).toBeInTheDocument()
    expect(container.textContent).not.toContain('Request failed with status code')
    expect(container.textContent).not.toContain('arn:aws')
    expect(container.textContent).not.toContain('Something went wrong.')

    svc.getAll.mockResolvedValue([])
    // Status and totals loaded, so the list's retry is the only one on the page.
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(screen.queryByText("Couldn't load recommendations. Try again.")).not.toBeInTheDocument())
    expect(svc.getAll).toHaveBeenCalledTimes(2)
  })
})

describe('zero values are muted, never green', () => {
  it('$0/mo and 0 open use slate-500', async () => {
    renderPage()
    await waitFor(() => expect(within(kpiCard('Estimated monthly savings')).getByText('/mo')).toBeInTheDocument())
    const value = kpiCard('Estimated monthly savings').querySelector('.text-kpi') as HTMLElement
    expect(value).toHaveClass('text-slate-500')
    expect(value).not.toHaveClass('text-ink-success')
    const active = kpiCard('Open opportunities').querySelector('.text-kpi') as HTMLElement
    expect(active).toHaveTextContent('0')
    expect(active).toHaveClass('text-slate-500')
  })

  it('non-zero values keep their colours', async () => {
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: 2, totalPotentialSavings: 40 }))
    renderPage()
    await waitFor(() => expect(within(kpiCard('Open opportunities')).getByText('2')).toBeInTheDocument())
    expect(kpiCard('Estimated monthly savings').querySelector('.text-kpi')).toHaveClass('text-ink-success')
    expect(kpiCard('Open opportunities').querySelector('.text-kpi')).toHaveClass('text-slate-900')
  })
})

describe('the Run cost analysis result: a banner in the top slot, from analyzeToast (founder ruling 7)', () => {
  async function scan(result: Record<string, unknown>) {
    svc.analyze.mockResolvedValue({ recommendationsFound: 0, totalPotentialSavings: 0, bySeverity: { high: 0, medium: 0, low: 0 }, timestamp: 't', ...result })
    renderPage()
    await settled()
    fireEvent.click(screen.getByRole('button', { name: /run cost analysis/i }))
  }
  const resultText = async (text: string) => waitFor(() => expect(within(runBanner()).getByTestId('run-result-text')).toHaveTextContent(text))

  it('never a toast for the run', async () => {
    await scan({ runState: 'completed', unknownResourceCount: 0, counts: counts({}) })
    await resultText('Analysis complete: nothing flagged.')
    for (const fn of Object.values(toast)) expect(fn).not.toHaveBeenCalled()
  })

  it('detected 2, persisted 0: never "0 found", and not green', async () => {
    svc.getHidden.mockResolvedValue(hiddenWith(1))
    await scan({ runState: 'completed', unknownResourceCount: 0, counts: counts({ detected: 2, suppressedResolved: 1, suppressedDismissed: 1 }) })
    await resultText('Analysis complete: nothing new. 1 resolved found again, 1 dismissed found again.')
    expect(runBanner()).toHaveAttribute('data-tone', 'info')
    expect(runBanner().textContent).not.toMatch(/0 opportunit|\b0 found|\b0\b/)
  })

  it('partial: amber, with the approved text', async () => {
    await scan({ runState: 'partial', unknownResourceCount: 0, counts: counts({}) })
    await resultText("Some cost checks didn't complete, so these results may be incomplete.")
    expect(runBanner()).toHaveAttribute('data-tone', 'warning')
  })

  it('clean: the only green result', async () => {
    await scan({ runState: 'completed', unknownResourceCount: 0, counts: counts({}) })
    await resultText('Analysis complete: nothing flagged.')
    expect(runBanner()).toHaveAttribute('data-tone', 'success')
  })

  it('ruling 8: the run counted a resolved finding found again but /hidden (refetched) confirms none: the result says nothing new, like the banner', async () => {
    svc.getAnalysisRuns.mockResolvedValueOnce([run()]).mockResolvedValue([run({ detected_count: 1, suppressed_resolved_count: 1 })])
    await scan({ runState: 'completed', unknownResourceCount: 0, counts: counts({ detected: 1, suppressedResolved: 1 }) })
    await resultText('Analysis complete: nothing new.')
    expect(runBanner().textContent).not.toMatch(/found again/)
    fireEvent.click(within(runBanner()).getByRole('button', { name: 'Dismiss' }))
    expect(banner().textContent).not.toMatch(/found again/)
  })

  it('ruling 8: the result reads /hidden as refetched after the run, not the answer from before it', async () => {
    svc.getHidden.mockResolvedValueOnce(hiddenWith(0)).mockResolvedValue(hiddenWith(2))
    await scan({ runState: 'completed', unknownResourceCount: 0, counts: counts({ detected: 3, suppressedResolved: 3 }) })
    await resultText('Analysis complete: nothing new. 2 resolved found again.')
  })

  it('ruling 8: /hidden fails on the refetch: the result makes no "resolved found again" claim', async () => {
    svc.getHidden.mockResolvedValueOnce(hiddenWith(1)).mockRejectedValue(new Error('x'))
    await scan({ runState: 'completed', unknownResourceCount: 0, counts: counts({ detected: 1, suppressedResolved: 1 }) })
    await resultText('Analysis complete: nothing new.')
  })

  it('closing the result shows the latest analysis banner with the new run', async () => {
    svc.getAnalysisRuns.mockResolvedValueOnce([run()]).mockResolvedValue([PRODUCTION_HIDDEN])
    // /hidden, refetched with the runs after the scan, now has the resolved finding still detected.
    svc.getHidden.mockResolvedValueOnce(hiddenWith(0)).mockResolvedValue(hiddenWith(1))
    await scan({ runState: 'completed', unknownResourceCount: 0, counts: counts({ detected: 2, suppressedResolved: 2 }) })
    await resultText('Analysis complete: nothing new. 1 resolved found again.')
    expect(screen.queryByTestId('scan-status-banner')).not.toBeInTheDocument()
    fireEvent.click(within(runBanner()).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('run-result-banner')).not.toBeInTheDocument()
    expect(banner()).toHaveAttribute('data-tone', 'info')
    expect(within(banner()).getByText('Analysis complete · 1 finding you resolved was found again.')).toBeInTheDocument()
  })
})
