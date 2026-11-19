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
 * (non-null) zero distinguishable from missing/unavailable data. A positive
 * amount under one cent is "<$0.01", never "$0.00".
 */
export function formatSavingsCurrency(value: number | string | null | undefined): string {
  const amount = toAmount(value);
  if (amount === null) return '—';
  if (amount === 0) return '$0';
  if (amount > 0 && amount < 0.01) return SUB_CENT;
  if (Math.abs(amount) < 1) return `$${amount.toFixed(2)}`;
  return `$${Math.round(amount).toLocaleString()}`;
}

/** What a positive saving under one cent reads as. */
export const SUB_CENT = '<$0.01';

/**
 * A cent-rounded savings total with formatSavingsCurrency()'s rule, plus the
 * weekly email's: when findings with a positive estimate exist but the rounded
 * total is 0, the total is "<$0.01", never "$0". Mirror of lib/utils.ts's
 * formatSavingsTotal() (parity pinned by lib/__tests__/formatSavingsCurrency-parity.test.ts).
 */
export function formatSavingsTotal(total: number | string | null | undefined, estimatedFindings: number | null | undefined): string {
  if (toAmount(total) === 0 && typeof estimatedFindings === 'number' && estimatedFindings > 0) return SUB_CENT;
  return formatSavingsCurrency(total);
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
