/**
 * Aggregation of estimated potential savings across cost recommendations.
 *
 * Each recommendation's potential_savings is a standalone estimate. Two
 * recommendations can draw on the same underlying estimated cost -- e.g. an
 * idle EC2 instance's figure is that instance's whole estimated compute cost,
 * while a fleet-wide discount for its instance type (e.g. commitment pricing
 * across a type's uncovered instances) would count the same instance again.
 * Both are drawn from one instance's estimated cost, so a plain SUM counts it
 * twice. (Reserved Instance findings carry no dollar figure today -- see
 * detectReservedInstanceOpportunities() -- so they draw on nothing.)
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
 *
 * A figure only counts when metadata.savings_basis says what it is (see
 * classifySavingsBasis()). An estimate goes into `total`; a ceiling (an
 * upper bound, e.g. S3 lifecycle assuming all Standard data qualifies for
 * Standard-IA) goes into `ceilingTotal` and is never added to `total`. A
 * figure with a missing or unrecognised basis is no supported dollar amount
 * and contributes to neither.
 */

export type SavingsBasisKind = 'estimate' | 'ceiling';

/**
 * metadata.price_source: where an EC2 figure's price came from (written by
 * the idle EC2 detector). Consumers disclose the default only when
 * price_source is EC2_PRICE_SOURCE_DEFAULT -- never from the amount, since a
 * listed type can cost exactly the default. Mirror: lib/savings-basis.ts.
 * Either way the figure is an estimate and counts in totals unchanged.
 */
export const EC2_PRICE_SOURCE_LIST_TABLE = 'list_table';
export const EC2_PRICE_SOURCE_DEFAULT = 'default_unlisted_type';
export type EC2PriceSource = typeof EC2_PRICE_SOURCE_LIST_TABLE | typeof EC2_PRICE_SOURCE_DEFAULT;
/** metadata.severity_basis on a default-price row: severity is fixed LOW, never derived from the default. */
export const SEVERITY_BASIS_FIXED_LOW_UNKNOWN_PRICE = 'fixed_low_unknown_price';

// The savings_basis prefixes cost-optimization.service.ts writes. 'comparison:'
// (DynamoDB capacity mode) is a modelled estimate from the table's own observed
// workload; 'ceiling:' is an upper bound (S3 lifecycle, DynamoDB capacity).
// 'scenario:' is what DynamoDB capacity wrote before it was relabelled a
// ceiling -- the same figure, so rows stored under it are ceilings too.
const ESTIMATE_BASIS_PREFIXES = ['estimated:', 'comparison:'];
const CEILING_BASIS_PREFIXES = ['ceiling:', 'scenario:'];

/** What a recommendation's savings figure is, or null when it has no supported basis. */
export function classifySavingsBasis(basis: unknown): SavingsBasisKind | null {
  if (typeof basis !== 'string') return null;
  if (CEILING_BASIS_PREFIXES.some((prefix) => basis.startsWith(prefix))) return 'ceiling';
  if (ESTIMATE_BASIS_PREFIXES.some((prefix) => basis.startsWith(prefix))) return 'estimate';
  return null;
}

export type SavingsClaim =
  | { kind: 'full_resource_cost'; resource_ids: string[] }
  | { kind: 'fleet_discount'; resource_ids: string[]; per_resource_savings: number; counted_resources: number };

export interface SavingsRecommendation {
  resource_type: string;
  potential_savings: number | string | null;
  metadata?: { savings_claim?: SavingsClaim; savings_basis?: unknown } | null;
}

export interface EstimatedSavingsAggregate {
  /** Estimates only -- never includes a ceiling. */
  total: number;
  byResourceType: Record<string, number>;
  /** Upper bounds, kept apart from the estimates above. */
  ceilingTotal: number;
  ceilingByResourceType: Record<string, number>;
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

/**
 * What each recommendation adds to aggregateEstimatedSavings().total, in the
 * same order as `recs`: the estimate after the fleet-discount clamp, or null
 * for a row that is not an estimate or has no figure. A 0 here (a gate-blocked
 * comparison, or a fleet discount whose pool is already claimed) adds nothing.
 */
export function countedEstimateAmounts(recs: SavingsRecommendation[]): Array<number | null> {
  const isEstimate = (rec: SavingsRecommendation) => classifySavingsBasis(rec.metadata?.savings_basis) === 'estimate';

  const fullyClaimed = new Set<string>();
  for (const rec of recs) {
    if (!isEstimate(rec)) continue;
    const claim = claimOf(rec);
    if (claim?.kind === 'full_resource_cost') claim.resource_ids.forEach((id) => fullyClaimed.add(id));
  }

  return recs.map((rec) => {
    if (!isEstimate(rec)) return null;
    const amount = toAmount(rec.potential_savings);
    if (amount === null) return null; // no figure -- contributes nothing, not $0-as-fact

    const claim = claimOf(rec);
    if (claim?.kind === 'fleet_discount') {
      const alreadyClaimed = new Set(claim.resource_ids.filter((id) => fullyClaimed.has(id))).size;
      const remaining = Math.max(0, claim.counted_resources - alreadyClaimed);
      return Math.min(amount, claim.per_resource_savings * remaining);
    }
    return amount;
  });
}

/** Open findings by what their figure is; the three counts add up to recs.length. */
export interface SavingsFindingCounts {
  /** Findings whose estimate adds more than $0 to aggregateEstimatedSavings().total. */
  estimatedFindings: number;
  /** Findings whose figure is an upper bound (a ceiling with an amount). */
  ceilingFindings: number;
  /** Findings with neither: no figure, no supported basis, or an estimate that adds $0. */
  unestimatedFindings: number;
}

/**
 * The one count the weekly email and the Dashboard both read. An estimate
 * counts only when what it adds to the total is > $0: a gate-blocked DynamoDB
 * comparison is stored at 0 and a fully claimed fleet discount adds 0, so
 * those are findings with no dollar estimate.
 */
export function countSavingsFindings(recs: SavingsRecommendation[]): SavingsFindingCounts {
  const hasAmount = (value: unknown) =>
    value !== null && value !== undefined && Number.isFinite(typeof value === 'number' ? value : parseFloat(String(value)));
  const counted = countedEstimateAmounts(recs);
  let estimatedFindings = 0;
  let ceilingFindings = 0;
  recs.forEach((rec, i) => {
    const amount = counted[i];
    if (amount !== null) {
      if (amount > 0) estimatedFindings++;
      return;
    }
    if (hasAmount(rec.potential_savings) && classifySavingsBasis(rec.metadata?.savings_basis) === 'ceiling') ceilingFindings++;
  });
  return { estimatedFindings, ceilingFindings, unestimatedFindings: recs.length - estimatedFindings - ceilingFindings };
}

export function aggregateEstimatedSavings(recs: SavingsRecommendation[]): EstimatedSavingsAggregate {
  let ceilingTotal = 0;
  const ceilingByResourceType: Record<string, number> = {};
  for (const rec of recs) {
    if (classifySavingsBasis(rec.metadata?.savings_basis) !== 'ceiling') continue;
    const amount = toAmount(rec.potential_savings);
    if (amount === null) continue;
    ceilingTotal += amount;
    ceilingByResourceType[rec.resource_type] = (ceilingByResourceType[rec.resource_type] ?? 0) + amount;
  }

  let total = 0;
  const byResourceType: Record<string, number> = {};
  countedEstimateAmounts(recs).forEach((amount, i) => {
    if (amount === null) return;
    const type = recs[i].resource_type;
    total += amount;
    byResourceType[type] = (byResourceType[type] ?? 0) + amount;
  });

  for (const type of Object.keys(byResourceType)) byResourceType[type] = roundCents(byResourceType[type]);
  for (const type of Object.keys(ceilingByResourceType)) ceilingByResourceType[type] = roundCents(ceilingByResourceType[type]);
  return { total: roundCents(total), byResourceType, ceilingTotal: roundCents(ceilingTotal), ceilingByResourceType };
}

// What each resource type's ceiling assumes, for the "Plus up to $X" lines next
// to an estimated total. A type not listed gets a generic upper-bound phrase.
const CEILING_CONDITIONS: Record<string, string> = {
  S3: 'if S3 data qualifies for Standard-IA',
  DynamoDB: 'if DynamoDB provisioned capacity were cut to its observed peak',
  'EBS Snapshot': 'if old EBS snapshots were deleted',
};

/**
 * One "Plus up to $X/<period> ..." line per resource type with a positive
 * ceiling (S3, then DynamoDB, then EBS Snapshot, then any other type alphabetically). Never
 * folds ceilings into one unexplained figure. Mirrored in lib/savings-basis.ts.
 */
export function describeCeilings(ceilingByResourceType: Record<string, number>, format: (amount: number) => string, period: string): string[] {
  const order = (type: string) => { const i = Object.keys(CEILING_CONDITIONS).indexOf(type); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
  return Object.entries(ceilingByResourceType)
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([type, amount]) => CEILING_CONDITIONS[type]
      ? `Plus up to ${format(amount)}/${period} ${CEILING_CONDITIONS[type]} (upper bound, not included above)`
      : `Plus up to ${format(amount)}/${period} from ${type} upper-bound figures (not included above)`);
}

/**
 * describeCeilings() for when there is no estimated total to add to: one
 * "Up to $X/<period> ... (upper bound)" line per resource type, same order.
 */
export function describeCeilingsWithoutEstimate(ceilingByResourceType: Record<string, number>, format: (amount: number) => string, period: string): string[] {
  const order = (type: string) => { const i = Object.keys(CEILING_CONDITIONS).indexOf(type); return i === -1 ? Number.MAX_SAFE_INTEGER : i; };
  return Object.entries(ceilingByResourceType)
    .filter(([, amount]) => amount > 0)
    .sort(([a], [b]) => order(a) - order(b) || a.localeCompare(b))
    .map(([type, amount]) => CEILING_CONDITIONS[type]
      ? `Up to ${format(amount)}/${period} ${CEILING_CONDITIONS[type]} (upper bound)`
      : `Up to ${format(amount)}/${period} from ${type} upper-bound figures`);
}

// ─── The one savings-figure rule ("Never show $0", founder rulings 2026-11-26) ──
//
// Mirror of savingsFigure() in lib/savings-basis.ts (parity pinned by
// lib/__tests__/savings-figure-parity.test.ts). A finding has a dollar figure
// only when its savings_basis is an estimate or a ceiling AND its stored
// figure is a finite number above $0 -- countSavingsFindings()'s rule for an
// estimate. Anything else has no dollar estimate and is never shown as "$0".
//
// potential_savings is DECIMAL(10,2): a positive figure under half a cent is
// stored as 0.00. The detectors that can compute one (low-usage Lambda, S3
// lifecycle) record the unrounded amount in metadata[SAVINGS_UNROUNDED_FIELD]
// at detection time (subCentSavingsMetadata). Only that recorded amount reads
// "less than $0.01" -- never a stored 0 without it. It is never added to a
// total or a count: the stored column and every aggregate are unchanged.

/** The metadata field holding the unrounded USD/month amount of a figure stored as 0.00. */
export const SAVINGS_UNROUNDED_FIELD = 'savings_unrounded_usd';

/** A row figure under one cent: one wording for an estimate and a ceiling (the saving is below the bound, so below a cent). */
export const LESS_THAN_ONE_CENT = 'less than $0.01';

/**
 * True when DECIMAL(10,2) stores `amount` as 0.00 although it is above $0. pg
 * sends a JS number as its shortest decimal string, and Postgres rounds half
 * away from zero, so exactly the amounts in (0, 0.005) round to 0.00.
 */
export function storesAsZeroCents(amount: number): boolean {
  return Number.isFinite(amount) && amount > 0 && amount < 0.005;
}

/**
 * The metadata a detector adds next to a computed figure: the unrounded
 * amount only when it is positive and would be stored as 0.00; otherwise
 * nothing (never for 0, a gate-blocked figure, or anything at least half a cent).
 */
export function subCentSavingsMetadata(amount: number): { [SAVINGS_UNROUNDED_FIELD]?: number } {
  return storesAsZeroCents(amount) ? { [SAVINGS_UNROUNDED_FIELD]: amount } : {};
}

export type SavingsFigure =
  | { kind: SavingsBasisKind; amount: number; subCent: boolean }
  | { kind: 'none' };

/** The recorded unrounded amount when it is a genuine sub-cent figure (0 < x < 0.01), else null. */
export function recordedSubCentAmount(metadata: Record<string, unknown> | null | undefined): number | null {
  const value = metadata?.[SAVINGS_UNROUNDED_FIELD];
  return typeof value === 'number' && Number.isFinite(value) && value > 0 && value < 0.01 ? value : null;
}

/** A finite number (or a whole numeric string, as pg returns DECIMAL), else null -- the frontend mirror's parse. */
function strictAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'string' && value.trim() !== '') {
    const amount = Number(value);
    return Number.isFinite(amount) ? amount : null;
  }
  return null;
}

/** The one row rule (frontend mirror: lib/savings-basis.ts savingsFigure). */
export function savingsFigure(rec: { potential_savings: number | string | null | undefined; metadata?: Record<string, unknown> | null }): SavingsFigure {
  const kind = classifySavingsBasis(rec.metadata?.savings_basis);
  if (kind === null) return { kind: 'none' };
  const stored = strictAmount(rec.potential_savings);
  if (stored !== null && stored > 0) return { kind, amount: stored, subCent: false };
  if (stored === 0) {
    const subCent = recordedSubCentAmount(rec.metadata);
    if (subCent !== null) return { kind, amount: subCent, subCent: true };
  }
  return { kind: 'none' };
}
