/**
 * PR4c empty states, /anomalies/rules (Custom Anomaly Rules). With no AWS account connected:
 *   - below Revenue Protection: the title and subtitle, and the shared card in place of the plan lock;
 *   - on the plan: no New Rule or Create First Rule, and not the "Create your first rule…" line that invites it
 *     (founder ruling); the rule counts (the user's own) and any saved rule stay; the card below the counts.
 * Connected the page is today's. Until the check answers, the plan-loading skeleton.
 *
 * GET /api/aws/accounts and GET /api/anomaly-rules (custom-anomaly-rules.routes.ts, requireEnterprise) are
 * the backend's bodies through the real services.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { accountsResponse, type ConnectionMode } from '@/components/aws/__tests__/accounts-wire'
import AnomalyRulesPage from '../page'

const m = vi.hoisted(() => ({ tier: 'free' as 'free' | 'enterprise', connection: 'not_connected' as string, rules: [] as unknown[] }))

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ status: 'known', isKnown: true, isEnterprise: m.tier === 'enterprise', retry: async () => {} }),
}))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: () => ({ enabled: false }) }))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// A rule the user saved (custom-anomaly-rules repository row shape).
const SAVED_RULE = { id: 'r1', organizationId: 'org-test', name: 'Spend over $500', description: null, metric: 'total_cost', condition: 'greater_than', threshold: 500, timeWindow: '24h', severity: 'warning', enabled: true, createdAt: '2026-11-21T09:00:00.000Z', updatedAt: '2026-11-21T09:00:00.000Z' }

beforeEach(() => {
  m.tier = 'free'
  m.connection = 'not_connected'
  m.rules = []
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/aws/accounts') return accountsResponse(m.connection as ConnectionMode) as never
    if (url === '/api/anomaly-rules') return { data: { success: true, data: m.rules } } as never
    throw new Error('unexpected GET ' + url)
  })
})
afterEach(() => { vi.restoreAllMocks() })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><AnomalyRulesPage /></QueryClientProvider>)
}

const PLAN_LOCK = 'Revenue Protection feature'
const FIRST_RULE_LINE = 'Create your first rule to get alerted on custom thresholds.'
const tileValue = (label: string) => screen.getByText(label).nextElementSibling as HTMLElement

describe('PR4c: /anomalies/rules with no AWS account connected', () => {
  it('free: title, subtitle and the card in place of the plan lock', async () => {
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(screen.getByRole('heading', { level: 1, name: 'Custom Anomaly Rules' })).toBeInTheDocument()
    expect(screen.getByText('Define custom detection thresholds and conditions for your infrastructure.')).toBeInTheDocument()
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
  })

  it('Revenue Protection: no New Rule or Create First Rule; real counts; the card below them', async () => {
    m.tier = 'enterprise'
    renderPage()
    await waitFor(() => expect(screen.getByText('No custom rules yet')).toBeInTheDocument())
    const card = screen.getByTestId('not-connected-card')
    expect(card.previousElementSibling).toBe(screen.getByText('Total Rules').closest('.grid'))
    for (const label of ['Total Rules', 'Active Rules', 'Critical Rules', 'Warning Rules']) expect(tileValue(label)).toHaveTextContent('0')
    expect(screen.getByRole('link', { name: '← View Anomalies' })).toHaveAttribute('href', '/anomalies')
    expect(screen.queryByRole('button', { name: /New Rule/ })).toBeNull()
    expect(screen.queryByRole('button', { name: /Create First Rule/ })).toBeNull()
    expect(screen.queryByText(FIRST_RULE_LINE)).toBeNull()
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
  })

  it('Revenue Protection: a saved rule stays, and is counted', async () => {
    m.tier = 'enterprise'
    m.rules = [SAVED_RULE]
    renderPage()
    expect(await screen.findByText('Spend over $500')).toBeInTheDocument()
    expect(tileValue('Total Rules')).toHaveTextContent('1')
    expect(screen.getByTestId('not-connected-card')).toBeInTheDocument()
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

describe('PR4c: /anomalies/rules connected is unchanged', () => {
  it('free: the plan lock (entitlement untouched), no card', async () => {
    m.connection = 'connected'
    renderPage()
    expect(await screen.findByText(PLAN_LOCK)).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })

  it('Revenue Protection: New Rule and Create First Rule, no card', async () => {
    m.tier = 'enterprise'
    m.connection = 'connected'
    renderPage()
    expect(await screen.findByRole('button', { name: /Create First Rule/ })).toBeInTheDocument()
    expect(screen.getByText(FIRST_RULE_LINE)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /New Rule/ })).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })
})
