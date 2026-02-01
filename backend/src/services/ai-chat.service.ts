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
    changePercent: number;
    topSpenders: Array<{
      service: string;
      cost: number;
      percentage: number;
    }>;
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

You receive structured, real-time context about the user's AWS environment, including:
- Services in use
- Cost data and trends
- Resource utilization
- Alerts, risks, and incidents
- Deployment and reliability signals (DORA, monitoring)

RULES:

1. CONTEXT FIRST
- Base answers ONLY on provided context
- Never assume resources not explicitly provided
- If data is missing, state what's unavailable and why

2. CONTEXT FORMAT
You receive context in this structure:
- Services: {AWS services in use}
- Costs: {current spend, trends, top spenders}
- Resources: {EC2, RDS, Lambda details}
- Alerts: {active alerts, incidents}
- Anomalies: {cost spikes, performance issues, detected patterns}
- DORA: {deployment frequency, lead time, MTTR}
- Time Range: {data freshness}

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

    return `
CURRENT AWS ENVIRONMENT CONTEXT:

Services in use: ${context.services.length > 0 ? context.services.join(', ') : 'No services detected'}

Cost data (${context.timeRange}):
- Current spend: $${context.costs.current.toLocaleString()}/month
- Previous period: $${context.costs.previous.toLocaleString()}/month
- Change: ${context.costs.changePercent > 0 ? '+' : ''}${context.costs.changePercent.toFixed(1)}%

Top cost drivers:
${context.costs.topSpenders.length > 0
  ? context.costs.topSpenders.map(s => `- ${s.service}: $${s.cost.toLocaleString()} (${s.percentage.toFixed(1)}%)`).join('\n')
  : '- No cost data available'}

Resources:
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
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        temperature: 0.3,
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
      const change = context.costs.changePercent;
      const direction = change > 0 ? 'increased' : change < 0 ? 'decreased' : 'remained stable';
      const topSpender = context.costs.topSpenders[0];

      return `**🔍 What's happening**

Your AWS spend is $${context.costs.current.toLocaleString()}/month, which has ${direction} by ${Math.abs(change).toFixed(1)}% compared to last period.

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
    return `**🔍 What's happening**

I can see your AWS environment with $${context.costs.current.toLocaleString()}/month in spend across ${context.services.length} services.

**💰 Cost / impact**

- Current spend: $${context.costs.current.toLocaleString()}/month
- Change: ${context.costs.changePercent > 0 ? '+' : ''}${context.costs.changePercent.toFixed(1)}%
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
