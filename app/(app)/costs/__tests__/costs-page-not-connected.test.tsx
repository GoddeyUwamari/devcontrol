/**
 * PR2 empty states, Costs (Cost Intelligence): with no AWS account connected the page keeps its title and
 * subtitle; "Optimize Now" becomes an outlined "Connect AWS account"; the four KPI cards are label and "—"
 * only (no "Latest cost analysis did not complete"); the Optimization Engine lock, Ask AI, Top Savings, Export
 * CSV, the header badges, Spend Trend's KPI row, top drivers, range tabs and legend are gone; Spend Trend keeps
 * its empty-chart message and Cost by Service its message; the shared NotConnectedCard shows. Connected, the
 * page is unchanged (real zeros kept). Until the connection check answers, grey blocks only.
 * All figures are test fixtures, not production data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }) }))
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostsPage from '../page'

const m = vi.hoisted(() => ({ isPro: false, connection: 'not_connected' as string, pending: false }))

vi.mock('next/link', () => ({
  default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a>,
}))
vi.mock('@/lib/hooks/use-plan', () => ({ usePlan: () => ({ isPro: m.isPro }) }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/services/platform-stats.service', () => ({
  platformStatsService: {
    getCostSummary: async () => ({
      spend: {
        state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: '2026-09-27T09:00:00.000Z', coverage: null, reason: null,
        data: { amount: 0, basis: 'billed_month_to_date', lastDayInProgress: false },
      },
      monthOverMonth: {
        state: 'available', source: 'DevControl month-over-month comparison', provenance: 'derived', asOf: null, coverage: null, reason: null,
        data: {
          currentWindow: { start: '2026-09-01', end: '2026-09-27' }, previousWindow: { start: '2026-08-01', end: '2026-08-27' },
          currentWindowTotal: 10, previousWindowTotal: 10, changeAmount: 0, changePercent: 0, currentWindowIncludesToday: true,
        },
      },
    }),
  },
}))
// Stale answers from an earlier connection: one open recommendation, and a failed latest analysis.
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getStats: async () => ({ totalRecommendations: 0, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {}, potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 0 } }),
    getAll: async () => [],
    getAnalysisRuns: async () => [{ id: 'run-failed', status: 'failed', recommendations_found: 0, total_potential_savings: null, started_at: '2026-09-27T08:00:00.000Z', completed_at: '2026-09-27T08:00:00.000Z', created_at: '2026-09-27T08:00:00.000Z', error_message: null }],
  },
}))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))
vi.mock('@/lib/services/aws-accounts.service', () => ({
  default: {
    getAccountsAndConnection: () => (m.pending
      ? new Promise(() => {})
      : Promise.resolve({ accounts: m.connection === 'connected' ? [{ id: 'a', status: 'active' }] : [], connection: m.connection })),
  },
}))
vi.mock('@/lib/services/nl-query.service', () => ({ nlQueryService: { executeQuery: vi.fn() } }))

const KPI_LABELS = ['Estimated Savings Opportunity', 'Month-to-Date Spend', 'Month-over-Month Change', 'Active Recommendations']

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><CostsPage /></QueryClientProvider>)
}
const kpiCard = (label: string) => screen.getAllByText(label)[0].closest('a') as HTMLElement

beforeEach(() => {
  m.isPro = false
  m.connection = 'not_connected'
  m.pending = false
  // With no account, Cost Explorer has nothing for the range.
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue({ ok: true, json: async () => ({ success: true, data: [] }) }))
})
afterEach(() => { vi.unstubAllGlobals() })

describe('PR2: Costs with no AWS account connected', () => {
  it('header: title and subtitle kept, outlined Connect AWS account, no Export CSV / Optimize Now / badges', async () => {
    renderPage()
    const button = await screen.findByTestId('connect-aws-header-button')
    expect(button).toHaveAttribute('href', '/connect-aws')
    expect(button).toHaveTextContent('Connect AWS account')
    expect(screen.getByRole('heading', { level: 1, name: 'Cost Intelligence' })).toBeInTheDocument()
    expect(screen.getByText('AWS spend visibility, forecasting, and AI-powered cost optimization.')).toBeInTheDocument()
    expect(screen.queryByText(/Export CSV/)).toBeNull()
    expect(screen.queryByText(/Optimize Now/)).toBeNull()
    expect(screen.queryByText(/Cost data as of/)).toBeNull()
    expect(screen.queryByText(/spend spike|Spend up over/)).toBeNull()
  })

  it('the four KPI cards: label and "—" only; never "Latest cost analysis did not complete"', async () => {
    renderPage()
    await screen.findByTestId('not-connected-card')
    for (const label of KPI_LABELS) {
      const card = kpiCard(label)
      expect(within(card).getByTestId('unmeasured-value')).toHaveTextContent('—')
      expect(card).not.toHaveTextContent('$0')
      expect(card).not.toHaveTextContent('%')
      expect(within(card).queryByTestId('previous-month-line')).toBeNull()
      expect(card.innerHTML).not.toMatch(/green/)
      // No drill arrow on an unmeasured card.
      expect(card).not.toHaveTextContent('›')
    }
    expect(screen.queryByText('Latest cost analysis did not complete')).toBeNull()
  })

  it('the shared card; no plan lock, Ask AI, Top Savings, trend KPI row, range tabs or legend; the two messages stay', async () => {
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(screen.queryByText('On the Optimization Engine plan')).toBeNull()
    expect(screen.queryByText('Top Savings')).toBeNull()
    expect(screen.queryByRole('button', { name: /^(7D|30D|90D|6M|1Y)$/ })).toBeNull()
    expect(screen.queryByText('Top drivers')).toBeNull()
    expect(screen.queryByText('Actual spend')).toBeNull()
    expect(screen.queryByTestId('mom-basis')).toBeNull()
    expect(screen.getByRole('heading', { name: 'Spend Trend' })).toBeInTheDocument()
    await waitFor(() => expect(screen.getAllByText('No AWS Cost Explorer spend data is available for this range.')).toHaveLength(2))
    expect(screen.getByRole('heading', { name: 'Cost by Service' })).toBeInTheDocument()
    // Cost by Service: no Full breakdown link and no "selected range" subtitle; its message stays (above).
    expect(screen.queryByRole('link', { name: /Full breakdown/ })).toBeNull()
    expect(screen.queryByTestId('cost-by-service-basis')).toBeNull()
    expect(screen.queryByText(/selected range/)).toBeNull()
    // Spend Trend's empty area is short (Cost by Service's height), not the 240px chart area.
    const trendEmpty = screen.getAllByText('No AWS Cost Explorer spend data is available for this range.')[0].parentElement as HTMLElement
    expect(trendEmpty).toHaveClass('py-6')
    expect(trendEmpty).not.toHaveClass('h-60')
  })

  it('on Pro: no Ask AI either', async () => {
    m.isPro = true
    renderPage()
    await screen.findByTestId('not-connected-card')
    expect(screen.queryByRole('button', { name: /Ask AI/ })).toBeNull()
  })

  it('connection loading: grey blocks only under the title and subtitle', async () => {
    m.pending = true
    renderPage()
    expect(await screen.findByTestId('connection-loading')).toBeInTheDocument()
    expect(screen.getByTestId('connection-loading-tiles').children).toHaveLength(4)
    expect(screen.getByTestId('header-action-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByText('Estimated Savings Opportunity')).toBeNull()
    expect(screen.queryByText('On the Optimization Engine plan')).toBeNull()
    expect(screen.queryByText(/Optimize Now|Export CSV/)).toBeNull()
  })
})

describe('PR2: Costs connected is unchanged', () => {
  it('Export CSV and Optimize Now, real $0 and 0% kept, no card or "—" values', async () => {
    m.connection = 'connected'
    renderPage()
    await waitFor(() => expect(kpiCard('Month-to-Date Spend')).toHaveTextContent('$0.00'))
    expect(kpiCard('Month-over-Month Change')).toHaveTextContent('0%')
    expect(screen.getByText(/Export CSV/)).toBeInTheDocument()
    expect(screen.getByText(/Optimize Now/)).toBeInTheDocument()
    expect(screen.getByText('On the Optimization Engine plan')).toBeInTheDocument()
    expect(screen.getByText('Top Savings')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Full breakdown/ })).toBeInTheDocument()
    expect(screen.getByTestId('cost-by-service-basis')).toHaveTextContent('selected range (30D)')
    expect(kpiCard('Month-to-Date Spend')).toHaveTextContent('›')
    expect(screen.getAllByText('Latest cost analysis did not complete').length).toBeGreaterThan(0)
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByTestId('connect-aws-header-button')).toBeNull()
    expect(screen.queryByTestId('unmeasured-value')).toBeNull()
  })
})
