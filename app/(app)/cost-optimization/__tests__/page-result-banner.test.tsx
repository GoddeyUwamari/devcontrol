/**
 * The scan result banner on the real page (founder-locked behaviour, Nov 23):
 * above the title, only for a run this user started, from GET my-result (or
 * the Run cost analysis response), green / green nothing new / amber / red /
 * running; acknowledged once when seen while the tab is visible or closed, so
 * it is never replayed; a scheduled run never produces one; a run that
 * finishes after the user came back mid-run shows and refreshes the page.
 * Real page and React Query, mocked services, placeholder data only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostOptimizationPage from '../page'
import type { CostRunResult } from '@/lib/services/cost-recommendations.service'
import { run, waitForLastAnalysis } from './fixtures'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'admin' }))

const svc = vi.hoisted(() => ({
  getAll: vi.fn(),
  getStats: vi.fn(),
  getAnalysisRuns: vi.fn(),
  getHidden: vi.fn(),
  analyze: vi.fn(),
  getMyRunResult: vi.fn(),
  acknowledgeRunResult: vi.fn(),
}))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: () => svc.getAll(),
    getStats: () => svc.getStats(),
    getOptimizationRules: async () => ({ rules: [], summary: { totalRules: 0, implementedCount: 0, plannedCount: 0, services: [] } }),
    getAnalysisRuns: (...args: unknown[]) => svc.getAnalysisRuns(...args),
    getHidden: () => svc.getHidden(),
    analyze: () => svc.analyze(),
    getMyRunResult: () => svc.getMyRunResult(),
    acknowledgeRunResult: (id: string) => svc.acknowledgeRunResult(id),
    reopen: vi.fn(), dismiss: vi.fn(), resolve: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'account-placeholder' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))

const SIX = ['EC2', 'EBS', 'RDS', 'S3', 'Lambda', 'DynamoDB']
function result(overrides: Partial<CostRunResult> = {}): CostRunResult {
  return {
    id: 'run-a', state: 'completed', completedAt: '2026-11-23T10:00:00.000Z', checksTotal: 11, checksRan: 11, failedChecks: [], services: SIX,
    newCount: 0, openCount: 0, stillOpen: 0, message: null, findingsUnchanged: false, ...overrides,
  }
}
const REC = {
  id: 'rec-1', organizationId: 'org-placeholder', resourceId: 'vol-placeholder', resourceName: null, resourceType: 'EBS', issue: 'Unattached EBS Volume',
  description: 'Unattached', potentialSavings: 4, severity: 'LOW', status: 'ACTIVE', awsRegion: 'us-east-1',
  metadata: { savings_basis: 'estimated:list_price' }, createdAt: '2026-11-23T06:00:00.000Z', updatedAt: '2026-11-23T06:00:00.000Z', resolvedAt: null,
}
function stats(active = 0) {
  return {
    totalRecommendations: active, activeRecommendations: active, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
    potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: active },
  }
}
const EMPTY_HIDDEN = { latestRun: null, summary: { resolved: 0, dismissed: 0, stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 }, items: [] }

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  const view = render(<QueryClientProvider client={client}><CostOptimizationPage /></QueryClientProvider>)
  return { ...view, client }
}
const banner = () => screen.getByTestId('scan-result-banner')
const runButton = () => screen.getByRole('button', { name: /Run cost analysis|Running analysis…/ })

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

beforeEach(() => {
  vi.clearAllMocks()
  setVisibility('visible')
  svc.getAll.mockResolvedValue([])
  svc.getStats.mockResolvedValue(stats())
  svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery' })])
  svc.getHidden.mockResolvedValue(EMPTY_HIDDEN)
  svc.getMyRunResult.mockResolvedValue(null)
  svc.acknowledgeRunResult.mockResolvedValue(undefined)
})
afterEach(() => {
  vi.useRealTimers()
})

describe('a scheduled run never produces a banner', () => {
  it('no pending result of mine: no banner, nothing acknowledged; the Last analysis line names the scheduled run', async () => {
    const { container } = renderPage()
    await waitForLastAnalysis()
    await waitFor(() => expect(svc.getMyRunResult).toHaveBeenCalled())
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Analysis complete|Cost analysis complete/)
    expect(screen.getByTestId('last-analysis')).toHaveTextContent('(scheduled)')
    expect(svc.acknowledgeRunResult).not.toHaveBeenCalled()
  })
})

describe('the run completes while the user is on the page', () => {
  it('running at once ("Running analysis…", disabled, no ×), then the GREEN result from the run, above the title; seen → acknowledged', async () => {
    let finish!: (value: unknown) => void
    svc.analyze.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderPage()
    await waitForLastAnalysis()
    fireEvent.click(runButton())

    await waitFor(() => expect(banner()).toHaveAttribute('data-phase', 'running'))
    expect(within(banner()).getByText('Cost analysis running. This can take a few minutes.')).toBeInTheDocument()
    expect(within(banner()).queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    expect(runButton()).toHaveTextContent('Running analysis…')
    expect(runButton()).toBeDisabled()

    svc.getAll.mockResolvedValue([REC])
    svc.getStats.mockResolvedValue(stats(3))
    await act(async () => {
      finish({ recommendationsFound: 1, totalPotentialSavings: 4, bySeverity: { high: 0, medium: 0, low: 3 }, timestamp: 't', runId: 'run-a', result: result({ newCount: 1, openCount: 3, stillOpen: 2 }) })
    })

    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    expect(within(banner()).getByTestId('scan-result-title')).toHaveTextContent('Cost analysis complete')
    expect(within(banner()).getByTestId('scan-result-description'))
      .toHaveTextContent('11 checks run across EC2, EBS, RDS, S3, Lambda and DynamoDB · 1 new opportunity found · 2 still open from earlier')
    const heading = screen.getByRole('heading', { level: 1, name: 'Cost Optimization' })
    expect(banner().compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(svc.acknowledgeRunResult).toHaveBeenCalledWith('run-a'))
    expect(svc.acknowledgeRunResult).toHaveBeenCalledTimes(1)
    expect(runButton()).toBeEnabled()
    for (const fn of Object.values(toast)) expect(fn).not.toHaveBeenCalled()
  })

  it('"See the new opportunity" scrolls to Opportunities and focuses its heading', async () => {
    svc.getAll.mockResolvedValue([REC])
    svc.getStats.mockResolvedValue(stats(1))
    svc.getMyRunResult.mockResolvedValue(result({ newCount: 1, openCount: 1, stillOpen: 0 }))
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    renderPage()
    await screen.findByTestId('opportunities')
    fireEvent.click(await within(await screen.findByTestId('scan-result-banner')).findByRole('button', { name: 'See the new opportunity' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('opportunities'))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: /^Opportunities/ }))
  })

  it('the banner stays until closed (no auto-hide); × closes it and acknowledges it', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    svc.getMyRunResult.mockResolvedValue(result())
    renderPage()
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(banner()).toBeInTheDocument()
    fireEvent.click(within(banner()).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(svc.acknowledgeRunResult).toHaveBeenCalledWith('run-a')
  })
})

describe('states, from the run\'s own result', () => {
  it('GREEN, nothing new, some still open', async () => {
    svc.getMyRunResult.mockResolvedValue(result({ newCount: 0, openCount: 4, stillOpen: 4 }))
    renderPage()
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    expect(within(banner()).getByTestId('scan-result-description')).toHaveTextContent(/· No new opportunities · 4 still open from earlier$/)
    expect(within(banner()).queryByRole('button', { name: /See the new/ })).not.toBeInTheDocument()
  })

  it('GREEN, nothing open at all', async () => {
    svc.getMyRunResult.mockResolvedValue(result())
    renderPage()
    await waitFor(() => expect(within(banner()).getByTestId('scan-result-description')).toHaveTextContent(/· No opportunities found$/))
  })

  it('AMBER: gaps, per-check reasons; × but no Try again', async () => {
    svc.getMyRunResult.mockResolvedValue(result({ state: 'partial', checksRan: 8, failedChecks: [{ reason: 'permissions', count: 2 }, { reason: 'timeout', count: 1 }] }))
    renderPage()
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'warning'))
    expect(within(banner()).getByTestId('scan-result-title')).toHaveTextContent('Cost analysis completed with gaps')
    expect(within(banner()).getByTestId('scan-result-description')).toHaveTextContent(
      "8 of 11 checks ran. 2 checks couldn't run because of missing permissions and 1 because of a timeout. Findings from the completed checks are up to date."
    )
    expect(within(banner()).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
    expect(within(banner()).getByRole('button', { name: 'Dismiss' })).toBeInTheDocument()
  })

  it('RED: an alert, with Try again starting a new manual run', async () => {
    svc.getMyRunResult.mockResolvedValue(result({ state: 'failed', message: 'None of the cost checks could complete. Try again.', findingsUnchanged: true }))
    svc.analyze.mockReturnValue(new Promise(() => undefined))
    renderPage()
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'danger'))
    expect(within(banner()).getByRole('alert')).toHaveTextContent("Cost analysis didn't finishNone of the cost checks could complete. Your existing findings haven't changed.")
    fireEvent.click(within(banner()).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(svc.analyze).toHaveBeenCalledTimes(1))
    await waitFor(() => expect(banner()).toHaveAttribute('data-phase', 'running'))
  })
})

describe('lifecycle', () => {
  it('seen, then refresh / reopen: not replayed (the server answers nothing once acknowledged)', async () => {
    svc.getMyRunResult.mockResolvedValueOnce(result())
    const first = renderPage()
    await waitFor(() => expect(banner()).toBeInTheDocument())
    await waitFor(() => expect(svc.acknowledgeRunResult).toHaveBeenCalledWith('run-a'))
    first.unmount()
    // A new visit: the server has the acknowledgement.
    svc.getMyRunResult.mockResolvedValue(null)
    renderPage()
    await waitForLastAnalysis()
    await waitFor(() => expect(svc.getMyRunResult).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
  })

  it('navigating away and back in the app asks the server again, never replays the cached result', async () => {
    svc.getMyRunResult.mockResolvedValueOnce(result()).mockResolvedValue(null)
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    const first = render(<QueryClientProvider client={client}><CostOptimizationPage /></QueryClientProvider>)
    await waitFor(() => expect(banner()).toBeInTheDocument())
    first.unmount()
    render(<QueryClientProvider client={client}><CostOptimizationPage /></QueryClientProvider>)
    await waitForLastAnalysis()
    await waitFor(() => expect(svc.getMyRunResult).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
  })

  it('a result that arrives while the tab is hidden is not "seen" until the tab is visible', async () => {
    setVisibility('hidden')
    svc.getMyRunResult.mockResolvedValue(result())
    renderPage()
    await waitFor(() => expect(banner()).toBeInTheDocument())
    expect(svc.acknowledgeRunResult).not.toHaveBeenCalled()
    act(() => setVisibility('visible'))
    await waitFor(() => expect(svc.acknowledgeRunResult).toHaveBeenCalledWith('run-a'))
  })

  it('a failed acknowledge keeps the result to show next visit (never lost) and is tried again', async () => {
    svc.acknowledgeRunResult.mockRejectedValueOnce(new Error('offline')).mockResolvedValue(undefined)
    svc.getMyRunResult.mockResolvedValue(result())
    renderPage()
    await waitFor(() => expect(svc.acknowledgeRunResult).toHaveBeenCalledTimes(1))
    fireEvent.click(within(banner()).getByRole('button', { name: 'Dismiss' }))
    await waitFor(() => expect(svc.acknowledgeRunResult).toHaveBeenCalledTimes(2))
  })

  it('left mid-run and came back: "running" from the server, polled; when it ends the result shows and the page refreshes', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    svc.getMyRunResult.mockResolvedValue(result({ state: 'running', completedAt: null }))
    renderPage()
    await waitFor(() => expect(banner()).toHaveAttribute('data-phase', 'running'))
    expect(runButton()).toBeDisabled()
    expect(runButton()).toHaveTextContent('Running analysis…')
    expect(svc.acknowledgeRunResult).not.toHaveBeenCalled()
    const statsCalls = svc.getStats.mock.calls.length

    svc.getMyRunResult.mockResolvedValue(result({ newCount: 2, openCount: 2, stillOpen: 0 }))
    await act(async () => { await vi.advanceTimersByTimeAsync(15_000) })
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    expect(within(banner()).getByTestId('scan-result-description')).toHaveTextContent('2 new opportunities found')
    await waitFor(() => expect(svc.getStats.mock.calls.length).toBeGreaterThan(statsCalls))
    await waitFor(() => expect(svc.acknowledgeRunResult).toHaveBeenCalledWith('run-a'))
    expect(runButton()).toBeEnabled()
  })

  it('a run row that could not be saved (ruling 8): shown for this session, never acknowledged', async () => {
    svc.analyze.mockResolvedValue({ recommendationsFound: 0, totalPotentialSavings: 0, bySeverity: { high: 0, medium: 0, low: 0 }, timestamp: 't', runId: null, result: result({ id: null }) })
    renderPage()
    await waitForLastAnalysis()
    fireEvent.click(runButton())
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    expect(svc.acknowledgeRunResult).not.toHaveBeenCalled()
    fireEvent.click(within(banner()).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(svc.acknowledgeRunResult).not.toHaveBeenCalled()
  })
})
