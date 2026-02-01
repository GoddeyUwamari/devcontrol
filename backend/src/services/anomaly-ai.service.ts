import Anthropic from '@anthropic-ai/sdk';
import { AnomalyDetection } from '../types/anomaly.types';

export class AnomalyAIService {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Generate AI explanations for detected anomalies
   */
  async explainAnomalies(anomalies: AnomalyDetection[]): Promise<AnomalyDetection[]> {
    if (anomalies.length === 0) return [];

    console.log(`[Anomaly AI] Explaining ${anomalies.length} anomalies...`);

    // Process in batches to avoid rate limits
    const batchSize = 5;
    const enrichedAnomalies: AnomalyDetection[] = [];

    for (let i = 0; i < anomalies.length; i += batchSize) {
      const batch = anomalies.slice(i, i + batchSize);
      const results = await Promise.all(
        batch.map(anomaly => this.explainSingleAnomaly(anomaly))
      );
      enrichedAnomalies.push(...results);
    }

    console.log(`[Anomaly AI] Explanations complete`);
    return enrichedAnomalies;
  }

  /**
   * Explain a single anomaly using AI
   */
  private async explainSingleAnomaly(anomaly: AnomalyDetection): Promise<AnomalyDetection> {
    try {
      const prompt = this.buildExplanationPrompt(anomaly);

      const message = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 1024,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt,
        }],
      });

      const response = this.extractTextContent(message.content);
      const parsed = this.parseAIResponse(response);

      return {
        ...anomaly,
        aiExplanation: parsed.explanation,
        impact: parsed.impact,
        recommendation: parsed.recommendation,
      };
    } catch (error) {
      console.error('[Anomaly AI] Error explaining anomaly:', error);

      // Fallback to basic explanation
      return {
        ...anomaly,
        aiExplanation: this.getFallbackExplanation(anomaly),
        impact: this.getFallbackImpact(anomaly),
        recommendation: this.getFallbackRecommendation(anomaly),
      };
    }
  }

  /**
   * Build prompt for AI explanation
   */
  private buildExplanationPrompt(anomaly: AnomalyDetection): string {
    return `You are an AWS infrastructure expert analyzing a detected anomaly.

ANOMALY DETAILS:
Type: ${anomaly.type}
Severity: ${anomaly.severity}
Resource: ${anomaly.resourceName || 'Organization-wide'}
Metric: ${anomaly.metric}
Current Value: ${anomaly.currentValue.toFixed(2)}
Expected Value: ${anomaly.expectedValue.toFixed(2)}
Deviation: ${anomaly.deviation.toFixed(1)}%
Time Window: ${anomaly.timeWindow}

Provide a concise analysis in this exact format:

EXPLANATION:
[2-3 sentences explaining WHY this anomaly occurred. Consider common causes like traffic changes, deployments, configuration changes, or resource issues.]

IMPACT:
[1-2 sentences explaining the business/technical impact. Quantify if possible.]

RECOMMENDATION:
[2-3 specific, actionable steps to investigate or resolve. Be practical and AWS-specific.]

Keep responses technical but accessible. Focus on actionable insights.`;
  }

  /**
   * Parse AI response
   */
  private parseAIResponse(response: string): {
    explanation: string;
    impact: string;
    recommendation: string;
  } {
    const explanationMatch = response.match(/EXPLANATION:\s*(.*?)(?=IMPACT:|$)/s);
    const impactMatch = response.match(/IMPACT:\s*(.*?)(?=RECOMMENDATION:|$)/s);
    const recommendationMatch = response.match(/RECOMMENDATION:\s*(.*?)$/s);

    return {
      explanation: explanationMatch?.[1]?.trim() || 'Unable to generate explanation',
      impact: impactMatch?.[1]?.trim() || 'Impact analysis pending',
      recommendation: recommendationMatch?.[1]?.trim() || 'Investigation recommended',
    };
  }

  /**
   * Fallback explanation if AI fails
   */
  private getFallbackExplanation(anomaly: AnomalyDetection): string {
    const changeType = anomaly.currentValue > anomaly.expectedValue ? 'increased' : 'decreased';
    return `The ${anomaly.metric} has ${changeType} by ${Math.abs(anomaly.deviation).toFixed(1)}% compared to the historical average. This deviation is statistically significant and warrants investigation.`;
  }

  private getFallbackImpact(anomaly: AnomalyDetection): string {
    if (anomaly.type.includes('cost')) {
      const diff = Math.abs(anomaly.currentValue - anomaly.expectedValue);
      return `Potential cost impact of $${diff.toFixed(2)}/month if anomaly persists.`;
    }
    if (anomaly.severity === 'critical') {
      return 'This anomaly may impact service availability or performance.';
    }
    return 'Monitor closely for continued deviation from expected behavior.';
  }

  private getFallbackRecommendation(anomaly: AnomalyDetection): string {
    return `1. Review recent changes or deployments\n2. Check CloudWatch metrics for ${anomaly.resourceName || 'affected resources'}\n3. Investigate resource configuration changes`;
  }

  /**
   * Extract text from Claude response
   */
  private extractTextContent(content: Anthropic.ContentBlock[]): string {
    return content
      .filter((block): block is Anthropic.TextBlock => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  }
}
