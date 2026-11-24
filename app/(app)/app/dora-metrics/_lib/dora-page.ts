/**
 * Engineering Intelligence page (D5): copy and display rules over the DORA API
 * response (GET /api/metrics/dora, D4). Nothing here measures anything: every
 * number, level, band, previous value, daily bucket and busiest day is read
 * from the response. The only arithmetic is the failure-rate change in
 * percentage points (current rate minus D4's previous rate, both raw from the
 * API) and display rounding. Approved copy: review-logs/deployments/d5-build.md §1.
 */
import type { BenchmarkLevel } from '@/lib/types'
import type {
  DORABand,
  DORAMetricBands,
  DORAMetricsData,
} from '@/lib/services/dora-metrics.service'
import type { DeploymentStats, RecordedDeployment } from '@/lib/deployments/status'
import { SURFACE_COPY } from '@/lib/github-connection/copy'

export const COPY = {
  title: 'Engineering Intelligence',
  subtitle: 'How often you ship and how often a deploy fails, from the deployment records DevControl holds.',
  bannerTitle: "Deployment tracking isn't connected for this workspace yet",
  bannerBody: 'Connecting your CI/CD pipeline is coming soon. Until then, you can record deployments by hand and mark each one succeeded or failed.',
  bannerLink: 'Record a deployment',
  recordHref: '/deployments?record=1',
  deploymentsHref: '/deployments',
  viewDeployments: 'View deployments →',
  frequencyName: 'Deployment frequency',
  failureName: 'Change failure rate',
  frequencyNoData: 'No finished deployments recorded in this period.',
  failureNoData: 'Needs finished deployments, succeeded or failed.',
  mergeName: 'Merge-to-production time',
  mergeText1: "Time from a pull request's merge to that change running in production.",
  mergeText2: 'Starts at the merge because changes are squash-merged.',
  recoveryName: 'Failed deployment recovery time',
  recoveryNoFailures: 'No qualifying failures in this period',
  recoveryText: 'DORA: time to recover from a deployment that impaired production. Counted only once DevControl can tell a production-impacting failure from one that never reached production.',
  planned: 'Planned',
  insufficient: 'fewer than 5 finished, so the level is indicative',
  meetsTarget: 'Meets your target',
  missesTarget: 'Misses your target',
  whatChangedTitle: 'What changed',
  whatChangedFooter: 'Written from fixed rules over the records on this page.',
  whatChangedEmpty: 'Nothing to compare yet. This panel fills in once two periods have finished deployments.',
  fullReport: 'Full report →',
  levelsTitle: 'Performance levels',
  levelsIntro: "Your two measured metrics against DevControl's comparison bands.",
  levelsIntroCustom: ' Metrics with your own target are graded against it.',
  levelsPlannedRow: 'Merge to production, recovery time',
  levelsCustom: 'Graded against your target · see Your targets',
  levelsNoData: 'No finished deployments',
  levelsSeeAll: 'See all four levels →',
  bandsFallbackDescription: 'DevControl comparison bands are informed by the DORA 2023 performance clusters. These are directional benchmarks, not official DORA cutoffs.',
  targetsTitle: 'Your targets',
  targetsIntro: 'Set your own thresholds instead of the comparison bands.',
  targetsNone: 'No target · comparison band used',
  targetsSet: 'Set targets →',
  lockedTitle: 'Available on the Revenue Protection plan',
  lockedBody: 'Set your own deployment frequency and failure-rate targets instead of the comparison bands.',
  // The lower plans' locked board (PR3, founder-approved copy): what the page measures, never a figure.
  boardTitle: "What you'll be able to measure",
  boardItems: [
    { name: 'Deployment frequency', text: 'How often your team ships changes.', ownPlan: false },
    { name: 'Change failure rate', text: 'How often a deployment fails.', ownPlan: false },
    { name: 'Performance levels', text: 'Directional comparison bands informed by the DORA 2023 clusters.', ownPlan: false },
    { name: 'Custom targets', text: 'Your own goals for both metrics.', ownPlan: true },
  ],
  boardSource: 'Measured from your deployment records, from your pipeline or recorded by hand.',
  boardFooter: (plan: string) => `Available on the ${plan} plan.`,
  methodTitle: 'Data and method',
  methodCounted: 'Counted: finished deploys, succeeded or failed. Not counted: CI runs stopped before deploying, cancelled deploys.',
  methodPlanned: 'Planned: merge-to-production time, failed deployment recovery time.',
  methodLink: 'How this is measured →',
  demoSource: 'Demo data · not your workspace',
  noSource: 'No deployment source connected',
  loadError: 'Failed to load metrics.',
} as const

export type MetricKey = 'deploymentFrequency' | 'changeFailureRate'

export const LEVEL_NAME: Record<BenchmarkLevel, string> = {
  elite: 'Elite',
  high: 'High',
  medium: 'Medium',
  low: 'Low',
}

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** A UTC calendar date (YYYY-MM-DD from the API) as "Nov 11". Never shifted into the viewer's zone. */
export function formatUtcDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`)
  if (Number.isNaN(d.getTime())) return date
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })
}

/** A timestamp in the viewer's local time, "Nov 19, 11:55 AM". */
export function formatRecordTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

/** One decimal, half away from zero (so +2.25 and -2.25 both read 2.3). */
const round1 = (v: number) => Math.sign(v) * Math.round(Math.abs(v) * 10) / 10

/** Whether x lies inside one band level, read from the bounds the API served. */
export function insideBand(band: DORABand, x: number): boolean {
  if (band.lower) {
    if (band.lower.inclusive ? x < band.lower.value : x <= band.lower.value) return false
  }
  if (band.upper) {
    if (band.upper.inclusive ? x > band.upper.value : x >= band.upper.value) return false
  }
  return true
}

/**
 * Display precision (founder rulings D5-D6 and its follow-up): one decimal,
 * unless the one-decimal text would read 0.0 for a non-zero value or would
 * contradict the level shown beside it; then two (the API value is already
 * two decimals, and the level was graded on it).
 *   - Comparison band level: the 1-dp value must lie inside that level's served bounds.
 *   - Custom target: the 1-dp value must meet / miss the target as the chip says.
 */
export function displayDecimals(
  key: MetricKey,
  value: number,
  level: { benchmark: BenchmarkLevel | null; isCustomBenchmark: boolean },
  bands: DORAMetricBands | undefined,
  target: number | undefined,
): 1 | 2 {
  // The number the 1-decimal text shows (toFixed's own rounding, so the check matches the text).
  const shown = Number(value.toFixed(1))
  // A non-zero value never reads as 0.0 (founder ruling, after D5-D6).
  if (shown === 0 && value !== 0) return 2
  if (shown === value || level.benchmark == null) return 1
  if (level.isCustomBenchmark) {
    if (target === undefined) return 1
    const meets = level.benchmark === 'elite'
    const shownMeets = key === 'deploymentFrequency' ? shown >= target : shown <= target
    return meets === shownMeets ? 1 : 2
  }
  const band = bands?.levels.find((b) => b.level === level.benchmark)
  if (!band) return 1
  return insideBand(band, shown) ? 1 : 2
}

export function formatMetricValue(
  key: MetricKey,
  value: number,
  level: { benchmark: BenchmarkLevel | null; isCustomBenchmark: boolean },
  bands: DORAMetricBands | undefined,
  target: number | undefined,
): string {
  const text = value.toFixed(displayDecimals(key, value, level, bands, target))
  return key === 'deploymentFrequency' ? `${text} / day` : `${text}%`
}

/** A custom target as typed by the customer: one decimal, more only if they gave more. */
export function formatTarget(key: MetricKey, target: number): string {
  const text = Number.isInteger(target * 10) ? target.toFixed(1) : String(target)
  return key === 'deploymentFrequency' ? `≥ ${text} / day` : `≤ ${text}%`
}

/** "18%" (whole) from a relative change; below half a percent keeps one decimal so a change never reads as none. */
function percentText(p: number): string {
  const a = Math.abs(p)
  return a >= 0.5 ? `${Math.round(a)}%` : `${round1(a)}%`
}

/**
 * Change in percentage points, from the two rates the API served (both 2 dp).
 * Worked in hundredths, so 2.65 − 2.6 is exactly 0.05, never 0.0499….
 * null: either rate is missing. 0 only when the two rates are equal.
 */
export function failureRatePoints(d: DORAMetricsData): number | null {
  const cur = d.changeFailureRate.value
  const prev = d.previousPeriod?.changeFailureRate
  if (cur == null || prev == null) return null
  return (Math.round(cur * 100) - Math.round(prev * 100)) / 100
}

/**
 * A non-zero points change as text, by the same precision rule as the values
 * (review L-1): one decimal, two when one would read 0.0 ("0.04"). Never used
 * for 0 -- equal rates read "Same" / "unchanged", and only equal rates do
 * (equal 2-dp rates also mean the same level).
 */
export function pointsText(points: number): string {
  const hundredths = Math.round(Math.abs(points) * 100)
  const tenths = Math.round(hundredths / 10)
  return tenths === 0 ? (hundredths / 100).toFixed(2) : (tenths / 10).toFixed(1)
}

/** The change line on the Deployment frequency card (null: no line). */
export function frequencyChangeLine(d: DORAMetricsData): string | null {
  const n = d.period.days
  if (d.deploymentFrequency.value == null || !d.previousPeriod) return null
  const p = d.change?.deploymentsPerDayPercent
  if (p != null) {
    if (p === 0) return `Same as previous ${n} days`
    return `${p > 0 ? 'Up' : 'Down'} ${percentText(p)} vs previous ${n} days`
  }
  if (d.previousPeriod.deploymentsPerDay === 0) return `None in the previous ${n} days`
  if (d.previousPeriod.deploymentsPerDay == null) return `No finished deploys in the previous ${n} days`
  return null
}

/** The change line on the Change failure rate card, in percentage points (null: no line). */
export function failureChangeLine(d: DORAMetricsData): string | null {
  const n = d.period.days
  if (d.changeFailureRate.value == null || !d.previousPeriod) return null
  if (d.previousPeriod.changeFailureRate == null) return `No finished deploys in the previous ${n} days`
  const pts = failureRatePoints(d)
  if (pts == null) return null
  if (pts === 0) return `Same as previous ${n} days`
  return `${pts > 0 ? 'Up' : 'Down'} ${pointsText(pts)} points vs previous ${n} days`
}

export function frequencyFactLine(d: DORAMetricsData): string {
  const s = d.deployments.successful
  const base = `${s} successful ${plural(s, 'deploy', 'deploys')} in ${d.period.days} days`
  return d.deployments.finished > 0 && d.deployments.finished < 5 ? `${base} · ${COPY.insufficient}` : base
}

export function failureFactLine(d: DORAMetricsData): string {
  const { failed, finished } = d.deployments
  const base = `${failed} of ${finished} finished ${plural(finished, 'deploy', 'deploys')} failed`
  return finished > 0 && finished < 5 ? `${base} · ${COPY.insufficient}` : base
}

export interface WhatChangedItem { headline: string; detail: string }

/**
 * The What changed sentences (approved rules R1, R1', R2a-c, R3, d5-build.md
 * §1.2-C), from the response only. null: nothing to compare (either period has
 * no finished deploy).
 */
export function whatChanged(d: DORAMetricsData): WhatChangedItem[] | null {
  const prev = d.previousPeriod
  if (!prev || d.deployments.finished === 0 || prev.deployments.finished === 0) return null
  const n = d.period.days
  const cur = d.deployments
  const items: WhatChangedItem[] = []

  const p = d.change?.deploymentsPerDayPercent
  if (p != null) {
    items.push({
      headline: p === 0 ? 'Deploys level' : `Deploys ${p > 0 ? 'up' : 'down'} ${percentText(p)}`,
      detail: `${cur.successful} successful in the last ${n} days, ${prev.deployments.successful} in the ${n} days before.`,
    })
  } else if (prev.deployments.successful === 0 && cur.successful > 0) {
    items.push({
      headline: 'First successful deploys',
      detail: `${cur.successful} in the last ${n} days, none in the ${n} days before.`,
    })
  }

  if (cur.failed === 0 && prev.deployments.failed === 0) {
    items.push({ headline: 'No failed deploys', detail: 'None in either period.' })
  } else if (cur.failed === 0) {
    items.push({ headline: 'No failed deploys', detail: `${prev.deployments.failed} in the ${n} days before.` })
  } else {
    const pts = failureRatePoints(d)
    items.push({
      headline: pts == null || pts === 0
        ? 'Failure rate unchanged'
        : `Failure rate ${pts > 0 ? 'up' : 'down'} ${pointsText(pts)} points`,
      detail: `${cur.failed} of ${cur.finished} failed, against ${prev.deployments.failed} of ${prev.deployments.finished} in the ${n} days before.`,
    })
  }

  const busy = d.busiestDay
  if (busy) {
    let detail = `${busy.total} ${plural(busy.total, 'deploy', 'deploys')}.`
    if (busy.failed > 0) detail += ` ${busy.failed} failed.`
    if (busy.tiedDays > 1) {
      const others = busy.tiedDays - 1
      detail += ` ${others} other ${plural(others, 'day', 'days')} had as many.`
    }
    if (busy.partial) detail += ' Counted for the part of that day inside this period.'
    items.push({ headline: `Busiest day: ${formatUtcDay(busy.date)}`, detail })
  }

  return items.slice(0, 3)
}

/** Rows recorded without a result in the period (deploying-only state, ruling G); null when it can't be said. */
export function withoutResultCount(
  d: DORAMetricsData,
  stats: DeploymentStats | null | undefined,
  filtered: boolean,
): number | null {
  if (filtered || !stats || d.deployments.finished !== 0) return null
  const n = stats.in_progress + stats.no_completion_recorded + stats.unknown
  return n > 0 ? n : null
}

export function withoutResultSentence(n: number): string {
  return `No deployment finished in this period; ${n} ${n === 1 ? 'was' : 'were'} recorded without a result. Only finished deploys are counted.`
}

export type SourceKind = 'github_actions' | 'manual' | 'other'

export interface SourceInfo {
  dot: 'solid' | 'hollow' | 'none'
  text: string | null
  kind: SourceKind | 'none' | null
}

/** The row was written by the GitHub App (D8a-2 metadata). */
export function isGitHubAppRow(row: RecordedDeployment | null): boolean {
  const meta = (row?.metadata ?? null) as Record<string, unknown> | null
  return meta?.connection === 'github_app'
}

/** The latest finished row among the newest rows (the list is newest first). */
export function latestFinished(rows: RecordedDeployment[] | null | undefined): RecordedDeployment | null {
  return rows?.find((r) => r.status === 'success' || r.status === 'failed') ?? null
}

function sourceOf(row: RecordedDeployment | null): { kind: SourceKind; label: string } | null {
  const meta = (row?.metadata ?? null) as Record<string, unknown> | null
  if (!row || !meta) return null
  if (meta.source === 'github_actions') {
    if (meta.connection === 'github_app') {
      // GitHub App rows (D8a-2) store the real workflow name and the job name apart.
      const workflow = text(meta.workflow_name)
      const job = text(meta.job_name)
      const detail = workflow && job ? `${workflow} › ${job}` : (job ?? workflow)
      return { kind: 'github_actions', label: detail ? `GitHub Actions · ${detail}` : 'GitHub Actions' }
    }
    // Legacy webhook rows: workflow_name holds the job name.
    const job = text(meta.workflow_name)
    return { kind: 'github_actions', label: job ? `GitHub Actions (${job} job)` : 'GitHub Actions' }
  }
  // GitHub Environments deploys may come from any tool, not only Actions.
  if (meta.source === 'github_deployments') return { kind: 'other', label: 'GitHub Deployments' }
  if (meta.source === 'manual') return { kind: 'manual', label: 'entered by hand' }
  return null
}

function text(value: unknown): string | null {
  return typeof value === 'string' && value ? value : null
}

/**
 * The header source line (ruling D5-D1), workspace-wide. stats undefined =
 * not loaded or failed: nothing is claimed.
 */
export function sourceLine(
  stats: DeploymentStats | null | undefined,
  rows: RecordedDeployment[] | null | undefined,
): SourceInfo {
  if (!stats) return { dot: 'none', text: null, kind: null }
  if (!stats.organization_has_deployments) return { dot: 'hollow', text: COPY.noSource, kind: 'none' }
  const row = latestFinished(rows)
  const at = stats.last_deployment?.deployed_at ?? (row ? String(row.deployedAt) : null)
  if (!at) return { dot: 'solid', text: 'Deployments recorded, none with a result yet', kind: 'other' }
  const time = formatRecordTime(at)
  const source = sourceOf(row)
  if (!source) return { dot: 'solid', text: `Last finished record · ${time}`, kind: 'other' }
  if (source.kind === 'manual') return { dot: 'solid', text: `Last record entered by hand · ${time}`, kind: 'manual' }
  return { dot: 'solid', text: `Last record from ${source.label} · ${time}`, kind: source.kind }
}

/**
 * The "Data and method" source sentence (approved §1.2-A). D8b-2 (board 7,
 * R15): while the GitHub App is switched on and the latest record is one it
 * wrote, the GitHub Actions sentence names the app instead of "via webhook";
 * the legacy-webhook sentence stays for webhook rows until D8c.
 */
export function methodSourceSentence(kind: SourceInfo['kind'], demo: boolean, githubAppRecords = false): string {
  if (demo) return 'Demo data: a fixed example, not records from your workspace.'
  if (kind === 'github_actions' && githubAppRecords) return SURFACE_COPY.methodGitHubApp
  if (kind === 'github_actions') {
    return 'Records come from your pipeline (GitHub Actions, via webhook) and from deployments recorded by hand on the Deployments page.'
  }
  if (kind === 'manual') return 'Records come from deployments recorded by hand on the Deployments page.'
  if (kind === 'none') return 'No records yet. Record a deployment by hand on the Deployments page.'
  return 'Records come from your pipeline (via webhook) or from deployments recorded by hand on the Deployments page.'
}

/** A band level's label, exactly as the API serves it. */
export function bandLabel(bands: DORAMetricBands | undefined, level: BenchmarkLevel | null): string | null {
  if (!bands || !level) return null
  return bands.levels.find((b) => b.level === level)?.label ?? null
}

/**
 * CSV text and file name (review L-6). Demo data is marked: the first line
 * after the header says so and the file name ends "-demo".
 */
export function doraCsvText(rows: string[][], demo: boolean): string {
  const lines = demo ? [rows[0], [COPY.demoSource, '', '', '', ''], ...rows.slice(1)] : rows
  return lines.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(',')).join('\n')
}

export function doraCsvFilename(dateRange: string, today: string, demo: boolean): string {
  return `dora-metrics-${dateRange}-${today}${demo ? '-demo' : ''}.csv`
}
