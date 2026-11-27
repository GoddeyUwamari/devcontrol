/**
 * C3a: unused CloudWatch log groups on Cost Optimization, with the rule catalog served exactly as
 * GET /api/cost-recommendations/optimization-rules builds it from backend/src/config/optimization-rules.ts, so
 * the coverage numbers come from the registry itself: "AWS cost optimization · 13 active checks" with
 * CloudWatch among the services, the check listed and explained, log retention still planned (until C3b).
 *
 * The rows: an unused log group finding reads "No dollar estimate" (grey) under the CloudWatch chip, Low, with
 * the approved description and its AWS-reported size (founder rulings D3, D4, D11). The Summary card collapses
 * the log groups below the stored-size floor into one line, and names the ones skipped for a long name
 * (rulings D3, D10), from the latest run's own record. Every size shown, the floor included, comes from the
 * backend's one conversion (binding condition 2), and no C3 string shows a dollar amount (binding condition 1).
 * A small account (synthetic figures: 5 groups, about 12 MB in all): no finding, only the summary line.
 * Real page and real React Query, mocked services, placeholder data only (no real names, IDs or ARNs).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import CostOptimizationPage from '../page'
import type { CostRecommendation } from '@/lib/types'
import type { HiddenFindings } from '@/lib/services/cost-recommendations.service'
import { run } from './fixtures'
import { logGroupSummaryLines } from '../logGroupSummary'
import { logGroupsBelowFloor, logGroupsNameTooLong } from '../costOptimizationCopy'
import {
  getImplementedOptimizationRules,
  getOptimizationRuleSummary,
  getOptimizationRules,
} from '../../../../backend/src/config/optimization-rules'
import { BYTES_PER_GB, CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES, CLOUDWATCH_LOGS_UNUSED_FLOOR_GB, formatStoredGb } from '../../../../backend/src/config/cloudwatch-logs-size'
import { emptyCloudWatchLogsUnusedCounts, logGroupUnusedDescription } from '../../../../backend/src/services/cloudwatch-logs-unused-evaluation'

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
const AT = '2026-11-26T06:00:00.000Z'
const DETAIL = 'No new log events for 90 days, confirmed by the newest log stream, in a log group at least 90 days old that stores about 35.7 GB or more; no dollar estimate'

/** The latest run's checks with the unused log group check carrying `counts` (the backend's own shape). */
function checksWith(counts: object, overrides: Record<string, unknown> = {}) {
  return CHECKS.map((c) => (c.rule_id === 'cloudwatch_unused_logs' ? { ...c, ...overrides, cloudwatch_logs_unused: counts } : c))
}
function belowFloorCounts(count: number, storedBytes: number, nameTooLong = 0) {
  const counts = emptyCloudWatchLogsUnusedCounts()
  counts.evaluated = count + nameTooLong
  counts.below_floor.count = count
  counts.below_floor.stored_bytes = storedBytes
  counts.skipped.name_too_long = nameTooLong
  return counts
}

function rec(overrides: Partial<CostRecommendation> & Record<string, unknown>): CostRecommendation {
  return { organizationId: 'org-placeholder', status: 'ACTIVE', awsRegion: 'us-east-1', createdAt: AT, updatedAt: AT, resolvedAt: null, ...overrides } as unknown as CostRecommendation
}
const STORED = 100 * BYTES_PER_GB
const UNUSED = rec({
  id: 'rec-logs', resourceId: '/placeholder/app-unused', resourceName: '/placeholder/app-unused', resourceType: 'CloudWatch', issue: 'Unused Log Group',
  // The backend's own description builder: the card shows exactly what the detector writes.
  description: logGroupUnusedDescription({ storedBytes: STORED, neverExpire: true, deletionProtection: false }),
  potentialSavings: 0, severity: 'LOW',
  metadata: { rule_version: 1, savings_note: 'stored_size_billing_basis_unconfirmed', severity_basis: 'fixed_low_unknown_price', cloudwatch_logs_unused: { stored_bytes: STORED, stored_gb: formatStoredGb(STORED) } },
})

function stats(overrides: Record<string, unknown> = {}) {
  return {
    totalRecommendations: 1, activeRecommendations: 1, totalPotentialSavings: 0, potentialSavingsByResourceType: {},
    potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, estimatedFindings: 0, unestimatedFindings: 1,
    bySeverity: { high: 0, medium: 0, low: 1 },
    ...overrides,
  }
}
const EMPTY_STATS = stats({ totalRecommendations: 0, activeRecommendations: 0, unestimatedFindings: 0, bySeverity: { high: 0, medium: 0, low: 0 } })

function hidden(): HiddenFindings {
  return {
    latestRun: { id: 'run-placeholder', runState: 'completed', completedAt: AT },
    summary: { resolved: 0, dismissed: 0, stillDetected: { count: 0, estimatedMonthlySavings: 0, ceilingMonthlySavings: 0, ceilingByResourceType: {} }, notConfirmed: 0 },
    items: [],
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
  svc.getStats.mockResolvedValue(EMPTY_STATS)
  svc.getHidden.mockResolvedValue(hidden())
})

const summaryItems = () => within(screen.getByTestId('summary-lines')).getAllByRole('listitem').map((li) => li.textContent)

describe('C3a: coverage comes from the registry', () => {
  it('13 active checks across EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway · CloudWatch; unused log groups listed and explained; log retention still planned', async () => {
    renderPage()
    await waitFor(() => expect(screen.getByTestId('coverage-card-line')).toHaveTextContent(/^AWS cost optimization · 13 active checks$/))
    expect(screen.getByTestId('coverage-services-line')).toHaveTextContent(/^EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway · CloudWatch$/)
    expect(screen.getByTestId('coverage-line')).toHaveTextContent(/^13 active checks across EC2 · EBS · RDS · S3 · Lambda · DynamoDB · NAT Gateway · CloudWatch\.$/)
    const names = within(screen.getByTestId('check-names')).getAllByRole('listitem').map((li) => li.textContent)
    expect(names).toHaveLength(13)
    expect(names).toContain('Unused log groups')
    expect(within(screen.getByTestId('how-checks-work')).getByText(DETAIL)).toBeInTheDocument()
    const planned = within(screen.getByTestId('planned-checks'))
    expect(planned.getByText('Planned / Coming soon (21)')).toBeInTheDocument()
    expect(planned.getByText(/CloudWatch — Excessive log retention/)).toBeInTheDocument()
    expect(planned.queryByText(/Unused log groups/)).not.toBeInTheDocument()
  })
})

describe('C3a: an unused log group finding on the page', () => {
  it('CloudWatch chip, Low, its check named, grey "No dollar estimate", the approved description; no dollar amount anywhere on the card', async () => {
    svc.getAll.mockResolvedValue([UNUSED])
    svc.getStats.mockResolvedValue(stats())
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', checks: checksWith(emptyCloudWatchLogsUnusedCounts(), { detected: 1 }), detected_count: 1, new_count: 1, persisted_count: 1 })])
    renderPage()
    const cards = await screen.findAllByTestId('opportunity-card')
    const card = cards.find((c) => within(c).queryByText('Unused Log Group'))!
    expect(within(card).getByTestId('service-chip')).toHaveTextContent('CloudWatch')
    expect(within(card).getByTestId('opportunity-meta')).toHaveTextContent('Unused log groups')
    expect(card).toHaveTextContent(/low/i)
    const figure = within(card).getByTestId('opportunity-savings')
    expect(figure).toHaveTextContent(/^No dollar estimate$/)
    expect(figure.querySelector('p')).toHaveClass('text-ink-muted')
    expect(card).toHaveTextContent(
      'No new log events reached this log group in the last 90 days, and its newest log stream was last written before then. ' +
      'AWS reports that it still stores 100.0 GB. Check that nothing writes to it only rarely, such as a yearly job or a recovery runbook. ' +
      'If you might need its contents, export them to Amazon S3 before deleting it. It is set to keep logs forever.'
    )
    expect(card.textContent).not.toMatch(/\$/)
  })
})

describe('C3a: the below-floor summary line (rulings D3, D10)', () => {
  it('a small account (synthetic: 5 groups, about 12 MB in all): no finding, and one summary line for the groups below the floor', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', checks: checksWith(belowFloorCounts(5, 12_347_726)) })])
    renderPage()
    await waitFor(() => expect(summaryItems()).toContain("5 CloudWatch log groups each store less than about 35.7 GB, so they aren't listed."))
    expect(screen.queryByTestId('opportunity-card')).not.toBeInTheDocument()
    // Exactly one line for them, however many groups.
    expect(summaryItems().filter((line) => line?.includes('CloudWatch log group'))).toHaveLength(1)
    expect(await screen.findByTestId('empty-all-checks')).toBeInTheDocument()
  })

  it('one group: singular wording', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', checks: checksWith(belowFloorCounts(1, 4_096)) })])
    renderPage()
    await waitFor(() => expect(summaryItems()).toContain("1 CloudWatch log group stores less than about 35.7 GB, so it isn't listed."))
  })

  it('names over 255 characters: counted on their own line (ruling D10)', async () => {
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', checks: checksWith(belowFloorCounts(0, 0, 2), { unknown: 2 }), unknown_resource_count: 2 })])
    renderPage()
    await waitFor(() => expect(summaryItems()).toContain("2 CloudWatch log groups weren't checked because their names are longer than 255 characters."))
    expect(summaryItems().some((line) => line?.includes('less than about'))).toBe(false)
  })

  it('one name over 255 characters: the exact singular line (review N-2)', async () => {
    expect(logGroupSummaryLines(checksWith(belowFloorCounts(0, 0, 1)))).toEqual([
      "1 CloudWatch log group wasn't checked because its name is longer than 255 characters.",
    ])
    svc.getAnalysisRuns.mockResolvedValue([run({ source: 'discovery', checks: checksWith(belowFloorCounts(0, 0, 1), { unknown: 1 }), unknown_resource_count: 1 })])
    renderPage()
    await waitFor(() => expect(summaryItems()).toContain("1 CloudWatch log group wasn't checked because its name is longer than 255 characters."))
  })

  it('no below-floor groups, a failed check, or a run without the counts: no line (never a guessed 0)', () => {
    expect(logGroupSummaryLines(checksWith(belowFloorCounts(0, 0)))).toEqual([])
    expect(logGroupSummaryLines(checksWith(belowFloorCounts(3, 10), { outcome: 'failed' }))).toEqual([])
    expect(logGroupSummaryLines(CHECKS)).toEqual([])
    expect(logGroupSummaryLines(null)).toEqual([])
    expect(logGroupSummaryLines(checksWith({ below_floor: { count: 3, floor_gb: 35.7 } }))).toEqual([])
    expect(logGroupSummaryLines(checksWith({ below_floor: { count: '3', floor_gb: '35.7' } }))).toEqual([])
    expect(logGroupSummaryLines(checksWith({ below_floor: { count: 3, floor_gb: '$1' } }))).toEqual([])
  })
})

describe('C3a: one conversion for the floor and every displayed size (binding condition 2)', () => {
  it('the summary line, the catalog detail and the card all show the floor as the backend formats it', () => {
    expect(CLOUDWATCH_LOGS_UNUSED_FLOOR_GB).toBe(formatStoredGb(CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES))
    const [line] = logGroupSummaryLines(checksWith(belowFloorCounts(4, 400)))
    expect(line).toContain(`about ${CLOUDWATCH_LOGS_UNUSED_FLOOR_GB} GB`)
    expect(getOptimizationRules().find((r) => r.id === 'cloudwatch_unused_logs')!.detail).toContain(`about ${CLOUDWATCH_LOGS_UNUSED_FLOOR_GB} GB or more`)
    // A group exactly at the floor is listed with the floor's own display.
    expect(logGroupUnusedDescription({ storedBytes: CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES, neverExpire: false, deletionProtection: false }))
      .toContain(`stores ${CLOUDWATCH_LOGS_UNUSED_FLOOR_GB} GB.`)
  })

  it('this page never converts stored bytes itself', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    for (const file of ['../logGroupSummary.ts', '../costOptimizationCopy.ts']) {
      const source = readFileSync(join(__dirname, file), 'utf-8')
      expect({ file, ok: !/1024|1073741824|2\s*\*\*\s*30|stored_bytes/.test(source) }).toEqual({ file, ok: true })
    }
  })
})

describe('C3a: no dollar amount in any C3 customer-facing string (binding condition 1)', () => {
  it('summary lines, catalog name and detail, issue name, homepage row', async () => {
    const { readFileSync } = await import('fs')
    const { join } = await import('path')
    const hero = readFileSync(join(__dirname, '../../../../components/landing/HeroSection.tsx'), 'utf-8')
    const row = hero.match(/\{ group: 'Observability', items: '([^']*)' \}/)
    expect(row).not.toBeNull()
    const strings = [
      logGroupsBelowFloor(1, CLOUDWATCH_LOGS_UNUSED_FLOOR_GB), logGroupsBelowFloor(12, CLOUDWATCH_LOGS_UNUSED_FLOOR_GB),
      logGroupsNameTooLong(1), logGroupsNameTooLong(3),
      ...getOptimizationRules().filter((r) => r.service === 'CloudWatch').flatMap((r) => [r.name, r.detail]),
      'Unused Log Group', 'Observability', row![1],
    ]
    for (const s of strings) expect({ s, ok: !/\$|\bUSD\b|dollar(?! estimate)|per month|\/mo\b/i.test(s) }).toEqual({ s, ok: true })
  })
})
