/**
 * Cost Intelligence redesign, PR A (founder rulings: review-logs/cost-intelligence/stage-a.md, Addendum 1).
 * Renders the page against fixture API responses and checks:
 *   - safeguard 1: the chart, the cost drivers donut and its total label use ONE set of days;
 *   - safeguard 2: the month-over-month % carries its finished-days caption;
 *   - safeguard 4: "Why:" never shows an ARN, VPC ID or other raw identifier;
 *   - safeguard 5: loading or missing figures are "—", never 0 or $0;
 *   - ruling Q2 savings wording, Q3 neutral colour, spec item 6 checks from the catalog, item 7 Last analysis;
 *   - the kept items (KPI tile links, Export CSV, "Cost data as of", 7D/30D/3M) and the approved removals;
 *   - demo mode fills the new layout without the dropped demo extras (ruling Q14).
 * Recharts runs for real (ResponsiveContainer is given a size); the AreaChart's data is recorded.
 * All figures, names and IDs are test fixtures, not production data.
 */
import { cloneElement } from 'react'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }) }))
const charts = vi.hoisted(() => ({ data: [] as Array<{ date: string }> }))
const m = vi.hoisted(() => ({ demo: false }))
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) => cloneElement(children, { width: 600, height: 240 }),
    AreaChart: (props: React.ComponentProps<typeof actual.AreaChart>) => {
      charts.data = (props.data ?? []) as Array<{ date: string }>
      return <actual.AreaChart {...props} />
    },
  }
})
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostsPage from '../page'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ isPro: true }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => m.demo }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))

const mockGetCostSummary = vi.fn()
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: () => mockGetCostSummary() } }))
const mockGetStats = vi.fn()
const mockGetAll = vi.fn()
const mockGetAnalysisRuns = vi.fn()
const mockGetRules = vi.fn()
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: { getStats: () => mockGetStats(), getAll: () => mockGetAll(), getAnalysisRuns: (...a: unknown[]) => mockGetAnalysisRuns(...a), getOptimizationRules: () => mockGetRules() },
}))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'a', status: 'active' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/aws-services.service', () => ({ default: { getCoverage: async () => ({ account: { connected: true, status: 'active', home_region: 'xx-test-1' } }) } }))
vi.mock('@/lib/services/nl-query.service', () => ({ nlQueryService: { executeQuery: vi.fn() } }))

const pending = () => new Promise<never>(() => {})

function summary(changePercent: number, amount = 16.91) {
  return {
    spend: {
      state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: '2026-11-26T09:00:00.000Z', coverage: null, reason: null,
      data: { amount, basis: 'billed_month_to_date', lastDayInProgress: false },
    },
    monthOverMonth: {
      state: 'available', source: 'DevControl month-over-month comparison', provenance: 'derived', asOf: null, coverage: null, reason: null,
      data: { currentWindow: { start: '2026-11-01', end: '2026-11-23' }, previousWindow: { start: '2026-10-01', end: '2026-10-23' }, currentWindowTotal: 10, previousWindowTotal: 10, changeAmount: changePercent / 10, changePercent, currentWindowIncludesToday: false },
    },
  }
}

function recStats(over: Record<string, unknown> = {}) {
  return { totalRecommendations: 1, activeRecommendations: 1, totalPotentialSavings: 0, potentialSavingsByResourceType: {}, potentialSavingsCeiling: 0.01, potentialSavingsCeilingByResourceType: { 'EBS Snapshot': 0.01 }, estimatedFindings: 0, unestimatedFindings: 0, bySeverity: { high: 0, medium: 0, low: 1 }, ...over }
}

/** A catalog shaped like GET /optimization-rules: counts and names here must be what the tile shows. */
function catalog(services: [string, number, number][]) {
  return {
    rules: services.flatMap(([service, implemented, planned]) => [
      ...Array.from({ length: implemented }, (_, i) => ({ id: `${service}-${i}`, service, name: '', detail: '', status: 'implemented', issue: `${service} ${i}`, configurable: false, parameters: [] })),
      ...Array.from({ length: planned }, (_, i) => ({ id: `${service}-p${i}`, service, name: '', detail: '', status: 'planned', configurable: false, parameters: [] })),
    ]),
    summary: {
      totalRules: services.reduce((s, [, a, b]) => s + a + b, 0),
      implementedCount: services.reduce((s, [, a]) => s + a, 0),
      plannedCount: services.reduce((s, [, , b]) => s + b, 0),
      services: services.map(([service, implemented, planned]) => ({ service, displayName: service, implementedCount: implemented, plannedCount: planned, totalCount: implemented + planned })),
    },
  }
}
const CATALOG_A = catalog([['EC2', 3, 3], ['EBS', 3, 1], ['RDS', 1, 3], ['S3', 1, 2], ['Lambda', 1, 2], ['DynamoDB', 2, 0], ['NAT Gateway', 1, 1], ['EKS', 0, 2]])

/** 31 points, Oct 27 .. Nov 26, like the backend's 30d response; Oct 27 is a unique $1,000 Redshift day outside the window. */
const TREND = Array.from({ length: 31 }, (_, i) => {
  const date = new Date(Date.UTC(2026, 9, 27 + i)).toISOString().slice(0, 10)
  const services = i === 0 ? [{ service: 'Redshift', amount: 1000, color: '#101010' }] : [{ service: 'EC2', amount: 0.5, color: '#202020' }, { service: 'VPC', amount: 0.12, color: '#303030' }]
  const total = services.reduce((s, x) => s + x.amount, 0)
  return { date, compute: total, storage: 0, database: 0, network: 0, other: 0, total, lineItems: services.length, reportState: i === 30 ? 'updating' : 'final', byServiceDisplay: services }
})

const completedRun = {
  id: 'run-1', status: 'completed', run_state: 'partial', source: 'discovery', recommendations_found: 0, total_potential_savings: null,
  started_at: '2026-11-01T06:00:00.000Z', completed_at: '2026-11-01T06:05:00.000Z', created_at: '2026-11-01T06:00:00.000Z', error_message: null,
  // Two resolved findings found again: suppressed, so not in K.
  new_count: 1, refreshed_count: 2, persisted_count: 3, detected_count: 5, suppressed_resolved_count: 2, suppressed_dismissed_count: 0, unknown_resource_count: 0,
  checks: [
    { rule_id: 'EC2-0', issue: 'EC2 0', outcome: 'complete', detected: 1, unknown: 0 },
    { rule_id: 'EBS-0', issue: 'EBS 0', outcome: 'complete', detected: 2, unknown: 0 },
    { rule_id: 'RDS-0', issue: 'RDS 0', outcome: 'failed', detected: 0, unknown: 0, failure_reason: 'permissions' },
  ],
}

const rec = (id: string, issue: string, potentialSavings: number, metadata: Record<string, unknown>, resourceName = `name-${id}`, resourceType = 'EC2') => ({
  id, resourceId: id, resourceName, resourceType, issue, potentialSavings, severity: 'LOW', status: 'ACTIVE', metadata, createdAt: '', updatedAt: '',
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><CostsPage /></QueryClientProvider>)
}
const tile = (key: string) => screen.getByTestId(`kpi-${key}`)

beforeEach(() => {
  vi.clearAllMocks()
  m.demo = false
  charts.data = []
  mockGetCostSummary.mockResolvedValue(summary(14.2))
  mockGetStats.mockResolvedValue(recStats())
  mockGetAll.mockResolvedValue([])
  mockGetAnalysisRuns.mockResolvedValue([completedRun])
  mockGetRules.mockResolvedValue(CATALOG_A)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: TREND }) }))
})
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

describe('safeguard 1: the chart, the donut and its total label use one set of days', () => {
  it('30D: 30 days, Oct 28 – Nov 26; the day before the window is in neither the chart nor the donut', async () => {
    renderPage()
    const total = await screen.findByTestId('drivers-total')
    expect(screen.getByTestId('trend-window')).toHaveTextContent('30 days · Oct 28 – Nov 26 (UTC)')
    expect(total).toHaveTextContent('30-day total · Oct 28 – Nov 26 (UTC): $18.60 · includes the latest day so far')
    await waitFor(() => expect(charts.data).toHaveLength(30))
    expect([charts.data[0].date, charts.data[29].date]).toEqual(['Oct 28', 'Nov 26'])
    expect(within(screen.getByTestId('cost-drivers-list')).queryByText('Redshift')).toBeNull()
    expect(document.body.textContent).not.toContain('$1,000')
  })

  it('7D: all three follow the tab together', async () => {
    renderPage()
    await screen.findByTestId('drivers-total')
    fireEvent.click(screen.getByRole('button', { name: '7D' }))
    await waitFor(() => expect(screen.getByTestId('drivers-total')).toHaveTextContent('7-day total · Nov 20 – Nov 26 (UTC): $4.34'))
    expect(screen.getByTestId('trend-window')).toHaveTextContent('7 days · Nov 20 – Nov 26 (UTC)')
    await waitFor(() => expect(charts.data.map((r) => r.date)).toEqual(['Nov 20', 'Nov 21', 'Nov 22', 'Nov 23', 'Nov 24', 'Nov 25', 'Nov 26']))
  })

  it('drivers are ranked by amount (EC2 before VPC), nothing at $0', async () => {
    renderPage()
    const items = within(await screen.findByTestId('cost-drivers-list')).getAllByTestId('cost-driver')
    expect(items.map((li) => li.textContent)).toEqual(['EC281%$15.00', 'VPC19%$3.60'])
  })
})

describe('ruling Q3: month-over-month in a neutral colour, up or down; safeguard 2 caption', () => {
  it.each([14.2, -6.5])('%s%%: no green, amber or red on the tile; the finished-days caption is there', async (pct) => {
    mockGetCostSummary.mockResolvedValue(summary(pct))
    renderPage()
    await waitFor(() => expect(within(tile('momchange')).getByTestId('kpi-momchange-value')).toHaveTextContent(`${pct > 0 ? '+' : ''}${pct}%`))
    expect(tile('momchange').innerHTML).not.toMatch(/ink-success|ink-warning|ink-danger|green|amber|red-/)
    expect(within(tile('momchange')).getByTestId('mom-basis').textContent).toMatch(/^Finished days this month vs same days last month/)
  })
})

describe('ruling Q2: savings wording', () => {
  it('upper bounds only: "Up to $0.01/mo · upper bound only" in grey, no green accent, never "$0/mo"', async () => {
    renderPage()
    const value = await within(await screen.findByTestId('kpi-savings')).findByText('Up to $0.01/mo · upper bound only')
    expect(value.className).toContain('text-ink-muted')
    expect(tile('savings').className).not.toContain('border-t-green-500')
    expect(document.body.textContent).not.toMatch(/\$0\/mo/)
  })

  it('firm + upper bound: the firm figure, and the upper bound on its own line', async () => {
    mockGetStats.mockResolvedValue(recStats({ totalPotentialSavings: 52.4, estimatedFindings: 2, potentialSavingsCeiling: 41, potentialSavingsCeilingByResourceType: { S3: 41 }, activeRecommendations: 3 }))
    renderPage()
    const value = await within(await screen.findByTestId('kpi-savings')).findByText('$52/mo')
    expect(value.className).toContain('text-ink-success')
    expect(within(tile('savings')).getByText('Plus up to $41/mo if S3 data qualifies for Standard-IA (upper bound, not included above)')).toBeInTheDocument()
  })

  // SF-1: the actual grey (text-ink-muted = slate-600) at the smaller secondary size, not near-black or full KPI size.
  it('a firm figure under $1/mo is grey (slate-600) and at the smaller size, not styled as a saving', async () => {
    mockGetStats.mockResolvedValue(recStats({ totalPotentialSavings: 0.96, estimatedFindings: 1, potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {} }))
    renderPage()
    const value = await within(await screen.findByTestId('kpi-savings')).findByText('$0.96/mo')
    const classes = value.className.split(/\s+/)
    expect(classes).toEqual(expect.arrayContaining(['text-ink-muted', 'text-ui', 'sm:text-section']))
    for (const c of ['text-ink-success', 'text-slate-900', 'sm:text-kpi', 'text-section']) expect(classes).not.toContain(c)
    expect(tile('savings').className).not.toContain('border-t-green-500')
  })

  it('a firm figure of $1/mo or more is green at the full KPI size', async () => {
    mockGetStats.mockResolvedValue(recStats({ totalPotentialSavings: 1, estimatedFindings: 1, potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {} }))
    renderPage()
    const value = await within(await screen.findByTestId('kpi-savings')).findByText('$1/mo')
    expect(value.className.split(/\s+/)).toEqual(expect.arrayContaining(['text-ink-success', 'text-section', 'sm:text-kpi']))
  })

  // N-3: styling follows the displayed figure. JS shows 0.995 as "$0.99" and 0.996 as "$1.00".
  it.each([
    [0.994, '$0.99/mo', false],
    [0.995, '$0.99/mo', false],
    [0.996, '$1.00/mo', true],
    [1.0, '$1/mo', true],
  ])('N-3: %s displays %s and is green: %s', async (amount, shown, green) => {
    mockGetStats.mockResolvedValue(recStats({ totalPotentialSavings: amount, estimatedFindings: 1, potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {} }))
    renderPage()
    const value = await within(await screen.findByTestId('kpi-savings')).findByText(shown)
    expect(value.className.includes('text-ink-success')).toBe(green)
    expect(value.className.includes('text-ink-muted')).toBe(!green)
  })

  it('N-4: a partial run with no open findings reads "None found in the checks that ran", agreeing with Last analysis', async () => {
    mockGetStats.mockResolvedValue(recStats({ totalRecommendations: 0, activeRecommendations: 0, potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 0 } }))
    // The API's status for a partial run is 'failed' (legacy status); run_state says 'partial'.
    mockGetAnalysisRuns.mockResolvedValue([{ ...completedRun, status: 'failed', new_count: 0, refreshed_count: 0 }])
    renderPage()
    expect(await within(await screen.findByTestId('kpi-savings')).findByText('None found in the checks that ran')).toBeInTheDocument()
    expect(tile('savings').textContent).not.toMatch(/did not complete|\$0/)
    await waitFor(() => expect(screen.getByTestId('last-analysis')).toHaveTextContent(/2 of 3 checks ran · 0 found$/))
    expect(screen.getByTestId('opportunities-empty')).toHaveTextContent("None found in the checks that ran. Some checks couldn't run in the latest analysis.")
  })
})

describe('N-1: Opportunities agrees with the savings tile, and shows no empty text while loading', () => {
  it('after a clean completed analysis: "None found", no "Run cost analysis" prompt', async () => {
    mockGetStats.mockResolvedValue(recStats({ totalRecommendations: 0, activeRecommendations: 0, potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 0 } }))
    mockGetAnalysisRuns.mockResolvedValue([{ ...completedRun, run_state: 'completed', new_count: 0, refreshed_count: 0, checks: completedRun.checks.map((c) => ({ ...c, outcome: 'complete', failure_reason: undefined })) }])
    renderPage()
    expect(await within(await screen.findByTestId('kpi-savings')).findByText('None found')).toBeInTheDocument()
    expect(await screen.findByTestId('opportunities-empty')).toHaveTextContent('None found. No open opportunities after the latest analysis.')
    expect(document.body.textContent).not.toMatch(/Run cost analysis/)
  })

  it('while the findings are loading: "—", never the empty-state text', async () => {
    mockGetAll.mockReturnValue(pending())
    renderPage()
    expect(await screen.findByTestId('opportunities-loading')).toHaveTextContent(/^—$/)
    expect(screen.queryByTestId('opportunities-empty')).toBeNull()
    expect(document.body.textContent).not.toMatch(/No optimization recommendations yet/)
  })
})

describe('N-2: Export CSV is exactly the window the page shows', () => {
  it.each([['30D', 'Oct 28', '2026-10-28'], ['7D', 'Nov 20', '2026-11-20']])('%s: the file\'s first and last dates are the displayed range', async (range, firstLabel, firstDate) => {
    let blob: Blob | null = null
    const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
    URL.createObjectURL = (b: Blob) => { blob = b; return 'blob:test' }
    URL.revokeObjectURL = () => {}
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    try {
      renderPage()
      await screen.findByTestId('drivers-total')
      fireEvent.click(screen.getByRole('button', { name: range }))
      await waitFor(() => expect(screen.getByTestId('trend-window')).toHaveTextContent(`· ${firstLabel} – Nov 26 (UTC)`))
      fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
      const text = await (blob as unknown as Blob).text()
      const dates = [...new Set(text.split('\n').slice(2).map((line) => line.slice(1, 11)))]
      expect([dates[0], dates[dates.length - 1]]).toEqual([firstDate, '2026-11-26'])
      expect(dates).toHaveLength(range === '30D' ? 30 : 7)
      expect(text).not.toContain('2026-10-27')
    } finally {
      click.mockRestore()
      URL.createObjectURL = original.create
      URL.revokeObjectURL = original.revoke
    }
  })
})

describe('N-6: the tiles\' decorative arrows are hidden from screen readers', () => {
  it('every tile\'s › is aria-hidden', async () => {
    renderPage()
    await screen.findByTestId('kpi-checks')
    for (const key of ['mtd', 'momchange', 'savings', 'activerecs', 'checks']) {
      const arrow = [...tile(key).querySelectorAll('span')].find((el) => el.textContent === '›')!
      expect(arrow).toHaveAttribute('aria-hidden', 'true')
    }
  })
})

describe('safeguard 5: loading or missing is "—", never 0 or $0', () => {
  it('while everything loads, every tile reads "—"', async () => {
    mockGetCostSummary.mockReturnValue(pending())
    mockGetStats.mockReturnValue(pending())
    mockGetAnalysisRuns.mockReturnValue(pending())
    mockGetRules.mockReturnValue(pending())
    renderPage()
    await screen.findByTestId('kpi-checks')
    for (const key of ['mtd', 'momchange', 'savings', 'activerecs', 'checks']) {
      expect(within(tile(key)).getByTestId(`kpi-${key}-value`)).toHaveTextContent(/^—$/)
      // (The month-over-month caption's "amounts below $0 count as $0" is basis text, not a figure.)
      expect(tile(key).textContent).not.toMatch(/\$0(\.00|\/mo)|(^|[^\d$.])0(%|$)/)
    }
  })

  it('a failed catalog: the checks tile is "—" with "Could not be retrieved", never 0', async () => {
    mockGetRules.mockRejectedValue(new Error('500'))
    renderPage()
    await waitFor(() => expect(tile('checks')).toHaveTextContent('Could not be retrieved'))
    expect(within(tile('checks')).getByTestId('kpi-checks-value')).toHaveTextContent('—')
  })
})

describe('spec item 6: active checks and categories from the catalog, never constants', () => {
  it('catalog A: 12 checks across 7 service categories, by name, planned excluded', async () => {
    renderPage()
    await waitFor(() => expect(within(tile('checks')).getByTestId('kpi-checks-value')).toHaveTextContent('12'))
    expect(tile('checks')).toHaveTextContent('across 7 service categories')
    expect(within(tile('checks')).getByTestId('kpi-checks-services')).toHaveTextContent('EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway')
    expect(tile('checks').textContent).not.toMatch(/EKS|services(?! categor)/)
  })

  it('another catalog: other numbers and names', async () => {
    mockGetRules.mockResolvedValue(catalog([['Lambda', 4, 9], ['ECS', 0, 1]]))
    renderPage()
    await waitFor(() => expect(within(tile('checks')).getByTestId('kpi-checks-value')).toHaveTextContent('4'))
    expect(tile('checks')).toHaveTextContent('across 1 service category')
    expect(within(tile('checks')).getByTestId('kpi-checks-services')).toHaveTextContent(/^Lambda$/)
  })
})

describe('spec item 7: Last analysis from the latest run (ruling Q6)', () => {
  it('"N of M checks ran · K found", from the run that the source=all list returns first', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('last-analysis')).toHaveTextContent(/^Last analysis: .+ ago \(scheduled\) · 2 of 3 checks ran · 3 found$/))
    expect(mockGetAnalysisRuns).toHaveBeenCalledWith(5, 'all')
  })
})

describe('spec item 11: Opportunities with "Why:" (safeguard 4)', () => {
  it('top 5 of 7 with a View all link; the Why line from allowlisted fields, no ARN or VPC ID', async () => {
    mockGetStats.mockResolvedValue(recStats({ totalPotentialSavings: 70, estimatedFindings: 7, activeRecommendations: 7 }))
    mockGetAll.mockResolvedValue([
      rec('r1', 'Idle RDS Instance', 30, { savings_basis: 'estimated: x', db_instance_arn: 'arn:aws:rds:xx-test-1:000000000000:db:fixture', vpc_id: 'vpc-0fixture', rule: { window: { days: 30 } }, rds_idle: { worst: { cpu_peak_percent: 1.2 } } }, 'fixture-db', 'RDS'),
      ...[1, 2, 3, 4, 5, 6].map((n) => rec(`e${n}`, 'Unattached EBS Volume', 10 - n, { savings_basis: 'estimated: x', size_gb: 10 * n, volume_type: 'gp3' }, `vol-name-${n}`, 'EBS')),
    ])
    renderPage()
    const cards = await screen.findAllByTestId('opportunity-card')
    expect(cards).toHaveLength(5)
    expect(screen.getByText('Top 5 of 7, largest savings first')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /View all/ })).toHaveAttribute('href', '/cost-optimization')
    const why = within(cards[0]).getByTestId('opportunity-why')
    expect(why.textContent).toBe('Why: fixture-db · no client connections in any hourly sample over 30 days; CPU peaked at 1.2%')
    expect(document.body.textContent).not.toMatch(/arn:aws|vpc-0fixture|000000000000/)
  })
})

describe('spec item 12: What this page covers', () => {
  it('rows with statuses from real signals; regions partly checked; the intro disclaims the whole account', async () => {
    renderPage()
    const panel = await screen.findByTestId('page-coverage')
    await waitFor(() => expect(within(panel).getByTestId('coverage-checks')).toHaveAttribute('data-status', 'partly_checked'))
    expect(within(panel).getByTestId('coverage-checks')).toHaveTextContent("2 of 3 checks ran. 1 check couldn't run because of missing permissions.")
    await waitFor(() => expect(within(panel).getByTestId('coverage-regions')).toHaveAttribute('data-status', 'partly_checked'))
    expect(within(panel).getByTestId('coverage-spend')).toHaveAttribute('data-status', 'checked')
    expect(within(panel).getByTestId('coverage-other_accounts')).toHaveAttribute('data-status', 'not_checked')
    expect(panel).toHaveTextContent("It doesn't verify your whole AWS account.")
  })
})

describe('layout order (spec items 8–12) and what is kept', () => {
  it('Spend Trend, then Ask AI, then Cost drivers, Opportunities and What this page covers', async () => {
    renderPage()
    await screen.findByTestId('page-coverage')
    const order = [
      screen.getByRole('heading', { name: 'Spend Trend' }),
      screen.getByRole('button', { name: /Ask AI/ }),
      screen.getByRole('heading', { name: 'Cost drivers' }),
      screen.getByRole('heading', { name: 'Opportunities' }),
      screen.getByRole('heading', { name: 'What this page covers' }),
    ]
    for (let i = 1; i < order.length; i++) expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })

  it('kept: KPI tiles as links, Export CSV, "Cost data as of", 7D / 30D / 3M (no 6M / 1Y), Optimize Now still a link', async () => {
    renderPage()
    await screen.findByTestId('drivers-total')
    expect(tile('mtd').closest('a')).toHaveAttribute('href', '/invoices')
    expect(tile('momchange').closest('a')).toHaveAttribute('href', '/invoices')
    expect(tile('savings').closest('a')).toHaveAttribute('href', '/cost-optimization')
    expect(tile('activerecs').closest('a')).toHaveAttribute('href', '/cost-optimization')
    expect(tile('checks').closest('a')).toHaveAttribute('href', '/cost-optimization')
    expect(screen.getByRole('button', { name: /Export CSV/ })).toBeInTheDocument()
    expect(await screen.findByText(/^Cost data as of /)).toBeInTheDocument()
    for (const label of ['7D', '30D', '3M']) expect(screen.getByRole('button', { name: label })).toBeInTheDocument()
    for (const label of ['6M', '1Y']) expect(screen.queryByRole('button', { name: label })).toBeNull()
    expect(screen.getByRole('link', { name: /Optimize Now/ })).toHaveAttribute('href', '/cost-optimization')
  })

  it('removed (approved): spike badge and banner, summary strip, top drivers, Cost by Service bars, Top Savings, yearly line', async () => {
    mockGetCostSummary.mockResolvedValue(summary(30))
    renderPage()
    await screen.findByTestId('drivers-total')
    for (const gone of [/Spend up over 20%|No spend spike/, 'Spend Up Sharply vs Last Month', 'Top drivers', 'Cost by Service', 'Full breakdown', 'Top Savings', 'Review savings', /annualized/, 'Compute (EC2, Lambda, ECS)']) {
      expect(screen.queryByText(gone)).toBeNull()
    }
    // The KPI row is shown once: each label reaches assistive tech once (visual-only copies are aria-hidden).
    for (const label of ['Month-to-Date Spend', 'Month-over-Month Change', 'Estimated Savings Opportunity', 'Active Recommendations']) {
      expect(screen.getAllByText(label).filter((el) => !el.closest('[aria-hidden="true"]'))).toHaveLength(1)
    }
  })
})

/**
 * Founder D7: no KPI label ever breaks mid-word. Labels are break-normal (a word that can't fit would overflow, never
 * split), and no label word may be longer than the longest one measured to fit a tile at 360px in Chromium
 * ("OPPORTUNITY", 11 letters; pr-a-shots/harness/measure-labels-pw.cjs). A longer label must carry a short form
 * ("Findings" for "Active Recommendations"), with the full label kept for screen readers.
 */
const LONGEST_FITTING_WORD = 'OPPORTUNITY'.length
describe('founder D7: no mid-word wrapping in the KPI tile labels', () => {
  it('every label is break-normal, never break-words / break-all, and every visible word fits', async () => {
    renderPage()
    await screen.findByTestId('kpi-checks-label')
    const labels = ['mtd', 'momchange', 'savings', 'activerecs', 'checks'].map((key) => screen.getByTestId(`kpi-${key}-label`))
    for (const label of labels) {
      expect(label.className).toContain('break-normal')
      expect(label.outerHTML).not.toMatch(/break-words|break-all|break-anywhere|overflow-wrap|word-break/)
      // The words shown at the narrowest widths: the short form when there is one, else the label itself.
      const narrow = label.querySelector('[aria-hidden="true"]')?.textContent ?? label.textContent ?? ''
      for (const word of narrow.split(/[\s-]+/)) expect(word.length, `"${word}" in ${label.dataset.testid}`).toBeLessThanOrEqual(LONGEST_FITTING_WORD)
    }
  })

  // Fix round 1: exactly one of the two visible forms is displayed at every width (display-only toggles, which cascade
  // by breakpoint), and screen readers get the full label once, from a permanent sr-only copy.
  it('"Active Recommendations" shows "Findings" where it would not fit, the full label elsewhere, and once for screen readers', async () => {
    renderPage()
    const label = await screen.findByTestId('kpi-activerecs-label')
    const [short, full, spoken] = [...label.children] as HTMLElement[]
    expect([short.textContent, full.textContent, spoken.textContent]).toEqual(['Findings', 'Active Recommendations', 'Active Recommendations'])
    expect(short).toHaveAttribute('aria-hidden', 'true')
    expect(full).toHaveAttribute('aria-hidden', 'true')
    expect(spoken).not.toHaveAttribute('aria-hidden')
    expect(spoken.className).toBe('sr-only')
    expect(short.className).toBe('sm:hidden lg:inline xl:hidden')
    expect(full.className).toBe('hidden sm:inline lg:hidden xl:inline')
    // Which form is displayed at each Tailwind breakpoint (base, sm 640, lg 1024, xl 1280): always exactly one.
    const displayedAt = (classes: string, tier: number) => {
      let shown = true
      for (const [i, prefix] of ['', 'sm:', 'lg:', 'xl:'].entries()) {
        if (i > tier) break
        if (classes.split(' ').includes(`${prefix}hidden`)) shown = false
        if (classes.split(' ').includes(`${prefix}inline`)) shown = true
      }
      return shown
    }
    for (const tier of [0, 1, 2, 3]) expect([displayedAt(short.className, tier), displayedAt(full.className, tier)].filter(Boolean)).toHaveLength(1)
    // Never a per-breakpoint sr-only toggle anywhere on the page (it doesn't cascade in this Tailwind build).
    expect(document.body.innerHTML).not.toMatch(/\b(?:sm|md|lg|xl|2xl):(?:not-)?sr-only\b/)
  })
})

describe('N-7: Opportunities rank by the savings figure each card shows', () => {
  it('"Up to $41/mo" ranks before "$0.02/mo"; a firm figure wins a tie; no-figure findings come last in their order', async () => {
    mockGetStats.mockResolvedValue(recStats({ totalPotentialSavings: 41.22, estimatedFindings: 2, activeRecommendations: 5 }))
    mockGetAll.mockResolvedValue([
      rec('fn', 'Low-Usage Lambda Function', 0.02, { savings_basis: 'estimated: x', invocations_30d: 0 }, 'fn-name', 'Lambda'),
      rec('nb1', 'Reserved Instance Opportunity', 0, {}, 'ri-a'),
      rec('s3', 'S3 Lifecycle Optimization', 41.4, { savings_basis: 'ceiling: x', lifecycle_state: 'no_lifecycle_configuration', standard_storage_gb: 100 }, 'bucket-name', 'S3'),
      rec('nb2', 'Idle RDS Instance', 0, {}, 'db-b', 'RDS'),
      rec('vol', 'Unattached EBS Volume', 41.2, { savings_basis: 'estimated: x', size_gb: 10, volume_type: 'gp3' }, 'vol-name', 'EBS'),
    ])
    renderPage()
    const cards = await screen.findAllByTestId('opportunity-card')
    expect(cards.map((c) => within(c).getByTestId('opportunity-savings').textContent)).toEqual(['$41/mo', 'Up to $41/mo', '$0.02/mo', 'No dollar estimate', 'No dollar estimate'])
    expect(within(cards[3]).getByText('Reserved Instance Opportunity')).toBeInTheDocument()
    expect(within(cards[4]).getByText('Idle RDS Instance')).toBeInTheDocument()
  })
})

describe('ruling Q14 + D4: demo mode fills the new layout with dates relative to today; demo-only extras dropped', () => {
  it('frozen at 2026-04-25: demo KPIs, chart window, drivers, opportunities and coverage; no value tiles, AI forecast, confidence or "systems clear"', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    vi.setSystemTime(new Date('2026-04-25T12:00:00.000Z'))
    m.demo = true
    renderPage()
    expect(await screen.findByText('Demo Mode')).toBeInTheDocument()
    expect(screen.getByTestId('trend-window')).toHaveTextContent('30 days · Mar 27 – Apr 25 (UTC)')
    expect(screen.getByTestId('drivers-total')).toHaveTextContent('30-day total · Mar 27 – Apr 25 (UTC)')
    expect(screen.getAllByTestId('opportunity-card').length).toBe(5)
    expect(await screen.findByTestId('page-coverage')).toBeInTheDocument()
    for (const gone of ['DevControl value delivered', 'Optimization Confidence', 'Safe to apply', 'AI forecast', 'Synced 2 min ago', 'All systems clear', 'Cost Anomaly Detected', /AI insight/]) {
      expect(screen.queryByText(gone)).toBeNull()
    }
    // Demo reads no account data.
    expect(mockGetCostSummary).not.toHaveBeenCalled()
    expect(mockGetStats).not.toHaveBeenCalled()
  })

  it('D4: the demo window follows today (frozen at 2026-12-03 and 2027-03-01): no fixed calendar date', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    m.demo = true
    vi.setSystemTime(new Date('2026-12-03T09:00:00.000Z'))
    const { unmount } = renderPage()
    expect(await screen.findByTestId('trend-window')).toHaveTextContent('30 days · Nov 4 – Dec 3 (UTC)')
    expect(screen.getByTestId('drivers-total')).toHaveTextContent('30-day total · Nov 4 – Dec 3 (UTC)')
    expect(screen.getByTestId('last-analysis')).toHaveTextContent(/^Last analysis: 2 hours ago \(scheduled\)/)
    unmount()
    vi.setSystemTime(new Date('2027-03-01T23:30:00.000Z'))
    renderPage()
    expect(await screen.findByTestId('trend-window')).toHaveTextContent('30 days · Jan 31 – Mar 1 (UTC)')
    expect(document.body.textContent).not.toMatch(/Apr 25|Mar 27/)
  })
})
