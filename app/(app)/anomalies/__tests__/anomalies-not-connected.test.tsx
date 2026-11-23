/**
 * PR4c empty states, /anomalies (Anomaly Detection). With no AWS account connected:
 *   - below Optimization Engine: the title, subtitle and Coming-soon chip, and the shared card, in place of the bare plan lock;
 *   - on the plan: the page with the card below its tiles, and no "N active anomalies", Active / All tabs,
 *     "Priority Issues (N)", filter row, Resolve / Ignore / Assign selected or custom rules panel.
 * Connected (or when the check fails) the page is today's: the plan lock below the plan, everything above it.
 * Until the check answers, the plan-loading skeleton.
 *
 * GET /api/aws/accounts is the backend's own body through the real service; the anomaly reads are what the
 * backend answers a new org (anomalies.routes.ts: no rows; no /last-scan route, read as no scan).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { accountsResponse, type ConnectionMode } from '@/components/aws/__tests__/accounts-wire'
import AnomaliesPage from '../page'

const m = vi.hoisted(() => ({ tier: 'free' as 'free' | 'pro', connection: 'not_connected' as string }))

vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ status: 'known', isKnown: true, isPro: m.tier !== 'free', isEnterprise: false, retry: async () => {} }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/services/anomaly.service', () => ({
  anomalyService: {
    getAnomalies: async () => ({ anomalies: [], stats: { total: 0, active: 0, bySeverity: { critical: 0, warning: 0, info: 0 }, byType: {}, mttr: 0, falsePositiveRate: 0 } }),
    getLastScan: async () => null,
  },
}))

beforeEach(() => {
  m.tier = 'free'
  m.connection = 'not_connected'
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/aws/accounts') return accountsResponse(m.connection as ConnectionMode) as never
    throw new Error('unexpected GET ' + url)
  })
})
afterEach(() => { vi.restoreAllMocks() })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><AnomaliesPage /></QueryClientProvider>)
}

const SUBTITLE = 'Anomaly detection on measured AWS data is coming soon. Nothing is being monitored here yet.'
const PLAN_LOCK = 'On the Optimization Engine plan'

function expectNoAnomalyActions() {
  expect(screen.queryByText(/active anomalies/)).toBeNull()
  expect(screen.queryByRole('button', { name: /^Active \(/ })).toBeNull()
  expect(screen.queryByRole('button', { name: 'All anomalies' })).toBeNull()
  expect(screen.queryByText(/Priority Issues/)).toBeNull()
  expect(screen.queryAllByRole('combobox')).toHaveLength(0)
  expect(screen.queryByRole('button', { name: /Resolve selected|Ignore selected|Assign selected/ })).toBeNull()
  expect(screen.queryByText('Custom Detection Rules')).toBeNull()
  expect(screen.queryByRole('button', { name: /New Rule|Create First Rule/ })).toBeNull()
}

describe('PR4c: /anomalies with no AWS account connected', () => {
  it('free: title, subtitle, Coming soon and the card in place of the plan lock', async () => {
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(screen.getByRole('heading', { level: 1, name: 'Anomaly Detection' })).toBeInTheDocument()
    expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
    expect(screen.getByText('Coming soon')).toBeInTheDocument()
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
    expectNoAnomalyActions()
  })

  it('Optimization Engine: the card below the tiles; no counts, tabs, filters, bulk actions or custom rules', async () => {
    m.tier = 'pro'
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    // Below the four tiles ("—" · Not active, unchanged).
    const tiles = screen.getAllByTestId('anomaly-kpi')
    expect(tiles).toHaveLength(4)
    expect(card.previousElementSibling).toBe(tiles[0].parentElement)
    // The status bar and the list's empty state both say so (kept).
    await waitFor(() => expect(screen.getAllByText('No scan recorded yet')).toHaveLength(2))
    expect(screen.getByText('Anomaly detection not active')).toBeInTheDocument()
    expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
    expectNoAnomalyActions()
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
  })

  it('connection loading: the skeleton only', async () => {
    m.connection = 'PENDING'
    renderPage()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/aws/accounts'))
    expect(screen.getByTestId('plan-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
  })
})

describe('PR4c: /anomalies connected is unchanged', () => {
  it.each(['connected', 'FAIL'])('free, %s: the plan lock (entitlement untouched), no card', async (connection) => {
    m.connection = connection
    renderPage()
    expect(await screen.findByText(PLAN_LOCK)).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/settings/billing/upgrade')
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })

  it('Optimization Engine: counts, tabs, filters, bulk actions and custom rules; no card', async () => {
    m.tier = 'pro'
    m.connection = 'connected'
    renderPage()
    expect(await screen.findByText('Priority Issues (0)')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Active (0)' })).toBeInTheDocument()
    expect(screen.getByText('0 active anomalies')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resolve selected' })).toBeInTheDocument()
    expect(screen.getByText('Custom Detection Rules')).toBeInTheDocument()
    expect(within(screen.getByText('Custom Detection Rules').parentElement!.parentElement!).getByRole('button', { name: /New Rule/ })).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })
})
