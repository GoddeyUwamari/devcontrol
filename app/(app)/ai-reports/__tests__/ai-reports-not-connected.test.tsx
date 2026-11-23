/**
 * PR4c empty states, /ai-reports (AI Reports). With no AWS account connected:
 *   - below Optimization Engine: the title and subtitle, and the shared card, in place of the bare plan lock;
 *   - on the plan: none of the eight Generate buttons, no "No setup required · Read-only access", Report
 *     Activity is "—" (never 0), and the card below the three tiles.
 * Connected (or when the check fails) the page is today's. Until the check answers, the plan-loading skeleton.
 *
 * GET /api/aws/accounts is the backend's own body through the real service; the report history is what the
 * backend answers a new org (ai-reports.routes.ts /history: no rows).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { accountsResponse, type ConnectionMode } from '@/components/aws/__tests__/accounts-wire'
import AIReportsPage from '../page'

const m = vi.hoisted(() => ({ tier: 'free' as 'free' | 'pro', connection: 'not_connected' as string }))

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ status: 'known', isKnown: true, isPro: m.tier === 'pro', retry: async () => {} }),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector?: (s: { enabled: boolean }) => unknown) => (selector ? selector({ enabled: false }) : { enabled: false }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))
vi.mock('@/lib/hooks/useAIReports', () => ({
  useAIReports: () => ({
    generateReport: vi.fn(), getReportHistory: async () => [], deleteReport: vi.fn(), bulkDeleteReports: vi.fn(),
    isGenerating: false, isFetchingHistory: false, error: null,
  }),
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
  return render(<QueryClientProvider client={client}><AIReportsPage /></QueryClientProvider>)
}

const TITLE = 'Uncover Cost Savings, Risks, and Insights Across Your AWS — in Minutes'
const SUBTITLE = 'Generate executive-ready AI reports with actionable recommendations your team can use immediately.'
const PLAN_LOCK = 'On the Optimization Engine plan'
const generateButtons = () => screen.queryAllByRole('button', { name: /Generate/ })
const activityTile = () => screen.getByText('Report Activity').parentElement as HTMLElement

describe('PR4c: /ai-reports with no AWS account connected', () => {
  it('free: title, subtitle and the card in place of the plan lock', async () => {
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(screen.getByRole('heading', { level: 1, name: TITLE })).toBeInTheDocument()
    expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
    expect(generateButtons()).toHaveLength(0)
  })

  it('Optimization Engine: no Generate button at all, no "No setup required", Report Activity "—", the card below the tiles', async () => {
    m.tier = 'pro'
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    await waitFor(() => expect(screen.getByText('Start uncovering insights in minutes')).toBeInTheDocument())
    expect(generateButtons()).toHaveLength(0)
    expect(screen.queryByText(/No setup required/)).toBeNull()
    expect(within(activityTile()).getByTestId('unmeasured-value')).toHaveTextContent('—')
    expect(activityTile()).not.toHaveTextContent(/\b0\b/)
    expect(card.previousElementSibling).toBe(activityTile().parentElement)
    // Kept: the report descriptions.
    expect(screen.getByText('Available Reports')).toBeInTheDocument()
    expect(screen.getByText('Identify unused resources, rightsizing opportunities, and immediate savings.')).toBeInTheDocument()
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

describe('PR4c: /ai-reports connected is unchanged', () => {
  it('free: the plan lock (entitlement untouched), no card', async () => {
    m.connection = 'connected'
    renderPage()
    expect(await screen.findByText(PLAN_LOCK)).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })

  it.each(['connected', 'FAIL'])('Optimization Engine, %s: all eight Generate buttons, Report Activity 0, no card', async (connection) => {
    m.tier = 'pro'
    m.connection = connection
    renderPage()
    await screen.findByText('Start uncovering insights in minutes')
    expect(generateButtons()).toHaveLength(8)
    expect(screen.getByText('Takes ~2 minutes · No setup required · Read-only access')).toBeInTheDocument()
    expect(within(activityTile()).queryByTestId('unmeasured-value')).toBeNull()
    expect(activityTile()).toHaveTextContent('Report Activity0')
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })
})
