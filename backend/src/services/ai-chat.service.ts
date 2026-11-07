/**
 * AI Chat Service
 * Handles conversational AI interactions for AWS infrastructure Q&A
 * Streams responses for better UX
 */

import { Pool } from 'pg';
import { getModelClient, streamModelText } from './ai/model-client';
import type { EvidenceBundle } from './ai/evidence/types';
import { renderEvidence, statusPhrase, UNTRUSTED_TEXT_RULE } from './ai/evidence/render';
import {
  CONTEXT_STATE_LABELS,
  type ContextDataState,
  type ContextScope,
  type ContextSection,
  type CostExplorerScope,
  type InventoryScope,
} from './ai-context-contract';

// Defined in ai-context-contract.ts; re-exported so existing imports keep working.
export type { ContextDataState, ContextSection, CostExplorerScope, InventoryScope } from './ai-context-contract';

/**
 * Month-to-date vs the same days of the previous month, from Cost Explorer's
 * daily trend (the Dashboard's computeMonthOverMonthCostChange() algorithm).
 * Its own state: a comparison is never fabricated from the current figure.
 */
export interface CostComparison {
  state: ContextDataState;
  /** Why the comparison is not (fully) available, or a caveat on an available one. */
  note: string | null;
  currentWindow: { start: string; end: string } | null;
  previousWindow: { start: string; end: string } | null;
  currentWindowTotal: number | null;
  previousWindowTotal: number | null;
  changeAmount: number | null;
  /** null when the previous window total is 0 (a percentage is undefined). */
  changePercent: number | null;
  /** Days of daily trend data found in each window vs the days each window spans. */
  coverage: { currentDays: number; previousDays: number; expectedCurrentDays: number; expectedPreviousDays: number } | null;
  /**
   * The current window's last day is today -- still being billed -- while the
   * previous window's days are complete, so the windows are not like-for-like.
   * Always false since the windows end at finishedThrough; kept for consumers.
   */
  currentWindowIncludesToday: boolean;
  /**
   * The last UTC day treated as finished (costFinishedThrough): the current
   * window never extends past it. null when there is no Cost Explorer result.
   */
  finishedThrough: string | null;
  /** When the daily trend behind this comparison was fetched from Cost Explorer; null if unknown. */
  asOf: string | null;
  /** How the window totals are calculated -- stated so the model can't read them as net billed spend. */
  basis: string;
}

/**
 * What the comparison windows sum: fetchCostTrend()'s daily category totals,
 * each floored at $0 (the Dashboard's comparison uses the same figures).
 */
export const COMPARISON_BASIS =
  'sum of AWS Cost Explorer daily charges per cost category, with any negative daily category amount floored to zero -- credits and refunds are excluded, so window totals can differ from month-to-date spend';

/** How each state reads in model-facing text (shared with every AI surface). */
const STATE_LABELS = CONTEXT_STATE_LABELS;

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/**
 * Cost Explorer keeps filling in a day's charges for 24-48 hours, so today and
 * yesterday (UTC, Cost Explorer's own day boundary) are provisional.
 */
export const PROVISIONAL_COST_DAYS = 2;

/** The last UTC day whose Cost Explorer charges are treated as finished: today (UTC) minus PROVISIONAL_COST_DAYS. */
export function costFinishedThrough(now: Date = new Date()): string {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - PROVISIONAL_COST_DAYS)).toISOString().slice(0, 10);
}

/** The inclusive last day of an exclusive YYYY-MM-DD end boundary (calendar dates, no timezone shift). */
export function lastIncludedDay(endExclusive: string): string {
  const [y, m, d] = endExclusive.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d - 1)).toISOString().slice(0, 10);
}

/**
 * An inclusive YYYY-MM-DD..YYYY-MM-DD range as a reader would write it:
 * "September 1–25, 2026", "August 30 – September 2, 2026", or one day alone.
 */
export function formatInclusiveRange(start: string, endInclusive: string): string {
  const [sy, sm, sd] = start.split('-').map(Number);
  const [ey, em, ed] = endInclusive.split('-').map(Number);
  if (start === endInclusive) return `${MONTH_NAMES[sm - 1]} ${sd}, ${sy}`;
  if (sy === ey && sm === em) return `${MONTH_NAMES[sm - 1]} ${sd}–${ed}, ${sy}`;
  if (sy === ey) return `${MONTH_NAMES[sm - 1]} ${sd} – ${MONTH_NAMES[em - 1]} ${ed}, ${sy}`;
  return `${MONTH_NAMES[sm - 1]} ${sd}, ${sy} – ${MONTH_NAMES[em - 1]} ${ed}, ${ey}`;
}

/** Counts from DevControl's resource inventory. Every count is explicit, including a real 0. */
export interface InventoryResources {
  // CPU utilization is not an inventory field: it is its own evidence source
  // (telemetry.cpu in the evidence registry), never a figure here.
  ec2: { count: number };
  // estimatedMonthlyCost: SUM of estimated_monthly_cost (DevControl list-price
  // estimates for the whole RDS resource -- not AWS billed spend, not storage
  // alone) over the estimatedForCount databases that carry one; null when none do.
  rds: { count: number; estimatedMonthlyCost: number | null; estimatedForCount: number };
  // invocations is a real, usage-based figure -- SUM of each function's
  // real 30-day CloudWatch Invocations (see awsResourceDiscovery.ts's
  // discoverLambdaFunctions()/lambda-usage.util.ts), read back from
  // aws_resources.metadata->>'invocations_30d'. invocationsKnownForCount
  // is how many of `count` functions actually have a known usage figure
  // (a per-function CloudWatch failure leaves that one function's usage
  // unknown, not zero) -- callers must not present `invocations` as a
  // complete total when invocationsKnownForCount < count.
  lambda: { count: number; invocations: number; invocationsKnownForCount: number };
}

/** The spend figure AI Chat is given, whichever source produced it. */
export interface ChatCostFigures {
  /**
   * provenance 'actual' (classification 'billed'): Cost Explorer month-to-date
   * spend, including a real $0 or a net-negative credit total;
   * provenance 'estimated': DevControl's list-price monthly run-rate.
   */
  current: number;
  /** Cost Explorer SERVICE categories; null when no per-service breakdown exists (estimates). [] is a real, empty breakdown. */
  topSpenders: Array<{
    service: string;
    cost: number;
    /** Share of the total; null when the total is $0 or net-negative, where a share is meaningless. */
    percentage: number | null;
  }> | null;
  /** For estimates: how many discovered (non-terminated) resources actually carry an estimate. */
  estimateCoverage: { estimatedResources: number; totalResources: number } | null;
}

/**
 * AI Chat's cost evidence as a ContextSection (contract version 2). Its
 * provenance says which source produced the figure (null: none did), and it
 * keeps two facts a section without data still needs: the outcome of the
 * Cost Explorer attempt itself (kept even when an estimate or nothing was
 * used), and the month-over-month comparison with its own state.
 */
export type ChatCostSection = ContextSection<ChatCostFigures> & {
  costExplorer: { state: ContextDataState; reason: string | null };
  comparison: CostComparison;
};

export interface ChatContext {
  /** Latest completed resource discovery run -- the freshness of `services` and `resources`. */
  discovery: ContextSection<{ completedAt: string }>;
  /** The connected AWS account row (aws_accounts) both discovery and Cost Explorer run under. */
  account: ContextSection<{ accountId: string | null; region: string | null }>;
  /** Distinct discovered resource types in the inventory. */
  services: ContextSection<string[]>;
  costs: ChatCostSection;
  /** Scope of the resource inventory section (and of every figure derived from it). */
  inventoryScope: InventoryScope;
  resources: ContextSection<InventoryResources>;
  dora: ContextSection<{ deploymentFrequency: string; changeFailureRate: string; leadTime: string; mttr: string }>;
  /**
   * Every other evidence source, from the shared evidence registry
   * (services/ai/evidence/): one header per registered provider, with data
   * for the providers the question's topics selected.
   */
  evidence: EvidenceBundle;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

/** Rendered by AI Chat in its own established format, so the generic evidence block leaves out their data. */
export const CHAT_FORMATTED_PROVIDERS = [
  'cost.spend',
  'cost.month_over_month',
  'inventory.resource_types',
  'inventory.compute_detail',
  'delivery.dora',
] as const;

/** The existing chat error reply, reused for every outcome that is not a usable answer. */
export const CHAT_ERROR_REPLY = 'I apologize, but I encountered an error processing your request. Please try again.';

/** Appended when the model stopped at its length limit: what was streamed is not the whole answer. */
export const CHAT_TRUNCATED_NOTICE = '(Answer cut short: it reached the maximum response length. Ask a narrower question for a complete answer.)';

/** The reply when the model declined the request (stop_reason refusal). */
export const CHAT_REFUSAL_REPLY = "I can't help with that request.";

export class AIChatService {
  constructor(private pool: Pool) {
    if (!getModelClient()) {
      console.warn('[AI Chat] ANTHROPIC_API_KEY not found - AI chat will use fallback responses');
    }
  }

  /**
   * System prompt for AI chat assistant
   */
  private getSystemPrompt(): string {
    return `You are an expert AWS Cloud Architect, Platform Engineer, and FinOps advisor.
You are embedded inside a paid SaaS platform that manages the user's real AWS infrastructure.

You receive structured context about the user's AWS environment, including:
- Services in use
- Cost data and trends
- A list of every evidence source DevControl has for this organization, each with
  its state (for example security findings, compliance, CloudWatch alarms, CPU
  telemetry, cost findings, regions), and the data of the sources this question needs
- Deployment and reliability signals (DORA)

This context is NOT a live feed. Each section carries its own real provenance and
freshness, which you must respect exactly as labeled:
- Cost data has a Status, a Source (AWS Cost Explorer, a DevControl inventory
  estimate used when Cost Explorer is unavailable, or none), an "As of" timestamp
  -- the moment that figure was actually obtained, which may be several hours old
  even when the source is Cost Explorer, since it is served from a short-lived cache
  -- and a Scope (which AWS account/billing scope and which regions it covers).
  Cost Explorer figures cover the connected IAM role's billing scope across all
  regions; whether that includes other linked accounts is stated as unknown unless
  the scope says otherwise. Resource inventory covers only the regions its scope lists.
  Never describe a Cost Explorer figure as covering exactly one AWS account, and
  never compare it to inventory as if the two had the same scope.
- Every section has a Status: "Available" (complete for its scope), "Partial"
  (only part of its scope, or possibly stale -- say which, using its Limitation),
  "Out of date" (older than its freshness rule -- give its as-of time, never call
  it current), "Not available" or "Not connected" (no data, with the reason),
  "Could not be retrieved" (collection failed), "Not included in this plan" (the
  organization's plan does not include it, so it was not read), or "Not provided
  by DevControl yet". Only report figures that are actually present; never treat
  any of those as $0, zero, none, empty, unchanged, or "no findings" -- say that
  data is not available and why. "Checked, none found" is a real result: state it
  with its source and as-of time.
- Resource inventory (services, EC2/RDS/Lambda counts) is synchronized
  periodically by a background discovery process, not queried live -- its "As of"
  timestamp is the last time that process completed successfully for this account.
- Cost periods and comparison windows are given as inclusive date ranges. State
  dates exactly as those inclusive ranges; never present an exclusive end
  boundary as a day that is included. When the context says a period's last day
  was still in progress, say that day's spend is incomplete, and do not present
  a window ending on it as like-for-like with a window of complete days.

RULES:

0. FRESHNESS AND PROVENANCE
- Never describe context data as "real-time," "live," or "current" unless the
  data's own Source/As of metadata actually supports that framing.
- When a user asks how current, fresh, or up-to-date your data is, answer using
  the actual "As of" timestamp provided -- do not guess, and do not imply the
  data reflects this exact moment.
- If a section has no data (Source "none" or Status "Not available"), say so plainly (e.g. "I don't have
  current cost data for this account") -- never substitute a $0 or empty value
  as if it were a confirmed fact.

1. CONTEXT FIRST
- Base answers ONLY on provided context
- Never assume resources not explicitly provided
- If data is missing, state what's unavailable and why

2. CONTEXT FORMAT
You receive context in these sections, each with its own state, source,
as-of timestamp, and (where they apply) scope and coverage:
- Services: {discovered resource types}
- Costs: {state, source, as-of timestamp, scope, period, month-to-date spend or estimate, top services}
- Period comparison: {its own state, the two windows compared, their totals, change, basis}
- Resources: {EC2, RDS, Lambda counts and details}
- DORA: {deployment frequency, change failure rate, lead time, MTTR}
- DevControl evidence sources: {one line per source with its state, then the data
  of the sources this question loaded; AWS or customer text in <untrusted_evidence> blocks}
Each section states its own period or window -- not the same thing as the
as-of freshness timestamps above.

If context is empty, state clearly what's missing.

3. BE OPINIONATED AND ACTIONABLE
- Explain what's happening in the AWS environment represented by the provided context
- Quantify impact (cost, risk, reliability)
- Recommend clear, safe, practical next steps
- Never give generic AWS explanations

4. RESPONSE STRUCTURE (MANDATORY)
🔍 What's happening
💰 Cost / impact
⚠️ Risk / reliability implications
✅ Recommended actions
📌 Notes / assumptions (only if needed)

5. COST RECOMMENDATIONS
- Prioritize by ROI (savings vs effort)
- Flag one-time vs recurring savings
- Consider Reserved Instances and Savings Plans
- Always quantify in dollars, not just "reduce costs"
- Month-to-date and comparison-window amounts are observed spend for a partial
  period. Never label them "/month" or "/year", and never extrapolate them into
  a monthly or annual figure unless the user asks for a projection -- then call
  it a projection and state the days it is based on. Use "/month" (and an annual
  equivalent) only for figures the context itself states as a monthly rate.

6. RESPONSE LENGTH
- Short questions: 3-5 sentences per section
- Complex analysis: 2-3 paragraphs max per section
- Be concise - users want quick answers

7. PROFESSIONAL TONE
- Write like a senior cloud consultant
- Be concise, confident, calm
- No hype, minimal emojis (only section headers)
- Never shame users or imply poor decisions

8. SAFETY & TRUST
- Never suggest destructive actions without warnings
- Never suggest deleting data or shutting down production
- Flag high-risk recommendations clearly
- Prefer reversible actions (rightsizing, scheduling, alerts)

9. NO HALLUCINATIONS
- If unsure or data incomplete, say:
  "Based on available data..." or
  "I don't have enough information to confirm..."
- Never invent metrics, costs, or resources
- Context sections come from independent sources (see labels in the context
  itself). Two true facts from different sections do not by themselves prove
  a relationship between them — e.g. "EC2 is the top billing category" plus
  "there is 1 EC2 resource" does NOT establish that the resource caused the
  spend. State each fact on its own terms; if you connect them, frame it
  explicitly as an inference ("likely," "this may indicate") — never as a
  confirmed fact.
- Billing-category totals are Cost Explorer service categories for the
  stated billing scope, not per-resource costs. Don't attribute a category's
  cost to a specific resource unless the context states that resource's own
  cost directly.
- Each listed category is separate and categories do not contain one another
  (e.g. "EC2 - Other" is not part of "Amazon Elastic Compute Cloud - Compute").
  Never describe a category as including charges AWS bills under another one.
- An "AWS Cost Explorer" line item is observed spend. It may include charges
  for Cost Explorer API requests, which any cost-monitoring tool querying this
  billing scope can generate -- DevControl included, since it queries Cost
  Explorer to build this context. Which callers made those requests is
  unknown: never state or imply that the user's scripts or automation, or
  DevControl, caused the charge, and never tell the user to reduce their own
  Cost Explorer calls because of it.
- DORA metrics come from DevControl's deployment records, not from AWS billing
  or the cost data. Mention them only when the user asks about deployments,
  delivery, or reliability -- not in answers about cost or spend -- and state
  each metric exactly as labeled, including its description.
- When context directly states a fact, state it with full confidence — don't
  add hedging to facts that are actually in the context.
- ${UNTRUSTED_TEXT_RULE}

10. CONTINUITY
- Treat follow-ups as part of same investigation
- Refer to previous findings when relevant
- Build on prior recommendations

11. AUTOMATIC DATA ACCESS
- All the AWS data DevControl has provided in this context is supplied
  automatically -- some of it may be unavailable, partial, or out of scope
- NEVER ask users to "share data", "provide details", or "pull information"
- Users CANNOT manually provide technical data - you already have what exists
- If critical data is missing from context, or its Status is not "Available", state:
  "I don't have [specific metric] available in the current data"
- Then provide best analysis possible with the data that is actually present,
  without inferring the missing values
- NEVER say: "Can you share...", "Please provide...", "If your platform surfaces..."

Your goal: Help users understand their AWS environment, reduce cost, improve reliability, and make confident infrastructure decisions.`;
  }

  /** Cents precision, so a real sub-dollar bill never rounds to a "$0" that reads as no spend. */
  private formatMoney(amount: number): string {
    const abs = Math.abs(amount).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return amount < 0 ? `-$${abs}` : `$${abs}`;
  }

  /**
   * Scope lines for a cost or inventory figure. Cost Explorer scope is stated
   * as the connected role's billing scope with consolidation unknown -- never
   * as "this one account" -- and inventory scope as one discovery region.
   */
  private formatScope(scope: ContextScope): string[] {
    if (scope.kind === 'organization') {
      return [`- Scope: this DevControl organization, ${scope.window}`];
    }
    const account = scope.connectedAccountId ?? 'unknown';
    if (scope.kind === 'account_level') {
      return [`- Scope: account-level, connected AWS account ${account}`];
    }
    if (scope.kind === 'aws_account_region') {
      return [`- Scope: connected AWS account ${account}, region ${scope.region ?? 'unknown'}`];
    }
    if (scope.kind === 'aws_account_regions') {
      return [`- Scope: connected AWS account ${account}, home region ${scope.homeRegion ?? 'unknown'}`];
    }
    if (scope.kind === 'cost_explorer') {
      return [
        `- Scope: the AWS Cost Explorer billing scope of the connected IAM role`,
        `- Connected AWS account: ${account}`,
        `- Linked-account filter: none (the query is not narrowed to the connected account)`,
        `- Consolidated billing: unknown (DevControl does not detect whether the connected account is a management/payer account, so this figure may or may not include other linked accounts)`,
        `- Regions: all (the query is not region-filtered)`,
      ];
    }
    return [
      `- Scope: AWS resources DevControl discovered under the connected IAM role`,
      `- Connected AWS account: ${account}`,
      `- Regions: ${scope.discoveryRegion ?? 'unknown'} only (resources in other regions are not discovered, except S3 buckets, which are listed account-wide, and CloudFront, which is global; the region list and scan status are in the evidence sources below)`,
    ];
  }

  /**
   * The lines every non-cost section starts with -- state, source, as-of,
   * scope, coverage -- and what its state means. showData is true only for
   * 'available'/'partial' sections that actually carry data: an 'error',
   * 'not_supported', or 'unavailable' section never has figures printed as
   * though they exist. An error's raw reason stays out of the prompt.
   */
  private formatSectionHeader(title: string, section: ContextSection<unknown>): { lines: string[]; showData: boolean } {
    const lines = [
      `${title}:`,
      `- Status: ${STATE_LABELS[section.state]}`,
      `- Source: ${section.source}`,
      `- As of: ${section.asOf ?? 'unknown'}`,
      ...(section.scope ? this.formatScope(section.scope) : []),
    ];
    if (section.coverage) lines.push(`- Coverage: ${section.coverage}`);

    switch (section.state) {
      case 'error':
        lines.push('- Data: could not be retrieved -- this is missing data, not an empty result or a zero');
        break;
      case 'not_supported':
        lines.push(`- Data: not supported -- ${section.reason ?? 'DevControl has no source for this data.'} This is not a zero, "none", or "no findings".`);
        break;
      case 'unavailable':
      case 'not_connected':
        lines.push(`- Data: not available -- ${section.reason ?? 'no data exists for this section'}. Do not treat this as zero or none.`);
        break;
      case 'not_entitled':
        lines.push("- Data: not included in this organization's plan, so it was not read. This is not a zero, \"none\", or \"no data\".");
        break;
      case 'not_built':
        lines.push(`- Data: DevControl doesn't provide this yet${section.reason ? ` -- ${section.reason}` : ''}. Never say none were found.`);
        break;
      case 'partial':
      case 'stale':
        lines.push(`- Limitation: ${section.reason ?? 'only part of the stated scope is covered'}`);
        break;
      default:
        if (section.reason) lines.push(`- Note: ${section.reason}`);
    }

    const showData = (section.state === 'available' || section.state === 'partial' || section.state === 'stale') && section.data !== null;
    return { lines, showData };
  }

  private formatCostSection(costs: ChatCostSection): string {
    const sourceLabel = costs.provenance === 'actual'
      ? 'AWS Cost Explorer (actual billing data)'
      : costs.provenance === 'estimated'
        ? 'DevControl inventory estimate (list-price estimates for discovered resources; NOT AWS billing data)'
        : 'none';
    const figures = costs.data;
    const period = costs.period?.kind === 'range' ? costs.period : null;

    const lines = [
      'Cost data:',
      `- Status: ${STATE_LABELS[costs.state]}`,
      `- Source: ${sourceLabel}`,
      `- As of: ${costs.asOf ?? 'unknown'}`,
      `- AWS Cost Explorer status: ${STATE_LABELS[costs.costExplorer.state]}${costs.costExplorer.reason ? ` (${costs.costExplorer.reason})` : ''}`,
      ...(costs.scope ? this.formatScope(costs.scope) : []),
    ];

    if (figures === null) {
      lines.push('- Spend: not available (no Cost Explorer result and no inventory estimate) -- this is missing data, not a zero amount');
    } else if (costs.provenance === 'actual') {
      if (period) {
        // The query's End is exclusive; the reader is only ever shown the
        // inclusive last day, never the boundary as if it were billed.
        const { start } = period;
        const last = lastIncludedDay(period.endExclusive);
        if (last >= start) {
          const lastDayInProgress = costs.asOf !== null && costs.asOf.slice(0, 10) === last;
          lines.push(`- Period: month-to-date, ${start} through ${last} inclusive (${formatInclusiveRange(start, last)})${lastDayInProgress ? `; ${last} was still in progress when this figure was obtained, so that day's spend is incomplete` : ''}`);
        }
      }
      lines.push(`- Month-to-date spend: ${this.formatMoney(figures.current)}${figures.current < 0 ? ' (net negative: credits/refunds exceed charges)' : ''} (observed spend for the period above -- not a full-month amount or a monthly rate)`);
      lines.push('Top services by month-to-date spend (observed amounts for the period above, not monthly rates. Cost Explorer SERVICE categories for the scope above, NOT per-resource costs: each line is its own category and does not include charges billed under another listed category, and a category total is not proof that any one resource caused that spend):');
      if (figures.topSpenders && figures.topSpenders.length > 0) {
        lines.push(...figures.topSpenders.map(s => `- ${s.service}: ${this.formatMoney(s.cost)}${s.percentage !== null ? ` (${s.percentage.toFixed(1)}%)` : ''}`));
        if (figures.topSpenders.some(s => /cost explorer/i.test(s.service))) {
          lines.push('- Note: the AWS Cost Explorer line item is observed spend for the period above. It may include charges for Cost Explorer API requests, which any cost-monitoring tool querying this billing scope can generate, including DevControl (it queries Cost Explorer to build this cost data). Which callers made those requests is unknown -- attribute the charge to no one.');
        }
      } else {
        lines.push('- Cost Explorer returned no billed service line items for this period');
      }
    } else {
      lines.push('- Basis: monthly run-rate estimate for currently discovered resources -- not billed spend for any period');
      if (figures.estimateCoverage) {
        lines.push(`- Coverage: ${figures.estimateCoverage.estimatedResources} of ${figures.estimateCoverage.totalResources} discovered resources have a cost estimate`);
      }
      lines.push(`- Estimated monthly cost: ${this.formatMoney(figures.current)}`);
      lines.push('- Per-service breakdown: not available for estimates');
    }

    return lines.join('\n');
  }

  /**
   * monthToDateSpend (optional): the cost section's actual month-to-date
   * figure, so a window total that differs from it is called out rather than
   * left to read as the same total.
   */
  private formatComparisonSection(comparison: CostComparison, monthToDateSpend: number | null = null): string {
    const lines = [
      "Period comparison (this month's finished days vs the same days of the previous month -- the latest days, still being reported by AWS Cost Explorer, are left out; source: AWS Cost Explorer daily trend, same scope as the cost data above):",
      `- Status: ${STATE_LABELS[comparison.state]}`,
      `- As of: ${comparison.asOf ?? 'unknown'}`,
      `- Basis: ${comparison.basis}`,
    ];
    if (comparison.note) lines.push(`- Note: ${comparison.note}`);

    const { currentWindow, previousWindow, currentWindowTotal, previousWindowTotal, coverage } = comparison;
    if (!currentWindow || !previousWindow || currentWindowTotal === null || previousWindowTotal === null || !coverage) {
      lines.push('- Previous period: not available -- do not assume spend was unchanged, and do not derive a change from the current figure alone');
      return lines.join('\n');
    }

    lines.push(`- Current window: ${currentWindow.start} through ${currentWindow.end} inclusive (${formatInclusiveRange(currentWindow.start, currentWindow.end)}), total ${this.formatMoney(currentWindowTotal)} (${coverage.currentDays} of ${coverage.expectedCurrentDays} days of data)`);
    lines.push(`- Previous window: ${previousWindow.start} through ${previousWindow.end} inclusive (${formatInclusiveRange(previousWindow.start, previousWindow.end)}), total ${this.formatMoney(previousWindowTotal)} (${coverage.previousDays} of ${coverage.expectedPreviousDays} days of data)`);
    // The window total is summed from daily category charges with credits
    // excluded (see Basis); month-to-date spend is Cost Explorer's own total.
    if (monthToDateSpend !== null && Math.round(monthToDateSpend * 100) !== Math.round(currentWindowTotal * 100)) {
      lines.push(`- Not the same total as month-to-date spend: this window's total (${this.formatMoney(currentWindowTotal)}) and the month-to-date spend above (${this.formatMoney(monthToDateSpend)}) are calculated differently (see Basis) -- present them as two different figures, never as the same total`);
    }
    if (comparison.currentWindowIncludesToday) {
      lines.push(`- Partial day: the current window's last day (${currentWindow.end}) is today and still in progress, while every previous-window day is complete -- the change compares a partial day against a full one`);
    }
    if (comparison.changeAmount !== null) {
      const sign = comparison.changeAmount > 0 ? '+' : '';
      const percent = comparison.changePercent !== null
        ? ` (${comparison.changePercent > 0 ? '+' : ''}${comparison.changePercent.toFixed(1)}%)`
        : ' (percentage undefined: previous window total is $0.00)';
      lines.push(`- Change: ${sign}${this.formatMoney(comparison.changeAmount)}${percent}`);
    }
    return lines.join('\n');
  }

  /**
   * Format context for AI
   */
  private formatResourceLines(resources: InventoryResources): string[] {
    const lines: string[] = [];
    const { ec2, rds, lambda } = resources;

    lines.push(`- EC2: ${ec2.count} instances (CPU utilization is its own evidence source below)`);

    // Resources with no recorded estimate are stored as $0.00 by default, so a
    // zero (or a count "with a stored value") cannot confirm a zero-cost estimate.
    const rdsEstimate = rds.estimatedMonthlyCost === null
      ? rds.count > 0 ? '; no cost estimate available' : ''
      : `; DevControl estimated monthly cost ${this.formatMoney(rds.estimatedMonthlyCost)} across the ${rds.estimatedForCount} of ${rds.count} databases with a stored estimate value (list-price estimate for the whole database -- not AWS billed spend${rds.estimatedMonthlyCost === 0
        ? '; a $0.00 total may mean no estimate was recorded, since databases without an estimate are stored as $0.00 by default -- do not present it as a confirmed zero cost'
        : ''})`;
    lines.push(`- RDS: ${rds.count} databases${rdsEstimate}`);

    if (lambda.count === 0) {
      lines.push('- Lambda: 0 functions');
    } else if (lambda.invocationsKnownForCount === 0) {
      // No function's real 30-day usage could be determined (CloudWatch
      // unavailable for all of them) -- state that plainly rather than
      // asserting a specific invocation count we don't actually have.
      lines.push(`- Lambda: ${lambda.count} functions, 30-day invocation data unavailable`);
    } else if (lambda.invocationsKnownForCount < lambda.count) {
      lines.push(`- Lambda: ${lambda.count} functions, ${lambda.invocations.toLocaleString()} invocations over the last 30 days (usage known for ${lambda.invocationsKnownForCount} of ${lambda.count} functions; the rest are unavailable, not zero)`);
    } else {
      lines.push(`- Lambda: ${lambda.count} functions, ${lambda.invocations.toLocaleString()} invocations over the last 30 days`);
    }
    return lines;
  }

  /**
   * Format context for AI
   */
  private formatContext(context: ChatContext): string {
    const services = this.formatSectionHeader('Services in use (discovered resource types)', context.services);
    if (services.showData && context.services.data) {
      services.lines.push(`- types: ${context.services.data.length > 0 ? context.services.data.join(', ') : 'none -- discovery completed and found no resources'}`);
    }

    const resources = this.formatSectionHeader(
      'Resource inventory (synchronized periodically by DevControl AWS discovery, not queried live; independent of the billing data above, and a different scope from it; do not assume a resource count here explains a cost driver above unless this context explicitly states that connection)',
      context.resources
    );
    if (context.account.state === 'error') {
      resources.lines.push('- connected account lookup: could not be retrieved -- the account and discovery region are unknown, not absent');
    } else if (context.account.state === 'unavailable') {
      resources.lines.push('- connected account: none connected');
    }
    if (resources.showData && context.resources.data) {
      resources.lines.push(...this.formatResourceLines(context.resources.data));
    }

    const dora = this.formatSectionHeader(
      'DORA metrics (not AWS billing data and unrelated to the cost data above; only relevant to questions about deployments, delivery, or reliability)',
      context.dora
    );
    if (dora.showData && context.dora.data) {
      dora.lines.push(
        `- Deployment frequency: ${context.dora.data.deploymentFrequency}`,
        `- Change failure rate: ${context.dora.data.changeFailureRate}`,
        `- Lead time: ${context.dora.data.leadTime}`,
        `- Mean time to recover: ${context.dora.data.mttr}`,
      );
    }

    return `
CURRENT AWS ENVIRONMENT CONTEXT:

${services.lines.join('\n')}

${this.formatCostSection(context.costs)}

${this.formatComparisonSection(context.costs.comparison, context.costs.provenance === 'actual' && context.costs.data ? context.costs.data.current : null)}

${resources.lines.join('\n')}

${dora.lines.join('\n')}

${renderEvidence(context.evidence, { except: CHAT_FORMATTED_PROVIDERS, style: 'prose' })}
`;
  }

  /**
   * Chat with AI (streaming). Text is streamed as it arrives; how the stream
   * ended decides what follows it (model-response.ts):
   *   - a finished answer: nothing;
   *   - stopped at the length limit: CHAT_TRUNCATED_NOTICE, so a cut-off
   *     answer never reads as complete;
   *   - a refusal: CHAT_REFUSAL_REPLY (after any text already streamed);
   *   - an empty answer, an unexpected response or a failed call:
   *     CHAT_ERROR_REPLY (after any text already streamed).
   */
  async *chat(
    messages: ChatMessage[],
    context: ChatContext
  ): AsyncGenerator<string> {
    // If no API key, return fallback response
    if (!getModelClient()) {
      yield this.getFallbackResponse(messages, context);
      return;
    }

    const contextString = this.formatContext(context);

    // Context is injected into the first user message.
    const messagesWithContext = messages.map((m, index) => ({
      role: m.role,
      content: index === 0 && m.role === 'user' ? `${contextString}\n\nUser question: ${m.content}` : m.content,
    }));

    const stream = streamModelText('chat', 'ai_chat', { system: this.getSystemPrompt(), messages: messagesWithContext });
    let streamedText = false;
    let step = await stream.next();
    try {
      while (!step.done) {
        if (step.value.length > 0) streamedText = true;
        yield step.value;
        step = await stream.next();
      }
    } finally {
      // Our consumer stopped early: let streamModelText abort the request and log it.
      if (!step.done) await stream.return({ kind: 'error', code: 'aborted', httpStatus: null, meta: null });
    }
    const outcome = step.value;

    if (outcome.kind === 'text') return;
    const separator = streamedText ? '\n\n' : '';
    const reply = outcome.kind === 'truncated' ? CHAT_TRUNCATED_NOTICE : outcome.kind === 'refused' ? CHAT_REFUSAL_REPLY : CHAT_ERROR_REPLY;
    yield `${separator}${reply}`;
  }

  /**
   * Generate fallback response when API is unavailable
   */
  private getFallbackResponse(messages: ChatMessage[], context: ChatContext): string {
    const lastMessage = messages[messages.length - 1]?.content.toLowerCase() || '';

    const costs = context.costs;
    // A spend figure with its own provenance, or null when none exists --
    // shared by the cost and generic branches so neither can print an
    // unqualified number.
    const figures = costs.data;
    const spendPhrase = figures === null
      ? null
      : costs.provenance === 'estimated'
        ? `an estimated ${this.formatMoney(figures.current)}/month (estimated from your last synced resource inventory as of ${costs.asOf ?? 'unknown'}, not a Cost Explorer billing figure)`
        : `${this.formatMoney(figures.current)} month-to-date (AWS Cost Explorer${costs.asOf ? `, as of ${costs.asOf}` : ''}; covers your connected role's billing scope across all regions)`;
    const change = costs.comparison.changePercent;
    const changePhrase = change === null
      ? null
      : `${change > 0 ? 'up' : change < 0 ? 'down' : 'flat'} ${Math.abs(change).toFixed(1)}% vs the same days of last month`;

    // Basic pattern matching for common questions
    if (lastMessage.includes('cost') || lastMessage.includes('spend') || lastMessage.includes('bill')) {
      if (spendPhrase === null) {
        return `**🔍 What's happening**

I don't have cost data available for this account right now — ${costs.costExplorer.state === 'error' ? 'the AWS Cost Explorer request failed' : 'there\'s no AWS Cost Explorer result'} and no resource-inventory estimate could be computed.

**✅ Recommended actions**

1. Confirm an AWS account is connected and Cost Explorer is enabled for it
2. Try again shortly, or check your AWS Cost Explorer directly for current spend

*Note: AI service temporarily unavailable - this is a simplified analysis.*`;
      }

      const topSpender = figures?.topSpenders?.[0];

      return `**🔍 What's happening**

Your AWS spend is ${spendPhrase}${changePhrase ? `, ${changePhrase}` : ' (no comparison with last month is available)'}.

**💰 Cost / impact**

${topSpender ? `Your top cost category is ${topSpender.service} at ${this.formatMoney(topSpender.cost)} month-to-date${topSpender.percentage !== null ? ` (${topSpender.percentage.toFixed(1)}% of total spend)` : ''}.` : 'A per-service breakdown is not available.'}

**✅ Recommended actions**

1. Review your AWS Cost Explorer for detailed service-level breakdown
2. Consider Reserved Instances or Savings Plans for predictable workloads
3. Check for underutilized resources that can be rightsized

*Note: AI service temporarily unavailable - this is a simplified analysis.*`;
    }

    if (lastMessage.includes('underutilized') || lastMessage.includes('optimize') || lastMessage.includes('saving')) {
      // CPU utilization is its own evidence source; only a section that carries
      // data says anything about it -- anything else is stated as missing data.
      const cpu = context.evidence.results.find(r => r.id === 'telemetry.cpu')?.section as ContextSection<{ items: Array<{ instanceId?: string }> }> | undefined;
      // Distinct instances: one instance can have a reading from the latest check and from an idle finding.
      const measured = cpu && (cpu.state === 'available' || cpu.state === 'partial') && cpu.data
        ? new Set(cpu.data.items.map(i => i.instanceId)).size
        : null;
      const utilizationPhrase = measured !== null && measured > 0
        ? `DevControl has CloudWatch CPU utilization for ${measured} EC2 instance${measured !== 1 ? 's' : ''} (as of ${cpu?.asOf ?? 'unknown'}). Ask again when the AI assistant is available to analyze it.`
        : `I don't have EC2 CPU utilization data for this account right now${cpu ? ` (${statusPhrase(cpu).replace(/ -- .*$/, '')})` : ''}, so I can't say which instances are underutilized.`;
      return `**🔍 What's happening**

${utilizationPhrase}

**💰 Cost / impact**

Underutilized resources typically represent 20-40% potential savings when rightsized.

**✅ Recommended actions**

1. Review CloudWatch metrics for CPU and memory utilization
2. Consider downsizing instances with <20% average utilization
3. Implement scheduling for non-production workloads

*Note: AI service temporarily unavailable - this is a simplified analysis.*`;
    }

    // Generic response. Counts are stated only from 'available' sections.
    const services = context.services;
    const inventoryPhrase = services.state === 'available' && services.data
      ? `I can see ${services.data.length} discovered resource types in your AWS environment`
      : `I don't have a resource inventory for this account right now`;
    const alarms = context.evidence.results.find(r => r.id === 'ops.cloudwatch_alarms')?.section as ContextSection<{ inAlarmCount: number; inAlarmComplete?: boolean }> | undefined;
    // A capped read is a lower bound, as in reports and the summary.
    const atLeast = alarms && (alarms.state === 'partial' || alarms.data?.inAlarmComplete === false) ? 'at least ' : '';
    const alertsPhrase = alarms && (alarms.state === 'available' || alarms.state === 'partial') && alarms.data
      ? `${atLeast}${alarms.data.inAlarmCount} CloudWatch alarm${alarms.data.inAlarmCount !== 1 ? 's' : ''} in ALARM (as of ${alarms.asOf ?? 'unknown'})`
      : `not available${alarms ? ` -- ${statusPhrase(alarms).replace(/ -- .*$/, '')}` : ''}`;

    return `**🔍 What's happening**

${inventoryPhrase}${spendPhrase ? `, with spend of ${spendPhrase}` : '; cost data is not available right now'}.

**💰 Cost / impact**

- Spend: ${spendPhrase ?? 'not available'}
- Change: ${changePhrase ?? 'no comparison with last month is available'}
- Active alerts: ${alertsPhrase}

**✅ Recommended actions**

Please ask a more specific question about costs, resources, or optimization opportunities.

*Note: AI service temporarily unavailable - this is a simplified analysis.*`;
  }

  /**
   * Non-streaming chat (for testing)
   */
  async chatSync(
    messages: ChatMessage[],
    context: ChatContext
  ): Promise<string> {
    const chunks: string[] = [];
    for await (const chunk of this.chat(messages, context)) {
      chunks.push(chunk);
    }
    return chunks.join('');
  }
}
