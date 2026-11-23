/**
 * PR4c empty states, /remediation (Auto-Remediation Workflows). With no AWS account connected:
 *   - below Revenue Protection: the title and its existing subtitle, and the shared card in place of the plan lock;
 *   - on the plan: the four workflow counts stay real, Savings recovered is "—", the card below the tiles, no
 *     status tabs; "No workflows yet" and "Go to Cost Optimization →" stay.
 * Connected (or when the check fails) the page is today's. Until the check answers, the plan-loading skeleton.
 *
 * GET /api/aws/accounts and /api/remediation (remediation.routes.ts, requireEnterprise; a new org has no
 * workflows) are the backend's bodies through the real services.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { accountsResponse, type ConnectionMode } from '@/components/aws/__tests__/accounts-wire'
import RemediationPage from '../page'

const m = vi.hoisted(() => ({ tier: 'free' as 'free' | 'enterprise', connection: 'not_connected' as string }))

vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ status: 'known', isKnown: true, isEnterprise: m.tier === 'enterprise', retry: async () => {} }),
}))

beforeEach(() => {
  m.tier = 'free'
  m.connection = 'not_connected'
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/aws/accounts') return accountsResponse(m.connection as ConnectionMode) as never
    if (url.startsWith('/api/remediation')) return { data: { success: true, data: [] } } as never
    throw new Error('unexpected GET ' + url)
  })
})
afterEach(() => { vi.restoreAllMocks() })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><RemediationPage /></QueryClientProvider>)
}

const SUBTITLE = 'Approval-based infrastructure remediation. Every AWS action requires explicit human approval.'
const PLAN_LOCK = 'Revenue Protection feature'
const COUNTS = ['Pending Approval', 'Approved', 'Completed', 'Failed']
const tile = (label: string) => screen.getByText(label).parentElement!.parentElement as HTMLElement
const tabs = () => screen.queryAllByRole('button', { name: /^(All|Pending|Approved|Completed|Failed)$/ })

describe('PR4c: /remediation with no AWS account connected', () => {
  it('free: title, the existing subtitle and the card in place of the plan lock', async () => {
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(screen.getByRole('heading', { level: 1, name: 'Auto-Remediation Workflows' })).toBeInTheDocument()
    expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
  })

  it('Revenue Protection: real workflow counts, Savings recovered "—", the card, no tabs; the empty state and its link stay', async () => {
    m.tier = 'enterprise'
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    await waitFor(() => expect(screen.getByText('No workflows yet')).toBeInTheDocument())
    for (const label of COUNTS) expect(tile(label)).toHaveTextContent(`${label}0`)
    expect(within(tile('Savings Recovered')).getByTestId('unmeasured-value')).toHaveTextContent('—')
    expect(tile('Savings Recovered')).not.toHaveTextContent('$')
    expect(card.previousElementSibling).toBe(tile('Savings Recovered').parentElement)
    expect(tabs()).toHaveLength(0)
    expect(screen.getByRole('link', { name: 'Go to Cost Optimization →' })).toHaveAttribute('href', '/cost-optimization')
    expect(screen.getByText(SUBTITLE)).toBeInTheDocument()
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

describe('PR4c: /remediation connected is unchanged', () => {
  it('free: the plan lock (entitlement untouched), no subtitle or card', async () => {
    m.connection = 'connected'
    renderPage()
    expect(await screen.findByText(PLAN_LOCK)).toBeInTheDocument()
    expect(screen.queryByText(SUBTITLE)).toBeNull()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })

  it.each(['connected', 'FAIL'])('Revenue Protection, %s: $0/mo Savings recovered and the five tabs; no card', async (connection) => {
    m.tier = 'enterprise'
    m.connection = connection
    renderPage()
    await waitFor(() => expect(screen.getByText('No workflows yet')).toBeInTheDocument())
    expect(tile('Savings Recovered')).toHaveTextContent('$0/mo')
    expect(tabs()).toHaveLength(5)
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })
})
