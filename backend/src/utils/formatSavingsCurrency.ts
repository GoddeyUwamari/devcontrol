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
export function formatSavingsCurrency(value: number | string | null | undefined): string {
  const amount = toAmount(value);
  if (amount === null) return '—';
  if (amount === 0) return '$0';
  if (Math.abs(amount) < 1) return `$${amount.toFixed(2)}`;
  return `$${Math.round(amount).toLocaleString()}`;
}

/**
 * pg returns DECIMAL/NUMERIC columns (e.g. cost_recommendations.potential_savings)
 * as strings unless a type parser is registered, which this backend does not do.
 * null for a missing or non-numeric value -- never a fabricated 0.
 */
function toAmount(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const amount = typeof value === 'string' ? (value.trim() === '' ? NaN : Number(value)) : value;
  return Number.isFinite(amount) ? amount : null;
}

const USD_CENTS = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * Backend mirror of lib/utils.ts's formatSavingsCents(): a savings amount at
 * cent precision ("$0.48", "$0.00", "$12.50"), for surfaces that show the
 * same figure the Dashboard shows in cents (the Recent Activity feed).
 * Accepts DECIMAL strings; missing or non-numeric is "—", never "$0.00".
 */
export function formatSavingsCents(value: number | string | null | undefined): string {
  const amount = toAmount(value);
  return amount === null ? '—' : USD_CENTS.format(amount);
}
