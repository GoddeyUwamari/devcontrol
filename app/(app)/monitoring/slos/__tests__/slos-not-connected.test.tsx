/**
 * PR4c empty states, /monitoring/slos (SLO Dashboard & Management). With no AWS account connected:
 *   - below Revenue Protection: the title and subtitle, and the shared card in place of the plan lock;
 *   - on the plan: New SLO becomes the outlined Connect AWS account; SLOs defined stays a real count and
 *     Healthy / Breached / Unknown are "—"; the card below the tiles; no second New SLO, no "N SLOs · evaluated
 *     live against CloudWatch" line and no "No SLOs configured" block. A saved SLO stays listed.
 * Connected (or when the check fails) the page is today's. Until the check answers, the plan-loading skeleton.
 *
 * GET /api/aws/accounts, /api/slos/evaluate (slo.routes.ts, requireEnterprise; with no account each SLO is
 * evaluated aws_not_connected, slo-evaluation.ts) and /api/aws-resources are the backend's bodies through the
 * real services.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { api } from '@/lib/api'
import { accountsResponse, type ConnectionMode } from '@/components/aws/__tests__/accounts-wire'
import SLODashboardPage from '../page'

const m = vi.hoisted(() => ({ tier: 'free' as 'free' | 'enterprise', connection: 'not_connected' as string, items: [] as unknown[] }))

vi.mock('next/link', () => ({ default: ({ href, children, ...rest }: any) => <a href={href} {...rest}>{children}</a> }))
vi.mock('@/lib/hooks/use-plan', () => ({
  usePlan: () => ({ status: 'known', isKnown: true, isEnterprise: m.tier === 'enterprise', retry: async () => {} }),
}))
vi.mock('sonner', () => ({ toast: { success: vi.fn(), error: vi.fn() } }))

// An SLO the user saved, as /api/slos/evaluate answers it with no AWS account (slo-evaluation.ts).
const SAVED_SLO = {
  definition: { id: 's1', organizationId: 'org-test', name: 'Checkout API availability', resourceType: 'ec2', resourceId: 'i-1234567890abcdef0', sli: 'ec2_availability', targetValue: 99.9, evaluationWindow: '7d', enabled: true, createdAt: '2026-11-21T09:00:00.000Z', updatedAt: '2026-11-21T09:00:00.000Z' },
  evaluation: { status: 'aws_not_connected', observedValue: null, targetValue: 99.9, unit: 'percent', errorBudget: { applicable: false, allowedFailureRate: null, observedFailureRate: null, consumedFraction: null, remainingFraction: null } },
}

beforeEach(() => {
  m.tier = 'free'
  m.connection = 'not_connected'
  m.items = []
  vi.spyOn(api, 'get').mockImplementation(async (url: string) => {
    if (url === '/api/aws/accounts') return accountsResponse(m.connection as ConnectionMode) as never
    if (url === '/api/slos/evaluate') return { data: { success: true, data: m.items } } as never
    if (url.startsWith('/api/aws-resources')) return { data: { success: true, data: [], pagination: { page: 1, limit: 100, total: 0, totalPages: 0 } } } as never
    throw new Error('unexpected GET ' + url)
  })
})
afterEach(() => { vi.restoreAllMocks() })

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><SLODashboardPage /></QueryClientProvider>)
}

const PLAN_LOCK = 'Revenue Protection feature'
const tile = (label: string) => screen.getByText(label).parentElement as HTMLElement

describe('PR4c: /monitoring/slos with no AWS account connected', () => {
  it('free: title, subtitle and the card in place of the plan lock', async () => {
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(screen.getByRole('heading', { level: 1, name: 'SLO Dashboard & Management' })).toBeInTheDocument()
    expect(screen.getByText('Define and track Service Level Objectives across your infrastructure.')).toBeInTheDocument()
    expect(screen.queryByText(PLAN_LOCK)).toBeNull()
    expect(screen.queryByRole('link', { name: 'See plans' })).toBeNull()
  })

  it('Revenue Protection, no SLOs: Connect AWS account in the header; real count, "—" for what CloudWatch measures; the card; no list or invitation', async () => {
    m.tier = 'enterprise'
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    await waitFor(() => expect(api.get).toHaveBeenCalledWith('/api/slos/evaluate'))
    expect(screen.getByTestId('connect-aws-header-button')).toHaveAttribute('href', '/connect-aws')
    expect(screen.queryByRole('button', { name: /New SLO/ })).toBeNull()
    expect(tile('SLOs Defined')).toHaveTextContent('SLOs Defined0')
    for (const label of ['Healthy', 'Breached', 'Unknown / No Data']) {
      expect(tile(label).textContent).toBe(`${label}—Not measured`)
    }
    expect(tile('Breached').className).not.toMatch(/bg-red-50/)
    expect(card.previousElementSibling).toBe(tile('SLOs Defined').parentElement)
    expect(screen.queryByText(/evaluated live against CloudWatch/)).toBeNull()
    expect(screen.queryByText('No SLOs configured')).toBeNull()
    expect(screen.queryByText('Create an SLO to begin monitoring service reliability.')).toBeNull()
    expect(screen.queryByText('Service Level Objectives')).toBeNull()
  })

  it('Revenue Protection, a saved SLO: counted and listed (AWS Not Connected), without the CloudWatch line', async () => {
    m.tier = 'enterprise'
    m.items = [SAVED_SLO]
    renderPage()
    expect(await screen.findByText('Checkout API availability')).toBeInTheDocument()
    expect(screen.getByText('AWS Not Connected')).toBeInTheDocument()
    expect(tile('SLOs Defined')).toHaveTextContent('SLOs Defined1')
    expect(screen.queryByText(/evaluated live against CloudWatch/)).toBeNull()
    expect(screen.queryByRole('button', { name: /New SLO/ })).toBeNull()
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

describe('PR4c: /monitoring/slos connected is unchanged', () => {
  it('free: the plan lock (entitlement untouched), no card', async () => {
    m.connection = 'connected'
    renderPage()
    expect(await screen.findByText(PLAN_LOCK)).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
  })

  it.each(['connected', 'FAIL'])('Revenue Protection, %s: both New SLO buttons, real 0s, the CloudWatch line and the empty block; no card', async (connection) => {
    m.tier = 'enterprise'
    m.connection = connection
    renderPage()
    expect(await screen.findByText('No SLOs configured')).toBeInTheDocument()
    expect(screen.getAllByRole('button', { name: /New SLO/ })).toHaveLength(2)
    expect(screen.getByText('0 SLOs · evaluated live against CloudWatch on each load')).toBeInTheDocument()
    for (const label of ['Healthy', 'Breached', 'Unknown / No Data']) expect(tile(label)).toHaveTextContent(`${label}0`)
    expect(screen.queryByTestId('unmeasured-value')).toBeNull()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByTestId('connect-aws-header-button')).toBeNull()
  })
})
