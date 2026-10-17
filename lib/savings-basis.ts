/**
 * What a cost recommendation's dollar figure is, read from
 * metadata.savings_basis -- the frontend mirror of classifySavingsBasis() in
 * backend/src/services/estimated-savings.ts. An estimate is shown as a plain
 * monthly figure, a ceiling (an upper bound, e.g. S3 lifecycle assuming all
 * Standard data qualifies for Standard-IA) as "Up to", and a figure with a
 * missing or unrecognised basis is no supported dollar amount at all.
 */

export type SavingsBasisKind = 'estimate' | 'ceiling'

const ESTIMATE_BASIS_PREFIXES = ['estimated:', 'scenario:', 'comparison:']
const CEILING_BASIS_PREFIX = 'ceiling:'

export const NO_DOLLAR_ESTIMATE = 'No dollar estimate'

export function savingsBasisKind(rec: { metadata?: Record<string, unknown> | null }): SavingsBasisKind | null {
  const basis = rec.metadata?.savings_basis
  if (typeof basis !== 'string') return null
  if (basis.startsWith(CEILING_BASIS_PREFIX)) return 'ceiling'
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
