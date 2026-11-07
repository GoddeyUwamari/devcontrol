/**
 * FP PR 2b on the Cost Optimization page:
 *   - C-1: a finding from the low-activity rule is titled "Low-activity
 *     instance"; a CPU-only "Idle Instance" row keeps its stored text;
 *   - C-3: its figure reads "Up to $X/mo if it's no longer needed", with the
 *     list-price basis line, or PR 4's S1 disclosure plus the storage sentence
 *     for a default figure; every other row's figure is unchanged;
 *   - the Hidden findings label follows the backend's issueLabel.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostOptimizationPage from '../page'
import type { HiddenFindings } from '@/lib/services/cost-recommendations.service'
import { PRODUCTION_RESOLVED_ONLY } from './fixtures'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: (selector: any) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'admin' }))

const svc = vi.hoisted(() => ({
  getAll: vi.fn(),
  getStats: vi.fn(),
  getAnalysisRuns: vi.fn(),
  getHidden: vi.fn(),
  getOptimizationRules: vi.fn(),
  getAccounts: vi.fn(),
  getDiscoveryJobs: vi.fn(),
}))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    getAll: () => svc.getAll(),
    getStats: () => svc.getStats(),
    getOptimizationRules: () => svc.getOptimizationRules(),
    getAnalysisRuns: (...args: unknown[]) => svc.getAnalysisRuns(...args),
    getHidden: () => svc.getHidden(),
    reopen: vi.fn(),
    dismiss: vi.fn(),
    resolve: vi.fn(),
    analyze: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: await svc.getAccounts(), connection: 'connected' }) } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: () => svc.getDiscoveryJobs() } }))

const STORAGE = "Doesn't include storage, which is still billed while an instance is stopped."
const S1 = "Estimate. This instance type's price is unknown, so a default of $50/mo is used."
const IDENTITY = { rule_version: 2, rule: { id: 'ec2_low_activity', version: 2 }, low_activity: { evaluated_at: '2026-11-07T06:00:00.000Z' } }
const BASIS = "estimated: compute cost from DevControl's list-price table (a default estimate for unlisted instance types); not billed cost or guaranteed savings"

function rec(id: string, overrides: Record<string, unknown> = {}) {
  return {
    id, resourceId: `i-placeholder${id}`, resourceName: null, resourceType: 'EC2', issue: 'Idle Instance',
    description: 'placeholder description', potentialSavings: 8.5, severity: 'LOW', status: 'ACTIVE', awsRegion: 'us-east-1',
    metadata: { ...IDENTITY, instance_type: 't2.micro', price_source: 'list_table', savings_basis: BASIS },
    createdAt: '2026-11-07T06:00:00.000Z', updatedAt: '2026-11-07T06:00:00.000Z', resolvedAt: null,
    ...overrides,
  }
}

const card = (resourceId: string) => screen.getByText(resourceId).closest('.rounded-xl') as HTMLElement

function hidden(issueLabel: string | undefined): HiddenFindings {
  return {
    latestRun: { id: 'run-placeholder', runState: 'completed', completedAt: '2026-11-07T06:00:00.000Z' },
    summary: { resolved: 1, dismissed: 0, stillDetected: { count: 1, estimatedMonthlySavings: 8.5, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 },
    items: [{
      id: 'decision-idle', decision: 'RESOLVED', decidedAt: '2026-09-03T18:54:05.000Z', decidedBy: null, decisionCount: 37,
      issue: 'Idle Instance', ...(issueLabel ? { issueLabel } : {}), resourceId: 'i-placeholderhidden', resourceName: null, resourceType: 'EC2', awsRegion: 'us-east-1',
      detection: { state: 'still_detected', reason: null, lastDetectedAt: '2026-11-07T06:00:00.000Z', potentialSavings: 8.5, savingsBasis: BASIS, priceSource: 'list_table', severity: 'LOW', description: 'placeholder' },
    }],
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><CostOptimizationPage /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  svc.getStats.mockResolvedValue({
    totalRecommendations: 3, activeRecommendations: 3, totalPotentialSavings: 67, potentialSavingsByResourceType: { EC2: 67 },
    potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, bySeverity: { high: 0, medium: 0, low: 3 },
  })
  svc.getAnalysisRuns.mockResolvedValue([PRODUCTION_RESOLVED_ONLY])
  svc.getHidden.mockResolvedValue(hidden(undefined))
  svc.getOptimizationRules.mockResolvedValue({ rules: [], summary: { totalRules: 0, implementedCount: 0, plannedCount: 0, services: [] } })
  svc.getAccounts.mockResolvedValue([{ id: 'account-placeholder' }])
  svc.getDiscoveryJobs.mockResolvedValue([])
  svc.getAll.mockResolvedValue([
    rec('1'),
    rec('2', { potentialSavings: 50, metadata: { ...IDENTITY, instance_type: 'x9.placeholder', price_source: 'default_unlisted_type', savings_basis: BASIS } }),
    // A CPU-only row from before PR 2b: no rule identity.
    rec('3', { metadata: { average_cpu: 3.4, instance_type: 't2.micro', price_source: 'list_table', savings_basis: BASIS } }),
  ])
})

describe('a low-activity finding row (C-1, C-3)', () => {
  it('is titled "Low-activity instance", with the "Up to" figure and the us-east-1 list-price basis', async () => {
    renderPage()
    await screen.findByText('i-placeholder1')
    const row = within(card('i-placeholder1'))
    expect(row.getByText('Low-activity instance')).toBeInTheDocument()
    expect(row.queryByText('Idle Instance')).not.toBeInTheDocument()
    expect(row.getByText("Up to $9/mo if it's no longer needed")).toBeInTheDocument()
    expect(row.getByTestId('low-activity-savings-basis')).toHaveTextContent(`Estimated from list price for t2.micro in us-east-1. ${STORAGE}`)
    expect(row.queryByTestId('default-price-disclosure')).not.toBeInTheDocument()
    expect(row.queryByText('Estimated ceiling, not an expected saving')).not.toBeInTheDocument()
  })

  it('a default figure keeps PR 4\'s S1 disclosure word for word, plus the storage sentence', async () => {
    renderPage()
    await screen.findByText('i-placeholder2')
    const row = within(card('i-placeholder2'))
    expect(row.getByText("Up to $50/mo if it's no longer needed")).toBeInTheDocument()
    expect(row.getByTestId('default-price-disclosure')).toHaveTextContent(S1)
    expect(row.getByTestId('low-activity-savings-basis')).toHaveTextContent(STORAGE)
    expect(row.getByTestId('low-activity-savings-basis').textContent).toBe(STORAGE)
  })

  it('a CPU-only "Idle Instance" row keeps its stored title and its plain figure', async () => {
    renderPage()
    await screen.findByText('i-placeholder3')
    const row = within(card('i-placeholder3'))
    expect(row.getByText('Idle Instance')).toBeInTheDocument()
    expect(row.queryByText('Low-activity instance')).not.toBeInTheDocument()
    expect(row.getByText('$9/mo')).toBeInTheDocument()
    expect(row.queryByTestId('low-activity-savings-basis')).not.toBeInTheDocument()
  })
})

describe('the Hidden findings label', () => {
  const openReview = async () => fireEvent.click(await screen.findByRole('button', { name: /Resolved and dismissed/ }))

  it('shows the backend\'s issueLabel ("Low-activity instance")', async () => {
    svc.getHidden.mockResolvedValue(hidden('Low-activity instance'))
    renderPage()
    await openReview()
    await waitFor(() => expect(screen.getAllByText('Low-activity instance').length).toBeGreaterThan(2))
  })

  it('a still-detected low-activity item\'s figure reads "Up to $X/mo if it\'s no longer needed"; a CPU-only one keeps "$X/mo"', async () => {
    svc.getAll.mockResolvedValue([])
    svc.getHidden.mockResolvedValue(hidden('Low-activity instance'))
    const first = renderPage()
    expect(await screen.findByText("Up to $9/mo if it's no longer needed")).toBeInTheDocument()
    first.unmount()

    svc.getHidden.mockResolvedValue(hidden(undefined))
    renderPage()
    await screen.findAllByText('Idle Instance')
    expect(screen.queryByText("Up to $9/mo if it's no longer needed")).not.toBeInTheDocument()
    expect(screen.getAllByText('$9/mo').length).toBeGreaterThan(0)
  })

  it('falls back to the stored issue when an older backend sends no label', async () => {
    svc.getAll.mockResolvedValue([])
    renderPage()
    await openReview()
    expect(await screen.findAllByText('Idle Instance')).not.toHaveLength(0)
    expect(screen.queryByText('Low-activity instance')).not.toBeInTheDocument()
  })
})
