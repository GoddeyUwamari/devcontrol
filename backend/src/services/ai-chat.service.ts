/**
 * AI Chat Service
 * Handles conversational AI interactions for AWS infrastructure Q&A
 * Streams responses for better UX
 */

import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';

export interface ChatContext {
  services: string[];
  costs: {
    current: number;
    previous: number;
    changePercent: number | null;
    topSpenders: Array<{
      service: string;
      cost: number;
      percentage: number;
    }>;
    // Provenance -- mirrors the Dashboard's actual-vs-estimated distinction
    // (stats.controller.ts's getDashboardStats()), plus a third state this
    // service didn't previously distinguish: genuinely no data at all.
    // 'actual'      = a real AWS Cost Explorer result (fresh or served from
    //                 awsCostService's own short-lived cache -- `asOf` says which).
    // 'estimated'   = Cost Explorer was unavailable; derived from aws_resources'
    //                 estimated_monthly_cost instead (same fallback the Dashboard uses).
    // 'unavailable' = neither exists. `current`/`previous` are 0 in this case,
    //                 but that 0 must never be presented as confirmed spend.
    source: 'actual' | 'estimated' | 'unavailable';
    // ISO timestamp this cost figure was actually obtained -- for 'actual',
    // awsCostService's own fetch/cache timestamp; for 'estimated', the
    // discovery job's completion time (resourceDataAsOf); null for 'unavailable'.
    asOf: string | null;
  };
  resources: {
    ec2?: { count: number; underutilized: number };
    rds?: { count: number; storageCost: number };
    lambda?: { count: number; invocations: number };
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
- Cost data has a "Source" (AWS Cost Explorer, or a database estimate used when
  Cost Explorer is unavailable, or unavailable entirely) and an "As of" timestamp
  -- the moment that figure was actually obtained, which may be several hours old
  even when the source is Cost Explorer, since it is served from a short-lived cache.
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
- Costs: {source, as-of timestamp, current spend, trends, top spenders}
- Resources: {source, as-of timestamp, EC2, RDS, Lambda details}
- Alerts: {active alerts, incidents}
- Anomalies: {cost spikes, performance issues, detected patterns}
- DORA: {deployment frequency, lead time, MTTR}
- Time Range: {the query window this data covers, e.g. "last 30 days" -- not
  the same thing as the as-of freshness timestamps above}

If context is empty, state clearly what's missing.

3. BE OPINIONATED AND ACTIONABLE
- Explain what's happening in THIS AWS account
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
- Billing-category totals are account-wide AWS spend categories, not
  per-resource costs. Don't attribute a category's cost to a specific
  resource unless the context states that resource's own cost directly.
- When context directly states a fact, state it with full confidence — don't
  add hedging to facts that are actually in the context.

10. CONTINUITY
- Treat follow-ups as part of same investigation
- Refer to previous findings when relevant
- Build on prior recommendations

11. AUTOMATIC DATA ACCESS
- ALL AWS data is automatically provided in your context
- NEVER ask users to "share data", "provide details", or "pull information"
- Users CANNOT manually provide technical data - you already have it
- If critical data is missing from context, state:
  "I don't have [specific metric] available in the current data"
- Then provide best analysis possible with available data
- NEVER say: "Can you share...", "Please provide...", "If your platform surfaces..."

Your goal: Help users understand their AWS environment, reduce cost, improve reliability, and make confident infrastructure decisions.`;
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
      resourceLines.push(`- Lambda: ${context.resources.lambda.count} functions, ${context.resources.lambda.invocations.toLocaleString()} invocations/month`);
    }

    const costSourceLabel = {
      actual: 'AWS Cost Explorer',
      estimated: 'DevControl database estimate (Cost Explorer unavailable at fetch time)',
      unavailable: 'unavailable — no live/cached Cost Explorer result and no database estimate could be computed',
    }[context.costs.source];
    const costAsOfLabel = context.costs.asOf ?? 'unknown';

    const resourceAsOfLabel = context.resourceDataAsOf ?? 'no completed discovery run yet for this account';

    return `
CURRENT AWS ENVIRONMENT CONTEXT:

Services in use: ${context.services.length > 0 ? context.services.join(', ') : 'No services detected'}

Cost data (query window: ${context.timeRange}):
- Source: ${costSourceLabel}
- As of: ${costAsOfLabel}
${context.costs.source === 'unavailable' ? '- No cost data available for this organization right now.' : `- Current spend: $${context.costs.current.toLocaleString()}/month
- Previous period: $${context.costs.previous.toLocaleString()}/month
- Change: ${context.costs.changePercent != null ? `${context.costs.changePercent > 0 ? '+' : ''}${context.costs.changePercent.toFixed(1)}%` : 'Not enough historical data yet to compare'}`}

Top cost drivers (source: AWS Cost Explorer billing categories — account-wide spend per service, NOT tied to any specific resource below. A category like "EC2" can include EBS volumes, data transfer, elastic IPs, and other non-instance charges, so its total is not proof that any one instance caused that spend):
${context.costs.source === 'unavailable'
  ? '- Not available'
  : context.costs.topSpenders.length > 0
    ? context.costs.topSpenders.map(s => `- ${s.service}: $${s.cost.toLocaleString()} (${s.percentage.toFixed(1)}%)`).join('\n')
    : '- No cost data available'}

Resource inventory (source: DevControl AWS discovery — synchronized periodically, not queried live; independent of the billing data above; do not assume a resource count here explains a cost driver above unless this context explicitly states that connection):
- As of: ${resourceAsOfLabel}
${resourceLines.length > 0 ? resourceLines.join('\n') : '- No resource data available'}

Alerts & Incidents:
- Total active alerts: ${context.alerts.total}
- Critical alerts: ${context.alerts.critical}
${context.alerts.recent.length > 0 ? `- Recent: ${context.alerts.recent.join(', ')}` : '- No recent incidents'}

${context.anomalies && context.anomalies.length > 0 ? `
Detected Anomalies:
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

    // Basic pattern matching for common questions
    if (lastMessage.includes('cost') || lastMessage.includes('spend') || lastMessage.includes('bill')) {
      if (context.costs.source === 'unavailable') {
        return `**🔍 What's happening**

I don't have cost data available for this account right now — there's no live/cached AWS Cost Explorer result and no database estimate could be computed.

**✅ Recommended actions**

1. Confirm an AWS account is connected and Cost Explorer is enabled for it
2. Try again shortly, or check your AWS Cost Explorer directly for current spend

*Note: AI service temporarily unavailable - this is a simplified analysis.*`;
      }

      const change = context.costs.changePercent;
      const direction = change == null ? null : change > 0 ? 'increased' : change < 0 ? 'decreased' : 'remained stable';
      const topSpender = context.costs.topSpenders[0];
      const sourceNote = context.costs.source === 'estimated'
        ? ` (estimated from your last synced resource inventory as of ${context.costs.asOf ?? 'unknown'}, not a live Cost Explorer figure)`
        : context.costs.asOf ? ` (as of ${context.costs.asOf})` : '';

      return `**🔍 What's happening**

Your AWS spend is $${context.costs.current.toLocaleString()}/month${sourceNote}${direction ? `, which has ${direction} by ${Math.abs(change as number).toFixed(1)}% compared to last period` : ' (not enough historical data yet to compare against last period)'}.

**💰 Cost / impact**

${topSpender ? `Your top cost driver is ${topSpender.service} at $${topSpender.cost.toLocaleString()}/month (${topSpender.percentage.toFixed(1)}% of total spend).` : 'Cost breakdown data is limited.'}

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
    const costLine = context.costs.source === 'unavailable'
      ? 'Cost data is not available for this account right now.'
      : `$${context.costs.current.toLocaleString()}/month in spend${context.costs.source === 'estimated' ? ' (estimated, not a live Cost Explorer figure)' : ''}`;

    return `**🔍 What's happening**

I can see your AWS environment with ${costLine} across ${context.services.length} services.

**💰 Cost / impact**

- Current spend: ${context.costs.source === 'unavailable' ? 'not available' : `$${context.costs.current.toLocaleString()}/month`}
- Change: ${context.costs.changePercent != null ? `${context.costs.changePercent > 0 ? '+' : ''}${context.costs.changePercent.toFixed(1)}%` : 'Not enough historical data yet to compare'}
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
