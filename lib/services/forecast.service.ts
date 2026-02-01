import { CostForecast, Scenario, ScenarioType, TimeSeriesPoint } from '@/types/forecast.types';
import { demoModeService } from './demo-mode.service';

class ForecastService {
  private baseUrl = process.env.NEXT_PUBLIC_API_URL
    ? `${process.env.NEXT_PUBLIC_API_URL}/forecast`
    : 'http://localhost:8080/api/forecast';

  /**
   * Get cost forecast
   */
  async getForecast(period: string = '90d'): Promise<CostForecast> {
    // Return demo data if demo mode enabled
    if (demoModeService.isEnabled()) {
      return this.getDemoForecast();
    }

    const response = await fetch(`${this.baseUrl}?period=${period}`, {
      headers: {
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch forecast');
    }

    const data = await response.json();
    return this.transformForecast(data.forecast);
  }

  /**
   * Transform API response to proper types
   */
  private transformForecast(forecast: any): CostForecast {
    return {
      ...forecast,
      generatedAt: new Date(forecast.generatedAt),
      historicalStartDate: new Date(forecast.historicalStartDate),
      historicalEndDate: new Date(forecast.historicalEndDate),
      predictionStartDate: new Date(forecast.predictionStartDate),
      predictionEndDate: new Date(forecast.predictionEndDate),
      historicalData: forecast.historicalData.map((p: any) => ({
        ...p,
        date: new Date(p.date),
      })),
      predictions: forecast.predictions.map((p: any) => ({
        ...p,
        date: new Date(p.date),
      })),
    };
  }

  /**
   * Generate scenario
   */
  async generateScenario(
    type: ScenarioType,
    params: any
  ): Promise<Scenario> {
    // Return demo data if demo mode enabled
    if (demoModeService.isEnabled()) {
      return this.getDemoScenario(type, params);
    }

    const response = await fetch(`${this.baseUrl}/scenario`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${localStorage.getItem('token')}`,
      },
      body: JSON.stringify({ type, params }),
    });

    if (!response.ok) {
      throw new Error('Failed to generate scenario');
    }

    const data = await response.json();
    return this.transformScenario(data.scenario);
  }

  /**
   * Transform scenario response
   */
  private transformScenario(scenario: any): Scenario {
    return {
      ...scenario,
      createdAt: new Date(scenario.createdAt),
      predictions: scenario.predictions.map((p: any) => ({
        ...p,
        date: new Date(p.date),
      })),
    };
  }

  /**
   * Get demo forecast
   */
  private getDemoForecast(): CostForecast {
    const now = new Date();
    const historicalData: TimeSeriesPoint[] = [];
    const predictions: TimeSeriesPoint[] = [];

    // Generate 90 days historical data with realistic patterns
    for (let i = 90; i > 0; i--) {
      const date = new Date(now);
      date.setDate(date.getDate() - i);

      // Base daily cost
      const baseValue = 220;

      // Upward trend
      const trend = (90 - i) * 0.5;

      // Weekly seasonality (weekends lower)
      const dayOfWeek = date.getDay();
      const weekendFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? -15 : 0;

      // Random noise
      const noise = (Math.random() - 0.5) * 25;

      historicalData.push({
        date,
        value: Math.max(150, baseValue + trend + weekendFactor + noise),
        actual: true,
      });
    }

    // Generate 90 days predictions
    for (let i = 1; i <= 90; i++) {
      const date = new Date(now);
      date.setDate(date.getDate() + i);

      // Continue the trend
      const baseValue = 265;
      const trend = i * 0.6;

      // Weekly pattern
      const dayOfWeek = date.getDay();
      const weekendFactor = (dayOfWeek === 0 || dayOfWeek === 6) ? -12 : 0;

      predictions.push({
        date,
        value: baseValue + trend + weekendFactor,
        actual: false,
      });
    }

    // Calculate totals
    const predicted30Day = predictions.slice(0, 30).reduce((sum, p) => sum + p.value, 0);
    const predicted60Day = predictions.slice(0, 60).reduce((sum, p) => sum + p.value, 0);
    const predicted90Day = predictions.reduce((sum, p) => sum + p.value, 0);

    return {
      id: 'demo-forecast-' + Date.now(),
      organizationId: 'demo',
      generatedAt: now,

      historicalData,
      historicalStartDate: historicalData[0].date,
      historicalEndDate: historicalData[historicalData.length - 1].date,
      historicalAverage: 245,
      historicalTotal: 22050,

      predictions,
      predictionStartDate: predictions[0].date,
      predictionEndDate: predictions[predictions.length - 1].date,
      forecastPeriod: '90d',
      forecastMethod: 'ensemble',

      predicted30Day: Math.round(predicted30Day),
      predicted60Day: Math.round(predicted60Day),
      predicted90Day: Math.round(predicted90Day),
      predictedQuarter: Math.round(predicted90Day),
      predictedYear: Math.round(predicted90Day * 4),

      growthRate: 8.2,
      trend: 'increasing',
      seasonality: true,
      volatility: 23,

      confidence: 85,
      confidenceInterval: {
        lower: Math.round(predicted90Day * 0.92),
        upper: Math.round(predicted90Day * 1.08),
      },

      aiSummary: 'Your AWS costs are projected to grow at 8.2% over the next 90 days, reaching approximately $' + Math.round(predicted90Day).toLocaleString() + '. This growth is driven primarily by increased Lambda invocations and database usage. The forecast shows moderate volatility with 85% confidence. Weekend usage patterns show consistent 5-7% lower costs.',
      aiRisks: [
        'Growth rate of 8.2% could lead to budget overruns if unchecked',
        'Lambda costs showing accelerating growth pattern (+12% MoM)',
        'Database instance utilization approaching 75% capacity limits',
        'Increased API Gateway costs correlating with traffic growth',
      ],
      aiRecommendations: [
        'Set budget alerts at $' + Math.round(predicted90Day * 0.9).toLocaleString() + ' (90% of quarterly forecast)',
        'Review Lambda memory allocation - potential 20% savings identified',
        'Consider Reserved Instances for baseline RDS capacity',
        'Implement auto-scaling policies to control compute costs',
        'Evaluate Savings Plans for predictable workloads',
      ],

      modelVersion: '1.0.0',
    };
  }

  /**
   * Get demo scenario
   */
  private getDemoScenario(type: ScenarioType, params: any): Scenario {
    const baseline = 8235;
    let scenarioCost = baseline;
    let name = '';
    let description = '';
    let aiAnalysis = '';
    let aiRecommendations: string[] = [];

    switch (type) {
      case 'traffic_2x':
        scenarioCost = baseline * (params.trafficMultiplier || 2);
        name = `${params.trafficMultiplier || 2}x Traffic Increase`;
        description = `Simulates impact of ${params.trafficMultiplier || 2}x increase in traffic/usage`;
        aiAnalysis = `Doubling traffic would increase your monthly AWS costs by $${(scenarioCost - baseline).toLocaleString()} (${((scenarioCost / baseline - 1) * 100).toFixed(1)}%). The cost increase is not linear due to tiered pricing and reserved capacity already in place.`;
        aiRecommendations = [
          'Pre-purchase Reserved Instances before scaling to reduce per-unit costs',
          'Review auto-scaling policies to handle increased load efficiently',
          'Consider implementing caching to reduce database and API calls',
          'Evaluate CDN coverage to offload static content delivery',
        ];
        break;

      case 'traffic_half':
        scenarioCost = baseline * 0.5;
        name = '50% Traffic Reduction';
        description = 'Simulates 50% reduction in traffic (downtime or scaling down)';
        aiAnalysis = `Reducing traffic by 50% would decrease costs by $${(baseline - scenarioCost).toLocaleString()} (50%). Note that some fixed costs (Reserved Instances, baseline infrastructure) will remain regardless of traffic.`;
        aiRecommendations = [
          'Review Reserved Instance commitments for potential modifications',
          'Consider converting to On-Demand instances for variable workloads',
          'Evaluate downsizing RDS instances during low-traffic periods',
        ];
        break;

      case 'new_service':
        const newCost = params.newServiceCost || 1000;
        scenarioCost = baseline + newCost;
        name = `New Service (+$${newCost.toLocaleString()}/mo)`;
        description = `Adding new service with $${newCost.toLocaleString()}/month cost`;
        aiAnalysis = `Adding this new service would increase monthly costs by $${newCost.toLocaleString()} (${((newCost / baseline) * 100).toFixed(1)}% increase). This brings total monthly spend to $${scenarioCost.toLocaleString()}.`;
        aiRecommendations = [
          'Set up dedicated cost allocation tags for the new service',
          'Configure budget alerts at $' + Math.round(newCost * 1.1) + '/month for the service',
          'Review architecture for cost optimization before deployment',
          'Consider spot instances or Savings Plans for predictable workloads',
        ];
        break;

      case 'optimization':
        const savings = params.optimizationSavings || 500;
        scenarioCost = baseline - savings;
        name = `Cost Optimization (-$${savings.toLocaleString()}/mo)`;
        description = `Applying cost optimizations saving $${savings.toLocaleString()}/month`;
        aiAnalysis = `Implementing these optimizations would save $${savings.toLocaleString()}/month ($${(savings * 12).toLocaleString()}/year). This represents a ${((savings / baseline) * 100).toFixed(1)}% reduction in your AWS spend.`;
        aiRecommendations = [
          'Implement optimizations in phases to measure actual impact',
          'Monitor performance metrics to ensure no degradation',
          'Document savings for ROI reporting to leadership',
          'Set up automated alerts if costs increase after optimization',
        ];
        break;

      case 'custom':
        const adjustment = params.customAdjustment || 0;
        scenarioCost = baseline * (1 + adjustment / 100);
        name = `Custom Adjustment (${adjustment > 0 ? '+' : ''}${adjustment}%)`;
        description = `Custom cost adjustment of ${adjustment}%`;
        aiAnalysis = `A ${adjustment}% adjustment would ${adjustment > 0 ? 'increase' : 'decrease'} monthly costs by $${Math.abs(scenarioCost - baseline).toLocaleString()}.`;
        aiRecommendations = [
          'Monitor implementation closely',
          'Set appropriate budget alerts',
          'Review cost impact after 30 days',
        ];
        break;

      default:
        name = 'Baseline Forecast';
        description = 'Current trajectory without changes';
        aiAnalysis = 'This represents your current cost trajectory based on historical patterns.';
        aiRecommendations = ['Continue monitoring costs regularly'];
    }

    const costDelta = scenarioCost - baseline;
    const costDeltaPercent = (costDelta / baseline) * 100;

    return {
      id: 'demo-scenario-' + Date.now(),
      organizationId: 'demo',
      type,
      name,
      description,

      trafficMultiplier: params.trafficMultiplier,
      newServiceCost: params.newServiceCost,
      optimizationSavings: params.optimizationSavings,
      customAdjustment: params.customAdjustment,

      baselineCost: baseline,
      scenarioCost: Math.round(scenarioCost),
      costDelta: Math.round(costDelta),
      costDeltaPercent,

      predictions: [],
      predicted30Day: Math.round(scenarioCost),
      predicted90Day: Math.round(scenarioCost * 3),

      aiAnalysis,
      aiRecommendations,

      createdAt: new Date(),
    };
  }
}

export const forecastService = new ForecastService();
