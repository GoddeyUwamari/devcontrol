/**
 * Dashboard reconciliation, through the real DashboardPage: Recommended Action,
 * Cost-Saving Opportunities and Executive ROI read the same canonical sources
 * (cost-recommendations stats, and the shared pickLatestAnalysis() +
 * deriveAnalysisStatus() over scheduled and manual analyses), so they can't
 * contradict each other; a failed request is never a count, a zero, or "not
 * evaluated"; savings are cents everywhere with monthly x 12 = annual; Top
 * Risk does not wait on billing data; and Key Findings and the Security
 * Posture caption share one compliance-scan rule. Fixtures, not production data.
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

const ACTIVE_EC2 = {
  id: 'rec-1', resourceId: 'i-0abc', resourceType: 'EC2', issue: 'Idle Instance', potentialSavings: 8.5,
  severity: 'MEDIUM', status: 'ACTIVE', createdAt: '2026-08-09T11:15:00Z', updatedAt: '2026-08-09T11:15:00Z',
}
const stats = (savings: number, active = 1) => ({
  totalRecommendations: active, activeRecommendations: active, totalPotentialSavings: savings,
  potentialSavingsByResourceType: active > 0 ? { EC2: savings } : {},
})
const job = (status: 'completed' | 'failed' | 'running', createdAt: string, costAnalysisCompleted = true) => ({
  id: `job-${createdAt}`, organization_id: 'org-test', status, resources_discovered: 3, resources_updated: 1, resources_deleted: 0,
  regions: ['us-east-1'], resource_types: ['ec2'], error_message: null, started_at: createdAt,
  completed_at: status === 'completed' ? createdAt : null, created_at: createdAt,
  compliance_scan_completed: true, cost_analysis_completed: costAnalysisCompleted,
})
const run = (status: 'completed' | 'failed' | 'running', createdAt: string) => ({
  id: `run-${createdAt}`, status, recommendations_found: 1, total_potential_savings: '8.50',
  started_at: createdAt, completed_at: status === 'completed' ? createdAt : null, created_at: createdAt, error_message: null,
})

let client: QueryClient
let getAll: ReturnType<typeof vi.fn>
let getStats: ReturnType<typeof vi.fn>
let getRuns: ReturnType<typeof vi.fn>
let getJobs: ReturnType<typeof vi.fn>
let getSummary: ReturnType<typeof vi.fn>
let getResourceStats: ReturnType<typeof vi.fn>

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(platformStatsService, 'getDashboardStats').mockResolvedValue({
    totalServices: 3, servicesChange: 0, activeDeployments: 1, deploymentsChange: 0, monthlyAwsCost: 100, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual',
  } as never)
  vi.spyOn(platformStatsService, 'getCostSummary').mockResolvedValue({
    spend: { state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: null, coverage: null, reason: null, data: { amount: 20, basis: 'billed_month_to_date', lastDayInProgress: false } },
    monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null },
  } as never)
  vi.spyOn(monitoringService, 'getSystemHealth').mockResolvedValue({ status: 'operational' } as never)
  getAll = vi.spyOn(costRecommendationsService, 'getAll').mockResolvedValue([ACTIVE_EC2] as never) as never
  getStats = vi.spyOn(costRecommendationsService, 'getStats').mockResolvedValue(stats(8.5) as never) as never
  // The local repro: scheduled analyses completed, no manual run ever.
  getRuns = vi.spyOn(costRecommendationsService, 'getAnalysisRuns').mockResolvedValue([] as never) as never
  getJobs = vi.spyOn(awsResourcesService, 'getDiscoveryJobs').mockResolvedValue([job('completed', '2026-08-09T11:15:27Z')] as never) as never
  vi.spyOn(accountSecurityFindingsService, 'getStats').mockResolvedValue({ bySeverity: { critical: 1, high: 5, medium: 0, low: 0 } } as never)
  getResourceStats = vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: null, scan_completed: false } as never) as never
  getSummary = vi.spyOn(aiSummaryService, 'getSummary').mockResolvedValue({ topRisk: 'Open SSH (high severity)', topRiskStatus: 'identified' } as never) as never
  vi.spyOn(systemIntelligenceService, 'getIntelligence').mockRejectedValue(new Error('not under test'))
  vi.spyOn(activityFeedService, 'getActivity').mockResolvedValue([] as never)
  vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue([] as never)
  vi.spyOn(complianceFrameworksService, 'getFrameworks').mockResolvedValue([] as never)
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
const opportunities = () => screen.getByText('Cost-Saving Opportunities').closest('div.rounded-2xl') as HTMLElement
const ec2Card = () => within(opportunities()).getByText('Review EC2 instances').parentElement as HTMLElement
const recommendedAction = () => screen.getByText(/optimization opportunit(y|ies) identified/).closest('div.rounded-2xl') as HTMLElement
const roi = () => screen.getByText('Executive ROI Summary').closest('div.rounded-2xl') as HTMLElement

describe('Recommended Action, Cost-Saving Opportunities and ROI agree', () => {
  it('scheduled-only analysis (the local repro): the active EC2 recommendation is counted everywhere and never "Not currently evaluated"', async () => {
    renderDashboard()
    await waitFor(() => expect(within(ec2Card()).getByText('$8.50/mo')).toBeInTheDocument())
    expect(within(ec2Card()).getByText('1 opportunity')).toBeInTheDocument()
    expect(opportunities().textContent).not.toMatch(/Not currently evaluated|Evaluation in progress|Could not be retrieved/)
    expect(within(opportunities()).getByText('View all (1) →')).toBeInTheDocument()
    expect(recommendedAction()).toHaveTextContent('1 optimization opportunity identified')
    expect(recommendedAction()).toHaveTextContent('Estimated potential savings: $8.50/month')
    expect(within(recommendedAction()).getByRole('link')).toHaveTextContent('Review 1 recommendation →')
    expect(getJobs).toHaveBeenCalledWith(5)
  })

  it('an active recommendation is never shown with a contradictory state, whatever the analysis state', async () => {
    getJobs.mockResolvedValue([])
    renderDashboard()
    await waitFor(() => expect(within(ec2Card()).getByText('$8.50/mo')).toBeInTheDocument())
    expect(ec2Card().textContent).not.toMatch(/Not currently evaluated/)
    // Zero-count categories still say no analysis has completed.
    expect(within(opportunities()).getByText('Optimize EBS volumes').parentElement).toHaveTextContent('Not currently evaluated')
  })

  it('precedence is preserved: a newer running manual run wins over an older completed scheduled job (zero cards say "in progress")', async () => {
    getRuns.mockResolvedValue([run('running', '2026-09-30T10:00:00Z')])
    getJobs.mockResolvedValue([job('completed', '2026-09-29T10:00:00Z')])
    renderDashboard()
    await waitFor(() => expect(within(opportunities()).getByText('Optimize EBS volumes').parentElement).toHaveTextContent('Evaluation in progress'))
    expect(within(ec2Card()).getByText('$8.50/mo')).toBeInTheDocument()
  })

  it('precedence is preserved: a newer completed manual run wins over an older failed scheduled job (evaluated)', async () => {
    getRuns.mockResolvedValue([run('completed', '2026-09-30T10:00:00Z')])
    getJobs.mockResolvedValue([job('failed', '2026-09-29T10:00:00Z')])
    renderDashboard()
    await waitFor(() => expect(within(ec2Card()).getByText('$8.50/mo')).toBeInTheDocument())
    expect(opportunities().textContent).not.toMatch(/did not complete|Not currently evaluated/)
  })

  it('a scheduled job whose cost analysis did not complete is "did not complete" -- not "not evaluated"', async () => {
    getAll.mockResolvedValue([])
    getStats.mockResolvedValue(stats(0, 0))
    getJobs.mockResolvedValue([job('completed', '2026-09-29T10:00:00Z', false)])
    renderDashboard()
    await waitFor(() => expect(within(opportunities()).getByText('Optimize EBS volumes').parentElement).toHaveTextContent('Latest cost analysis did not complete'))
    expect(opportunities().textContent).not.toMatch(/Not currently evaluated/)
  })

  it('a failed analysis-history request is "Could not be retrieved", never "not evaluated" or a zero', async () => {
    getAll.mockResolvedValue([])
    getStats.mockResolvedValue(stats(0, 0))
    getJobs.mockRejectedValue(new Error('HTTP 500'))
    renderDashboard()
    await waitFor(() => expect(within(opportunities()).getByText('Optimize EBS volumes').parentElement).toHaveTextContent('Could not be retrieved'))
    expect(opportunities().textContent).not.toMatch(/Not currently evaluated|0 detected/)
  })

  it('a failed stats request fabricates no count and no savings (no topRecs.length fallback)', async () => {
    getStats.mockRejectedValue(new Error('HTTP 500'))
    renderDashboard()
    await waitFor(() => expect(within(opportunities()).getByText('View all →')).toBeInTheDocument())
    expect(screen.queryByText(/optimization opportunit(y|ies) identified/)).toBeNull()
    expect(screen.queryByText(/Review \d+ recommendation/)).toBeNull()
    expect(within(roi()).getByText('—')).toBeInTheDocument()
  })

  it('a failed recommendations-list request: cards say "Could not be retrieved", never "0 detected"', async () => {
    getAll.mockRejectedValue(new Error('HTTP 500'))
    renderDashboard()
    await waitFor(() => expect(ec2Card()).toHaveTextContent('Could not be retrieved'))
    expect(opportunities().textContent).not.toMatch(/0 detected|Not currently evaluated/)
  })

  it('cents everywhere: monthly x 12 is exactly the annual figure shown', async () => {
    getStats.mockResolvedValue(stats(5.1666))
    renderDashboard()
    await waitFor(() => expect(within(roi()).getByText('$5.17')).toBeInTheDocument())
    expect(within(roi()).getByText('$62.04')).toBeInTheDocument()
    expect(recommendedAction()).toHaveTextContent('Estimated potential savings: $5.17/month')
    expect(within(ec2Card()).getByText('$5.17/mo')).toBeInTheDocument()
  })
})

describe('Top Risk', () => {
  it('is requested and shown without billing data (billing still syncing)', async () => {
    vi.spyOn(platformStatsService, 'getDashboardStats').mockResolvedValue({
      totalServices: 3, servicesChange: 0, activeDeployments: 0, deploymentsChange: 0, monthlyAwsCost: 0, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'estimated',
    } as never)
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('top-risk-card')).toHaveTextContent('Open SSH'))
    expect(getSummary).toHaveBeenCalled()
  })

  it('refreshes on the same cadence as the security finding queries it is built from', async () => {
    renderDashboard()
    await waitFor(() => expect(getSummary).toHaveBeenCalled())
    const options = (key: unknown[]) => client.getQueryCache().find({ queryKey: key })!.options as { staleTime?: number; refetchInterval?: number }
    const summary = options(['ai-summary', 'org-test'])
    const findings = options(['account-security-findings-stats', 'org-test'])
    expect(summary.staleTime).toBe(findings.staleTime)
    expect(summary.refetchInterval).toBe(findings.refetchInterval)
  })
})

describe('Security Posture caption and Key Findings share the compliance-scan rule', () => {
  it('scan_completed false: both say compliance scan pending', async () => {
    renderDashboard()
    const keyFindings = () => screen.getByRole('heading', { name: 'Security Key Findings' }).closest('div.rounded-2xl') as HTMLElement
    await waitFor(() => expect(within(keyFindings()).getByText('Resource compliance').parentElement).toHaveTextContent('Compliance scan pending'))
    const securityKpi = screen.getAllByTestId('kpi-card').find((c) => c.querySelector('a[href="/security"]'))!
    expect(within(securityKpi).getByTestId('kpi-caption')).toHaveTextContent('compliance scan pending')
  })

  it('a completed scan with zero reported counts is never "Not yet evaluated" in Key Findings', async () => {
    getResourceStats.mockResolvedValue({ compliance_stats: { total_issues: 0, by_severity: { critical: 0, high: 0, medium: 0, low: 0 }, by_category: {} }, scan_completed: true })
    renderDashboard()
    const keyFindings = () => screen.getByRole('heading', { name: 'Security Key Findings' }).closest('div.rounded-2xl') as HTMLElement
    await waitFor(() => expect(within(keyFindings()).getByText('Resource compliance').parentElement).toHaveTextContent('No open issues in the completed compliance scan'))
    expect(keyFindings().textContent).not.toMatch(/Not yet evaluated|pending/)
  })
})
