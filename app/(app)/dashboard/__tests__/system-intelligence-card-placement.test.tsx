/**
 * Infrastructure Posture card placement, through the real DashboardPage:
 * a standalone full-width card directly below Infrastructure Intelligence and
 * above AWS Cost Trends / Security Key Findings, fed by the page's existing
 * System Intelligence query (one request, no second fetch), and absent in demo
 * mode. Component behavior is covered in
 * components/dashboard/__tests__/system-intelligence-card.test.tsx.
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

const component = (label: string, score: number, status: 'good' | 'warning' | 'risk') =>
  ({ score, label, detail: '', severity: 'healthy', delta: null, status, ready: true, state: 'available', reason: null })
const INTELLIGENCE = {
  system_score: 69, status: 'Degraded', computed_at: '2026-09-23T00:00:00Z', top_action: null, top_drivers: [],
  components: {
    cost: component('Cost Efficiency', 95, 'good'),
    security: component('Security Posture', 59, 'risk'),
    observability: component('Observability', 55, 'risk'),
  },
}

let client: QueryClient
let intelligenceSpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(platformStatsService, 'getDashboardStats').mockResolvedValue({
    totalServices: 3, servicesChange: 0, activeDeployments: 1, deploymentsChange: 0, monthlyAwsCost: 100, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual',
  } as never)
  vi.spyOn(monitoringService, 'getSystemHealth').mockResolvedValue({ status: 'operational' } as never)
  vi.spyOn(costRecommendationsService, 'getAll').mockResolvedValue([] as never)
  vi.spyOn(costRecommendationsService, 'getStats').mockResolvedValue({ totalPotentialSavings: 0, activeRecommendations: 0 } as never)
  vi.spyOn(costRecommendationsService, 'getAnalysisRuns').mockResolvedValue([] as never)
  vi.spyOn(accountSecurityFindingsService, 'getStats').mockResolvedValue({ bySeverity: { critical: 0, high: 0, medium: 0, low: 0 } } as never)
  vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: null } as never)
  vi.spyOn(aiSummaryService, 'getSummary').mockResolvedValue({ topRisk: null } as never)
  vi.spyOn(activityFeedService, 'getActivity').mockResolvedValue([] as never)
  vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue([] as never)
  vi.spyOn(complianceFrameworksService, 'getFrameworks').mockResolvedValue([] as never)
  intelligenceSpy = vi.spyOn(systemIntelligenceService, 'getIntelligence').mockResolvedValue(INTELLIGENCE as never) as never
  vi.stubGlobal('fetch', vi.fn(async (url: string) => ({
    ok: true,
    json: async () => ({ data: String(url).includes('/api/aws/accounts') ? [{ id: 'acct' }] : [] }),
  })))
})
afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

const renderDashboard = () => render(<QueryClientProvider client={client}><DashboardPage /></QueryClientProvider>)
const precedes = (a: Element, b: Element) => Boolean(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING)

const postureHeading = () => screen.findByRole('heading', { name: 'Infrastructure Posture' })

describe('Infrastructure Posture card on the real Dashboard page', () => {
  it('sits between Infrastructure Intelligence and AWS Cost Trends / Security Key Findings', async () => {
    renderDashboard()
    const card = await postureHeading()
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Cost score' })).toBeInTheDocument())

    const infraIntel = screen.getByRole('heading', { name: 'Infrastructure Intelligence' })
    const costTrends = (await screen.findAllByText('AWS Cost Trends'))[0]
    const keyFindings = screen.getByRole('heading', { name: 'Security Key Findings' })
    expect(precedes(infraIntel, card)).toBe(true)
    expect(precedes(card, costTrends)).toBe(true)
    expect(precedes(card, keyFindings)).toBe(true)
  })

  it('is its own full-width block, not inside the Infrastructure Intelligence section or its 2-card grid', async () => {
    renderDashboard()
    const heading = await postureHeading()
    const cardRoot = heading.closest('div.rounded-2xl') as HTMLElement
    const infraSection = screen.getByRole('heading', { name: 'Infrastructure Intelligence' }).closest('div.mb-6') as HTMLElement
    expect(infraSection.contains(cardRoot)).toBe(false)
    // Infrastructure Intelligence still has exactly its two cards.
    expect(infraSection.querySelector('.grid')!.children).toHaveLength(2)
    // Not placed inside any column-span grid cell.
    expect(cardRoot.closest('[class*="col-span"]')).toBeNull()
  })

  it('reuses the page\'s existing System Intelligence query: one request feeds both the Infrastructure Posture KPI and the card', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Alert Coverage score' })).toBeInTheDocument())
    expect(screen.getByText('69')).toBeInTheDocument() // Infrastructure Posture KPI, same response
    expect(intelligenceSpy).toHaveBeenCalledTimes(1)
    expect(client.getQueryCache().findAll({ queryKey: ['system-intelligence'] })).toHaveLength(1)
  })

  it('a failed System Intelligence request fabricates nothing: no component labels, scores, status words, or bars', async () => {
    intelligenceSpy.mockRejectedValue(Object.assign(new Error('HTTP 500'), { response: { status: 500 } }))
    renderDashboard()
    const heading = await postureHeading()
    const card = heading.closest('div.rounded-2xl') as HTMLElement
    await waitFor(() => expect(card).toHaveTextContent('— · Unavailable'))

    for (const label of ['Cost', 'Security', 'Alert Coverage']) expect(within(card).queryByText(label)).not.toBeInTheDocument()
    for (const word of ['Strong', 'Needs attention', 'At risk', 'Not yet available']) expect(card).not.toHaveTextContent(word)
    expect(card.textContent?.replace('Composite of cost, security, and alert coverage.', '')).not.toMatch(/\d/) // no score of any kind
    expect(card.querySelectorAll('[role="progressbar"]')).toHaveLength(0)
    expect(intelligenceSpy).toHaveBeenCalledTimes(1)
  })

  it('demo mode: the card is absent from the page entirely', async () => {
    localStorage.setItem('devcontrol_demo_mode', 'true')
    renderDashboard()
    await screen.findByText('Infrastructure Intelligence')
    expect(screen.queryByRole('heading', { name: 'Infrastructure Posture' })).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(intelligenceSpy).not.toHaveBeenCalled()
  })
})

describe('Infrastructure Posture KPI', () => {
  const OBS_REASON = 'Measures EC2 alert coverage only (0 of 1 in-scope resources covered); monitoring coverage, signal freshness, response setup, and ALB/Lambda alert coverage are not supported yet.'
  const REASON = `Alert Coverage: ${OBS_REASON}`

  it('is labeled Infrastructure Posture -- never Infrastructure Health -- and Security Posture is unchanged', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('69')).toBeInTheDocument())
    const kpi = screen.getByText('69').closest('a') as HTMLElement
    expect(within(kpi).getByText('Infrastructure Posture')).toBeInTheDocument()
    expect(kpi).toHaveAttribute('href', '/infrastructure')
    expect(screen.queryByText('Infrastructure Health')).not.toBeInTheDocument()
    expect(screen.queryByText('Platform Efficiency Breakdown')).not.toBeInTheDocument()
    expect(screen.getByText('Security Posture')).toBeInTheDocument()
  })

  it('shows the existing Degraded status as "Needs attention", never as a health word', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByText('69')).toBeInTheDocument())
    const kpi = screen.getByText('69').closest('a') as HTMLElement
    expect(within(kpi).getByText('Needs attention')).toBeInTheDocument()
    for (const word of ['Degraded', 'Healthy']) expect(within(kpi).queryByText(word)).not.toBeInTheDocument()
  })

  it('states what the composite is built from, using the runtime component scores', async () => {
    renderDashboard()
    expect(await screen.findByText('Composite · Cost 95 · Security 59 · Alert coverage 55')).toBeInTheDocument()
  })

  it('a partial composite is labeled "Partial" with the alert-coverage reason under the score', async () => {
    intelligenceSpy.mockResolvedValue({
      ...INTELLIGENCE, composite_state: 'partial', composite_reason: REASON,
      components: { ...INTELLIGENCE.components, observability: { ...INTELLIGENCE.components.observability, state: 'partial', reason: OBS_REASON } },
    } as never)
    renderDashboard()
    expect(await screen.findByText(`Partial · ${REASON}`)).toBeInTheDocument()
    expect(screen.queryByText(/Observability is partial/)).not.toBeInTheDocument()
    expect(screen.getByText('69')).toBeInTheDocument()
  })

  it('cost partiality renders under the KPI as Cost (with every cost reason) and in the Cost column -- not attributed to Alert Coverage', async () => {
    const COST_REASON = 'Insufficient spend data to assess cost efficiency. Spend based on inventory estimate, not AWS Cost Explorer billing. Anomaly checks not yet active.'
    const BOTH = `Cost: ${COST_REASON} Alert Coverage: ${OBS_REASON}`
    intelligenceSpy.mockResolvedValue({
      ...INTELLIGENCE, composite_state: 'partial', composite_reason: BOTH,
      components: {
        ...INTELLIGENCE.components,
        cost: { ...INTELLIGENCE.components.cost, score: 50, state: 'partial', reason: COST_REASON },
        observability: { ...INTELLIGENCE.components.observability, state: 'partial', reason: OBS_REASON },
      },
    } as never)
    renderDashboard()
    const caption = await screen.findByText(`Partial · ${BOTH}`)
    expect(caption.closest('a')).toHaveAttribute('href', '/infrastructure')
    // The old caption showed only the alert-coverage reason for any partial composite.
    expect(screen.queryByText(`Partial · ${OBS_REASON}`)).not.toBeInTheDocument()
    // Score unchanged by the state.
    expect(screen.getByText('69')).toBeInTheDocument()
    // Breakdown card: each column carries its own reason.
    const costColumn = screen.getByText(COST_REASON).parentElement as HTMLElement
    expect(within(costColumn).getByText('Cost')).toBeInTheDocument()
    expect(within(costColumn).getByText('Partial')).toBeInTheDocument()
    const alertColumn = screen.getByText(OBS_REASON).parentElement as HTMLElement
    expect(within(alertColumn).getByText('Alert Coverage')).toBeInTheDocument()
    expect(within(alertColumn).queryByText(/Anomaly checks/)).not.toBeInTheDocument()
  })

  it('an available composite carries no partial caption', async () => {
    intelligenceSpy.mockResolvedValue({ ...INTELLIGENCE, composite_state: 'available', composite_reason: null } as never)
    renderDashboard()
    await waitFor(() => expect(screen.getByText('69')).toBeInTheDocument())
    expect(screen.queryByText(/^Partial · /)).not.toBeInTheDocument()
  })
})
