/**
 * C1b: an idle RDS finding's instance-hour estimate on the Cost Optimization
 * card. A priced finding reads "$X/mo" (an estimate, dark) with the approved
 * explanation built from its own price key (region, class, engine,
 * deployment); a finding with no exact price reads "No dollar estimate" with no
 * explanation and no "$"; the explanation is on this card only, never on the
 * compact Still detected row; the figure is counted in the firm savings, never
 * as an upper bound. Real page and real React Query, mocked services,
 * placeholder data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostOptimizationPage from '../page'
import type { CostRecommendation } from '@/lib/types'
import type { HiddenFindings } from '@/lib/services/cost-recommendations.service'
import { run } from './fixtures'
import { getImplementedOptimizationRules, getOptimizationRuleSummary, getOptimizationRules } from '../../../../backend/src/config/optimization-rules'

vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn(), info: vi.fn(), warning: vi.fn() } }))
vi.mock('@/components/demo/demo-mode-toggle', () => ({ useDemoMode: () => false }))
vi.mock('@/lib/demo/sales-demo-data', () => ({ useSalesDemo: <T,>(selector: (state: { enabled: boolean }) => T) => selector({ enabled: false }) }))
vi.mock('@/lib/hooks/use-current-role', () => ({ useCurrentRole: () => 'member' }))

const svc = vi.hoisted(() => ({ getAll: vi.fn(), getStats: vi.fn(), getAnalysisRuns: vi.fn(), getHidden: vi.fn(), getOptimizationRules: vi.fn() }))
vi.mock('@/lib/services/cost-recommendations.service', () => ({
  costRecommendationsService: {
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
const AT = '2026-11-25T06:00:00.000Z'

const APPROVED_US_EAST_1 =
  "Estimated from the us-east-1 on-demand list price for db.t3.medium (PostgreSQL, Single-AZ), instance hours only; a reserved instance would lower the actual saving. Storage and backups are still billed while it's stopped, and AWS restarts a stopped database after 7 days."

function rec(overrides: Partial<CostRecommendation> & Record<string, unknown>): CostRecommendation {
  return { organizationId: 'org-placeholder', status: 'ACTIVE', awsRegion: 'us-east-1', resourceType: 'RDS', issue: 'Idle RDS Instance', description: 'Idle database', createdAt: AT, updatedAt: AT, resolvedAt: null, ...overrides } as unknown as CostRecommendation
}
const basis = (region: string, cls: string, engine: string, deployment: string, perHour: number) =>
  `estimated: the ${region} on-demand list price for ${cls} ${engine} ${deployment} instance hours ($${perHour}/hour, 730 hours); storage, Provisioned IOPS, backups and snapshots are not included and are still billed while the instance is stopped; no reservation or discount applied; not billed cost`

const PRICED = rec({
  id: 'rec-rds-priced', resourceId: 'placeholder-db-1', resourceName: 'placeholder-db-1', potentialSavings: 52.56, severity: 'MEDIUM',
  metadata: { rule_version: 2, savings_basis: basis('us-east-1', 'db.t3.medium', 'PostgreSQL', 'Single-AZ', 0.072), price_region: 'us-east-1', price_instance_class: 'db.t3.medium', price_engine_label: 'PostgreSQL', price_deployment: 'Single-AZ', price_per_hour: 0.072 },
})
const PRICED_MULTI = rec({
  id: 'rec-rds-multi', resourceId: 'placeholder-db-2', resourceName: 'placeholder-db-2', potentialSavings: 404.71, severity: 'HIGH', awsRegion: 'eu-west-1',
  metadata: { rule_version: 2, savings_basis: basis('eu-west-1', 'db.m5.large', 'SQL Server Web, licence included', 'Multi-AZ', 0.5544), price_region: 'eu-west-1', price_instance_class: 'db.m5.large', price_engine_label: 'SQL Server Web, licence included', price_deployment: 'Multi-AZ' },
})
const UNPRICED = rec({
  id: 'rec-rds-unpriced', resourceId: 'placeholder-db-3', resourceName: 'placeholder-db-3', potentialSavings: 0, severity: 'LOW',
  metadata: { rule_version: 2, savings_note: 'unsupported_engine_or_license', severity_basis: 'fixed_low_unknown_price', license_model: 'bring-your-own-license' },
})

function stats(overrides: Record<string, unknown> = {}) {
  return {
    totalRecommendations: 1, activeRecommendations: 1, totalPotentialSavings: 52.56, potentialSavingsByResourceType: { RDS: 52.56 },
    potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, estimatedFindings: 1, unestimatedFindings: 0,
    bySeverity: { high: 0, medium: 1, low: 0 },
    ...overrides,
  }
}

function hidden(items: unknown[] = []): HiddenFindings {
  return {
    latestRun: { id: 'run-placeholder', runState: 'completed', completedAt: AT },
    summary: { resolved: items.length, dismissed: 0, stillDetected: { count: items.length, estimatedMonthlySavings: items.length ? 52.56 : 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 },
    items,
  } as unknown as HiddenFindings
}

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={queryClient}><CostOptimizationPage /></QueryClientProvider>)
}

async function card(resourceId: string): Promise<HTMLElement> {
  const cards = await screen.findAllByTestId('opportunity-card')
  return cards.find((c) => (c.textContent ?? '').includes(resourceId))!
}

beforeEach(() => {
  vi.clearAllMocks()
  svc.getOptimizationRules.mockResolvedValue(CATALOG)
  svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', checks: CHECKS })])
  svc.getAll.mockResolvedValue([PRICED])
  svc.getStats.mockResolvedValue(stats())
  svc.getHidden.mockResolvedValue(hidden())
})

describe('C1b: a priced idle RDS card', () => {
  it('reads "$53/mo" as an estimate (dark, Medium) with the approved explanation from its own price key; no upper-bound wording', async () => {
    renderPage()
    const c = await card('placeholder-db-1')
    const savings = within(c).getByTestId('opportunity-savings')
    expect(savings.querySelector('p')).toHaveTextContent(/^\$53\/mo$/)
    expect(savings.querySelector('p')).toHaveClass('text-slate-900')
    expect(within(c).getByTestId('rds-idle-savings-basis')).toHaveTextContent(APPROVED_US_EAST_1)
    expect(within(c).getByTestId('rds-idle-savings-basis').textContent).toBe(APPROVED_US_EAST_1)
    expect(c).toHaveTextContent('Medium')
    expect(c).not.toHaveTextContent(/upper bound|Up to/)
    expect(c).not.toHaveTextContent('No dollar estimate')
  })

  it('Multi-AZ, another region and a licence-included engine: the explanation names exactly that key', async () => {
    svc.getAll.mockResolvedValue([PRICED_MULTI])
    svc.getStats.mockResolvedValue(stats({ totalPotentialSavings: 404.71, potentialSavingsByResourceType: { RDS: 404.71 }, bySeverity: { high: 1, medium: 0, low: 0 } }))
    renderPage()
    const c = await card('placeholder-db-2')
    expect(within(c).getByTestId('opportunity-savings').querySelector('p')).toHaveTextContent(/^\$405\/mo$/)
    expect(within(c).getByTestId('rds-idle-savings-basis').textContent).toBe(
      "Estimated from the eu-west-1 on-demand list price for db.m5.large (SQL Server Web, licence included, Multi-AZ), instance hours only; a reserved instance would lower the actual saving. Storage and backups are still billed while it's stopped, and AWS restarts a stopped database after 7 days."
    )
    expect(c).toHaveTextContent('High')
  })

  it('the estimate is in the firm savings figure and the summary, never as an upper bound', async () => {
    renderPage()
    await card('placeholder-db-1')
    expect(document.body).toHaveTextContent('$53/mo in firm estimates.')
    expect(screen.queryByTestId('savings-upper-bound-only')).not.toBeInTheDocument()
  })
})

describe('C1b: an idle RDS card with no exact price', () => {
  it('reads "No dollar estimate": no "$", no explanation, Low', async () => {
    svc.getAll.mockResolvedValue([UNPRICED])
    svc.getStats.mockResolvedValue(stats({ totalPotentialSavings: 0, potentialSavingsByResourceType: {}, estimatedFindings: 0, unestimatedFindings: 1, bySeverity: { high: 0, medium: 0, low: 1 } }))
    renderPage()
    const c = await card('placeholder-db-3')
    expect(within(c).getByTestId('opportunity-savings')).toHaveTextContent(/^No dollar estimate$/)
    expect(c).not.toHaveTextContent('$')
    expect(within(c).queryByTestId('rds-idle-savings-basis')).not.toBeInTheDocument()
    expect(c).toHaveTextContent('Low')
  })

  it('priced and unpriced side by side: only the priced card carries the explanation', async () => {
    svc.getAll.mockResolvedValue([PRICED, UNPRICED])
    svc.getStats.mockResolvedValue(stats({ activeRecommendations: 2, totalRecommendations: 2, unestimatedFindings: 1, bySeverity: { high: 0, medium: 1, low: 1 } }))
    renderPage()
    expect(within(await card('placeholder-db-1')).getByTestId('rds-idle-savings-basis')).toBeInTheDocument()
    expect(within(await card('placeholder-db-3')).queryByTestId('rds-idle-savings-basis')).not.toBeInTheDocument()
    expect(screen.getAllByTestId('rds-idle-savings-basis')).toHaveLength(1)
  })
})

describe('C1b: compact rows stay "$X/mo"', () => {
  it('a still-detected priced idle RDS finding in the Hidden section shows its figure without the explanation', async () => {
    svc.getAll.mockResolvedValue([])
    svc.getStats.mockResolvedValue(stats({ totalRecommendations: 1, activeRecommendations: 0, totalPotentialSavings: 0, potentialSavingsByResourceType: {}, estimatedFindings: 0, bySeverity: { high: 0, medium: 0, low: 0 } }))
    svc.getHidden.mockResolvedValue(hidden([{
      id: 'hidden-rds', decision: 'RESOLVED', decidedAt: '2026-11-20T10:00:00.000Z', decidedBy: 'Placeholder Person', decisionCount: 1,
      issue: 'Idle RDS Instance', issueLabel: 'Idle RDS Instance', resourceId: 'placeholder-db-9', resourceName: null, resourceType: 'RDS', awsRegion: 'us-east-1',
      detection: { state: 'still_detected', reason: null, lastDetectedAt: AT, potentialSavings: 52.56, savingsBasis: basis('us-east-1', 'db.t3.medium', 'PostgreSQL', 'Single-AZ', 0.072), severity: 'MEDIUM', description: 'Idle database' },
    }]))
    renderPage()
    const row = (await screen.findAllByText('placeholder-db-9'))[0].closest('li, article, div[data-testid]') as HTMLElement
    expect(document.body).toHaveTextContent('$53/mo')
    expect(screen.queryByTestId('rds-idle-savings-basis')).not.toBeInTheDocument()
    expect(row.textContent).not.toMatch(/Estimated from the|instance hours only/)
  })
})
