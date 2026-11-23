/**
 * PR2 empty states, Cost Optimization: with no AWS account connected the page keeps its title, subtitle,
 * "Last analysis —", the three KPI cards, Coverage and the savings disclaimer; Open opportunities and Estimated
 * monthly savings are "—" (no severity counts); the outlined "Connect AWS account" is in the header; the top
 * "AWS not connected" notice, the Summary, opportunities, Still detected and Resolved and dismissed are gone;
 * the shared NotConnectedCard is the findings area; How DevControl checks keeps its counts without severities.
 * Connected, the page is unchanged (real zeros kept). Until the connection check answers, grey blocks only.
 * Synthetic data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostOptimizationPage from '../page'
import type { CostRecommendation } from '@/lib/types'
import { run } from './fixtures'

const toast = vi.hoisted(() => ({ error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() }))
vi.mock('sonner', () => ({ toast }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: <T,>(selector: (state: { enabled: boolean }) => T) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'member' }))

const svc = vi.hoisted(() => ({ connection: 'not_connected' as string, pending: false, stats: null as unknown, recs: [] as unknown[] }))
const RULES = {
  rules: [
    { id: 'r1', name: 'Idle EC2 instances', status: 'implemented', detail: 'd', service: 'EC2' },
    { id: 'r2', name: 'Unattached EBS volumes', status: 'implemented', detail: 'd', service: 'EBS' },
    { id: 'r3', name: 'S3 lifecycle', status: 'implemented', detail: 'd', service: 'S3' },
    { id: 'p1', name: 'RDS rightsizing', status: 'planned', detail: 'x', service: 'RDS' },
    { id: 'p2', name: 'NAT Gateway idle', status: 'planned', detail: 'x', service: 'NAT Gateway' },
  ],
  summary: {
    totalRules: 5, implementedCount: 3, plannedCount: 2,
    services: [
      { service: 'EC2', implementedCount: 1, plannedCount: 0 }, { service: 'EBS', implementedCount: 1, plannedCount: 0 },
      { service: 'S3', implementedCount: 1, plannedCount: 0 }, { service: 'RDS', implementedCount: 0, plannedCount: 1 },
      { service: 'NAT Gateway', implementedCount: 0, plannedCount: 1 },
    ],
  },
}
const stats = (o: Record<string, unknown> = {}) => ({
  totalRecommendations: 2, activeRecommendations: 2, totalPotentialSavings: 14, potentialSavingsByResourceType: {},
  potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, estimatedFindings: 2, unestimatedFindings: 0,
  bySeverity: { high: 1, medium: 0, low: 1 }, ...o,
})
const rec = (id: string): CostRecommendation => ({
  id, organizationId: 'org-placeholder', resourceId: `vol-${id}`, resourceName: null, resourceType: 'EBS', issue: 'Unattached Volume',
  description: 'Unattached', potentialSavings: 7, severity: 'LOW', status: 'ACTIVE', awsRegion: 'us-east-1',
  metadata: { savings_basis: 'estimated:list_price' }, createdAt: '2026-11-18T06:00:00.000Z', updatedAt: '2026-11-18T06:00:00.000Z', resolvedAt: null,
} as unknown as CostRecommendation)
const HIDDEN = {
  latestRun: { id: 'run-placeholder', runState: 'completed', completedAt: '2026-11-18T06:00:00.000Z' },
  summary: { resolved: 1, dismissed: 1, stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 1 },
  items: [],
}

vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: async () => svc.recs,
    getStats: async () => svc.stats,
    getOptimizationRules: async () => RULES,
    // A completed run with findings, from an earlier connection.
    getAnalysisRuns: async () => [run({ detected_count: 2, new_count: 2, persisted_count: 2 })],
    getHidden: async () => HIDDEN,
    reopen: vi.fn(), dismiss: vi.fn(), resolve: vi.fn(), analyze: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({
  default: {
    getAccountsAndConnection: () => (svc.pending
      ? new Promise(() => {})
      : Promise.resolve({ accounts: svc.connection === 'connected' ? [{ id: 'a', status: 'active' }] : [], connection: svc.connection })),
  },
}))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><CostOptimizationPage /></QueryClientProvider>)
}
const kpiCard = (label: string) => screen.getByText(label).parentElement as HTMLElement
const DISCLAIMER = /Savings figures are estimated potential savings based on DevControl.s recommendation methodology, not confirmed AWS billing savings\./

beforeEach(() => {
  svc.connection = 'not_connected'
  svc.pending = false
  svc.stats = stats()
  svc.recs = [rec('a'), rec('b')]
})

describe('PR2: Cost Optimization with no AWS account connected', () => {
  it('header: title, subtitle, "Last analysis —" and the outlined Connect AWS account (no Run cost analysis)', async () => {
    renderPage()
    const button = await screen.findByTestId('connect-aws-header-button')
    expect(button).toHaveAttribute('href', '/connect-aws')
    expect(button).toHaveTextContent('Connect AWS account')
    expect(screen.getByRole('heading', { level: 1, name: 'Cost Optimization' })).toBeInTheDocument()
    expect(screen.getByText(/DevControl identifies potential AWS cost-saving opportunities/)).toBeInTheDocument()
    expect(screen.getByTestId('last-analysis')).toHaveTextContent('Last analysis—')
    expect(screen.queryByRole('button', { name: /Run cost analysis/ })).toBeNull()
    expect(screen.queryByText('Connect AWS')).toBeNull()
  })

  it('KPI cards: Open opportunities and savings "—" without severity counts; Coverage and the disclaimer kept', async () => {
    renderPage()
    await screen.findByTestId('not-connected-card')
    await waitFor(() => expect(screen.getByTestId('coverage-card-line')).toHaveTextContent('3 of 5 checks · 3 services'))
    expect(within(kpiCard('Open opportunities')).getByTestId('unmeasured-value')).toHaveTextContent('—')
    expect(within(kpiCard('Estimated monthly savings')).getByTestId('unmeasured-value')).toHaveTextContent('—')
    expect(screen.queryByTestId('severity-chips')).toBeNull()
    expect(kpiCard('Estimated monthly savings')).not.toHaveTextContent('$14')
    expect(screen.getByText(DISCLAIMER)).toBeInTheDocument()
  })

  it('no top notice, Summary, opportunities, Resolved and dismissed; the shared card; checks header without severities', async () => {
    renderPage()
    const card = await screen.findByTestId('not-connected-card')
    expect(card.textContent).toBe('No AWS account connectedConnect AWS account')
    expect(within(card).getByRole('link', { name: 'Connect AWS account' })).toHaveAttribute('href', '/connect-aws')
    expect(screen.queryByTestId('scan-status-banner')).toBeNull()
    expect(screen.queryByText('AWS not connected')).toBeNull()
    expect(screen.queryByTestId('summary-card')).toBeNull()
    expect(screen.queryByTestId('opportunities')).toBeNull()
    expect(screen.queryByTestId('empty-state')).toBeNull()
    expect(screen.queryByText(/Resolved and dismissed/)).toBeNull()
    await waitFor(() => expect(screen.getByTestId('checks-summary-line')).toHaveTextContent(/^3 of 5 checks active · 3 services$/))
  })

  it('connection loading: grey blocks only under the title and subtitle', async () => {
    svc.pending = true
    renderPage()
    expect(await screen.findByTestId('connection-loading')).toBeInTheDocument()
    expect(screen.getByTestId('connection-loading-tiles').children).toHaveLength(3)
    expect(screen.getByTestId('header-action-loading')).toBeInTheDocument()
    expect(screen.queryByTestId('last-analysis')).toBeNull()
    expect(screen.queryByTestId('summary-cards')).toBeNull()
    expect(screen.queryByTestId('scan-status-banner')).toBeNull()
    expect(screen.queryByRole('button')).toBeNull()
    expect(screen.queryByText(DISCLAIMER)).toBeNull()
  })
})

describe('PR2: Cost Optimization connected is unchanged', () => {
  it('Run cost analysis, counts with severities, the Summary and the checks header with severities; no card', async () => {
    svc.connection = 'connected'
    renderPage()
    await waitFor(() => expect(kpiCard('Open opportunities')).toHaveTextContent('2'))
    expect(screen.getByRole('button', { name: /Run cost analysis/ })).toBeInTheDocument()
    expect(screen.getByTestId('severity-chips')).toHaveTextContent('High 1')
    await waitFor(() => expect(screen.getByTestId('summary-card')).toBeInTheDocument())
    expect(screen.getByTestId('checks-summary-line')).toHaveTextContent('3 of 5 checks active · 3 services · High 1 · Medium 0 · Low 1')
    expect(screen.getByTestId('scan-status-banner')).toBeInTheDocument()
    expect(await screen.findByText(/Resolved and dismissed/)).toBeInTheDocument()
    expect(screen.queryByTestId('not-connected-card')).toBeNull()
    expect(screen.queryByTestId('connect-aws-header-button')).toBeNull()
    expect(screen.queryByTestId('unmeasured-value')).toBeNull()
  })

  it('a real zero stays: 0 open and $0 are shown, never "—"', async () => {
    svc.connection = 'connected'
    svc.stats = stats({ activeRecommendations: 0, totalPotentialSavings: 0, estimatedFindings: 0, bySeverity: { high: 0, medium: 0, low: 0 } })
    svc.recs = []
    renderPage()
    await waitFor(() => expect(kpiCard('Open opportunities')).toHaveTextContent('0'))
    expect(kpiCard('Estimated monthly savings')).toHaveTextContent('$0')
    expect(screen.queryByTestId('unmeasured-value')).toBeNull()
  })
})
