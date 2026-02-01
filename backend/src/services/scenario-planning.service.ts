import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { Scenario, ScenarioType, TimeSeriesPoint } from '../types/forecast.types';
import { CostForecastService } from './cost-forecast.service';

export class ScenarioPlanningService {
  private forecastService: CostForecastService;

  constructor(private pool: Pool) {
    this.forecastService = new CostForecastService(pool);
  }

  /**
   * Generate scenario forecast
   */
  async generateScenario(
    organizationId: string,
    type: ScenarioType,
    params: {
      trafficMultiplier?: number;
      newServiceCost?: number;
      optimizationSavings?: number;
      customAdjustment?: number;
    }
  ): Promise<Scenario> {
    console.log(`[Scenario Planning] Generating ${type} scenario...`);

    // Get baseline forecast
    const baseline = await this.forecastService.generateForecast(organizationId, '90d');

    // Apply scenario adjustments
    const scenarioPredictions = this.applyScenario(baseline.predictions, type, params);

    const baselineCost = baseline.predicted30Day;
    const scenarioCost = scenarioPredictions.slice(0, 30).reduce((sum, p) => sum + p.value, 0);
    const costDelta = scenarioCost - baselineCost;
    const costDeltaPercent = (costDelta / baselineCost) * 100;

    const scenario: Scenario = {
      id: uuidv4(),
      organizationId,
      type,
      name: this.getScenarioName(type, params),
      description: this.getScenarioDescription(type, params),

      trafficMultiplier: params.trafficMultiplier,
      newServiceCost: params.newServiceCost,
      optimizationSavings: params.optimizationSavings,
      customAdjustment: params.customAdjustment,

      baselineCost,
      scenarioCost,
      costDelta,
      costDeltaPercent,

      predictions: scenarioPredictions,
      predicted30Day: scenarioCost,
      predicted90Day: scenarioPredictions.reduce((sum, p) => sum + p.value, 0),

      aiAnalysis: this.getScenarioAnalysis(type, costDelta, costDeltaPercent),
      aiRecommendations: this.getScenarioRecommendations(type, costDelta),

      createdAt: new Date(),
    };

    console.log(`[Scenario Planning] ${type}: ${costDeltaPercent.toFixed(1)}% cost change`);
    return scenario;
  }

  /**
   * Apply scenario adjustments to predictions
   */
  private applyScenario(
    predictions: TimeSeriesPoint[],
    type: ScenarioType,
    params: any
  ): TimeSeriesPoint[] {
    switch (type) {
      case 'traffic_2x':
        return predictions.map(p => ({
          ...p,
          value: p.value * (params.trafficMultiplier || 2),
        }));

      case 'traffic_half':
        return predictions.map(p => ({
          ...p,
          value: p.value * 0.5,
        }));

      case 'new_service':
        const dailyServiceCost = (params.newServiceCost || 0) / 30;
        return predictions.map(p => ({
          ...p,
          value: p.value + dailyServiceCost,
        }));

      case 'optimization':
        const dailySavings = (params.optimizationSavings || 0) / 30;
        return predictions.map(p => ({
          ...p,
          value: Math.max(0, p.value - dailySavings),
        }));

      case 'custom':
        return predictions.map(p => ({
          ...p,
          value: p.value * (1 + (params.customAdjustment || 0) / 100),
        }));

      case 'baseline':
      default:
        return predictions;
    }
  }

  /**
   * Get scenario name
   */
  private getScenarioName(type: ScenarioType, params: any): string {
    switch (type) {
      case 'traffic_2x':
        return `${params.trafficMultiplier || 2}x Traffic Increase`;
      case 'traffic_half':
        return '50% Traffic Reduction';
      case 'new_service':
        return `New Service ($${params.newServiceCost}/mo)`;
      case 'optimization':
        return `Cost Optimization (-$${params.optimizationSavings}/mo)`;
      case 'custom':
        return `Custom Adjustment (${params.customAdjustment > 0 ? '+' : ''}${params.customAdjustment}%)`;
      default:
        return 'Baseline Forecast';
    }
  }

  /**
   * Get scenario description
   */
  private getScenarioDescription(type: ScenarioType, params: any): string {
    switch (type) {
      case 'traffic_2x':
        return `Simulates impact of ${params.trafficMultiplier || 2}x increase in traffic/usage`;
      case 'traffic_half':
        return 'Simulates 50% reduction in traffic (downtime or scaling down)';
      case 'new_service':
        return `Adding new service with $${params.newServiceCost}/month cost`;
      case 'optimization':
        return `Applying cost optimizations saving $${params.optimizationSavings}/month`;
      case 'custom':
        return `Custom cost adjustment of ${params.customAdjustment}%`;
      default:
        return 'Current trajectory without changes';
    }
  }

  /**
   * Get scenario analysis
   */
  private getScenarioAnalysis(type: ScenarioType, costDelta: number, costDeltaPercent: number): string {
    const change = costDelta > 0 ? 'increase' : 'decrease';
    const abs = Math.abs(costDelta);

    return `This scenario would ${change} your monthly AWS costs by $${abs.toFixed(2)} (${Math.abs(costDeltaPercent).toFixed(1)}%). ${this.getImpactStatement(type, costDelta)}`;
  }

  /**
   * Get impact statement
   */
  private getImpactStatement(type: ScenarioType, costDelta: number): string {
    if (type === 'traffic_2x' && costDelta > 0) {
      return 'Consider Reserved Instances or Savings Plans to reduce the impact of scaling.';
    }
    if (type === 'optimization' && costDelta < 0) {
      return 'These optimizations could significantly reduce your infrastructure costs.';
    }
    if (type === 'new_service') {
      return 'Plan budget accordingly for this new infrastructure component.';
    }
    return '';
  }

  /**
   * Get scenario recommendations
   */
  private getScenarioRecommendations(type: ScenarioType, costDelta: number): string[] {
    const recs: string[] = [];

    if (type === 'traffic_2x') {
      recs.push('Review auto-scaling policies to handle increased load efficiently');
      recs.push('Consider Reserved Instances to reduce costs at higher scale');
      recs.push('Implement caching strategies to minimize compute requirements');
    }

    if (type === 'new_service') {
      recs.push('Set up budget alerts for the new service');
      recs.push('Monitor actual costs vs. estimates in first month');
      recs.push('Consider spot instances for non-critical workloads');
    }

    if (type === 'optimization') {
      recs.push('Implement optimizations in phases to measure impact');
      recs.push('Monitor performance metrics to ensure no degradation');
      recs.push('Document savings for ROI reporting');
    }

    return recs.length > 0 ? recs : ['Monitor costs closely during implementation'];
  }
}
