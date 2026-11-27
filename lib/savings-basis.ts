/**
 * What a cost recommendation's dollar figure is, read from
 * metadata.savings_basis -- the frontend mirror of classifySavingsBasis() in
 * backend/src/services/estimated-savings.ts. An estimate is shown as a plain
 * monthly figure, a ceiling (an upper bound, e.g. S3 lifecycle assuming all
 * Standard data qualifies for Standard-IA, or DynamoDB capacity cut to its
 * observed peak with no headroom) as "Up to", and a figure with a
 * missing or unrecognised basis is no supported dollar amount at all.
 */

import { formatSavingsCurrency, formatSavingsTotal } from './utils'

export type SavingsBasisKind = 'estimate' | 'ceiling'

const ESTIMATE_BASIS_PREFIXES = ['estimated:', 'comparison:']
// 'scenario:' is DynamoDB capacity's pre-relabel prefix for the same upper bound.
const CEILING_BASIS_PREFIXES = ['ceiling:', 'scenario:']

export const NO_DOLLAR_ESTIMATE = 'No dollar estimate'

export function savingsBasisKind(rec: { metadata?: Record<string, unknown> | null }): SavingsBasisKind | null {
  const basis = rec.metadata?.savings_basis
  if (typeof basis !== 'string') return null
  if (CEILING_BASIS_PREFIXES.some((prefix) => basis.startsWith(prefix))) return 'ceiling'
  if (ESTIMATE_BASIS_PREFIXES.some((prefix) => basis.startsWith(prefix))) return 'estimate'
  return null
}

// ─── The one savings-figure rule ("Never show $0", founder rulings 2026-11-26) ──
//
// A finding has a dollar figure only when its savings_basis is an estimate or
// a ceiling AND its figure is a finite number above $0 -- the backend's own
// count definition (countSavingsFindings in backend/src/services/estimated-savings.ts,
// which mirrors this as savingsFigure; parity pinned by
// lib/__tests__/savings-figure-parity.test.ts). Anything else is "No dollar
// estimate", never "$0", "$0/mo" or "$0.00".
//
// Sub-cent (ruling Q2 safeguard): potential_savings is DECIMAL(10,2), so a
// positive figure under half a cent is stored as 0.00. A detector that computed
// one records the unrounded amount in metadata[SAVINGS_UNROUNDED_FIELD] at
// detection time; only that recorded amount (0 < amount < $0.01, stored figure
// exactly 0) reads "Less than $0.01/mo". A stored 0 without it is never sub-cent.

/** metadata field the detectors write (backend SAVINGS_UNROUNDED_FIELD): the unrounded USD/month amount of a figure stored as 0.00. */
export const SAVINGS_UNROUNDED_FIELD = 'savings_unrounded_usd'

/** A row figure under one cent (ruling Q2): the same words for an estimate and a ceiling (the saving is below the bound, so below a cent). */
export const LESS_THAN_ONE_CENT = 'Less than $0.01'

/** Ruling Q1: no open findings after an analysis. */
export const NONE_FOUND = 'None found'
export const NONE_FOUND_SUB = 'No open opportunities after the latest analysis'
/** A partial run (some checks couldn't run) that left no open findings (Cost Intelligence fix round 1, N-4). */
export const NONE_FOUND_PARTIAL = 'None found in the checks that ran'
export const NONE_FOUND_PARTIAL_SUB = "Some checks couldn't run in the latest analysis"
export const NO_ESTIMATE_SUB = 'No dollar estimate yet for the open opportunities.'
/**
 * Review N-5: the total's sentence when open cards read "Less than $0.01/mo". Sub-cent is not
 * priced (ruling 5), so the value stays "No dollar estimate" (no total is implied); the sentence
 * says what the cards say instead of "no dollar estimate yet" for them.
 */
export const SUB_CENT_EACH_SUB = 'Each open opportunity is under $0.01/mo.'
export const SUB_CENT_SOME_SUB = 'Some open opportunities are under $0.01/mo; the rest have no dollar estimate yet.'
/** Ruling Q5: Remediation's Savings Recovered with nothing recovered. */
export const NONE_YET = 'None yet'
/** Data that failed to load: never a zero. */
export const UNAVAILABLE_FIGURE = '—'
export const upperBoundOnly = (amount: string) => `Up to ${amount}/mo · upper bound only`
export const NO_FIRM_ESTIMATE = 'No firm estimate yet.'

/** Ruling Q2 (Cost Intelligence): a firm figure under this many dollars a month is grey, never styled as a big saving. */
export const SMALL_SAVINGS_USD = 1

export type SavingsFigure =
  /** A stored figure above $0 with a supported basis. */
  | { kind: SavingsBasisKind; amount: number; subCent: false }
  /** A stored 0.00 whose detector recorded a genuine positive amount under one cent. Never in totals or priced counts. */
  | { kind: SavingsBasisKind; amount: number; subCent: true }
  | { kind: 'none' }

/** A figure with an amount (stored above $0, or a recorded sub-cent amount). */
export type SavingsFigureWithAmount = Exclude<SavingsFigure, { kind: 'none' }>

const NO_FIGURE: SavingsFigure = { kind: 'none' }

/** A finite number, or null -- never a coerced 0. Accepts DECIMAL strings. */
function toAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value)
    return Number.isFinite(n) ? n : null
  }
  return null
}

/** The recorded unrounded amount when it is a genuine sub-cent figure (0 < x < 0.01), else null. */
export function recordedSubCentAmount(metadata: Record<string, unknown> | null | undefined): number | null {
  const value = metadata?.[SAVINGS_UNROUNDED_FIELD]
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 0.01 ? value : null
}

/** The one row rule. */
export function savingsFigure(rec: { potentialSavings: number | string | null | undefined; metadata?: Record<string, unknown> | null }): SavingsFigure {
  const kind = savingsBasisKind(rec)
  if (kind === null) return NO_FIGURE
  const stored = toAmount(rec.potentialSavings)
  if (stored !== null && stored > 0) return { kind, amount: stored, subCent: false }
  if (stored === 0) {
    const subCent = recordedSubCentAmount(rec.metadata)
    if (subCent !== null) return { kind, amount: subCent, subCent: true }
  }
  return NO_FIGURE
}

/** True when the figure is a stored amount above $0 (what totals and "priced" counts include); a sub-cent row is not. */
/** How many of these rows read "Less than $0.01/mo" (a recorded sub-cent amount): for describeSavingsTotal's `openSubCent`. */
export function countSubCentFigures(recs: ReadonlyArray<{ potentialSavings: number | string | null | undefined; metadata?: Record<string, unknown> | null }>): number {
  return recs.filter((rec) => { const fig = savingsFigure(rec); return fig.kind !== 'none' && fig.subCent }).length
}

export function isPricedFigure(fig: SavingsFigure): fig is { kind: SavingsBasisKind; amount: number; subCent: false } {
  return fig.kind !== 'none' && !fig.subCent
}

/**
 * "$X/mo", "Up to $X/mo", "Less than $0.01/mo" or "No dollar estimate" -- never "$0".
 * `format` is the surface's own currency formatter (only ever given an amount above $0).
 */
export function formatSavingsFigure(fig: SavingsFigure, format: (value: number) => string, suffix = '/mo'): string {
  if (fig.kind === 'none') return NO_DOLLAR_ESTIMATE
  if (fig.subCent) return `${LESS_THAN_ONE_CENT}${suffix}`
  return fig.kind === 'ceiling' ? `Up to ${format(fig.amount)}${suffix}` : `${format(fig.amount)}${suffix}`
}

/**
 * One recommendation's figure, labelled by its basis: formatSavingsFigure(savingsFigure(rec)).
 * `format` is the surface's own currency formatter.
 */
export function formatRecommendationSavings(
  rec: { potentialSavings: number | string | null | undefined; metadata?: Record<string, unknown> | null },
  format: (value: number) => string,
  suffix = '/mo',
): string {
  return formatSavingsFigure(savingsFigure(rec), format, suffix)
}

/**
 * The dollar amount a formatted savings figure shows ("$1.00" -> 1, "$53" -> 53,
 * "<$0.01" -> 0), so styling follows what the user reads (Cost Intelligence fix round 1, N-3).
 */
export function displayedAmount(formatted: string): number {
  if (formatted.startsWith('<')) return 0
  const n = Number(formatted.replace(/[$,]/g, ''))
  return Number.isFinite(n) ? n : 0
}

/** The /stats fields a savings total is described from. `totalPotentialSavings` null: the API sent no total. */
export interface SavingsTotalInput {
  totalPotentialSavings: number | null
  estimatedFindings?: number | null
  potentialSavingsCeiling: number
  potentialSavingsCeilingByResourceType?: Record<string, number>
  activeRecommendations: number
}

export type SavingsTotal =
  /** A firm estimate total ("$X/mo"; `amount` without the suffix): green only at or above SMALL_SAVINGS_USD as displayed. */
  | { kind: 'firm'; amount: string; value: string; strong: boolean; lines: string[] }
  /** Every open figure is an upper bound: grey "Up to $X/mo · upper bound only". */
  | { kind: 'upper_bound_only'; value: string; lines: string[] }
  /** Open findings, none with a dollar figure. */
  | { kind: 'no_estimate'; value: string; lines: string[] }
  /** A completed analysis left no open findings (ruling Q1). */
  | { kind: 'none_found'; value: string; lines: string[] }
  /** No stats, or the API sent no total: "—", never a zero. */
  | { kind: 'unavailable'; value: string; lines: string[] }

/**
 * A savings total from /stats (Cost Intelligence PR A's savings tile, moved
 * here): the firm total (formatSavingsTotal: "<$0.01" when positive estimates
 * round to 0) with each upper bound on its own line, never added together;
 * "Up to $X/mo · upper bound only"; "No dollar estimate"; "None found"; "—".
 * Never "$0". `partialRun`: the latest analysis was partial, so "none found"
 * covers only the checks that ran. Callers handle loading and "not analyzed
 * yet" first. `format` formats the firm total and the upper bounds.
 * `openSubCent`: how many loaded open rows read "Less than $0.01/mo"
 * (countSubCentFigures); with no priced figure, the "No dollar estimate"
 * sentence then says they are under $0.01/mo (review N-5), never a total.
 */
export function describeSavingsTotal(
  stats: SavingsTotalInput | null | undefined,
  { partialRun = false, format = formatSavingsCurrency, openSubCent = 0 }: { partialRun?: boolean; format?: (value: number) => string; openSubCent?: number } = {},
): SavingsTotal {
  if (!stats) return { kind: 'unavailable', value: UNAVAILABLE_FIGURE, lines: [] }
  const total = stats.totalPotentialSavings
  if (total === null || !Number.isFinite(total)) return { kind: 'unavailable', value: UNAVAILABLE_FIGURE, lines: [] }
  const ceilingByType = stats.potentialSavingsCeilingByResourceType ?? {}
  const positiveEstimates = typeof stats.estimatedFindings === 'number' && stats.estimatedFindings > 0
  if (total > 0 || (total === 0 && positiveEstimates)) {
    const amount = total > 0 ? format(total) : formatSavingsTotal(total, stats.estimatedFindings)
    return {
      kind: 'firm',
      amount,
      value: `${amount}/mo`,
      strong: displayedAmount(amount) >= SMALL_SAVINGS_USD,
      lines: describeCeilings(ceilingByType, format),
    }
  }
  if (stats.potentialSavingsCeiling > 0) {
    return { kind: 'upper_bound_only', value: upperBoundOnly(format(stats.potentialSavingsCeiling)), lines: [NO_FIRM_ESTIMATE] }
  }
  if (stats.activeRecommendations > 0) {
    const line = openSubCent <= 0 ? NO_ESTIMATE_SUB : openSubCent >= stats.activeRecommendations ? SUB_CENT_EACH_SUB : SUB_CENT_SOME_SUB
    return { kind: 'no_estimate', value: NO_DOLLAR_ESTIMATE, lines: [line] }
  }
  return partialRun
    ? { kind: 'none_found', value: NONE_FOUND_PARTIAL, lines: [NONE_FOUND_PARTIAL_SUB] }
    : { kind: 'none_found', value: NONE_FOUND, lines: [NONE_FOUND_SUB] }
}

/**
 * A plain savings amount with no basis metadata (a remediation workflow's
 * estimated_savings): "$X/mo" above $0, otherwise "No dollar estimate".
 */
export function formatPlainSavings(amount: unknown, format: (value: number) => string = formatSavingsCurrency, suffix = '/mo'): string {
  const value = toAmount(amount)
  return value !== null && value > 0 ? `${format(value)}${suffix}` : NO_DOLLAR_ESTIMATE
}

// What each resource type's ceiling assumes. Mirror of CEILING_CONDITIONS in
// backend/src/services/estimated-savings.ts.
const CEILING_CONDITIONS: Record<string, string> = {
  S3: 'if S3 data qualifies for Standard-IA',
  DynamoDB: 'if DynamoDB provisioned capacity were cut to its observed peak',
  'EBS Snapshot': 'if old EBS snapshots were deleted',
}

/** Positive ceilings, S3, DynamoDB and EBS Snapshot first, then others A-Z (the backend's order). */
function orderedCeilings(ceilingByResourceType: Record<string, number>): [string, number][] {
  const order = (type: string) => { const i = Object.keys(CEILING_CONDITIONS).indexOf(type); return i === -1 ? Number.MAX_SAFE_INTEGER : i }
  return Object.entries(ceilingByResourceType)
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
}

/**
 * One "Plus up to $X/<period> ..." line per resource type with a positive
 * ceiling (S3, DynamoDB, EBS Snapshot, then others A-Z). Mirror of describeCeilings in
 * backend/src/services/estimated-savings.ts. The weekly email no longer uses
 * these lines (executive brief redesign, 53a791e1).
 */
export function describeCeilings(ceilingByResourceType: Record<string, number>, format: (value: number) => string, period = 'mo'): string[] {
  return orderedCeilings(ceilingByResourceType)
    .map(([type, amount]) => CEILING_CONDITIONS[type]
      ? `Plus up to ${format(amount)}/${period} ${CEILING_CONDITIONS[type]} (upper bound, not included above)`
      : `Plus up to ${format(amount)}/${period} from ${type} upper-bound figures (not included above)`)
}

/**
 * describeCeilings() for when there is no estimated total to add to: one
 * "Up to $X/<period> ... (upper bound)" line per resource type, same order.
 * Mirror of describeCeilingsWithoutEstimate in the backend.
 */
export function describeCeilingsWithoutEstimate(ceilingByResourceType: Record<string, number>, format: (value: number) => string, period = 'mo'): string[] {
  return orderedCeilings(ceilingByResourceType)
    .map(([type, amount]) => CEILING_CONDITIONS[type]
      ? `Up to ${format(amount)}/${period} ${CEILING_CONDITIONS[type]} (upper bound)`
      : `Up to ${format(amount)}/${period} from ${type} upper-bound figures`)
}

// The Dashboard's Cost-Saving Opportunities header sentences. They were the
// weekly email's (savingsLines) until the executive brief redesign
// (53a791e1); the email no longer uses them. Counts come from /stats
// (countSavingsFindings, the same count the email's savings read uses).
const openFindings = (count: number) => `${count} open finding${count === 1 ? '' : 's'}`

/** "Estimated savings: $X/month across N open finding(s). This is a DevControl estimate, not realized savings." */
export function estimatedSavingsHeadline(amount: string, estimatedFindings: number): string {
  return `Estimated savings: ${amount}/month across ${openFindings(estimatedFindings)}. This is a DevControl estimate, not realized savings.`
}

/** "K more open finding(s) has/have no dollar estimate yet.", or null when there are none. */
export function unestimatedFindingsLine(unestimatedFindings: number): string | null {
  if (!(unestimatedFindings > 0)) return null
  return unestimatedFindings === 1
    ? '1 more open finding has no dollar estimate yet.'
    : `${unestimatedFindings} more open findings have no dollar estimate yet.`
}

/** "Estimated savings: N open finding(s); none has a dollar estimate yet." */
export function noEstimateHeadline(activeFindings: number): string {
  return `Estimated savings: ${openFindings(activeFindings)}; none has a dollar estimate yet.`
}

const RANK: Record<SavingsBasisKind | 'none', number> = { estimate: 0, ceiling: 1, none: 2 }

/**
 * A copy of `recs` ranked for a "top savings" list: estimates first (the
 * figures that are counted in totals), then ceilings, then findings with no
 * dollar figure (savingsFigure: no basis, or a figure not above $0) -- each
 * group by its figure, largest first (a recorded sub-cent amount is below
 * every stored one). An upper bound never outranks an estimate just because
 * it is bigger.
 */
export function rankBySavings<T extends { potentialSavings: number; metadata?: Record<string, unknown> | null }>(recs: readonly T[]): T[] {
  const figures = new Map(recs.map((rec) => [rec, savingsFigure(rec)] as const))
  const rank = (rec: T) => RANK[figures.get(rec)!.kind]
  const amount = (rec: T) => { const fig = figures.get(rec)!; return fig.kind === 'none' ? 0 : fig.amount }
  return [...recs].sort((a, b) => rank(a) - rank(b) || amount(b) - amount(a))
}

// metadata.price_source written by the EC2 idle detector -- mirror of
// EC2_PRICE_SOURCE_DEFAULT in backend/src/services/estimated-savings.ts.
// The figure is a default because the instance type's price is unknown.
export const DEFAULT_PRICE_SOURCE = 'default_unlisted_type'

// Founder-approved copy (PR 4, S1 and S2).
export const DEFAULT_PRICE_DISCLOSURE = "Estimate. This instance type's price is unknown, so a default of $50/mo is used."
export const DEFAULT_PRICE_SUFFIX = '(price unknown)'

/**
 * True only when the row says its figure is the default for an unpriced
 * instance type. Never inferred from the amount: a listed type can cost
 * exactly the default, and a row with no price_source is not a default.
 */
export function isDefaultPriceEstimate(rec: { metadata?: Record<string, unknown> | null }): boolean {
  return rec.metadata?.price_source === DEFAULT_PRICE_SOURCE
}
