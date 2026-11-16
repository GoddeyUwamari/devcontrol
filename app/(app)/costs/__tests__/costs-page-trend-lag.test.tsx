/**
 * The Costs page on production's 2026-11-16 data (trend-lag-build.md), as the
 * new backend returns it (backend/src/controllers/__tests__/__fixtures__/trend-lag/
 * trend-7d-2026-11-16.new.json and summary-2026-11-16.new.json, pinned by
 * trend-lag-real-evidence.test.ts from the verbatim production response):
 *   - Spend Trend: Nov 13 on the lighter "Latest days still updating" line with
 *     "Still updating · $0.06 so far. …"; Nov 14-16 a gap with "Not reported yet
 *     by AWS Cost Explorer", never $0.00;
 *   - month-to-date card: "latest days still updating" (rule 6).
 * Recharts runs for real: ResponsiveContainer gets a size and the Tooltip opens
 * on a chosen point (`active` + `defaultIndex`).
 */
import { cloneElement } from 'react'
import * as fs from 'fs'
import * as path from 'path'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }) }))
const charts = vi.hoisted(() => ({ index: -1 }))
vi.mock('recharts', async (importOriginal) => {
  const actual = await importOriginal<typeof import('recharts')>()
  return {
    ...actual,
    ResponsiveContainer: ({ children }: { children: React.ReactElement<{ width?: number; height?: number }> }) =>
      cloneElement(children, { width: 600, height: 240 }),
    Tooltip: (props: React.ComponentProps<typeof actual.Tooltip>) =>
      charts.index >= 0 ? <actual.Tooltip {...props} active defaultIndex={charts.index} /> : <actual.Tooltip {...props} />,
  }
})
import { fireEvent, render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostsPage from '../page'

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: { href: string; children?: React.ReactNode } & Record<string, unknown>) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ isPro: true }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: (s: { enabled: boolean }) => unknown) => selector({ enabled: false }) }))
const mockGetCostSummary = vi.fn()
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary: () => mockGetCostSummary() } }))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: { getStats: async () => ({ totalRecommendations: 0, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {}, potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 0 } }), getAll: async () => [], getAnalysisRuns: async () => [] },
}))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))
vi.mock('@/lib/services/nl-query.service', () => ({ nlQueryService: { executeQuery: vi.fn() } }))

const FIXTURES = path.resolve(__dirname, '../../../../backend/src/controllers/__tests__/__fixtures__/trend-lag')
const TREND = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'trend-7d-2026-11-16.new.json'), 'utf8')).data as Array<{ date: string }>
const SUMMARY = JSON.parse(fs.readFileSync(path.join(FIXTURES, 'summary-2026-11-16.new.json'), 'utf8')).data
const indexOf = (date: string) => TREND.findIndex((p) => p.date === date)

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><CostsPage /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetCostSummary.mockResolvedValue(SUMMARY)
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: TREND }) }))
})
afterEach(() => { vi.unstubAllGlobals(); charts.index = -1 })

describe('Spend Trend on the real evidence', () => {
  it('legend: "Latest days still updating" beside "Actual spend"; the not-drawn note', async () => {
    renderPage()
    expect(await screen.findByText('Latest days still updating')).toBeInTheDocument()
    expect(screen.getByText('Actual spend')).toBeInTheDocument()
    expect(screen.getByTestId('trend-not-reported')).toHaveTextContent("Days AWS Cost Explorer hasn't reported yet are not drawn")
  })

  it.each(['2026-11-14', '2026-11-15', '2026-11-16'])('%s: "Not reported yet by AWS Cost Explorer", no amount, never $0.00', async (date) => {
    charts.index = indexOf(date)
    renderPage()
    const tip = await screen.findByTestId('spend-trend-tooltip')
    expect(within(tip).getByText('Not reported yet by AWS Cost Explorer')).toBeInTheDocument()
    expect(tip.textContent).not.toMatch(/\$/)
  })

  it('Nov 13: "Still updating · $0.06 so far. AWS Cost Explorer may still add charges."', async () => {
    charts.index = indexOf('2026-11-13')
    renderPage()
    const tip = await screen.findByTestId('spend-trend-tooltip')
    expect(tip.textContent).toBe('Nov 13Still updating · $0.06 so far. AWS Cost Explorer may still add charges.')
  })

  it('Nov 12 (final): its amount per day', async () => {
    charts.index = indexOf('2026-11-12')
    renderPage()
    const tip = await screen.findByTestId('spend-trend-tooltip')
    expect(tip.textContent).toBe('Nov 12Actual Spend: $0.83/day')
  })

  it('the month-to-date card says "latest days still updating", not "today\'s spend still being billed"', async () => {
    renderPage()
    expect(await screen.findByText(/Nov 1–16 \(UTC\) · Actual · AWS Cost Explorer · latest days still updating/)).toBeInTheDocument()
    expect(screen.queryByText(/today's spend still being billed/)).toBeNull()
  })
})

describe('Export CSV on the real evidence: a day not reported yet is marked, never a $0 row', () => {
  const original = { create: URL.createObjectURL, revoke: URL.revokeObjectURL }
  afterEach(() => { URL.createObjectURL = original.create; URL.revokeObjectURL = original.revoke })

  /** Clicks Export CSV and returns the file's text (the Blob handed to URL.createObjectURL). */
  async function exportCsv(): Promise<string> {
    let blob: Blob | null = null
    // jsdom has no object URLs: stub only the two static methods (restored in afterEach below).
    URL.createObjectURL = (b: Blob) => { blob = b; return 'blob:test' }
    URL.revokeObjectURL = () => {}
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {})
    renderPage()
    await screen.findByText('Latest days still updating') // the trend has loaded
    fireEvent.click(screen.getByRole('button', { name: /Export CSV/ }))
    expect(click).toHaveBeenCalledTimes(1)
    expect(blob).not.toBeNull()
    return new Promise((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => resolve(String(reader.result))
      reader.onerror = () => reject(reader.error)
      reader.readAsText(blob as unknown as Blob)
    })
  }
  const parse = (csv: string) => csv.split('\n').map((line) => line.slice(1, -1).split('","'))

  it.each(['2026-11-14', '2026-11-15', '2026-11-16'])('%s: one row "Total" = "Not reported yet by AWS Cost Explorer", no amounts', async (date) => {
    const rows = parse(await exportCsv())
    expect(rows.filter((r) => r[0] === date)).toEqual([[date, 'Total', 'Not reported yet by AWS Cost Explorer']])
  })

  it('Nov 13 (updating): its amounts so far, its total row says it is still updating', async () => {
    const rows = parse(await exportCsv()).filter((r) => r[0] === '2026-11-13')
    expect(rows).toHaveLength(6)
    expect(rows.at(-1)).toEqual(['2026-11-13', 'Total (still updating; AWS Cost Explorer may still add charges)', '0.06'])
  })

  it('Nov 9-12 (final): unchanged rows; no row anywhere carries a $0 for a not-reported day', async () => {
    const rows = parse(await exportCsv())
    expect(rows.filter((r) => r[0] === '2026-11-12').at(-1)).toEqual(['2026-11-12', 'Total', '0.83'])
    const notReported = new Set(['2026-11-14', '2026-11-15', '2026-11-16'])
    expect(rows.filter((r) => notReported.has(r[0]) && /^-?\d+(\.\d+)?$/.test(r[2] ?? ''))).toEqual([])
  })
})
