/**
 * What a cost recommendation's dollar figure is, read from
 * metadata.savings_basis -- the frontend mirror of classifySavingsBasis() in
 * backend/src/services/estimated-savings.ts. An estimate is shown as a plain
 * monthly figure, a ceiling (an upper bound, e.g. S3 lifecycle assuming all
 * Standard data qualifies for Standard-IA, or DynamoDB capacity cut to its
 * observed peak with no headroom) as "Up to", and a figure with a
 * missing or unrecognised basis is no supported dollar amount at all.
 */

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

/**
 * One recommendation's figure, labelled by its basis: "$X/mo", "Up to $X/mo",
 * or "No dollar estimate" -- never "$0.00/mo" for a figure with no basis.
 * `format` is the surface's own currency formatter.
 */
export function formatRecommendationSavings(
  rec: { potentialSavings: number; metadata?: Record<string, unknown> | null },
  format: (value: number) => string,
  suffix = '/mo',
): string {
  const kind = savingsBasisKind(rec)
  if (kind === 'estimate') return `${format(rec.potentialSavings)}${suffix}`
  if (kind === 'ceiling') return `Up to ${format(rec.potentialSavings)}${suffix}`
  return NO_DOLLAR_ESTIMATE
}

// What each resource type's ceiling assumes. Mirror of CEILING_CONDITIONS in
// backend/src/services/estimated-savings.ts.
const CEILING_CONDITIONS: Record<string, string> = {
  S3: 'if S3 data qualifies for Standard-IA',
  DynamoDB: 'if DynamoDB provisioned capacity were cut to its observed peak',
}

/** Positive ceilings, S3 and DynamoDB first, then others A-Z (the backend's order). */
function orderedCeilings(ceilingByResourceType: Record<string, number>): [string, number][] {
  const order = (type: string) => { const i = Object.keys(CEILING_CONDITIONS).indexOf(type); return i === -1 ? Number.MAX_SAFE_INTEGER : i }
  return Object.entries(ceilingByResourceType)
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
}

/**
 * One "Plus up to $X/<period> ..." line per resource type with a positive
 * ceiling (S3, DynamoDB, then others A-Z). Mirror of describeCeilings in
 * backend/src/services/estimated-savings.ts (the weekly email's wording).
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

// The weekly email's savings sentences (savingsLines in
// backend/src/services/weekly-summary-content.ts), for the Dashboard's
// Cost-Saving Opportunities header. Counts come from /stats
// (countSavingsFindings, the email's own count).
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
 * figures that are counted in totals), then ceilings, then figures with no
 * savings basis -- each group by its figure, largest first. An upper bound
 * never outranks an estimate just because it is bigger.
 */
export function rankBySavings<T extends { potentialSavings: number; metadata?: Record<string, unknown> | null }>(recs: readonly T[]): T[] {
  const rank = (rec: T) => RANK[savingsBasisKind(rec) ?? 'none']
  return [...recs].sort((a, b) => rank(a) - rank(b) || (b.potentialSavings || 0) - (a.potentialSavings || 0))
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
