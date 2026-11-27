/**
 * Cost Intelligence PR A rules (cost-intelligence.ts): the one day window
 * (safeguard 1), cost drivers by AWS service, the savings tile (ruling Q2),
 * the checks tile from the catalog (never constants), the Last analysis parts
 * (ruling Q6) and the "What this page covers" rows (spec item 12).
 * All figures, names and IDs are test fixtures, not production data.
 */
import { describe, expect, it } from 'vitest'
import type { CostAnalysisRun, OptimizationRuleCatalog } from '@/lib/services/cost-recommendations.service'
import type { CostScanState } from '../../cost-optimization/costScanState'
import {
  activeChecks, costDrivers, coverageRows, describeSavingsTile, displayedAmount, formatDriverAmount, lastAnalysisParts, rankByDisplayedSavings, runFoundCount,
  trendWindow, windowDatesLabel, type CostTrendPointView, type CoverageInput,
} from '../cost-intelligence'
import { costsTrendChartData } from '../trend-chart-data'

const day = (date: string, services: Record<string, number>, reportState: CostTrendPointView['reportState'] = 'final'): CostTrendPointView => {
  const total = Object.values(services).reduce((s, v) => s + v, 0)
  return {
    date, compute: total, storage: 0, database: 0, network: 0, other: 0, total, lineItems: Object.keys(services).length, reportState,
    byServiceDisplay: Object.entries(services).map(([service, amount]) => ({ service, amount, color: `#${service.length}0${service.length}0${service.length}0` })),
  }
}

/** 31 points like the backend's 30d response (Oct 27 .. Nov 26): the first day is outside the 30-day window. */
const THIRTY_ONE = Array.from({ length: 31 }, (_, i) => {
  const d = new Date(Date.UTC(2026, 9, 27 + i)).toISOString().slice(0, 10)
  return i === 0 ? day(d, { Redshift: 1000 }) : day(d, { EC2: 0.4, VPC: 0.12, S3: 0.0004, Other: 0.05 }, i === 30 ? 'updating' : 'final')
})

describe('safeguard 1: one day window for the chart, the donut and its label', () => {
  it('the 30-day window is the last 30 of the 31 points, and its dates say so', () => {
    const window = trendWindow(THIRTY_ONE, 30)
    expect(window).toHaveLength(30)
    expect(windowDatesLabel(window)).toBe('Oct 28 – Nov 26 (UTC)')
  })

  it('the chart rows and the donut come from the same window: same day count, same first and last day', () => {
    const window = trendWindow(THIRTY_ONE, 30)
    const chart = costsTrendChartData(window)
    const drivers = costDrivers(window)!
    expect(chart).toHaveLength(drivers.days)
    expect(`${chart[0].date} – ${chart[chart.length - 1].date} (UTC)`).toBe(drivers.dates)
    // The day outside the window (a $1,000 Redshift day) is in neither.
    expect(drivers.slices.map((s) => s.service)).not.toContain('Redshift')
    expect(drivers.total).toBeCloseTo(30 * 0.5704, 6)
  })
})

describe('cost drivers by AWS service (ruling Q4)', () => {
  it('largest first, "Other" last, nothing at $0, total = sum of its own slices', () => {
    const drivers = costDrivers([day('2026-11-01', { S3: 2, EC2: 5, Other: 9, RDS: 0 })])!
    expect(drivers.slices.map((s) => s.service)).toEqual(['EC2', 'S3', 'Other'])
    expect(drivers.total).toBe(16)
    expect(drivers.slices.reduce((s, x) => s + x.amount, 0)).toBe(drivers.total)
  })

  it('not-reported days add nothing; an updating day is flagged as "so far"', () => {
    const drivers = costDrivers([day('2026-11-25', { EC2: 1 }, 'updating'), { ...day('2026-11-26', {}), lineItems: 0, reportState: 'not_reported', byServiceDisplay: undefined }])!
    expect(drivers.total).toBe(1)
    expect(drivers.includesUpdating).toBe(true)
  })

  it('a reported day with no per-service breakdown: no donut (null), never a guess', () => {
    expect(costDrivers([{ ...day('2026-11-01', { EC2: 1 }), byServiceDisplay: undefined }])).toBeNull()
    expect(costDrivers([])).toBeNull()
  })

  it('a positive sub-cent amount reads "<$0.01", never "$0.00"', () => {
    expect(formatDriverAmount(0.0004)).toBe('<$0.01')
    expect(formatDriverAmount(0.12)).toBe('$0.12')
  })
})

const stats = (over: Partial<Parameters<typeof describeSavingsTile>[0]>) => ({
  totalPotentialSavings: 0, estimatedFindings: 0, potentialSavingsCeiling: 0, potentialSavingsCeilingByResourceType: {}, activeRecommendations: 0, ...over,
})

describe('savings tile (ruling Q2): never "$0/mo"', () => {
  it('upper bounds only: grey "Up to $0.01/mo · upper bound only"', () => {
    const tile = describeSavingsTile(stats({ potentialSavingsCeiling: 0.01, potentialSavingsCeilingByResourceType: { 'EBS Snapshot': 0.01 }, activeRecommendations: 1 }))
    expect(tile).toEqual({ kind: 'upper_bound_only', value: 'Up to $0.01/mo · upper bound only', lines: ['No firm estimate yet.'] })
  })

  it('firm + upper bound: shown apart, never added together', () => {
    const tile = describeSavingsTile(stats({ totalPotentialSavings: 52.4, estimatedFindings: 2, potentialSavingsCeiling: 41, potentialSavingsCeilingByResourceType: { S3: 41 }, activeRecommendations: 3 }))
    expect(tile.kind).toBe('firm')
    expect(tile.value).toBe('$52/mo')
    expect(tile.lines).toEqual(['Plus up to $41/mo if S3 data qualifies for Standard-IA (upper bound, not included above)'])
    expect(tile.kind === 'firm' && tile.strong).toBe(true)
  })

  it('a firm figure under $1/mo is not strong (grey); at $1 it is', () => {
    const small = describeSavingsTile(stats({ totalPotentialSavings: 0.96, estimatedFindings: 1, activeRecommendations: 1 }))
    expect(small).toMatchObject({ kind: 'firm', value: '$0.96/mo', strong: false })
    expect(describeSavingsTile(stats({ totalPotentialSavings: 1, estimatedFindings: 1, activeRecommendations: 1 }))).toMatchObject({ strong: true })
  })

  it('N-3: green is decided on the displayed figure ($0.994 / $0.995 show "$0.99", $0.996 shows "$1.00", $1.00 shows "$1")', () => {
    const tile = (amount: number) => describeSavingsTile(stats({ totalPotentialSavings: amount, estimatedFindings: 1, activeRecommendations: 1 }))
    expect(tile(0.994)).toMatchObject({ value: '$0.99/mo', strong: false })
    expect(tile(0.995)).toMatchObject({ value: '$0.99/mo', strong: false })
    expect(tile(0.996)).toMatchObject({ value: '$1.00/mo', strong: true })
    expect(tile(1.0)).toMatchObject({ value: '$1/mo', strong: true })
    expect([displayedAmount('<$0.01'), displayedAmount('$1,204'), displayedAmount('$0.99')]).toEqual([0, 1204, 0.99])
  })

  it('N-4: a partial run with nothing open: "None found in the checks that ran"', () => {
    expect(describeSavingsTile(stats({}), { partialRun: true })).toEqual({ kind: 'none_found', value: 'None found in the checks that ran', lines: ["Some checks couldn't run in the latest analysis"] })
    // Only "none found" changes: figures and "No dollar estimate" are the same after a partial run.
    expect(describeSavingsTile(stats({ activeRecommendations: 2 }), { partialRun: true }).value).toBe('No dollar estimate')
  })

  it('positive estimates that round to $0: "<$0.01/mo", never "$0/mo"', () => {
    expect(describeSavingsTile(stats({ totalPotentialSavings: 0, estimatedFindings: 2, activeRecommendations: 2 })).value).toBe('<$0.01/mo')
  })

  it('open findings with no figure, and a clean completed analysis: words, never "$0/mo"', () => {
    expect(describeSavingsTile(stats({ activeRecommendations: 2 }))).toMatchObject({ kind: 'no_estimate', value: 'No dollar estimate' })
    expect(describeSavingsTile(stats({}))).toMatchObject({ kind: 'none_found', value: 'None found' })
    for (const s of [stats({}), stats({ activeRecommendations: 2 }), stats({ potentialSavingsCeiling: 0.01, activeRecommendations: 1 })]) {
      expect(describeSavingsTile(s).value).not.toMatch(/\$0\/mo|\$0\.00/)
    }
  })
})

/** A catalog fixture: the counts and names come from here, so a change here must change the tile. */
function catalog(services: { service: string; displayName: string; implemented: number; planned: number }[]): OptimizationRuleCatalog {
  const rules = services.flatMap(({ service, implemented, planned }) => [
    ...Array.from({ length: implemented }, (_, i) => ({ id: `${service.toLowerCase().replace(/\s/g, '_')}_${i}`, service, name: `${service} ${i}`, detail: '', status: 'implemented' as const, issue: `${service} issue ${i}`, configurable: false, parameters: [] })),
    ...Array.from({ length: planned }, (_, i) => ({ id: `${service.toLowerCase().replace(/\s/g, '_')}_p${i}`, service, name: `${service} p${i}`, detail: '', status: 'planned' as const, configurable: false, parameters: [] })),
  ])
  return {
    rules,
    summary: {
      totalRules: rules.length,
      implementedCount: services.reduce((s, x) => s + x.implemented, 0),
      plannedCount: services.reduce((s, x) => s + x.planned, 0),
      services: services.map((s) => ({ service: s.service, displayName: s.displayName, implementedCount: s.implemented, plannedCount: s.planned, totalCount: s.implemented + s.planned })),
    },
  }
}

describe('N-7: opportunities rank by the displayed figure', () => {
  const r = (id: string, potentialSavings: number, basis?: string) => ({ id, potentialSavings, metadata: basis ? { savings_basis: basis } : {} })
  it('"Up to $41/mo" before "$0.02/mo"; firm wins a displayed tie; no-figure findings last, in their order', () => {
    const ranked = rankByDisplayedSavings([
      r('lambda', 0.02, 'estimated: x'), r('none-a', 0), r('s3', 41.4, 'ceiling: x'), r('none-b', 5), r('ebs', 41.2, 'estimated: x'), r('big-ceiling', 120, 'ceiling: x'),
    ])
    expect(ranked.map((x) => x.id)).toEqual(['big-ceiling', 'ebs', 's3', 'lambda', 'none-a', 'none-b'])
  })
})

describe('checks tile: from the active catalog, planned excluded, never constants', () => {
  it('counts and names follow the catalog it is given', () => {
    const a = activeChecks(catalog([
      { service: 'EC2', displayName: 'EC2', implemented: 2, planned: 1 },
      { service: 'NAT Gateway', displayName: 'NAT Gateway', implemented: 1, planned: 0 },
      { service: 'EKS', displayName: 'EKS', implemented: 0, planned: 2 },
    ]))
    expect(a).toEqual({ count: 3, services: ['EC2', 'NAT Gateway'], plannedCount: 3 })
    const b = activeChecks(catalog([{ service: 'Lambda', displayName: 'Lambda', implemented: 5, planned: 0 }]))
    expect(b).toEqual({ count: 5, services: ['Lambda'], plannedCount: 0 })
  })

  it('no catalog yet (or an empty one): null, so the tile shows "—"', () => {
    expect(activeChecks(undefined)).toBeNull()
    expect(activeChecks(catalog([]))).toBeNull()
  })
})

const run = (over: Partial<CostAnalysisRun> = {}): CostAnalysisRun => ({
  id: 'run-1', status: 'completed', run_state: 'completed', source: 'discovery', recommendations_found: null, total_potential_savings: null,
  started_at: '2026-11-26T06:00:00.000Z', completed_at: '2026-11-26T06:05:00.000Z', created_at: '2026-11-26T06:00:00.000Z', error_message: null,
  new_count: 1, refreshed_count: 2, persisted_count: 3, detected_count: 4, suppressed_resolved_count: 1, suppressed_dismissed_count: 0, unknown_resource_count: 0,
  checks: [
    { rule_id: 'ec2_0', issue: 'EC2 issue 0', outcome: 'complete', detected: 2, unknown: 0 },
    { rule_id: 'nat_gateway_0', issue: 'NAT Gateway issue 0', outcome: 'complete', detected: 1, unknown: 0 },
    { rule_id: 'ec2_1', issue: 'EC2 issue 1', outcome: 'failed', detected: 0, unknown: 0, failure_reason: 'permissions' },
  ],
  ...over,
})
const scanOf = (key: CostScanState['key'], uncheckedResources: number | null = 0): CostScanState => ({ key, source: 'scheduled', completedAt: '2026-11-26T06:05:00.000Z', errorMessage: null, counts: null, failedChecks: null, uncheckedResources })

describe('Last analysis parts (spec item 7, ruling Q6)', () => {
  it('"N of M checks ran · K found" from the run\'s own record; K = new + refreshed', () => {
    expect(lastAnalysisParts(scanOf('partial'), run())).toEqual(['2 of 3 checks ran', '3 found'])
    expect(runFoundCount(run({ new_count: 0, refreshed_count: 0 }))).toBe(0)
  })

  it('a count the run did not record is left out, never shown as 0', () => {
    expect(lastAnalysisParts(scanOf('completed_open'), run({ new_count: null, checks: null }))).toEqual([])
  })

  it('failed or interrupted: "didn\'t finish" only; resources not fully checked are named', () => {
    expect(lastAnalysisParts(scanOf('failed'), run())).toEqual(["didn't finish"])
    expect(lastAnalysisParts(scanOf('completed_other', 4), run({ unknown_resource_count: 4 }))).toContain("4 resources couldn't be fully checked")
  })
})

const CATALOG = catalog([
  { service: 'EC2', displayName: 'EC2', implemented: 2, planned: 1 },
  { service: 'NAT Gateway', displayName: 'NAT Gateway', implemented: 1, planned: 1 },
])
const spendSection = (over: object = {}) => ({
  state: 'available' as const, source: 'AWS Cost Explorer', provenance: 'actual' as const, asOf: null, coverage: null, reason: null,
  data: { amount: 16.91, basis: 'billed_month_to_date' as const, lastDayInProgress: false, monthState: { state: 'month_to_date' } }, ...over,
}) as unknown as CoverageInput['spend']['section']

function input(over: Partial<CoverageInput> = {}): CoverageInput {
  return {
    spend: { section: spendSection(), isLoading: false, isError: false },
    trend: { isLoading: false, isError: false },
    scan: scanOf('completed_open'),
    runs: [run({ checks: run().checks!.map((c) => ({ ...c, outcome: 'complete' as const, failure_reason: undefined })) })],
    catalog: { data: CATALOG, isError: false },
    coverage: { homeRegion: 'xx-test-1', multiRegion: null, isLoading: false, isError: false },
    ...over,
  }
}
const row = (rows: ReturnType<typeof coverageRows>, id: string) => rows.find((r) => r.id === id)!

describe('What this page covers (spec item 12): real signals, never the whole account', () => {
  it('every check ran, nothing unchecked: Cost checks "checked", with the services that ran', () => {
    const rows = coverageRows(input())
    expect(row(rows, 'checks')).toMatchObject({ status: 'checked', detail: '3 of 3 checks ran across EC2 · NAT Gateway.' })
    expect(row(rows, 'spend').status).toBe('checked')
  })

  it('a check that could not run: "partly checked" with the count and the reason', () => {
    const rows = coverageRows(input({ scan: scanOf('partial'), runs: [run()] }))
    expect(row(rows, 'checks')).toMatchObject({ status: 'partly_checked', detail: "2 of 3 checks ran. 1 check couldn't run because of missing permissions." })
  })

  it('resources a completed run could not fully check: "partly checked", never "checked"', () => {
    const complete = run().checks!.map((c) => ({ ...c, outcome: 'complete' as const, failure_reason: undefined }))
    const rows = coverageRows(input({ scan: scanOf('completed_other', 2), runs: [run({ checks: complete, unknown_resource_count: 2 })] }))
    expect(row(rows, 'checks').status).toBe('partly_checked')
    expect(row(rows, 'checks').detail).toContain("2 resources couldn't be fully checked")
  })

  it('D6: while a new run is in progress, the previous finished run with the ruled prefix', () => {
    const finished = run({ checks: run().checks!.map((c) => ({ ...c, outcome: 'complete' as const, failure_reason: undefined })) })
    const rows = coverageRows(input({ scan: scanOf('running'), runs: [run({ id: 'run-2', status: 'running', run_state: 'running' }), finished] }))
    expect(row(rows, 'checks')).toMatchObject({ status: 'checked', detail: 'From the previous analysis (a new one is running): 3 of 3 checks ran across EC2 · NAT Gateway.' })
    // No previous finished run: "Not checked" with its detail line, unchanged.
    expect(row(coverageRows(input({ scan: scanOf('running'), runs: [run({ status: 'running', run_state: 'running' })] })), 'checks')).toMatchObject({ status: 'not_checked', detail: 'The first cost analysis is running.' })
  })

  it('failed, never analyzed, status error, running first analysis', () => {
    expect(row(coverageRows(input({ scan: scanOf('failed') })), 'checks').status).toBe('unavailable')
    expect(row(coverageRows(input({ scan: scanOf('never_analyzed'), runs: [] })), 'checks').status).toBe('not_checked')
    expect(row(coverageRows(input({ scan: scanOf('status_unavailable') })), 'checks').status).toBe('unavailable')
    expect(row(coverageRows(input({ scan: scanOf('running'), runs: [run({ status: 'running', run_state: 'running' })] })), 'checks').status).toBe('not_checked')
  })

  it('regions are never "checked": the home region only, other regions named as not checked', () => {
    const regions = row(coverageRows(input()), 'regions')
    expect(regions.status).toBe('partly_checked')
    expect(regions.detail).toBe("Cost checks run in your home region, xx-test-1. S3 lifecycle checks cover buckets in every region. Other regions aren't checked for savings.")
    expect(row(coverageRows(input({ coverage: { homeRegion: null, multiRegion: null, isLoading: false, isError: true } })), 'regions').status).toBe('unavailable')
  })

  it('no row ever claims the whole account, and "checked" never appears for regions or other accounts', () => {
    for (const rows of [coverageRows(input()), coverageRows(input({ scan: scanOf('partial'), runs: [run()] }))]) {
      expect(rows.map((r) => r.detail).join(' ')).not.toMatch(/whole account|all regions|verified|healthy|all clear/i)
      expect(row(rows, 'regions').status).not.toBe('checked')
      expect(row(rows, 'other_accounts').status).toBe('not_checked')
    }
  })

  it('planned checks from the catalog count; Savings Plans only while the RI check is active', () => {
    const rows = coverageRows(input())
    expect(row(rows, 'planned')).toMatchObject({ status: 'not_checked', detail: "2 planned checks don't run yet." })
    expect(rows.find((r) => r.id === 'savings_plans')).toBeUndefined()
    const withRi: OptimizationRuleCatalog = { ...CATALOG, rules: [...CATALOG.rules, { id: 'ec2_reserved_instances', service: 'EC2', name: 'RI', detail: '', status: 'implemented', issue: 'Reserved Instance Opportunity', configurable: false, parameters: [] }] }
    expect(row(coverageRows(input({ catalog: { data: withRi, isError: false } })), 'savings_plans').status).toBe('not_checked')
  })

  it('spend: estimate is "partly checked", a failed summary is "unavailable", loading has no status', () => {
    expect(row(coverageRows(input({ spend: { section: spendSection({ provenance: 'estimated' }), isLoading: false, isError: false } })), 'spend').status).toBe('partly_checked')
    expect(row(coverageRows(input({ spend: { section: undefined, isLoading: false, isError: true } })), 'spend').status).toBe('unavailable')
    expect(row(coverageRows(input({ spend: { section: undefined, isLoading: true, isError: false } })), 'spend').status).toBeNull()
  })
})
