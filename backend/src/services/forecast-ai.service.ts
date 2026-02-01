import Anthropic from '@anthropic-ai/sdk';
import { CostForecast } from '../types/forecast.types';

export class ForecastAIService {
  private anthropic: Anthropic;

  constructor() {
    this.anthropic = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY,
    });
  }

  /**
   * Enrich forecast with AI analysis
   */
  async analyzeForecast(forecast: CostForecast): Promise<CostForecast> {
    console.log('[Forecast AI] Analyzing forecast with Claude...');

    try {
      const prompt = this.buildAnalysisPrompt(forecast);

      const message = await this.anthropic.messages.create({
        model: 'claude-sonnet-4-20250514',
        max_tokens: 2048,
        temperature: 0.3,
        messages: [{
          role: 'user',
          content: prompt,
        }],
      });

      const response = this.extractTextContent(message.content);
      const parsed = this.parseAIResponse(response);

      return {
        ...forecast,
        aiSummary: parsed.summary,
        aiRisks: parsed.risks,
        aiRecommendations: parsed.recommendations,
      };
    } catch (error) {
      console.error('[Forecast AI] Error:', error);

      // Fallback to basic analysis
      return {
        ...forecast,
        aiSummary: this.getFallbackSummary(forecast),
        aiRisks: this.getFallbackRisks(forecast),
        aiRecommendations: this.getFallbackRecommendations(forecast),
      };
    }
  }

  /**
   * Build analysis prompt
   */
  private buildAnalysisPrompt(forecast: CostForecast): string {
    return `You are an AWS cost management expert analyzing cost forecast data.

FORECAST DATA:
Historical Average: $${forecast.historicalAverage.toFixed(2)}/day
Historical Total (90d): $${forecast.historicalTotal.toFixed(2)}

Predictions:
- Next 30 days: $${forecast.predicted30Day.toFixed(2)}
- Next 90 days: $${forecast.predicted90Day.toFixed(2)}
- Next Quarter: $${forecast.predictedQuarter.toFixed(2)}
- Next Year: $${forecast.predictedYear.toFixed(2)}

Trend: ${forecast.trend}
Growth Rate: ${forecast.growthRate.toFixed(1)}%
Volatility: ${forecast.volatility.toFixed(0)}/100
Confidence: ${forecast.confidence}%
Confidence Range: $${forecast.confidenceInterval.lower.toFixed(2)} - $${forecast.confidenceInterval.upper.toFixed(2)}

Provide analysis in this exact format:

SUMMARY:
[2-3 sentences summarizing the forecast. Mention the trend, growth rate, and key prediction.]

RISKS:
[List 3-4 specific risks based on the data. Each risk should be 1-2 sentences. Consider volatility, growth rate, and trend.]

RECOMMENDATIONS:
[List 3-5 specific, actionable recommendations. Each should be 1-2 sentences. Focus on cost optimization and budget management.]

Be specific, quantify where possible, and provide actionable insights.`;
  }

  /**
   * Parse AI response
   */
  private parseAIResponse(response: string): {
    summary: string;
    risks: string[];
    recommendations: string[];
  } {
    const summaryMatch = response.match(/SUMMARY:\s*(.*?)(?=RISKS:|$)/s);
    const risksMatch = response.match(/RISKS:\s*(.*?)(?=RECOMMENDATIONS:|$)/s);
    const recsMatch = response.match(/RECOMMENDATIONS:\s*(.*?)$/s);

    const summary = summaryMatch?.[1]?.trim() || 'Forecast analysis pending';

    const risksText = risksMatch?.[1]?.trim() || '';
    const risks = risksText
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.replace(/^[-•]\s*/, '').trim())
      .filter(line => line.length > 10);

    const recsText = recsMatch?.[1]?.trim() || '';
    const recommendations = recsText
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => line.replace(/^[-•]\s*/, '').trim())
      .filter(line => line.length > 10);

    return { summary, risks, recommendations };
  }

  /**
   * Fallback summary
   */
  private getFallbackSummary(forecast: CostForecast): string {
    const direction = forecast.trend === 'increasing' ? 'increase' :
                     forecast.trend === 'decreasing' ? 'decrease' : 'remain stable';

    return `Based on ${forecast.historicalData.length} days of data, your AWS costs are expected to ${direction} at ${Math.abs(forecast.growthRate).toFixed(1)}% growth rate. Predicted spending for the next 30 days is $${forecast.predicted30Day.toFixed(2)}.`;
  }

  private getFallbackRisks(forecast: CostForecast): string[] {
    const risks: string[] = [];

    if (forecast.growthRate > 15) {
      risks.push(`High growth rate (${forecast.growthRate.toFixed(1)}%) may lead to budget overruns`);
    }

    if (forecast.volatility > 50) {
      risks.push('High cost volatility makes forecasting less reliable');
    }

    if (forecast.confidence < 70) {
      risks.push('Lower confidence in predictions due to limited or inconsistent data');
    }

    return risks.length > 0 ? risks : ['No significant risks identified'];
  }

  private getFallbackRecommendations(forecast: CostForecast): string[] {
    const recs: string[] = [];

    if (forecast.growthRate > 10) {
      recs.push('Review cost optimization opportunities to control spending growth');
    }

    recs.push('Set budget alerts at 75% and 90% of predicted spending');
    recs.push('Review Reserved Instances to reduce baseline costs');

    return recs;
  }

  /**
   * Extract text from Claude response
   */
  private extractTextContent(content: any[]): string {
    return content
      .filter(block => block.type === 'text')
      .map(block => block.text)
      .join('\n');
  }
}
