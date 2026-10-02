/**
 * Infrastructure Posture section placement, through the real DashboardPage:
 * a standalone full-width section directly below the Top Risk / System Health
 * row and above AWS Cost Trends / Security Key Findings, fed by the page's
 * existing System Intelligence query (one request, no second fetch), and
 * absent in demo mode. Plus the Infrastructure Posture KPI card: its badges
 * and its info panel. Component behavior is covered in
 * components/dashboard/__tests__/system-intelligence-card.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
const postureSection = async () => (await postureHeading()).closest('[data-testid="posture-section"]') as HTMLElement
/** The Infrastructure Posture KPI card (its arrow opens /infrastructure). */
const postureKpi = () => screen.getAllByTestId('kpi-card').find((c) => c.querySelector('a[href="/infrastructure"]')) as HTMLElement
const openPostureKpiInfo = () => {
  fireEvent.click(within(postureKpi()).getByRole('button', { name: 'About Infrastructure Posture' }))
  return screen.getByRole('dialog', { name: 'How this is calculated' })
}

describe('Infrastructure Posture section on the real Dashboard page', () => {
  it('sits between the Top Risk / System Health row and AWS Cost Trends / Security Key Findings', async () => {
    renderDashboard()
    const section = await postureSection()
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Cost score' })).toBeInTheDocument())

    const riskRow = screen.getByTestId('risk-status-row')
    const costTrends = (await screen.findAllByText('AWS Cost Trends'))[0]
    const keyFindings = screen.getByRole('heading', { name: 'Security Key Findings' })
    expect(precedes(riskRow, section)).toBe(true)
    expect(precedes(section, costTrends)).toBe(true)
    expect(precedes(section, keyFindings)).toBe(true)
  })

  it('is its own full-width block, not inside the risk/status row or a column-span cell', async () => {
    renderDashboard()
    const section = await postureSection()
    const riskRow = screen.getByTestId('risk-status-row')
    expect(riskRow.contains(section)).toBe(false)
    expect(riskRow.children).toHaveLength(2)
    expect(section.closest('[class*="col-span"]')).toBeNull()
  })

  it('reuses the page\'s existing System Intelligence query: one request feeds both the KPI card and the section', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Alert Coverage score' })).toBeInTheDocument())
    expect(within(postureKpi()).getByText('69')).toBeInTheDocument()
    // The KPI card carries the composite; the section (no ring) carries the same response's component scores.
    expect(within(postureKpi()).getByTestId('kpi-caption')).toHaveTextContent('Composite · Cost 95 · Security 59 · Alert coverage 55')
    expect(within(await postureSection()).getByText('95')).toBeInTheDocument()
    expect(within(await postureSection()).queryByText('69')).toBeNull()
    expect(intelligenceSpy).toHaveBeenCalledTimes(1)
    expect(client.getQueryCache().findAll({ queryKey: ['system-intelligence'] })).toHaveLength(1)
  })

  it('a failed System Intelligence request fabricates nothing: no component labels, scores, status words, or bars', async () => {
    intelligenceSpy.mockRejectedValue(Object.assign(new Error('HTTP 500'), { response: { status: 500 } }))
    renderDashboard()
    const section = await postureSection()
    await waitFor(() => expect(section).toHaveTextContent('— · Unavailable'))

    for (const label of ['Cost', 'Security', 'Alert Coverage']) expect(within(section).queryByText(label)).not.toBeInTheDocument()
    for (const word of ['Strong', 'Needs attention', 'At risk', 'Not yet available', 'Partial']) expect(section).not.toHaveTextContent(word)
    expect(section.textContent?.replace('Composite of cost (30%), security (40%), and alert coverage (30%)', '')).not.toMatch(/\d/)
    expect(section.querySelectorAll('[role="progressbar"]')).toHaveLength(0)
    // The KPI card: "—", never 0, and no bar.
    await waitFor(() => expect(within(postureKpi()).getByText('—')).toBeInTheDocument())
    expect(postureKpi().querySelectorAll('[role="progressbar"]')).toHaveLength(0)
    expect(within(postureKpi()).queryByText('0')).not.toBeInTheDocument()
    expect(intelligenceSpy).toHaveBeenCalledTimes(1)
  })

  it('demo mode: the section is absent from the page entirely', async () => {
    localStorage.setItem('devcontrol_demo_mode', 'true')
    renderDashboard()
    await screen.findByText('Top Risk')
    expect(screen.queryByRole('heading', { name: 'Infrastructure Posture' })).not.toBeInTheDocument()
    expect(screen.queryByTestId('posture-section')).not.toBeInTheDocument()
    expect(intelligenceSpy).not.toHaveBeenCalled()
  })
})

describe('Infrastructure Posture KPI', () => {
  const OBS_REASON = 'Measures EC2 alert coverage only (0 of 1 in-scope resources covered); monitoring coverage, signal freshness, response setup, and ALB/Lambda alert coverage are not supported yet.'
  const REASON = `Alert Coverage: ${OBS_REASON}`

  it('is labeled Infrastructure Posture -- never Infrastructure Health -- and Security Posture is unchanged', async () => {
    renderDashboard()
    await waitFor(() => expect(within(postureKpi()).getByText('69')).toBeInTheDocument())
    expect(within(postureKpi()).getByRole('link', { name: 'Open infrastructure' })).toHaveAttribute('href', '/infrastructure')
    expect(within(postureKpi()).getByTestId('kpi-title')).toHaveTextContent('Infrastructure Posture')
    expect(screen.queryByText('Infrastructure Health')).not.toBeInTheDocument()
    expect(screen.queryByText('Platform Efficiency Breakdown')).not.toBeInTheDocument()
    expect(screen.getByText('Security Posture')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open security findings' })).toHaveAttribute('href', '/security')
  })

  it('shows the existing Degraded status as "Needs attention", never as a health word', async () => {
    renderDashboard()
    await waitFor(() => expect(within(postureKpi()).getByText('69')).toBeInTheDocument())
    expect(within(postureKpi()).getByTestId('posture-status')).toHaveTextContent('Needs attention')
    for (const word of ['Degraded', 'Healthy']) expect(within(postureKpi()).queryByText(word)).not.toBeInTheDocument()
  })

  it('the info panel states what the composite measures and each component\'s runtime score', async () => {
    renderDashboard()
    await waitFor(() => expect(within(postureKpi()).getByText('69')).toBeInTheDocument())
    const dialog = openPostureKpiInfo()
    expect(dialog).toHaveTextContent('Composite of cost (30%), security (40%), and alert coverage (30%). A posture score, not measured uptime or performance.')
    expect(within(within(dialog).getByTestId('posture-evidence-cost')).getByText('95 · Strong')).toBeInTheDocument()
    expect(within(within(dialog).getByTestId('posture-evidence-security')).getByText('59 · At risk')).toBeInTheDocument()
    expect(within(within(dialog).getByTestId('posture-evidence-observability')).getByText('55 /100')).toBeInTheDocument()
  })

  it('a partial composite shows "Partial" on the card and the section, with the alert-coverage reason in the panel', async () => {
    intelligenceSpy.mockResolvedValue({
      ...INTELLIGENCE, composite_state: 'partial', composite_reason: REASON,
      components: { ...INTELLIGENCE.components, observability: { ...INTELLIGENCE.components.observability, state: 'partial', reason: OBS_REASON } },
    } as never)
    renderDashboard()
    await waitFor(() => expect(within(postureKpi()).getByTestId('posture-partial')).toHaveTextContent('Partial'))
    expect(within(await postureSection()).getByTestId('posture-section-partial')).toBeInTheDocument()
    // No reason paragraph on the face.
    expect(postureKpi().textContent).not.toContain(OBS_REASON)
    const alertRow = within(openPostureKpiInfo()).getByTestId('posture-evidence-observability')
    expect(alertRow).toHaveTextContent(OBS_REASON)
    expect(within(alertRow).getByText('Partial')).toBeInTheDocument()
    expect(within(postureKpi()).getByText('69')).toBeInTheDocument()
  })

  it('cost partiality appears in the panel under Cost (with every cost reason) -- not attributed to Alert Coverage', async () => {
    const COST_REASON = 'Insufficient spend data to assess cost efficiency. Anomaly checks not yet active.'
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
    await waitFor(() => expect(within(postureKpi()).getByTestId('posture-partial')).toBeInTheDocument())
    expect(within(postureKpi()).getByText('69')).toBeInTheDocument() // score unchanged by the state
    const dialog = openPostureKpiInfo()
    const costRow = within(dialog).getByTestId('posture-evidence-cost')
    expect(costRow).toHaveTextContent(COST_REASON)
    expect(within(costRow).getByText('Partial')).toBeInTheDocument()
    const alertRow = within(dialog).getByTestId('posture-evidence-observability')
    expect(alertRow).toHaveTextContent(OBS_REASON)
    expect(alertRow.textContent).not.toMatch(/Anomaly checks/)
  })

  it('an available composite carries no Partial badge on the card or the section', async () => {
    intelligenceSpy.mockResolvedValue({ ...INTELLIGENCE, composite_state: 'available', composite_reason: null } as never)
    renderDashboard()
    await waitFor(() => expect(within(postureKpi()).getByText('69')).toBeInTheDocument())
    expect(screen.queryByTestId('posture-partial')).not.toBeInTheDocument()
    expect(screen.queryByTestId('posture-section-partial')).not.toBeInTheDocument()
  })
})
