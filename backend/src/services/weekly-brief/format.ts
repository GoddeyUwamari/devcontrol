/**
 * Formatting for the weekly summary email. Pure. Every date is a UTC date.
 */
import { formatSavingsCurrency } from '../../utils/formatSavingsCurrency';
import type { DayWindow } from '../../repositories/weekly-summary.repository';

const DAY_MS = 24 * 60 * 60 * 1000;
const MINUS = '−';

function monthDay(day: string, withYear = false): string {
  return new Date(`${day}T00:00:00Z`).toLocaleDateString('en-US', {
    timeZone: 'UTC', month: 'short', day: 'numeric', ...(withYear ? { year: 'numeric' } : {}),
  });
}

function lastDayOf(window: DayWindow): string {
  return new Date(Date.parse(`${window.endExclusive}T00:00:00Z`) - DAY_MS).toISOString().slice(0, 10);
}

/** "Nov 9 – 15, 2026"; "Oct 26 – Nov 1, 2026" across two months; both years across two years. */
export function formatSubjectWindow(window: DayWindow): string {
  const last = lastDayOf(window);
  if (window.start.slice(0, 4) !== last.slice(0, 4)) return `${monthDay(window.start, true)} – ${monthDay(last, true)}`;
  if (window.start.slice(5, 7) !== last.slice(5, 7)) return `${monthDay(window.start)} – ${monthDay(last, true)}`;
  return `${monthDay(window.start)} – ${Number(last.slice(8, 10))}, ${last.slice(0, 4)}`;
}

/** "Nov 15, 06:00 UTC" (the header carries the year). */
export function formatTime(iso: string): string {
  const d = new Date(iso);
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${monthDay(d.toISOString().slice(0, 10))}, ${hh}:${mm} UTC`;
}

/** "Nov 15" (the UTC day of an instant). */
export function formatDate(iso: string): string {
  return monthDay(new Date(iso).toISOString().slice(0, 10));
}

function nextDay(day: string): string {
  return new Date(Date.parse(`${day}T00:00:00Z`) + DAY_MS).toISOString().slice(0, 10);
}

function span(first: string, last: string): string {
  if (first === last) return monthDay(first);
  return first.slice(5, 7) === last.slice(5, 7)
    ? `${monthDay(first)}–${Number(last.slice(8, 10))}`
    : `${monthDay(first)} – ${monthDay(last)}`;
}

/** Sorted YYYY-MM-DD days as ranges: "Nov 10–12", "Oct 30 – Nov 2", "Nov 13", "Nov 10–11, Nov 14". */
export function formatDays(days: string[]): string {
  const sorted = [...days].sort();
  const parts: string[] = [];
  let first = sorted[0];
  let last = sorted[0];
  for (const day of sorted.slice(1)) {
    if (day === nextDay(last)) {
      last = day;
    } else {
      parts.push(span(first, last));
      first = day;
      last = day;
    }
  }
  if (first) parts.push(span(first, last));
  return parts.join(', ');
}

/** Spend at cent precision: "$1,234.56", "−$0.48". */
export function formatMoney(amount: number): string {
  const abs = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return amount < 0 && abs !== '0.00' ? `${MINUS}$${abs}` : `$${abs}`;
}

/** A change with its sign always shown: "+$0.48", "−$0.48". */
export function formatSignedMoney(amount: number): string {
  return amount < 0 ? formatMoney(amount) : `+${formatMoney(amount)}`;
}

/**
 * A savings figure with the Cost Optimization page's own formatter
 * (formatSavingsCurrency, backend mirror of lib/utils.ts): whole dollars at
 * $1 and above.
 */
export function formatSavings(amount: number): string {
  return formatSavingsCurrency(amount);
}

/**
 * The open opportunities' monthly figure (founder Q7): the page's formatter,
 * except that a positive estimate whose cent-rounded total is 0 is
 * "<$0.01/mo". Null when no open finding has an estimate above $0: the
 * caller then says "no dollar estimate yet", never "$0/mo".
 */
export function formatOpenSavings(estimate: number, estimatedFindings: number): string | null {
  if (estimatedFindings <= 0) return null;
  return estimate === 0 ? '<$0.01/mo' : `${formatSavings(estimate)}/mo`;
}

export function plural(count: number, singular: string, pluralForm = `${singular}s`): string {
  return `${count} ${count === 1 ? singular : pluralForm}`;
}
