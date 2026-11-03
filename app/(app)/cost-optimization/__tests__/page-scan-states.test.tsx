/**
 * The Cost Optimization page renders each approved scan state (pr2-step1.md,
 * founder decisions 2026-11-02): banner at the top, failures never shown as
 * 0, $0, Never or an endless skeleton, zero values muted, no raw job text,
 * and the toast built from the run's counts. Real page, mocked services,
 * fixture data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
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
}))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: () => svc.getAll(),
    getStats: () => svc.getStats(),
    getOptimizationRules: async () => ({ rules: [], summary: { totalRules: 0, implementedCount: 0, plannedCount: 0, services: [] } }),
    getAnalysisRuns: (...args: unknown[]) => svc.getAnalysisRuns(...args),
    analyze: () => svc.analyze(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccounts: () => svc.getAccounts() } }))
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
const kpiCard = (label: string) => screen.getByText(label).parentElement as HTMLElement

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
})

describe('placement and source', () => {
  it('the banner sits above the KPI cards', async () => {
    renderPage()
    await settled()
    const kpi = screen.getByText('Active Opportunities')
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
    expect(within(banner()).getByText('The most recent analysis did not complete.')).toBeInTheDocument()
    expect(container.textContent).not.toContain('arn:aws')
    expect(container.textContent).not.toContain('AccessDenied')
    expect(container.innerHTML).not.toContain('arn:aws')
  })

  it('a run message outside the allowlist is replaced by fixed text', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'failed', status: 'failed', error_message: 'Failed to analyze AWS resources: AccessDenied arn:aws:iam::123456789012:role/placeholder-role' })])
    const { container } = renderPage()
    await settled()
    expect(within(banner()).getByText('The most recent analysis did not complete.')).toBeInTheDocument()
    expect(container.innerHTML).not.toContain('arn:aws')
  })
})

describe('banner states', () => {
  it('production today (2 hidden) is blue, never green', async () => {
    svc.getAnalysisRuns.mockResolvedValue([PRODUCTION_HIDDEN])
    renderPage()
    await settled()
    expect(banner()).toHaveAttribute('data-tone', 'info')
    expect(banner().className).not.toMatch(/green/)
    expect(within(banner()).getByText('Nothing new to review. 2 findings you resolved or dismissed earlier were found again and are still hidden.')).toBeInTheDocument()
    expect(within(banner()).getByText(/^Manual cost analysis, /)).toBeInTheDocument()
  })

  it('a hidden count is not carried over from an older run', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'failed', status: 'failed', error_message: 'None of the cost checks could complete. Try again.', detected_count: null }), PRODUCTION_HIDDEN])
    const { container } = renderPage()
    await settled()
    expect(banner()).toHaveAttribute('data-tone', 'danger')
    expect(container.textContent).not.toMatch(/still hidden/)
  })

  it('interrupted shows the approved text', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ run_state: 'interrupted', status: 'failed', completed_at: null })])
    renderPage()
    await settled()
    expect(within(banner()).getByText('Last manual cost analysis was interrupted')).toBeInTheDocument()
    expect(within(banner()).getByText('The analysis was interrupted before it finished. Run it again.')).toBeInTheDocument()
  })

  it('shows running the moment the button is clicked', async () => {
    svc.analyze.mockReturnValue(new Promise(() => undefined))
    renderPage()
    await settled()
    fireEvent.click(screen.getByRole('button', { name: /run cost analysis/i }))
    await waitFor(() => expect(within(banner()).getByText('Analysis in progress')).toBeInTheDocument())
    expect(screen.getByRole('status')).toHaveAttribute('aria-busy', 'true')
  })
})

describe('fetch failures are never 0, $0, Never or an endless skeleton', () => {
  it('stats failed: every stats card says Unavailable, with a retry', async () => {
    svc.getStats.mockRejectedValue(new Error('boom'))
    const { container } = renderPage()
    await waitFor(() => expect(within(kpiCard('Active Opportunities')).getByText('Unavailable')).toBeInTheDocument())
    expect(within(kpiCard('Estimated Monthly Savings')).getByText('Unavailable')).toBeInTheDocument()
    expect(within(kpiCard('Estimated Annual Savings')).getByText('Unavailable')).toBeInTheDocument()
    expect(within(kpiCard('Active Opportunities')).queryByText('0')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\$0/)
    expect(container.textContent).not.toMatch(/\/yr/)
    expect(container.textContent).not.toMatch(/\/mo/)
    expect(screen.getByText("Totals couldn't load. This doesn't mean there are no savings.")).toBeInTheDocument()
    svc.getStats.mockResolvedValue(stats())
    fireEvent.click(screen.getAllByRole('button', { name: 'Try again' })[0])
    await waitFor(() => expect(svc.getStats).toHaveBeenCalledTimes(2))
  })

  it('stats failed while recommendations exist: the active card is still Unavailable, not the list length; severity shows dashes', async () => {
    svc.getStats.mockRejectedValue(new Error('boom'))
    svc.getAll.mockResolvedValue([{ id: 'rec-1', resourceId: 'i-1234567890abcdef0', issue: 'Idle Instance', severity: 'LOW', status: 'ACTIVE', potentialSavings: 5, metadata: { savings_basis: 'estimated: placeholder' } }])
    renderPage()
    await waitFor(() => expect(within(kpiCard('Active Opportunities')).getByText('Unavailable')).toBeInTheDocument())
    expect(within(kpiCard('Active Opportunities')).queryByText('1')).not.toBeInTheDocument()
    const severity = screen.getByText('Severity breakdown').closest('[data-slot="card"]') as HTMLElement ?? document.body
    expect(within(severity).getAllByText('—').length).toBe(3)
  })

  it('run history failed: Unavailable, never "Never"', async () => {
    svc.getAnalysisRuns.mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(within(banner()).getByText("Couldn't load analysis status")).toBeInTheDocument())
    expect(within(banner()).getByText("This doesn't mean nothing was found. Try again.")).toBeInTheDocument()
    expect(within(kpiCard('Last Analysis')).getByText('Unavailable')).toBeInTheDocument()
    expect(screen.queryByText('Never')).not.toBeInTheDocument()
    expect(screen.queryByText('Never analyzed')).not.toBeInTheDocument()
    svc.getAnalysisRuns.mockResolvedValue([run()])
    fireEvent.click(within(banner()).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
  })

  it('accounts failed: no endless skeleton, no Connect AWS, the Run button stays enabled', async () => {
    svc.getAccounts.mockRejectedValue(new Error('boom'))
    renderPage()
    await waitFor(() => expect(within(banner()).getByText("Couldn't load analysis status")).toBeInTheDocument())
    expect(screen.getByRole('status')).not.toHaveAttribute('aria-busy')
    expect(screen.queryByText('Connect AWS')).not.toBeInTheDocument()
    expect(screen.queryByText('Connect AWS to check for savings')).not.toBeInTheDocument()
    expect(within(kpiCard('Last Analysis')).getByText('Unavailable')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /run cost analysis/i })).toBeEnabled()
  })
})

describe('zero values are muted, never green', () => {
  it('$0/mo, $0/yr and 0 active use slate-500', async () => {
    renderPage()
    await waitFor(() => expect(within(kpiCard('Estimated Monthly Savings')).getByText('/mo')).toBeInTheDocument())
    for (const label of ['Estimated Monthly Savings', 'Estimated Annual Savings']) {
      const value = kpiCard(label).querySelector('.text-kpi') as HTMLElement
      expect(value).toHaveClass('text-slate-500')
      expect(value).not.toHaveClass('text-ink-success')
    }
    const active = kpiCard('Active Opportunities').querySelector('.text-kpi') as HTMLElement
    expect(active).toHaveTextContent('0')
    expect(active).toHaveClass('text-slate-500')
  })

  it('non-zero values keep their colours', async () => {
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: 2, totalPotentialSavings: 40 }))
    renderPage()
    await waitFor(() => expect(within(kpiCard('Active Opportunities')).getByText('2')).toBeInTheDocument())
    expect(kpiCard('Estimated Monthly Savings').querySelector('.text-kpi')).toHaveClass('text-ink-success')
    expect(kpiCard('Estimated Annual Savings').querySelector('.text-kpi')).toHaveClass('text-ink-success')
    expect(kpiCard('Active Opportunities').querySelector('.text-kpi')).toHaveClass('text-slate-900')
  })
})

describe('the toast after Run cost analysis', () => {
  async function scan(result: Record<string, unknown>) {
    svc.analyze.mockResolvedValue({ recommendationsFound: 0, totalPotentialSavings: 0, bySeverity: { high: 0, medium: 0, low: 0 }, timestamp: 't', ...result })
    renderPage()
    await settled()
    fireEvent.click(screen.getByRole('button', { name: /run cost analysis/i }))
  }

  it('detected 2, persisted 0: never "0 found", and not green', async () => {
    await scan({ runState: 'completed', unknownResourceCount: 0, counts: counts({ detected: 2, suppressedResolved: 1, suppressedDismissed: 1 }) })
    await waitFor(() => expect(toast.info).toHaveBeenCalledWith('Analysis complete: nothing new, 2 still hidden.'))
    expect(toast.success).not.toHaveBeenCalled()
    expect(JSON.stringify([toast.info.mock.calls, toast.success.mock.calls])).not.toMatch(/0 opportunit|found/)
  })

  it('partial: a warning with the approved text', async () => {
    await scan({ runState: 'partial', unknownResourceCount: 0, counts: counts({}) })
    await waitFor(() => expect(toast.warning).toHaveBeenCalledWith("Some cost checks didn't complete, so these results may be incomplete."))
    expect(toast.success).not.toHaveBeenCalled()
  })

  it('clean: the only green toast', async () => {
    await scan({ runState: 'completed', unknownResourceCount: 0, counts: counts({}) })
    await waitFor(() => expect(toast.success).toHaveBeenCalledWith('Analysis complete: nothing flagged.'))
  })

  it('the banner shows the new run when the toast does', async () => {
    svc.getAnalysisRuns.mockResolvedValueOnce([run()]).mockResolvedValue([PRODUCTION_HIDDEN])
    await scan({ runState: 'completed', unknownResourceCount: 0, counts: counts({ detected: 2, suppressedResolved: 2 }) })
    await waitFor(() => expect(toast.info).toHaveBeenCalled())
    expect(banner()).toHaveAttribute('data-tone', 'info')
  })
})
