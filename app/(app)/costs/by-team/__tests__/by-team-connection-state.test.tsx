/**
 * /costs/by-team "connected" (AWS connect PR B): only the server's connection
 * state decides the wording. Spend left from an earlier connection never makes
 * the page say the account is connected.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'

const getDashboardStats = vi.hoisted(() => vi.fn())
const getConnection = vi.hoisted(() => vi.fn())

vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ status: 'known', isKnown: true, isFree: false, isStarter: true, isPro: true, isEnterprise: false, tier: 'pro', canAccess: () => true }),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))
vi.mock('@/lib/services/platform-stats.service', () => ({ platformStatsService: { getDashboardStats } }))
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
  getDashboardStats.mockReset()
  getConnection.mockReset()
  // Spend from an earlier connection: historical AWS-derived data.
  getDashboardStats.mockResolvedValue({ totalServices: 9, servicesChange: 0, activeDeployments: 0, deploymentsChange: 0, monthlyAwsCost: 812.25, costChange: 0, totalTeams: 1, teamsChange: 0, costSource: 'actual' })
})

describe('/costs/by-team: connected comes from the server connection state only', () => {
  it.each([
    ['stale data, server not connected', { accounts: [], connection: 'not_connected' }],
    ['disconnected row, stale spend', { accounts: [{ id: 'acct-1', status: 'disconnected' }], connection: 'not_connected' }],
    ['more than one active connection', { accounts: [], connection: 'ambiguous' }],
  ])('%s: the not-connected wording', async (_label, answer) => {
    getConnection.mockResolvedValue(answer)
    renderPage()
    await waitFor(() => expect(getConnection).toHaveBeenCalled())
    await waitFor(() => expect(card()).toHaveTextContent(NOT_CONNECTED_COPY))
    expect(card()).not.toHaveTextContent(CONNECTED_COPY)
  })

  it('error: a failed check never shows the connected wording', async () => {
    getConnection.mockResolvedValue('FAIL')
    renderPage()
    await waitFor(() => expect(getConnection).toHaveBeenCalled())
    await screen.findByTestId('by-team-attribution-unavailable')
    expect(card()).not.toHaveTextContent(CONNECTED_COPY)
  })

  it('loading: never the connected wording before the check answers', async () => {
    getConnection.mockResolvedValue('PENDING')
    renderPage()
    await screen.findByTestId('by-team-attribution-unavailable')
    expect(card()).not.toHaveTextContent(CONNECTED_COPY)
  })

  it('connected: the server reports one active connection', async () => {
    getConnection.mockResolvedValue({ accounts: [{ id: 'acct-1', status: 'active' }], connection: 'connected' })
    renderPage()
    await waitFor(() => expect(card()).toHaveTextContent(CONNECTED_COPY))
  })
})
