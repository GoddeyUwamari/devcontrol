/**
 * Optimization AI Service
 * Uses Claude AI to intelligently prioritize cost optimization recommendations
 */

import Anthropic from '@anthropic-ai/sdk';
import { OptimizationRecommendation } from '../types/optimization.types';

export class OptimizationAIService {
  private anthropic: Anthropic;
  private enabled: boolean;

  constructor() {
    this.enabled = !!process.env.ANTHROPIC_API_KEY;
    if (this.enabled) {
      this.anthropic = new Anthropic({
        apiKey: process.env.ANTHROPIC_API_KEY,
      });
    } else {
      console.warn('[Optimization AI] ANTHROPIC_API_KEY not set - using fallback prioritization');
      this.anthropic = {} as Anthropic;
    }
  }

  /**
   * Use AI to prioritize recommendations
   */
  async prioritizeRecommendations(
    recommendations: OptimizationRecommendation[]
  ): Promise<OptimizationRecommendation[]> {
    if (recommendations.length === 0) return [];

    if (!this.enabled) {
      console.log('[Optimization AI] Using fallback prioritization (no API key)');
      return this.fallbackPrioritization(recommendations);
    }

    try {
      console.log(`[Optimization AI] Prioritizing ${recommendations.length} recommendations with Claude...`);
      const prompt = this.buildPrioritizationPrompt(recommendations);

      const message = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        temperature: 0.3,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const response = this.extractTextContent(message.content);
      const prioritized = this.parsePrioritization(response, recommendations);
      console.log('[Optimization AI] Prioritization complete');
      return prioritized;
    } catch (error: any) {
      console.error('[Optimization AI] Prioritization error:', error.message);
      // Fallback: sort by savings
      return this.fallbackPrioritization(recommendations);
    }
  }

  /**
   * Build prioritization prompt for Claude
   */
  private buildPrioritizationPrompt(recommendations: OptimizationRecommendation[]): string {
    const summary = recommendations
      .map(
        (rec, i) =>
          `${i + 1}. ${rec.type} - ${rec.resourceName} - $${rec.monthlySavings.toFixed(2)}/mo savings - ${rec.risk} risk - ${rec.effort} effort`
      )
      .join('\n');

    return `You are a cloud cost optimization expert. Prioritize these AWS optimization recommendations.

Recommendations:
${summary}

For each recommendation, assign a priority score (1-10) where:
- 10 = Highest priority (high savings, low risk, low effort)
- 1 = Lowest priority (low savings, high risk, high effort)

Consider:
- ROI: Savings vs effort
- Risk: Safe changes first
- Quick wins: Low effort, high impact
- Cumulative impact: Multiple small savings add up

Respond with ONLY a comma-separated list of priority scores in the same order as the recommendations.
Example: 9,7,8,6,10,5

Priority scores:`;
  }

  /**
   * Parse AI prioritization response
   */
  private parsePrioritization(
    response: string,
    recommendations: OptimizationRecommendation[]
  ): OptimizationRecommendation[] {
    try {
      const scores = response
        .trim()
        .split(',')
        .map((s) => parseInt(s.trim()));

      if (scores.length !== recommendations.length) {
        console.warn(
          `[Optimization AI] Score count mismatch: got ${scores.length}, expected ${recommendations.length}`
        );
        throw new Error('Score count mismatch');
      }

      return recommendations
        .map((rec, i) => ({
          ...rec,
          priority: scores[i] || rec.priority,
        }))
        .sort((a, b) => b.priority - a.priority);
    } catch (error) {
      console.error('[Optimization AI] Parse error:', error);
      return this.fallbackPrioritization(recommendations);
    }
  }

  /**
   * Fallback prioritization when AI is unavailable
   */
  private fallbackPrioritization(
    recommendations: OptimizationRecommendation[]
  ): OptimizationRecommendation[] {
    return recommendations
      .map((rec) => {
        // Calculate priority based on savings, risk, and effort
        let priority = 5; // Base priority

        // High savings boost
        if (rec.monthlySavings > 100) priority += 3;
        else if (rec.monthlySavings > 50) priority += 2;
        else if (rec.monthlySavings > 20) priority += 1;

        // Low risk boost
        if (rec.risk === 'safe') priority += 2;
        else if (rec.risk === 'risky') priority -= 2;

        // Low effort boost
        if (rec.effort === 'low') priority += 1;
        else if (rec.effort === 'high') priority -= 1;

        // Clamp to 1-10
        priority = Math.max(1, Math.min(10, priority));

        return { ...rec, priority };
      })
      .sort((a, b) => b.priority - a.priority);
  }

  /**
   * Extract text from Claude response
   */
  private extractTextContent(content: any[]): string {
    return content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n');
  }
}
