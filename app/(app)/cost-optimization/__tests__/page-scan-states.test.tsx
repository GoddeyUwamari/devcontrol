/**
 * The Cost Optimization page renders each approved scan state (pr2-step1.md,
 * founder decisions 2026-11-02): failures never shown as 0, $0, Never or an
 * endless skeleton, zero values muted, no raw job text. Since the scan result
 * banner PR (founder-locked, Nov 23) the latest analysis has no banner: a run
 * that failed or had gaps says so on the Last analysis line (ruling 1a), and an
 * unavailable status is a small inline error with Retry (ruling 1c). The result
 * banner itself is page-result-banner.test.tsx. Real page, mocked services,
 * fixture data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import CostOptimizationPage from '../page'
import { PRODUCTION_HIDDEN, RAW_JOB_TEXT, checks, job, run, waitForLastAnalysis } from './fixtures'

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
    getMyRunResult: async () => null,
    acknowledgeRunResult: async () => undefined,
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

let queryClient: QueryClient

function renderPage() {
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={queryClient}>
      <CostOptimizationPage />
    </QueryClientProvider>
  )
}

const lastAnalysis = () => screen.getByTestId('last-analysis')
const problem = () => screen.queryByTestId('last-analysis-problem')
/** /hidden with `count` resolved findings still detected (the items themselves don't matter to the banner). */
const hiddenWith = (count: number) => ({
  latestRun: null,
  summary: { resolved: count, dismissed: 0, stillDetected: { count, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 },
  items: [],
})
const kpiCard = (label: string) => screen.getByText(label).parentElement as HTMLElement
async function settled() {
  await waitForLastAnalysis()
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
  it('a scheduled run produces no banner, and no "Analysis complete" anywhere; the Last analysis line names it', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery' })])
    const { container } = renderPage()
    await settled()
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(screen.queryByTestId('scan-status-banner')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Analysis complete|Scheduled analysis,/)
    expect(lastAnalysis()).toHaveTextContent(/^Last analysis.+ ago \(scheduled\)$/)
    expect(problem()).toBeNull()
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
    expect(problem()).toBeNull()
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
    expect(problem()).toHaveTextContent("· didn't finish")
    expect(container.textContent).not.toContain('arn:aws')
    expect(container.textContent).not.toContain('AccessDenied')
    expect(container.innerHTML).not.toContain('arn:aws')
  })

  it('a run message outside the allowlist is replaced by fixed text', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'failed', status: 'failed', error_message: 'Failed to analyze AWS resources: AccessDenied arn:aws:iam::123456789012:role/placeholder-role' })])
    const { container } = renderPage()
    await settled()
    expect(problem()).toHaveTextContent("· didn't finish")
    expect(container.innerHTML).not.toContain('arn:aws')
    expect(container.textContent).not.toContain('AccessDenied')
  })
})

describe('the Last analysis line says when a run failed or had gaps (ruling 1a), never a banner', () => {
  it('a scheduled run with gaps: "· N checks couldn\'t run" in amber', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', run_state: 'partial', status: 'failed', failed_detector_count: 2, checks: checks(2) })])
    renderPage()
    await settled()
    expect(lastAnalysis()).toHaveTextContent(/^Last analysis.+ ago \(scheduled\)· 2 checks couldn't run$/)
    expect(problem()).toHaveClass('text-ink-warning')
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
  })

  it('one check: singular', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', run_state: 'partial', status: 'failed', failed_detector_count: 1, checks: checks(1) })])
    renderPage()
    await settled()
    expect(problem()).toHaveTextContent("· 1 check couldn't run")
  })

  it('a scheduled run that failed: "· didn\'t finish"', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', run_state: 'failed', status: 'failed', error_message: 'None of the cost checks could complete. Try again.' })])
    renderPage()
    await settled()
    expect(problem()).toHaveTextContent("· didn't finish")
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
  })

  it('interrupted, with no completion time: "· didn\'t finish"', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', run_state: 'interrupted', status: 'failed', completed_at: null })])
    renderPage()
    await settled()
    expect(problem()).toHaveTextContent("· didn't finish")
  })

  it('a hidden count is not carried over from an older run, and nothing claims "found again"', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'failed', status: 'failed', error_message: 'None of the cost checks could complete. Try again.', detected_count: null }), PRODUCTION_HIDDEN])
    const { container } = renderPage()
    await settled()
    expect(problem()).toHaveTextContent("· didn't finish")
    expect(container.textContent).not.toMatch(/found again|still hidden/)
  })

  it('production today (hidden findings found again, per /hidden): no banner; the Still detected group carries it', async () => {
    svc.getAnalysisRuns.mockResolvedValue([PRODUCTION_HIDDEN])
    svc.getHidden.mockResolvedValue(hiddenWith(1))
    renderPage()
    await settled()
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Review it' })).not.toBeInTheDocument()
    expect(problem()).toBeNull()
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

  it('run history failed: a small inline error with Retry (ruling 1c), never "Never", never a banner', async () => {
    svc.getAnalysisRuns.mockRejectedValue(new Error('boom'))
    renderPage()
    const inline = await screen.findByTestId('last-analysis-unavailable')
    expect(inline).toHaveTextContent("Couldn't load analysis status.Try again")
    expect(within(lastAnalysis()).getByTestId('last-analysis-unavailable')).toBe(inline)
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(screen.queryByText('Never')).not.toBeInTheDocument()
    svc.getAnalysisRuns.mockResolvedValue([run()])
    fireEvent.click(within(inline).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(lastAnalysis()).toHaveTextContent(/ ago \(manual\)$/))
  })

  it('no run rows and discovery jobs failed: Unavailable, and Try again fetches the jobs again', async () => {
    svc.getAnalysisRuns.mockResolvedValue([])
    svc.getDiscoveryJobs.mockRejectedValue(new Error('boom'))
    renderPage()
    const inline = await screen.findByTestId('last-analysis-unavailable')
    expect(screen.queryByText('Never')).not.toBeInTheDocument()
    svc.getDiscoveryJobs.mockResolvedValue([])
    fireEvent.click(within(inline).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(lastAnalysis()).toHaveTextContent(/^Last analysisNever$/))
  })

  it('accounts failed: no endless skeleton, no Connect AWS, the Run button stays enabled', async () => {
    svc.getAccounts.mockRejectedValue(new Error('boom'))
    renderPage()
    await screen.findByTestId('last-analysis-unavailable')
    expect(screen.queryByText(/Connect AWS/)).not.toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).not.toBeInTheDocument()
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
  it('no open findings: the savings tile is grey words, never "$0/mo" ("Never show $0"), and 0 open uses slate-500', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('savings-no-figure')).toBeInTheDocument())
    const value = screen.getByTestId('savings-no-figure')
    expect(value).toHaveClass('text-ink-muted')
    expect(value).not.toHaveClass('text-ink-success')
    expect(kpiCard('Estimated monthly savings').textContent).not.toMatch(/\$0/)
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
