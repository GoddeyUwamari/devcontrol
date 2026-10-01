/**
 * The Dashboard's evidence-aware spend KPI, end to end through the real
 * DashboardPage:
 *   - the connection gates and the /connect-aws redirect still read only
 *     /api/aws/accounts and /api/platform/stats/dashboard (monthlyAwsCost et
 *     al.), so they behave identically whatever the Cost Explorer evidence
 *     says ($0, net credit, unavailable, error, failed request) -- including
 *     connected via only one of those signals, and an unconnected account
 *     still being redirected;
 *   - the AI Summary request carries nothing from the page (no MoM value);
 *   - a failed or empty cost trend reads as such, not as a $0 chart.
 * All figures are test fixtures, not production data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
 * What /api/platform/stats/dashboard (unchanged) returns: an account with
 * billing data, one whose legacy figure is 0 with services but no billing data
 * yet, and one with nothing at all yet.
 */
const LEGACY_STATS: Record<'billing' | 'servicesOnly' | 'zero', PlatformDashboardStats> = {
  billing: { totalServices: 3, servicesChange: 0, activeDeployments: 1, deploymentsChange: 0, monthlyAwsCost: 100, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual' },
  servicesOnly: { totalServices: 3, servicesChange: 0, activeDeployments: 0, deploymentsChange: 0, monthlyAwsCost: 0, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'estimated' },
  zero: { totalServices: 0, servicesChange: 0, activeDeployments: 0, deploymentsChange: 0, monthlyAwsCost: 0, costChange: 0, totalTeams: 0, teamsChange: 0, costSource: 'estimated' },
}
const SYNCING_BANNER = /Historical billing data is still syncing/
const BILLING_SYNC_BANNER = /Billing sync in progress/
const CONNECTED_ACCOUNTS = [{ id: 'acct' }]

let client: QueryClient
let trendResponse: { ok: boolean; data: unknown[] }
/** What /api/aws/accounts returns (the other connection signal besides the legacy stats). */
let awsAccounts: unknown[]

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
  // aws-accounts and cost-trend call fetch() directly: a connected account unless a test says otherwise.
  awsAccounts = CONNECTED_ACCOUNTS
  vi.stubGlobal('fetch', vi.fn(async (url: string) => String(url).includes('/api/aws/accounts')
    ? { ok: true, json: async () => ({ data: awsAccounts }) }
    : { ok: trendResponse.ok, json: async () => (trendResponse.ok ? { success: true, data: trendResponse.data } : { success: false }) }))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderDashboard() {
  return render(<QueryClientProvider client={client}><DashboardPage /></QueryClientProvider>)
}
/** The spend KPI card (the one whose title links to /costs) showing `value`. */
function spendCard(value: string): HTMLElement | undefined {
  return screen.getAllByText(value)
    .map((el) => el.closest('[data-testid="kpi-card"]') as HTMLElement | null)
    .find((card): card is HTMLElement => !!card?.querySelector('a[href="/costs"]'))
}
/** The spend KPI card's face, once its figure has settled (not loading). */
async function spendCardText(expectedValue: string) {
  await waitFor(() => expect(spendCard(expectedValue)).toBeDefined())
  return spendCard(expectedValue)!.textContent ?? ''
}
/** The spend card's face plus its info panel, where provenance now lives. */
async function spendCardEvidenceText(expectedValue: string) {
  const face = await spendCardText(expectedValue)
  fireEvent.click(within(spendCard(expectedValue)!).getByRole('button', { name: /details$/ }))
  return `${face} ${(await screen.findByRole('dialog')).textContent ?? ''}`
}
/**
 * Waits until every input the redirect decision depends on has settled -- the
 * accounts list, the legacy stats, and the cost evidence -- so a "no redirect"
 * assertion can't pass merely because the accounts hadn't loaded yet.
 */
async function gateInputsSettled() {
  await waitFor(() => {
    expect(client.getQueryData(['aws-accounts', 'org-test'])).toBeDefined()
    expect(client.getQueryState(['platform-dashboard-stats', 'org-test'])?.status).toBe('success')
    expect(client.getQueryState(['platform-cost-summary', 'org-test'])?.status).not.toBe('pending')
  })
}

describe('connection gates and the /connect-aws redirect ignore the cost evidence', () => {
  for (const legacy of ['billing', 'servicesOnly'] as const) {
    it.each(EVIDENCE)(`legacy stats "${legacy}", evidence %s: never redirects, and the billing banner follows only the legacy stats`, async (_name, summary, value) => {
      setup(LEGACY_STATS[legacy], summary)
      renderDashboard()

      await spendCardText(value)
      await gateInputsSettled()
      expect(router.replace).not.toHaveBeenCalled()
      // hasServicesOnly comes from computeDashboardAwsGates(stats) alone.
      if (legacy === 'servicesOnly') expect(screen.getByText(SYNCING_BANNER)).toBeInTheDocument()
      else expect(screen.queryByText(SYNCING_BANNER)).not.toBeInTheDocument()
      // The primary KPI row renders (isAwsConnected) in every case.
      expect(screen.getByText('Security Posture')).toBeInTheDocument()
    })
  }

  // Connected through only one of the two legacy signals: the other can't mask
  // the evidence leaking into the connection decision.
  it.each(EVIDENCE)('accounts connected, all legacy stats zero, evidence %s: never redirects, and the billing-sync banner shows', async (_name, summary, value) => {
    setup(LEGACY_STATS.zero, summary)
    renderDashboard()

    await spendCardText(value)
    await gateInputsSettled()
    expect(router.replace).not.toHaveBeenCalled()
    // isBillingSyncing comes from computeDashboardAwsGates(stats) alone.
    expect(screen.getByText(BILLING_SYNC_BANNER)).toBeInTheDocument()
    expect(screen.queryByText(SYNCING_BANNER)).not.toBeInTheDocument()
  })

  it.each(EVIDENCE)('no accounts, legacy billing stats present, evidence %s: never redirects', async (_name, summary, value) => {
    awsAccounts = []
    setup(LEGACY_STATS.billing, summary)
    renderDashboard()

    await spendCardText(value)
    await gateInputsSettled()
    expect(router.replace).not.toHaveBeenCalled()
    expect(screen.queryByText(BILLING_SYNC_BANNER)).not.toBeInTheDocument()
    expect(screen.getByText('Security Posture')).toBeInTheDocument()
  })

  it.each(EVIDENCE)('no accounts and all legacy stats zero, evidence %s: still redirects to /connect-aws', async (_name, summary) => {
    awsAccounts = []
    setup(LEGACY_STATS.zero, summary)
    renderDashboard()

    await gateInputsSettled()
    await waitFor(() => expect(router.replace).toHaveBeenCalledWith('/connect-aws'))
    // Even actual Cost Explorer spend ($0 or a credit) does not make the account "connected".
    expect(screen.queryByText('Security Posture')).not.toBeInTheDocument()
  })
})

describe('the spend card reads the evidence', () => {
  it.each(EVIDENCE)('%s', async (name, summary, value) => {
    setup(LEGACY_STATS.billing, summary)
    renderDashboard()

    const text = await spendCardEvidenceText(value)
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
