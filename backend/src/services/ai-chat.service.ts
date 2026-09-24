/**
 * AI Chat Service
 * Handles conversational AI interactions for AWS infrastructure Q&A
 * Streams responses for better UX
 */

import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';

/**
 * State of one AI-context dataset, decided by the context builder before the
 * model ever sees it -- so the model never has to guess whether a 0, an empty
 * list, or a missing section means "measured", "not collected", or "failed".
 *   available     = collected, complete for its stated scope
 *   partial       = collected, but only some of its stated scope is covered
 *                   (the dataset's own coverage field says how much)
 *   unavailable   = nothing to collect (e.g. no connected account, no rows,
 *                   not enough history) -- not an error, and not a zero
 *   error         = collection was attempted and failed
 *   not_supported = DevControl has no source for this data
 */
export type ContextDataState = 'available' | 'partial' | 'unavailable' | 'error' | 'not_supported';

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
}

export interface ChatContext {
  services: string[];
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
    // discovery job's completion time (resourceDataAsOf); null otherwise.
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
  resources: {
    ec2?: { count: number; underutilized: number };
    rds?: { count: number; storageCost: number };
    // invocations is a real, usage-based figure -- SUM of each function's
    // real 30-day CloudWatch Invocations (see awsResourceDiscovery.ts's
    // discoverLambdaFunctions()/lambda-usage.util.ts), read back from
    // aws_resources.metadata->>'invocations_30d'. It replaces a prior
    // implementation that summed a `tags->>'invocations'` value nothing
    // ever wrote, and so always silently reported 0. invocationsKnownForCount
    // is how many of `count` functions actually have a known usage figure
    // (a per-function CloudWatch failure leaves that one function's usage
    // unknown, not zero) -- callers must not present `invocations` as a
    // complete total when invocationsKnownForCount < count.
    lambda?: { count: number; invocations: number; invocationsKnownForCount: number };
  };
  alerts: {
    total: number;
    critical: number;
    recent: string[];
  };
  anomalies?: Array<{
    type: string;
    service: string;
    description: string;
    impact: string;
  }>;
  dora?: {
    deploymentFrequency: string;
    leadTime: string;
    mttr: string;
  };
  timeRange: string;
  // ISO timestamp of the latest successful (status='completed') AWS resource
  // discovery run for this org -- the actual freshness of `services`,
  // `resources`, and `anomalies` below, all of which read aws_resources.
  // Null if no discovery run has ever completed for this org.
  resourceDataAsOf: string | null;
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
  never treat "unavailable" or "error" as $0, none, or unchanged.
- Resource inventory (services, EC2/RDS/Lambda counts, anomalies) is synchronized
  periodically by a background discovery process, not queried live -- its "As of"
  timestamp is the last time that process completed successfully for this account.

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
You receive context in this structure:
- Services: {AWS services in use}
- Costs: {state, source, as-of timestamp, scope, period, month-to-date spend or estimate, top services}
- Period comparison: {its own state, the two windows compared, their totals, change}
- Resources: {source, as-of timestamp, scope, EC2, RDS, Lambda details}
- Alerts: {active alerts, incidents}
- Anomalies: {cost spikes, performance issues, detected patterns}
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
- Show monthly AND annual savings
- Prioritize by ROI (savings vs effort)
- Flag one-time vs recurring savings
- Consider Reserved Instances and Savings Plans
- Always quantify: "Save $X/month" not "reduce costs"

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
  private formatScope(scope: CostExplorerScope | InventoryScope): string[] {
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
        lines.push(`- period: month-to-date, ${costs.period.start} up to ${costs.period.endExclusive} (end exclusive)`);
      }
      lines.push(`- month_to_date_spend: ${this.formatMoney(costs.current)}${costs.current < 0 ? ' (net negative: credits/refunds exceed charges)' : ''}`);
      lines.push('Top services by month-to-date spend (Cost Explorer SERVICE categories for the scope above, NOT per-resource costs. A category like "EC2" can include EBS volumes, data transfer, Elastic IPs, and other non-instance charges, so its total is not proof that any one resource caused that spend):');
      if (costs.topSpenders && costs.topSpenders.length > 0) {
        lines.push(...costs.topSpenders.map(s => `- ${s.service}: ${this.formatMoney(s.cost)}${s.percentage !== null ? ` (${s.percentage.toFixed(1)}%)` : ''}`));
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
      'Period comparison (month-to-date vs the same days of the previous month; source: AWS Cost Explorer daily trend, same scope as the cost data above. Window totals come from the daily trend and can differ from month_to_date_spend, e.g. when credits apply):',
      `- state: ${comparison.state}`,
    ];
    if (comparison.note) lines.push(`- note: ${comparison.note}`);

    const { currentWindow, previousWindow, currentWindowTotal, previousWindowTotal, coverage } = comparison;
    if (!currentWindow || !previousWindow || currentWindowTotal === null || previousWindowTotal === null || !coverage) {
      lines.push('- previous period: not available -- do not assume spend was unchanged, and do not derive a change from the current figure alone');
      return lines.join('\n');
    }

    lines.push(`- current_window: ${currentWindow.start} to ${currentWindow.end}, total ${this.formatMoney(currentWindowTotal)} (${coverage.currentDays} of ${coverage.expectedCurrentDays} days of data)`);
    lines.push(`- previous_window: ${previousWindow.start} to ${previousWindow.end}, total ${this.formatMoney(previousWindowTotal)} (${coverage.previousDays} of ${coverage.expectedPreviousDays} days of data)`);
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
  private formatContext(context: ChatContext): string {
    const resourceLines: string[] = [];
    if (context.resources.ec2) {
      resourceLines.push(`- EC2: ${context.resources.ec2.count} instances, ${context.resources.ec2.underutilized} underutilized`);
    }
    if (context.resources.rds) {
      resourceLines.push(`- RDS: ${context.resources.rds.count} databases, storage cost $${context.resources.rds.storageCost}/month`);
    }
    if (context.resources.lambda) {
      const { count, invocations, invocationsKnownForCount } = context.resources.lambda;
      if (invocationsKnownForCount === 0) {
        // No function's real 30-day usage could be determined (CloudWatch
        // unavailable for all of them) -- state that plainly rather than
        // asserting a specific invocation count we don't actually have.
        resourceLines.push(`- Lambda: ${count} functions, 30-day invocation data unavailable`);
      } else if (invocationsKnownForCount < count) {
        resourceLines.push(`- Lambda: ${count} functions, ${invocations.toLocaleString()} invocations over the last 30 days (usage known for ${invocationsKnownForCount} of ${count} functions; the rest are unavailable, not zero)`);
      } else {
        resourceLines.push(`- Lambda: ${count} functions, ${invocations.toLocaleString()} invocations over the last 30 days`);
      }
    }

    const resourceAsOfLabel = context.resourceDataAsOf ?? 'no completed discovery run yet for this account';

    return `
CURRENT AWS ENVIRONMENT CONTEXT:

Services in use: ${context.services.length > 0 ? context.services.join(', ') : 'No services detected'}

${this.formatCostSection(context.costs)}

${this.formatComparisonSection(context.costs.comparison)}

Resource inventory (source: DevControl AWS discovery — synchronized periodically, not queried live; independent of the billing data above, and a different scope from it; do not assume a resource count here explains a cost driver above unless this context explicitly states that connection):
- As of: ${resourceAsOfLabel}
${this.formatScope(context.inventoryScope).join('\n')}
${resourceLines.length > 0 ? resourceLines.join('\n') : '- No resource data available'}

Alerts & Incidents:
- Total active alerts: ${context.alerts.total}
- Critical alerts: ${context.alerts.critical}
${context.alerts.recent.length > 0 ? `- Recent: ${context.alerts.recent.join(', ')}` : '- No recent incidents'}

${context.anomalies && context.anomalies.length > 0 ? `
Detected Anomalies (source: DevControl resource inventory estimate -- the same estimated_monthly_cost basis as the resource inventory above, not a confirmed AWS Cost Explorer billing event):
${context.anomalies.map(a => `- ${a.service} ${a.type}: ${a.description} (${a.impact})`).join('\n')}
` : ''}

${context.dora ? `
DORA Metrics:
- Deployment frequency: ${context.dora.deploymentFrequency}
- Lead time for changes: ${context.dora.leadTime}
- Mean time to recover: ${context.dora.mttr}
` : ''}
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
      const ec2 = context.resources.ec2;
      return `**🔍 What's happening**

${ec2 && ec2.underutilized > 0
  ? `You have ${ec2.underutilized} underutilized EC2 instances out of ${ec2.count} total.`
  : 'Resource utilization data is being gathered.'}

**💰 Cost / impact**

Underutilized resources typically represent 20-40% potential savings when rightsized.

**✅ Recommended actions**

1. Review CloudWatch metrics for CPU and memory utilization
2. Consider downsizing instances with <20% average utilization
3. Implement scheduling for non-production workloads

*Note: AI service temporarily unavailable - this is a simplified analysis.*`;
    }

    // Generic response
    return `**🔍 What's happening**

I can see ${context.services.length} discovered service types in your AWS environment${spendPhrase ? `, with spend of ${spendPhrase}` : '; cost data is not available right now'}.

**💰 Cost / impact**

- Spend: ${spendPhrase ?? 'not available'}
- Change: ${changePhrase ?? 'no comparison with last month is available'}
- Active alerts: ${context.alerts.total} (${context.alerts.critical} critical)

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
