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
 * A positive amount under one cent is "<$0.01", never "$0.00" (the weekly
 * email's money rule). Backend mirror, kept identical (pinned by
 * lib/__tests__/formatSavingsCurrency-parity.test.ts):
 * backend/src/utils/formatSavingsCurrency.ts.
 */
export function formatSavingsCurrency(value: number | null | undefined): string {
  if (value == null) return '—'
  if (value === 0) return '$0'
  if (value > 0 && value < 0.01) return SUB_CENT
  if (Math.abs(value) < 1) return `$${value.toFixed(2)}`
  return `$${Math.round(value).toLocaleString()}`
}

/** What a positive saving under one cent reads as. */
export const SUB_CENT = '<$0.01'

/**
 * A cent-rounded savings total (e.g. /stats total_potential_savings, or its
 * annualized figure) with formatSavingsCurrency()'s rule, plus the weekly
 * email's (backend/src/services/weekly-brief/format.ts formatOpenSavings):
 * when findings with a positive estimate exist but the rounded total is 0,
 * the total is "<$0.01", never "$0". `estimatedFindings` is the count of
 * findings with a positive estimate (/stats estimated_findings); null or 0
 * keeps the plain rule. Backend mirror: backend/src/utils/formatSavingsCurrency.ts.
 */
export function formatSavingsTotal(total: number | null | undefined, estimatedFindings: number | null | undefined): string {
  if (total === 0 && typeof estimatedFindings === 'number' && estimatedFindings > 0) return SUB_CENT
  return formatSavingsCurrency(total)
}

/**
 * What a positive monthly total that rounds to $0 annualizes to: under
 * $0.005/mo is under $0.06/yr (founder ruling, Cost Optimization tidy), so
 * "<$0.01/yr" would understate the bound.
 */
export const SUB_CENT_ANNUAL = '<$0.06'

/**
 * The annual figure of a cent-rounded monthly savings total (/stats
 * total_potential_savings): annualizeMonthly() with formatSavingsCurrency(),
 * except that a monthly total of 0 with positive estimates behind it is
 * "<$0.06". No backend mirror: the weekly email shows no annual figure.
 */
export function formatAnnualSavingsTotal(monthlyTotal: number | null | undefined, estimatedFindings: number | null | undefined): string {
  if (monthlyTotal === 0 && typeof estimatedFindings === 'number' && estimatedFindings > 0) return SUB_CENT_ANNUAL
  return formatSavingsCurrency(monthlyTotal == null ? monthlyTotal : annualizeMonthly(monthlyTotal))
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

/**
 * US dollars to the cent with a thousands separator: "$1,234.56", "$0.06",
 * "-$1.05" (the same USD_CENTS as formatSavingsCents). The one formatter behind the Costs pages' formatUsd and the
 * Dashboard cost trend's "so far" amount (trend-lag review L-1).
 */
export function formatUsdCents(amount: number): string {
  return USD_CENTS.format(amount)
}
