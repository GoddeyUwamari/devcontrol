/**
 * What the Security Overview redesign (NEXT_PUBLIC_SECURITY_V2) shows, from
 * existing DB-backed responses: the risk score and its trend, account-level
 * findings, resource findings (the full list on Pro, the needs-attention list
 * below it), coverage, compliance frameworks and the anomaly count. Pure: no
 * React, no fetch, no Date.now(); `now` is passed in. Every string the page
 * prints is built here, so each wording rule is tested without rendering
 * (security-page-plan.md §2–§9, founder decisions of Oct 23 and Oct 26, 2026).
 *
 * Rules:
 * - A value that did not load is null ("—" or a reason), never 0, and a source
 *   that failed never erases the findings that loaded from the others.
 * - "No critical …" statements need every source they depend on to have loaded.
 * - Open = an account finding that is active or acknowledged, or any current
 *   resource finding (resource findings have no dispositions yet).
 * - Dates and times are the viewer's local time, through lib/utils/localTime (the one formatter shared with
 *   the Compliance page, founder answer Q8); only the trend's daily labels are UTC calendar days.
 * - A running or failed framework never shows an earlier score as current.
 * - No full access key ID or ARN in any string (lib/security/findingDisplay).
 */
import type { AccountSecurityFinding, ComplianceSeverity } from '@/lib/services/account-security-findings.service'
import type { AWSService, ServicesCoverage } from '@/lib/services/aws-services.service'
import type { ComplianceFramework, ComplianceScan } from '@/lib/services/compliance-frameworks.service'
import type { RiskScore, RiskScoreTrendResponse } from '@/lib/services/risk-score.service'
import { findingWhere, maskText, resourceWhere, safeTitle, shortArn, type FindingWhere } from '@/lib/security/findingDisplay'
import { typeLabel } from '../../services/AttentionTable'
import { hasRegionCoverage, regionCounts } from '../../services/regionCoverage'
import { formatLocalDay, formatLocalWhen } from '@/lib/utils/localTime'
import { OVERVIEW_COPY } from '../../infrastructure/overview/overviewModel'
import { EVALUATION_COPY, FRAMEWORK_STALE_AFTER_MS, SEE_PLANS, evaluateFramework, type EvaluationOverlay, type EvaluationState } from '@/lib/compliance/evaluation'
import {
  WEB_SERVER_HINT,
  buildHttpsOnlyStatement,
  guidanceFor,
  guidanceKeyForAccountFinding,
  guidanceKeyForResourceIssue,
  shortTitle,
  type FixGuidance,
  type GuidanceKey,
} from './fixGuidance'

export type SecLoadable<T> = { status: 'loading' } | { status: 'error' } | { status: 'plan' } | { status: 'ready'; data: T }

/** One issue stored on a resource (aws_resources.compliance_issues, current entries only). */
export interface ResourceIssue {
  severity: string
  category: string
  issue: string
  recommendation: string
  resource_arn?: string
  findingKey?: string
}

/** A row of GET /api/aws-resources/compliance (Pro): the resource and its current issues. */
export interface ResourceWithIssues {
  id: string
  resource_name: string | null
  resource_arn: string
  resource_type: string
  region: string | null
  issues: ResourceIssue[]
}

/** The full resource list (Pro), or the needs-attention list (worst issue per resource, high and above) below Pro. */
export type ResourceFindingsSource =
  | { kind: 'full'; resources: ResourceWithIssues[] }
  | { kind: 'attention'; services: AWSService[] }

export interface SecurityInputs {
  score: SecLoadable<RiskScore>
  trend: SecLoadable<RiskScoreTrendResponse>
  accountFindings: SecLoadable<AccountSecurityFinding[]>
  resourceFindings: SecLoadable<ResourceFindingsSource>
  coverage: SecLoadable<ServicesCoverage>
  /** scansLimit: the limit the scan list was requested with (the org's newest scans, all frameworks together). */
  frameworks: SecLoadable<{ frameworks: ComplianceFramework[]; scans: ComplianceScan[]; scansLimit: number }>
  anomalies: SecLoadable<{ active: number }>
}

// ── Copy ──

// The upgrade link and the Enterprise sentence are shared with the Compliance page (lib/compliance/evaluation).
export { SEE_PLANS }

export const SECURITY_COPY = {
  incomplete: "Some checks couldn't load, so this may be incomplete.",
  noCritical: 'No critical findings in the areas we checked.',
  noCriticalOrHigh: 'No critical or high-severity findings in the areas we checked.',
  noScanYet: 'No scan has finished yet.',
  attentionOnly: 'Showing high and critical resource findings.',
  scoreFrom: 'From the last scan',
  scorePreliminary: 'The first scan is still running.',
  scorePlan: 'The score is on the Pro plan.',
  scoreError: "Couldn't load the score.",
  anomaliesNone: 'None open',
  frameworksPlan: EVALUATION_COPY.enterprisePlan,
  frameworksError: "Couldn't load compliance frameworks.",
  neverEvaluated: 'No evaluation yet.',
  noFrameworks: 'No frameworks yet.',
  evaluationNotFound: 'Last evaluation not found. Re-evaluate to refresh.',
  trendPlan: 'Score history is on the Pro plan',
  trendNone: 'No score history yet',
  trendError: "Couldn't load score history.",
  trendCaption: 'Daily, at 02:00 UTC.',
  reviewInInfrastructure: 'Review in Infrastructure →',
  reviewHref: '/infrastructure',
  iamRoles: 'IAM roles and policies',
  scanRunning: 'Scan running…',
  acceptedCaption: 'Only account findings can be accepted for now.',
  iamUsers: 'IAM users: MFA, key age',
  s3Policies: 'S3 bucket policies (all regions)',
} as const

/** One constant for both pages (lib/compliance/evaluation.ts), re-exported where F1/F2 import it. */
export { FRAMEWORK_STALE_AFTER_MS }

const SEVERITIES: ComplianceSeverity[] = ['critical', 'high', 'medium', 'low']
const SEVERITY_RANK: Record<string, number> = { critical: 0, high: 1, medium: 2, low: 3 }
const rank = (s: string) => SEVERITY_RANK[s] ?? 4
const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

// ── Formatting: one place for every date and time on the page (local time, founder answer Q8) ──

const parse = (iso: string | null | undefined): number | null => {
  if (typeof iso !== 'string') return null
  const at = Date.parse(iso)
  return Number.isFinite(at) ? at : null
}

/** "Oct 3", or "Oct 3, 2025" outside the current year, in local time; null for a missing or invalid date. */
export function formatDay(iso: string | null | undefined, now: number): string | null {
  return formatLocalDay(iso, now)
}

/** "today, 4:12 PM", "yesterday, 4:12 PM" or "Oct 3, 4:12 PM", in local time; null for a missing or invalid time. */
export function formatTime(iso: string | null | undefined, now: number): string | null {
  return formatLocalWhen(iso, now)
}

/** A trend point's day: a UTC calendar date ("Daily, at 02:00 UTC."), so it is labelled in UTC, never shifted a day. */
function trendDay(iso: string, now: number): string | null {
  return formatLocalDay(iso, now, 'UTC')
}

// Compliance scores come from lib/compliance/evaluation's scanScore (the stored counts, D1); the stored
// compliance_score is never read.

// ── Findings ──

export type RowStatus = 'open' | 'acknowledged' | 'accepted' | 'dismissed'

export interface FindingRow {
  id: string
  /** The account finding's own id, for its decision requests; null for resource findings. */
  findingId: string | null
  scope: 'account' | 'resource'
  severity: string
  /** The list's short title for a row with a guidance key, else the finding's own (safe) title. */
  title: string
  /** The scanner's full description, the expanded row's first line; null when it is already the title. */
  description: string | null
  where: FindingWhere
  status: RowStatus
  /** "First found Oct 3" (account findings only; resource findings have no first-found date yet). */
  firstFound: string | null
  firstFoundAt: number | null
  recommendation: string | null
  guidanceKey: GuidanceKey | null
  guidance: FixGuidance | null
  webHint: string | null
  /** One statement to merge into the bucket's existing policy (HTTPS-only findings with a bucket name). */
  policyStatement: string | null
  /** Acknowledge / Dismiss / Accept risk exist for account findings only. */
  canDisposition: boolean
  /** Navigation, not remediation. */
  review: { text: string; href: string } | null
}

const ACCOUNT_STATUS: Record<string, RowStatus | undefined> = {
  active: 'open', acknowledged: 'acknowledged', accepted_risk: 'accepted', dismissed: 'dismissed',
}

export const isOpen = (r: FindingRow) => r.status === 'open' || r.status === 'acknowledged'

function withGuidance(key: GuidanceKey | null) {
  return { guidanceKey: key, guidance: guidanceFor(key) ?? null, webHint: key === 'sg_open_web' ? WEB_SERVER_HINT : null }
}

/** The short title when the row has one, with the full description kept for the expanded row. */
function titles(key: GuidanceKey | null, evidence: unknown, own: string) {
  const short = shortTitle(key, evidence)
  return short === null ? { title: own, description: null } : { title: short, description: own }
}

/**
 * The mock's "Where" for an account finding ("launch-wizard-1 · Security group · us-east-1"): a security group by
 * its name alone, since its id is in the description; the id only when there is no name.
 */
function accountWhere(f: AccountSecurityFinding): FindingWhere {
  const where = findingWhere(f)
  const e = f.evidence && typeof f.evidence === 'object' ? (f.evidence as unknown as Record<string, unknown>) : null
  const name = e?.security_group_name
  return f.category === 'networking' && typeof name === 'string' && name.length > 0 ? { ...where, name } : where
}

function accountRow(f: AccountSecurityFinding, now: number): FindingRow | null {
  const status = ACCOUNT_STATUS[f.derived_status]
  if (!status) return null
  const day = formatDay(f.detected_at, now)
  const key = guidanceKeyForAccountFinding(f)
  return {
    id: `account:${f.id}`,
    findingId: f.id,
    scope: 'account',
    severity: f.severity,
    ...titles(key, f.evidence, safeTitle(f)),
    where: accountWhere(f),
    status,
    firstFound: day ? `First found ${day}` : null,
    firstFoundAt: parse(f.detected_at),
    recommendation: f.recommendation ? maskText(f.recommendation) : null,
    ...withGuidance(key),
    policyStatement: null,
    canDisposition: true,
    review: null,
  }
}

const REVIEW = { text: SECURITY_COPY.reviewInInfrastructure, href: SECURITY_COPY.reviewHref }

function resourceRows(source: ResourceFindingsSource): FindingRow[] {
  if (source.kind === 'attention') {
    return source.services
      .filter((s) => s.attention_cause === 'finding' && (s.priority_severity === 'critical' || s.priority_severity === 'high'))
      .map((s) => ({
        id: `resource:${s.id}`,
        findingId: null,
        scope: 'resource' as const,
        severity: s.priority_severity as string,
        title: maskText(s.reason ?? ''),
        description: null,
        where: { name: shortArn(s.name), kind: typeLabel(s.type), region: s.aws_region ?? s.region },
        status: 'open' as const,
        firstFound: null,
        firstFoundAt: null,
        recommendation: null,
        ...withGuidance(null),
        policyStatement: null,
        canDisposition: false,
        review: REVIEW,
      }))
  }
  return source.resources.flatMap((r) => r.issues.map((issue, i) => {
    const key = guidanceKeyForResourceIssue(issue)
    const where = resourceWhere(r)
    return {
      id: `resource:${r.id}:${issue.findingKey ?? i}`,
      findingId: null,
      scope: 'resource' as const,
      severity: issue.severity,
      ...titles(key, null, maskText(issue.issue)),
      where: { ...where, kind: typeLabel(r.resource_type) },
      status: 'open' as const,
      firstFound: null,
      firstFoundAt: null,
      recommendation: issue.recommendation ? maskText(issue.recommendation) : null,
      ...withGuidance(key),
      policyStatement: key === 's3_https_only' && r.resource_name ? buildHttpsOnlyStatement(r.resource_name) : null,
      canDisposition: false,
      review: REVIEW,
    }
  }))
}

/** M8: severity, then the oldest first-found (undated last), then name A–Z. */
export function compareRows(a: FindingRow, b: FindingRow): number {
  return rank(a.severity) - rank(b.severity)
    || (a.firstFoundAt ?? Infinity) - (b.firstFoundAt ?? Infinity)
    || a.where.name.localeCompare(b.where.name, 'en')
    || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

// ── Filters and groups ──

export type FilterKey = 'all' | 'resources' | 'account' | 'accepted' | 'dismissed'

export interface FilterView {
  key: FilterKey
  label: string
  /** null when a source it depends on didn't load. */
  count: number | null
  /** false when the count is from a partial list (the needs-attention list below Pro). */
  complete: boolean
}

export const FILTER_LABELS: Record<FilterKey, string> = {
  all: 'All', resources: 'Resources', account: 'Account', accepted: 'Accepted', dismissed: 'Dismissed',
}

export function filterRows(rows: FindingRow[], key: FilterKey): FindingRow[] {
  switch (key) {
    case 'all': return rows.filter(isOpen)
    case 'resources': return rows.filter((r) => r.scope === 'resource' && isOpen(r))
    case 'account': return rows.filter((r) => r.scope === 'account' && isOpen(r))
    case 'accepted': return rows.filter((r) => r.status === 'accepted')
    case 'dismissed': return rows.filter((r) => r.status === 'dismissed')
  }
}

export interface FindingGroup {
  key: string
  title: string
  /** "<title> · <count>" */
  label: string
  count: number
  severity: string
  rows: FindingRow[]
}

/** Group by issue: by guidance key, else by the finding's own title. Rows keep the list order. */
export function groupRows(rows: FindingRow[]): FindingGroup[] {
  const groups = new Map<string, FindingGroup>()
  for (const row of [...rows].sort(compareRows)) {
    const key = row.guidanceKey ?? `title:${row.title}`
    const title = row.guidance?.title ?? row.title
    const g = groups.get(key) ?? { key, title, label: '', count: 0, severity: row.severity, rows: [] }
    g.rows.push(row)
    g.count += 1
    if (rank(row.severity) < rank(g.severity)) g.severity = row.severity
    groups.set(key, g)
  }
  return [...groups.values()]
    .map((g) => ({ ...g, label: `${g.title} · ${g.count}` }))
    .sort((a, b) => rank(a.severity) - rank(b.severity) || b.count - a.count || a.title.localeCompare(b.title, 'en'))
}

// ── Banner and tiles ──

export interface BannerView {
  tone: 'danger' | 'warning' | 'success' | 'neutral'
  headline: string | null
  detail: string | null
}

export type SeverityCounts = Record<ComplianceSeverity, number>

function countOpen(rows: FindingRow[]): SeverityCounts {
  const c: SeverityCounts = { critical: 0, high: 0, medium: 0, low: 0 }
  for (const r of rows) if (isOpen(r) && r.severity in c) c[r.severity as ComplianceSeverity] += 1
  return c
}

const lastCompletedIso = (c: ServicesCoverage) => c.last_completed_scan?.completed_at ?? c.last_successful_scan_at ?? null

function needReview(c: number, h: number): string {
  const verb = plural(c + h, 'finding needs review', 'findings need review')
  if (c > 0) return h > 0 ? `${c} critical and ${h} high-severity ${verb}` : `${c} critical ${verb}`
  return `${h} high-severity ${verb}`
}

/** M2 with decision 10: loaded findings are always counted; "No critical …" only when every source it rests on loaded. */
function banner(i: SecurityInputs, rows: FindingRow[]): BannerView | null {
  const sources = [i.accountFindings, i.resourceFindings]
  if (sources.some((s) => s.status === 'loading') || i.coverage.status === 'loading') return null
  const failed = sources.some((s) => s.status !== 'ready')
  const partial = i.resourceFindings.status === 'ready' && i.resourceFindings.data.kind === 'attention'
  const coverage = i.coverage.status === 'ready' ? i.coverage.data : null
  const { critical: c, high: h } = countOpen(rows)
  const tone = c > 0 ? 'danger' : h > 0 ? 'warning' : 'neutral'
  const note = failed ? SECURITY_COPY.incomplete : partial ? SECURITY_COPY.attentionOnly : null
  // "In the areas we checked" needs something checked: a connected account and a finished scan. Findings
  // from a scan that stopped early can exist without one.
  const scanned = coverage !== null && coverage.account.connected && !!lastCompletedIso(coverage)

  if (c + h > 0) {
    // A failed or partial source's note always wins: "No critical …" needs every source.
    return { tone, headline: needReview(c, h), detail: note ?? (scanned && c === 0 ? SECURITY_COPY.noCritical : null) }
  }
  if (failed || coverage === null) return { tone: 'warning', headline: SECURITY_COPY.incomplete, detail: null }
  if (partial) return { tone: 'neutral', headline: null, detail: SECURITY_COPY.attentionOnly }
  if (!scanned) return { tone: 'neutral', headline: SECURITY_COPY.noScanYet, detail: null }
  return { tone: 'success', headline: SECURITY_COPY.noCriticalOrHigh, detail: null }
}

export interface ScoreTile { value: number | null; caption: string | null; retry: boolean }

function coverageCaption(c: ServicesCoverage | null): string | null {
  const home = c ? c.account.home_region ?? c.scope.home_region?.region ?? null : null
  if (!c || !home || !lastCompletedIso(c)) return null
  return `resources in ${home}${c.scope.s3.in_last_scan ? ' and S3 buckets in all regions' : ''}, security groups in ${home}, IAM users.`
}

function scoreTile(i: SecurityInputs): ScoreTile {
  const s = i.score
  if (s.status === 'loading') return { value: null, caption: null, retry: false }
  if (s.status === 'plan') return { value: null, caption: SECURITY_COPY.scorePlan, retry: false }
  if (s.status === 'error' || !Number.isFinite(s.data.score)) return { value: null, caption: SECURITY_COPY.scoreError, retry: true }
  if (s.data.isPreliminary) return { value: null, caption: SECURITY_COPY.scorePreliminary, retry: false }
  const where = coverageCaption(i.coverage.status === 'ready' ? i.coverage.data : null)
  return { value: Math.round(s.data.score), caption: where ? `${SECURITY_COPY.scoreFrom}: ${where}` : `${SECURITY_COPY.scoreFrom}.`, retry: false }
}

export interface FindingsTile {
  total: number | null
  /** "<c> critical · <h> high · <m> medium · <l> low" */
  breakdown: string | null
  complete: boolean
  note: string | null
}

function findingsTile(i: SecurityInputs, rows: FindingRow[]): FindingsTile | null {
  const sources = [i.accountFindings, i.resourceFindings]
  if (sources.some((s) => s.status === 'loading')) return null
  const loaded = sources.filter((s) => s.status === 'ready').length
  if (loaded === 0) return { total: null, breakdown: null, complete: false, note: SECURITY_COPY.incomplete }
  const c = countOpen(rows)
  const failed = loaded < sources.length
  const partial = i.resourceFindings.status === 'ready' && i.resourceFindings.data.kind === 'attention'
  return {
    total: SEVERITIES.reduce((n, s) => n + c[s], 0),
    breakdown: `${c.critical} critical · ${c.high} high · ${c.medium} medium · ${c.low} low`,
    complete: !failed && !partial,
    note: failed ? SECURITY_COPY.incomplete : partial ? SECURITY_COPY.attentionOnly : null,
  }
}

// ── Compliance frameworks (M5, safeguard 2) ──

export type FrameworkState = EvaluationState

export const FRAMEWORK_STATE_LABEL: Record<FrameworkState, string> = {
  current: 'Current', running: 'Running', failed: 'Failed', out_of_date: 'Out of date', never: 'Never evaluated',
  not_found: 'Last evaluation not found',
}

export interface FrameworkView {
  id: string
  name: string
  state: FrameworkState
  label: string
  text: string
  /** Only for a current result; never while a run is active or after the latest run failed. */
  score: string | null
  /** The latest completed evaluation, formatted ("Oct 3"), or null. */
  lastEvaluated: string | null
  lastEvaluatedAt: number | null
  /** A current result with no counted resource (D1): "No rules applied to your resources."; else null. */
  scoreNote: string | null
  /** Running only: when the run started; the page polls from it. Null in every other state. */
  runningSince: number | null
  /** Started in place (F3). Running has none, until the run has been active past the poll ceiling. */
  action: { kind: 'try_again' | 'evaluate_now' | 're_evaluate'; label: string } | null
}

export interface FrameworksView {
  status: 'loading' | 'plan' | 'error' | 'ready'
  note: string | null
  action: { label: string; href: string } | null
  frameworks: FrameworkView[]
}

/**
 * The compliance panel's buttons (the mock, founder F2c): Out of date and not found "Re-evaluate now", Failed
 * "Try again", Never evaluated "Evaluate now"; F3 starts each in place.
 */
export const RE_EVALUATE_NOW = 'Re-evaluate now'

/** What the page knows that the scan list may not show yet (F3): a run it just started, per framework. */
export type { EvaluationOverlay }

/**
 * The scan list is the org's newest scans across every framework, so a framework
 * with no scan in it has either never been evaluated or was evaluated before the
 * list's window. `historyComplete` (the list came back shorter than its limit) is
 * the only case where "never" is known; otherwise the model says it didn't find
 * the last evaluation, and shows no score. The state itself is lib/compliance's,
 * shared with the Compliance page; the wording is this page's.
 */
export function describeFramework(
  f: ComplianceFramework,
  scans: ComplianceScan[],
  now: number,
  historyComplete = false,
  overlay: EvaluationOverlay = { clock: now, startedLocally: {} },
): FrameworkView {
  const e = evaluateFramework(f.id, scans, Math.max(now, overlay.clock), historyComplete, overlay.startedLocally[f.id] ?? null)
  const lastEvaluated = e.lastDone ? formatDay(e.lastDone.completed_at ?? e.lastDone.created_at, now) : null
  const base = { id: f.id, name: f.name, lastEvaluated, lastEvaluatedAt: e.lastEvaluatedAt }
  const view = (text: string, action: FrameworkView['action'], extra: Partial<FrameworkView> = {}): FrameworkView =>
    ({ ...base, state: e.state, label: FRAMEWORK_STATE_LABEL[e.state], text, score: null, scoreNote: null, runningSince: null, action, ...extra })
  const reEvaluate = { kind: 're_evaluate', label: RE_EVALUATE_NOW } as const

  switch (e.state) {
    case 'running': {
      const started = e.startedAt === null ? null : formatTime(new Date(e.startedAt).toISOString(), now)
      // Past the poll ceiling the run may never end (nothing marks a crashed run failed): say so, and offer the
      // start again; a 409 answer keeps this text (founder answer, Oct 27).
      return e.overdue
        ? view(`Still running — started ${started ?? 'recently'}, taking longer than usual.`, reEvaluate, { runningSince: e.startedAt })
        : view(`Started ${started ?? 'recently'}. The previous result is hidden until this run finishes.`, null, { runningSince: e.startedAt })
    }
    case 'failed': {
      const on = formatDay(e.latest!.completed_at ?? e.latest!.started_at ?? e.latest!.created_at, now)
      return view(`The last run failed${on ? ` on ${on}` : ''}. No score is shown as current.`, { kind: 'try_again', label: 'Try again' })
    }
    case 'never':
      return view(SECURITY_COPY.neverEvaluated, { kind: 'evaluate_now', label: 'Evaluate now' })
    // A completed scan without usable counts was an evaluation: never "never".
    case 'not_found':
      return view(SECURITY_COPY.evaluationNotFound, reEvaluate)
    case 'out_of_date':
      return view(`Last evaluated ${lastEvaluated}, over 7 days ago. Findings may have changed.`, reEvaluate)
    case 'current':
      return e.score?.kind === 'score'
        ? view(`Evaluated ${lastEvaluated} · ${e.score.value}%`, null, { score: e.score.value })
        : view(`Evaluated ${lastEvaluated} · —`, null, { scoreNote: EVALUATION_COPY.noRulesApplied })
  }
}

function frameworksView(i: SecurityInputs, now: number, overlay?: EvaluationOverlay): FrameworksView {
  const f = i.frameworks
  if (f.status === 'loading') return { status: 'loading', note: null, action: null, frameworks: [] }
  if (f.status === 'plan') return { status: 'plan', note: SECURITY_COPY.frameworksPlan, action: SEE_PLANS, frameworks: [] }
  if (f.status === 'error') return { status: 'error', note: SECURITY_COPY.frameworksError, action: null, frameworks: [] }
  const { scans, scansLimit } = f.data
  const historyComplete = Number.isInteger(scansLimit) && scansLimit > 0 && scans.length < scansLimit
  return { status: 'ready', note: null, action: null, frameworks: f.data.frameworks.map((fw) => describeFramework(fw, scans, now, historyComplete, overlay)) }
}

const STATE_PRIORITY: Record<FrameworkState, number> = { failed: 0, out_of_date: 1, not_found: 2, never: 3, running: 4, current: 5 }

export interface ComplianceTile { label: string; lastEvaluated: string | null }

function complianceTile(view: FrameworksView): ComplianceTile | null {
  if (view.status === 'loading') return null
  if (view.status !== 'ready') return { label: view.note!, lastEvaluated: null }
  const [worst] = [...view.frameworks].sort((a, b) =>
    STATE_PRIORITY[a.state] - STATE_PRIORITY[b.state] || (a.lastEvaluatedAt ?? -Infinity) - (b.lastEvaluatedAt ?? -Infinity))
  if (!worst) return { label: SECURITY_COPY.noFrameworks, lastEvaluated: null }
  return { label: worst.label, lastEvaluated: worst.lastEvaluated ? `Last evaluated ${worst.lastEvaluated}` : null }
}

// ── Trend ──

export interface TrendView {
  note: string | null
  points: { label: string; score: number }[]
  /** "+3 pts", "-3 pts", "±0 pts"; null with fewer than 2 points. */
  delta: string | null
  caption: string
}

function trendView(i: SecurityInputs, now: number): TrendView | null {
  const t = i.trend
  const caption = SECURITY_COPY.trendCaption
  if (t.status === 'loading') return null
  if (t.status === 'plan') return { note: SECURITY_COPY.trendPlan, points: [], delta: null, caption }
  if (t.status === 'error') return { note: SECURITY_COPY.trendError, points: [], delta: null, caption }
  const points = [...(t.data.history ?? [])]
    .filter((p) => Number.isFinite(p.score) && parse(p.date) !== null)
    .sort((a, b) => parse(a.date)! - parse(b.date)!)
    .map((p) => ({ label: trendDay(p.date, now)!, score: p.score }))
  if (points.length === 0) return { note: SECURITY_COPY.trendNone, points, delta: null, caption }
  let delta: string | null = null
  if (points.length >= 2) {
    const d = Math.round(points[points.length - 1].score - points[0].score)
    delta = d > 0 ? `+${d} pts` : d < 0 ? `-${-d} pts` : '±0 pts'
  }
  return { note: null, points, delta, caption }
}

// ── What we checked ──

export interface CheckedLine { key: string; label: string; status: 'checked' | 'not_checked' | null }

export function securityCheckedLines(coverage: SecLoadable<ServicesCoverage>): CheckedLine[] {
  if (coverage.status === 'loading') return []
  if (coverage.status !== 'ready') return [{ key: 'error', label: OVERVIEW_COPY.coverageError, status: null }]
  const c = coverage.data
  if (!c.account.connected) return [{ key: 'nothing', label: OVERVIEW_COPY.nothingChecked, status: null }]
  const home = c.account.home_region ?? c.scope.home_region?.region ?? '—'
  const done = !!lastCompletedIso(c)
  const lines: CheckedLine[] = [
    { key: 'security-groups', label: `Security groups (${home})`, status: done ? 'checked' : 'not_checked' },
    { key: 's3', label: SECURITY_COPY.s3Policies, status: done && c.scope.s3.in_last_scan ? 'checked' : 'not_checked' },
    { key: 'iam-users', label: SECURITY_COPY.iamUsers, status: done ? 'checked' : 'not_checked' },
    { key: 'iam-roles', label: SECURITY_COPY.iamRoles, status: 'not_checked' },
  ]
  const counts = hasRegionCoverage(c) ? regionCounts(c) : null
  if (counts && counts.enabled !== null) {
    const n = Math.max(0, counts.enabled - counts.checked)
    if (n > 0) lines.push({ key: 'other-regions', label: `Other ${n} ${plural(n, 'region', 'regions')}`, status: 'not_checked' })
  } else {
    lines.push({ key: 'other-regions', label: 'Other regions (region list not read yet)', status: 'not_checked' })
  }
  return lines
}

// ── Header scan line and "Not checked yet" (founder answers 6, 11, 12, Oct 26) ──

export type ScanLineState = 'finished' | 'running' | 'failed' | 'none'

/** The header's dot and line. The dot is decorative; `text` carries the meaning. */
export interface ScanLine { state: ScanLineState; text: string }

/** The header's scan time in the viewer's local time, no zone suffix (founder answers 6 and Q8); null for a missing or invalid time. */
export function formatScanWhen(iso: string | null | undefined, now: number): string | null {
  return formatLocalWhen(iso, now)
}

/**
 * Running → "Scan running…"; the latest attempt failed → "Last scan failed: <time>"; a finished scan →
 * "Last scan: <time>"; otherwise "No scan has finished yet.". A failed attempt with no time to print falls
 * back to the finished/none line rather than inventing one. Null while coverage loads or failed.
 */
export function scanLine(coverage: SecLoadable<ServicesCoverage>, now: number): ScanLine | null {
  if (coverage.status !== 'ready') return null
  const c = coverage.data
  if (c.scan_in_progress) return { state: 'running', text: SECURITY_COPY.scanRunning }
  if (c.last_scan?.status === 'failed') {
    const at = formatScanWhen(c.last_scan.completed_at ?? c.last_scan.started_at, now)
    if (at) return { state: 'failed', text: `Last scan failed: ${at}` }
  }
  const done = formatScanWhen(lastCompletedIso(c), now)
  return done ? { state: 'finished', text: `Last scan: ${done}` } : { state: 'none', text: SECURITY_COPY.noScanYet }
}

/** "Not checked yet: <n> regions · IAM roles and policies" (Infra's rule, PLAN §9.3); null unless coverage loaded for a connected account. */
export function notCheckedText(coverage: SecLoadable<ServicesCoverage>): string | null {
  if (coverage.status !== 'ready' || !coverage.data.account.connected) return null
  const c = coverage.data
  const counts = hasRegionCoverage(c) ? regionCounts(c) : null
  const parts: string[] = []
  if (counts && counts.enabled !== null) {
    const n = Math.max(0, counts.enabled - counts.checked)
    if (n > 0) parts.push(`${n} ${plural(n, 'region', 'regions')}`)
  } else {
    parts.push('other regions (region list not read yet)')
  }
  parts.push(SECURITY_COPY.iamRoles)
  return `Not checked yet: ${parts.join(' · ')}`
}

// ── Labels and empty lines for the findings list (founder answers 9, 10; e2 13, 14, 16) ──

export const SEVERITY_LABEL: Record<string, string> = { critical: 'Critical', high: 'High', medium: 'Medium', low: 'Low' }

/** Open rows have no chip. */
export const STATUS_LABEL: Record<RowStatus, string | null> = {
  open: null, acknowledged: 'Acknowledged', accepted: 'Risk accepted', dismissed: 'Dismissed',
}

export const SCOPE_LABEL: Record<FindingRow['scope'], string> = { account: 'Account', resource: 'Resource' }

export const FILTER_EMPTY: Record<FilterKey, string> = {
  all: 'No findings in the areas we checked.',
  resources: 'No resource findings.',
  account: 'No account findings.',
  accepted: 'No accepted findings.',
  dismissed: 'No dismissed findings.',
}

/**
 * What a filter with no rows says. The "No … findings." lines only when every findings source loaded
 * (e2 16); "in the areas we checked" claims (All, Resources, Account) also need a finished scan on a
 * connected account, and Resources/All need the full resource list, not the below-Pro attention list.
 * Like the banner: nothing while coverage loads, and the incomplete line when coverage failed, because
 * whether a scan finished is then unknown (never "No scan has finished yet.").
 */
function emptyTexts(i: SecurityInputs): Record<FilterKey, string> | null {
  const sources = [i.accountFindings, i.resourceFindings]
  if (sources.some((s) => s.status === 'loading') || i.coverage.status === 'loading') return null
  const failed = sources.some((s) => s.status !== 'ready')
  const partial = i.resourceFindings.status === 'ready' && i.resourceFindings.data.kind === 'attention'
  const coverage = i.coverage.status === 'ready' ? i.coverage.data : null
  const scanned = coverage !== null && coverage.account.connected && !!lastCompletedIso(coverage)
  const text = (key: FilterKey): string => {
    if (failed) return SECURITY_COPY.incomplete
    if (coverage === null && (key === 'all' || key === 'resources' || key === 'account')) return SECURITY_COPY.incomplete
    if (partial && (key === 'all' || key === 'resources')) return SECURITY_COPY.attentionOnly
    if (!scanned && (key === 'all' || key === 'resources' || key === 'account')) return SECURITY_COPY.noScanYet
    return FILTER_EMPTY[key]
  }
  return { all: text('all'), resources: text('resources'), account: text('account'), accepted: text('accepted'), dismissed: text('dismissed') }
}

// ── The page ──

export interface SecurityView {
  banner: BannerView | null
  tiles: { score: ScoreTile; findings: FindingsTile | null; compliance: ComplianceTile | null; anomalies: string | null }
  /** Every row (open, accepted and dismissed), in list order; use filterRows / groupRows. */
  rows: FindingRow[]
  filters: FilterView[]
  frameworks: FrameworksView
  trend: TrendView | null
  checked: CheckedLine[]
  /** The header's scan line (null while coverage loads or failed). */
  scan: ScanLine | null
  /** The banner's right-hand line. */
  notChecked: string | null
  /** What each filter says when it has no rows; null while a findings source loads. */
  empty: Record<FilterKey, string> | null
}

/** `overlay`: runs this page started that the scan list doesn't show yet, and the poll clock (F3). */
export function describeSecurity(i: SecurityInputs, now: number, overlay?: EvaluationOverlay): SecurityView {
  const account = i.accountFindings.status === 'ready'
    ? i.accountFindings.data.map((f) => accountRow(f, now)).filter((r): r is FindingRow => r !== null)
    : []
  const resources = i.resourceFindings.status === 'ready' ? resourceRows(i.resourceFindings.data) : []
  const rows = [...account, ...resources].sort(compareRows)

  const accountOk = i.accountFindings.status === 'ready'
  const resourcesOk = i.resourceFindings.status === 'ready'
  const resourcesComplete = resourcesOk && i.resourceFindings.status === 'ready' && i.resourceFindings.data.kind === 'full'
  const count = (key: FilterKey) => filterRows(rows, key).length
  const filters: FilterView[] = [
    { key: 'all', label: FILTER_LABELS.all, count: accountOk && resourcesOk ? count('all') : null, complete: accountOk && resourcesComplete },
    { key: 'resources', label: FILTER_LABELS.resources, count: resourcesOk ? count('resources') : null, complete: resourcesComplete },
    { key: 'account', label: FILTER_LABELS.account, count: accountOk ? count('account') : null, complete: accountOk },
    { key: 'accepted', label: FILTER_LABELS.accepted, count: accountOk ? count('accepted') : null, complete: accountOk },
    { key: 'dismissed', label: FILTER_LABELS.dismissed, count: accountOk ? count('dismissed') : null, complete: accountOk },
  ]

  const frameworks = frameworksView(i, now, overlay)
  const a = i.anomalies
  const anomalies = a.status === 'ready' && Number.isFinite(a.data.active) && a.data.active >= 0
    ? (a.data.active === 0 ? SECURITY_COPY.anomaliesNone : `${a.data.active} open`)
    : null

  return {
    banner: banner(i, rows),
    tiles: { score: scoreTile(i), findings: findingsTile(i, rows), compliance: complianceTile(frameworks), anomalies },
    rows,
    filters,
    frameworks,
    trend: trendView(i, now),
    checked: securityCheckedLines(i.coverage),
    scan: scanLine(i.coverage, now),
    notChecked: notCheckedText(i.coverage),
    empty: emptyTexts(i),
  }
}
