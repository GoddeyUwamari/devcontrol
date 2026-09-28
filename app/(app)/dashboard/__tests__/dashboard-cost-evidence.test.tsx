/**
 * The Dashboard's evidence-aware spend KPI, end to end through the real
 * DashboardPage:
 *   - the connection gates and the /connect-aws redirect still read only
 *     /api/platform/stats/dashboard (monthlyAwsCost et al.), so they behave
 *     identically for a connected account whatever the Cost Explorer evidence
 *     says ($0, net credit, unavailable, error, failed request);
 *   - the AI Summary request carries nothing from the page (no MoM value);
 *   - a failed or empty cost trend reads as such, not as a $0 chart.
 * All figures are test fixtures, not production data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardPage from '../page'
import type { CostSummary, PlatformDashboardStats } from '@/lib/types'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import { monitoringService } from '@/lib/services/monitoring.service'
import { costRecommendationsService } from '@/lib/services/cost-recommendations.service'
import { accountSecurityFindingsService } from '@/lib/services/account-security-findings.service'
import { awsResourcesService } from '@/lib/services/aws-resources.service'
import { aiSummaryService } from '@/lib/services/ai-summary.service'
import { systemIntelligenceService } from '@/lib/services/system-intelligence.service'
import { activityFeedService } from '@/lib/services/activity-feed.service'
import { soc2Service } from '@/lib/services/soc2.service'
import { complianceFrameworksService } from '@/lib/services/compliance-frameworks.service'

const router = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn(), refresh: vi.fn(), back: vi.fn(), forward: vi.fn(), prefetch: vi.fn() }))
vi.mock('next/navigation', () => ({ useRouter: () => router, usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams() }))
vi.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: null, isConnected: false }) }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }),
}))

type SpendSection = CostSummary['spend']
type MomSection = CostSummary['monthOverMonth']
const actual = (amount: number): SpendSection => ({
  state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: null, coverage: null, reason: null,
  data: { amount, basis: 'billed_month_to_date', lastDayInProgress: false },
})
const noSpend = (state: 'unavailable' | 'error'): SpendSection =>
  ({ state, source: 'AWS Cost Explorer', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null })
const noMom = (state: 'unavailable' | 'error'): MomSection =>
  ({ state, source: 'DevControl month-over-month comparison', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null })

/** Cost Explorer evidence scenarios for one connected account. `null` = the summary request itself fails. */
const EVIDENCE: Array<[string, CostSummary | null, string]> = [
  ['actual $0', { spend: actual(0), monthOverMonth: noMom('unavailable') }, '$0.00'],
  ['net credit', { spend: actual(-12.34), monthOverMonth: noMom('unavailable') }, '-$12.34'],
  ['unavailable', { spend: noSpend('unavailable'), monthOverMonth: noMom('unavailable') }, '—'],
  ['error', { spend: noSpend('error'), monthOverMonth: noMom('error') }, '—'],
  ['failed request', null, '—'],
]

/**
 * What /api/platform/stats/dashboard (unchanged) returns for a connected account:
 * one with billing data, and one whose legacy figure is 0 with no billing data yet.
 */
const LEGACY_STATS: Record<'billing' | 'servicesOnly', PlatformDashboardStats> = {
  billing: { totalServices: 3, servicesChange: 0, activeDeployments: 1, deploymentsChange: 0, monthlyAwsCost: 100, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual' },
  servicesOnly: { totalServices: 3, servicesChange: 0, activeDeployments: 0, deploymentsChange: 0, monthlyAwsCost: 0, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'estimated' },
}
const SYNCING_BANNER = /Historical billing data is still syncing/

let client: QueryClient
let trendResponse: { ok: boolean; data: unknown[] }

function setup(stats: PlatformDashboardStats, summary: CostSummary | null) {
  vi.spyOn(platformStatsService, 'getDashboardStats').mockResolvedValue(stats)
  if (summary) vi.spyOn(platformStatsService, 'getCostSummary').mockResolvedValue(summary)
  else vi.spyOn(platformStatsService, 'getCostSummary').mockRejectedValue(new Error('HTTP 500'))
}

beforeEach(() => {
  localStorage.clear()
  router.replace.mockClear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(monitoringService, 'getSystemHealth').mockResolvedValue({ status: 'operational' } as never)
  vi.spyOn(costRecommendationsService, 'getAll').mockResolvedValue([] as never)
  vi.spyOn(costRecommendationsService, 'getStats').mockResolvedValue({ totalPotentialSavings: 0, activeRecommendations: 0 } as never)
  vi.spyOn(costRecommendationsService, 'getAnalysisRuns').mockResolvedValue([] as never)
  vi.spyOn(aiSummaryService, 'getSummary').mockResolvedValue({ topRisk: null } as never)
  vi.spyOn(systemIntelligenceService, 'getIntelligence').mockResolvedValue(null as never)
  vi.spyOn(activityFeedService, 'getActivity').mockResolvedValue([] as never)
  vi.spyOn(accountSecurityFindingsService, 'getStats').mockResolvedValue({ bySeverity: { critical: 0, high: 0, medium: 0, low: 0 } } as never)
  vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: null } as never)
  vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue([] as never)
  vi.spyOn(complianceFrameworksService, 'getFrameworks').mockResolvedValue([] as never)
  trendResponse = { ok: true, data: [{ date: '2026-09-26', compute: 1, storage: 0, database: 0, network: 0, other: 0, total: 1 }, { date: '2026-09-27', compute: 2, storage: 0, database: 0, network: 0, other: 0, total: 2 }] }
  // aws-accounts and cost-trend call fetch() directly: a connected account.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('/api/aws/accounts')
    ? { ok: true, json: async () => ({ data: [{ id: 'acct' }] }) }
    : { ok: trendResponse.ok, json: async () => (trendResponse.ok ? { success: true, data: trendResponse.data } : { success: false }) }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderDashboard() {
  return render(<QueryClientProvider client={client}><DashboardPage /></QueryClientProvider>)
}
/** The spend KPI card, once its figure has settled (not loading). */
async function spendCardText(expectedValue: string) {
  await waitFor(() => {
    const value = screen.getAllByText(expectedValue).find((el) => el.closest('a[href="/costs"]'))
    expect(value).toBeDefined()
  })
  return (screen.getAllByText(expectedValue).find((el) => el.closest('a[href="/costs"]'))!.closest('a') as HTMLElement).textContent ?? ''
}

describe('connection gates and the /connect-aws redirect ignore the cost evidence', () => {
  for (const legacy of ['billing', 'servicesOnly'] as const) {
    it.each(EVIDENCE)(`legacy stats "${legacy}", evidence %s: never redirects, and the billing banner follows only the legacy stats`, async (_name, summary, value) => {
      setup(LEGACY_STATS[legacy], summary)
      renderDashboard()

      await spendCardText(value)
      await waitFor(() => expect(platformStatsService.getCostSummary).toHaveBeenCalled())
      expect(router.replace).not.toHaveBeenCalled()
      // hasServicesOnly comes from computeDashboardAwsGates(stats) alone.
      if (legacy === 'servicesOnly') expect(screen.getByText(SYNCING_BANNER)).toBeInTheDocument()
      else expect(screen.queryByText(SYNCING_BANNER)).not.toBeInTheDocument()
      // The primary KPI row renders (isAwsConnected) in every case.
      expect(screen.getByText('Security Posture')).toBeInTheDocument()
    })
  }
})

describe('the spend card reads the evidence', () => {
  it.each(EVIDENCE)('%s', async (name, summary, value) => {
    setup(LEGACY_STATS.billing, summary)
    renderDashboard()

    const text = await spendCardText(value)
    expect(text).not.toMatch(/Syncing…|flat|stable|no change/i)
    // The legacy monthlyAwsCost (fixture $100) is never shown as the spend figure.
    expect(text).not.toContain('$100.00')
    if (name === 'failed request' || name === 'error') expect(text).toMatch(/Could not be retrieved/)
    if (name === 'unavailable') expect(text).toMatch(/Not available/)
    if (name.startsWith('actual') || name === 'net credit') expect(text).toMatch(/Actual · AWS Cost Explorer/)
  })
})

describe('AI Summary input', () => {
  it('the page sends the AI Summary request nothing -- no month-over-month value in any state', async () => {
    for (const [, summary, value] of EVIDENCE) {
      vi.mocked(aiSummaryService.getSummary).mockClear()
      setup(LEGACY_STATS.billing, summary)
      const { unmount } = renderDashboard()
      await spendCardText(value)
      await waitFor(() => expect(aiSummaryService.getSummary).toHaveBeenCalled())
      for (const call of vi.mocked(aiSummaryService.getSummary).mock.calls) expect(call).toEqual([])
      unmount()
      client.clear()
    }
  })
})

describe('cost trend states', () => {
  it('a failed trend request reads as a failure, not an empty chart', async () => {
    setup(LEGACY_STATS.billing, { spend: actual(3), monthOverMonth: noMom('unavailable') })
    trendResponse = { ok: false, data: [] }
    renderDashboard()

    expect(await screen.findByText('The cost trend could not be retrieved from AWS Cost Explorer.')).toBeInTheDocument()
  })

  it('a successful empty trend says there is no data for the range', async () => {
    setup(LEGACY_STATS.billing, { spend: actual(3), monthOverMonth: noMom('unavailable') })
    trendResponse = { ok: true, data: [] }
    renderDashboard()

    expect(await screen.findByText('No AWS Cost Explorer data is available for this range.')).toBeInTheDocument()
    expect(screen.queryByText('The cost trend could not be retrieved from AWS Cost Explorer.')).not.toBeInTheDocument()
  })
})
