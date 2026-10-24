import { clsx, type ClassValue } from "clsx"
import { extendTailwindMerge } from "tailwind-merge"

/**
 * The app's type roles and page-top spacing, the theme names the APP SURFACE block of app/globals.css adds.
 * tailwind-merge does not know them: it would read a role as a text colour and drop it whenever a colour is
 * given too. Marketing and sign-in code use none of these names, and
 * app/__tests__/cn-marketing-equivalence.test.ts checks that their merges are unchanged.
 */
export const APP_TEXT_ROLES = ["title", "subtitle", "section", "card-title", "body", "ui", "meta", "label", "kpi"]
export const APP_SPACING = ["page-top"]

const twMerge = extendTailwindMerge({
  extend: { theme: { text: APP_TEXT_ROLES, spacing: APP_SPACING } },
})

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

// Timestamp utilities
export function getRelativeTime(date: Date | string): string {
  const now = new Date();
  const then = typeof date === 'string' ? new Date(date) : date;
  const seconds = Math.floor((now.getTime() - then.getTime()) / 1000);

  if (seconds < 60) return 'just now';
  if (seconds < 120) return '1 minute ago';
  if (seconds < 3600) return `${Math.floor(seconds / 60)} minutes ago`;
  if (seconds < 7200) return '1 hour ago';
  if (seconds < 86400) return `${Math.floor(seconds / 3600)} hours ago`;
  if (seconds < 172800) return '1 day ago';
  return `${Math.floor(seconds / 86400)} days ago`;
}

export function isDataStale(
  lastUpdated: Date | string,
  warningThresholdMinutes: number = 5,
  errorThresholdMinutes: number = 15
): 'fresh' | 'warning' | 'error' {
  const now = new Date();
  const then = typeof lastUpdated === 'string' ? new Date(lastUpdated) : lastUpdated;
  const minutes = Math.floor((now.getTime() - then.getTime()) / 1000 / 60);

  if (minutes >= errorThresholdMinutes) return 'error';
  if (minutes >= warningThresholdMinutes) return 'warning';
  return 'fresh';
}

// Cost utilities
export function annualizeMonthly(monthlyValue: number): number {
  return monthlyValue * 12
}

/**
 * Canonical formatter for a DevControl savings/cost-opportunity dollar
 * amount (e.g. cost_recommendations.potential_savings and any aggregate
 * derived from it, including an annualized figure via annualizeMonthly()
 * above). Whole-dollar `Math.round()` collapses any genuine saving under
 * $1 (e.g. a small EBS gp2->gp3 delta) to "$0", which reads as "no real
 * saving" even though the detector found a real, non-fabricated one --
 * this keeps that value visible at 2 decimal places instead, while still
 * rounding to a whole dollar once the amount is $1 or more, and keeping a
 * genuine (non-null) zero distinguishable from missing/unavailable data.
 */
export function formatSavingsCurrency(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value === 0) return '$0'
  if (Math.abs(value) < 1) return `$${value.toFixed(2)}`
  return `$${Math.round(value).toLocaleString()}`
}

const USD_CENTS = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', minimumFractionDigits: 2, maximumFractionDigits: 2 })

/**
 * A savings/cost-opportunity amount at cent precision ("$0.48", "$0.00",
 * "$12.50") -- the Dashboard's one savings format, so a monthly figure and
 * its annualized figure (both cent-rounded with costs/cost-display.ts's
 * roundCents) visibly agree. Accepts DECIMAL strings; missing or non-numeric
 * is "—", never "$0.00". Backend mirror: backend/src/utils/formatSavingsCurrency.ts.
 */
export function formatSavingsCents(value: number | string | null | undefined): string {
  const amount = typeof value === 'string' ? (value.trim() === '' ? NaN : Number(value)) : value
  return amount == null || !Number.isFinite(amount) ? '—' : USD_CENTS.format(amount)
}

export function formatFullTimestamp(date: Date | string): string {
  const d = typeof date === 'string' ? new Date(date) : date;
  return d.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
}
