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

/** One "Plus up to $X/mo ..." line per resource type with a positive ceiling (S3, DynamoDB, then others A-Z). */
export function describeCeilings(ceilingByResourceType: Record<string, number>, format: (value: number) => string): string[] {
  const order = (type: string) => { const i = Object.keys(CEILING_CONDITIONS).indexOf(type); return i === -1 ? Number.MAX_SAFE_INTEGER : i }
  return Object.entries(ceilingByResourceType)
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([type, amount]) => CEILING_CONDITIONS[type]
      ? `Plus up to ${format(amount)}/mo ${CEILING_CONDITIONS[type]} (upper bound, not included above)`
      : `Plus up to ${format(amount)}/mo from ${type} upper-bound figures (not included above)`)
}
