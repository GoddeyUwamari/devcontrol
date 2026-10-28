/**
 * One reading of a custom compliance framework's evaluations, shared by the Security Overview and the
 * Compliance page (Security V2 F3, founder decisions of Oct 27, 2026). Pure: no React, no fetch, no
 * Date.now(); `now` is passed in.
 *
 * - The score comes from the stored counts: compliant ÷ (compliant + non-compliant) (D1). The stored
 *   compliance_score divides by every resource fetched, including those no rule could evaluate, and is
 *   never read. No counted resource → "—" with NO_RULES_APPLIED, never 0% or 100%.
 * - The framework's newest run decides its state. A running or failed newest run never shows an earlier
 *   score as current (safeguard 2, Oct 23).
 * - A run that has been active longer than EVALUATION_POLL_CEILING_MS is no longer polled, and its
 *   framework offers the start action again: nothing ever marks a crashed run failed, and the server
 *   answers 409 while a run really is active (founder answer, Oct 27).
 */
import type { ComplianceScan } from '@/lib/services/compliance-frameworks.service'

/** A framework result older than this is out of date (founder decision, Oct 23: one named constant, 7 days). */
export const FRAMEWORK_STALE_AFTER_MS = 7 * 24 * 60 * 60 * 1000

/** While an evaluation runs, its framework is read again this often: every 5 s for the first minute, then every 15 s. */
export const EVALUATION_POLL_FAST_MS = 5_000
export const EVALUATION_POLL_FAST_FOR_MS = 60_000
export const EVALUATION_POLL_SLOW_MS = 15_000
/** After this long a run is no longer polled and the start action shows again. */
export const EVALUATION_POLL_CEILING_MS = 15 * 60 * 1000

export const EVALUATION_COPY = {
  noRulesApplied: 'No rules applied to your resources.',
  viewerCantStart: "Viewers can't start an evaluation",
  startFailed: "Couldn't start the evaluation. Try again.",
  enterprisePlan: 'Compliance frameworks are on the Enterprise plan.',
} as const

/** The upgrade page, after EVALUATION_COPY.enterprisePlan (both pages' plan state, and a start answered 402). */
export const SEE_PLANS = { label: 'See plans', href: '/settings/billing/upgrade' } as const

/** The server's member floor on POST /:id/scan (requireMember); the UI only mirrors it, the server decides. */
export const CAN_START_EVALUATION: readonly string[] = ['owner', 'admin', 'member']

/** The 409 body's code when this framework already has an active run (the per-framework lock, CCS:136-153). */
export const SCAN_IN_PROGRESS = 'SCAN_IN_PROGRESS'

/** Why a start didn't happen: a viewer (403), a plan below Enterprise (402), or anything else. */
export type StartProblem = 'viewer' | 'plan' | 'failed'

/** What each page shows under the action when a start didn't happen; a 402 adds SEE_PLANS. */
export const START_PROBLEM_TEXT: Readonly<Record<StartProblem, string>> = {
  viewer: EVALUATION_COPY.viewerCantStart,
  plan: EVALUATION_COPY.enterprisePlan,
  failed: EVALUATION_COPY.startFailed,
}

export type ScanScore =
  | { kind: 'score'; value: string }
  /** The run counted no resource either way: no rule applied to (or could evaluate) any resource. */
  | { kind: 'no_rules' }
  /** The counts are missing or not usable. */
  | { kind: 'unknown' }

const count = (value: unknown): number | null => {
  const n = typeof value === 'string' ? (value.trim() === '' ? NaN : Number(value)) : typeof value === 'number' ? value : NaN
  return Number.isInteger(n) && n >= 0 ? n : null
}

/** A completed run's score as a whole percent, never rounded up (99.6 is "99"), from its stored counts (D1). */
export function scanScore(scan: Pick<ComplianceScan, 'compliant_resources' | 'non_compliant_resources'>): ScanScore {
  const compliant = count(scan.compliant_resources)
  const nonCompliant = count(scan.non_compliant_resources)
  if (compliant === null || nonCompliant === null) return { kind: 'unknown' }
  const counted = compliant + nonCompliant
  if (counted === 0) return { kind: 'no_rules' }
  return { kind: 'score', value: String(Math.floor((compliant / counted) * 100)) }
}

export const parseTime = (iso: string | null | undefined): number | null => {
  if (typeof iso !== 'string') return null
  const at = Date.parse(iso)
  return Number.isFinite(at) ? at : null
}

/** Newest first by creation time; ties by id, so the order never depends on the response's order. */
export const byNewest = (a: ComplianceScan, b: ComplianceScan) =>
  (parseTime(b.created_at) ?? 0) - (parseTime(a.created_at) ?? 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0)

const isActive = (s: ComplianceScan) => s.status === 'pending' || s.status === 'running'

/** When an active run started (its start, else its creation); null when neither parses. */
export const runStartedAt = (s: ComplianceScan): number | null => parseTime(s.started_at) ?? parseTime(s.created_at)

export type EvaluationState = 'current' | 'running' | 'failed' | 'out_of_date' | 'never' | 'not_found'

export interface FrameworkEvaluation {
  state: EvaluationState
  /** The framework's newest run, or null. */
  latest: ComplianceScan | null
  /** The newest completed run with usable counts, or null. Its date is "last evaluated" in every state. */
  lastDone: ComplianceScan | null
  lastEvaluatedAt: number | null
  /** Only in the current state; null in every other. */
  score: ScanScore | null
  /** Running only: when the run started (the server's time, or the click for a start not listed yet). */
  startedAt: number | null
  /** Running only: active longer than the ceiling, so the start action shows again. */
  overdue: boolean
}

/** A run this page started (or found already running, 409) that the scan list may not show yet. */
export interface LocalStart {
  /** When the server answered (this browser's clock). */
  at: number
  /** The new run's id from a 200; null after a 409, which names no run. */
  scanId: string | null
}

/** The page's view of runs it started: `clock` is the latest time it knows of (the ceiling is measured with it). */
export interface EvaluationOverlay {
  clock: number
  /** Framework id → this page's start, while the list doesn't show that run. */
  startedLocally: Readonly<Record<string, LocalStart>>
}

/**
 * A framework's state from the org's newest runs (all frameworks together). `historyComplete`: the list
 * came back shorter than its limit, so a framework with no run in it was never evaluated. `startedLocally`:
 * a run this page started of this framework that the list doesn't show yet. One without a run id (a 409)
 * names no new run, so an active run in the list keeps its own start: a run past the ceiling stays overdue
 * when its "Re-evaluate now" is answered 409 (founder answer, Oct 27).
 */
export function evaluateFramework(
  frameworkId: string,
  scans: ComplianceScan[],
  now: number,
  historyComplete = false,
  startedLocally: LocalStart | null = null,
): FrameworkEvaluation {
  const own = scans.filter((s) => s.framework_id === frameworkId).sort(byNewest)
  const latest = own[0] ?? null
  const lastDone = own.find((s) => s.status === 'completed' && scanScore(s).kind !== 'unknown') ?? null
  const lastEvaluatedAt = lastDone ? parseTime(lastDone.completed_at) ?? parseTime(lastDone.created_at) : null
  const base = { latest, lastDone, lastEvaluatedAt, score: null, startedAt: null, overdue: false }

  const listedStart = latest && isActive(latest) ? runStartedAt(latest) ?? now : null
  const localAt = startedLocally && !(startedLocally.scanId === null && listedStart !== null) ? startedLocally.at : null
  const startedAt = localAt !== null ? Math.max(localAt, listedStart ?? -Infinity) : listedStart
  if (startedAt !== null) {
    return { ...base, state: 'running', startedAt, overdue: now - startedAt >= EVALUATION_POLL_CEILING_MS }
  }
  if (latest?.status === 'failed') return { ...base, state: 'failed' }
  if (!latest) return { ...base, state: historyComplete ? 'never' : 'not_found' }
  if (latest !== lastDone || lastEvaluatedAt === null) return { ...base, state: 'not_found' }
  if (now - lastEvaluatedAt >= FRAMEWORK_STALE_AFTER_MS) return { ...base, state: 'out_of_date' }
  return { ...base, state: 'current', score: scanScore(latest) }
}

/** When each framework's newest run started, for the frameworks whose newest run is still active. */
export function activeRunStarts(scans: ComplianceScan[]): number[] {
  const newest = new Map<string, ComplianceScan>()
  for (const s of [...scans].sort(byNewest)) if (!newest.has(s.framework_id)) newest.set(s.framework_id, s)
  return [...newest.values()].flatMap((s) => {
    const at = isActive(s) ? runStartedAt(s) : null
    return at === null ? [] : [at]
  })
}

/**
 * How often to read the runs again: every 5 s while the youngest active run is under a minute old, then
 * every 15 s, and not at all once every active run is past the ceiling (or nothing runs).
 */
export function evaluationPollInterval(activeSince: number[], now: number): number | false {
  const live = activeSince.filter((at) => now - at < EVALUATION_POLL_CEILING_MS)
  if (live.length === 0) return false
  const youngest = Math.min(...live.map((at) => now - at))
  return youngest < EVALUATION_POLL_FAST_FOR_MS ? EVALUATION_POLL_FAST_MS : EVALUATION_POLL_SLOW_MS
}
