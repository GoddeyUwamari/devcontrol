/**
 * Security Key Findings error states, end to end through the real DashboardPage:
 * the page's own queries/hooks fail (network doubles reject), and the card must say
 * "Unavailable" rather than a legitimate-looking empty/zero result. Also pins the
 * genuine-empty states, useComplianceFrameworks' actual error semantics, and demo
 * mode. Component-level state coverage lives in
 * components/dashboard/__tests__/security-compliance-summary-error-states.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardPage from '../page'
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

vi.mock('next/navigation', () => {
  const router = { push: () => {}, replace: () => {}, refresh: () => {}, back: () => {}, forward: () => {}, prefetch: () => {} }
  return { useRouter: () => router, usePathname: () => '/dashboard', useSearchParams: () => new URLSearchParams() }
})
vi.mock('@/lib/hooks/useWebSocket', () => ({ useWebSocket: () => ({ socket: null, isConnected: false }) }))
vi.mock('@/lib/contexts/auth-context', () => ({
  useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }),
}))

const EMPTY_FINDINGS_TEXT = 'No open account-level findings recorded yet.'
const httpError = (status: number) => Object.assign(new Error(`HTTP ${status}`), { response: { status } })
const networkError = () => new Error('Network Error') // axios network failure: no `response`
const UNEVALUATED_SOC2 = Array.from({ length: 6 }, (_, i) => ({
  criterionId: `CC${i}`, name: 'n', evidenceClaim: 'c', limitation: 'l', dispositionClass: 'A_OBSERVABLE', evaluated: false, evidenceSummary: null, computedAt: null,
}))

let client: QueryClient
const spies = {} as Record<'findings' | 'resources' | 'soc2' | 'frameworks', ReturnType<typeof vi.fn>>

beforeEach(() => {
  localStorage.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})

  // The rest of the dashboard: connected account with billing data, so the card renders.
  vi.spyOn(platformStatsService, 'getDashboardStats').mockResolvedValue({
    totalServices: 3, servicesChange: 0, activeDeployments: 1, deploymentsChange: 0, monthlyAwsCost: 100, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual',
  } as never)
  vi.spyOn(monitoringService, 'getSystemHealth').mockResolvedValue({ status: 'operational' } as never)
  vi.spyOn(costRecommendationsService, 'getAll').mockResolvedValue([] as never)
  vi.spyOn(costRecommendationsService, 'getStats').mockResolvedValue({ totalPotentialSavings: 0, activeRecommendations: 0 } as never)
  vi.spyOn(costRecommendationsService, 'getAnalysisRuns').mockResolvedValue([] as never)
  vi.spyOn(aiSummaryService, 'getSummary').mockResolvedValue({ topRisk: null } as never)
  vi.spyOn(systemIntelligenceService, 'getIntelligence').mockResolvedValue(null as never)
  vi.spyOn(activityFeedService, 'getActivity').mockResolvedValue([] as never)
  // aws-accounts and cost-trend call fetch() directly.
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => ({ data: String(url).includes('/api/aws/accounts') ? [{ id: 'acct' }] : [] }),
  })))

  // The four Key Findings sources -- genuine-empty successes by default; tests override.
  spies.findings = vi.spyOn(accountSecurityFindingsService, 'getStats').mockResolvedValue({ bySeverity: { critical: 0, high: 0, medium: 0, low: 0 } } as never) as never
  spies.resources = vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: { total_issues: 0, by_severity: { critical: 0, high: 0, medium: 0, low: 0 }, by_category: {} } } as never) as never
  spies.soc2 = vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue(UNEVALUATED_SOC2 as never) as never
  spies.frameworks = vi.spyOn(complianceFrameworksService, 'getFrameworks').mockResolvedValue([] as never) as never
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

function renderDashboard() {
  return render(<QueryClientProvider client={client}><DashboardPage /></QueryClientProvider>)
}
/** Resolves once the card has left its loading state. */
async function card() {
  const heading = await screen.findByText('Security Key Findings')
  const root = heading.closest('div.rounded-2xl') as HTMLElement
  await waitFor(() => {
    expect(within(root).getByText('Resource compliance')).toBeInTheDocument()
    expect(within(root).getByText('SOC 2 readiness')).toBeInTheDocument()
    expect(within(root).getByText('Custom frameworks')).toBeInTheDocument()
  })
  return within(root)
}
const subOf = (c: ReturnType<typeof within>, headline: string) =>
  (c.getByText(headline).parentElement as HTMLElement).lastElementChild?.textContent

describe('failed requests render "Unavailable" through the real page wiring', () => {
  it('every Key Findings request failing -> four "Unavailable" states and none of the empty/zero texts', async () => {
    spies.findings.mockRejectedValue(httpError(500))
    spies.resources.mockRejectedValue(httpError(500))
    spies.soc2.mockRejectedValue(httpError(500))
    spies.frameworks.mockRejectedValue(httpError(500))
    renderDashboard()
    const c = await card()
    await waitFor(() => expect(c.getByText('Account-level findings: Unavailable')).toBeInTheDocument())
    await waitFor(() => expect(subOf(c, 'Custom frameworks')).toBe('Unavailable'))
    expect(subOf(c, 'Resource compliance')).toBe('Unavailable')
    expect(subOf(c, 'SOC 2 readiness')).toBe('Unavailable')
    for (const emptyText of [EMPTY_FINDINGS_TEXT, 'Not yet evaluated', '0 of 6 criteria evaluated', 'No custom frameworks yet']) {
      expect(c.queryByText(emptyText)).not.toBeInTheDocument()
    }
  })

  it('each failure is independent: only the failed fact says "Unavailable"', async () => {
    spies.findings.mockRejectedValue(httpError(503))
    renderDashboard()
    const c = await card()
    await waitFor(() => expect(c.getByText('Account-level findings: Unavailable')).toBeInTheDocument())
    expect(subOf(c, 'Resource compliance')).toBe('Not yet evaluated')
    await waitFor(() => expect(subOf(c, 'SOC 2 readiness')).toBe('0 of 6 criteria evaluated'))
    expect(c.getAllByText(/Unavailable/)).toHaveLength(1)
  })
})

describe('genuine successful results keep their existing states', () => {
  it('all four sources succeed with nothing to report -> the existing empty/zero texts, no "Unavailable"', async () => {
    renderDashboard()
    const c = await card()
    await waitFor(() => expect(c.getByText(EMPTY_FINDINGS_TEXT)).toBeInTheDocument())
    expect(subOf(c, 'Resource compliance')).toBe('Not yet evaluated')
    await waitFor(() => expect(subOf(c, 'SOC 2 readiness')).toBe('0 of 6 criteria evaluated'))
    expect(subOf(c, 'Custom frameworks')).toBe('No custom frameworks yet')
    expect(c.queryByText(/Unavailable/)).not.toBeInTheDocument()
  })
})

describe('custom frameworks follow useComplianceFrameworks\' actual error semantics', () => {
  it('an HTTP error the hook reports (e.g. 500) -> "Unavailable"', async () => {
    spies.frameworks.mockRejectedValue(httpError(500))
    renderDashboard()
    const c = await card()
    await waitFor(() => expect(subOf(c, 'Custom frameworks')).toBe('Unavailable'))
  })

  it('a 404 or a network failure the hook deliberately swallows -> still "No custom frameworks yet" (hook unchanged)', async () => {
    for (const err of [httpError(404), networkError()]) {
      spies.frameworks.mockRejectedValue(err)
      const { unmount } = renderDashboard()
      const c = await card()
      await waitFor(() => expect(spies.frameworks).toHaveBeenCalled())
      await waitFor(() => expect(subOf(c, 'Custom frameworks')).toBe('No custom frameworks yet'))
      unmount()
      spies.frameworks.mockClear()
    }
  })
})

describe('demo mode is unchanged', () => {
  it('demo values render and no failure can surface as "Unavailable"', async () => {
    localStorage.setItem('devcontrol_demo_mode', 'true')
    for (const spy of Object.values(spies)) spy.mockRejectedValue(httpError(500))
    renderDashboard()
    const c = await card()
    expect(c.getByText('1 critical finding')).toBeInTheDocument()
    expect(subOf(c, 'Custom frameworks')).toBe('4 frameworks · Security Hub-backed')
    await waitFor(() => expect(spies.frameworks).toHaveBeenCalled())
    expect(c.queryByText(/Unavailable/)).not.toBeInTheDocument()
    expect(spies.findings).not.toHaveBeenCalled()
    expect(spies.resources).not.toHaveBeenCalled()
    expect(spies.soc2).not.toHaveBeenCalled()
  })
})
