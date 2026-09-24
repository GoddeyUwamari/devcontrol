/**
 * Platform Efficiency Breakdown card placement, through the real DashboardPage:
 * a standalone full-width card directly below Infrastructure Intelligence and
 * above AWS Cost Trends / Security Key Findings, fed by the page's existing
 * System Intelligence query (one request, no second fetch), and absent in demo
 * mode. Component behavior is covered in
 * components/dashboard/__tests__/system-intelligence-card.test.tsx.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
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
  ({ score, label, detail: '', severity: 'healthy', delta: null, status, ready: true })
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

describe('Platform Efficiency Breakdown card on the real Dashboard page', () => {
  it('sits between Infrastructure Intelligence and AWS Cost Trends / Security Key Findings', async () => {
    renderDashboard()
    const card = await screen.findByText('Platform Efficiency Breakdown')
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Cost Efficiency score' })).toBeInTheDocument())

    const infraIntel = screen.getByRole('heading', { name: 'Infrastructure Intelligence' })
    const costTrends = (await screen.findAllByText('AWS Cost Trends'))[0]
    const keyFindings = screen.getByRole('heading', { name: 'Security Key Findings' })
    expect(precedes(infraIntel, card)).toBe(true)
    expect(precedes(card, costTrends)).toBe(true)
    expect(precedes(card, keyFindings)).toBe(true)
  })

  it('is its own full-width block, not inside the Infrastructure Intelligence section or its 2-card grid', async () => {
    renderDashboard()
    const heading = await screen.findByText('Platform Efficiency Breakdown')
    const cardRoot = heading.closest('div.rounded-2xl') as HTMLElement
    const infraSection = screen.getByRole('heading', { name: 'Infrastructure Intelligence' }).closest('div.mb-6') as HTMLElement
    expect(infraSection.contains(cardRoot)).toBe(false)
    // Infrastructure Intelligence still has exactly its two cards.
    expect(infraSection.querySelector('.grid')!.children).toHaveLength(2)
    // Not placed inside any column-span grid cell.
    expect(cardRoot.closest('[class*="col-span"]')).toBeNull()
  })

  it('reuses the page\'s existing System Intelligence query: one request feeds both Infrastructure Health and the card', async () => {
    renderDashboard()
    await waitFor(() => expect(screen.getByRole('progressbar', { name: 'Observability score' })).toBeInTheDocument())
    expect(screen.getByText('69')).toBeInTheDocument() // Infrastructure Health KPI, same response
    expect(intelligenceSpy).toHaveBeenCalledTimes(1)
    expect(client.getQueryCache().findAll({ queryKey: ['system-intelligence'] })).toHaveLength(1)
  })

  it('a failed System Intelligence request fabricates nothing: no component labels, scores, status words, or bars', async () => {
    intelligenceSpy.mockRejectedValue(Object.assign(new Error('HTTP 500'), { response: { status: 500 } }))
    renderDashboard()
    const heading = await screen.findByText('Platform Efficiency Breakdown')
    const card = heading.closest('div.rounded-2xl') as HTMLElement
    await waitFor(() => expect(card).toHaveTextContent('— · Unavailable'))

    for (const label of ['Cost Efficiency', 'Security Posture', 'Observability']) expect(card).not.toHaveTextContent(label)
    for (const word of ['Strong', 'Needs attention', 'At risk', 'Not yet available']) expect(card).not.toHaveTextContent(word)
    expect(card.textContent).not.toMatch(/\d/) // no score of any kind
    expect(card.querySelectorAll('[role="progressbar"]')).toHaveLength(0)
    expect(intelligenceSpy).toHaveBeenCalledTimes(1)
  })

  it('demo mode: the card is absent from the page entirely', async () => {
    localStorage.setItem('devcontrol_demo_mode', 'true')
    renderDashboard()
    await screen.findByText('Infrastructure Intelligence')
    expect(screen.queryByText('Platform Efficiency Breakdown')).not.toBeInTheDocument()
    expect(screen.queryByRole('progressbar')).not.toBeInTheDocument()
    expect(intelligenceSpy).not.toHaveBeenCalled()
  })
})
