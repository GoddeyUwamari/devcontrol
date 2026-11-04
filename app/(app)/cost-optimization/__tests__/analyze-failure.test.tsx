/**
 * A failed "Run cost analysis": the user reads the backend's message, never
 * axios's transport text, and the status stops showing the previous run.
 * Renders the real page with real axios error objects. Fixture data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@testing-library/react'
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
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccounts: async () => [{ id: 'account-1' }] } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))

const CHECKS_FAILED = 'None of the cost checks could complete. Try again.'

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
  await screen.findByText('Analysis complete')
  fireEvent.click(button)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetAnalysisRuns.mockResolvedValue([run('completed')])
})

describe('Cost Optimization page: a failed Analyze', () => {
  it('shows the response body message, not the transport text', async () => {
    await failScan(requestError(503, { success: false, error: CHECKS_FAILED }))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith(CHECKS_FAILED))
    expect(toastSuccess).not.toHaveBeenCalled()
    expect(JSON.stringify(toastError.mock.calls)).not.toContain('Request failed with status code')
  })

  it('never shows transport text when the response has no message, e.g. a proxy page', async () => {
    await failScan(requestError(504, '<html>gateway timeout</html>'))
    await waitFor(() => expect(toastError).toHaveBeenCalledWith('Scan failed — try again'))
  })

  it('refreshes run history, so the status stops saying "Analysis complete"', async () => {
    mockGetAnalysisRuns.mockResolvedValueOnce([run('completed')])
    mockGetAnalysisRuns.mockResolvedValue([run('failed', CHECKS_FAILED)])

    await failScan(requestError(503, { success: false, error: CHECKS_FAILED }))

    expect(await screen.findByText('Last manual cost analysis failed')).toBeInTheDocument()
    expect(screen.queryByText('Analysis complete')).not.toBeInTheDocument()
    expect(screen.getAllByText(CHECKS_FAILED).length).toBeGreaterThan(0)
  })

  it('the button is usable again afterwards', async () => {
    await failScan(requestError(503, { success: false, error: CHECKS_FAILED }))
    await waitFor(() => expect(toastError).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByRole('button', { name: /run cost analysis/i })).toBeEnabled())
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
