/**
 * Renders the Costs page (Cost Intelligence) against fixture API responses
 * and checks what a user actually reads:
 *   - an unavailable or failed month-over-month comparison never reads as
 *     "0%" / "flat"; a real 0% still does;
 *   - month-to-date spend keeps its provenance (actual $0, estimate, missing);
 *   - no annualized savings line and no "% of current spend" ratio (Cost
 *     Intelligence redesign PR A removed the yearly line);
 *   - a failed or empty Cost Explorer trend is not drawn as $0 spend;
 *   - the Ask AI chips are PR #137-supported questions.
 * All figures are test fixtures, not production data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
// The page reads the organization for its org- and UTC-day-keyed cost caches (DAY1-D10).
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }) }))
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CostSummary } from '@/lib/types'
import CostsPage from '../page'
import { DAY1_NONE, DAY2_CHARGE } from './month-state-fixtures'

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ isPro: true }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))

const mockGetCostSummary = vi.fn()
vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: { getCostSummary: () => mockGetCostSummary() },
}))

const mockGetStats = vi.fn()
const mockGetAll = vi.fn()
const mockGetAnalysisRuns = vi.fn()
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: { getStats: () => mockGetStats(), getAll: () => mockGetAll(), getAnalysisRuns: () => mockGetAnalysisRuns(), getOptimizationRules: async () => ({ rules: [], summary: { totalRules: 0, implementedCount: 0, plannedCount: 0, services: [] } }) },
}))
vi.mock('@/lib/services/aws-services.service', () => ({ default: { getCoverage: async () => ({ account: { connected: true, status: 'active', home_region: 'xx-test-1' } }) } }))

const mockGetDiscoveryJobs = vi.fn()
vi.mock('@/lib/services/aws-resources.service', () => ({
  awsResourcesService: { getDiscoveryJobs: () => mockGetDiscoveryJobs() },
}))

function analysisRun(status: 'running' | 'completed' | 'failed', createdAt = '2026-09-27T08:00:00.000Z') {
  return { id: `run-${status}`, status, recommendations_found: 0, total_potential_savings: null, started_at: createdAt, completed_at: status === 'running' ? null : createdAt, created_at: createdAt, error_message: null }
}

/** A scheduled discovery job (the 6-hourly cron, which also runs cost analysis). */
function discoveryJob(status: 'running' | 'completed' | 'failed', costAnalysisCompleted: boolean, createdAt = '2026-09-27T06:00:00.000Z') {
  return {
    id: `job-${status}`, organization_id: 'org-1', status, resources_discovered: 3, resources_updated: 0, resources_deleted: 0,
    regions: ['us-east-1'], resource_types: ['ec2'], error_message: null, started_at: createdAt,
    completed_at: status === 'running' ? null : createdAt, created_at: createdAt,
    compliance_scan_completed: true, cost_analysis_completed: costAnalysisCompleted,
  }
}
// PR2: the page asks whether an AWS account is connected; these suites are the connected page.
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'a', status: 'active' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/nl-query.service', () => ({ nlQueryService: { executeQuery: vi.fn() } }))

function recStats(totalPotentialSavings: number, activeRecommendations = 1) {
  return { totalRecommendations: activeRecommendations, activeRecommendations, totalPotentialSavings, potentialSavingsByResourceType: {}, potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 0 } }
}

function spendActual(amount: number): CostSummary['spend'] {
  return {
    state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: '2026-09-27T09:00:00.000Z', coverage: null, reason: null,
    data: { amount, basis: 'billed_month_to_date', lastDayInProgress: false },
  }
}

function mom(changePercent: number | null, changeAmount: number): CostSummary['monthOverMonth'] {
  return {
    state: 'available', source: 'DevControl month-over-month comparison', provenance: 'derived', asOf: null, coverage: null, reason: null,
    data: {
      currentWindow: { start: '2026-09-01', end: '2026-09-27' }, previousWindow: { start: '2026-08-01', end: '2026-08-27' },
      currentWindowTotal: 10 + changeAmount, previousWindowTotal: 10, changeAmount, changePercent, currentWindowIncludesToday: true,
    },
  }
}

function momMissing(state: 'unavailable' | 'error'): CostSummary['monthOverMonth'] {
  return { state, source: 'DevControl month-over-month comparison', provenance: null, asOf: null, coverage: null, reason: 'cannot be calculated', data: null }
}

/** Fixture Cost Explorer daily trend response for GET /api/platform/costs/trend. */
function trendResponse(ok: boolean, data: unknown[] = []) {
  return vi.fn().mockResolvedValue({ ok, json: async () => (ok ? { success: true, data } : { success: false }) })
}

function renderPage(client = new QueryClient({ defaultOptions: { queries: { retry: false } } })) {
  return render(<QueryClientProvider client={client}><CostsPage /></QueryClientProvider>)
}

/** The KPI card whose label is `label`. */
async function card(label: string) {
  const el = await screen.findAllByText(label)
  return el[0].closest('a') as HTMLElement
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetStats.mockResolvedValue(recStats(0.96))
  mockGetAll.mockResolvedValue([])
  mockGetAnalysisRuns.mockResolvedValue([analysisRun('completed')])
  mockGetDiscoveryJobs.mockResolvedValue([])
  vi.stubGlobal('fetch', trendResponse(true, [
    { date: '2026-09-26', compute: 0.21, storage: 0.1, database: 0, network: 0, other: 0.05, total: 0.36, byServiceDisplay: [{ service: 'EC2', amount: 0.21, color: '#111111' }, { service: 'S3', amount: 0.1, color: '#222222' }, { service: 'Other', amount: 0.05, color: '#333333' }] },
  ]))
})
afterEach(() => vi.unstubAllGlobals())

describe('Costs page -- month-over-month', () => {
  it('an unavailable comparison reads "not available" -- never 0% or flat', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: momMissing('unavailable') })
    renderPage()

    const momCard = await card('Month-over-Month Change')
    expect(await within(momCard).findByText(/Comparison not available/)).toBeInTheDocument()
    expect(momCard.textContent).not.toMatch(/0%|flat|stable|no change/i)
    expect(screen.queryByText(/flat vs/i)).not.toBeInTheDocument()
    // No spike verdict either way without a comparison.
    expect(screen.queryByText(/No spend spike|All systems clear/)).not.toBeInTheDocument()
  })

  it('a failed comparison reads "could not be retrieved" -- never 0% or flat', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: momMissing('error') })
    renderPage()

    const momCard = await card('Month-over-Month Change')
    expect(await within(momCard).findByText(/Comparison could not be retrieved/)).toBeInTheDocument()
    expect(momCard.textContent).not.toMatch(/0%|flat/i)
  })

  it('a failed summary request is an error, not 0% and not $0', async () => {
    mockGetCostSummary.mockRejectedValue(new Error('500'))
    renderPage()

    const momCard = await card('Month-over-Month Change')
    expect(await within(momCard).findByText(/Comparison could not be retrieved/)).toBeInTheDocument()
    const spendCard = await card('Month-to-Date Spend')
    expect(within(spendCard).getByText('Could not be retrieved')).toBeInTheDocument()
    expect(spendCard.textContent).not.toMatch(/\$0/)
  })

  it('a genuine 0% change still reads 0% and flat', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(0, 0) })
    renderPage()

    const momCard = await card('Month-over-Month Change')
    expect(await within(momCard).findByText('0%')).toBeInTheDocument()
    expect(within(momCard).getByText(/Spend flat vs the same days last month/)).toBeInTheDocument()
  })

  it('positive and negative changes show their real percentages', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(14.2, 1.42) })
    const { unmount } = renderPage()
    expect(await within(await card('Month-over-Month Change')).findByText('+14.2%')).toBeInTheDocument()
    unmount()

    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(-6.5, -0.65) })
    renderPage()
    expect(await within(await card('Month-over-Month Change')).findByText('-6.5%')).toBeInTheDocument()
  })
})

describe('Costs page -- the first days of a UTC month (DAY1)', () => {
  it('Dec 1, no billed days yet: "—", the UTC period, and November\'s total -- never $0.00', async () => {
    mockGetCostSummary.mockResolvedValue(DAY1_NONE)
    renderPage()
    const spendCard = await card('Month-to-Date Spend')
    expect(await within(spendCard).findByText('Dec 1 (UTC) · AWS Cost Explorer · no billed days yet this month')).toBeInTheDocument()
    expect(within(spendCard).getByText('—')).toBeInTheDocument()
    expect(within(spendCard).getByTestId('previous-month-line')).toHaveTextContent('November (UTC): $399.00 · latest days still updating')
    expect(spendCard.textContent).not.toContain('$0.00')
  })

  it('Dec 2 with a charge: the amount and "latest days still updating"', async () => {
    mockGetCostSummary.mockResolvedValue(DAY2_CHARGE)
    renderPage()
    const spendCard = await card('Month-to-Date Spend')
    expect(await within(spendCard).findByText('$13.30')).toBeInTheDocument()
    expect(within(spendCard).getByText('Dec 1–2 (UTC) · Actual · AWS Cost Explorer · latest days still updating')).toBeInTheDocument()
    expect(within(spendCard).getByTestId('previous-month-line')).toHaveTextContent('November (UTC): $399.00')
  })
})

describe('Costs page -- spend provenance', () => {
  it('a real $0 Cost Explorer month is shown as actual $0.00', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(0), monthOverMonth: mom(0, 0) })
    renderPage()

    const spendCard = await card('Month-to-Date Spend')
    expect(await within(spendCard).findByText('$0.00')).toBeInTheDocument()
    expect(within(spendCard).getByText(/Actual · AWS Cost Explorer/)).toBeInTheDocument()
  })

  it('an inventory estimate is labeled estimated, not AWS billed spend', async () => {
    mockGetCostSummary.mockResolvedValue({
      spend: {
        state: 'available', source: 'DevControl inventory cost estimate', provenance: 'estimated', asOf: null, coverage: null, reason: null,
        data: { amount: 42.5, basis: 'estimated_monthly_run_rate', lastDayInProgress: false, estimateCoverage: { pricedResources: 3, totalResources: 4 } },
      },
      monthOverMonth: momMissing('unavailable'),
    })
    renderPage()

    const spendCard = await card('Estimated Monthly Run-Rate')
    expect(within(spendCard).getByText('$42.50/mo')).toBeInTheDocument()
    expect(within(spendCard).getByText(/not AWS billed spend/)).toBeInTheDocument()
    expect(screen.queryByText('Live from AWS Cost Explorer')).not.toBeInTheDocument()
  })
})

describe('Costs page -- savings wording', () => {
  beforeEach(() => mockGetCostSummary.mockResolvedValue({ spend: spendActual(3.2), monthOverMonth: mom(0, 0) }))

  it('no annualized line (removed in PR A), and there is no "% of current spend"', async () => {
    renderPage()

    expect(await within(await card('Savings Opportunity')).findByText('$0.96/mo')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/annualized|\/yr/)
    expect(document.body.textContent).not.toMatch(/% of current spend/)
  })

  it('a failed recommendations request is not a $0 opportunity', async () => {
    mockGetStats.mockRejectedValue(new Error('500'))
    mockGetAll.mockRejectedValue(new Error('500'))
    renderPage()

    const savingsCard = await card('Savings Opportunity')
    expect(await within(savingsCard).findByText('Could not be retrieved')).toBeInTheDocument()
    expect(savingsCard.textContent).not.toMatch(/\$0/)
    expect(await screen.findByText('Recommendations could not be retrieved.')).toBeInTheDocument()
  })

  // In-app polish: the action is named as on Cost Optimization's button ("Run cost analysis").
  it('no recommendations listed: the hint names Run cost analysis, never a "cost scan"', async () => {
    renderPage()

    expect(await screen.findByText('No optimization recommendations yet. Run cost analysis to identify savings opportunities.')).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/cost scan/i)
  })
})

describe('Costs page -- zero recommendations before any cost analysis', () => {
  beforeEach(() => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(3.2), monthOverMonth: mom(0, 0) })
    mockGetStats.mockResolvedValue(recStats(0, 0))
  })

  async function expectNotMeasured(sub: string | RegExp) {
    const savingsCard = await card('Savings Opportunity')
    const recsCard = await card('Active Findings')
    expect(await within(savingsCard).findByText(sub)).toBeInTheDocument()
    expect(within(recsCard).getByText(sub)).toBeInTheDocument()
    for (const c of [savingsCard, recsCard]) {
      expect(c.textContent).not.toMatch(/\$0/)
      expect(c.textContent).not.toMatch(/No open recommendations/)
      expect(c.textContent).toContain('—')
    }
    expect(document.body.textContent).not.toMatch(/\$0\/mo/)
  }

  it('no analysis has ever run: not a measured $0 or 0', async () => {
    mockGetAnalysisRuns.mockResolvedValue([])
    renderPage()
    await expectNotMeasured('No cost analysis has run yet')
  })

  it('the latest analysis failed: not measured', async () => {
    mockGetAnalysisRuns.mockResolvedValue([analysisRun('failed')])
    renderPage()
    await expectNotMeasured('Latest cost analysis did not complete')
  })

  it('an analysis is running: in progress, not $0', async () => {
    mockGetAnalysisRuns.mockResolvedValue([analysisRun('running')])
    renderPage()
    await expectNotMeasured('Cost analysis in progress')
  })

  it('the analysis history could not be retrieved: unknown, not $0', async () => {
    mockGetAnalysisRuns.mockRejectedValue(new Error('500'))
    renderPage()
    await expectNotMeasured('Could not be retrieved')
  })

  it('after a completed analysis, zero is a measured result: "None found", never "$0/mo" (ruling Q2)', async () => {
    mockGetAnalysisRuns.mockResolvedValue([analysisRun('completed')])
    renderPage()

    const recsCard = await card('Active Findings')
    expect(await within(recsCard).findByText('No open recommendations')).toBeInTheDocument()
    expect(within(recsCard).getByText('0')).toBeInTheDocument()
    const savingsCard = await card('Savings Opportunity')
    expect(within(savingsCard).getByText('None found')).toBeInTheDocument()
    expect(savingsCard.textContent).not.toMatch(/\$0/)
  })

  it('a completed scheduled (discovery) analysis counts: zero is a measured result', async () => {
    mockGetAnalysisRuns.mockResolvedValue([])
    mockGetDiscoveryJobs.mockResolvedValue([discoveryJob('completed', true)])
    renderPage()

    const recsCard = await card('Active Findings')
    expect(await within(recsCard).findByText('No open recommendations')).toBeInTheDocument()
    expect(within(recsCard).getByText('0')).toBeInTheDocument()
    expect((await card('Savings Opportunity')).textContent).toContain('None found')
  })

  it('a scheduled job whose cost analysis did not finish is not a measured $0', async () => {
    mockGetAnalysisRuns.mockResolvedValue([])
    mockGetDiscoveryJobs.mockResolvedValue([discoveryJob('completed', false)])
    renderPage()
    await expectNotMeasured('Latest cost analysis did not complete')
  })

  it('a failed manual run newer than a completed scheduled analysis is not a measured $0', async () => {
    mockGetDiscoveryJobs.mockResolvedValue([discoveryJob('completed', true, '2026-09-27T06:00:00.000Z')])
    mockGetAnalysisRuns.mockResolvedValue([analysisRun('failed', '2026-09-27T09:00:00.000Z')])
    renderPage()
    await expectNotMeasured('Latest cost analysis did not complete')
  })

  it('the scheduled-analysis history could not be retrieved: unknown, not $0', async () => {
    mockGetDiscoveryJobs.mockRejectedValue(new Error('500'))
    renderPage()
    await expectNotMeasured('Could not be retrieved')
  })

  it('the page subtitle is the spec\'s (item 5): no real-time or "AI-powered" claim', async () => {
    renderPage()
    await card('Savings Opportunity')
    const subtitle = screen.getByText('AWS spend visibility, cost drivers, and evidence-backed optimization opportunities.')
    expect(subtitle.textContent).not.toMatch(/real[- ]?time|AI-powered/i)
    expect(document.body.textContent).not.toMatch(/AI-powered/)
  })

  it('top savings rows label each figure by its basis: estimate, "Up to" ceiling, or "No dollar estimate"', async () => {
    const recommendation = (id: string, issue: string, potentialSavings: number, metadata: Record<string, unknown>) => ({
      id, resourceId: id, resourceType: 'S3', issue, potentialSavings, severity: 'LOW', status: 'ACTIVE', metadata, createdAt: '', updatedAt: '',
    })
    mockGetStats.mockResolvedValue(recStats(12.4, 3))
    mockGetAll.mockResolvedValue([
      recommendation('b-1', 'S3 Lifecycle Optimization', 41.27, { savings_basis: 'ceiling: assumes 100% transitions' }),
      recommendation('v-1', 'Unattached EBS Volume', 12.4, { savings_basis: 'estimated: list price' }),
      recommendation('ri-1', 'Reserved Instance Opportunity', 0, {}),
    ])
    renderPage()

    const row = async (title: string) => (await screen.findByText(title)).closest('[data-testid="opportunity-card"]') as HTMLElement
    expect(await row('S3 Lifecycle Optimization')).toHaveTextContent('Up to $41/mo')
    expect(await row('Unattached EBS Volume')).toHaveTextContent('$12/mo')
    expect(await row('Reserved Instance Opportunity')).toHaveTextContent('No dollar estimate')
    expect((await row('Reserved Instance Opportunity')).textContent).not.toMatch(/\$0/)
    // Ranked by the figure shown (fix round 1, N-7): the $41 upper bound before the $12 estimate, basis-less last.
    const titles = ['S3 Lifecycle Optimization', 'Unattached EBS Volume', 'Reserved Instance Opportunity'].map((t) => screen.getByText(t))
    expect(titles[0].compareDocumentPosition(titles[1]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(titles[1].compareDocumentPosition(titles[2]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('C1b: a priced idle RDS row is a compact "$X/mo" like any estimate -- the Cost Optimization explanation is not repeated here', async () => {
    mockGetStats.mockResolvedValue(recStats(52.56, 1))
    mockGetAll.mockResolvedValue([
      { id: 'rds-1', resourceId: 'placeholder-db-1', resourceType: 'RDS', issue: 'Idle RDS Instance', potentialSavings: 52.56, severity: 'MEDIUM', status: 'ACTIVE', createdAt: '', updatedAt: '',
        metadata: { rule_version: 2, savings_basis: 'estimated: the us-east-1 on-demand list price for db.t3.medium PostgreSQL Single-AZ instance hours ($0.072/hour, 730 hours); storage, Provisioned IOPS, backups and snapshots are not included and are still billed while the instance is stopped; no reservation or discount applied; not billed cost', price_region: 'us-east-1', price_instance_class: 'db.t3.medium', price_engine_label: 'PostgreSQL', price_deployment: 'Single-AZ' } },
    ])
    renderPage()
    const row = (await screen.findByText('Idle RDS Instance')).closest('[data-testid="opportunity-card"]') as HTMLElement
    expect(row).toHaveTextContent('$53/mo')
    expect(document.body.textContent).not.toMatch(/Estimated from the|instance hours only|restarts a stopped database/)
  })

  it('PR 4 S2: a default-price figure reads "(price unknown)"; a genuine $50 list price and a legacy row do not', async () => {
    const recommendation = (id: string, issue: string, metadata: Record<string, unknown>) => ({
      id, resourceId: id, resourceType: 'EC2', issue, potentialSavings: 50, severity: 'LOW', status: 'ACTIVE', metadata, createdAt: '', updatedAt: '',
    })
    mockGetStats.mockResolvedValue(recStats(150, 3))
    mockGetAll.mockResolvedValue([
      recommendation('d-1', 'Idle Instance (default)', { savings_basis: 'estimated: list price', price_source: 'default_unlisted_type' }),
      recommendation('l-1', 'Idle Instance (listed)', { savings_basis: 'estimated: list price', price_source: 'list_table' }),
      recommendation('g-1', 'Idle Instance (legacy)', { savings_basis: 'estimated: list price' }),
    ])
    renderPage()

    const row = async (title: string) => (await screen.findByText(title)).closest('[data-testid="opportunity-card"]') as HTMLElement
    expect(await row('Idle Instance (default)')).toHaveTextContent('$50/mo (price unknown)')
    expect(within(await row('Idle Instance (listed)')).getByTestId('opportunity-savings').textContent).toBe('$50/mo')
    expect(within(await row('Idle Instance (legacy)')).getByTestId('opportunity-savings').textContent).toBe('$50/mo')
    expect(screen.getAllByText(/\(price unknown\)/)).toHaveLength(1)
  })

  it('existing recommendations are shown even without analysis history', async () => {
    mockGetStats.mockResolvedValue(recStats(120, 3))
    mockGetAnalysisRuns.mockResolvedValue([])
    renderPage()

    const recsCard = await card('Active Findings')
    expect(await within(recsCard).findByText('3')).toBeInTheDocument()
    expect(within(recsCard).getByText('Ready to review')).toBeInTheDocument()
  })
})

describe('Costs page -- spend trend', () => {
  beforeEach(() => mockGetCostSummary.mockResolvedValue({ spend: spendActual(3.2), monthOverMonth: mom(0, 0) }))

  it('a failed trend request is shown as an error, not as $0 spend by service', async () => {
    vi.stubGlobal('fetch', trendResponse(false))
    renderPage()

    expect(await screen.findByText('The spend trend could not be retrieved from AWS Cost Explorer.')).toBeInTheDocument()
    expect(screen.getByText('Cost by service could not be retrieved from AWS Cost Explorer.')).toBeInTheDocument()
    expect(screen.queryByText('Compute (EC2, Lambda, ECS)')).not.toBeInTheDocument()
  })

  it('sub-dollar service spend keeps its cents', async () => {
    renderPage()

    const list = await screen.findByTestId('cost-drivers-list')
    expect(within(list).getByText('EC2')).toBeInTheDocument()
    expect(within(list).getByText('$0.21')).toBeInTheDocument()
  })
})

describe('Costs page -- Ask AI chips', () => {
  it('suggests only questions Ask AI supports', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(3.2), monthOverMonth: mom(0, 0) })
    renderPage()

    expect(await screen.findByRole('button', { name: 'What is my AWS spend this month?' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show running EC2 instances' })).toBeInTheDocument()
    expect(document.body.textContent).not.toMatch(/expensive EC2|critical alerts/i)
  })
})

describe('Costs page -- month-over-month basis', () => {
  it('safeguard 2: the month-over-month tile states the fixed finished-days basis for every chart range', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(14.2, 1.42) })
    renderPage()

    for (const range of ['7D', '30D', '3M']) {
      fireEvent.click(await screen.findByRole('button', { name: range }))
      const basis = await screen.findByTestId('mom-basis')
      expect(basis.textContent).toBe('Finished days this month vs same days last month · not the selected range · Net of credits and refunds.')
      expect(basis.textContent).not.toMatch(/below \$0|count as \$0/)
      expect(within(await card('Month-over-Month Change')).getByTestId('mom-basis')).toBe(basis)
    }
    // The comparison is fetched once, not per range.
    expect(mockGetCostSummary).toHaveBeenCalledTimes(1)
  })

  it('the KPI card discloses that today is still being billed', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(0, 0) })
    renderPage()

    const momCard = await card('Month-over-Month Change')
    expect(await within(momCard).findByText("Spend flat vs the same days last month · today's spend still being billed")).toBeInTheDocument()
  })

  it('early in the month (no day finished reporting yet), the KPI says so instead of "not enough data", with no percentage', async () => {
    const oct2: CostSummary['spend'] = {
      ...spendActual(0.19),
      period: { kind: 'range', start: '2026-10-01', endExclusive: '2026-10-03' },
      data: { amount: 0.19, basis: 'billed_month_to_date', lastDayInProgress: true, finishedThrough: '2026-09-30' },
    }
    mockGetCostSummary.mockResolvedValue({ spend: oct2, monthOverMonth: momMissing('unavailable') })
    renderPage()

    const momCard = await card('Month-over-Month Change')
    expect(await within(momCard).findByText('No comparison yet · latest days still updating')).toBeInTheDocument()
    expect(momCard.textContent).not.toMatch(/\d%/)
  })

  it('the tile still states its basis when no comparison exists', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: momMissing('unavailable') })
    renderPage()

    expect((await screen.findByTestId('mom-basis')).textContent).toBe('Finished days this month vs same days last month · not the selected range · Net of credits and refunds.')
  })
})

describe('Costs page -- trend cache is its own', () => {
  it("a [] cached by another page under ['cost-trend', …] never reads as no data; the 3M view fetches and shows its failure", async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(0, 0) })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['cost-trend', '6mo'], [])
    client.setQueryData(['cost-trend', '90d'], [])
    const fetchMock = trendResponse(false)
    vi.stubGlobal('fetch', fetchMock)
    renderPage(client)

    fireEvent.click(await screen.findByRole('button', { name: '3M' }))

    expect(await screen.findByText('The spend trend could not be retrieved from AWS Cost Explorer.')).toBeInTheDocument()
    expect(screen.queryByText('No AWS Cost Explorer spend data is available for this range.')).not.toBeInTheDocument()
    await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/api/platform/costs/trend?range=90d'))).toBe(true))
    // The other pages' cache entries are left as they were.
    expect(client.getQueryData(['cost-trend', '6mo'])).toEqual([])
    expect(client.getQueryData(['cost-trend', '90d'])).toEqual([])
  })
})

describe('Costs page -- spike banner and badge (removed, ruling Q13)', () => {
  it('a +25% month shows its % in the tile, with no banner, badge or /anomalies link', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(25, 2.5) })
    renderPage()

    expect(await within(await card('Month-over-Month Change')).findByText('+25%')).toBeInTheDocument()
    expect(screen.queryByText('Spend Up Sharply vs Last Month')).not.toBeInTheDocument()
    expect(screen.queryByText(/Spend up over 20%|No spend spike|more than 20% above/)).not.toBeInTheDocument()
    expect(document.querySelector('a[href="/anomalies"]')).toBeNull()
  })
})

describe('Costs page -- trend basis', () => {
  it('says the Spend Trend is after credits and refunds, each category floored at $0', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(0), monthOverMonth: mom(0, 0) })
    renderPage()
    expect(await screen.findByText(/from Cost Explorer · After credits and refunds; amounts below \$0 count as \$0/)).toBeInTheDocument()
  })

  it('the month-over-month strip is net (PR B1: summed from each day\'s real net, nothing floored): "Net of credits and refunds."', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(14.2, 1.42) })
    renderPage()
    const basis = (await screen.findByTestId('mom-basis')).textContent
    expect(basis).toContain('Net of credits and refunds.')
    expect(basis).not.toMatch(/amounts below \$0 count as \$0/)
  })

  it('Cost drivers, summed from the trend by AWS service, states the after-credits, floored basis', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(0, 0) })
    renderPage()
    const basis = await screen.findByTestId('cost-drivers-basis')
    expect(basis.textContent).toBe('AWS Cost Explorer · by AWS service · After credits and refunds; amounts below $0 count as $0')
  })

  it('the exported CSV opens with the same basis row before its header', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(0, 0) })
    let blob: Blob | undefined
    // jsdom has no object URLs; capture the exported Blob instead.
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    URL.createObjectURL = (b: Blob) => { blob = b; return 'blob:test' }
    URL.revokeObjectURL = () => {}
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage()
    // Wait for the trend rows so the export carries them.
    await screen.findByTestId('cost-drivers-list')
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
    expect(click).toHaveBeenCalled()
    const lines = (await blob!.text()).split('\n')
    expect(lines[0]).toBe('"AWS Cost Explorer daily totals · After credits and refunds; amounts below $0 count as $0"')
    expect(lines[1]).toBe('"Date","Service","Cost"')
    expect(lines[2]).toMatch(/^"2026-09-26",/)
    click.mockRestore()
    URL.createObjectURL = original.create
    URL.revokeObjectURL = original.revoke
  })
})
