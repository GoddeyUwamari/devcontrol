/**
 * AI Insights Service
 * Analyzes cost changes using Claude AI and provides actionable insights
 * Includes 1-hour caching to minimize API costs
 */

import Anthropic from '@anthropic-ai/sdk';
import { Pool } from 'pg';

export interface CostData {
  previousCost: number;
  currentCost: number;
  percentageIncrease: number;
  newResources?: Array<{
    id: string;
    type: string;
    name: string;
    cost: number;
    region: string;
  }>;
  topSpenders?: Array<{
    service: string;
    cost: number;
    change: number;
  }>;
  timeRange: string;
}

export interface AIInsightResponse {
  rootCause: string;
  recommendation: string;
  estimatedSavings: number | null;
  confidence: 'high' | 'medium' | 'low';
  rawResponse: string;
  cached?: boolean;
  cacheAge?: number; // in seconds
}

interface CacheEntry {
  data: AIInsightResponse;
  timestamp: number;
  cacheKey: string;
}

// Weekly Summary Types
export interface WeeklySummaryData {
  costs: {
    previous: number;
    current: number;
    changePercent: number;
    topChanges?: Array<{
      service: string;
      change: number;
    }>;
  };
  alerts: {
    total: number;
    critical: number;
    topAlert?: {
      title: string;
      severity: string;
    };
  };
  dora: {
    deploymentFrequency: string;
    leadTime: string;
    mttr: string;
    changeFailureRate: number;
  };
}

export interface WeeklySummary {
  costs: WeeklySummaryData['costs'] & { summary: string };
  alerts: WeeklySummaryData['alerts'] & { summary: string };
  dora: WeeklySummaryData['dora'] & { summary: string };
  recommendation: {
    text: string;
    estimatedSavings: number | null;
  };
}

export class AIInsightsService {
  private anthropic: Anthropic | null = null;
  private pool: Pool;
  private cache: Map<string, CacheEntry> = new Map();
  private readonly CACHE_TTL = 60 * 60 * 1000; // 1 hour in milliseconds
  private readonly CACHE_CLEANUP_INTERVAL = 15 * 60 * 1000; // 15 minutes

  constructor(pool: Pool) {
    this.pool = pool;

    // Only initialize Anthropic if API key is available
    if (process.env.ANTHROPIC_API_KEY) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
      console.log('[AI Insights] Service initialized with Anthropic API');
    } else {
      console.warn('[AI Insights] ANTHROPIC_API_KEY not found - AI insights will use fallback responses');
    }

    // Set up cache cleanup
    this.startCacheCleanup();
  }

  /**
   * Analyze cost increase and provide AI-powered insights
   */
  async analyzeCostIncrease(data: CostData): Promise<AIInsightResponse> {
    const cacheKey = this.generateCacheKey('increase', data);

    // Check cache first
    const cached = this.getFromCache(cacheKey);
    if (cached) {
      console.log(`[AI Insights] Cache hit for cost increase (age: ${cached.cacheAge}s)`);
      return cached.data;
    }

    // If no API key available, return fallback
    if (!this.anthropic) {
      console.log('[AI Insights] No API key - returning fallback response');
      return this.getFallbackResponse('increase', data);
    }

    try {
      const prompt = this.buildCostAnalysisPrompt(data);

      console.log('[AI Insights] Analyzing cost increase with Claude...');
      const message = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const response = this.extractTextContent(message.content);
      const result = this.parseAIResponse(response);

      // Cache the result
      this.setCache(cacheKey, result);
      console.log('[AI Insights] Cost increase analysis complete - cached for 1 hour');

      return result;

    } catch (error: any) {
      console.error('[AI Insights] API Error:', error.message);
      // Return intelligent fallback based on data
      return this.getFallbackResponse('increase', data);
    }
  }

  /**
   * Analyze cost decrease
   */
  async analyzeCostDecrease(data: CostData): Promise<AIInsightResponse> {
    const cacheKey = this.generateCacheKey('decrease', data);

    const cached = this.getFromCache(cacheKey);
    if (cached) {
      console.log(`[AI Insights] Cache hit for cost decrease (age: ${cached.cacheAge}s)`);
      return cached.data;
    }

    if (!this.anthropic) {
      return this.getFallbackResponse('decrease', data);
    }

    try {
      const prompt = `Analyze this AWS cost DECREASE:

Previous cost: $${data.previousCost.toFixed(2)}
Current cost: $${data.currentCost.toFixed(2)}
Decrease: ${Math.abs(data.percentageIncrease).toFixed(1)}%
Time range: ${data.timeRange}

${data.newResources && data.newResources.length > 0 ? `
Removed or scaled-down resources:
${data.newResources.map(r => `- ${r.type} ${r.name}: -$${r.cost.toFixed(2)} (${r.region})`).join('\n')}
` : ''}

${data.topSpenders && data.topSpenders.length > 0 ? `
Services with cost reductions:
${data.topSpenders.map(s => `- ${s.service}: $${s.cost.toFixed(2)} (${s.change >= 0 ? '+' : ''}${s.change.toFixed(1)}% change)`).join('\n')}
` : ''}

Provide a concise analysis in this format:

ROOT CAUSE: [One clear sentence explaining the main reason for the decrease]

RECOMMENDATION: [One actionable suggestion to maintain or further reduce costs]

ESTIMATED_SAVINGS: [Number only, or 0 if not applicable]

Be specific, technical, and actionable. Focus on AWS-specific optimizations.`;

      console.log('[AI Insights] Analyzing cost decrease with Claude...');
      const message = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const response = this.extractTextContent(message.content);
      const result = this.parseAIResponse(response);

      this.setCache(cacheKey, result);
      console.log('[AI Insights] Cost decrease analysis complete - cached for 1 hour');

      return result;

    } catch (error: any) {
      console.error('[AI Insights] API Error:', error.message);
      return this.getFallbackResponse('decrease', data);
    }
  }

  /**
   * General cost analysis (when no significant change)
   */
  async analyzeCostTrend(data: CostData): Promise<AIInsightResponse> {
    const cacheKey = this.generateCacheKey('trend', data);

    const cached = this.getFromCache(cacheKey);
    if (cached) {
      console.log(`[AI Insights] Cache hit for cost trend (age: ${cached.cacheAge}s)`);
      return cached.data;
    }

    if (!this.anthropic) {
      return this.getFallbackResponse('trend', data);
    }

    try {
      const prompt = `Analyze this AWS cost trend:

Current cost: $${data.currentCost.toFixed(2)}
Previous period: $${data.previousCost.toFixed(2)}
Change: ${data.percentageIncrease >= 0 ? '+' : ''}${data.percentageIncrease.toFixed(1)}%
Time range: ${data.timeRange}

${data.topSpenders && data.topSpenders.length > 0 ? `
Top spending services:
${data.topSpenders.map(s => `- ${s.service}: $${s.cost.toFixed(2)} (${s.change >= 0 ? '+' : ''}${s.change.toFixed(1)}% change)`).join('\n')}
` : ''}

Provide optimization recommendations in this format:

ROOT CAUSE: [One sentence describing the current cost pattern]

RECOMMENDATION: [One specific, actionable optimization suggestion]

ESTIMATED_SAVINGS: [Number only, or 0 if not applicable]

Focus on AWS cost optimization opportunities.`;

      console.log('[AI Insights] Analyzing cost trend with Claude...');
      const message = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const response = this.extractTextContent(message.content);
      const result = this.parseAIResponse(response);

      this.setCache(cacheKey, result);
      console.log('[AI Insights] Cost trend analysis complete - cached for 1 hour');

      return result;

    } catch (error: any) {
      console.error('[AI Insights] API Error:', error.message);
      return this.getFallbackResponse('trend', data);
    }
  }

  /**
   * Build detailed prompt for cost analysis
   */
  private buildCostAnalysisPrompt(data: CostData): string {
    return `Analyze this AWS cost increase:

Previous cost: $${data.previousCost.toFixed(2)}
Current cost: $${data.currentCost.toFixed(2)}
Increase: ${data.percentageIncrease.toFixed(1)}%
Time range: ${data.timeRange}

${data.newResources && data.newResources.length > 0 ? `
New or changed resources:
${data.newResources.map(r => `- ${r.type} ${r.name}: $${r.cost.toFixed(2)}/mo (${r.region})`).join('\n')}
` : ''}

${data.topSpenders && data.topSpenders.length > 0 ? `
Top spending services:
${data.topSpenders.map(s => `- ${s.service}: $${s.cost.toFixed(2)} (${s.change >= 0 ? '+' : ''}${s.change.toFixed(1)}% change)`).join('\n')}
` : ''}

Provide a concise, actionable analysis in this exact format:

ROOT CAUSE: [One clear sentence explaining the primary driver of cost increase]

RECOMMENDATION: [One specific, actionable recommendation to optimize costs]

ESTIMATED_SAVINGS: [Number only representing monthly savings in USD, or 0 if not applicable]

Be specific, technical, and focus on AWS-specific optimizations. Keep each section to one sentence.`;
  }

  /**
   * Extract text content from Claude response
   */
  private extractTextContent(content: any[]): string {
    const textBlock = content.find((block: any) => block.type === 'text');
    return textBlock ? textBlock.text : '';
  }

  /**
   * Parse AI response into structured format
   */
  private parseAIResponse(response: string): AIInsightResponse {
    const lines = response.split('\n').filter(line => line.trim());

    let rootCause = '';
    let recommendation = '';
    let estimatedSavings: number | null = null;

    for (const line of lines) {
      if (line.includes('ROOT CAUSE:')) {
        rootCause = line.replace('ROOT CAUSE:', '').trim();
      } else if (line.includes('RECOMMENDATION:')) {
        recommendation = line.replace('RECOMMENDATION:', '').trim();
      } else if (line.includes('ESTIMATED_SAVINGS:')) {
        const savingsStr = line.replace('ESTIMATED_SAVINGS:', '').trim();
        const match = savingsStr.match(/\d+/);
        estimatedSavings = match ? parseInt(match[0]) : null;
      }
    }

    return {
      rootCause: rootCause || 'Unable to determine root cause from available data.',
      recommendation: recommendation || 'Continue monitoring costs and review resource utilization.',
      estimatedSavings,
      confidence: this.calculateConfidence(rootCause, recommendation),
      rawResponse: response
    };
  }

  /**
   * Calculate confidence level based on response quality
   */
  private calculateConfidence(rootCause: string, recommendation: string): 'high' | 'medium' | 'low' {
    if (rootCause.length > 50 && recommendation.length > 50) {
      return 'high';
    } else if (rootCause.length > 20 && recommendation.length > 20) {
      return 'medium';
    }
    return 'low';
  }

  /**
   * Intelligent fallback response based on data patterns
   */
  private getFallbackResponse(type: 'increase' | 'decrease' | 'trend', data: CostData): AIInsightResponse {
    const change = Math.abs(data.percentageIncrease);

    if (type === 'increase') {
      const topSpender = data.topSpenders?.[0];
      return {
        rootCause: topSpender
          ? `Cost increased by ${change.toFixed(1)}% primarily driven by ${topSpender.service} spending.`
          : `AWS infrastructure costs increased by ${change.toFixed(1)}% compared to the previous period.`,
        recommendation: topSpender
          ? `Review ${topSpender.service} usage patterns and consider implementing Reserved Instances or Savings Plans for predictable workloads.`
          : 'Review AWS Cost Explorer for detailed breakdown and identify optimization opportunities.',
        estimatedSavings: topSpender ? Math.round(topSpender.cost * 0.2) : 0,
        confidence: 'medium',
        rawResponse: 'AI service unavailable - using intelligent fallback'
      };
    }

    if (type === 'decrease') {
      return {
        rootCause: `Successfully reduced costs by ${change.toFixed(1)}% through recent optimization efforts.`,
        recommendation: 'Maintain current optimization practices and continue monitoring for further opportunities.',
        estimatedSavings: 0,
        confidence: 'medium',
        rawResponse: 'AI service unavailable - using intelligent fallback'
      };
    }

    // trend
    const topSpender = data.topSpenders?.[0];
    return {
      rootCause: topSpender
        ? `Current spending is stable with ${topSpender.service} as the primary cost driver.`
        : 'AWS costs are stable with no significant changes detected.',
      recommendation: 'Review compute utilization and consider rightsizing opportunities to optimize costs.',
      estimatedSavings: 0,
      confidence: 'low',
      rawResponse: 'AI service unavailable - using intelligent fallback'
    };
  }

  /**
   * Generate cache key from data
   */
  private generateCacheKey(type: string, data: CostData): string {
    // Create a simple hash of the key data points
    const key = `${type}_${data.currentCost.toFixed(2)}_${data.previousCost.toFixed(2)}_${data.percentageIncrease.toFixed(1)}`;
    return key;
  }

  /**
   * Get item from cache if not expired
   */
  private getFromCache(key: string): { data: AIInsightResponse; cacheAge: number } | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > this.CACHE_TTL) {
      this.cache.delete(key);
      return null;
    }

    return {
      data: {
        ...entry.data,
        cached: true,
        cacheAge: Math.floor(age / 1000)
      },
      cacheAge: Math.floor(age / 1000)
    };
  }

  /**
   * Set item in cache
   */
  private setCache(key: string, data: AIInsightResponse): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
      cacheKey: key
    });
  }

  /**
   * Start periodic cache cleanup
   */
  private startCacheCleanup(): void {
    setInterval(() => {
      const now = Date.now();
      let cleaned = 0;

      const entries = Array.from(this.cache.entries());
      for (const [key, entry] of entries) {
        if (now - entry.timestamp > this.CACHE_TTL) {
          this.cache.delete(key);
          cleaned++;
        }
      }

      if (cleaned > 0) {
        console.log(`[AI Insights] Cache cleanup: removed ${cleaned} expired entries`);
      }
    }, this.CACHE_CLEANUP_INTERVAL);
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; keys: string[] } {
    return {
      size: this.cache.size,
      keys: Array.from(this.cache.keys())
    };
  }

  /**
   * Clear all cache
   */
  clearCache(): void {
    const size = this.cache.size;
    this.cache.clear();
    console.log(`[AI Insights] Cache cleared: ${size} entries removed`);
  }

  /**
   * Generate weekly summary with AI insights
   */
  async generateWeeklySummary(data: WeeklySummaryData): Promise<WeeklySummary> {
    try {
      if (!this.anthropic) {
        console.log('[AI Insights] No API key - returning fallback weekly summary');
        return this.getFallbackWeeklySummary(data);
      }

      const prompt = `Generate a concise weekly summary for an engineering team:

COST DATA:
- Previous week: $${data.costs.previous.toFixed(2)}
- This week: $${data.costs.current.toFixed(2)}
- Change: ${data.costs.changePercent > 0 ? '+' : ''}${data.costs.changePercent.toFixed(1)}%
${data.costs.topChanges ? `
Top cost changes:
${data.costs.topChanges.map(c => `- ${c.service}: ${c.change > 0 ? '+' : ''}${c.change}%`).join('\n')}
` : ''}

ALERTS:
- Total alerts: ${data.alerts.total}
- Critical: ${data.alerts.critical}
${data.alerts.topAlert ? `
Most significant: ${data.alerts.topAlert.title} (${data.alerts.topAlert.severity})
` : ''}

DORA METRICS:
- Deployment frequency: ${data.dora.deploymentFrequency}
- Lead time: ${data.dora.leadTime}
- MTTR: ${data.dora.mttr}
- Change failure rate: ${data.dora.changeFailureRate}%

Provide:
1. COST_SUMMARY: One sentence explaining cost change
2. ALERT_SUMMARY: One sentence about most important alert (or "No critical alerts this week" if none)
3. DORA_SUMMARY: One sentence highlighting biggest improvement or concern
4. RECOMMENDATION: One actionable recommendation with estimated savings if applicable

Keep it concise and actionable.`;

      console.log('[AI Insights] Generating weekly summary with Claude...');
      const message = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt
        }]
      });

      const response = this.extractTextContent(message.content);
      return this.parseWeeklySummaryResponse(response, data);

    } catch (error: any) {
      console.error('[AI Insights] Weekly summary error:', error.message);
      return this.getFallbackWeeklySummary(data);
    }
  }

  /**
   * Parse weekly summary AI response
   */
  private parseWeeklySummaryResponse(response: string, data: WeeklySummaryData): WeeklySummary {
    const lines = response.split('\n').filter(line => line.trim());

    let costSummary = '';
    let alertSummary = '';
    let doraSummary = '';
    let recommendation = '';
    let estimatedSavings: number | null = null;

    for (const line of lines) {
      if (line.includes('COST_SUMMARY:')) {
        costSummary = line.replace('COST_SUMMARY:', '').trim();
      } else if (line.includes('ALERT_SUMMARY:')) {
        alertSummary = line.replace('ALERT_SUMMARY:', '').trim();
      } else if (line.includes('DORA_SUMMARY:')) {
        doraSummary = line.replace('DORA_SUMMARY:', '').trim();
      } else if (line.includes('RECOMMENDATION:')) {
        recommendation = line.replace('RECOMMENDATION:', '').trim();
        const match = recommendation.match(/\$(\d+)/);
        estimatedSavings = match ? parseInt(match[1]) : null;
      }
    }

    return {
      costs: {
        ...data.costs,
        summary: costSummary || 'Cost data analyzed.'
      },
      alerts: {
        ...data.alerts,
        summary: alertSummary || 'Alerts monitored.'
      },
      dora: {
        ...data.dora,
        summary: doraSummary || 'DORA metrics tracked.'
      },
      recommendation: {
        text: recommendation || 'Continue monitoring your infrastructure.',
        estimatedSavings
      }
    };
  }

  /**
   * Fallback weekly summary when AI fails
   */
  private getFallbackWeeklySummary(data: WeeklySummaryData): WeeklySummary {
    const costDirection = data.costs.changePercent > 0 ? 'increased' : 'decreased';
    const costChange = Math.abs(data.costs.changePercent);

    return {
      costs: {
        ...data.costs,
        summary: `Costs ${costDirection} ${costChange.toFixed(1)}% this week ($${data.costs.previous.toFixed(0)} → $${data.costs.current.toFixed(0)}).`
      },
      alerts: {
        ...data.alerts,
        summary: data.alerts.total > 0
          ? `${data.alerts.total} alerts this week, ${data.alerts.critical} critical.`
          : 'No alerts this week.'
      },
      dora: {
        ...data.dora,
        summary: `Deployment frequency: ${data.dora.deploymentFrequency}, Lead time: ${data.dora.leadTime}.`
      },
      recommendation: {
        text: 'Review your dashboard for detailed insights and optimization opportunities.',
        estimatedSavings: null
      }
    };
  }
}
