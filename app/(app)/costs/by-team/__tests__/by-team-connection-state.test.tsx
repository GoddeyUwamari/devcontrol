/**
 * /costs/by-team "connected" (AWS connect PR B): only the server's connection
 * state decides the wording. Spend left from an earlier connection never makes
 * the page say the account is connected. PR4b: the server's not_connected shows
 * the shared not-connected card; ambiguous and a failed check keep the block.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
// The page reads the organization for its org- and UTC-day-keyed cost caches (DAY1-D10).
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }) }))
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getCostSummary = vi.hoisted(() => vi.fn())
const getConnection = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ status: 'known', isKnown: true, isFree: false, isStarter: true, isPro: true, isEnterprise: false, tier: 'pro', canAccess: () => true }),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getCostSummary } }))
vi.mock('@/lib/services/infrastructure.service', () => ({ infrastructureService: { getCosts: vi.fn() } }))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => {
    // FAIL and PENDING are answered here, not by the spy: a spy that itself returns a
    // rejected or never-settling promise is reported by vitest as the test's own error.
    const r = await getConnection()
    if (r === 'FAIL') throw new Error('500')
    if (r === 'PENDING') return new Promise(() => {})
    return r
  } } }))

import CostsByTeamPage from '../page'

const CONNECTED_COPY = /DevControl does not yet allocate your AWS bill/
const NOT_CONNECTED_COPY = 'Connect your AWS account to see your AWS spend. Allocation to teams and services is not available yet.'

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><CostsByTeamPage /></QueryClientProvider>)
}

const card = () => screen.getByTestId('by-team-attribution-unavailable')

beforeEach(() => {
  getCostSummary.mockReset()
  getConnection.mockReset()
  // Spend from an earlier connection: historical AWS-derived data.
  getCostSummary.mockResolvedValue({
    spend: { state: 'available', source: 'AWS Cost Explorer', provenance: 'actual', asOf: null, coverage: null, reason: null, data: { amount: 812.25, basis: 'billed_month_to_date', lastDayInProgress: false } },
    monthOverMonth: { state: 'unavailable', source: 'x', provenance: null, asOf: null, coverage: null, reason: 'fixture', data: null },
  })
})

describe('/costs/by-team: connected comes from the server connection state only', () => {
  // PR4b: the server's not_connected is the shared card (with the kept link), never the block below.
  it.each([
    ['stale data, server not connected', { accounts: [], connection: 'not_connected' }],
    ['disconnected row, stale spend', { accounts: [{ id: 'acct-1', status: 'disconnected' }], connection: 'not_connected' }],
  ])('%s: the not-connected card', async (_label, answer) => {
    getConnection.mockResolvedValue(answer)
    renderPage()
    await screen.findByTestId('not-connected-card')
    expect(screen.queryByTestId('by-team-attribution-unavailable')).toBeNull()
    expect(screen.queryByText(CONNECTED_COPY)).toBeNull()
    expect(screen.getByRole('link', { name: 'See spend by AWS service →' })).toHaveAttribute('href', '/costs')
  })

  it('more than one active connection: the not-connected wording, not the card', async () => {
    getConnection.mockResolvedValue({ accounts: [], connection: 'ambiguous' })
    renderPage()
    await waitFor(() => expect(card()).toHaveTextContent(NOT_CONNECTED_COPY))
    expect(card()).not.toHaveTextContent(CONNECTED_COPY)
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })

  it('error: a failed check never shows the connected wording', async () => {
    getConnection.mockResolvedValue('FAIL')
    renderPage()
    await waitFor(() => expect(getConnection).toHaveBeenCalled())
    await screen.findByTestId('by-team-attribution-unavailable')
    expect(card()).not.toHaveTextContent(CONNECTED_COPY)
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })

  it('loading: a skeleton only, never the connected wording or the card before the check answers', async () => {
    getConnection.mockResolvedValue('PENDING')
    renderPage()
    await waitFor(() => expect(getConnection).toHaveBeenCalled())
    expect(screen.getByTestId('plan-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('by-team-attribution-unavailable')).toBeNull()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByText(CONNECTED_COPY)).toBeNull()
  })

  it('connected: the server reports one active connection', async () => {
    getConnection.mockResolvedValue({ accounts: [{ id: 'acct-1', status: 'active' }], connection: 'connected' })
    renderPage()
    await waitFor(() => expect(card()).toHaveTextContent(CONNECTED_COPY))
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })
})
