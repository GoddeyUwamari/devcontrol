/**
 * Dashboard top sections, through the real DashboardPage: section order,
 * card faces (evidence state as badges plus at most one basis caption, each
 * derived from loaded data and omitted when that data is missing), the info
 * panels (accessible buttons, Escape, focus return, desktop anchoring), and
 * the content rules -- partial never becomes available, a missing score is
 * "—" never 0, an estimate stays labeled as one, a still-billing comparison
 * is neutral, Top Risk severity is the finding's own, and System Health says
 * it is not the customer's AWS. All figures are fixtures, not production data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import DashboardPage from '../page'
import type { CostSummary } from '@/lib/types'
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

const COST_REASON = 'Spend based on inventory estimate, not AWS Cost Explorer billing. Anomaly checks not yet active.'
const OBS_REASON = 'Measures EC2 alert coverage only (0 of 1 in-scope resources covered); monitoring coverage, signal freshness, response setup, and ALB/Lambda alert coverage are not supported yet.'

const component = (label: string, score: number, status: 'good' | 'warning' | 'risk', extra: Record<string, unknown> = {}) =>
  ({ score, label, detail: '', severity: 'healthy', delta: null, status, ready: true, state: 'available', reason: null, ...extra })
const PARTIAL_INTELLIGENCE = {
  system_score: 52, status: 'Degraded', composite_state: 'partial', composite_reason: `Cost: ${COST_REASON} Alert Coverage: ${OBS_REASON}`,
  computed_at: '2026-10-01T00:00:00Z', top_action: null, top_drivers: [],
  components: {
    cost: component('Cost Efficiency', 97, 'good', { state: 'partial', reason: COST_REASON, costSource: 'estimated' }),
    security: component('Security Posture', 57, 'risk'),
    observability: component('Observability', 0, 'risk', { state: 'partial', reason: OBS_REASON }),
  },
}
const AVAILABLE_INTELLIGENCE = {
  ...PARTIAL_INTELLIGENCE, composite_state: 'available', composite_reason: null,
  components: { cost: component('Cost Efficiency', 95, 'good'), security: component('Security Posture', 57, 'risk'), observability: component('Observability', 80, 'good') },
}

const actualSpend = (amount: number, lastDayInProgress = true, period: CostSummary['spend']['period'] = { kind: 'range', start: '2026-10-01', endExclusive: '2026-10-15' }): CostSummary['spend'] => ({
  state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: null, period, coverage: null, reason: null,
  data: { amount, basis: 'billed_month_to_date', lastDayInProgress },
})
const estimatedSpend = (amount: number): CostSummary['spend'] => ({
  state: 'available', source: 'DevControl inventory cost estimate', provenance: 'estimated', asOf: null, coverage: null, reason: null,
  data: { amount, basis: 'estimated_monthly_run_rate', lastDayInProgress: false },
})
const mom = (changePercent: number, changeAmount: number, includesToday: boolean): CostSummary['monthOverMonth'] => ({
  state: 'available', source: 'DevControl month-over-month comparison', provenance: 'derived', asOf: null, coverage: null, reason: null,
  data: {
    currentWindow: { start: '2026-10-01', end: '2026-10-01' }, previousWindow: { start: '2026-09-01', end: '2026-09-01' },
    currentWindowTotal: 10 + changeAmount, previousWindowTotal: 10, changeAmount, changePercent, currentWindowIncludesToday: includesToday,
  },
})
const noMom = (state: 'unavailable' | 'error'): CostSummary['monthOverMonth'] =>
  ({ state, source: 'DevControl month-over-month comparison', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null })

let client: QueryClient
let intelligenceSpy: ReturnType<typeof vi.fn>
let costSummarySpy: ReturnType<typeof vi.fn>
let aiSummarySpy: ReturnType<typeof vi.fn>

beforeEach(() => {
  localStorage.clear()
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  vi.spyOn(console, 'error').mockImplementation(() => {})
  vi.spyOn(console, 'log').mockImplementation(() => {})
  vi.spyOn(console, 'warn').mockImplementation(() => {})
  vi.spyOn(platformStatsService, 'getDashboardStats').mockResolvedValue({
    totalServices: 3, servicesChange: 0, activeDeployments: 1, deploymentsChange: 0, monthlyAwsCost: 100, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual',
  } as never)
  costSummarySpy = vi.spyOn(platformStatsService, 'getCostSummary').mockResolvedValue({ spend: actualSpend(123.45), monthOverMonth: mom(-7, -0.7, true) }) as never
  vi.spyOn(monitoringService, 'getSystemHealth').mockResolvedValue({ status: 'operational' } as never)
  vi.spyOn(costRecommendationsService, 'getAll').mockResolvedValue([] as never)
  vi.spyOn(costRecommendationsService, 'getStats').mockResolvedValue({ totalPotentialSavings: 0, activeRecommendations: 0 } as never)
  vi.spyOn(costRecommendationsService, 'getAnalysisRuns').mockResolvedValue([] as never)
  vi.spyOn(accountSecurityFindingsService, 'getStats').mockResolvedValue({ bySeverity: { critical: 1, high: 3, medium: 0, low: 1 } } as never)
  vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: null } as never)
  aiSummarySpy = vi.spyOn(aiSummaryService, 'getSummary').mockResolvedValue({ topRisk: 'Root account has no MFA (critical severity)', topRiskStatus: 'identified' } as never) as never
  vi.spyOn(activityFeedService, 'getActivity').mockResolvedValue([] as never)
  vi.spyOn(soc2Service, 'getReadiness').mockResolvedValue([] as never)
  vi.spyOn(complianceFrameworksService, 'getFrameworks').mockResolvedValue([] as never)
  intelligenceSpy = vi.spyOn(systemIntelligenceService, 'getIntelligence').mockResolvedValue(PARTIAL_INTELLIGENCE as never) as never
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
const kpi = (href: string) => screen.getAllByTestId('kpi-card').find((c) => c.querySelector(`a[href="${href}"]`)) as HTMLElement
const settled = async () => {
  await waitFor(() => {
    expect(within(kpi('/infrastructure')).getByText(/^\d+$|^—$/)).toBeInTheDocument()
    expect(within(kpi('/costs')).queryByText('—')).toBeNull()
    expect(screen.getByTestId('top-risk-card').querySelector('.animate-pulse')).toBeNull()
  })
}
const openInfo = (card: HTMLElement, name: string) => {
  fireEvent.click(within(card).getByRole('button', { name }))
  return screen.getByRole('dialog')
}

describe('1. section order', () => {
  it('KPI row (3 cards) → risk/status row → posture section → the existing sections, unchanged and in order', async () => {
    renderDashboard()
    await settled()
    const kpiRow = screen.getByTestId('kpi-row')
    expect(within(kpiRow).getAllByTestId('kpi-card')).toHaveLength(3)
    expect(within(kpiRow).getAllByTestId('kpi-card').map((c) => c.querySelector('a')!.textContent)).toEqual(['Month-to-Date Spend', 'Security Posture', 'Infrastructure Posture'])
    expect(kpiRow.className).toContain('lg:grid-cols-3')

    const riskRow = screen.getByTestId('risk-status-row')
    expect(riskRow.children).toHaveLength(2)
    expect(within(riskRow.children[0] as HTMLElement).getByText('Top Risk')).toBeInTheDocument()
    expect(within(riskRow.children[1] as HTMLElement).getByText('DevControl System Health')).toBeInTheDocument()
    expect(riskRow.className).toContain('lg:grid-cols-2')

    const section = screen.getByTestId('posture-section')
    const resourceChecks = screen.getByTestId('resource-checks-section')
    const rest = [
      (await screen.findAllByText('AWS Cost Trends'))[0],
      screen.getByRole('heading', { name: 'Security Key Findings' }),
      screen.getAllByText(/Cost-Saving Opportunities/)[0],
      screen.getAllByText(/Engineering Health/)[0],
      screen.getAllByText(/Recent Activity/)[0],
    ]
    const order = [kpiRow, riskRow, section, resourceChecks, ...rest]
    for (let i = 1; i < order.length; i++) expect(precedes(order[i - 1], order[i])).toBe(true)
    expect(screen.queryByText('Infrastructure Intelligence')).not.toBeInTheDocument()
  })
})

describe('2. Resource checks section, and no reference demo content', () => {
  it('renders the Resource checks section directly after Infrastructure Posture and before AWS Cost Trends', async () => {
    renderDashboard()
    await settled()
    const posture = screen.getByTestId('posture-section')
    const resourceChecks = screen.getByTestId('resource-checks-section')
    const costTrends = (await screen.findAllByText('AWS Cost Trends'))[0]
    expect(posture.nextElementSibling).toBe(resourceChecks)
    expect(precedes(resourceChecks, costTrends)).toBe(true)
    expect(resourceChecks.className).toBe(posture.className)
  })

  it('requests resource checks only once the section is scrolled into view, once, at the monitoring range', async () => {
    const observers: Array<() => void> = []
    vi.stubGlobal('IntersectionObserver', class {
      constructor(private cb: IntersectionObserverCallback) { observers.push(() => this.cb([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver)) }
      observe() {}
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    })
    renderDashboard()
    await settled()
    await waitFor(() => expect(screen.getByTestId('top-risk-card').textContent).toContain('Root account has no MFA'))
    const metricsCalls = () => (fetch as unknown as ReturnType<typeof vi.fn>).mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/cloudwatch/metrics'))
    expect(metricsCalls()).toHaveLength(0)
    expect(within(screen.getByTestId('resource-checks-summary')).getByText('Loading…')).toBeInTheDocument()
    act(() => observers.forEach((enter) => enter()))
    await waitFor(() => expect(metricsCalls()).toHaveLength(1))
    const url = new URL(metricsCalls()[0])
    expect(url.searchParams.get('range')).toBe('1h')
    expect(url.searchParams.has('refresh')).toBe(false)
  })

  it('does not watch for the section while the sections above it are still loading', async () => {
    let observed = 0
    vi.stubGlobal('IntersectionObserver', class {
      observe() { observed += 1 }
      unobserve() {}
      disconnect() {}
      takeRecords() { return [] }
    })
    intelligenceSpy.mockReturnValue(new Promise(() => {}))
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('resource-checks-section')).toBeInTheDocument())
    await waitFor(() => expect(screen.getByTestId('top-risk-card').textContent).toContain('Root account has no MFA'))
    expect(observed).toBe(0)
  })

  it('renders none of the mock\'s values, labels, or links', async () => {
    renderDashboard()
    await settled()
    const text = document.body.textContent ?? ''
    for (const banned of [
      'Resource Checks', 'What this measures', 'Component details', 'All monitored resources are healthy', 'within expected ranges', '3 / 3', '$11,648', '12%', 'Platform Health Index', 'Security Posture Index', 'Critical Risk Alert',
      'All API & database services live', 'Security scan status and computation may be delayed',
      'View full evidence & methodology', 'Data Source & Evidence', 'Health Component Breakdown',
      'FinOps Efficiency', 'Alert & Telemetry Coverage', 'Healthy',
    ]) expect(text).not.toContain(banned)
    expect(screen.getAllByTestId('kpi-card')).toHaveLength(3)
  })
})

describe('3. one derived caption per face; long evidence stays in the panels', () => {
  it('renders exactly these captions for the fixture data', async () => {
    vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: null, scan_completed: false } as never)
    renderDashboard()
    await settled()
    await waitFor(() => expect(within(kpi('/security')).getByTestId('kpi-caption')).toHaveTextContent('compliance scan pending'))
    expect(within(kpi('/costs')).getByTestId('kpi-caption')).toHaveTextContent(/^Actual · AWS Cost Explorer · today still billing$/)
    expect(within(kpi('/security')).getByTestId('kpi-caption')).toHaveTextContent(/^1 critical · 3 high · 1 low findings · compliance scan pending$/)
    expect(within(kpi('/infrastructure')).getByTestId('kpi-caption')).toHaveTextContent(/^Composite · Cost 97 · Security 57 · Alert coverage 0$/)
    expect(screen.getByTestId('posture-tile-caption-cost')).toHaveTextContent(/^Estimated from inventory · anomaly checks not yet active$/)
    expect(screen.getByTestId('posture-tile-caption-security')).toHaveTextContent(/^1 critical · 3 high · 1 low findings$/)
    expect(screen.queryByTestId('posture-tile-caption-observability')).toBeNull()
    await waitFor(() => expect(screen.getByTestId('system-health-caption')).toHaveTextContent(/^API and database responding · not your AWS resources$/))
  })

  it('every card and tile has at most one caption line, and no long evidence on its face', async () => {
    renderDashboard()
    await settled()
    for (const card of screen.getAllByTestId('kpi-card')) expect(within(card).queryAllByTestId('kpi-caption').length).toBeLessThanOrEqual(1)
    for (const key of ['cost', 'security', 'observability']) {
      expect(screen.getByTestId(`posture-tile-${key}`).querySelectorAll('[data-testid^="posture-tile-caption-"]').length).toBeLessThanOrEqual(1)
    }
    expect(screen.getByTestId('system-health-card').querySelectorAll('p')).toHaveLength(1)
    const faces = [...screen.getAllByTestId('kpi-card'), screen.getByTestId('posture-section'), screen.getByTestId('system-health-card')]
    for (const face of faces) {
      for (const evidence of ['not the selected range', 'still being billed', COST_REASON, OBS_REASON, 'Anomaly checks not yet active.', 'A posture score', 'health check']) {
        expect(face.textContent).not.toContain(evidence)
      }
    }
    // "today still billing" is said once on the spend face, not repeated by the comparison.
    expect(kpi('/costs').textContent!.match(/still bill/g)).toHaveLength(1)
  })

  it('missing data omits the caption instead of inventing one', async () => {
    costSummarySpy.mockReturnValue(new Promise(() => {}))
    vi.spyOn(accountSecurityFindingsService, 'getStats').mockRejectedValue(new Error('HTTP 500'))
    vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: null } as never) // no scan_completed field
    intelligenceSpy.mockRejectedValue(new Error('HTTP 500'))
    renderDashboard()
    await waitFor(() => expect(within(kpi('/infrastructure')).getByText('—')).toBeInTheDocument())
    await waitFor(() => expect(within(kpi('/security')).getByText('—')).toBeInTheDocument())
    for (const href of ['/costs', '/security', '/infrastructure']) expect(within(kpi(href)).queryByTestId('kpi-caption')).toBeNull()
    expect(document.body.textContent).not.toMatch(/compliance scan pending|Composite ·|0 findings/)
  })

  it('actual Spend and the estimated Cost component stay distinguishable', async () => {
    renderDashboard()
    await settled()
    const spendCaption = within(kpi('/costs')).getByTestId('kpi-caption').textContent!
    const costCaption = screen.getByTestId('posture-tile-caption-cost').textContent!
    expect(spendCaption).toMatch(/^Actual · AWS Cost Explorer/)
    expect(costCaption).toMatch(/^Estimated from inventory/)
    expect(costCaption).not.toMatch(/Actual|AWS Cost Explorer/)
    expect(spendCaption).not.toMatch(/Estimate/)
  })

  it('day 1 with no billed days: the caption says so and no percentage is shown', async () => {
    costSummarySpy.mockResolvedValue({ spend: actualSpend(0.37, true, { kind: 'range', start: '2026-10-01', endExclusive: '2026-10-02' }), monthOverMonth: mom(-80, -8, true) })
    renderDashboard()
    await settled()
    expect(within(kpi('/costs')).getByTestId('kpi-caption')).toHaveTextContent('Actual · AWS Cost Explorer · no billed days yet this month')
    expect(within(kpi('/costs')).queryByTestId('spend-change')).toBeNull()
    expect(kpi('/costs').textContent).not.toMatch(/\d%/)
    expect(openInfo(kpi('/costs'), 'Month-to-Date Spend details')).toHaveTextContent('No comparison until a day of this month has finished billing')
  })
})

describe('4. info buttons', () => {
  const BUTTONS: Array<[string, () => HTMLElement, string]> = [
    ['Month-to-Date Spend details', () => kpi('/costs'), 'Month-to-Date Spend'],
    ['Security Posture details', () => kpi('/security'), 'Security Posture'],
    ['Infrastructure Posture details', () => kpi('/infrastructure'), 'Infrastructure Posture'],
    ['Infrastructure Posture section details', () => screen.getByTestId('posture-section'), 'Infrastructure Posture'],
    ['DevControl System Health details', () => screen.getByTestId('system-health-card'), 'DevControl Platform Health'],
  ]

  it.each(BUTTONS)('%s: a native button with aria-label / aria-expanded / aria-controls; click opens, Escape closes, focus returns', async (name, container, title) => {
    renderDashboard()
    await settled()
    const button = within(container()).getByRole('button', { name })
    expect(button.tagName).toBe('BUTTON') // native: Enter/Space activate it
    expect(button).toHaveAttribute('type', 'button')
    expect(button).toHaveAttribute('aria-expanded', 'false')
    expect(button.className).toMatch(/\bw-11\b/)
    expect(button.className).toMatch(/\bh-11\b/) // 44px target

    fireEvent.click(button)
    const dialog = screen.getByRole('dialog', { name: title })
    expect(button).toHaveAttribute('aria-expanded', 'true')
    expect(button.getAttribute('aria-controls')).toBe(dialog.id)

    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(button).toHaveAttribute('aria-expanded', 'false')
    await waitFor(() => expect(document.activeElement).toBe(button))
  })

  it('the close button closes the panel too', async () => {
    renderDashboard()
    await settled()
    openInfo(kpi('/security'), 'Security Posture details')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Close' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
  })

  it('desktop: the panel is non-modal and anchored inside its card (right-aligned for posture, left for spend)', async () => {
    vi.stubGlobal('matchMedia', (query: string) => ({ matches: query === '(min-width: 1024px)', media: query, addEventListener: () => {}, removeEventListener: () => {} }))
    renderDashboard()
    await settled()
    const posture = kpi('/infrastructure')
    const dialog = openInfo(posture, 'Infrastructure Posture details')
    expect(posture.contains(dialog)).toBe(true)
    expect(dialog.className).toContain('right-0')
    expect(dialog.className).toContain('max-w-[calc(100vw-2rem)]')
    expect(document.querySelector('[data-state="open"].fixed.inset-0')).toBeNull() // no overlay on desktop
    fireEvent.keyDown(dialog, { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())

    const spend = kpi('/costs')
    const spendDialog = openInfo(spend, 'Month-to-Date Spend details')
    expect(spend.contains(spendDialog)).toBe(true)
    expect(spendDialog.className).toContain('left-0')
  })

  it('mobile: the panel is a modal dialog with an overlay, above the floating assistant (z-50)', async () => {
    renderDashboard()
    await settled()
    const posture = kpi('/infrastructure')
    const dialog = openInfo(posture, 'Infrastructure Posture details')
    expect(posture.contains(dialog)).toBe(false)
    expect(dialog.className).toContain('z-[60]')
    expect(dialog.className).toContain('max-h-[85vh]')
  })
})

describe('5. Partial follows composite_state', () => {
  it('partial: "Partial" on the posture card and the section', async () => {
    renderDashboard()
    await settled()
    expect(within(kpi('/infrastructure')).getByTestId('posture-partial')).toHaveTextContent('Partial')
    const section = screen.getByTestId('posture-section')
    expect(within(section).getByTestId('posture-section-partial')).toHaveTextContent('Partial')
    // The section's single Partial badge: no tile repeats it.
    expect(within(section).getAllByText('Partial')).toHaveLength(1)
  })

  it('the KPI badges are separate chips, never run together ("WeakPartial")', async () => {
    renderDashboard()
    await settled()
    const status = within(kpi('/infrastructure')).getByTestId('posture-status')
    const partial = within(kpi('/infrastructure')).getByTestId('posture-partial')
    expect(status).not.toBe(partial)
    expect(status.textContent).toBe('Needs attention')
    expect(partial.textContent).toBe('Partial')
    expect(status.parentElement!.className).toMatch(/\bgap-/)
  })

  it('available: no composite Partial badge on either', async () => {
    intelligenceSpy.mockResolvedValue(AVAILABLE_INTELLIGENCE as never)
    renderDashboard()
    await settled()
    expect(screen.queryByTestId('posture-partial')).not.toBeInTheDocument()
    expect(screen.queryByTestId('posture-section-partial')).not.toBeInTheDocument()
  })
})

describe('6–7. component evidence in the posture panel', () => {
  it('Cost shows its score · tier, Partial, and every one of its reasons', async () => {
    renderDashboard()
    await settled()
    const row = within(openInfo(kpi('/infrastructure'), 'Infrastructure Posture details')).getByTestId('posture-evidence-cost')
    expect(within(row).getByText('97 · Strong')).toBeInTheDocument()
    expect(within(row).getByText('Partial')).toBeInTheDocument()
    for (const reason of ['Spend based on inventory estimate, not AWS Cost Explorer billing.', 'Anomaly checks not yet active.']) {
      expect(row.textContent).toContain(reason)
    }
  })

  it('Alert Coverage stays Partial with its scope text, as a percentage with no tier', async () => {
    renderDashboard()
    await settled()
    const row = within(openInfo(kpi('/infrastructure'), 'Infrastructure Posture details')).getByTestId('posture-evidence-observability')
    expect(within(row).getByText('0%')).toBeInTheDocument()
    expect(within(row).getByText('Partial')).toBeInTheDocument()
    expect(row).toHaveTextContent(OBS_REASON)
    for (const tier of ['Strong', 'Needs attention', 'At risk']) expect(row.textContent).not.toContain(tier)
    // The section tile: no Partial chip, no tier chip, no reason paragraph; the full scope text is behind its own ⓘ.
    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    const tile = screen.getByTestId('posture-tile-observability')
    expect(within(tile).queryByText('Partial')).toBeNull()
    expect(tile.textContent).not.toMatch(/At risk|Strong|Needs attention/)
    expect(tile.textContent).not.toContain(OBS_REASON)
    expect(openInfo(tile, 'Alert Coverage details')).toHaveTextContent(OBS_REASON)
  })
})

describe('8. a missing score is "—", never 0', () => {
  it('failed System Intelligence: posture card "—" with no bar; security card "—"', async () => {
    intelligenceSpy.mockRejectedValue(new Error('HTTP 500'))
    renderDashboard()
    await waitFor(() => expect(within(kpi('/infrastructure')).getByText('—')).toBeInTheDocument())
    expect(kpi('/infrastructure').querySelector('[role="progressbar"]')).toBeNull()
    expect(within(kpi('/infrastructure')).queryByText('0')).toBeNull()
    expect(within(kpi('/security')).getByText('—')).toBeInTheDocument()
    expect(kpi('/security').querySelector('[role="progressbar"]')).toBeNull()
  })

  it('a null composite score with components: KPI "—", never 0, and no composite caption; the section has no ring', async () => {
    intelligenceSpy.mockResolvedValue({ ...PARTIAL_INTELLIGENCE, system_score: null, composite_state: null, status: 'Pending' } as never)
    renderDashboard()
    await waitFor(() => expect(screen.getByTestId('posture-tile-cost')).toBeInTheDocument())
    expect(within(kpi('/infrastructure')).getByText('—')).toBeInTheDocument()
    expect(within(kpi('/infrastructure')).queryByTestId('kpi-caption')).toBeNull()
    expect(screen.queryByTestId('posture-ring')).toBeNull()
    expect(screen.queryByTestId('posture-partial')).not.toBeInTheDocument()
  })

  it('a component error renders "—" in its tile and its panel row, never its placeholder 0', async () => {
    intelligenceSpy.mockResolvedValue({
      ...PARTIAL_INTELLIGENCE,
      components: { ...PARTIAL_INTELLIGENCE.components, cost: component('Cost Efficiency', 0, 'risk', { ready: false, state: 'error', reason: 'The cost score could not be computed.' }) },
    } as never)
    renderDashboard()
    await settled()
    const tile = screen.getByTestId('posture-tile-cost')
    expect(within(tile).getByText('—')).toBeInTheDocument()
    expect(within(tile).getByText('Could not be retrieved')).toBeInTheDocument()
    expect(tile.querySelector('[role="progressbar"]')).toBeNull()
    const row = within(openInfo(kpi('/infrastructure'), 'Infrastructure Posture details')).getByTestId('posture-evidence-cost')
    expect(within(row).getByText('—')).toBeInTheDocument()
  })

  it('a spend error is "—", never $0', async () => {
    costSummarySpy.mockRejectedValue(new Error('HTTP 500'))
    renderDashboard()
    await waitFor(() => expect(within(kpi('/costs')).getByText('—')).toBeInTheDocument())
    expect(kpi('/costs').textContent).not.toContain('$0')
  })
})

describe('9. estimated spend is labeled as an estimate', () => {
  it('the panel says inventory estimate, not AWS billed spend; the title is not "month-to-date actual"', async () => {
    costSummarySpy.mockResolvedValue({ spend: estimatedSpend(42.5), monthOverMonth: noMom('unavailable') })
    renderDashboard()
    await waitFor(() => expect(within(kpi('/costs')).getByText('$42.50/mo')).toBeInTheDocument())
    const card = kpi('/costs')
    expect(card.querySelector('a')!.textContent).toBe('Estimated Monthly Spend')
    const dialog = openInfo(card, 'Estimated Monthly Spend details')
    expect(dialog).toHaveTextContent('Estimate from resource inventory · not AWS billed spend')
    expect(dialog.textContent).not.toContain('Actual · AWS Cost Explorer')
    expect(within(card).getByTestId('kpi-caption')).toHaveTextContent('Estimated from inventory · not AWS billed spend')
  })

  it('actual spend: the panel gives provenance and the comparison basis with the still-billing note', async () => {
    renderDashboard()
    await settled()
    const dialog = openInfo(kpi('/costs'), 'Month-to-Date Spend details')
    expect(dialog).toHaveTextContent("Actual · AWS Cost Explorer · today's spend still being billed")
    expect(dialog).toHaveTextContent('Month to date vs same days last month · not the selected range · the current window ends today, which is still being billed')
  })
})

describe('10. change badge is neutral while today is still billing', () => {
  it('a decrease that includes today is neutral, not "improvement" green', async () => {
    renderDashboard()
    await settled()
    const badge = within(kpi('/costs')).getByTestId('spend-change')
    expect(badge).toHaveTextContent('-7% vs same days last month')
    expect(badge.style.color).toBe('var(--text-secondary)')
  })

  it('a fully billed decrease keeps its green', async () => {
    costSummarySpy.mockResolvedValue({ spend: actualSpend(123.45, false), monthOverMonth: mom(-7, -0.7, false) })
    renderDashboard()
    await settled()
    expect(within(kpi('/costs')).getByTestId('spend-change').style.color).toBe('var(--text-success)')
  })

  it('an unavailable comparison renders no change badge at all', async () => {
    costSummarySpy.mockResolvedValue({ spend: actualSpend(123.45), monthOverMonth: noMom('unavailable') })
    renderDashboard()
    await settled()
    expect(within(kpi('/costs')).queryByTestId('spend-change')).toBeNull()
  })
})

describe('11. Top Risk', () => {
  it('badge follows the finding\'s actual severity, the title drops the suffix the badge shows, and the card links to the findings', async () => {
    renderDashboard()
    await settled()
    const card = screen.getByTestId('top-risk-card')
    expect(within(card).getByTestId('top-risk-severity')).toHaveTextContent('Critical')
    expect(within(card).getByText('Root account has no MFA')).toBeInTheDocument()
    expect(card.textContent).not.toContain('(critical severity)')
    expect(card.closest('a')).toHaveAttribute('href', '/security#findings')
    expect(card.closest('a')).toHaveAttribute('aria-label', 'Top Risk: Root account has no MFA (critical severity)')
  })

  it('no top risk: the existing empty state, no badge, no link', async () => {
    aiSummarySpy.mockResolvedValue({ topRisk: null, topRiskStatus: 'none_identified' } as never)
    renderDashboard()
    await waitFor(() => expect(screen.getByText('No urgent risks identified')).toBeInTheDocument())
    const card = screen.getByTestId('top-risk-card')
    expect(within(card).queryByTestId('top-risk-severity')).toBeNull()
    expect(card.closest('a')).toBeNull()
  })
})

describe('12. DevControl System Health', () => {
  it('operational: one caption, "API and database responding · not your AWS resources"', async () => {
    renderDashboard()
    await settled()
    const card = screen.getByTestId('system-health-card')
    await waitFor(() => expect(card).toHaveTextContent('Operational'))
    expect(within(card).getByTestId('system-health-caption')).toHaveTextContent('API and database responding · not your AWS resources')
    expect(card.textContent).not.toMatch(/Live|Platform API/)
  })

  it('degraded: the existing wording, no "responding" claim', async () => {
    vi.spyOn(monitoringService, 'getSystemHealth').mockResolvedValue({ status: 'degraded' } as never)
    renderDashboard()
    await settled()
    const card = screen.getByTestId('system-health-card')
    await waitFor(() => expect(card).toHaveTextContent('Degraded'))
    expect(within(card).getByTestId('system-health-caption')).toHaveTextContent("DevControl's own services are degraded. Not a status of your AWS resources.")
    expect(card.textContent).not.toMatch(/responding/)
  })
})

describe('Security Posture face and panel agree on the compliance scan', () => {
  it('scan_completed false: "compliance scan pending" on the face and "Compliance scan pending" in the panel', async () => {
    vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: null, scan_completed: false } as never)
    renderDashboard()
    await settled()
    await waitFor(() => expect(within(kpi('/security')).getByTestId('kpi-caption')).toHaveTextContent('compliance scan pending'))
    expect(openInfo(kpi('/security'), 'Security Posture details')).toHaveTextContent('Resource compliance: Compliance scan pending')
  })

  it('scan_completed true with zero counts: no "pending" on the face, and the panel does not say "Not yet evaluated"', async () => {
    vi.spyOn(awsResourcesService, 'getStats').mockResolvedValue({ compliance_stats: { total_issues: 0, by_severity: { critical: 0, high: 0, medium: 0, low: 0 }, by_category: {} }, scan_completed: true } as never)
    renderDashboard()
    await settled()
    await waitFor(() => expect(within(kpi('/security')).getByTestId('kpi-caption')).toHaveTextContent(/^1 critical · 3 high · 1 low findings$/))
    const dialog = openInfo(kpi('/security'), 'Security Posture details')
    expect(dialog).toHaveTextContent('Resource compliance: No open issues in the completed compliance scan')
    expect(dialog.textContent).not.toMatch(/pending|Not yet evaluated/)
  })
})

describe('Security Posture panel', () => {
  it('active finding counts by severity (zero omitted, singular/plural), and resource compliance state', async () => {
    renderDashboard()
    await settled()
    const dialog = openInfo(kpi('/security'), 'Security Posture details')
    expect(dialog).toHaveTextContent('1 critical finding')
    expect(dialog).toHaveTextContent('3 high findings')
    expect(dialog).toHaveTextContent('1 low finding')
    expect(dialog.textContent).not.toMatch(/medium/)
    expect(dialog).toHaveTextContent('Resource compliance: Not yet evaluated')
  })
})
