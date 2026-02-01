/**
 * AI Insights Service (Frontend)
 * Client-side service for AI-powered cost analysis
 */

export interface CostAnalysisRequest {
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

export interface AIInsight {
  rootCause: string;
  recommendation: string;
  estimatedSavings: number | null;
  confidence: 'high' | 'medium' | 'low';
  rawResponse: string;
  cached?: boolean;
  cacheAge?: number;
}

export interface AIInsightResponse {
  success: boolean;
  data: AIInsight;
  meta?: {
    requestedAt: string;
    cached: boolean;
    cacheAge: number;
  };
}

class AIInsightsService {
  private baseUrl = process.env.NEXT_PUBLIC_API_URL
    ? `${process.env.NEXT_PUBLIC_API_URL}/ai-insights`
    : 'http://localhost:8080/api/ai-insights';

  /**
   * Analyze cost changes and get AI recommendations
   */
  async analyzeCost(data: CostAnalysisRequest): Promise<AIInsight> {
    const response = await fetch(`${this.baseUrl}/analyze-cost`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(data),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      throw new Error(error.error || 'Failed to analyze cost data');
    }

    const result: AIInsightResponse = await response.json();
    return result.data;
  }

  /**
   * Get cache statistics
   */
  async getCacheStats(): Promise<{
    cacheSize: number;
    cachedKeys: number;
    cacheTTL: string;
  }> {
    const response = await fetch(`${this.baseUrl}/cache-stats`);

    if (!response.ok) {
      throw new Error('Failed to fetch cache stats');
    }

    const result = await response.json();
    return result.data;
  }

  /**
   * Clear the insights cache
   */
  async clearCache(): Promise<void> {
    const response = await fetch(`${this.baseUrl}/clear-cache`, {
      method: 'POST',
    });

    if (!response.ok) {
      throw new Error('Failed to clear cache');
    }
  }
}

export const aiInsightsService = new AIInsightsService();
