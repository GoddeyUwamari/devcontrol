/**
 * The weekly summary email's facts: one typed object built from the sections
 * WeeklySummaryRepository.gatherWeeklyEvidence() reads. Every rule
 * (rules.ts) and the template read only this object, through the rules'
 * output. Pure: no database, AWS or clock reads.
 *
 * What this module decides, and nothing else:
 *   - the AWS connection's state for the email (founder Q1);
 *   - which of this week's Cost Explorer days are finished, still updating or
 *     not reported, by each trend point's own reportState (trend-lag rule,
 *     costReportStates(): never recomputed here), and whether the finished
 *     days have a week-over-week comparison (R4);
 *   - the per-service lines' numbers (R5, founder Q8: raw after-credits
 *     amounts, see SERVICE_LINES_NOTE in rules.ts);
 *   - the counts behind security, savings and delivery, with what they are
 *     dated by.
 * A source that couldn't be read stays `error` (or `unavailable`), never 0.
 */

import { hasEvidence, type ContextSection } from '../ai-context-contract';
import { normalizeServiceName } from '../aws-cost.service';
import type {
  DayWindow,
  WeeklyAnalysisEvidence,
  WeeklyAnalysisRunState,
  WeeklyConnectionHealth,
  WeeklyDORAMetrics,
  WeeklyEvidence,
  WeeklyRunEvidence,
  WeeklySummaryPeriod,
  WeeklyTrendDay,
} from '../../repositories/weekly-summary.repository';

/** The reason the security section gives while no scan has completed (set by the repository, read here). */
export const SECURITY_PRELIMINARY_REASON = 'the security posture score is still preliminary';

const DAY_MS = 24 * 60 * 60 * 1000;

// ── Connection ───────────────────────────────────────────────────────────────

/**
 * The AWS connection as the email states it (founder Q1):
 *   ok       the health check's display state is ok (checked within 24 h, last result OK);
 *   broken   failing or lost, or not checked recently with a failing/lost last result;
 *   stale    not checked recently, last result OK;
 *   not_checked_yet, not_connected;
 *   unknown  the connection or its health couldn't be read.
 * Only `ok` allows the clean state; only `broken` is an attention item.
 */
export type ConnectionFacts =
  | { state: 'ok'; checkedAt: string }
  | { state: 'broken'; lastOkAt: string | null }
  | { state: 'stale'; checkedAt: string }
  | { state: 'not_checked_yet' }
  | { state: 'not_connected' }
  | { state: 'unknown' };

export function connectionFacts(
  awsConnection: WeeklyEvidence['awsConnection'],
  health: ContextSection<WeeklyConnectionHealth> | null
): ConnectionFacts {
  if (awsConnection === 'not_connected') return { state: 'not_connected' };
  if (!health || !hasEvidence(health)) return { state: 'unknown' };
  const h = health.data;
  if (h.state === 'ok' && h.checkedAt) return { state: 'ok', checkedAt: h.checkedAt };
  if (h.state === 'failing' || h.state === 'lost') return { state: 'broken', lastOkAt: h.lastOkAt };
  if (h.state === 'not_checked_recently' && h.checkedAt) {
    if (h.lastResult === 'failing' || h.lastResult === 'lost') return { state: 'broken', lastOkAt: h.lastOkAt };
    if (h.lastResult === 'ok') return { state: 'stale', checkedAt: h.checkedAt };
  }
  if (h.state === 'not_checked_yet') return { state: 'not_checked_yet' };
  return { state: 'unknown' };
}

// ── Scan and cost analysis ───────────────────────────────────────────────────

/** The latest discovery scan and the last completed one; null when the scan read failed. */
export type ScanFacts = WeeklyRunEvidence | null;

/** The latest cost analysis as the email states it (footer, Cost item note, savings tile). */
export type AnalysisFacts =
  | { kind: 'completed'; at: string; partial: boolean; checks: { total: number; complete: number } | null }
  | { kind: 'from_last_completed'; lastAt: string; lastPartial: boolean; latest: 'did_not_finish' | 'in_progress'; thisWeek: boolean }
  | { kind: 'did_not_finish' }
  | { kind: 'in_progress' }
  | { kind: 'never' }
  | { kind: 'unreadable' };

function analysisFacts(section: ContextSection<WeeklyAnalysisEvidence> | null, period: WeeklySummaryPeriod): AnalysisFacts {
  if (!section || !hasEvidence(section)) return { kind: 'unreadable' };
  const { latest, lastCompleted, latestChecks } = section.data;
  if (!latest) return { kind: 'never' };
  // A partial run completed with gaps: it dates the figures it reconciled (WE-2 review H-1).
  if (latest.state === 'completed' || latest.state === 'partial') {
    return { kind: 'completed', at: latest.at, partial: latest.state === 'partial', checks: latestChecks };
  }
  const state = latest.state as Exclude<WeeklyAnalysisRunState, 'completed' | 'partial'>;
  if (lastCompleted) {
    return {
      kind: 'from_last_completed',
      lastAt: lastCompleted.at,
      lastPartial: lastCompleted.partial === true,
      latest: state,
      thisWeek: Date.parse(latest.startedAt) >= Date.parse(period.delivery.start),
    };
  }
  return { kind: state };
}

/** The scan the security counts come from: the last completed one, and whether it is also the latest. */
export function completedScan(scan: ScanFacts): { at: string; isLatest: boolean } | null {
  if (!scan || !scan.lastCompleted) return null;
  return { at: scan.lastCompleted.at, isLatest: scan.latest?.state === 'completed' };
}

// ── Security ─────────────────────────────────────────────────────────────────

export type SecurityFacts =
  | { state: 'available'; account: number; resource: number; open: number; score?: number }
  | { state: 'preliminary' }
  | { state: 'not_connected' }
  | { state: 'error' };

function securityFacts(section: WeeklyEvidence['security']): SecurityFacts {
  if (section.state === 'not_connected') return { state: 'not_connected' };
  if (!hasEvidence(section)) {
    return section.reason === SECURITY_PRELIMINARY_REASON ? { state: 'preliminary' } : { state: 'error' };
  }
  const d = section.data;
  return {
    state: 'available',
    account: d.accountLevelFindings,
    resource: d.resourceComplianceIssues,
    open: d.accountLevelFindings + d.resourceComplianceIssues,
    ...(d.score !== undefined ? { score: d.score } : {}),
  };
}

// ── Cost ─────────────────────────────────────────────────────────────────────

export interface ServiceAmount {
  /** The chart's display name (normalizeServiceName). */
  service: string;
  amount: number;
}

/**
 * How the finished days compare with the same weekdays of the week before (R4):
 *   percent          every finished day's weekday a week earlier is finished too, and that total is > $0;
 *   mismatch         only `previousFinished` of the N earlier days are finished;
 *   previous_zero    all N earlier days are finished and total $0.00;
 *   no_finished_days nothing is finished this week.
 */
export type CostComparison =
  | { kind: 'percent'; previousDays: string[]; previousTotal: number; changePercent: number }
  | { kind: 'mismatch'; previousFinished: number }
  | { kind: 'previous_zero'; previousDays: string[] }
  | { kind: 'no_finished_days' };

/** The service lines (R5): changes when there is a percent comparison, else totals; null when a day involved has no per-service data. */
export type ServiceLines =
  | { kind: 'change'; rows: ServiceAmount[] }
  | { kind: 'totals'; rows: ServiceAmount[] }
  | null;

export type CostFacts =
  | {
      state: 'available';
      /** The 7 full UTC days before this email. */
      window: DayWindow;
      finished: { days: string[]; total: number };
      updating: { days: string[]; total: number };
      /** Days with no point at all, or a point Cost Explorer marks not reported: no amount is stated for them. */
      notReported: string[];
      /**
       * Days whose point exists but carries no reportState (an older cached
       * shape; brief review L-1): reported, but whether finished is not
       * determined. Left out of every total and comparison, listed by date
       * only, with no amount and no percentage.
       */
      undetermined: string[];
      comparison: CostComparison;
      services: ServiceLines;
    }
  | { state: 'not_connected' }
  | { state: 'unavailable'; reason: string }
  | { state: 'error' };

/** How many service lines a block shows (founder Q8: top 3 in both lists). */
export const SERVICE_LINE_COUNT = 3;

function roundCents(amount: number): number {
  return Math.round(amount * 100) / 100;
}

function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function daysOf(window: DayWindow): string[] {
  const days: string[] = [];
  for (let t = Date.parse(`${window.start}T00:00:00Z`); isoDay(t) < window.endExclusive; t += DAY_MS) days.push(isoDay(t));
  return days;
}

/** The same weekday one week earlier. */
export function weekEarlier(day: string): string {
  return isoDay(Date.parse(`${day}T00:00:00Z`) - 7 * DAY_MS);
}

/** Per display name, the sum over `days` of the raw per-service amounts; null when any day has no per-service data. */
function serviceSums(days: string[], byDay: Map<string, WeeklyTrendDay>): Map<string, number> | null {
  const sums = new Map<string, number>();
  for (const day of days) {
    const services = byDay.get(day)?.byService;
    if (!services) return null;
    for (const { service, amount } of services) {
      const name = normalizeServiceName(service);
      sums.set(name, (sums.get(name) ?? 0) + amount);
    }
  }
  return sums;
}

/** The largest SERVICE_LINE_COUNT rows by absolute amount (then name), each cent-rounded, leaving out any that round to $0.00. */
function topRows(sums: Map<string, number>): ServiceAmount[] {
  return [...sums]
    .map(([service, amount]) => ({ service, amount: roundCents(amount) }))
    .filter(row => row.amount !== 0)
    .sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount) || a.service.localeCompare(b.service))
    .slice(0, SERVICE_LINE_COUNT);
}

export function costFacts(section: WeeklyEvidence['costTrend'], window: DayWindow): CostFacts {
  if (section.state === 'not_connected') return { state: 'not_connected' };
  if (section.state === 'error') return { state: 'error' };
  if (!hasEvidence(section)) return { state: 'unavailable', reason: section.reason ?? 'no data' };

  const byDay = new Map(section.data.days.map(d => [d.date, d]));
  const finishedDays: string[] = [];
  const updatingDays: string[] = [];
  const notReported: string[] = [];
  const undetermined: string[] = [];
  for (const day of daysOf(window)) {
    const point = byDay.get(day);
    const state = point?.reportState ?? null;
    if (state === 'final') finishedDays.push(day);
    else if (state === 'updating') updatingDays.push(day);
    else if (point && state === null) undetermined.push(day);
    else notReported.push(day);
  }
  const sumOf = (days: string[]) => roundCents(days.reduce((sum, day) => sum + byDay.get(day)!.total, 0));
  const finishedTotal = sumOf(finishedDays);

  let comparison: CostComparison;
  if (finishedDays.length === 0) {
    comparison = { kind: 'no_finished_days' };
  } else {
    const previousDays = finishedDays.map(weekEarlier).filter(day => byDay.get(day)?.reportState === 'final');
    if (previousDays.length !== finishedDays.length) {
      comparison = { kind: 'mismatch', previousFinished: previousDays.length };
    } else {
      const previousTotal = sumOf(previousDays);
      comparison = previousTotal > 0
        ? { kind: 'percent', previousDays, previousTotal, changePercent: ((finishedTotal - previousTotal) / previousTotal) * 100 }
        : { kind: 'previous_zero', previousDays };
    }
  }

  let services: ServiceLines = null;
  if (comparison.kind === 'percent') {
    const current = serviceSums(finishedDays, byDay);
    const previous = serviceSums(comparison.previousDays, byDay);
    if (current && previous) {
      const change = new Map<string, number>();
      for (const name of new Set([...current.keys(), ...previous.keys()])) {
        change.set(name, (current.get(name) ?? 0) - (previous.get(name) ?? 0));
      }
      services = { kind: 'change', rows: topRows(change) };
    }
  } else if (finishedDays.length > 0) {
    const current = serviceSums(finishedDays, byDay);
    if (current) services = { kind: 'totals', rows: topRows(current) };
  }
  if (services && services.rows.length === 0) services = null;

  return {
    state: 'available',
    window,
    finished: { days: finishedDays, total: finishedTotal },
    updating: { days: updatingDays, total: sumOf(updatingDays) },
    notReported,
    undetermined,
    comparison,
    services,
  };
}

// ── Savings ──────────────────────────────────────────────────────────────────

export type SavingsFacts =
  | {
      state: 'available';
      /** Open (ACTIVE) findings, as the Cost Optimization page counts them (same aggregation as /stats). */
      open: {
        count: number;
        /** The de-duplicated, cent-rounded estimate total. */
        estimate: number;
        /** Findings whose estimate adds more than $0 (before rounding). */
        estimatedFindings: number;
        unestimatedFindings: number;
        /** Every upper bound, summed (the page's "Plus up to $X/mo in estimated ceilings"). */
        ceiling: number;
      };
      stillDetected: { count: number; estimate: number; ceiling: number; example: { check: string; resource: string; region: string | null; resolvedAt: string } | null };
      /** False only while no cost analysis has ever completed and nothing is open: then "nothing to review" is not a measurement. */
      measured: boolean;
    }
  /**
   * `error` also covers a cost-analysis read that failed while nothing is open
   * (brief review M-1): with no run date, "nothing to review" is not a
   * measurement, so the savings figure couldn't be retrieved (as D-5, Q4).
   */
  | { state: 'not_connected' }
  | { state: 'error' };

function savingsFacts(e: WeeklyEvidence, analysis: AnalysisFacts): SavingsFacts {
  const r = e.recommendations;
  const s = e.stillDetected;
  if (r.state === 'not_connected' || s.state === 'not_connected') return { state: 'not_connected' };
  if (!hasEvidence(r) || !hasEvidence(s)) return { state: 'error' };
  const ceiling = roundCents(Object.values(r.data.ceilingByResourceType).reduce((sum, v) => sum + v, 0));
  const neverAnalysed = analysis.kind === 'never' || analysis.kind === 'did_not_finish' || analysis.kind === 'in_progress';
  const nothingOpen = r.data.active === 0 && s.data.count === 0;
  if (analysis.kind === 'unreadable' && nothingOpen) return { state: 'error' };
  return {
    state: 'available',
    open: {
      count: r.data.active,
      estimate: r.data.estimatedMonthlySavings,
      estimatedFindings: r.data.estimatedFindings,
      unestimatedFindings: r.data.unestimatedFindings,
      ceiling,
    },
    stillDetected: {
      count: s.data.count,
      estimate: s.data.estimatedMonthlySavings,
      ceiling: s.data.ceilingMonthlySavings,
      example: s.data.example,
    },
    measured: !(neverAnalysed && nothingOpen),
  };
}

// ── Delivery ─────────────────────────────────────────────────────────────────

export type DeliveryFacts =
  | {
      state: 'available';
      /** Every deployment recorded in the window, whatever its status. */
      count: number;
      failed: number;
      /** success + failed: the only finished outcomes. count - finished have no result (D3). */
      finished: number;
      /** The change failure rate: a number, null when nothing finished, undefined below the DORA metrics plan. */
      rate: number | null | undefined;
      /** Whether any deployment was ever recorded; null when that couldn't be read. */
      everRecorded: boolean | null;
    }
  | { state: 'error' };

function deliveryFacts(section: ContextSection<WeeklyDORAMetrics>, history: WeeklyEvidence['deploymentHistory']): DeliveryFacts {
  if (!hasEvidence(section)) return { state: 'error' };
  const d = section.data;
  return {
    state: 'available',
    count: d.deploymentCount,
    failed: d.failedDeployments,
    finished: d.successfulDeployments + d.failedDeployments,
    rate: d.changeFailureRate,
    everRecorded: hasEvidence(history) ? history.data.anyRecorded : null,
  };
}

// ── The facts ────────────────────────────────────────────────────────────────

export interface WeeklyFacts {
  generatedAt: string;
  period: WeeklySummaryPeriod;
  connection: ConnectionFacts;
  scan: ScanFacts;
  analysis: AnalysisFacts;
  security: SecurityFacts;
  cost: CostFacts;
  savings: SavingsFacts;
  delivery: DeliveryFacts;
}

export function weeklyFacts(e: WeeklyEvidence): WeeklyFacts {
  const analysis = analysisFacts(e.costAnalysis, e.period);
  return {
    generatedAt: e.period.generatedAt,
    period: e.period,
    connection: connectionFacts(e.awsConnection, e.connectionHealth),
    scan: e.scan && hasEvidence(e.scan) ? e.scan.data : null,
    analysis,
    security: securityFacts(e.security),
    cost: costFacts(e.costTrend, e.period.cost),
    savings: savingsFacts(e, analysis),
    delivery: deliveryFacts(e.delivery, e.deploymentHistory),
  };
}
