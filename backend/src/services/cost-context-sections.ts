/**
 * Cost evidence as shared ContextSections, for AI surfaces other than AI Chat.
 *
 * The figures come from AIChatContextRepository.gatherCostContext() -- the AI
 * Chat cost path -- not AWSCostService.getMonthlySpendWithFallback(), which
 * treats a real $0 or net-credit Cost Explorer month as a failure and swaps
 * in the inventory estimate. Here:
 *   - a Cost Explorer result is provenance 'actual' with billing scope, whatever
 *     its value (including $0 and a net-negative credit total);
 *   - the inventory estimate is provenance 'estimated' with inventory scope, a
 *     point-in-time monthly run-rate, never billed spend for a period;
 *   - neither is a number when both are missing ('unavailable' / 'error').
 *
 * The month-over-month comparison is AI Chat's computeMonthOverMonthComparison()
 * result (same finished-day windows and coverage threshold), expressed
 * through deriveSection() so it is 'derived' and records the daily trend it
 * came from. No comparison is recomputed here.
 */

import {
  collectSection,
  CONTEXT_STATE_LABELS,
  deriveSection,
  type ContextSection,
  type CostExplorerScope,
  type EvidencePeriod,
} from './ai-context-contract';
import { COMPARISON_BASIS, lastIncludedDay, type ChatContext } from './ai-chat.service';

export interface SpendEvidence {
  /** USD. May be 0 or negative (credits exceed charges) for billed spend. */
  amount: number;
  /**
   * billed_month_to_date        = AWS Cost Explorer spend for the section's period
   * estimated_monthly_run_rate  = DevControl list-price estimate for currently
   *                               discovered resources; not billed spend
   */
  basis: 'billed_month_to_date' | 'estimated_monthly_run_rate';
  /** Cost Explorer SERVICE categories (not per-resource costs); null for estimates. */
  topServices: Array<{ service: string; amount: number; sharePercent: number | null }> | null;
  /** For billed spend: the period's last day is today and still being billed. */
  lastDayInProgress: boolean;
  /**
   * For billed spend: the last UTC day whose charges are treated as finished
   * (today minus the provisional days Cost Explorer is still reporting). The
   * month-over-month comparison never extends past it. null for estimates.
   */
  finishedThrough: string | null;
}

export interface MonthOverMonthEvidence {
  currentWindow: { start: string; end: string };
  previousWindow: { start: string; end: string };
  currentWindowTotal: number;
  previousWindowTotal: number;
  changeAmount: number;
  /** null when the previous window totals $0 (a percentage is undefined). */
  changePercent: number | null;
  /** The current window ends today (still being billed). Always false: windows end at finished days. */
  currentWindowIncludesToday: boolean;
  basis: string;
}

interface DailyTrendWindows {
  currentWindow: { start: string; end: string };
  previousWindow: { start: string; end: string };
  currentWindowTotal: number;
  previousWindowTotal: number;
  changeAmount: number;
  changePercent: number | null;
  currentWindowIncludesToday: boolean;
}

const CE_SOURCE = 'AWS Cost Explorer';
const ESTIMATE_SOURCE = 'DevControl inventory cost estimate';
const TREND_SOURCE = 'AWS Cost Explorer daily trend';
const COMPARISON_SOURCE = 'DevControl month-over-month comparison';

/** The day after an inclusive YYYY-MM-DD date (calendar arithmetic, no timezone shift). */
function nextDay(date: string): string {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

export async function spendSection(costs: ChatContext['costs']): Promise<ContextSection<SpendEvidence>> {
  if (costs.source === 'actual' && costs.current !== null) {
    const period: EvidencePeriod | null = costs.period
      ? { kind: 'range', start: costs.period.start, endExclusive: costs.period.endExclusive }
      : null;
    const lastDay = costs.period ? lastIncludedDay(costs.period.endExclusive) : null;
    const lastDayInProgress = lastDay !== null && costs.asOf !== null && costs.asOf.slice(0, 10) === lastDay;
    const current = costs.current;
    return collectSection<SpendEvidence>({ source: CE_SOURCE, provenance: 'actual', scope: costs.scope, period }, async () => ({
      state: costs.state === 'partial' ? 'partial' : 'available',
      asOf: costs.asOf,
      data: {
        amount: current,
        basis: 'billed_month_to_date',
        topServices: (costs.topSpenders ?? []).map(s => ({ service: s.service, amount: s.cost, sharePercent: s.percentage })),
        lastDayInProgress,
        finishedThrough: costs.comparison.finishedThrough,
      },
      reason: lastDayInProgress ? 'month-to-date; the last day of the period is still being billed, so it is incomplete' : null,
    }));
  }

  if (costs.source === 'estimated' && costs.current !== null) {
    const current = costs.current;
    const coverage = costs.estimateCoverage;
    return collectSection<SpendEvidence>(
      {
        source: ESTIMATE_SOURCE,
        provenance: 'estimated',
        scope: costs.scope,
        period: { kind: 'point_in_time' },
        coverage: `used because AWS Cost Explorer is ${CONTEXT_STATE_LABELS[costs.costExplorer.state].toLowerCase()}${costs.costExplorer.reason ? ` (${costs.costExplorer.reason})` : ''}`,
      },
      async () => ({
        state: 'available',
        asOf: costs.asOf,
        data: { amount: current, basis: 'estimated_monthly_run_rate', topServices: null, lastDayInProgress: false, finishedThrough: null },
        completeness: coverage
          ? { unit: 'discovered resources with a cost estimate', expected: coverage.totalResources, received: coverage.estimatedResources, missing: null }
          : null,
      })
    );
  }

  const reason = costs.costExplorer.reason
    ? `no AWS Cost Explorer result (${costs.costExplorer.reason}) and no inventory estimate`
    : 'no AWS Cost Explorer result and no inventory estimate';
  if (costs.state === 'error') {
    // Raw failures were already logged by the cost path; the section keeps only a safe reason.
    return collectSection<SpendEvidence>({ source: CE_SOURCE }, async () => { throw new Error(reason); });
  }
  return collectSection<SpendEvidence>({ source: CE_SOURCE }, async () => ({ state: 'unavailable', reason }));
}

export async function monthOverMonthSection(costs: ChatContext['costs']): Promise<ContextSection<MonthOverMonthEvidence>> {
  const c = costs.comparison;
  const scope: CostExplorerScope | null = costs.scope?.kind === 'cost_explorer' ? costs.scope : null;
  const period: EvidencePeriod | null = c.previousWindow && c.currentWindow
    ? { kind: 'range', start: c.previousWindow.start, endExclusive: nextDay(c.currentWindow.end) }
    : null;
  const completeness = c.coverage
    ? {
        unit: 'days of daily Cost Explorer data',
        expected: c.coverage.expectedCurrentDays + c.coverage.expectedPreviousDays,
        received: c.coverage.currentDays + c.coverage.previousDays,
        missing: null,
      }
    : null;

  const trend = await collectSection<DailyTrendWindows>({ source: TREND_SOURCE, provenance: 'actual', scope, period }, async () => {
    if (c.state === 'error') throw new Error(c.note ?? 'the Cost Explorer daily trend request failed');
    if (
      (c.state !== 'available' && c.state !== 'partial') ||
      !c.currentWindow || !c.previousWindow ||
      c.currentWindowTotal === null || c.previousWindowTotal === null || c.changeAmount === null
    ) {
      return { state: 'unavailable', reason: c.note ?? 'no comparable daily Cost Explorer data', completeness };
    }
    return {
      state: c.state,
      asOf: c.asOf,
      completeness,
      reason: c.note,
      data: {
        currentWindow: c.currentWindow,
        previousWindow: c.previousWindow,
        currentWindowTotal: c.currentWindowTotal,
        previousWindowTotal: c.previousWindowTotal,
        changeAmount: c.changeAmount,
        changePercent: c.changePercent,
        currentWindowIncludesToday: c.currentWindowIncludesToday,
      },
    };
  });

  return deriveSection(
    {
      source: COMPARISON_SOURCE,
      scope,
      period,
      asOf: trend.asOf,
      coverage: c.currentWindowIncludesToday
        ? "month-to-date vs the same days of the previous month; the current window's last day is today and still being billed, while every previous-window day is complete"
        : 'finished days of this month vs the same days of the previous month; the latest days, still being reported by AWS Cost Explorer, are excluded',
    },
    [trend] as const,
    ([windows]) => ({ ...windows, basis: COMPARISON_BASIS })
  );
}
