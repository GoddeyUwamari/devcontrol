import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { CostForecast, TimeSeriesPoint, ForecastPeriod } from '../types/forecast.types';
import { ForecastMLService } from './forecast-ml.service';

export class CostForecastService {
  private mlService: ForecastMLService;

  constructor(private pool: Pool) {
    this.mlService = new ForecastMLService();
  }

  /**
   * Generate cost forecast for organization
   */
  async generateForecast(
    organizationId: string,
    period: ForecastPeriod = '90d'
  ): Promise<CostForecast> {
    console.log(`[Cost Forecast] Generating forecast for org ${organizationId}...`);

    // Get historical cost data (last 90 days)
    const historicalData = await this.getHistoricalCosts(organizationId, 90);

    if (historicalData.length < 7) {
      throw new Error('Need at least 7 days of historical data for forecasting');
    }

    // Determine forecast days
    const forecastDays = this.getForecastDays(period);

    // Generate ML predictions
    const { predictions, confidence, confidenceInterval } =
      this.mlService.generateForecast(historicalData, forecastDays, 'ensemble');

    // Calculate metrics
    const growthRate = this.mlService.calculateGrowthRate(historicalData);
    const trend = this.mlService.detectTrend(historicalData);
    const volatility = this.mlService.calculateVolatility(historicalData);

    // Calculate specific period predictions
    const predicted30Day = this.sumPredictions(predictions.slice(0, 30));
    const predicted60Day = this.sumPredictions(predictions.slice(0, 60));
    const predicted90Day = this.sumPredictions(predictions.slice(0, 90));
    const predictedQuarter = this.sumPredictions(predictions.slice(0, 90));
    const predictedYear = predicted90Day * 4; // Rough estimate

    // Historical stats
    const historicalTotal = historicalData.reduce((sum, p) => sum + p.value, 0);
    const historicalAverage = historicalTotal / historicalData.length;

    const forecast: CostForecast = {
      id: uuidv4(),
      organizationId,
      generatedAt: new Date(),

      historicalData,
      historicalStartDate: historicalData[0].date,
      historicalEndDate: historicalData[historicalData.length - 1].date,
      historicalAverage,
      historicalTotal,

      predictions,
      predictionStartDate: predictions[0].date,
      predictionEndDate: predictions[predictions.length - 1].date,
      forecastPeriod: period,
      forecastMethod: 'ensemble',

      predicted30Day,
      predicted60Day,
      predicted90Day,
      predictedQuarter,
      predictedYear,

      growthRate,
      trend,
      seasonality: false, // Would need more sophisticated analysis
      volatility,

      confidence,
      confidenceInterval,

      aiSummary: '', // Will be filled by AI service
      aiRisks: [],
      aiRecommendations: [],

      modelVersion: '1.0.0',
    };

    console.log(`[Cost Forecast] Forecast generated: ${predicted30Day.toFixed(2)} (30d)`);
    return forecast;
  }

  /**
   * Get historical cost data
   */
  private async getHistoricalCosts(
    organizationId: string,
    days: number
  ): Promise<TimeSeriesPoint[]> {
    // In production, this would query a time-series database or aggregated cost data
    // For now, we'll aggregate from aws_resources with estimated costs

    const query = `
      SELECT
        DATE(created_at) as date,
        SUM((tags->>'estimated_monthly_cost')::numeric / 30) as daily_cost
      FROM aws_resources
      WHERE organization_id = $1
        AND created_at >= NOW() - INTERVAL '${days} days'
        AND tags->>'estimated_monthly_cost' IS NOT NULL
      GROUP BY DATE(created_at)
      ORDER BY date ASC
    `;

    try {
      const result = await this.pool.query(query, [organizationId]);

      const dataPoints: TimeSeriesPoint[] = result.rows.map(row => ({
        date: new Date(row.date),
        value: parseFloat(row.daily_cost || 0),
        actual: true,
      }));

      // If we don't have daily data, fill gaps with interpolation
      if (dataPoints.length < days && dataPoints.length > 0) {
        return this.fillGaps(dataPoints, days);
      }

      return dataPoints;
    } catch (error) {
      console.error('[Cost Forecast] Error fetching historical costs:', error);
      return [];
    }
  }

  /**
   * Fill gaps in time series data
   */
  private fillGaps(data: TimeSeriesPoint[], targetDays: number): TimeSeriesPoint[] {
    if (data.length === 0) return [];

    const filled: TimeSeriesPoint[] = [];
    const startDate = new Date(data[0].date);
    const avgValue = data.reduce((sum, p) => sum + p.value, 0) / data.length;

    for (let i = 0; i < targetDays; i++) {
      const date = new Date(startDate);
      date.setDate(date.getDate() + i);

      // Find actual data for this date
      const actual = data.find(p =>
        p.date.toDateString() === date.toDateString()
      );

      filled.push(actual || { date, value: avgValue, actual: true });
    }

    return filled;
  }

  /**
   * Sum predictions for a period
   */
  private sumPredictions(predictions: TimeSeriesPoint[]): number {
    return predictions.reduce((sum, p) => sum + p.value, 0);
  }

  /**
   * Get forecast days from period
   */
  private getForecastDays(period: ForecastPeriod): number {
    switch (period) {
      case '30d': return 30;
      case '60d': return 60;
      case '90d': return 90;
      case 'quarter': return 90;
      case 'year': return 365;
      default: return 90;
    }
  }
}
