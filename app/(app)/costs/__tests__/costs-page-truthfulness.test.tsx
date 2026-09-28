/**
 * Renders the Costs page (Cost Intelligence) against fixture API responses
 * and checks what a user actually reads:
 *   - an unavailable or failed month-over-month comparison never reads as
 *     "0%" / "flat"; a real 0% still does;
 *   - month-to-date spend keeps its provenance (actual $0, estimate, missing);
 *   - the annual savings figure is labeled an annualized estimate, and no
 *     "% of current spend" ratio is shown;
 *   - a failed or empty Cost Explorer trend is not drawn as $0 spend;
 *   - the Ask AI chips are PR #137-supported questions.
 * All figures are test fixtures, not production data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { CostSummary } from '@/lib/types'
import CostsPage from '../page'

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
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: { getStats: () => mockGetStats(), getAll: () => mockGetAll() },
}))
vi.mock('@/lib/services/nl-query.service', () => ({ nlQueryService: { executeQuery: vi.fn() } }))

function recStats(totalPotentialSavings: number, activeRecommendations = 1) {
  return { totalRecommendations: activeRecommendations, activeRecommendations, totalPotentialSavings, potentialSavingsByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 0 } }
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
  vi.stubGlobal('fetch', trendResponse(true, [
    { date: '2026-09-26', compute: 0.21, storage: 0.1, database: 0, network: 0, other: 0.05, total: 0.36 },
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
        data: { amount: 42.5, basis: 'estimated_monthly_run_rate', lastDayInProgress: false },
      },
      monthOverMonth: momMissing('unavailable'),
    })
    renderPage()

    const spendCard = await card('Estimated Monthly Spend')
    expect(within(spendCard).getByText('$42.50/mo')).toBeInTheDocument()
    expect(within(spendCard).getByText(/not AWS billed spend/)).toBeInTheDocument()
    expect(screen.queryByText('Live from AWS Cost Explorer')).not.toBeInTheDocument()
  })
})

describe('Costs page -- savings wording', () => {
  beforeEach(() => mockGetCostSummary.mockResolvedValue({ spend: spendActual(3.2), monthOverMonth: mom(0, 0) }))

  it('the annual figure is an annualized estimate, and there is no "% of current spend"', async () => {
    renderPage()

    expect((await screen.findAllByText('$12/yr annualized estimate (monthly estimate × 12)')).length).toBeGreaterThan(0)
    expect(document.body.textContent).not.toMatch(/% of current spend/)
    expect(document.body.textContent).not.toMatch(/\$12 annually/)
  })

  it('a failed recommendations request is not a $0 opportunity', async () => {
    mockGetStats.mockRejectedValue(new Error('500'))
    mockGetAll.mockRejectedValue(new Error('500'))
    renderPage()

    const savingsCard = await card('Estimated Savings Opportunity')
    expect(await within(savingsCard).findByText('Could not be retrieved')).toBeInTheDocument()
    expect(savingsCard.textContent).not.toMatch(/\$0/)
    expect(await screen.findByText('Recommendations could not be retrieved.')).toBeInTheDocument()
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

  it('sub-dollar category spend keeps its cents', async () => {
    renderPage()

    expect(await screen.findByText('Compute (EC2, Lambda, ECS)')).toBeInTheDocument()
    expect(screen.getAllByText('$0.21').length).toBeGreaterThan(0)
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
  it('the Spend Trend strip states the fixed MTD basis and the still-billing caveat for every chart range', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(14.2, 1.42) })
    renderPage()

    for (const range of ['7D', '30D', '3M', '6M', '1Y']) {
      fireEvent.click(await screen.findByRole('button', { name: range }))
      const basis = await screen.findByTestId('mom-basis')
      expect(basis.textContent).toBe("Month to date vs same days last month · not the selected range · today's spend still being billed")
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

  it('the strip still states its basis when no comparison exists', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: momMissing('unavailable') })
    renderPage()

    expect((await screen.findByTestId('mom-basis')).textContent).toBe('Month to date vs same days last month · not the selected range')
  })
})

describe('Costs page -- trend cache is its own', () => {
  it("a [] cached by /costs/efficiency under ['cost-trend', '6mo'] never reads as no data; the 6M view fetches and shows its failure", async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(0, 0) })
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    client.setQueryData(['cost-trend', '6mo'], [])
    const fetchMock = trendResponse(false)
    vi.stubGlobal('fetch', fetchMock)
    renderPage(client)

    fireEvent.click(await screen.findByRole('button', { name: '6M' }))

    expect(await screen.findByText('The spend trend could not be retrieved from AWS Cost Explorer.')).toBeInTheDocument()
    expect(screen.queryByText('No AWS Cost Explorer spend data is available for this range.')).not.toBeInTheDocument()
    await waitFor(() => expect(fetchMock.mock.calls.some(call => String(call[0]).includes('/api/platform/costs/trend?range=6mo'))).toBe(true))
    // The efficiency page's cache entry is left as it was.
    expect(client.getQueryData(['cost-trend', '6mo'])).toEqual([])
  })
})

describe('Costs page -- spike banner', () => {
  it('renders without an Investigate link to /anomalies', async () => {
    mockGetCostSummary.mockResolvedValue({ spend: spendActual(12), monthOverMonth: mom(25, 2.5) })
    renderPage()

    expect(await screen.findByText('Spend Up Sharply vs Last Month')).toBeInTheDocument()
    expect(document.querySelector('a[href="/anomalies"]')).toBeNull()
    expect(screen.queryByText(/Investigate/)).not.toBeInTheDocument()
    expect(screen.getByText(/more than 20% above the same days last month \(AWS Cost Explorer\); today's spend still being billed/)).toBeInTheDocument()
  })
})
