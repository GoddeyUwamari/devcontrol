/**
 * AI Chat Service
 * Handles conversational AI interactions for AWS infrastructure Q&A
 * Streams responses for better UX
 */

import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';
import type { ContextDataState, ContextScope, ContextSection } from './ai-context-contract';

// Defined in ai-context-contract.ts; re-exported so existing imports keep working.
export type { ContextDataState, ContextSection } from './ai-context-contract';

/**
 * Scope of a Cost Explorer figure, exactly as the current query establishes
 * it (aws-cost.service.ts fetchMonthlyCosts()/fetchCostTrend(): one
 * GetCostAndUsage call under the connected IAM role, grouped by SERVICE, with
 * no Filter). Deliberately does NOT claim the figure covers one AWS account:
 * with no LINKED_ACCOUNT filter the result is the role account's whole
 * billing scope, and DevControl does not detect whether that account is a
 * management/payer account whose billing scope spans linked accounts.
 */
export interface CostExplorerScope {
  kind: 'cost_explorer';
  /** aws_accounts.account_id of the connected role the call runs under; null if it couldn't be read. */
  connectedAccountId: string | null;
  /** The query is never narrowed to a single linked account. */
  linkedAccountFilter: 'none';
  /** Whether the billing scope is consolidated across linked accounts -- not detected. */
  consolidatedBilling: 'unknown';
  /** The query has no region filter. */
  regions: 'all';
}

/**
 * Scope of DevControl's resource inventory (aws_resources), and so of any
 * figure derived from it: discovery runs under the connected role, in the
 * single region stored on aws_accounts (AWSClientFactory.createClients()),
 * plus services listed account-wide (e.g. S3). Never the same scope as
 * CostExplorerScope.
 */
export interface InventoryScope {
  kind: 'resource_inventory';
  /** aws_accounts.account_id of the connected role; null if it couldn't be read. */
  connectedAccountId: string | null;
  /** aws_accounts.region -- the one region discovery runs in; null if it couldn't be read. */
  discoveryRegion: string | null;
}

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
   */
  currentWindowIncludesToday: boolean;
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
  'sum of AWS Cost Explorer daily charges per cost category, with any negative daily category amount floored to zero -- credits and refunds are excluded, so window totals can differ from month_to_date_spend';

const MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

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
  // utilization: no source writes a CPU figure into aws_resources, so this is
  // not_supported -- never a measured "0 underutilized".
  ec2: { count: number; utilization: ContextSection<{ underutilized: number }> };
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

export interface ChatContext {
  /** Latest completed resource discovery run -- the freshness of `services` and `resources`. */
  discovery: ContextSection<{ completedAt: string }>;
  /** The connected AWS account row (aws_accounts) both discovery and Cost Explorer run under. */
  account: ContextSection<{ accountId: string | null; region: string | null }>;
  /** Distinct discovered resource types in the inventory. */
  services: ContextSection<string[]>;
  costs: {
    /** State of `current` (the figure the model is given), whichever source produced it. */
    state: ContextDataState;
    // Provenance -- mirrors the Dashboard's actual-vs-estimated distinction
    // (stats.controller.ts's getDashboardStats()).
    // 'actual'      = a real AWS Cost Explorer result (fresh or served from
    //                 awsCostService's own short-lived cache -- `asOf` says which),
    //                 including a real $0 or a net-negative (credit) total.
    // 'estimated'   = Cost Explorer was unavailable or failed; derived from
    //                 aws_resources' estimated_monthly_cost (list-price estimates
    //                 of discovered resources) -- not AWS billing data.
    // 'unavailable' = neither exists; `current` is null, never 0.
    source: 'actual' | 'estimated' | 'unavailable';
    /** null whenever no figure exists -- never 0 standing in for "unknown". */
    current: number | null;
    // ISO timestamp this cost figure was actually obtained -- for 'actual',
    // awsCostService's own fetch/cache timestamp; for 'estimated', the
    // discovery job's completion time (discovery.data.completedAt); null otherwise.
    asOf: string | null;
    /** The Cost Explorer query period (month-to-date; end is exclusive). null for estimates, which are a monthly run-rate, not a billed period. */
    period: { start: string; endExclusive: string } | null;
    scope: CostExplorerScope | InventoryScope | null;
    /** Cost Explorer SERVICE categories; null when no per-service breakdown exists (estimate/unavailable). [] is a real, empty breakdown. */
    topSpenders: Array<{
      service: string;
      cost: number;
      /** Share of the total; null when the total is $0 or net-negative, where a share is meaningless. */
      percentage: number | null;
    }> | null;
    /** Outcome of the Cost Explorer attempt itself -- kept even when an estimate was used instead. */
    costExplorer: { state: ContextDataState; reason: string | null };
    /** For 'estimated': how many discovered (non-terminated) resources actually carry an estimate. */
    estimateCoverage: { estimatedResources: number; totalResources: number } | null;
    comparison: CostComparison;
  };
  /** Scope of the resource inventory section (and of every figure derived from it). */
  inventoryScope: InventoryScope;
  resources: ContextSection<InventoryResources>;
  alerts: ContextSection<{ total: number; critical: number; recent: string[] }>;
  anomalies: ContextSection<Array<{ type: string; service: string; description: string; impact: string }>>;
  dora: ContextSection<{ deploymentFrequency: string; leadTime: string; mttr: string }>;
}

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export class AIChatService {
  private anthropic: Anthropic | null = null;

  constructor(private pool: Pool) {
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      console.log('[AI Chat] Service initialized with Anthropic API');
    } else {
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
- Resource utilization
- Alerts, risks, and incidents
- Deployment and reliability signals (DORA, monitoring)

This context is NOT a live feed. Each section carries its own real provenance and
freshness, which you must respect exactly as labeled:
- Cost data has a "state", a "source" (AWS Cost Explorer, a DevControl inventory
  estimate used when Cost Explorer is unavailable, or none), an "as_of" timestamp
  -- the moment that figure was actually obtained, which may be several hours old
  even when the source is Cost Explorer, since it is served from a short-lived cache
  -- and a "scope" (which AWS account/billing scope and which regions it covers).
  Cost Explorer figures cover the connected IAM role's billing scope across all
  regions; whether that includes other linked accounts is stated as unknown unless
  the scope says otherwise. Resource inventory covers only the regions its scope lists.
  Never describe a Cost Explorer figure as covering exactly one AWS account, and
  never compare it to inventory as if the two had the same scope.
- Datasets carry a state: "available" (complete for its scope), "partial" (only
  part of its scope -- say which part), "unavailable" (no data), "error" (collection
  failed), or "not_supported". Only report figures that are actually present;
  never treat "unavailable", "error", or "not_supported" as $0, zero, none,
  empty, unchanged, or "no findings" -- say that data is not available and why.
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
- If a section's source is "unavailable," say so plainly (e.g. "I don't have
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
- Alerts: {active alerts, incidents}
- Anomalies: {detected anomalies}
- DORA: {deployment frequency, lead time, MTTR}
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

10. CONTINUITY
- Treat follow-ups as part of same investigation
- Refer to previous findings when relevant
- Build on prior recommendations

11. AUTOMATIC DATA ACCESS
- All the AWS data DevControl has provided in this context is supplied
  automatically -- some of it may be unavailable, partial, or out of scope
- NEVER ask users to "share data", "provide details", or "pull information"
- Users CANNOT manually provide technical data - you already have what exists
- If critical data is missing from context, or its state is not "available", state:
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
      return [`- scope: this DevControl organization, ${scope.window}`];
    }
    const account = scope.connectedAccountId ?? 'unknown';
    if (scope.kind === 'cost_explorer') {
      return [
        `- scope.kind: cost_explorer_billing_scope (the AWS Cost Explorer billing scope of the connected IAM role)`,
        `- scope.connected_account_id: ${account}`,
        `- scope.linked_account_filter: none (the query is not narrowed to the connected account)`,
        `- scope.consolidated_billing: unknown (DevControl does not detect whether the connected account is a management/payer account, so this figure may or may not include other linked accounts)`,
        `- scope.regions: all (the query is not region-filtered)`,
      ];
    }
    return [
      `- scope.kind: resource_inventory (resources DevControl discovered under the connected IAM role)`,
      `- scope.connected_account_id: ${account}`,
      `- scope.regions: ${scope.discoveryRegion ?? 'unknown'} only (resources in other regions are not discovered, except services listed account-wide such as S3)`,
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
      `- state: ${section.state}`,
      `- source: ${section.source}`,
      `- as_of: ${section.asOf ?? 'unknown'}`,
      ...(section.scope ? this.formatScope(section.scope) : []),
    ];
    if (section.coverage) lines.push(`- coverage: ${section.coverage}`);

    switch (section.state) {
      case 'error':
        lines.push('- data: could not be retrieved -- this is missing data, not an empty result or a zero');
        break;
      case 'not_supported':
        lines.push(`- data: not supported -- ${section.reason ?? 'DevControl has no source for this data'} This is not a zero, "none", or "no findings".`);
        break;
      case 'unavailable':
        lines.push(`- data: not available -- ${section.reason ?? 'no data exists for this section'}. Do not treat this as zero or none.`);
        break;
      case 'partial':
        lines.push(`- limitation: ${section.reason ?? 'only part of the stated scope is covered'}`);
        break;
      default:
        if (section.reason) lines.push(`- note: ${section.reason}`);
    }

    const showData = (section.state === 'available' || section.state === 'partial') && section.data !== null;
    return { lines, showData };
  }

  private formatCostSection(costs: ChatContext['costs']): string {
    const sourceLabel = {
      actual: 'AWS Cost Explorer (actual billing data)',
      estimated: 'DevControl inventory estimate (list-price estimates for discovered resources; NOT AWS billing data)',
      unavailable: 'none',
    }[costs.source];

    const lines = [
      'Cost data:',
      `- state: ${costs.state}`,
      `- source: ${sourceLabel}`,
      `- as_of: ${costs.asOf ?? 'unknown'}`,
      `- cost_explorer.state: ${costs.costExplorer.state}${costs.costExplorer.reason ? ` (${costs.costExplorer.reason})` : ''}`,
      ...(costs.scope ? this.formatScope(costs.scope) : []),
    ];

    if (costs.current === null) {
      lines.push('- spend: not available (no Cost Explorer result and no inventory estimate) -- this is missing data, not a zero amount');
    } else if (costs.source === 'actual') {
      if (costs.period) {
        // The query's End is exclusive; the reader is only ever shown the
        // inclusive last day, never the boundary as if it were billed.
        const { start } = costs.period;
        const last = lastIncludedDay(costs.period.endExclusive);
        if (last >= start) {
          const lastDayInProgress = costs.asOf !== null && costs.asOf.slice(0, 10) === last;
          lines.push(`- period: month-to-date, ${start} through ${last} inclusive (${formatInclusiveRange(start, last)})${lastDayInProgress ? `; ${last} was still in progress when this figure was obtained, so that day's spend is incomplete` : ''}`);
        }
      }
      lines.push(`- month_to_date_spend: ${this.formatMoney(costs.current)}${costs.current < 0 ? ' (net negative: credits/refunds exceed charges)' : ''} (observed spend for the period above -- not a full-month amount or a monthly rate)`);
      lines.push('Top services by month-to-date spend (observed amounts for the period above, not monthly rates. Cost Explorer SERVICE categories for the scope above, NOT per-resource costs: each line is its own category and does not include charges billed under another listed category, and a category total is not proof that any one resource caused that spend):');
      if (costs.topSpenders && costs.topSpenders.length > 0) {
        lines.push(...costs.topSpenders.map(s => `- ${s.service}: ${this.formatMoney(s.cost)}${s.percentage !== null ? ` (${s.percentage.toFixed(1)}%)` : ''}`));
        if (costs.topSpenders.some(s => /cost explorer/i.test(s.service))) {
          lines.push('- note: the AWS Cost Explorer line item is observed spend for the period above. It may include charges for Cost Explorer API requests, which any cost-monitoring tool querying this billing scope can generate, including DevControl (it queries Cost Explorer to build this cost data). Which callers made those requests is unknown -- attribute the charge to no one.');
        }
      } else {
        lines.push('- Cost Explorer returned no billed service line items for this period');
      }
    } else {
      lines.push('- basis: monthly run-rate estimate for currently discovered resources -- not billed spend for any period');
      if (costs.estimateCoverage) {
        lines.push(`- coverage: ${costs.estimateCoverage.estimatedResources} of ${costs.estimateCoverage.totalResources} discovered resources have a cost estimate`);
      }
      lines.push(`- estimated_monthly_cost: ${this.formatMoney(costs.current)}`);
      lines.push('- per-service breakdown: not available for estimates');
    }

    return lines.join('\n');
  }

  private formatComparisonSection(comparison: CostComparison): string {
    const lines = [
      'Period comparison (month-to-date vs the same days of the previous month; source: AWS Cost Explorer daily trend, same scope as the cost data above):',
      `- state: ${comparison.state}`,
      `- as_of: ${comparison.asOf ?? 'unknown'}`,
      `- basis: ${comparison.basis}`,
    ];
    if (comparison.note) lines.push(`- note: ${comparison.note}`);

    const { currentWindow, previousWindow, currentWindowTotal, previousWindowTotal, coverage } = comparison;
    if (!currentWindow || !previousWindow || currentWindowTotal === null || previousWindowTotal === null || !coverage) {
      lines.push('- previous period: not available -- do not assume spend was unchanged, and do not derive a change from the current figure alone');
      return lines.join('\n');
    }

    lines.push(`- current_window: ${currentWindow.start} through ${currentWindow.end} inclusive (${formatInclusiveRange(currentWindow.start, currentWindow.end)}), total ${this.formatMoney(currentWindowTotal)} (${coverage.currentDays} of ${coverage.expectedCurrentDays} days of data)`);
    lines.push(`- previous_window: ${previousWindow.start} through ${previousWindow.end} inclusive (${formatInclusiveRange(previousWindow.start, previousWindow.end)}), total ${this.formatMoney(previousWindowTotal)} (${coverage.previousDays} of ${coverage.expectedPreviousDays} days of data)`);
    if (comparison.currentWindowIncludesToday) {
      lines.push(`- partial_day: the current window's last day (${currentWindow.end}) is today and still in progress, while every previous-window day is complete -- the change compares a partial day against a full one`);
    }
    if (comparison.changeAmount !== null) {
      const sign = comparison.changeAmount > 0 ? '+' : '';
      const percent = comparison.changePercent !== null
        ? ` (${comparison.changePercent > 0 ? '+' : ''}${comparison.changePercent.toFixed(1)}%)`
        : ' (percentage undefined: previous window total is $0.00)';
      lines.push(`- change: ${sign}${this.formatMoney(comparison.changeAmount)}${percent}`);
    }
    return lines.join('\n');
  }

  /**
   * Format context for AI
   */
  private formatResourceLines(resources: InventoryResources): string[] {
    const lines: string[] = [];
    const { ec2, rds, lambda } = resources;

    lines.push(`- EC2: ${ec2.count} instances`);
    const utilization = ec2.utilization;
    lines.push(utilization.state === 'available' && utilization.data
      ? `- EC2 underutilized: ${utilization.data.underutilized} of ${ec2.count}`
      : `- EC2 utilization: ${utilization.state} -- ${utilization.reason ?? 'no utilization data'} Do not describe any instance as underutilized or as not underutilized.`);

    const rdsEstimate = rds.estimatedMonthlyCost !== null
      ? `; DevControl estimated monthly cost ${this.formatMoney(rds.estimatedMonthlyCost)} for ${rds.estimatedForCount} of ${rds.count} (list-price estimate for the whole database -- not AWS billed spend)`
      : rds.count > 0 ? '; no cost estimate available' : '';
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

    const alerts = this.formatSectionHeader('Alerts & incidents', context.alerts);
    if (alerts.showData && context.alerts.data) {
      const { total, critical, recent } = context.alerts.data;
      alerts.lines.push(`- active alerts: ${total}`, `- critical alerts: ${critical}`);
      alerts.lines.push(recent.length > 0 ? `- recent: ${recent.join(', ')}` : '- recent: none firing');
    }

    const anomalies = this.formatSectionHeader('Anomalies', context.anomalies);
    if (anomalies.showData && context.anomalies.data) {
      anomalies.lines.push(...(context.anomalies.data.length > 0
        ? context.anomalies.data.map(a => `- ${a.service} ${a.type}: ${a.description} (${a.impact})`)
        : ['- none detected']));
    }

    const dora = this.formatSectionHeader(
      'DORA metrics (not AWS billing data and unrelated to the cost data above; only relevant to questions about deployments, delivery, or reliability)',
      context.dora
    );
    if (dora.showData && context.dora.data) {
      dora.lines.push(
        `- Deployment frequency: ${context.dora.data.deploymentFrequency}`,
        `- Lead time: ${context.dora.data.leadTime}`,
        `- Mean time to recover: ${context.dora.data.mttr}`,
      );
    }

    return `
CURRENT AWS ENVIRONMENT CONTEXT:

${services.lines.join('\n')}

${this.formatCostSection(context.costs)}

${this.formatComparisonSection(context.costs.comparison)}

${resources.lines.join('\n')}

${alerts.lines.join('\n')}

${anomalies.lines.join('\n')}

${dora.lines.join('\n')}
`;
  }

  /**
   * Chat with AI (streaming)
   */
  async *chat(
    messages: ChatMessage[],
    context: ChatContext
  ): AsyncGenerator<string> {
    // If no API key, return fallback response
    if (!this.anthropic) {
      yield this.getFallbackResponse(messages, context);
      return;
    }

    try {
      const systemPrompt = this.getSystemPrompt();
      const contextString = this.formatContext(context);

      // Build messages with context injected into first user message
      const messagesWithContext: Anthropic.MessageParam[] = messages.map((m, index) => {
        if (index === 0 && m.role === 'user') {
          return {
            role: 'user' as const,
            content: `${contextString}\n\nUser question: ${m.content}`,
          };
        }
        return {
          role: m.role as 'user' | 'assistant',
          content: m.content,
        };
      });

      console.log('[AI Chat] Sending request to Claude API...');

      const stream = await this.anthropic.messages.stream({
        model: 'claude-sonnet-5',
        max_tokens: 2048,
        system: systemPrompt,
        messages: messagesWithContext,
      });

      for await (const chunk of stream) {
        if (
          chunk.type === 'content_block_delta' &&
          chunk.delta.type === 'text_delta'
        ) {
          yield chunk.delta.text;
        }
      }

      console.log('[AI Chat] Response complete');
    } catch (error: any) {
      console.error('[AI Chat] Error:', error.message);
      yield 'I apologize, but I encountered an error processing your request. Please try again.';
    }
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
    const spendPhrase = costs.current === null
      ? null
      : costs.source === 'estimated'
        ? `an estimated ${this.formatMoney(costs.current)}/month (estimated from your last synced resource inventory as of ${costs.asOf ?? 'unknown'}, not a Cost Explorer billing figure)`
        : `${this.formatMoney(costs.current)} month-to-date (AWS Cost Explorer${costs.asOf ? `, as of ${costs.asOf}` : ''}; covers your connected role's billing scope across all regions)`;
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

      const topSpender = costs.topSpenders?.[0];

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
      // Only a section that is actually 'available' can say how many are (or
      // aren't) underutilized -- anything else is stated as missing data.
      const ec2 = context.resources.data?.ec2;
      const utilization = ec2?.utilization;
      const utilizationPhrase = ec2 && utilization?.state === 'available' && utilization.data
        ? `${utilization.data.underutilized} of your ${ec2.count} EC2 instances are flagged as underutilized.`
        : `I don't have EC2 utilization data for this account${utilization?.reason ? ` (${utilization.reason.replace(/\.$/, '')})` : ''}, so I can't say which instances are underutilized.`;
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
    const alerts = context.alerts;
    const alertsPhrase = alerts.state === 'available' && alerts.data
      ? `${alerts.data.total} (${alerts.data.critical} critical)`
      : `not available${alerts.reason ? ` -- ${alerts.reason.replace(/\.$/, '')}` : ''}`;

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
