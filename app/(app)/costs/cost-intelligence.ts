/**
 * Cost Intelligence (the Costs page) redesign, PR A: the pure rules behind
 * each section. Founder rulings: review-logs/cost-intelligence/stage-a.md,
 * Addendum 1 (2026-11-26). Nothing here reads a clock, a literal count or a
 * literal service name: every number comes from the API data passed in.
 */
import type { ContextSection, CostSpendEvidence, RecommendationStats } from '@/lib/types'
import type { CheckFailureReason, CostAnalysisRun, OptimizationRuleCatalog } from '@/lib/services/cost-recommendations.service'
import { formatSavingsCurrency } from '@/lib/utils'
import { describeSavingsTotal, displayedAmount, savingsFigure, SMALL_SAVINGS_USD, type SavingsFigureWithAmount, type SavingsTotal } from '@/lib/savings-basis'
import { isNotReportedYet, isStillUpdating, type CostReportState } from '@/lib/cost-trend-basis'
import { couldntRunSentence, resourcesNotFullyChecked } from '../cost-optimization/costScanBanner'
import { costChecksRegionLine } from '../cost-optimization/costOptimizationCopy'
import type { CostScanState } from '../cost-optimization/costScanState'
import { formatUsd, monthHasUnfinishedDays } from './cost-display'
import { utcChartLabel } from './trend-chart-data'

/** The page subtitle (spec item 5). */
export const PAGE_SUBTITLE = 'AWS spend visibility, cost drivers, and evidence-backed optimization opportunities.'

// ─── The trend points and the one day window (safeguard 1) ─────────────────

/** One GET /api/platform/costs/trend point, as this page reads it. */
export interface CostTrendPointView {
  date: string
  compute: number
  storage: number
  database: number
  network: number
  other: number
  total: number
  lineItems?: number
  reportState?: CostReportState
  provisional?: boolean
  /** Top services over the response plus "Other", each floored at $0 per day (AWSCostService). */
  byServiceDisplay?: { service: string; amount: number; color: string }[]
}

/** The page's range tabs (founder ruling Q7: 7D / 30D / 3M, all daily). */
export const TREND_RANGES = [
  { label: '7D', days: 7, range: '7d' },
  { label: '30D', days: 30, range: '30d' },
  { label: '3M', days: 90, range: '90d' },
] as const
export type TrendRangeLabel = (typeof TREND_RANGES)[number]['label']
export const DEFAULT_TREND_RANGE: TrendRangeLabel = '30D'

/**
 * The days the chart, the cost drivers donut and its total label all use
 * (safeguard 1): the last `days` points of the response, one call for every
 * consumer. The backend's 30d response has 31 points (today-30 .. today); the
 * window is the last 30 of them (founder ruling Q5).
 */
export function trendWindow<T extends { date: string }>(points: readonly T[], days: number): T[] {
  return points.slice(-days)
}

/** "Oct 28 – Nov 26 (UTC)", or "Nov 26 (UTC)" for one day; null for no days. UTC calendar dates, never shifted. */
export function windowDatesLabel(points: readonly { date: string }[]): string | null {
  if (points.length === 0) return null
  const first = utcChartLabel(points[0].date)
  const last = utcChartLabel(points[points.length - 1].date)
  return first === last ? `${first} (UTC)` : `${first} – ${last} (UTC)`
}

// ─── Cost drivers (founder ruling Q4: by AWS service) ──────────────────────

/** A type alias, not an interface: recharts' Pie data needs an index-signature-compatible row. */
export type CostDriverSlice = {
  service: string
  amount: number
  /** The series colour the API assigned to the service. */
  fill: string
}

export interface CostDrivers {
  /** Services with spend above $0, largest first; "Other" (the API's bucket) last. */
  slices: CostDriverSlice[]
  /** Sum of the slices: the donut's own total. */
  total: number
  /** The window's days and dates: the same points the chart draws. */
  days: number
  dates: string
  /** A day in the window is still updating (its amount is "so far"). */
  includesUpdating: boolean
}

const OTHER_SERVICE = 'Other'

/**
 * The donut's slices and total from the window's points. null when a reported
 * point has no per-service breakdown (an older cached response): the donut is
 * then not available, never drawn from a guess. Not-reported days carry no
 * amounts and add nothing.
 */
export function costDrivers(window: readonly CostTrendPointView[]): CostDrivers | null {
  const dates = windowDatesLabel(window)
  if (!dates) return null
  const sums = new Map<string, CostDriverSlice>()
  for (const point of window) {
    if (isNotReportedYet(point)) continue
    if (!Array.isArray(point.byServiceDisplay)) return null
    for (const { service, amount, color } of point.byServiceDisplay) {
      if (typeof amount !== 'number' || !Number.isFinite(amount)) continue
      const entry = sums.get(service) ?? { service, amount: 0, fill: color }
      entry.amount += amount
      sums.set(service, entry)
    }
  }
  const all = [...sums.values()]
  const total = all.reduce((sum, slice) => sum + slice.amount, 0)
  const slices = all
    .filter((slice) => slice.amount > 0)
    .sort((a, b) => Number(a.service === OTHER_SERVICE) - Number(b.service === OTHER_SERVICE) || b.amount - a.amount)
  return { slices, total, days: window.length, dates, includesUpdating: window.some(isStillUpdating) }
}

/** A driver's amount: cents, and "<$0.01" for a positive amount under half a cent (never "$0.00" for spend). */
export function formatDriverAmount(amount: number): string {
  return amount > 0 && amount < 0.005 ? '<$0.01' : formatUsd(amount)
}

/** "30-day total" (the window's own day count). */
export const windowTotalLabel = (days: number) => `${days}-day total`

// ─── Spend Trend summary line (mock-match item 5) ────────────────────────────

export interface TrendSummary {
  /** Sum of the window's reported days (a not-reported day adds nothing; an updating day adds its amount so far). */
  total: number
  /** The days the chart draws an amount for (the reported days of the window). */
  drawnDays: number
  /** total / drawnDays. */
  dailyAverage: number
}

/**
 * The summary line inside the Spend Trend card (mock-match item 5), from
 * exactly the window the chart draws (safeguard 1): pass the same
 * `trendWindow` points. The days the chart draws are the reported ones, and
 * their unrounded amounts are added, as the cost drivers add theirs, so the
 * two 30-day totals never drift apart by per-day rounding (Stage A risk R2).
 * null when no day is reported (never "$0 total").
 */
export function trendSummary(window: readonly CostTrendPointView[]): TrendSummary | null {
  const drawn = window.filter((point) => !isNotReportedYet(point) && Number.isFinite(point.total))
  if (drawn.length === 0) return null
  const total = drawn.reduce((sum, point) => sum + point.total, 0)
  return { total, drawnDays: drawn.length, dailyAverage: total / drawn.length }
}

/** How many services the summary line's "Top drivers" names. */
export const TOP_DRIVER_COUNT = 3

/**
 * "Top drivers" on the summary line: the largest services of the cost drivers
 * (the same window, safeguard 1), largest first. The API's "Other" bucket is
 * not a service, so it is never a top driver. Empty when there is no breakdown.
 */
export function topDrivers(drivers: CostDrivers | null, count = TOP_DRIVER_COUNT): CostDriverSlice[] {
  if (!drivers) return []
  return drivers.slices.filter((slice) => slice.service !== OTHER_SERVICE).slice(0, count)
}

// ─── Savings tile (founder ruling Q2) ───────────────────────────────────────
// The rule, the wording and the tile kinds live in lib/savings-basis.ts
// (describeSavingsTotal, "Never show $0"); re-exported here for this page.

export {
  displayedAmount, NO_ESTIMATE_SUB, NONE_FOUND, NONE_FOUND_PARTIAL, NONE_FOUND_PARTIAL_SUB, NONE_FOUND_SUB, SMALL_SAVINGS_USD,
} from '@/lib/savings-basis'
export type SavingsTile = SavingsTotal

/**
 * The savings tile from /stats: describeSavingsTotal (lib/savings-basis.ts)
 * with this page's formatter. `strong` (green) is decided on the figure as
 * displayed (N-3). `partialRun`: the latest analysis was partial, so "none
 * found" covers only the checks that ran (N-4). Callers handle loading,
 * errors and "not analyzed yet" first ("—"); a stats response with no total
 * is kind 'unavailable' ("—").
 */
export function describeSavingsTile(
  stats: Pick<RecommendationStats, 'totalPotentialSavings' | 'estimatedFindings' | 'potentialSavingsCeiling' | 'potentialSavingsCeilingByResourceType' | 'activeRecommendations'>,
  { partialRun = false }: { partialRun?: boolean } = {},
): SavingsTile {
  return describeSavingsTotal(stats, { partialRun })
}

/**
 * Opportunities order (fix round 1, N-7): by the savings figure each card
 * shows ("$X/mo" or "Up to $X/mo"), largest first; on an equal displayed
 * figure a firm estimate before an upper bound; findings with no dollar
 * figure (savingsFigure: no basis, or a figure not above $0) after every
 * priced one, in their incoming order. A recorded sub-cent figure shows as 0.
 */
export function rankByDisplayedSavings<T extends { potentialSavings: number; metadata?: Record<string, unknown> | null }>(recs: readonly T[]): T[] {
  return recs
    .map((rec, index) => ({ rec, index, fig: savingsFigure(rec) }))
    .sort((a, b) => {
      if (a.fig.kind === 'none' || b.fig.kind === 'none') {
        if (a.fig.kind !== b.fig.kind) return a.fig.kind === 'none' ? 1 : -1
        return a.index - b.index
      }
      const shown = (fig: SavingsFigureWithAmount) => (fig.subCent ? 0 : displayedAmount(formatSavingsCurrency(fig.amount)))
      return shown(b.fig) - shown(a.fig)
        || Number(a.fig.kind === 'ceiling') - Number(b.fig.kind === 'ceiling')
        || b.fig.amount - a.fig.amount
        || a.index - b.index
    })
    .map(({ rec }) => rec)
}

/**
 * How an opportunity card styles its figure (mock-match item 4, ruling Q2):
 * green only for a firm estimate of at least SMALL_SAVINGS_USD as displayed
 * (N-3); an upper bound, a small figure or no figure stays grey. `note` names
 * the figure's basis under the title; null for no dollar figure.
 */
export function opportunityFigure(rec: { potentialSavings: number; metadata?: Record<string, unknown> | null }): { strong: boolean; note: string | null } {
  const fig = savingsFigure(rec)
  if (fig.kind === 'ceiling') return { strong: false, note: 'Upper-bound estimate' }
  if (fig.kind === 'estimate') return { strong: !fig.subCent && displayedAmount(formatSavingsCurrency(fig.amount)) >= SMALL_SAVINGS_USD, note: 'Monthly estimate' }
  return { strong: false, note: null }
}

/**
 * The line under the Opportunities list (mock-match item 4), from real counts:
 * `shown` cards of `total` open findings (/stats). null when the open count
 * isn't known or nothing is listed.
 */
export function opportunitiesFooter(shown: number, total: number | null): string | null {
  if (total === null || shown === 0) return null
  if (total === 1 && shown === 1) return 'This is the only open finding.'
  if (total <= shown) return `These are all ${shown} open findings.`
  const more = total - shown
  return `${more} more open finding${plural(more, '', 's')} on Cost Optimization.`
}

// ─── Checks tile (spec item 6: from the active catalog) ─────────────────────

export interface ActiveChecks {
  count: number
  /** Display names of the services with at least one active check, in the registry's order. */
  services: string[]
  plannedCount: number
}

/** Active (implemented) checks and their service categories from the catalog; planned checks excluded. null until it has loaded. */
export function activeChecks(catalog: OptimizationRuleCatalog | undefined): ActiveChecks | null {
  if (!catalog || catalog.summary.totalRules === 0) return null
  return {
    count: catalog.summary.implementedCount,
    services: catalog.summary.services.filter((s) => s.implementedCount > 0).map((s) => s.displayName || s.service),
    plannedCount: catalog.summary.plannedCount,
  }
}

const plural = (count: number, one: string, many: string) => (count === 1 ? one : many)

/** "across 7 service categories" */
export const acrossCategories = (count: number) => `across ${count} service ${plural(count, 'category', 'categories')}`
export const servicesLine = (names: readonly string[]) => names.join(' · ')

// ─── Last analysis line (spec item 7, founder ruling Q6) ────────────────────

export interface RunChecks {
  ran: number
  total: number
}

/** A run's own N of M: completed checks of the checks it recorded; null when it recorded none. */
export function runChecks(run: Pick<CostAnalysisRun, 'checks'> | undefined): RunChecks | null {
  if (!run || !Array.isArray(run.checks) || run.checks.length === 0) return null
  return { ran: run.checks.filter((check) => check.outcome === 'complete').length, total: run.checks.length }
}

/**
 * K in "K found" (ruling Q6): the findings the run itself left open, new plus
 * refreshed (suppressed and duplicate detections excluded). null when the run
 * didn't record both counts: then K is left out, never shown as 0.
 */
export function runFoundCount(run: Pick<CostAnalysisRun, 'new_count' | 'refreshed_count'> | undefined): number | null {
  if (!run || typeof run.new_count !== 'number' || typeof run.refreshed_count !== 'number') return null
  return run.new_count + run.refreshed_count
}

/** "12 of 12 checks ran" */
export const checksRanPart = ({ ran, total }: RunChecks) => `${ran} of ${total} check${plural(total, '', 's')} ran`
/** "3 found" */
export const foundPart = (count: number) => `${count} found`

/**
 * The parts after the time and source on the Last analysis line, for a
 * finished run. Failed or interrupted: "didn't finish" only (its counts are
 * not results). A run's unchecked resources are named, never hidden.
 */
export function lastAnalysisParts(scan: Pick<CostScanState, 'key' | 'uncheckedResources'>, run: Pick<CostAnalysisRun, 'checks' | 'new_count' | 'refreshed_count'> | undefined): string[] {
  if (scan.key === 'failed' || scan.key === 'interrupted') return ["didn't finish"]
  const finished = scan.key === 'partial' || scan.key.startsWith('completed')
  if (!finished) return []
  const parts: string[] = []
  const checks = runChecks(run)
  if (checks) parts.push(checksRanPart(checks))
  const found = runFoundCount(run)
  if (found !== null) parts.push(foundPart(found))
  if (scan.uncheckedResources !== null && scan.uncheckedResources > 0) parts.push(resourcesNotFullyChecked(scan.uncheckedResources))
  return parts
}

// ─── What this page covers (spec item 12) ───────────────────────────────────

export type CoverageStatus = 'checked' | 'partly_checked' | 'unavailable' | 'not_checked'

export const COVERAGE_STATUS_LABEL: Record<CoverageStatus, string> = {
  checked: 'Checked',
  partly_checked: 'Partly checked',
  unavailable: 'Unavailable',
  not_checked: 'Not checked',
}

export interface CoverageRow {
  id: 'spend' | 'checks' | 'regions' | 'planned' | 'savings_plans' | 'other_accounts'
  label: string
  /** null while its data is still loading. */
  status: CoverageStatus | null
  detail: string
}

export const COVERAGE_TITLE = 'What this page covers'
export const COVERAGE_INTRO = "What DevControl read or checked for this page. It doesn't verify your whole AWS account."
export const LOADING = 'Loading…'

export interface CoverageInput {
  spend: { section: ContextSection<CostSpendEvidence> | undefined; isLoading: boolean; isError: boolean }
  trend: { isLoading: boolean; isError: boolean }
  scan: CostScanState
  /** The runs, latest first (GET /analysis-runs?source=all). */
  runs: readonly CostAnalysisRun[] | undefined
  catalog: { data: OptimizationRuleCatalog | undefined; isError: boolean }
  coverage: { homeRegion: string | null; multiRegion: { savings_regions: readonly string[] } | null | undefined; isLoading: boolean; isError: boolean }
}

function spendRow({ spend, trend }: CoverageInput): CoverageRow {
  const row = (status: CoverageStatus | null, detail: string): CoverageRow => ({ id: 'spend', label: 'AWS spend', status, detail })
  if (spend.isLoading || trend.isLoading) return row(null, LOADING)
  const section = spend.section
  if (spend.isError || !section || section.state === 'error') return row('unavailable', "Spend couldn't be retrieved from AWS Cost Explorer.")
  if (section.provenance === 'estimated') {
    return row('partly_checked', "AWS Cost Explorer spend wasn't available, so month-to-date shows an estimate from your resource inventory.")
  }
  if ((section.state !== 'available' && section.state !== 'partial') || !section.data) {
    return row('unavailable', 'No AWS Cost Explorer spend data is available.')
  }
  if (trend.isError) return row('partly_checked', "Month-to-date spend loaded from AWS Cost Explorer; the daily trend couldn't be retrieved.")
  const visible = 'Spend that the connected account can see in AWS Cost Explorer.'
  if (section.state === 'partial') return row('partly_checked', `${visible} Some of it is partial data.`)
  return row('checked', monthHasUnfinishedDays(section) ? `${visible} The latest days are still updating.` : visible)
}

/** The latest run that isn't still running (a running run has no results yet). */
function latestFinishedRun(runs: readonly CostAnalysisRun[] | undefined): CostAnalysisRun | undefined {
  return runs?.find((run) => (run.run_state ?? run.status) !== 'running')
}

/** Failed checks by reason, largest first: the frontend mirror of failedChecksByReason (cost-run-result.ts). */
function failedByReason(run: CostAnalysisRun): { reason: CheckFailureReason; count: number }[] {
  const counts = new Map<CheckFailureReason, number>()
  for (const check of run.checks ?? []) {
    if (check.outcome !== 'failed') continue
    const reason: CheckFailureReason = check.failure_reason ?? 'error'
    counts.set(reason, (counts.get(reason) ?? 0) + 1)
  }
  return [...counts.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count)
}

/** The services of a run's completed checks (by each check's catalog rule), in the catalog's service order. */
function servicesThatRan(run: CostAnalysisRun, catalog: OptimizationRuleCatalog | undefined): string[] {
  if (!catalog) return []
  const ran = new Set<string>()
  for (const check of run.checks ?? []) {
    if (check.outcome !== 'complete') continue
    const rule = catalog.rules.find((r) => (check.rule_id ? r.id === check.rule_id : r.issue === check.issue))
    if (rule) ran.add(rule.service)
  }
  return catalog.summary.services.filter((s) => ran.has(s.service)).map((s) => s.displayName || s.service)
}

function checksRow({ scan, runs, catalog }: CoverageInput): CoverageRow {
  const row = (status: CoverageStatus | null, detail: string): CoverageRow => ({ id: 'checks', label: 'Cost checks', status, detail })
  if (scan.key === 'loading') return row(null, LOADING)
  if (scan.key === 'status_unavailable') return row('unavailable', "Couldn't load the cost analysis status.")
  if (scan.key === 'never_analyzed') return row('not_checked', 'No cost analysis has run yet.')
  if (scan.key === 'failed' || scan.key === 'interrupted') return row('unavailable', "The latest cost analysis didn't finish.")
  const run = scan.key === 'running' ? latestFinishedRun(runs) : runs?.[0]
  if (scan.key === 'running' && !run) return row('not_checked', 'The first cost analysis is running.')
  if (scan.key === 'running' && run && (run.run_state ?? run.status) !== 'completed' && (run.run_state ?? run.status) !== 'partial') {
    return row('unavailable', "A cost analysis is running; the one before it didn't finish.")
  }
  const checks = runChecks(run)
  if (!run || !checks) return row('partly_checked', "The latest analysis didn't record which checks ran.")
  const unknown = typeof run.unknown_resource_count === 'number' ? run.unknown_resource_count : 0
  const prefix = scan.key === 'running' ? 'From the previous analysis (a new one is running): ' : ''
  if (checks.ran === checks.total && unknown === 0) {
    const names = servicesThatRan(run, catalog.data)
    return row('checked', `${prefix}${checksRanPart(checks)}${names.length > 0 ? ` across ${servicesLine(names)}` : ''}.`)
  }
  const sentences = [`${checksRanPart(checks)}.`]
  if (checks.ran < checks.total) sentences.push(couldntRunSentence(failedByReason(run), checks.total - checks.ran))
  if (unknown > 0) sentences.push(`${resourcesNotFullyChecked(unknown)}.`)
  return row('partly_checked', `${prefix}${sentences.join(' ')}`)
}

function regionsRow({ coverage }: CoverageInput): CoverageRow {
  const row = (status: CoverageStatus | null, detail: string): CoverageRow => ({ id: 'regions', label: 'Regions', status, detail })
  if (coverage.isLoading) return row(null, LOADING)
  if (coverage.isError) return row('unavailable', "Region coverage couldn't be loaded.")
  const line = costChecksRegionLine(coverage.multiRegion)
    ?? (coverage.homeRegion ? costChecksRegionLine({ savings_regions: [coverage.homeRegion] }) : null)
  if (!line) return row('unavailable', "Your home region isn't known yet.")
  // Never "checked": the cost checks cover the home region (and S3 buckets), not the whole account.
  return row('partly_checked', `${line} Other regions aren't checked for savings.`)
}

function plannedRow({ catalog }: CoverageInput): CoverageRow | null {
  if (catalog.isError) return { id: 'planned', label: 'Planned checks', status: 'unavailable', detail: "Couldn't load the list of checks." }
  const checks = activeChecks(catalog.data)
  if (!checks) return { id: 'planned', label: 'Planned checks', status: null, detail: LOADING }
  if (checks.plannedCount === 0) return null
  return { id: 'planned', label: 'Planned checks', status: 'not_checked', detail: `${checks.plannedCount} planned check${plural(checks.plannedCount, " doesn't", "s don't")} run yet.` }
}

/** The Reserved Instance check compares same-type RIs only (its own coverage_basis); shown only while that check is active. */
function savingsPlansRow({ catalog }: CoverageInput): CoverageRow | null {
  const riActive = catalog.data?.rules.some((rule) => rule.id === 'ec2_reserved_instances' && rule.status === 'implemented')
  if (!riActive) return null
  return { id: 'savings_plans', label: 'Savings Plans', status: 'not_checked', detail: "The Reserved Instance check doesn't account for Savings Plans." }
}

const OTHER_ACCOUNTS_ROW: CoverageRow = {
  id: 'other_accounts',
  label: 'Other AWS accounts',
  status: 'not_checked',
  detail: 'Cost checks run only in the connected AWS account.',
}

/**
 * The rows of "What this page covers", from real signals only (Stage A §G).
 * No row is ever "checked" for regions or the whole account; a check that
 * didn't run, or a resource it couldn't fully check, makes its row "partly
 * checked", never "checked".
 */
export function coverageRows(input: CoverageInput): CoverageRow[] {
  return [spendRow(input), checksRow(input), regionsRow(input), plannedRow(input), savingsPlansRow(input), OTHER_ACCOUNTS_ROW]
    .filter((row): row is CoverageRow => row !== null)
}
