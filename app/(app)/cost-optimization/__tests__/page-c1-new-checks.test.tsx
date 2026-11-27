/**
 * C1: the two new checks on Cost Optimization, with the rule catalog served
 * exactly as GET /api/cost-recommendations/optimization-rules builds it from
 * backend/src/config/optimization-rules.ts (getOptimizationRules +
 * getOptimizationRuleSummary), so the coverage numbers come from the registry
 * itself, never a copy: 13 active checks (C3a) across EC2 · EBS · RDS · S3 · Lambda ·
 * DynamoDB · NAT Gateway · CloudWatch since C3a (the catalog's total is never shown: scan result banner PR, ruling
 * 6), both new checks listed and explained, 21 planned.
 *
 * And the new rows: an idle RDS finding reads "No dollar estimate" under the
 * RDS chip; an old-snapshot finding ("EBS Snapshot" resource type) reads
 * "Up to $X/mo" with "upper bound" under the EBS chip (its rule's service), is
 * never in the firm savings figure, and keeps its own resource type in the
 * Still detected group. Real page and real React Query, mocked services,
 * placeholder data only.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostOptimizationPage from '../page'
import type { CostRecommendation } from '@/lib/types'
import type { HiddenFindings } from '@/lib/services/cost-recommendations.service'
import { run } from './fixtures'
import {
  OPTIMIZATION_RULES,
  OPTIMIZATION_RULE_SERVICES,
  OPTIMIZATION_RULE_SERVICE_DISPLAY_NAMES,
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
const AT = '2026-11-23T06:00:00.000Z'

function rec(overrides: Partial<CostRecommendation> & Record<string, unknown>): CostRecommendation {
  return { organizationId: 'org-placeholder', status: 'ACTIVE', awsRegion: 'us-east-1', createdAt: AT, updatedAt: AT, resolvedAt: null, ...overrides } as unknown as CostRecommendation
}
const RDS = rec({ id: 'rec-rds', resourceId: 'placeholder-db-1', resourceName: 'placeholder-db-1', resourceType: 'RDS', issue: 'Idle RDS Instance', description: 'Idle database', potentialSavings: 0, severity: 'LOW', metadata: { rule_version: 1, savings_note: 'no_price_source' } })
const SNAPSHOT = rec({ id: 'rec-snap', resourceId: 'snap-0000000000000001', resourceName: 'snap-0000000000000001', resourceType: 'EBS Snapshot', issue: 'Old EBS Snapshot', description: 'Old snapshot', potentialSavings: 25, severity: 'LOW', metadata: { rule_version: 1, savings_basis: 'ceiling: volume size x the us-east-1 EBS snapshot standard storage list price' } })

function stats(overrides: Record<string, unknown> = {}) {
  return {
    totalRecommendations: 2, activeRecommendations: 2, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
    potentialSavingsCeiling: 25, potentialSavingsCeilingByResourceType: { 'EBS Snapshot': 25 }, estimatedFindings: 0, unestimatedFindings: 1,
    bySeverity: { high: 0, medium: 0, low: 2 },
    ...overrides,
  }
}

function hidden(withSnapshot: boolean): HiddenFindings {
  const items = withSnapshot ? [{
    id: 'hidden-snap', decision: 'RESOLVED' as const, decidedAt: '2026-11-10T10:00:00.000Z', decidedBy: 'Placeholder Person', decisionCount: 1,
    issue: 'Old EBS Snapshot', resourceId: 'snap-0000000000000002', resourceName: null, resourceType: 'EBS Snapshot', awsRegion: 'us-east-1',
    detection: { state: 'still_detected' as const, reason: null, lastDetectedAt: AT, potentialSavings: 10, savingsBasis: 'ceiling: placeholder', severity: 'LOW', description: 'Old snapshot' },
  }] : []
  return {
    latestRun: { id: 'run-placeholder', runState: 'completed', completedAt: AT },
    summary: { resolved: items.length, dismissed: 0, stillDetected: { count: items.length, estimatedMonthlySavings: 0, ceilingMonthlySavings: withSnapshot ? 10 : 0, ceilingByResourceType: withSnapshot ? { 'EBS Snapshot': 10 } : {} }, notConfirmed: 0 },
    items,
  } as unknown as HiddenFindings
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
  svc.getStats.mockResolvedValue(stats({ totalRecommendations: 0, activeRecommendations: 0, potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, unestimatedFindings: 0, bySeverity: { high: 0, medium: 0, low: 0 } }))
  svc.getHidden.mockResolvedValue(hidden(false))
})

describe('C1: coverage comes from the registry', () => {
  it('13 active checks (C3a) across EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway · CloudWatch; the 34 total never shown; both C1 checks listed and explained; 21 planned; all 13 ran', async () => {
    const { container } = renderPage()
    await waitFor(() => expect(screen.getByTestId('coverage-card-line')).toHaveTextContent(/^AWS cost optimization · 13 active checks$/))
    expect(screen.getByTestId('coverage-services-line')).toHaveTextContent(/^EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway · CloudWatch$/)
    // The How DevControl checks header keeps its title and expand control only.
    expect(screen.queryByTestId('checks-summary-line')).not.toBeInTheDocument()
    expect(within(screen.getByTestId('checks-section')).getByText('How DevControl checks').closest('summary')).toHaveTextContent(/^How DevControl checks$/)
    expect(screen.getByTestId('coverage-line')).toHaveTextContent(/^13 active checks across EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway · CloudWatch\.$/)
    expect(container.textContent).not.toMatch(/\b34\b|of 34/)
    expect(screen.getByTestId('checks-count-note')).toHaveTextContent('13 active checks today — not every possible AWS cost optimization.')
    expect(within(screen.getByTestId('coverage-services')).getAllByText(/./).map((el) => el.textContent)).toEqual(['EC2', 'EBS', 'RDS', 'S3', 'Lambda', 'DynamoDB', 'NAT Gateway', 'CloudWatch'])

    const names = within(screen.getByTestId('check-names')).getAllByRole('listitem').map((li) => li.textContent)
    expect(names).toHaveLength(13)
    expect(names).toEqual(expect.arrayContaining(['Idle RDS instances', 'Old EBS snapshots']))
    const how = within(screen.getByTestId('how-checks-work'))
    expect(how.getByText("No client connections, CPU under 10% and read/write IOPS under 20 every hour for 30 days; Aurora, Multi-AZ DB cluster members, read replicas, RDS Custom and stopped databases are not checked; savings are instance hours at the region's list price, not storage or backups")).toBeInTheDocument()
    expect(how.getByText('Your own snapshots older than 180 days that no registered AMI, AWS Backup plan or Data Lifecycle Manager policy uses; locked snapshots are excluded; savings shown as an upper bound')).toBeInTheDocument()

    const planned = within(screen.getByTestId('planned-checks'))
    expect(planned.getByText('Planned / Coming soon (21)')).toBeInTheDocument()
    expect(planned.queryByText('RDS — Idle databases')).not.toBeInTheDocument()
    expect(planned.queryByText(/Idle RDS instances/)).not.toBeInTheDocument()

    expect(await screen.findByTestId('empty-all-checks')).toHaveTextContent('passed all 13 active checks')
  })

  it('computed, not stored: a new active rule adds a check and its service everywhere the page names them', async () => {
    OPTIMIZATION_RULES.push({ id: 'zz_fake_rule', service: 'ECS', name: 'Fake ECS check', detail: 'Fake', status: 'implemented', issue: 'Fake Issue' })
    try {
      svc.getOptimizationRules.mockResolvedValue({ rules: getOptimizationRules().map((rule) => ({ ...rule, parameters: [] })), summary: getOptimizationRuleSummary() })
      renderPage()
      await waitFor(() => expect(screen.getByTestId('coverage-card-line')).toHaveTextContent(/^AWS cost optimization · 14 active checks$/))
      expect(screen.getByTestId('coverage-services-line')).toHaveTextContent(/^EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway · ECS · CloudWatch$/)
      expect(screen.getByTestId('coverage-line')).toHaveTextContent(/^14 active checks across EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway · ECS · CloudWatch\.$/)
    } finally {
      OPTIMIZATION_RULES.pop()
    }
  })

  it('a new service without a display name fails: the catalog cannot be built', () => {
    const services = OPTIMIZATION_RULE_SERVICES as unknown as string[]
    services.push('Unnamed Service')
    try {
      expect(() => getOptimizationRuleSummary()).toThrow('has no display name')
      expect((OPTIMIZATION_RULE_SERVICE_DISPLAY_NAMES as Record<string, string>)['Unnamed Service']).toBeUndefined()
    } finally {
      services.pop()
    }
  })
})

describe('C1: the new findings on the page', () => {
  beforeEach(() => {
    svc.getAll.mockResolvedValue([RDS, SNAPSHOT])
    svc.getStats.mockResolvedValue(stats())
  })

  it('idle RDS (a C1 row stored before C1b: $0, no basis): RDS chip, its check named, "No dollar estimate", no C1b explanation', async () => {
    renderPage()
    const cards = await screen.findAllByTestId('opportunity-card')
    const card = cards.find((c) => within(c).queryByText('Idle RDS Instance'))!
    expect(within(card).getByTestId('service-chip')).toHaveTextContent('RDS')
    expect(within(card).getByTestId('opportunity-meta')).toHaveTextContent('Idle RDS instances')
    expect(card).toHaveTextContent('No dollar estimate')
    expect(card).not.toHaveTextContent('$')
    expect(within(card).queryByTestId('rds-idle-savings-basis')).not.toBeInTheDocument()
  })

  it('old snapshot: EBS chip (its rule\'s service), its check named, "Up to $25/mo" upper bound', async () => {
    renderPage()
    const cards = await screen.findAllByTestId('opportunity-card')
    const card = cards.find((c) => within(c).queryByText('Old EBS Snapshot'))!
    expect(within(card).getByTestId('service-chip')).toHaveTextContent('EBS')
    expect(within(card).getByTestId('opportunity-meta')).toHaveTextContent('Old EBS snapshots')
    expect(card).toHaveTextContent('Up to $25/mo')
    expect(card).toHaveTextContent('upper bound')
  })

  it('the savings card shows the snapshot figure only as an upper bound, never as a firm estimate', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('savings-upper-bound-only')).toHaveTextContent('Up to $25/mo · upper bound only'))
  })

  it('a resolved old snapshot that is still detected keeps its EBS Snapshot type in the Still detected group', async () => {
    svc.getHidden.mockResolvedValue(hidden(true))
    renderPage()
    await waitFor(() => expect(screen.getByText('snap-0000000000000002')).toBeInTheDocument())
    const row = screen.getByText('snap-0000000000000002').parentElement as HTMLElement
    expect(within(row).getByText('EBS Snapshot')).toBeInTheDocument()
  })
})
