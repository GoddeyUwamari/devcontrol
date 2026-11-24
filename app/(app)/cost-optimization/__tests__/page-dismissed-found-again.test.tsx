/**
 * Founder ruling on decision 1 (Nov 24): the Resolved and dismissed section says "<N> dismissed finding(s) were found
 * again", N being the LATEST analysis's own recorded count (cost_analysis_runs.suppressed_dismissed_count, the same
 * run the Last analysis line names), never the length of the list; hidden at 0, while running, or when the run didn't
 * record it. A later run is the new latest run: the section then shows that run's own count, never a sum, and a
 * pending result banner for an earlier manual run doesn't change it. Real page, mocked services, placeholder data.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostOptimizationPage from '../page'
import type { HiddenFinding, HiddenFindings } from '@/lib/services/cost-recommendations.service'
import { run, waitForLastAnalysis } from './fixtures'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'member' }))

const svc = vi.hoisted(() => ({ getAnalysisRuns: vi.fn(), getHidden: vi.fn(), getMyRunResult: vi.fn() }))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: async () => [],
    getStats: async () => ({
      totalRecommendations: 0, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
      potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 0 },
    }),
    getOptimizationRules: async () => ({ rules: [], summary: { totalRules: 0, implementedCount: 0, plannedCount: 0, services: [] } }),
    getAnalysisRuns: () => svc.getAnalysisRuns(),
    getHidden: () => svc.getHidden(),
    getMyRunResult: () => svc.getMyRunResult(),
    acknowledgeRunResult: async () => undefined,
    analyze: vi.fn(), reopen: vi.fn(), dismiss: vi.fn(), resolve: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'account-placeholder' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))

function dismissedItem(id: string): HiddenFinding {
  return {
    id, decision: 'DISMISSED', decidedAt: '2026-11-10T10:00:00.000Z', decidedBy: 'Placeholder Person', decisionCount: 1,
    issue: 'Unattached EBS Volume', resourceId: `vol-${id}`, resourceName: null, resourceType: 'EBS', awsRegion: 'us-east-1',
    detection: { state: 'not_confirmed', reason: 'not_checked_since', lastDetectedAt: null, potentialSavings: null },
  } as unknown as HiddenFinding
}
function hidden(dismissed: number): HiddenFindings {
  const items = Array.from({ length: dismissed }, (_, i) => dismissedItem(`d${i}`))
  return {
    latestRun: null,
    summary: { resolved: 0, dismissed, stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: dismissed },
    items,
  } as unknown as HiddenFindings
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><CostOptimizationPage /></QueryClientProvider>)
}
const reviewList = async () => screen.findByTestId('review-list')
const line = () => screen.queryByTestId('dismissed-found-again')

beforeEach(() => {
  vi.clearAllMocks()
  svc.getHidden.mockResolvedValue(hidden(5))
  svc.getMyRunResult.mockResolvedValue(null)
})

describe('"<N> dismissed finding(s) were found again" in Resolved and dismissed', () => {
  it('from the latest run\'s record, not the list: 5 dismissed listed, the run found 2 again', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', detected_count: 2, suppressed_dismissed_count: 2 })])
    renderPage()
    await waitForLastAnalysis()
    const section = await reviewList()
    await waitFor(() => expect(within(section).getByTestId('dismissed-found-again')).toHaveTextContent(/^2 dismissed findings were found again$/))
    // Visible without opening the collapsed list, and the list itself is unchanged.
    expect(within(section).getByRole('button', { name: /Resolved and dismissed \(5\)/ })).toHaveAttribute('aria-expanded', 'false')
  })

  it('singular', async () => {
    svc.getHidden.mockResolvedValue(hidden(0))
    svc.getAnalysisRuns.mockResolvedValue([run({ detected_count: 1, suppressed_dismissed_count: 1 })])
    renderPage()
    await reviewList()
    await waitFor(() => expect(line()).toHaveTextContent(/^1 dismissed finding was found again$/))
  })

  it.each([
    ['0', run({ suppressed_dismissed_count: 0 })],
    ['not recorded (older run)', run({ run_state: undefined, checks: undefined, suppressed_dismissed_count: null })],
    ['a failed run (no counts)', run({ run_state: 'failed', status: 'failed', suppressed_dismissed_count: null })],
  ])('hidden when the count is %s', async (_label, latest) => {
    svc.getAnalysisRuns.mockResolvedValue([latest])
    renderPage()
    await waitForLastAnalysis()
    await reviewList()
    expect(line()).toBeNull()
  })

  it('a later scheduled run is the run the section reflects: its own count (never summed with the earlier run\'s)', async () => {
    // Latest first, as GET /analysis-runs?source=all returns them.
    svc.getAnalysisRuns.mockResolvedValue([
      run({ id: 'run-scheduled-later', source: 'discovery', created_at: '2026-11-03T08:00:00.000Z', completed_at: '2026-11-03T08:00:01.000Z', suppressed_dismissed_count: 1 }),
      run({ id: 'run-manual-earlier', suppressed_dismissed_count: 3 }),
    ])
    renderPage()
    await reviewList()
    await waitFor(() => expect(line()).toHaveTextContent(/^1 dismissed finding was found again$/))
  })

  it('a later scheduled run that found none hides the line, even while an earlier manual run\'s result banner is still showing', async () => {
    svc.getAnalysisRuns.mockResolvedValue([
      run({ id: 'run-scheduled-later', source: 'discovery', created_at: '2026-11-03T08:00:00.000Z', completed_at: '2026-11-03T08:00:01.000Z', suppressed_dismissed_count: 0 }),
      run({ id: 'run-manual-earlier', suppressed_dismissed_count: 3 }),
    ])
    svc.getMyRunResult.mockResolvedValue({
      id: 'run-manual-earlier', state: 'completed', completedAt: '2026-11-02T08:00:01.000Z', checksTotal: 1, checksRan: 1, failedChecks: [],
      services: ['EC2'], newCount: 0, openCount: 0, stillOpen: 0, message: null, findingsUnchanged: false,
    })
    renderPage()
    await screen.findByTestId('scan-result-banner')
    await reviewList()
    expect(line()).toBeNull()
  })
})
