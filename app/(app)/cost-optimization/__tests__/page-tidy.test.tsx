/**
 * Cost Optimization tidy (founder-approved mock, Nov 19), as laid out by the
 * light-lane layout (Nov 20): the top banner (green / blue / amber / red,
 * Review it, ×), the 2fr/1fr row, the Still detected group, the How DevControl
 * checks section's closed disclosures, counts from data, the money rule on the
 * page, and the truth fix (one finding, one state).
 * Real page and real React Query, mocked services, placeholder data only.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostOptimizationPage from '../page'
import type { CostRecommendation } from '@/lib/types'
import type { HiddenFinding, HiddenFindings } from '@/lib/services/cost-recommendations.service'
import { checks, run, waitForLastAnalysis } from './fixtures'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: <T,>(selector: (state: { enabled: boolean }) => T) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'member' }))

const svc = vi.hoisted(() => ({
  getAll: vi.fn(), getStats: vi.fn(), getAnalysisRuns: vi.fn(), getHidden: vi.fn(), getOptimizationRules: vi.fn(),
  reopen: vi.fn(), dismiss: vi.fn(), resolve: vi.fn(), analyze: vi.fn(), getAccounts: vi.fn(), getDiscoveryJobs: vi.fn(),
}))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    // The scan result banner: nothing waiting to be seen.
    getMyRunResult: async () => null,
    acknowledgeRunResult: async () => undefined,
    getAll: () => svc.getAll(),
    getStats: () => svc.getStats(),
    getOptimizationRules: () => svc.getOptimizationRules(),
    getAnalysisRuns: (...args: unknown[]) => svc.getAnalysisRuns(...args),
    getHidden: () => svc.getHidden(),
    reopen: (id: string) => svc.reopen(id),
    dismiss: (id: string) => svc.dismiss(id),
    resolve: (id: string) => svc.resolve(id),
    analyze: () => svc.analyze(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => { const accounts = await (svc.getAccounts()); return { accounts, connection: accounts.length > 0 ? 'connected' : 'not_connected' } } } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: () => svc.getDiscoveryJobs() } }))

function stats(overrides: Record<string, unknown> = {}) {
  return {
    totalRecommendations: 4, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
    potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, estimatedFindings: 0, unestimatedFindings: 0,
    bySeverity: { high: 0, medium: 0, low: 0 },
    ...overrides,
  }
}

const RULE_DETAIL = (name: string) => `How ${name} works, in full.`
const RULES = {
  rules: [
    { id: 'r1', name: 'Idle EC2 instances', status: 'implemented', detail: RULE_DETAIL('Idle EC2 instances'), service: 'EC2' },
    { id: 'r2', name: 'Unattached EBS volumes', status: 'implemented', detail: RULE_DETAIL('Unattached EBS volumes'), service: 'EBS' },
    { id: 'r3', name: 'S3 lifecycle', status: 'implemented', detail: RULE_DETAIL('S3 lifecycle'), service: 'S3' },
    { id: 'p1', name: 'RDS rightsizing', status: 'planned', detail: 'x', service: 'RDS' },
    { id: 'p2', name: 'NAT Gateway idle', status: 'planned', detail: 'x', service: 'NAT Gateway' },
  ],
  summary: {
    totalRules: 5, implementedCount: 3, plannedCount: 2,
    services: [
      { service: 'EC2', implementedCount: 1, plannedCount: 0 },
      { service: 'EBS', implementedCount: 1, plannedCount: 0 },
      { service: 'S3', implementedCount: 1, plannedCount: 0 },
      { service: 'RDS', implementedCount: 0, plannedCount: 1 },
      { service: 'NAT Gateway', implementedCount: 0, plannedCount: 1 },
    ],
  },
}

function item(id: string, overrides: Partial<Omit<HiddenFinding, 'detection'>> & { detection?: Partial<HiddenFinding['detection']> } = {}): HiddenFinding {
  const { detection, ...rest } = overrides
  return {
    id, decision: 'RESOLVED', decidedAt: '2026-11-10T10:00:00.000Z', decidedBy: 'Placeholder Person', decisionCount: 1,
    issue: 'Idle Instance', resourceId: `i-${id}`, resourceName: null, resourceType: 'EC2', awsRegion: 'us-east-1',
    ...rest,
    detection: {
      state: 'still_detected', reason: null, lastDetectedAt: '2026-11-18T06:00:00.000Z',
      potentialSavings: 7, savingsBasis: 'estimated:cloudwatch_cpu', severity: 'MEDIUM', description: 'Idle', ...detection,
    },
  }
}

function hidden(items: HiddenFinding[]): HiddenFindings {
  const resolved = items.filter((i) => i.decision === 'RESOLVED')
  const still = resolved.filter((i) => i.detection.state === 'still_detected')
  return {
    latestRun: { id: 'run-placeholder', runState: 'completed', completedAt: '2026-11-18T06:00:00.000Z' },
    summary: {
      resolved: resolved.length, dismissed: items.length - resolved.length,
      stillDetected: { count: still.length, estimatedMonthlySavings: still.length * 7, ceilingMonthlySavings: 0, ceilingByResourceType: {} },
      notConfirmed: resolved.length - still.length,
    },
    items,
  }
}

const NOTHING = hidden([])
const NOT_CONFIRMED = item('stale', { detection: { state: 'not_confirmed', reason: 'not_checked_since', lastDetectedAt: null, potentialSavings: null } })

function rec(id: string, savings: number): CostRecommendation {
  return {
    id, organizationId: 'org-placeholder', resourceId: `vol-${id}`, resourceName: null, resourceType: 'EBS', issue: 'Unattached Volume',
    description: 'Unattached', potentialSavings: savings, severity: 'LOW', status: 'ACTIVE', awsRegion: 'us-east-1',
    metadata: { savings_basis: 'estimated:list_price' }, createdAt: '2026-11-18T06:00:00.000Z', updatedAt: '2026-11-18T06:00:00.000Z', resolvedAt: null,
  } as unknown as CostRecommendation
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><CostOptimizationPage /></QueryClientProvider>)
}

const kpiCard = (label: string) => screen.getByText(label).parentElement as HTMLElement

async function loaded() {
  await waitForLastAnalysis()
  await waitFor(() => expect(screen.queryByTestId('hidden-loading')).not.toBeInTheDocument())
}

beforeEach(() => {
  vi.clearAllMocks()
  svc.getAll.mockResolvedValue([])
  svc.getStats.mockResolvedValue(stats())
  svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery' })])
  svc.getHidden.mockResolvedValue(NOTHING)
  svc.getOptimizationRules.mockResolvedValue(RULES)
  svc.getAccounts.mockResolvedValue([{ id: 'account-placeholder' }])
  svc.getDiscoveryJobs.mockResolvedValue([])
})

describe('truth fix: one finding gets exactly one state', () => {
  it('the founder\'s case: the run counted 1 resolved found again, /hidden says it is not confirmed: only C12', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', detected_count: 1, suppressed_resolved_count: 1 })])
    svc.getHidden.mockResolvedValue(hidden([NOT_CONFIRMED]))
    const { container } = renderPage()
    await loaded()
    expect(screen.getAllByText("1 resolved finding couldn't be re-checked by the latest analysis.")).toHaveLength(1)
    expect(container.textContent).not.toMatch(/found again/)
    expect(screen.queryByRole('button', { name: 'Review it' })).not.toBeInTheDocument()
  })

  it('the same finding still detected: "found again" in the group only (no banner since the scan result banner PR), no C12', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', detected_count: 1, suppressed_resolved_count: 1 })])
    svc.getHidden.mockResolvedValue(hidden([item('a')]))
    const { container } = renderPage()
    await loaded()
    expect(screen.queryByTestId('scan-result-banner')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Still detected (1)' })).toBeInTheDocument()
    expect(within(screen.getByTestId('still-detected-slot')).getByTestId('still-detected-meta')).toHaveTextContent(/found again in the analysis/)
    expect(container.textContent).not.toMatch(/couldn't be re-checked/)
  })
})

describe('Still detected group', () => {
  it('0: no group, no KPI note', async () => {
    renderPage()
    await loaded()
    expect(screen.queryByTestId('still-detected-slot')).not.toBeInTheDocument()
    expect(screen.queryByTestId('kpi-still-detected')).not.toBeInTheDocument()
  })

  it('1: "Still detected (1)", singular intro, KPI note', async () => {
    svc.getHidden.mockResolvedValue(hidden([item('a')]))
    renderPage()
    await loaded()
    expect(screen.getByRole('heading', { name: 'Still detected (1)' })).toBeInTheDocument()
    expect(screen.getByText("You marked this resolved, but the latest analysis found it again. It isn't counted in the totals above until you reopen it.")).toBeInTheDocument()
    expect(within(kpiCard('Open opportunities')).getByTestId('kpi-still-detected')).toHaveTextContent('+ 1 still detected (below)')
  })

  it('several: every card, plural intro, count in heading and KPI note', async () => {
    svc.getHidden.mockResolvedValue(hidden([item('a'), item('b'), item('c')]))
    renderPage()
    await loaded()
    const group = screen.getByTestId('still-detected-slot')
    expect(within(group).getByRole('heading', { name: 'Still detected (3)' })).toBeInTheDocument()
    expect(within(group).getAllByTestId('hidden-item')).toHaveLength(3)
    expect(within(group).getByText("You marked these resolved, but the latest analysis found them again. They aren't counted in the totals above until you reopen them.")).toBeInTheDocument()
    expect(screen.getByTestId('kpi-still-detected')).toHaveTextContent('+ 3 still detected (below)')
  })

  it('alongside open findings: the opportunities first, then the group, then the review list at the bottom', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ detected_count: 2, new_count: 1, persisted_count: 1, suppressed_resolved_count: 1 })])
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: 1, totalPotentialSavings: 4, estimatedFindings: 1, bySeverity: { high: 0, medium: 0, low: 1 } }))
    svc.getAll.mockResolvedValue([rec('open', 4)])
    svc.getHidden.mockResolvedValue(hidden([item('a')]))
    renderPage()
    await loaded()
    const column = screen.getByTestId('findings-column')
    const opportunities = within(column).getByRole('heading', { name: 'Opportunities (1)' })
    const group = within(column).getByTestId('still-detected-slot')
    expect(opportunities.compareDocumentPosition(group) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    // Resolved and dismissed: its own collapsible at the bottom, after How DevControl checks (ruling 6 of the layout).
    const reviewList = screen.getByTestId('review-list')
    expect(column).not.toContainElement(reviewList)
    expect(screen.getByTestId('checks-section').compareDocumentPosition(reviewList) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('not hidden by resolved/dismissed history: shown open while the review list stays collapsed', async () => {
    const history = Array.from({ length: 12 }, (_, i) => item(`d${i}`, { decision: i % 2 ? 'DISMISSED' : 'RESOLVED', detection: { state: 'not_confirmed', reason: 'not_checked_since' } }))
    svc.getHidden.mockResolvedValue(hidden([item('a'), ...history]))
    renderPage()
    await loaded()
    expect(within(screen.getByTestId('still-detected-slot')).getAllByTestId('hidden-item')).toHaveLength(1)
    const toggle = screen.getByRole('button', { name: /Resolved and dismissed \(13\)/ })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
  })
})

describe('How DevControl checks: what DevControl checks and coverage', () => {
  it('one line per active check, from the registry; the count note from data', async () => {
    renderPage()
    await loaded()
    const checksCard = screen.getByTestId('checks-card')
    expect(within(within(checksCard).getByTestId('check-names')).getAllByRole('listitem').map((li) => li.textContent)).toEqual(['Idle EC2 instances', 'Unattached EBS volumes', 'S3 lifecycle'])
    expect(within(checksCard).getByTestId('checks-count-note')).toHaveTextContent('3 active checks today — not every possible AWS cost optimization.')
  })

  it('"How each check works" is closed by default and holds every description', async () => {
    renderPage()
    await loaded()
    const details = screen.getByTestId('how-checks-work') as HTMLDetailsElement
    expect(details.tagName).toBe('DETAILS')
    expect(details.open).toBe(false)
    expect(within(details).getByText('How each check works').tagName).toBe('SUMMARY')
    for (const rule of RULES.rules.filter((r) => r.status === 'implemented')) {
      expect(within(details).getByText(rule.detail)).toBeInTheDocument()
    }
  })

  it('Coverage: counts and chips from data (active services only); "Planned / Coming soon (n)" closed, holding the full list', async () => {
    renderPage()
    await loaded()
    const coverage = screen.getByTestId('coverage-card')
    expect(within(coverage).getByTestId('coverage-line')).toHaveTextContent(/^3 active checks across EC2 · EBS · S3$/)
    expect(within(within(coverage).getByTestId('coverage-services')).getAllByText(/.+/).map((el) => el.textContent)).toEqual(['EC2', 'EBS', 'S3'])
    const planned = within(coverage).getByTestId('planned-checks') as HTMLDetailsElement
    expect(planned.open).toBe(false)
    expect(within(planned).getByText('Planned / Coming soon (2)').tagName).toBe('SUMMARY')
    expect(within(planned).getByText('RDS — RDS rightsizing')).toBeInTheDocument()
    expect(within(planned).getByText('NAT Gateway — NAT Gateway idle')).toBeInTheDocument()
  })

  it('counts follow the data, not literals', async () => {
    svc.getOptimizationRules.mockResolvedValue({
      rules: [RULES.rules[0], RULES.rules[3]],
      summary: { totalRules: 2, implementedCount: 1, plannedCount: 1, services: [RULES.summary.services[0], RULES.summary.services[3]] },
    })
    renderPage()
    await loaded()
    expect(screen.getByTestId('coverage-line')).toHaveTextContent(/^1 active check across EC2$/)
    expect(screen.getByTestId('coverage-card-line')).toHaveTextContent(/^AWS cost optimization · 1 active check$/)
    expect(screen.getByTestId('coverage-services-line')).toHaveTextContent(/^EC2$/)
    expect(screen.getByTestId('checks-count-note')).toHaveTextContent(/^1 active check today/)
    expect(screen.getByText('Planned / Coming soon (1)')).toBeInTheDocument()
  })

  it('the Summary is on the right of the findings column at desktop width (2fr / 1fr)', async () => {
    renderPage()
    await loaded()
    const grid = screen.getByTestId('findings-column').parentElement as HTMLElement
    expect(grid.className).toMatch(/lg:grid-cols-\[minmax\(0,2fr\)_minmax\(0,1fr\)\]/)
    expect(grid.children[1]).toBe(screen.getByTestId('summary-column'))
  })
})

describe('severity: three compact chips in the Open opportunities card', () => {
  it('High, Medium, Low with counts from /stats; "—" when stats failed', async () => {
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: 1, totalPotentialSavings: 4, estimatedFindings: 1, bySeverity: { high: 2, medium: 1, low: 0 } }))
    svc.getAll.mockResolvedValue([rec('open', 4)])
    const first = renderPage()
    await loaded()
    const rows = within(within(kpiCard('Open opportunities')).getByTestId('severity-chips')).getAllByRole('listitem')
    expect(rows.map((r) => r.textContent)).toEqual(['High 2', 'Medium 1', 'Low 0'])
    first.unmount()
    svc.getStats.mockRejectedValue(new Error('x'))
    renderPage()
    await waitFor(() => expect(within(kpiCard('Open opportunities')).getByText('Unavailable')).toBeInTheDocument())
    expect(within(screen.getByTestId('severity-chips')).getAllByRole('listitem').map((r) => r.textContent)).toEqual(['High —', 'Medium —', 'Low —'])
  })
})

describe('money rule on the page', () => {
  const show = async (total: number, estimatedFindings: number) => {
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: estimatedFindings, totalPotentialSavings: total, estimatedFindings }))
    renderPage()
    await loaded()
    // The annual card was dropped by the light-lane layout (founder ruling 2): the monthly figure only.
    return { monthly: within(kpiCard('Estimated monthly savings')).getByText('/mo').parentElement as HTMLElement }
  }

  it('0 with no estimates: "$0", muted', async () => {
    const { monthly } = await show(0, 0)
    expect(monthly).toHaveTextContent(/^\$0\/mo$/)
    expect(monthly.className).toMatch(/text-slate-500/)
    expect(screen.queryByText(/\/yr/)).not.toBeInTheDocument()
  })

  it('rounded-total edge: 0 with positive estimates behind it is "<$0.01/mo" (ruling 4), never "$0"', async () => {
    const { monthly } = await show(0, 2)
    expect(monthly).toHaveTextContent(/^<\$0\.01\/mo$/)
    expect(monthly.className).not.toMatch(/text-slate-500/)
  })

  it('exactly $0.01: "$0.01/mo"', async () => {
    const { monthly } = await show(0.01, 1)
    expect(monthly).toHaveTextContent(/^\$0\.01\/mo$/)
  })

  it('$1 and above: whole dollars', async () => {
    const { monthly } = await show(12.34, 1)
    expect(monthly).toHaveTextContent(/^\$12\/mo$/)
  })
})

// A "$0" that isn't part of "<$0.01" or "$0.xx".
const BARE_ZERO = /(?<!<)\$0(?![.\d])/

describe('upper bounds use the page\'s money rule (sub-cent "<$0.01", cents under $1, whole dollars from $1)', () => {
  function ceilingRec(id: string, savings: number): CostRecommendation {
    return { ...rec(id, savings), resourceType: 'S3', metadata: { savings_basis: 'ceiling: assumes all Standard storage qualifies for Standard-IA' } } as unknown as CostRecommendation
  }
  const summary = () => within(screen.getByTestId('summary-card')).getByTestId('summary-lines')

  it('a ceiling of 0.004: "Up to <$0.01/mo" on the savings card, the Summary and the opportunity card, never "$0"', async () => {
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: 1, potentialSavingsCeiling: 0.004, potentialSavingsCeilingByResourceType: { S3: 0.004 }, bySeverity: { high: 0, medium: 0, low: 1 } }))
    svc.getAll.mockResolvedValue([ceilingRec('tiny', 0.004)])
    renderPage()
    await loaded()
    const card = await screen.findByTestId('savings-upper-bound-only')
    expect(card).toHaveTextContent(/^Up to <\$0\.01\/mo · upper bound only$/)
    expect(within(summary()).getByText('No firm estimate yet. Up to <$0.01/mo is an upper bound only.')).toBeInTheDocument()
    const savings = within(await screen.findByTestId('opportunity-card')).getByTestId('opportunity-savings')
    expect(savings).toHaveTextContent(/^Up to <\$0\.01\/mo/)
    for (const el of [card, summary(), savings]) expect(el.textContent).not.toMatch(BARE_ZERO)
  })

  it('a firm total with a 0.004 ceiling: the Summary keeps them apart, "Up to <$0.01/mo more", never "$0"', async () => {
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: 2, totalPotentialSavings: 12.34, estimatedFindings: 1, potentialSavingsCeiling: 0.004, bySeverity: { high: 0, medium: 0, low: 2 } }))
    svc.getAll.mockResolvedValue([rec('firm', 12.34), ceilingRec('tiny', 0.004)])
    renderPage()
    await loaded()
    await waitFor(() => expect(within(summary()).getByText('$12/mo in firm estimates. Up to <$0.01/mo more is an upper bound only, not included.')).toBeInTheDocument())
    expect(summary().textContent).not.toMatch(BARE_ZERO)
  })

  it.each([[0.5, '$0.50'], [12.4, '$12']])('a ceiling of %s: "Up to %s/mo"', async (ceiling, label) => {
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: 1, potentialSavingsCeiling: ceiling, bySeverity: { high: 0, medium: 0, low: 1 } }))
    svc.getAll.mockResolvedValue([ceilingRec('c', ceiling)])
    renderPage()
    await loaded()
    expect(await screen.findByTestId('savings-upper-bound-only')).toHaveTextContent(`Up to ${label}/mo · upper bound only`)
    expect(within(await screen.findByTestId('opportunity-card')).getByTestId('opportunity-savings')).toHaveTextContent(new RegExp(`^Up to \\${label}/mo`))
  })
})

describe('Summary: the latest run\'s new count', () => {
  const lines = async () => {
    renderPage()
    await loaded()
    return within(within(screen.getByTestId('summary-card')).getByTestId('summary-lines')).getAllByRole('listitem').map((li) => li.textContent)
  }

  it('0 new: "Nothing new since the last analysis."', async () => {
    expect(await lines()).toContain('Nothing new since the last analysis.')
  })

  it.each([[1, '1 new since the last analysis.'], [3, '3 new since the last analysis.']])('%s new: "%s"', async (count, text) => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', detected_count: count, new_count: count, persisted_count: count })])
    expect(await lines()).toContain(text)
  })

  it('counts not recorded: no new-count line', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', new_count: null } as never)])
    expect((await lines()).some((line) => /since the last analysis/.test(line ?? ''))).toBe(false)
  })
})

describe('severity filter with no match', () => {
  it.each([
    ['High', 'LOW'], ['Medium', 'LOW'], ['Low', 'HIGH'],
  ])('the %s chip on a list with only a %s finding: "No <chip>-severity opportunities in this list."', async (chip, severity) => {
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: 1, totalPotentialSavings: 4, estimatedFindings: 1, bySeverity: { high: severity === 'HIGH' ? 1 : 0, medium: 0, low: severity === 'LOW' ? 1 : 0 } }))
    svc.getAll.mockResolvedValue([{ ...rec('one', 4), severity }])
    renderPage()
    await loaded()
    await screen.findByTestId('opportunity-card')
    fireEvent.click(within(screen.getByTestId('severity-filter')).getByRole('button', { name: new RegExp(`^${chip}`) }))
    expect(screen.getByTestId('filter-empty')).toHaveTextContent(new RegExp(`^No ${chip}-severity opportunities in this list\\.$`))
    expect(screen.queryByTestId('opportunity-card')).not.toBeInTheDocument()
  })
})

afterEach(() => {
  // @ts-expect-error -- restore jsdom's (absent) scrollIntoView between tests
  delete Element.prototype.scrollIntoView
})
