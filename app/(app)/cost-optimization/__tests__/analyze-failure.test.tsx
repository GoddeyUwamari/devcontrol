/**
 * A failed "Run cost analysis" (scan result banner PR, founder-locked Nov 23):
 * the red result banner reads the RUN's own record (GET my-result), so it says
 * what the server recorded, "Your existing findings haven't changed" only when
 * the server knows that (ruling 4), and a run still going after a proxy timeout
 * stays "running". With no run row at all (ruling 8) the banner shows the
 * response's message for this session only, never axios's transport text, and
 * makes no claim about the findings. Real page, real axios error objects.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { AxiosError, type AxiosResponse } from 'axios'
import { analyzeFailureMessage } from '../costOptimizationStatus'
import CostOptimizationPage from '../page'

const toastError = vi.hoisted(() => vi.fn())
const toastSuccess = vi.hoisted(() => vi.fn())
vi.mock('sonner', () => ({ toast: { error: toastError, success: toastSuccess } }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))

const mockAnalyze = vi.fn()
const mockGetAnalysisRuns = vi.fn()
const mockMyResult = vi.fn()
const mockAcknowledge = vi.fn()
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: async () => [],
    getStats: async () => ({
      totalRecommendations: 40, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
      potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 0 },
    }),
    getOptimizationRules: async () => ({ rules: [], summary: { totalRules: 0, implementedCount: 0, plannedCount: 0, services: [] } }),
    getAnalysisRuns: () => mockGetAnalysisRuns(),
    getHidden: async () => ({ latestRun: null, summary: { resolved: 0, dismissed: 0, stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 }, items: [] }),
    analyze: () => mockAnalyze(),
    getMyRunResult: () => mockMyResult(),
    acknowledgeRunResult: (id: string) => mockAcknowledge(id),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => { const accounts = await ([{ id: 'account-1' }]); return { accounts, connection: accounts.length > 0 ? 'connected' : 'not_connected' } } } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))

const CHECKS_FAILED = 'None of the cost checks could complete. Try again.'
const resultBanner = () => screen.getByTestId('scan-result-banner')
const failure = async () => {
  await waitFor(() => expect(resultBanner()).toHaveAttribute('data-tone', 'danger'))
  return resultBanner()
}
/** The run's record as GET my-result gives it. */
function recorded(overrides: Record<string, unknown> = {}) {
  return {
    id: 'run-placeholder', state: 'failed', completedAt: '2026-11-02T08:00:01.000Z', checksTotal: 0, checksRan: 0, failedChecks: [],
    services: [], newCount: null, openCount: null, stillOpen: null, message: CHECKS_FAILED, findingsUnchanged: true, ...overrides,
  }
}

function run(status: 'completed' | 'failed', errorMessage: string | null = null) {
  return {
    id: `run-${status}`, status, recommendations_found: 0, total_potential_savings: null, error_message: errorMessage,
    started_at: '2026-11-02T08:00:00.000Z', completed_at: '2026-11-02T08:00:01.000Z', created_at: '2026-11-02T08:00:00.000Z',
  }
}

function requestError(status: number, data: unknown) {
  return new AxiosError(`Request failed with status code ${status}`, 'ERR_BAD_RESPONSE', undefined, undefined, { status, data } as AxiosResponse)
}

async function failScan(error: unknown) {
  mockAnalyze.mockRejectedValue(error)
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <CostOptimizationPage />
    </QueryClientProvider>
  )
  const button = await screen.findByRole('button', { name: /run cost analysis/i })
  await waitFor(() => expect(button).toBeEnabled())
  await waitFor(() => expect(screen.getByTestId('last-analysis')).toHaveTextContent(/ ago \(manual\)$/))
  // Nothing waiting to be seen before the click.
  expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
  fireEvent.click(button)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAnalysisRuns.mockResolvedValue([run('completed')])
  mockAcknowledge.mockResolvedValue(undefined)
  // Before the click: nothing pending. After the failure: the run's own record.
  mockMyResult.mockResolvedValueOnce(null).mockResolvedValue(recorded())
})

describe('Cost Optimization page: a failed Analyze', () => {
  it('a recorded run: the red banner states the run\'s own reason, the unchanged claim it earned, a Try again button; never transport text or a toast', async () => {
    await failScan(requestError(503, { success: false, error: CHECKS_FAILED }))
    const banner = await failure()
    expect(within(banner).getByRole('alert')).toHaveTextContent(
      "Cost analysis didn't finishNone of the cost checks could complete. Your existing findings haven't changed."
    )
    // Ruling 9: the reason's own trailing "Try again." is dropped; the button says it.
    expect(banner.textContent).not.toMatch(/complete\. Try again\./)
    expect(within(banner).getByRole('button', { name: 'Try again' })).toBeInTheDocument()
    expect(banner.textContent).not.toContain('Request failed with status code')
    expect(toastError).not.toHaveBeenCalled()
    expect(toastSuccess).not.toHaveBeenCalled()
    // Seen: acknowledged once.
    await waitFor(() => expect(mockAcknowledge).toHaveBeenCalledWith('run-placeholder'))
  })

  it('a failure the server can\'t vouch for (unexpected error, interrupted): no "haven\'t changed" claim', async () => {
    mockMyResult.mockReset()
    mockMyResult.mockResolvedValueOnce(null).mockResolvedValue(recorded({ state: 'interrupted', message: 'The analysis was interrupted before it finished. Run it again.', findingsUnchanged: false }))
    await failScan(requestError(409, { success: false, error: 'The analysis was interrupted before it finished. Run it again.' }))
    const banner = await failure()
    expect(within(banner).getByTestId('scan-result-description')).toHaveTextContent(/^The analysis was interrupted before it finished\.$/)
    expect(banner.textContent).not.toMatch(/haven't changed/)
  })

  it('no run row (ruling 8): the response\'s message for this session only, never transport text, never acknowledged', async () => {
    mockMyResult.mockReset()
    mockMyResult.mockResolvedValue(null)
    await failScan(requestError(504, '<html>gateway timeout</html>'))
    const banner = await failure()
    expect(within(banner).getByTestId('scan-result-description')).toHaveTextContent(/^Scan failed — try again\.$/)
    expect(banner.textContent).not.toMatch(/haven't changed|gateway|status code/)
    expect(mockAcknowledge).not.toHaveBeenCalled()
    fireEvent.click(within(banner).getByRole('button', { name: 'Dismiss' }))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
  })

  it('still running on the server after a proxy timeout: the banner and the button stay "running"', async () => {
    mockMyResult.mockReset()
    mockMyResult.mockResolvedValueOnce(null).mockResolvedValue(recorded({ state: 'running', completedAt: null, message: null, findingsUnchanged: false }))
    await failScan(requestError(504, '<html>gateway timeout</html>'))
    await waitFor(() => expect(resultBanner()).toHaveAttribute('data-phase', 'running'))
    expect(within(resultBanner()).getByText('Cost analysis running. This can take a few minutes.')).toBeInTheDocument()
    expect(within(resultBanner()).queryByRole('button', { name: 'Dismiss' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Running analysis…/ })).toBeDisabled()
    expect(mockAcknowledge).not.toHaveBeenCalled()
  })

  it('refreshes run history, so the Last analysis line says it didn\'t finish', async () => {
    mockGetAnalysisRuns.mockResolvedValueOnce([run('completed')])
    mockGetAnalysisRuns.mockResolvedValue([{ ...run('failed', CHECKS_FAILED), run_state: 'failed', source: 'manual' }])
    await failScan(requestError(503, { success: false, error: CHECKS_FAILED }))
    await failure()
    await waitFor(() => expect(screen.getByTestId('last-analysis-problem')).toHaveTextContent("· didn't finish"))
  })

  it('the button is usable again afterwards, and Try again starts a new run', async () => {
    await failScan(requestError(503, { success: false, error: CHECKS_FAILED }))
    const banner = await failure()
    await waitFor(() => expect(screen.getByRole('button', { name: /run cost analysis/i })).toBeEnabled())
    fireEvent.click(within(banner).getByRole('button', { name: 'Try again' }))
    await waitFor(() => expect(mockAnalyze).toHaveBeenCalledTimes(2))
  })
})

describe('analyzeFailureMessage', () => {
  it('prefers the body message', () => {
    expect(analyzeFailureMessage(requestError(409, { success: false, error: 'A scan is already running.' }))).toBe('A scan is already running.')
  })

  it.each([
    ['no response at all', new AxiosError('Network Error', 'ERR_NETWORK')],
    ['an empty body message', requestError(500, { success: false, error: '   ' })],
    ['a body message that is not text', requestError(500, { error: { code: 1 } })],
    ['no body', requestError(502, undefined)],
  ])('falls back on %s', (_label, error) => {
    expect(analyzeFailureMessage(error)).toBe('Scan failed — try again')
  })

  it('keeps a non-transport error message, such as a 200 with success: false', () => {
    expect(analyzeFailureMessage(new Error('Analysis was refused'))).toBe('Analysis was refused')
  })

  it.each([[null], [undefined], ['text'], [{}]])('copes with %j', (value) => {
    expect(analyzeFailureMessage(value)).toBe('Scan failed — try again')
  })
})
