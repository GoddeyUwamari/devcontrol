/**
 * C2: idle NAT gateways on Cost Optimization, with the rule catalog served
 * exactly as GET /api/cost-recommendations/optimization-rules builds it from
 * backend/src/config/optimization-rules.ts, so the coverage numbers come from
 * the registry itself: "AWS cost optimization · 12 active checks" across
 * EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway (the catalog's total is
 * never shown: scan result banner PR), the check listed and explained, the
 * data-processing check still planned.
 *
 * And the rows: an idle NAT gateway finding ($32.85) reads "$33/mo" (the page
 * shows whole dollars; an estimate, never "Up to") under the NAT Gateway chip and counts in the firm savings
 * total; one with no price for its region reads "No dollar estimate"; a run
 * where the NAT check could not check a gateway says so on the Last analysis
 * line, flags nothing, and its empty state never claims "passed all N active
 * checks" (founder ruling 2).
 * Real page and real React Query, mocked services, placeholder data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostOptimizationPage from '../page'
import type { CostRecommendation } from '@/lib/types'
import type { HiddenFindings } from '@/lib/services/cost-recommendations.service'
import { run } from './fixtures'
import {
  getImplementedOptimizationRules,
  getOptimizationRuleSummary,
  getOptimizationRules,
} from '../../../../backend/src/config/optimization-rules'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: <T,>(selector: (state: { enabled: boolean }) => T) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'member' }))

const svc = vi.hoisted(() => ({ getAll: vi.fn(), getStats: vi.fn(), getAnalysisRuns: vi.fn(), getHidden: vi.fn(), getOptimizationRules: vi.fn() }))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
    // The scan result banner: nothing waiting to be seen.
    getMyRunResult: async () => null,
    acknowledgeRunResult: async () => undefined,
    getAll: () => svc.getAll(),
    getStats: () => svc.getStats(),
    getOptimizationRules: () => svc.getOptimizationRules(),
    getAnalysisRuns: () => svc.getAnalysisRuns(),
    getHidden: () => svc.getHidden(),
    reopen: vi.fn(), dismiss: vi.fn(), resolve: vi.fn(), analyze: vi.fn(),
  },
}))
vi.mock('@/lib/services/aws-accounts.service', () => ({ default: { getAccountsAndConnection: async () => ({ accounts: [{ id: 'account-placeholder' }], connection: 'connected' }) } }))
vi.mock('@/lib/services/aws-resources.service', () => ({ awsResourcesService: { getDiscoveryJobs: async () => [] } }))

const CATALOG = { rules: getOptimizationRules().map((rule) => ({ ...rule, parameters: [] })), summary: getOptimizationRuleSummary() }
const CHECKS = getImplementedOptimizationRules().map((rule) => ({ rule_id: rule.id, issue: rule.issue as string, outcome: 'complete' as const, detected: 0, unknown: 0 }))
const AT = '2026-11-24T06:00:00.000Z'
const NAT_DETAIL = 'No connections and no traffic in either direction in any hour for 32 days; regional NAT gateways are not checked; savings estimated at the regional hourly list price'

function rec(overrides: Partial<CostRecommendation> & Record<string, unknown>): CostRecommendation {
  return { organizationId: 'org-placeholder', status: 'ACTIVE', awsRegion: 'us-east-1', createdAt: AT, updatedAt: AT, resolvedAt: null, ...overrides } as unknown as CostRecommendation
}
const NAT = rec({
  id: 'rec-nat', resourceId: 'nat-placeholder-1', resourceName: 'placeholder-nat', resourceType: 'NAT Gateway', issue: 'Idle NAT Gateway',
  description: 'In the last 32 days this NAT gateway had no connections and processed no traffic, and no route table sends traffic to it.',
  potentialSavings: 32.85, severity: 'LOW',
  metadata: { rule_version: 1, savings_basis: 'estimated: the us-east-1 NAT gateway hourly list price ($0.045/hour, 730 hours) for a gateway that is available but processed no traffic; data processing was $0; the Elastic IP is not included; not billed cost' },
})
const NAT_NO_PRICE = rec({
  id: 'rec-nat-2', resourceId: 'nat-placeholder-2', resourceName: 'nat-placeholder-2', resourceType: 'NAT Gateway', issue: 'Idle NAT Gateway', awsRegion: 'us-gov-west-1',
  description: 'Idle gateway', potentialSavings: 0, severity: 'LOW', metadata: { rule_version: 1, savings_note: 'no_price_for_region', severity_basis: 'fixed_low_unknown_price' },
})

function stats(overrides: Record<string, unknown> = {}) {
  return {
    totalRecommendations: 1, activeRecommendations: 1, totalPotentialSavings: 32.85, potentialSavingsByResourceType: { 'NAT Gateway': 32.85 },
    potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, estimatedFindings: 1, unestimatedFindings: 0,
    bySeverity: { high: 0, medium: 0, low: 1 },
    ...overrides,
  }
}
const EMPTY_STATS = stats({ totalRecommendations: 0, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {}, estimatedFindings: 0, bySeverity: { high: 0, medium: 0, low: 0 } })

function hidden(): HiddenFindings {
  return {
    latestRun: { id: 'run-placeholder', runState: 'completed', completedAt: AT },
    summary: { resolved: 0, dismissed: 0, stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 },
    items: [],
  } as unknown as HiddenFindings
}

/**
 * The empty state's icon (founder ruling 2): the neutral clock when any resource couldn't be fully checked, the
 * green all-clear tick only when nothing was unchecked. lucide-react names each svg by icon (CheckCircle2 renders
 * as lucide-circle-check), so the page needs no test id for this.
 */
function expectEmptyStateIcon(card: HTMLElement, icon: 'neutral' | 'all-clear') {
  const clock = card.querySelector('svg.lucide-clock')
  const tick = card.querySelector('svg.lucide-circle-check')
  if (icon === 'neutral') {
    expect(clock).not.toBeNull()
    expect(clock).toHaveClass('text-ink-muted')
    expect(tick).toBeNull()
    // No green icon of any kind beside "couldn't be fully checked".
    expect(card.querySelectorAll('svg.text-green-700')).toHaveLength(0)
  } else {
    expect(tick).not.toBeNull()
    expect(tick).toHaveClass('text-green-700')
    expect(clock).toBeNull()
  }
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><CostOptimizationPage /></QueryClientProvider>)
}

beforeEach(() => {
  vi.clearAllMocks()
  svc.getOptimizationRules.mockResolvedValue(CATALOG)
  svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', checks: CHECKS })])
  svc.getAll.mockResolvedValue([])
  svc.getStats.mockResolvedValue(EMPTY_STATS)
  svc.getHidden.mockResolvedValue(hidden())
})

describe('C2: coverage comes from the registry', () => {
  it('12 active checks across EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway; idle NAT gateways listed and explained; data processing still planned', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByTestId('coverage-card-line')).toHaveTextContent(/^AWS cost optimization · 12 active checks$/))
    expect(screen.getByTestId('coverage-services-line')).toHaveTextContent(/^EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway$/)
    expect(screen.getByTestId('coverage-line')).toHaveTextContent(/^12 active checks across EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway\.$/)
    expect(container.textContent).not.toMatch(/\b34\b|of 34/)
    expect(within(screen.getByTestId('coverage-services')).getAllByText(/./).map((el) => el.textContent)).toEqual(['EC2', 'EBS', 'RDS', 'S3', 'Lambda', 'DynamoDB', 'NAT Gateway'])

    const names = within(screen.getByTestId('check-names')).getAllByRole('listitem').map((li) => li.textContent)
    expect(names).toHaveLength(12)
    expect(names).toContain('Idle NAT gateways')
    expect(within(screen.getByTestId('how-checks-work')).getByText(NAT_DETAIL)).toBeInTheDocument()

    const planned = within(screen.getByTestId('planned-checks'))
    expect(planned.getByText('Planned / Coming soon (22)')).toBeInTheDocument()
    expect(planned.getByText(/NAT Gateway — Unnecessary data processing/)).toBeInTheDocument()
    expect(planned.queryByText(/Idle NAT gateways/)).not.toBeInTheDocument()

    // Every check ran and nothing was unchecked: the all-clear body is true here.
    expect(await screen.findByTestId('empty-all-checks-body')).toHaveTextContent(/^Your resources passed all 12 active checks in the last analysis\./)
    // ...and so is the green all-clear tick (no neutral clock).
    expectEmptyStateIcon(screen.getByTestId('empty-all-checks'), 'all-clear')
  })
})

describe('C2: idle NAT gateway findings on the page', () => {
  it('NAT Gateway chip, its check named, "$33/mo" as an estimate (never "Up to"), in the firm savings total', async () => {
    svc.getAll.mockResolvedValue([NAT])
    svc.getStats.mockResolvedValue(stats())
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', checks: CHECKS.map((c) => (c.rule_id === 'nat_gateway_idle' ? { ...c, detected: 1 } : c)), detected_count: 1, new_count: 1, persisted_count: 1 })])
    renderPage()
    const cards = await screen.findAllByTestId('opportunity-card')
    const card = cards.find((c) => within(c).queryByText('Idle NAT Gateway'))!
    expect(within(card).getByTestId('service-chip')).toHaveTextContent('NAT Gateway')
    expect(within(card).getByTestId('opportunity-meta')).toHaveTextContent('Idle NAT gateways')
    expect(card).toHaveTextContent('$33/mo')
    expect(card).not.toHaveTextContent('Up to')
    expect(card).not.toHaveTextContent('upper bound')
    expect(screen.queryByTestId('savings-upper-bound-only')).not.toBeInTheDocument()
    // The firm total (estimates only) on the savings card.
    await waitFor(() => expect(screen.getAllByText('$33').length).toBeGreaterThan(0))
  })

  it('no price for the region: "No dollar estimate", no figure', async () => {
    svc.getAll.mockResolvedValue([NAT_NO_PRICE])
    svc.getStats.mockResolvedValue(stats({ totalPotentialSavings: 0, potentialSavingsByResourceType: {}, estimatedFindings: 0, unestimatedFindings: 1 }))
    renderPage()
    const cards = await screen.findAllByTestId('opportunity-card')
    const card = cards.find((c) => within(c).queryByText('Idle NAT Gateway'))!
    expect(within(card).getByTestId('service-chip')).toHaveTextContent('NAT Gateway')
    expect(card).toHaveTextContent('No dollar estimate')
    expect(card).not.toHaveTextContent('$')
  })

  it('couldn\'t check: a run where the NAT check could not check a gateway flags nothing and says so', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({
      source: 'discovery',
      checks: CHECKS.map((c) => (c.rule_id === 'nat_gateway_idle' ? { ...c, unknown: 1 } : c)),
      detected_count: 0, unknown_resource_count: 1,
    })])
    renderPage()
    await waitFor(() => expect(screen.getByTestId('last-analysis-problem')).toHaveTextContent("· 1 resource couldn't be fully checked"))
    expect(screen.queryByTestId('opportunity-card')).not.toBeInTheDocument()
    // Founder ruling 2: never "passed all N active checks" when a resource couldn't be fully checked; the count is the run record's.
    const card = await screen.findByTestId('empty-all-checks')
    expect(within(card).getByTestId('empty-all-checks-body')).toHaveTextContent(/^No opportunities found in the resources DevControl could check\. 1 resource couldn't be fully checked\. DevControl runs the checks again on a schedule and lists anything new here\.$/)
    expect(card.textContent).not.toMatch(/passed all/)
    // ...and no all-clear tick beside it: the neutral clock instead (review S-1).
    expectEmptyStateIcon(card, 'neutral')
  })

  it('the unchecked count is the run record\'s, across every check (plural)', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({
      source: 'discovery',
      checks: CHECKS.map((c) => (c.rule_id === 'nat_gateway_idle' ? { ...c, unknown: 2 } : c.rule_id === 'rds_idle' ? { ...c, unknown: 1 } : c)),
      detected_count: 0, unknown_resource_count: 3,
    })])
    renderPage()
    const card = await screen.findByTestId('empty-all-checks')
    expect(within(card).getByTestId('empty-all-checks-body')).toHaveTextContent(/^No opportunities found in the resources DevControl could check\. 3 resources couldn't be fully checked\. DevControl runs the checks again on a schedule and lists anything new here\.$/)
    expectEmptyStateIcon(card, 'neutral')
  })
})
