/**
 * Aggregation of estimated potential savings across cost recommendations.
 *
 * Each recommendation's potential_savings is a standalone estimate. Two
 * recommendations can draw on the same underlying estimated cost -- e.g. an
 * idle EC2 instance's figure is that instance's whole estimated compute cost,
 * while a Reserved Instance opportunity for its instance type counts the same
 * instance as an uncovered on-demand instance to discount. Both are drawn
 * from one instance's estimated cost, so a plain SUM counts it twice.
 *
 * A detector declares what its figure draws on in metadata.savings_claim:
 *
 *   - full_resource_cost: the figure is the whole estimated cost of
 *     resource_ids, so no other claim can also draw on those resources.
 *   - fleet_discount: the figure is per_resource_savings for each of
 *     counted_resources resources out of the pool resource_ids (e.g. the
 *     uncovered instances of one type -- which specific ones is undefined,
 *     since reservations float across a type's instances).
 *
 * A fleet discount's counted resources shrink by however many of its pool are
 * already claimed at full cost. Recommendations with no savings_claim are
 * summed unchanged -- nothing is known about their overlap, so none is
 * assumed. A new category that overlaps an existing one declares a claim;
 * nothing here names a specific detector.
 */

export type SavingsClaim =
  | { kind: 'full_resource_cost'; resource_ids: string[] }
  | { kind: 'fleet_discount'; resource_ids: string[]; per_resource_savings: number; counted_resources: number };

export interface SavingsRecommendation {
  resource_type: string;
  potential_savings: number | string | null;
  metadata?: { savings_claim?: SavingsClaim } | null;
}

export interface EstimatedSavingsAggregate {
  total: number;
  byResourceType: Record<string, number>;
}

/** A finite dollar amount, or null -- never a coerced 0. */
function toAmount(value: number | string | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  const amount = typeof value === 'number' ? value : parseFloat(value);
  return Number.isFinite(amount) ? amount : null;
}

function claimOf(rec: SavingsRecommendation): SavingsClaim | null {
  const claim = rec.metadata?.savings_claim;
  if (!claim || !Array.isArray(claim.resource_ids)) return null;
  if (claim.kind === 'full_resource_cost') return claim;
  if (
    claim.kind === 'fleet_discount' &&
    Number.isFinite(claim.per_resource_savings) &&
    Number.isFinite(claim.counted_resources)
  ) {
    return claim;
  }
  return null;
}

/** Whole cents, so the total matches the per-row figures it is built from. */
function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

export function aggregateEstimatedSavings(recs: SavingsRecommendation[]): EstimatedSavingsAggregate {
  const fullyClaimed = new Set<string>();
  for (const rec of recs) {
    const claim = claimOf(rec);
    if (claim?.kind === 'full_resource_cost') claim.resource_ids.forEach((id) => fullyClaimed.add(id));
  }

  let total = 0;
  const byResourceType: Record<string, number> = {};
  for (const rec of recs) {
    let amount = toAmount(rec.potential_savings);
    if (amount === null) continue; // no figure -- contributes nothing, not $0-as-fact

    const claim = claimOf(rec);
    if (claim?.kind === 'fleet_discount') {
      const alreadyClaimed = new Set(claim.resource_ids.filter((id) => fullyClaimed.has(id))).size;
      const remaining = Math.max(0, claim.counted_resources - alreadyClaimed);
      amount = Math.min(amount, claim.per_resource_savings * remaining);
    }

    total += amount;
    byResourceType[rec.resource_type] = (byResourceType[rec.resource_type] ?? 0) + amount;
  }

  for (const type of Object.keys(byResourceType)) byResourceType[type] = roundCents(byResourceType[type]);
  return { total: roundCents(total), byResourceType };
}
