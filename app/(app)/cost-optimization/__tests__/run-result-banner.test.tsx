/**
 * The "Run cost analysis" result banner (light-lane layout, Nov 20): running,
 * a finished run with its count (analyzeToast's text, founder ruling 7), a
 * failure with its message, the close button and the 10-second auto-hide.
 * The component on its own (timers), then the real page with mocked services.
 * Placeholder data only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { RunResultBanner, type RunResult } from '../CostAnalysisBanner'
import { RUN_RESULT_AUTO_HIDE_MS } from '../costScanBanner'
import CostOptimizationPage from '../page'
import { run } from './fixtures'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: <T,>(selector: (state: { enabled: boolean }) => T) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'member' }))

const svc = vi.hoisted(() => ({ getStats: vi.fn(), getAnalysisRuns: vi.fn(), analyze: vi.fn() }))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: async () => [],
    getStats: () => svc.getStats(),
    getOptimizationRules: async () => ({ rules: [], summary: { totalRules: 0, implementedCount: 0, plannedCount: 0, services: [] } }),
    getAnalysisRuns: () => svc.getAnalysisRuns(),
    getHidden: async () => ({ latestRun: null, summary: { resolved: 0, dismissed: 0, stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 }, items: [] }),
    analyze: () => svc.analyze(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'account-placeholder' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))

const RUNNING: RunResult = { phase: 'running', id: 1 }
const finished = (kind: 'success' | 'info' | 'warning', text = 'Analysis complete: nothing flagged.', id = 1): RunResult => ({ phase: 'finished', id, kind, text })
const FAILED: RunResult = { phase: 'failed', id: 1, message: 'None of the cost checks could complete. Try again.' }

const banner = () => screen.getByTestId('run-result-banner')

describe('RunResultBanner on its own', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('running: neutral blue, spinner, the running text, a polite status', () => {
    render(<RunResultBanner result={RUNNING} onClose={vi.fn()} />)
    expect(banner()).toHaveAttribute('data-tone', 'info')
    const status = within(banner()).getByRole('status')
    expect(status).toHaveAttribute('aria-live', 'polite')
    expect(status).toHaveTextContent(/^Cost analysis running\. This can take a few minutes\.$/)
    expect(status.querySelector('svg')).toHaveClass('motion-safe:animate-spin')
    expect(within(banner()).queryByRole('alert')).not.toBeInTheDocument()
  })

  it('success with a count: green, the analyzeToast text, a polite status', () => {
    render(<RunResultBanner result={finished('success', 'Analysis complete: 1 new opportunity.')} onClose={vi.fn()} />)
    expect(banner()).toHaveAttribute('data-tone', 'success')
    expect(within(banner()).getByRole('status')).toHaveTextContent(/^Analysis complete: 1 new opportunity\.$/)
  })

  it('the run\'s kind picks the colour: info blue, warning amber', () => {
    const { rerender } = render(<RunResultBanner result={finished('info', 'Analysis complete: no new opportunities.')} onClose={vi.fn()} />)
    expect(banner()).toHaveAttribute('data-tone', 'info')
    rerender(<RunResultBanner result={finished('warning', "Some cost checks didn't complete, so these results may be incomplete.", 2)} onClose={vi.fn()} />)
    expect(banner()).toHaveAttribute('data-tone', 'warning')
  })

  it('failure: red, an alert with "Cost analysis didn\'t finish." and the error message', () => {
    render(<RunResultBanner result={FAILED} onClose={vi.fn()} />)
    expect(banner()).toHaveAttribute('data-tone', 'danger')
    expect(within(banner()).getByRole('alert')).toHaveTextContent(/^Cost analysis didn't finish\. None of the cost checks could complete\. Try again\.$/)
    expect(within(banner()).queryByRole('status')).not.toBeInTheDocument()
  })

  it('failure without a message: the heading only', () => {
    render(<RunResultBanner result={{ phase: 'failed', id: 1, message: null }} onClose={vi.fn()} />)
    expect(within(banner()).getByRole('alert')).toHaveTextContent(/^Cost analysis didn't finish\.$/)
  })

  it.each([['running', RUNNING], ['success', finished('success')], ['failure', FAILED]])('%s: a Dismiss (×) button with a 44 px target closes it', (_label, result) => {
    const onClose = vi.fn()
    render(<RunResultBanner result={result} onClose={onClose} />)
    const close = within(banner()).getByRole('button', { name: 'Dismiss' })
    expect(close).toHaveClass('h-11', 'w-11')
    fireEvent.click(close)
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each(['success', 'info'] as const)('a finished run (%s) hides itself after 10 seconds', (kind) => {
    const onClose = vi.fn()
    render(<RunResultBanner result={finished(kind)} onClose={onClose} />)
    expect(RUN_RESULT_AUTO_HIDE_MS).toBe(10_000)
    act(() => { vi.advanceTimersByTime(9_999) })
    expect(onClose).not.toHaveBeenCalled()
    act(() => { vi.advanceTimersByTime(1) })
    expect(onClose).toHaveBeenCalledTimes(1)
  })

  it.each([['a failure', FAILED], ['a warning (partial run)', finished('warning')], ['running', RUNNING]])('%s stays until closed', (_label, result) => {
    const onClose = vi.fn()
    render(<RunResultBanner result={result} onClose={onClose} />)
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(onClose).not.toHaveBeenCalled()
  })

  it('a new result restarts the 10 seconds; unmounting cancels the timer', () => {
    const onClose = vi.fn()
    const { rerender, unmount } = render(<RunResultBanner result={finished('success', 'Analysis complete: nothing flagged.', 1)} onClose={onClose} />)
    act(() => { vi.advanceTimersByTime(8_000) })
    rerender(<RunResultBanner result={finished('success', 'Analysis complete: nothing flagged.', 2)} onClose={onClose} />)
    act(() => { vi.advanceTimersByTime(8_000) })
    expect(onClose).not.toHaveBeenCalled()
    unmount()
    act(() => { vi.advanceTimersByTime(60_000) })
    expect(onClose).not.toHaveBeenCalled()
  })
})

describe('the result banner on the page', () => {
  function renderPage() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    return render(<QueryClientProvider client={queryClient}><CostOptimizationPage /></QueryClientProvider>)
  }
  const ready = async () => {
    const button = await screen.findByRole('button', { name: /run cost analysis/i })
    await waitFor(() => expect(button).toBeEnabled())
    await waitFor(() => expect(screen.getByTestId('scan-status-banner')).toHaveAttribute('data-tone', 'success'))
    return button
  }

  beforeEach(() => {
    vi.clearAllMocks()
    svc.getStats.mockResolvedValue({
      totalRecommendations: 0, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
      potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, estimatedFindings: 0, unestimatedFindings: 0, bySeverity: { high: 0, medium: 0, low: 0 },
    })
    svc.getAnalysisRuns.mockResolvedValue([run()])
  })

  it('running: in the top slot, above the header, in place of the latest analysis; the button stays disabled', async () => {
    let finish: (value: unknown) => void = () => undefined
    svc.analyze.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderPage()
    const button = await ready()
    fireEvent.click(button)
    await waitFor(() => expect(banner()).toHaveAttribute('data-phase', 'running'))
    expect(screen.queryByTestId('scan-status-banner')).not.toBeInTheDocument()
    expect(banner().compareDocumentPosition(screen.getByRole('heading', { level: 1, name: 'Cost Optimization' })) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(screen.getByRole('button', { name: /scanning/i })).toBeDisabled()
    await act(async () => { finish({ recommendationsFound: 0, totalPotentialSavings: 0, bySeverity: { high: 0, medium: 0, low: 0 }, timestamp: 't', runState: 'completed', unknownResourceCount: 0, counts: { detected: 0, new: 0, refreshed: 0, suppressedResolved: 0, suppressedDismissed: 0, duplicate: 0, persisted: 0 } }) })
    await waitFor(() => expect(banner()).toHaveAttribute('data-phase', 'finished'))
  })

  it('success with a count: the run\'s own text ("2 new opportunities"), no toast; closing brings back the latest analysis', async () => {
    svc.analyze.mockResolvedValue({
      recommendationsFound: 2, totalPotentialSavings: 0, bySeverity: { high: 0, medium: 0, low: 0 }, timestamp: 't', runState: 'completed', unknownResourceCount: 0,
      counts: { detected: 2, new: 2, refreshed: 0, suppressedResolved: 0, suppressedDismissed: 0, duplicate: 0, persisted: 2 },
    })
    renderPage()
    fireEvent.click(await ready())
    await waitFor(() => expect(within(banner()).getByRole('status')).toHaveTextContent(/^Analysis complete: 2 new opportunities\.$/))
    expect(banner()).toHaveAttribute('data-tone', 'info')
    for (const fn of Object.values(toast)) expect(fn).not.toHaveBeenCalled()
    fireEvent.click(within(banner()).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('run-result-banner')).not.toBeInTheDocument()
    expect(screen.getByTestId('scan-status-banner')).toBeInTheDocument()
  })

  it('failure with its error: red alert, stays, and the button is usable again', async () => {
    svc.analyze.mockRejectedValue(new Error('Analysis was refused'))
    renderPage()
    fireEvent.click(await ready())
    await waitFor(() => expect(within(banner()).getByRole('alert')).toHaveTextContent(/^Cost analysis didn't finish\. Analysis was refused$/))
    expect(banner()).toHaveAttribute('data-tone', 'danger')
    expect(toast.error).not.toHaveBeenCalled()
    await waitFor(() => expect(screen.getByRole('button', { name: /run cost analysis/i })).toBeEnabled())
  })
})
