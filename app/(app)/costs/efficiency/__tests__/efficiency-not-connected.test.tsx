/**
 * PR4b empty states, /costs/efficiency (Cloud Efficiency Overview), as PR2's /costs: with no AWS account
 * connected the header's Review Optimizations and Export become one outlined "Connect AWS account"; the four
 * KPI tiles keep their labels and show "—" with nothing under them; the shared NotConnectedCard sits directly
 * below the tiles; every section below (Spend breakdown, Resource efficiency vs cost, the quadrant cards, Top
 * wasteful resources, Recent cost anomalies, Efficiency score by service and its plan banner) waits for a
 * connection. Connected, or when the check fails, the page is today's (real zeros, plan banner, actions).
 * Until the check answers, grey blocks only.
 *
 * The network answers are the backend's for a new org (backend/src): GET /api/aws/accounts
 * (aws.routes.ts), /api/platform/costs/summary (stats.controller.ts spendSection, no Cost Explorer result and
 * no estimate), /api/platform/costs/trend (409 AWS_NOT_CONNECTED with no account), /api/infrastructure (no
 * rows), /api/cost-recommendations/stats (repository getStats over no rows), /api/anomalies (no rows).
 * They go through the real services and parsers. All figures are test fixtures, not production data.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
vi.mock('@/lib/contexts/auth-context', () => ({ useAuth: () => ({ organization: { id: 'org-test', name: 'Org Test' }, user: { id: 'u' } }) }))
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/lib/api'
import EfficiencyPage from '../page'

const m = vi.hoisted(() => ({ tier: 'free' as 'free' | 'pro', connection: 'not_connected' as 'not_connected' | 'connected' | 'FAIL' | 'PENDING' }))

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ status: 'known', isKnown: true, isFree: m.tier === 'free', isPro: m.tier === 'pro', isEnterprise: false, tier: m.tier, canAccess: () => m.tier === 'pro' }),
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
// stats.controller.ts spendSection with no Cost Explorer result and no inventory estimate
const EMPTY_SPEND = { state: 'unavailable', source: 'AWS Cost Explorer', provenance: null, asOf: null, coverage: null, reason: 'no AWS Cost Explorer result (not_connected) and no inventory estimate', data: null }
const COST_SUMMARY = { success: true, data: { spend: EMPTY_SPEND, monthOverMonth: { ...EMPTY_SPEND, source: 'DevControl month-over-month comparison', reason: 'no comparable daily Cost Explorer data' }, monthStateReason: null } }
// cost-recommendations repository getStats over no rows
const REC_STATS = { success: true, data: { total_recommendations: 0, active_recommendations: 0, total_potential_savings: 0, potential_savings_by_resource_type: {}, potential_savings_ceiling: 0, potential_savings_ceiling_by_resource_type: {}, estimated_findings: 0, unestimated_findings: 0, by_severity: { high: 0, medium: 0, low: 0 } } }
// A stopped instance (connected tests only): a real $0.00 "not running" figure is today's page.
const INFRA_CONNECTED = { success: true, data: [{ id: 'r1', resourceType: 'ec2', status: 'stopped', costPerMonth: 0, awsRegion: 'us-east-1' }] }

function stubNetwork() {
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/aws/accounts') {
      if (m.connection === 'PENDING') return new Promise(() => {}) as never
      if (m.connection === 'FAIL') throw Object.assign(new Error('Request failed with status code 500'), { response: { status: 500, data: { success: false, message: 'Failed to retrieve AWS accounts.' } } })
      return { data: m.connection === 'connected' ? ACCOUNTS_CONNECTED : ACCOUNTS_NOT_CONNECTED } as never
    }
    if (url === '/api/platform/costs/summary') return { data: COST_SUMMARY } as never
    if (url.startsWith('/api/infrastructure')) return { data: m.connection === 'connected' ? INFRA_CONNECTED : { success: true, data: [] } } as never
    if (url === '/api/cost-recommendations/stats') return { data: REC_STATS } as never
    throw new Error('unexpected GET ' + url)
  })
  vi.stubGlobal('fetch', vi.fn(async (url: string) => {
    const u = String(url)
    // platform.routes.ts costs/trend: 409 AWS_NOT_CONNECTED with no account; connected, no months yet.
    if (u.includes('/api/platform/costs/trend')) {
      return m.connection === 'connected'
        ? new Response(JSON.stringify({ success: true, data: [] }), { status: 200 })
        : new Response(JSON.stringify({ success: false, code: 'AWS_NOT_CONNECTED', error: 'No AWS account is connected.' }), { status: 409 })
    }
    if (u.includes('/api/anomalies')) {
      return new Response(JSON.stringify({ success: true, anomalies: [], stats: { total: 0, active: 0, bySeverity: { critical: 0, warning: 0, info: 0 }, byType: {}, mttr: 0, falsePositiveRate: 0 } }), { status: 200 })
    }
    throw new Error('unexpected fetch ' + u)
  }))
}

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><EfficiencyPage /></QueryClientProvider>)
}

const SPEND_LABEL = 'Month-to-Date Spend'
const KPI_LABELS = [SPEND_LABEL, 'Cost Per Resource', 'Stopped or Starting Resources', 'Est. Savings Opportunity']
const SUBLINES = [
  'Not available · no AWS Cost Explorer data or inventory estimate',
  'No discovered resources',
  'Estimated at running rates; AWS charges less while instances are stopped.',
  'Estimated monthly savings from recommendations',
]
const HIDDEN_SECTIONS = ['Spend breakdown', 'Resource efficiency vs cost', 'At Risk', 'Low ROI', 'Strategic', 'Efficient', 'Top wasteful resources', 'Recent cost anomalies', 'Efficiency score by service']
const PLAN_BANNER = 'Full Efficiency Analysis — Optimization Engine plan'
const TREND_FAILED = 'The spend trend could not be retrieved from AWS Cost Explorer.'
const tile = (label: string) => screen.getByText(label).parentElement as HTMLElement

beforeEach(() => {
  m.tier = 'free'
  m.connection = 'not_connected'
  vi.spyOn(console, 'error').mockImplementation(() => {})
  stubNetwork()
})
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks() })

describe.each(['free', 'pro'] as const)('PR4b: /costs/efficiency with no AWS account connected (%s plan)', (tier) => {
  beforeEach(() => { m.tier = tier })

  it('header: title and subtitle kept; one outlined Connect AWS account, no Review Optimizations or Export', async () => {
    renderPage()
    const button = await screen.findByTestId('connect-aws-header-button')
    expect(button).toHaveAttribute('href', '/connect-aws')
    expect(button).toHaveTextContent('Connect AWS account')
    expect(screen.getByRole('heading', { level: 1, name: 'Cloud Efficiency Overview' })).toBeInTheDocument()
    expect(screen.getByText('Resource efficiency, spend breakdown, and cost-to-value analysis across your AWS environment.')).toBeInTheDocument()
    expect(screen.queryByText(/Review Optimizations/)).toBeNull()
    expect(screen.queryByRole('button', { name: /Export/ })).toBeNull()
  })

  it('the four KPI tiles: label and "—" only, no subline, never $0', async () => {
    renderPage()
    await screen.findByTestId('not-connected-card')
    // Every answer is in, so a subline would have rendered by now.
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/cost-recommendations/stats'))
    for (const label of KPI_LABELS) {
      const t = tile(label)
      expect(within(t).getByTestId('unmeasured-value')).toHaveTextContent('—')
      expect(t.textContent).toBe(`${label}—Not measured`)
    }
    for (const sub of SUBLINES) expect(screen.queryByText(sub)).toBeNull()
    expect(screen.queryByText(/\$0/)).toBeNull()
  })

  it('the shared card directly below the tiles; every section below hidden; no failed-trend text or plan banner', async () => {
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    // Directly below the tile row.
    expect(card.previousElementSibling).toBe(tile('Cost Per Resource').parentElement)
    // The trend request has failed (409) by now: its message still never shows.
    await waitFor(() => expect(fetch).toHaveBeenCalledWith(expect.stringContaining('/api/platform/costs/trend'), expect.anything()))
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText(TREND_FAILED)).toBeNull()
    for (const heading of HIDDEN_SECTIONS) expect(screen.queryByText(heading)).toBeNull()
    expect(screen.queryByText(PLAN_BANNER)).toBeNull()
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
    expect(screen.queryByText(/Fix all|Fix now|View all/)).toBeNull()
  })

  it('connection loading: grey blocks only (4 tiles and the header action), no card, tiles or actions', async () => {
    m.connection = 'PENDING'
    renderPage()
    expect(await screen.findByTestId('connection-loading')).toBeInTheDocument()
    expect(screen.getByTestId('connection-loading-tiles').children).toHaveLength(4)
    expect(screen.getByTestId('header-action-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByText('Cost Per Resource')).toBeNull()
    expect(screen.queryByText(/Review Optimizations/)).toBeNull()
    expect(screen.queryByText(PLAN_BANNER)).toBeNull()
  })
})

describe('PR4b: /costs/efficiency connected is unchanged', () => {
  beforeEach(() => { m.connection = 'connected' })

  it.each(['free', 'pro'] as const)('%s plan: header actions, real $0 figures and their sublines, every section; no card or "—" tiles', async (tier) => {
    m.tier = tier
    renderPage()
    await waitFor(() => expect(tile('Stopped or Starting Resources')).toHaveTextContent('$0.00'))
    await waitFor(() => expect(tile('Est. Savings Opportunity')).toHaveTextContent('$0'))
    expect(screen.getByText('Estimated at running rates; AWS charges less while instances are stopped.')).toBeInTheDocument()
    expect(screen.getByText('Estimated monthly savings from recommendations')).toBeInTheDocument()
    expect(screen.getByText(/Review Optimizations/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Export/ })).toBeInTheDocument()
    for (const heading of ['Spend breakdown', 'Resource efficiency vs cost', 'Top wasteful resources', 'Recent cost anomalies', 'Efficiency score by service']) {
      expect(screen.getByText(heading)).toBeInTheDocument()
    }
    expect(await screen.findByText('No cost trend data available yet')).toBeInTheDocument()
    // The plan banner is the plan's, not the connection's: free sees it, Pro does not.
    if (tier === 'free') expect(screen.getByText(PLAN_BANNER)).toBeInTheDocument()
    else expect(screen.queryByText(PLAN_BANNER)).toBeNull()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByTestId('connect-aws-header-button')).toBeNull()
    expect(screen.queryByTestId('unmeasured-value')).toBeNull()
  })

  it('a failed connection check is today\'s page, never the card', async () => {
    m.connection = 'FAIL'
    renderPage()
    await screen.findByText(/Review Optimizations/)
    expect(screen.getByText('Spend breakdown')).toBeInTheDocument()
    expect(screen.getByText(PLAN_BANNER)).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByTestId('unmeasured-value')).toBeNull()
  })
})
