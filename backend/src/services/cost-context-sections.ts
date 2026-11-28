/**
 * Cost evidence as shared ContextSections, for AI surfaces other than AI Chat.
 *
 * The figures come from AIChatContextRepository.gatherCostContext() -- the AI
 * Chat cost path -- not AWSCostService.getMonthlySpendWithFallback(), which
 * returns the bare figure without sections (both treat any Cost Explorer
 * success as actual). Here:
 *   - a Cost Explorer result is provenance 'actual' with billing scope, whatever
 *     its value (including $0 and a net-negative credit total);
 *   - the inventory estimate is provenance 'estimated' with inventory scope, a
 *     point-in-time monthly run-rate, never billed spend for a period;
 *   - neither is a number when both are missing ('unavailable' / 'error');
 *   - the current UTC month's state (cost-month-state.ts) travels with the
 *     figure as `monthState`, so "no billed days yet" is never read as $0.
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
import type { CostMonthState } from './cost-month-state';
import { PRICED_RESOURCES_UNIT } from './inventory-cost';
import { COMPARISON_BASIS, lastIncludedDay, type ChatCostSection } from './ai-chat.service';

export interface SpendEvidence {
  /**
   * USD. May be 0 or negative (credits exceed charges) for billed spend; null
   * when the month's state says the amount is not usable (no billed days yet),
   * so a model or page never receives 0 for missing billing data (DAY1-D5).
   */
  amount: number | null;
  /**
   * billed_month_to_date        = AWS Cost Explorer spend for the section's period
   * estimated_monthly_run_rate  = DevControl us-east-1 list-price estimate for the
   *                               currently discovered resources that have a defensible
   *                               price (estimateCoverage); not billed spend
   */
  basis: 'billed_month_to_date' | 'estimated_monthly_run_rate';
  /** Cost Explorer SERVICE categories (not per-resource costs); null for estimates. */
  topServices: Array<{ service: string; amount: number; sharePercent: number | null }> | null;
  /**
   * Only for the inventory estimate: K of N -- the estimate sums the pricedResources of the
   * totalResources discovered (placeholder-costs F-5, "Estimated from K of N priced resources").
   * Absent for billed spend.
   */
  estimateCoverage?: { pricedResources: number; totalResources: number; excludedResources?: number } | null;
  /** For billed spend: the period's last day is today and still being billed. */
  lastDayInProgress: boolean;
  /**
   * For billed spend: the last UTC day whose charges are treated as finished
   * (today minus the provisional days Cost Explorer is still reporting). The
   * month-over-month comparison never extends past it. null for estimates.
   */
  finishedThrough: string | null;
  /**
   * Only with spendSection(costs, { previousMonth: true }) (the cost summary
   * endpoint): the previous UTC calendar month's net Cost Explorer total, from
   * the same request as the month to date; null when there is none.
   */
  previousMonth?: { start: string; endExclusive: string; amount: number } | null;
  /**
   * The current UTC month's state (cost-month-state.ts): period identity,
   * whether Cost Explorer has reported anything yet, whether `amount` may be
   * used, billed-through evidence. Present whenever the cost path produced one.
   * In the model-facing section its previousMonth is null once a day of this
   * month has finished (modelFacingMonthState).
   */
  monthState?: CostMonthState;
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

/**
 * The month state as a model reads it (AI reports, the evidence registry, Ask
 * AI): the previous month's total only while no day of this month has
 * finished (no_billed_days_yet / latest_days_updating), as the AI summary and
 * chat prose give it. Later in the month a model would set a whole month
 * beside a partial one ("down 50% vs last month" on Dec 15), which the
 * same-days month-over-month comparison exists to prevent (review M-2).
 */
export function modelFacingMonthState(state: CostMonthState): CostMonthState {
  return state.state === 'no_billed_days_yet' || state.state === 'latest_days_updating' ? state : { ...state, previousMonth: null };
}

export async function spendSection(costs: ChatCostSection, options: { previousMonth?: boolean } = {}): Promise<ContextSection<SpendEvidence>> {
  // { previousMonth: true } is the cost summary endpoint's view for pages, which
  // decide themselves when to show the previous month; without it the section
  // is model-facing evidence.
  const monthState = costs.monthState
    ? { monthState: options.previousMonth ? costs.monthState : modelFacingMonthState(costs.monthState) }
    : {};
  if (costs.provenance === 'actual' && costs.data) {
    const period: EvidencePeriod | null = costs.period?.kind === 'range' ? costs.period : null;
    const lastDay = period?.kind === 'range' ? lastIncludedDay(period.endExclusive) : null;
    const lastDayInProgress = lastDay !== null && costs.asOf !== null && costs.asOf.slice(0, 10) === lastDay;
    const { current, topSpenders } = costs.data;
    return collectSection<SpendEvidence>({ source: CE_SOURCE, classification: 'billed', scope: costs.scope, period }, async () => ({
      state: costs.state === 'partial' ? 'partial' : 'available',
      asOf: costs.asOf,
      data: {
        amount: current,
        basis: 'billed_month_to_date',
        topServices: (topSpenders ?? []).map(s => ({ service: s.service, amount: s.cost, sharePercent: s.percentage })),
        lastDayInProgress,
        finishedThrough: costs.comparison.finishedThrough,
        ...(options.previousMonth ? { previousMonth: costs.previousMonth ?? null } : {}),
        ...monthState,
      },
      reason: lastDayInProgress ? 'month-to-date; the last day of the period is still being billed, so it is incomplete' : null,
    }));
  }

  if (costs.provenance === 'estimated' && costs.data) {
    const current = costs.data.current;
    const coverage = costs.data.estimateCoverage;
    return collectSection<SpendEvidence>(
      {
        source: ESTIMATE_SOURCE,
        classification: 'estimated',
        scope: costs.scope,
        period: { kind: 'point_in_time' },
        coverage: `used because AWS Cost Explorer is ${CONTEXT_STATE_LABELS[costs.costExplorer.state].toLowerCase()}${costs.costExplorer.reason ? ` (${costs.costExplorer.reason})` : ''}`,
      },
      async () => ({
        state: 'available',
        asOf: costs.asOf,
        data: {
          amount: current, basis: 'estimated_monthly_run_rate', topServices: null, lastDayInProgress: false, finishedThrough: null,
          estimateCoverage: coverage ?? null,
          ...monthState,
        },
        completeness: coverage
          ? { unit: PRICED_RESOURCES_UNIT, expected: coverage.totalResources, received: coverage.pricedResources, missing: null }
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

export async function monthOverMonthSection(costs: ChatCostSection): Promise<ContextSection<MonthOverMonthEvidence>> {
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

  const trend = await collectSection<DailyTrendWindows>({ source: TREND_SOURCE, classification: 'billed', scope, period }, async () => {
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
