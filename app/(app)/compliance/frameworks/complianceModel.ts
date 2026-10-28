/**
 * The Compliance page's real-mode view model (Security V2 F3b, founder decisions of Oct 27). Pure: no React, no
 * fetch, no Date.now(); `now` and the start overlay are passed in. Framework state, the score and staleness all
 * come from lib/compliance/evaluation, the same helper the Security page uses; times from lib/utils/localTime.
 *
 * - D1: a score is compliant ÷ (compliant + non-compliant) from the stored counts; nothing counted is "—" with
 *   "No rules applied to your resources.". The stored compliance_score is never read.
 * - D2 / Q3: the score tiles describe the enabled framework with the most recently completed evaluation and name
 *   it. While that framework's newest run is running, or after it failed, they show "—" (D7).
 * - D2 / Q4: the out-of-date banner counts every enabled framework whose newest run is a completed evaluation older
 *   than FRAMEWORK_STALE_AFTER_MS.
 * - Q1: the frameworks tile counts enabled custom frameworks plus the Security Hub standards DevControl evaluates;
 *   never runs.
 * - D7: a 402 or a failed read never becomes an empty state.
 * - D3 / Q5 / Q6: the five Security Hub states, each with its own pill and card text.
 */
import type { ComplianceFramework, ComplianceScan } from '@/lib/services/compliance-frameworks.service'
import type { SecurityHubCapability } from '@/lib/services/security-hub.service'
import {
  EVALUATION_COPY,
  byNewest,
  evaluateFramework,
  scanScore,
  type EvaluationOverlay,
  type FrameworkEvaluation,
} from '@/lib/compliance/evaluation'
import type { FrameworkResults } from '@/lib/compliance/useFrameworkEvaluations'
import { formatLocalDay, formatLocalWhen } from '@/lib/utils/localTime'

export type Loadable<T> = { status: 'loading' } | { status: 'plan' } | { status: 'error' } | { status: 'ready'; data: T }

export const COMPLIANCE_COPY = {
  loadFailed: "Couldn't load compliance results. Try again.",
  noScoreCurrent: 'No score is shown as current.',
  notYetEvaluated: 'Not yet evaluated',
  loading: 'Loading…',
  unableToLoad: 'Unable to load',
  fromLatest: 'From latest completed evaluation',
  outOfDate: ' · out of date',
  noFrameworks: 'No frameworks yet.',
  reEvaluateNow: 'Re-evaluate now',
  review: 'Review',
  runScan: 'Run Scan',
  viewerCantAddFrameworks: "Viewers can't add frameworks.",
  // The sync is requireAdmin (security-hub.routes.ts:61): members and viewers alike (founder follow-up, Oct 27).
  onlyAdminsSyncSecurityHub: 'Only admins can sync Security Hub.',
  // The failed banner (founder wording, Oct 28): mirrors the out-of-date banner; "Try again" on the newest failed run.
  tryAgain: 'Try again',
  // D3: the Security Hub card body, per state (Q5: in place of the "isn't enabled" text).
  shNotEnabled: 'Turn it on in your AWS account, then sync to evaluate CIS, PCI DSS and NIST.',
  shMissingPermission: "DevControl can't read Security Hub — the connected role is missing a permission.",
  shCheckFailed: "Couldn't check Security Hub. Try again later.",
  needsSecurityHub: 'Needs Security Hub',
} as const

export const TILE_LABELS = {
  score: 'Overall Compliance Score',
  critical: 'Critical Issues',
  high: 'High Risk Issues',
  frameworks: 'Frameworks',
} as const

/** Roles the server lets add frameworks, edit rules and start runs (requireMember), and sync Security Hub (requireAdmin). */
export const MEMBER_ROLES: readonly string[] = ['owner', 'admin', 'member']
export const ADMIN_ROLES: readonly string[] = ['owner', 'admin']

// ── Security Hub (D3) ──

/** The five states the page tells apart. A failed read and an unknown status are "error", never "not enabled". */
export type SecurityHubState = 'never_synced' | 'enabled' | 'not_granted' | 'not_available' | 'error'

export interface SecurityHubInput {
  /** The capability read failed (useSecurityHub's `error`). */
  failed: boolean
  capability: SecurityHubCapability | null
  /** Per standard DevControl evaluates: Security Hub reports it enabled and the standard is on in the account. */
  evaluated: { cis: boolean; pci: boolean; nist: boolean }
}

export function securityHubState(sh: Pick<SecurityHubInput, 'failed' | 'capability'>): SecurityHubState {
  if (sh.failed) return 'error'
  if (!sh.capability || sh.capability.syncStatus === 'NEVER_RUN') return 'never_synced'
  switch (sh.capability.capabilityStatus) {
    case 'ENABLED': return 'enabled'
    case 'NOT_GRANTED': return 'not_granted'
    case 'NOT_AVAILABLE': return 'not_available'
    default: return 'error'
  }
}

export interface SecurityHubView {
  state: SecurityHubState
  /** The status pill. */
  pill: string
  /** The card body text for this state; null keeps the general description. */
  body: string | null
  /** Q6: "Needs Security Hub" on the CIS, PCI DSS and NIST cards, only when Security Hub isn't enabled. */
  needsSecurityHub: boolean
}

const SH_PILL: Record<SecurityHubState, string> = {
  never_synced: 'Not checked yet',
  enabled: 'Connected',
  not_granted: 'Permission required',
  not_available: 'Not enabled',
  error: 'Check failed',
}

const SH_BODY: Record<SecurityHubState, string | null> = {
  never_synced: null,
  enabled: null,
  not_granted: COMPLIANCE_COPY.shMissingPermission,
  not_available: COMPLIANCE_COPY.shNotEnabled,
  error: COMPLIANCE_COPY.shCheckFailed,
}

export function describeSecurityHub(sh: Pick<SecurityHubInput, 'failed' | 'capability'>): SecurityHubView {
  const state = securityHubState(sh)
  return { state, pill: SH_PILL[state], body: SH_BODY[state], needsSecurityHub: state === 'not_available' }
}

// ── Tiles, banner, history ──

export interface Tile { label: string; value: string; sub: string; note: string | null }

export type BannerView =
  | { kind: 'one'; text: string; frameworkId: string }
  | { kind: 'many'; text: string }

/** Frameworks whose newest run failed: one named with "Try again", or a count with "Review" (founder wording, Oct 28). */
export type FailedBannerView = BannerView

export interface HistoryRow {
  id: string
  frameworkId: string
  status: ComplianceScan['status']
  text: string
  note: string | null
  /** Q4: the newest row of each framework that isn't running offers "Re-evaluate now". */
  canReEvaluate: boolean
  /** The action's label: "Try again" on a framework's newest run when it failed, otherwise "Re-evaluate now". */
  action: string
}

export interface ComplianceView {
  status: Loadable<unknown>['status']
  tiles: { score: Tile; critical: Tile; high: Tile; frameworks: Tile }
  banner: BannerView | null
  /** The enabled frameworks whose newest run failed; shown alongside the out-of-date banner, never instead of it. */
  failed: FailedBannerView | null
  history: HistoryRow[]
}

const tile = (label: string, value: string, sub: string, note: string | null = null): Tile => ({ label, value, sub, note })

const count = (n: unknown): string | null => (Number.isInteger(n) && (n as number) >= 0 ? String(n) : null)

const plural = (n: number, one: string, many: string) => (n === 1 ? one : many)

/** Q1: enabled custom frameworks (compliance_frameworks.enabled), never runs. */
export function countedFrameworks(frameworks: ComplianceFramework[]): ComplianceFramework[] {
  return frameworks.filter((f) => f.framework_type === 'custom' && f.enabled === true)
}

function frameworksTile(results: Loadable<FrameworkResults>, sh: SecurityHubInput): Tile {
  const label = TILE_LABELS.frameworks
  if (results.status === 'loading') return tile(label, '—', COMPLIANCE_COPY.loading)
  if (results.status !== 'ready') return tile(label, '—', COMPLIANCE_COPY.unableToLoad)
  const custom = countedFrameworks(results.data.frameworks).length
  // Q6: a standard counts only if Security Hub is enabled, the standard is on, and DevControl evaluates it.
  const standards = securityHubState(sh) === 'enabled' ? [sh.evaluated.cis, sh.evaluated.pci, sh.evaluated.nist].filter(Boolean).length : 0
  const total = custom + standards
  if (total === 0) return tile(label, '0', COMPLIANCE_COPY.noFrameworks)
  const sub = standards > 0
    ? `${custom} custom · ${standards} Security Hub ${plural(standards, 'standard', 'standards')}`
    : `${custom} custom ${plural(custom, 'framework', 'frameworks')} evaluated`
  return tile(label, String(total), sub)
}

interface Evaluated { framework: ComplianceFramework; e: FrameworkEvaluation }

function evaluateAll(data: FrameworkResults, now: number, overlay: EvaluationOverlay): Evaluated[] {
  const historyComplete = Number.isInteger(data.scansLimit) && data.scansLimit > 0 && data.scans.length < data.scansLimit
  const clock = Math.max(now, overlay.clock)
  return countedFrameworks(data.frameworks).map((framework) => ({
    framework,
    e: evaluateFramework(framework.id, data.scans, clock, historyComplete, overlay.startedLocally[framework.id] ?? null),
  }))
}

/** D2: the enabled framework with the most recently completed evaluation; ties by name, then id. */
function tileFramework(all: Evaluated[]): Evaluated | null {
  const done = all.filter((x) => x.e.lastEvaluatedAt !== null)
  done.sort((a, b) => b.e.lastEvaluatedAt! - a.e.lastEvaluatedAt!
    || a.framework.name.localeCompare(b.framework.name) || a.framework.id.localeCompare(b.framework.id))
  return done[0] ?? null
}

const whenOf = (s: ComplianceScan, now: number) => formatLocalWhen(s.completed_at ?? s.created_at, now) ?? ''

function scoreTiles(results: Loadable<FrameworkResults>, now: number, overlay: EvaluationOverlay) {
  const all = (label: string, sub: string) => tile(label, '—', sub)
  if (results.status !== 'ready') {
    const sub = results.status === 'loading' ? COMPLIANCE_COPY.loading : COMPLIANCE_COPY.unableToLoad
    return { score: all(TILE_LABELS.score, sub), critical: all(TILE_LABELS.critical, sub), high: all(TILE_LABELS.high, sub) }
  }
  const pick = tileFramework(evaluateAll(results.data, now, overlay))
  if (!pick) {
    const sub = COMPLIANCE_COPY.notYetEvaluated
    return { score: all(TILE_LABELS.score, sub), critical: all(TILE_LABELS.critical, sub), high: all(TILE_LABELS.high, sub) }
  }
  const { framework, e } = pick
  // D7 / Q3: a newer run of this framework is running, failed, or has no usable result: no score is current.
  if (e.state !== 'current' && e.state !== 'out_of_date') {
    const sub = COMPLIANCE_COPY.noScoreCurrent
    return { score: all(TILE_LABELS.score, sub), critical: all(TILE_LABELS.critical, sub), high: all(TILE_LABELS.high, sub) }
  }
  const done = e.lastDone!
  const stale = e.state === 'out_of_date' ? COMPLIANCE_COPY.outOfDate : ''
  const s = scanScore(done)
  const scoreSub = `${framework.name} · evaluated ${whenOf(done, now)}${stale}`
  const score = s.kind === 'score'
    ? tile(TILE_LABELS.score, `${s.value}%`, scoreSub)
    : tile(TILE_LABELS.score, '—', scoreSub, s.kind === 'no_rules' ? EVALUATION_COPY.noRulesApplied : null)
  const issues = (label: string, n: unknown) => tile(label, count(n) ?? '—', `${COMPLIANCE_COPY.fromLatest}${stale}`)
  return { score, critical: issues(TILE_LABELS.critical, done.critical_issues), high: issues(TILE_LABELS.high, done.high_issues) }
}

function banner(results: Loadable<FrameworkResults>, now: number, overlay: EvaluationOverlay): BannerView | null {
  if (results.status !== 'ready') return null
  const stale = evaluateAll(results.data, now, overlay).filter((x) => x.e.state === 'out_of_date')
  if (stale.length === 0) return null
  if (stale.length > 1) return { kind: 'many', text: `${stale.length} frameworks are out of date.` }
  const { framework, e } = stale[0]
  return { kind: 'one', frameworkId: framework.id, text: `Results are out of date — ${framework.name} was last evaluated ${whenOf(e.lastDone!, now)}.` }
}

/** With the day of the failed run (completed, else started, else created). */
function failedBanner(results: Loadable<FrameworkResults>, now: number, overlay: EvaluationOverlay): FailedBannerView | null {
  if (results.status !== 'ready') return null
  const failed = evaluateAll(results.data, now, overlay).filter((x) => x.e.state === 'failed')
  if (failed.length === 0) return null
  if (failed.length > 1) return { kind: 'many', text: `${failed.length} frameworks failed their last evaluation.` }
  const { framework, e } = failed[0]
  const latest = e.latest!
  const on = formatLocalDay(latest.completed_at ?? latest.started_at ?? latest.created_at, now)
  return {
    kind: 'one',
    frameworkId: framework.id,
    text: `The last evaluation of ${framework.name} failed${on ? ` on ${on}` : ''}. ${COMPLIANCE_COPY.noScoreCurrent}`,
  }
}

function historyText(s: ComplianceScan, name: string, now: number): { text: string; note: string | null } {
  if (s.status === 'completed') {
    const score = scanScore(s)
    return {
      text: `${name} · Completed ${whenOf(s, now)} · ${score.kind === 'score' ? `${score.value}%` : '—'}`,
      note: score.kind === 'no_rules' ? EVALUATION_COPY.noRulesApplied : null,
    }
  }
  if (s.status === 'failed') {
    return { text: `${name} · Failed ${formatLocalWhen(s.completed_at ?? s.started_at ?? s.created_at, now) ?? ''}`, note: null }
  }
  return { text: `${name} · Running · started ${formatLocalWhen(s.started_at ?? s.created_at, now) ?? ''}`, note: null }
}

/** D4 / D5: every run, failed ones and duplicates included, newest first; one row per run id. */
function history(results: Loadable<FrameworkResults>, now: number, overlay: EvaluationOverlay): HistoryRow[] {
  if (results.status !== 'ready') return []
  const { frameworks, scans } = results.data
  const byId = new Map(frameworks.map((f) => [f.id, f]))
  const states = new Map(evaluateAll(results.data, now, overlay).map((x) => [x.framework.id, x.e]))
  const offered = new Set<string>()
  return [...scans].sort(byNewest).map((s) => {
    const framework = byId.get(s.framework_id)
    const e = states.get(s.framework_id)
    // Only the newest row of a framework still in the list, and not while a run of it is live.
    const canReEvaluate = !!framework && !!e && !offered.has(s.framework_id) && (e.state !== 'running' || e.overdue)
    offered.add(s.framework_id)
    const action = canReEvaluate && s.status === 'failed' && e!.state === 'failed' ? COMPLIANCE_COPY.tryAgain : COMPLIANCE_COPY.reEvaluateNow
    return { id: s.id, frameworkId: s.framework_id, status: s.status, canReEvaluate, action, ...historyText(s, framework?.name ?? 'Custom framework', now) }
  })
}

export function describeCompliance(
  results: Loadable<FrameworkResults>,
  sh: SecurityHubInput,
  now: number,
  overlay: EvaluationOverlay = { clock: now, startedLocally: {} },
): ComplianceView {
  return {
    status: results.status,
    tiles: { ...scoreTiles(results, now, overlay), frameworks: frameworksTile(results, sh) },
    banner: banner(results, now, overlay),
    failed: failedBanner(results, now, overlay),
    history: history(results, now, overlay),
  }
}
