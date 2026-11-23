/**
 * PR4b empty states, /costs/by-team (Cost Attribution): with no AWS account connected, on every plan, the
 * page is its title and subtitle, the shared NotConnectedCard and the kept "See spend by AWS service →" link
 * (founder ruling, PR4 Stage A item 20), in place of the Cost Control plan lock (free) or the spend card and
 * not-available block (paid). The plan lock is untouched underneath: connected, a free org sees it again and
 * a paid org sees today's page. Until the connection check answers, the plan-loading skeleton.
 *
 * The network answers are the backend's for a new org (backend/src): GET /api/aws/accounts (aws.routes.ts,
 * not plan-gated) and /api/platform/costs/summary (stats.controller.ts spendSection, no Cost Explorer result
 * and no estimate). They go through the real services and parsers. All figures are test fixtures.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }) }))
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/lib/api'
import CostsByTeamPage from '../page'

const m = vi.hoisted(() => ({ tier: 'free' as 'free' | 'starter', connection: 'not_connected' as 'not_connected' | 'connected' | 'PENDING' }))

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ status: 'known', isKnown: true, isFree: m.tier === 'free', isStarter: m.tier === 'starter', isPro: false, isEnterprise: false, tier: m.tier, canAccess: () => m.tier !== 'free' }),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))

// aws.routes.ts GET /accounts
const ACCOUNTS_NOT_CONNECTED = { success: true, data: [], connection: { state: 'not_connected' }, home_region_proposal: null, previous_home_region: null, home_region_changed_at: null, can_change_home_region: true }
const ACCOUNTS_CONNECTED = {
  success: true,
  data: [{ id: 1, org_id: 'org-test', account_id: '111122223333', role_arn: 'arn:aws:iam::111122223333:role/DevControl', nickname: null, external_id: 'ext', region: 'us-east-1', connected_at: '2026-11-20T09:00:00.000Z', status: 'active' }],
  connection: { state: 'connected', health: { state: 'ok', since: '2026-11-23T08:00:00.000Z' } },
  home_region_proposal: null, previous_home_region: null, home_region_changed_at: null, can_change_home_region: true,
}
const EMPTY_SPEND = { state: 'unavailable', source: 'AWS Cost Explorer', provenance: null, asOf: null, coverage: null, reason: 'no AWS Cost Explorer result (not_connected) and no inventory estimate', data: null }
const COST_SUMMARY = { success: true, data: { spend: EMPTY_SPEND, monthOverMonth: { ...EMPTY_SPEND, source: 'DevControl month-over-month comparison', reason: 'no comparable daily Cost Explorer data' }, monthStateReason: null } }

beforeEach(() => {
  m.tier = 'free'
  m.connection = 'not_connected'
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/aws/accounts') {
      if (m.connection === 'PENDING') return new Promise(() => {}) as never
      return { data: m.connection === 'connected' ? ACCOUNTS_CONNECTED : ACCOUNTS_NOT_CONNECTED } as never
    }
    if (url === '/api/platform/costs/summary') return { data: COST_SUMMARY } as never
    throw new Error('unexpected GET ' + url)
  })
})
afterEach(() => { vi.restoreAllMocks() })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><CostsByTeamPage /></QueryClientProvider>)
}

const PLAN_LOCK = 'On the Cost Control plan'
const ATTRIBUTION_BLOCK = 'Cost attribution by team and service is not available yet'
const LINK = 'See spend by AWS service →'

describe.each(['free', 'starter'] as const)('PR4b: /costs/by-team with no AWS account connected (%s plan)', (tier) => {
  beforeEach(() => { m.tier = tier })

  it('title, subtitle, the shared card and the kept link; no plan lock, spend card or not-available block', async () => {
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(screen.getByRole('heading', { level: 1, name: 'Cost Attribution' })).toBeInTheDocument()
    expect(screen.getByText('Attribution of AWS spend to teams, services, and resource types.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: LINK })).toHaveAttribute('href', '/costs')
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
    expect(screen.queryByTestId('by-team-spend-card')).toBeNull()
    expect(screen.queryByTestId('by-team-attribution-unavailable')).toBeNull()
    expect(screen.queryByText(ATTRIBUTION_BLOCK)).toBeNull()
  })

  it('connection loading: the skeleton only, no card, lock or block', async () => {
    m.connection = 'PENDING'
    renderPage()
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/aws/accounts'))
    expect(screen.getByTestId('plan-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
    expect(screen.queryByText(ATTRIBUTION_BLOCK)).toBeNull()
  })
})

describe('PR4b: /costs/by-team connected is unchanged', () => {
  beforeEach(() => { m.connection = 'connected' })

  it('free plan: the Cost Control plan lock again (entitlement untouched), no card; no paid read', async () => {
    renderPage()
    expect(await screen.findByText(PLAN_LOCK)).toBeInTheDocument()
    expect(screen.getByText('Team cost attribution is on the Cost Control plan.')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'See plans' })).toHaveAttribute('href', '/settings/billing/upgrade')
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(api.get).not.toHaveBeenCalledWith('/api/platform/costs/summary')
  })

  it('paid plan: the spend card and the not-available block with the link, no card', async () => {
    m.tier = 'starter'
    renderPage()
    await waitFor(() => expect(screen.getByTestId('by-team-attribution-unavailable')).toHaveTextContent(/DevControl does not yet allocate your AWS bill/))
    expect(screen.getByTestId('by-team-spend-card')).toHaveTextContent('Month-to-Date Spend')
    expect(screen.getByRole('link', { name: LINK })).toHaveAttribute('href', '/costs')
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })
})
