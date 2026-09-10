/**
 * Backend mirror of lib/utils.ts's formatSavingsCurrency() -- same rounding
 * rule, kept as a separate implementation because the frontend and backend
 * are separate TS projects with no shared import path. Used anywhere a
 * savings/cost-opportunity dollar amount (cost_recommendations.potential_savings
 * or an aggregate/annualized figure derived from it) is rendered into
 * human-readable text, e.g. the AI dashboard summary's fact lines.
 *
 * Whole-dollar Math.round() collapses any genuine saving under $1 (e.g. a
 * small EBS gp2->gp3 delta) to "$0", which reads as "no real saving" even
 * though the detector found a real, non-fabricated one -- this keeps that
 * value visible at 2 decimal places instead, while still rounding to a
 * whole dollar once the amount is $1 or more, and keeping a genuine
 * (non-null) zero distinguishable from missing/unavailable data.
 */
export function formatSavingsCurrency(value: number | null | undefined): string {
  if (value == null) return '—';
  if (value === 0) return '$0';
  if (Math.abs(value) < 1) return `$${value.toFixed(2)}`;
  return `$${Math.round(value).toLocaleString()}`;
}
