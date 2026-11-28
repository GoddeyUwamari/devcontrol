/**
 * Cost Intelligence PR B (founder rulings: review-logs/cost-intelligence/stage-a.md, Addendum 1, and the PR B brief).
 * Optimize Now runs the cost analysis from the Costs page; its result shows in the scan result banner at the top of
 * the page, with Cost Optimization's #368 lifecycle, shared (useCostRunResultBanner), unchanged:
 *   - the run → banner flow: running, then green / amber / red from the run's own result, with Try again;
 *   - the one-time lifecycle: acknowledged once when seen, closed with ×, never replayed after a refresh or on the
 *     other page, never "seen" from a hidden tab, never for a scheduled run, nothing in demo mode;
 *   - ruling Q9: members and viewers get a disabled Optimize Now with a short note (the backend's own rule);
 *   - ruling Q10: after a run, findings, savings and status refresh; spend and the trend don't;
 *   - safeguard 3: the "Cost checks" tile's count equals the banner's M for the same run;
 *   - review RN-1 (Opportunities never says "Run cost analysis" while one runs or after one didn't complete) and
 *     RN-3 (the Opportunities loading state is a boolean, not the tile's display text).
 * Real page and React Query, mocked services; every name and figure is a test fixture, not production data.
 */
import { cloneElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CostRunResult } from '@/lib/services/cost-recommendations.service'
import { expectNoMoneyZero } from '@/lib/__tests__/support/no-money-zero'

const m = vi.hoisted(() => ({ demo: false, role: 'admin' as string | null }))
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }) }))
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 600, height: 240 }),
  }
})
vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ isPro: true }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => m.role }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => m.demo }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))

const svc = vi.hoisted(() => ({
  getCostSummary: vi.fn(),
  getStats: vi.fn(),
  getAll: vi.fn(),
  getAnalysisRuns: vi.fn(),
  getRules: vi.fn(),
  getHidden: vi.fn(),
  analyze: vi.fn(),
  getMyRunResult: vi.fn(),
  acknowledgeRunResult: vi.fn(),
}))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: () => svc.getCostSummary() } }))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getStats: () => svc.getStats(),
    getAll: () => svc.getAll(),
    getAnalysisRuns: (...a: unknown[]) => svc.getAnalysisRuns(...a),
    getOptimizationRules: () => svc.getRules(),
    getHidden: () => svc.getHidden(),
    analyze: () => svc.analyze(),
    getMyRunResult: () => svc.getMyRunResult(),
    acknowledgeRunResult: (id: string) => svc.acknowledgeRunResult(id),
    reopen: vi.fn(), dismiss: vi.fn(), resolve: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'a', status: 'active' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/aws-services.service', () => ({ default: { getCoverage: async () => ({ account: { connected: true, status: 'active', home_region: 'xx-test-1' } }) } }))
vi.mock('@/lib/services/nl-query.service', () => ({ nlQueryService: { executeQuery: vi.fn() } }))

import CostsPage from '../page'
import CostOptimizationPage from '../../cost-optimization/page'
import { RUN_ANALYSIS_ROLE_NOTE } from '../cost-intelligence'
import { OPPORTUNITIES_EMPTY } from '../OpportunitiesCard'

const pending = () => new Promise<never>(() => {})

const SUMMARY = {
  spend: {
    state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: '2026-11-26T09:00:00.000Z', coverage: null, reason: null,
    data: { amount: 16.91, basis: 'billed_month_to_date', lastDayInProgress: false },
  },
  monthOverMonth: {
    state: 'available', source: 'DevControl month-over-month comparison', provenance: 'derived', asOf: null, coverage: null, reason: null,
    data: { currentWindow: { start: '2026-11-01', end: '2026-11-23' }, previousWindow: { start: '2026-10-01', end: '2026-10-23' }, currentWindowTotal: 10, previousWindowTotal: 10, changeAmount: 0.2, changePercent: 2, currentWindowIncludesToday: false },
  },
}

/** A catalog shaped like GET /optimization-rules; the tile reads its implementedCount and service names. */
function catalog(services: [string, number, number][]) {
  return {
    rules: services.flatMap(([service, implemented, planned]) => [
      ...Array.from({ length: implemented }, (_, i) => ({ id: `${service}-${i}`, service, name: '', detail: '', status: 'implemented', issue: `${service} ${i}`, configurable: false, parameters: [] })),
      ...Array.from({ length: planned }, (_, i) => ({ id: `${service}-p${i}`, service, name: '', detail: '', status: 'planned', configurable: false, parameters: [] })),
    ]),
    summary: {
      totalRules: services.reduce((s, [, a, b]) => s + a + b, 0),
      implementedCount: services.reduce((s, [, a]) => s + a, 0),
      plannedCount: services.reduce((s, [, , b]) => s + b, 0),
      services: services.map(([service, implemented, planned]) => ({ service, displayName: service, implementedCount: implemented, plannedCount: planned, totalCount: implemented + planned })),
    },
  }
}
// 13 active checks across 8 service categories, like today's registry (the counts are the fixture's, never literals in the page).
const CATALOG = catalog([['EC2', 3, 3], ['EBS', 3, 1], ['RDS', 1, 3], ['S3', 1, 2], ['Lambda', 1, 2], ['DynamoDB', 2, 0], ['NAT Gateway', 1, 1], ['CloudWatch', 1, 1], ['EKS', 0, 2]])
const CATALOG_SERVICES = ['EC2', 'EBS', 'RDS', 'S3', 'Lambda', 'DynamoDB', 'NAT Gateway', 'CloudWatch']

const TREND = Array.from({ length: 31 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 9, 27 + i)).toISOString().slice(0, 10)
  const services = [{ service: 'EC2', amount: 0.5, color: '#202020' }]
  return { date, compute: 0.5, storage: 0, database: 0, network: 0, other: 0, total: 0.5, lineItems: 1, reportState: 'final', byServiceDisplay: services }
})

/** A run row as GET /analysis-runs gives it (placeholders). */
function runRow(over: Record<string, unknown> = {}) {
  return {
    id: 'run-row', status: 'completed', run_state: 'completed', source: 'discovery', recommendations_found: 0, total_potential_savings: null,
    started_at: '2026-11-25T06:00:00.000Z', completed_at: '2026-11-25T06:05:00.000Z', created_at: '2026-11-25T06:00:00.000Z', error_message: null,
    new_count: 0, refreshed_count: 0, unknown_resource_count: 0,
    checks: CATALOG.rules.filter((r) => r.status === 'implemented').map((r) => ({ rule_id: r.id, issue: 'issue' in r ? r.issue : r.id, outcome: 'complete', detected: 0, unknown: 0 })),
    ...over,
  }
}

/** The run's own result, as POST /analyze and GET my-result give it (cost-run-result.ts). */
function result(over: Partial<CostRunResult> = {}): CostRunResult {
  return {
    id: 'run-a', state: 'completed', completedAt: '2026-11-27T10:00:00.000Z', checksTotal: 13, checksRan: 13, failedChecks: [], services: CATALOG_SERVICES,
    newCount: 0, openCount: 0, stillOpen: 0, unknownResourceCount: 0, message: null, findingsUnchanged: false, ...over,
  }
}
const analyzeResponse = (r: CostRunResult) => ({ recommendationsFound: r.newCount ?? 0, totalPotentialSavings: 0, bySeverity: { high: 0, medium: 0, low: 0 }, timestamp: 't', runId: r.id, result: r })

function stats(active = 0) {
  return {
    totalRecommendations: active, activeRecommendations: active, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
    potentialSavingsCeiling: active > 0 ? 0.01 : 0, potentialSavingsCeilingByResourceType: active > 0 ? { 'EBS Snapshot': 0.01 } : {}, estimatedFindings: 0, unestimatedFindings: 0,
    bySeverity: { high: 0, medium: 0, low: active },
  }
}
const SNAPSHOT_REC = {
  id: 'rec-1', resourceId: 'snap-placeholder', resourceName: 'fixture-snapshot', resourceType: 'EBS Snapshot', issue: 'Old EBS Snapshot', potentialSavings: 0.01,
  severity: 'LOW', status: 'ACTIVE', metadata: { savings_basis: 'ceiling:snapshot_full_size' }, createdAt: '', updatedAt: '',
}
const EMPTY_HIDDEN = { latestRun: null, summary: { resolved: 0, dismissed: 0, stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 }, items: [] }

function newClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } })
}
function renderPage(client = newClient()) {
  const view = render(<QueryClientProvider client={client}><CostsPage /></QueryClientProvider>)
  return { ...view, client }
}
const banner = () => screen.getByTestId('scan-result-banner')
const optimizeNow = () => screen.getByTestId('optimize-now')
const opportunitiesText = () => screen.getByRole('region', { name: 'Optimization opportunities' }).textContent ?? ''
/** The page's header is ready (the connection check answered): Optimize Now is rendered. */
const ready = () => screen.findByTestId('optimize-now')

function setVisibility(state: 'visible' | 'hidden') {
  Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => state })
  document.dispatchEvent(new Event('visibilitychange'))
}

/** M, the number of checks in the run, as the banner states it: "N of M checks ran" (amber) or "M checks run" (green). */
function bannerM(): number {
  const text = within(banner()).getByTestId('scan-result-description').textContent ?? ''
  const gaps = text.match(/^(\d+) of (\d+) checks? ran\./)
  if (gaps) return Number(gaps[2])
  const all = text.match(/^(\d+) checks? run\b/)
  if (all) return Number(all[1])
  throw new Error(`no check count in the banner: ${text}`)
}

let fetchMock: ReturnType<typeof vi.fn>

beforeEach(() => {
  vi.clearAllMocks()
  m.demo = false
  m.role = 'admin'
  setVisibility('visible')
  svc.getCostSummary.mockResolvedValue(SUMMARY)
  svc.getStats.mockResolvedValue(stats())
  svc.getAll.mockResolvedValue([])
  svc.getAnalysisRuns.mockResolvedValue([runRow()])
  svc.getRules.mockResolvedValue(CATALOG)
  svc.getHidden.mockResolvedValue(EMPTY_HIDDEN)
  svc.getMyRunResult.mockResolvedValue(null)
  svc.acknowledgeRunResult.mockResolvedValue(undefined)
  fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: TREND }) })
  vi.stubGlobal('fetch', fetchMock)
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('Optimize Now runs the cost analysis; the result banner shows at the top of the page', () => {
  it('GREEN: running at once (no ×, button disabled and busy, Last analysis "Running…"), then the run\'s own result above the title; seen → acknowledged once', async () => {
    let finish!: (value: unknown) => void
    svc.analyze.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    renderPage()
    await ready()
    await waitFor(() => expect(optimizeNow()).toBeEnabled())
    expect(optimizeNow().tagName).toBe('BUTTON')
    fireEvent.click(optimizeNow())

    expect(svc.analyze).toHaveBeenCalledTimes(1)
    await waitFor(() => expect(banner()).toHaveAttribute('data-phase', 'running'))
    expect(within(banner()).getByText('Cost analysis running. This can take a few minutes.')).toBeInTheDocument()
    expect(within(banner()).queryByRole('button', { name: 'Close' })).not.toBeInTheDocument()
    expect(optimizeNow()).toBeDisabled()
    expect(optimizeNow()).toHaveAttribute('aria-busy', 'true')
    expect(screen.getByTestId('last-analysis')).toHaveTextContent('Running…')

    await act(async () => { finish(analyzeResponse(result())) })

    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    expect(within(banner()).getByTestId('scan-result-title')).toHaveTextContent('Cost analysis complete')
    expect(within(banner()).getByTestId('scan-result-description'))
      .toHaveTextContent('13 checks run across EC2, EBS, RDS, S3, Lambda, DynamoDB, NAT Gateway and CloudWatch · No opportunities found')
    const heading = screen.getByRole('heading', { level: 1, name: 'Cost Intelligence' })
    expect(banner().compareDocumentPosition(heading) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    await waitFor(() => expect(svc.acknowledgeRunResult).toHaveBeenCalledWith('run-a'))
    expect(svc.acknowledgeRunResult).toHaveBeenCalledTimes(1)
    expect(optimizeNow()).toBeEnabled()
    expectNoMoneyZero(banner().textContent ?? '')
  })

  it('AMBER: completed with gaps, the counts and the reason from the run itself', async () => {
    svc.analyze.mockResolvedValue(analyzeResponse(result({
      state: 'partial', checksRan: 11, failedChecks: [{ reason: 'permissions', count: 2 }], newCount: 1, openCount: 1, stillOpen: 0,
    })))
    renderPage()
    await ready()
    await waitFor(() => expect(optimizeNow()).toBeEnabled())
    fireEvent.click(optimizeNow())
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'warning'))
    expect(within(banner()).getByTestId('scan-result-title')).toHaveTextContent('Cost analysis completed with gaps')
    expect(within(banner()).getByTestId('scan-result-description'))
      .toHaveTextContent("11 of 13 checks ran. 2 checks couldn't run because of missing permissions. Findings from the completed checks are up to date.")
    expect(within(banner()).getByRole('button', { name: 'Close' })).toBeInTheDocument()
    expect(within(banner()).queryByRole('button', { name: 'Try again' })).not.toBeInTheDocument()
  })

  it('RED: the request failed; the run\'s own record gives the reason; Try again starts a new run', async () => {
    svc.analyze.mockRejectedValueOnce(Object.assign(new Error('Request failed'), { status: 500 }))
    svc.getMyRunResult.mockResolvedValueOnce(null) // the page's first look: nothing pending
    svc.getMyRunResult.mockResolvedValue(result({ id: 'run-f', state: 'failed', checksRan: 0, services: [], newCount: null, openCount: null, stillOpen: null, unknownResourceCount: null, message: 'No cost check completed. Try again.' }))
    renderPage()
    await ready()
    await waitFor(() => expect(optimizeNow()).toBeEnabled())
    fireEvent.click(optimizeNow())
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'danger'))
    expect(within(banner()).getByTestId('scan-result-title')).toHaveTextContent("Cost analysis didn't finish")
    expect(within(banner()).getByTestId('scan-result-description')).toHaveTextContent(/^No cost check completed\.$/)
    expect(within(banner()).getByRole('alert')).toBeInTheDocument()

    svc.analyze.mockResolvedValue(analyzeResponse(result({ id: 'run-g' })))
    fireEvent.click(within(banner()).getByRole('button', { name: 'Try again' }))
    expect(svc.analyze).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
  })

  it('RED with no run row (it couldn\'t be created): shown for this session only, never acknowledged', async () => {
    svc.analyze.mockRejectedValue(Object.assign(new Error('Request failed'), { status: 500 }))
    renderPage()
    await ready()
    await waitFor(() => expect(optimizeNow()).toBeEnabled())
    fireEvent.click(optimizeNow())
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'danger'))
    fireEvent.click(within(banner()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(svc.acknowledgeRunResult).not.toHaveBeenCalled()
  })

  it('"See the new opportunity" brings the Costs page\'s Opportunities into view and focuses its heading', async () => {
    svc.getStats.mockResolvedValue(stats(1))
    svc.getAll.mockResolvedValue([SNAPSHOT_REC])
    svc.getMyRunResult.mockResolvedValue(result({ newCount: 1, openCount: 1, stillOpen: 0 }))
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    renderPage()
    fireEvent.click(await within(await screen.findByTestId('scan-result-banner')).findByRole('button', { name: 'See the new opportunity' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView.mock.contexts[0]).toBe(document.getElementById('opportunities'))
    expect(document.activeElement).toBe(screen.getByRole('heading', { name: 'Optimization opportunities' }))
  })

  it('ruling Q10: after the run, findings, savings and status refresh; spend and the trend are not fetched again', async () => {
    svc.analyze.mockResolvedValue(analyzeResponse(result()))
    renderPage()
    await ready()
    await waitFor(() => expect(optimizeNow()).toBeEnabled())
    await screen.findByTestId('trend-total')
    const before = { stats: svc.getStats.mock.calls.length, recs: svc.getAll.mock.calls.length, runs: svc.getAnalysisRuns.mock.calls.length }
    const spendCalls = svc.getCostSummary.mock.calls.length
    const trendCalls = fetchMock.mock.calls.length
    fireEvent.click(optimizeNow())
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    await waitFor(() => {
      expect(svc.getStats.mock.calls.length).toBeGreaterThan(before.stats)
      expect(svc.getAll.mock.calls.length).toBeGreaterThan(before.recs)
      expect(svc.getAnalysisRuns.mock.calls.length).toBeGreaterThan(before.runs)
    })
    expect(svc.getCostSummary.mock.calls.length).toBe(spendCalls)
    expect(fetchMock.mock.calls.length).toBe(trendCalls)
  })
})

describe('the one-time lifecycle on this page (#368, unchanged)', () => {
  it('a result that finished while the user was away shows once, is acknowledged, and a refresh never replays it (the server is asked again, never the cache)', async () => {
    svc.getMyRunResult.mockResolvedValueOnce(result())
    const client = newClient()
    const first = renderPage(client)
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    await waitFor(() => expect(svc.acknowledgeRunResult).toHaveBeenCalledWith('run-a'))
    first.unmount()

    // Navigating back (same client): the server has the result acknowledged, so it answers null.
    renderPage(client)
    await ready()
    await waitFor(() => expect(svc.getMyRunResult).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(svc.acknowledgeRunResult).toHaveBeenCalledTimes(1)
  })

  it('× closes it and acknowledges it; it stays closed (no auto-hide before that)', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    svc.getMyRunResult.mockResolvedValue(result())
    renderPage()
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    await act(async () => { await vi.advanceTimersByTimeAsync(60_000) })
    expect(banner()).toBeInTheDocument()
    fireEvent.click(within(banner()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(svc.acknowledgeRunResult).toHaveBeenCalledWith('run-a')
  })

  it('seen on Costs → not replayed on Cost Optimization: the other page asks the server again (shared, server-side acknowledgement)', async () => {
    svc.getMyRunResult.mockResolvedValueOnce(result())
    const client = newClient()
    const costs = renderPage(client)
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    await waitFor(() => expect(svc.acknowledgeRunResult).toHaveBeenCalledWith('run-a'))
    costs.unmount()

    // The other page mounts at once (same commit), before gcTime 0 has dropped the cached answer: not even its first
    // render shows the result, and it is not acknowledged again.
    render(<QueryClientProvider client={client}><CostOptimizationPage /></QueryClientProvider>)
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    await screen.findByRole('heading', { level: 1, name: 'Cost Optimization' })
    await waitFor(() => expect(svc.getMyRunResult).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(svc.acknowledgeRunResult).toHaveBeenCalledTimes(1)
  })

  it('closed on Costs → never replayed on Cost Optimization, not even from the cached answer', async () => {
    // The server is slow to answer the second page: the cached answer is all it has for a while.
    svc.getMyRunResult.mockResolvedValueOnce(result()).mockReturnValue(pending())
    const client = newClient()
    const costs = renderPage(client)
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    fireEvent.click(within(banner()).getByRole('button', { name: 'Close' }))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    costs.unmount()

    render(<QueryClientProvider client={client}><CostOptimizationPage /></QueryClientProvider>)
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    await screen.findByRole('heading', { level: 1, name: 'Cost Optimization' })
    await waitFor(() => expect(svc.getMyRunResult).toHaveBeenCalledTimes(2))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(svc.acknowledgeRunResult).toHaveBeenCalledTimes(1)
  })

  it('a failed acknowledge is not remembered: the result shows again on the next visit (never lost)', async () => {
    svc.acknowledgeRunResult.mockRejectedValue(new Error('network'))
    svc.getMyRunResult.mockResolvedValue(result())
    const client = newClient()
    const first = renderPage(client)
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    await waitFor(() => expect(svc.acknowledgeRunResult).toHaveBeenCalledTimes(1))
    await act(async () => { await Promise.resolve() })
    first.unmount()
    renderPage(client)
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
  })

  it('a result fetched while the tab is hidden is neither shown nor acknowledged; once visible the page asks again, then shows and acknowledges it', async () => {
    setVisibility('hidden')
    svc.getMyRunResult.mockResolvedValue(result())
    renderPage()
    await ready()
    await waitFor(() => expect(svc.getMyRunResult).toHaveBeenCalledTimes(1))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(svc.acknowledgeRunResult).not.toHaveBeenCalled()

    act(() => setVisibility('visible'))
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    expect(svc.getMyRunResult).toHaveBeenCalledTimes(2)
    await waitFor(() => expect(svc.acknowledgeRunResult).toHaveBeenCalledWith('run-a'))
  })

  it('a scheduled run never produces a banner: nothing pending for this user, nothing shown or acknowledged', async () => {
    svc.getAnalysisRuns.mockResolvedValue([runRow({ source: 'discovery', completed_at: new Date().toISOString() })])
    const { container } = renderPage()
    await ready()
    await waitFor(() => expect(svc.getMyRunResult).toHaveBeenCalled())
    await waitFor(() => expect(screen.getByTestId('last-analysis')).toHaveTextContent('(scheduled)'))
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(container.textContent).not.toMatch(/Cost analysis complete/)
    expect(svc.acknowledgeRunResult).not.toHaveBeenCalled()
  })

  it('a run this user started elsewhere, still running: the running banner here, and Optimize Now waits for it', async () => {
    svc.getMyRunResult.mockResolvedValue(result({ state: 'running', completedAt: null }))
    renderPage()
    await waitFor(() => expect(banner()).toHaveAttribute('data-phase', 'running'))
    expect(optimizeNow()).toBeDisabled()
  })

  it('demo mode: no request for a result, no banner, Optimize Now disabled', async () => {
    m.demo = true
    renderPage()
    await ready()
    expect(optimizeNow()).toBeDisabled()
    expect(svc.getMyRunResult).not.toHaveBeenCalled()
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
  })
})

describe('ruling Q9: Optimize Now for members and viewers (the backend\'s rule: owners and admins only)', () => {
  it.each(['member', 'viewer'])('%s: disabled, with the short note tied to the button; clicking does nothing', async (role) => {
    m.role = role
    renderPage()
    await ready()
    expect(optimizeNow()).toBeDisabled()
    const note = screen.getByTestId('optimize-now-role-note')
    expect(note).toHaveTextContent(RUN_ANALYSIS_ROLE_NOTE)
    expect(RUN_ANALYSIS_ROLE_NOTE).toBe('Only owners and admins can run cost analysis.')
    expect(optimizeNow()).toHaveAttribute('aria-describedby', note.id)
    fireEvent.click(optimizeNow())
    expect(svc.analyze).not.toHaveBeenCalled()
  })

  it.each(['owner', 'admin'])('%s: enabled, no note', async (role) => {
    m.role = role
    renderPage()
    await ready()
    await waitFor(() => expect(optimizeNow()).toBeEnabled())
    expect(screen.queryByTestId('optimize-now-role-note')).not.toBeInTheDocument()
    expect(optimizeNow()).not.toHaveAttribute('aria-describedby')
  })

  it('role not known yet: disabled, with no note (fails closed, never offers an action it can\'t confirm)', async () => {
    m.role = null
    renderPage()
    await ready()
    expect(optimizeNow()).toBeDisabled()
    expect(screen.queryByTestId('optimize-now-role-note')).not.toBeInTheDocument()
  })
})

describe('safeguard 3: the "Cost checks" tile\'s count equals the banner\'s M for the same run', () => {
  it.each([
    ['green (every check ran)', result()],
    ['amber (some checks couldn\'t run)', result({ state: 'partial', checksRan: 12, failedChecks: [{ reason: 'timeout', count: 1 }] })],
    ['amber (resources not fully checked)', result({ unknownResourceCount: 3 })],
  ])('%s', async (_name, run) => {
    svc.getMyRunResult.mockResolvedValue(run)
    renderPage()
    await waitFor(() => expect(banner()).toHaveAttribute('data-phase', 'result'))
    await waitFor(() => expect(screen.getByTestId('kpi-checks-value')).not.toHaveTextContent('—'))
    expect(Number(screen.getByTestId('kpi-checks-value').textContent)).toBe(bannerM())
    expect(bannerM()).toBe(run.checksTotal)
  })

  it('green: the tile\'s service categories are the services the banner says the checks ran across', async () => {
    svc.getMyRunResult.mockResolvedValue(result())
    renderPage()
    await waitFor(() => expect(banner()).toHaveAttribute('data-tone', 'success'))
    await waitFor(() => expect(screen.getByTestId('kpi-checks-services')).toBeInTheDocument())
    const tileNames = (screen.getByTestId('kpi-checks-services').textContent ?? '').split(' · ')
    const across = (within(banner()).getByTestId('scan-result-description').textContent ?? '').match(/ across (.*?)( · |$)/)![1]
    expect(across.replace(' and ', ', ').split(', ')).toEqual(tileNames)
  })
})

describe('review RN-1: Opportunities never says "Run cost analysis" while an analysis runs or after one didn\'t complete', () => {
  it('this page\'s own run is in flight (no open findings): the card says it is in progress, like the savings tile', async () => {
    svc.analyze.mockReturnValue(pending())
    renderPage()
    await ready()
    await waitFor(() => expect(optimizeNow()).toBeEnabled())
    await waitFor(() => expect(screen.getByTestId('opportunities-empty')).toBeInTheDocument())
    fireEvent.click(optimizeNow())
    await waitFor(() => expect(screen.getByTestId('opportunities-empty')).toHaveTextContent('Cost analysis in progress.'))
    expect(screen.getByTestId('kpi-savings')).toHaveTextContent('Cost analysis in progress')
    expect(opportunitiesText()).not.toMatch(/Run cost analysis/)
  })

  it('the latest run is running (started elsewhere): "Cost analysis in progress."', async () => {
    svc.getAnalysisRuns.mockResolvedValue([runRow({ status: 'running', run_state: 'running', completed_at: null, checks: null })])
    renderPage()
    await waitFor(() => expect(screen.getByTestId('opportunities-empty')).toHaveTextContent('Cost analysis in progress.'))
    expect(opportunitiesText()).not.toMatch(/Run cost analysis/)
  })

  it('the latest run failed: "Latest cost analysis did not complete."', async () => {
    svc.getAnalysisRuns.mockResolvedValue([runRow({ status: 'failed', run_state: 'failed', checks: [] })])
    renderPage()
    await waitFor(() => expect(screen.getByTestId('opportunities-empty')).toHaveTextContent('Latest cost analysis did not complete.'))
    expect(screen.getByTestId('kpi-savings')).toHaveTextContent('Latest cost analysis did not complete')
    expect(opportunitiesText()).not.toMatch(/Run cost analysis/)
  })

  it('no analysis has run yet: the card keeps its prompt', async () => {
    svc.getAnalysisRuns.mockResolvedValue([])
    renderPage()
    await waitFor(() => expect(screen.getByTestId('opportunities-empty')).toHaveTextContent(OPPORTUNITIES_EMPTY))
  })
})

describe('review RN-3: the Opportunities loading state is a boolean, not the tile\'s display text', () => {
  it('while the analysis status is loading (stats loaded, nothing open): "—", never the empty text', async () => {
    svc.getAnalysisRuns.mockReturnValue(pending())
    renderPage()
    await waitFor(() => expect(screen.getByTestId('opportunities-loading')).toHaveTextContent('—'))
    expect(screen.queryByTestId('opportunities-empty')).not.toBeInTheDocument()
  })

  it('while /stats is loading: "—"', async () => {
    svc.getStats.mockReturnValue(pending())
    renderPage()
    await waitFor(() => expect(screen.getByTestId('opportunities-loading')).toBeInTheDocument())
  })

  it('the page never derives a loading state by comparing against the "Loading…" display string', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const source = readFileSync(join(process.cwd(), 'app/(app)/costs/page.tsx'), 'utf8')
    expect(source).not.toMatch(/===\s*'Loading…'/)
    expect(source).toMatch(/isLoading=\{!isDemoActive && \(activeRecsLoading \|\| recsInputsLoading\)\}/)
  })
})
