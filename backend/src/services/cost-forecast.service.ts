import { Pool } from 'pg';
import { randomUUID } from 'crypto';
import { CostForecast, TimeSeriesPoint, ForecastPeriod } from '../types/forecast.types';
import { ForecastMLService } from './forecast-ml.service';
import awsCostService from './aws-cost.service';

/** The forecast needs at least this many days AWS Cost Explorer has finished reporting. */
export const MIN_FINISHED_FORECAST_DAYS = 7;

/**
 * Fewer finished days than MIN_FINISHED_FORECAST_DAYS (a newly connected
 * account): not a failure, so the API answers with this state instead of a
 * server error (review R3-L4). Filled gap days are estimates and do not count.
 */
export class InsufficientForecastHistoryError extends Error {
  readonly code = 'INSUFFICIENT_FORECAST_HISTORY';
  constructor(readonly finishedDays: number, readonly requiredDays: number = MIN_FINISHED_FORECAST_DAYS) {
    super(`Need at least ${requiredDays} finished days of cost history for forecasting (have ${finishedDays})`);
    this.name = 'InsufficientForecastHistoryError';
  }
}

/** YYYY-MM-DD (UTC) of a date. */
const utcDay = (d: Date) => d.toISOString().slice(0, 10);

/** Whole UTC days from `from` to `to` (both YYYY-MM-DD); negative when `to` is earlier. */
const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

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
    period: ForecastPeriod = '90d',
    now: Date = new Date()
  ): Promise<CostForecast> {
    console.log(`[Cost Forecast] Generating forecast for org ${organizationId}...`);

    // Get historical cost data (last 90 days): finished days, plus estimated gap fills between them.
    const historicalData = await this.getHistoricalCosts(organizationId, 90);

    const finishedDays = historicalData.filter(p => p.actual !== false).length;
    if (finishedDays < MIN_FINISHED_FORECAST_DAYS) {
      throw new InsufficientForecastHistoryError(finishedDays);
    }

    // Determine forecast days
    const forecastDays = this.getForecastDays(period);

    // History ends on the last FINISHED day (review L-2), a few days before
    // today. The days in between are predicted too (they continue the line),
    // but every period total starts at today (UTC): "next 30 days" is today
    // .. today+29, not a window that began days ago (review R3-L3).
    const today = utcDay(now);
    const lead = Math.max(0, daysBetween(utcDay(historicalData[historicalData.length - 1].date), today) - 1);

    // Generate ML predictions
    const { predictions, confidence, confidenceInterval } =
      this.mlService.generateForecast(historicalData, forecastDays + lead, 'ensemble');
    const ahead = predictions.slice(lead);

    // Calculate metrics
    const growthRate = this.mlService.calculateGrowthRate(historicalData);
    const trend = this.mlService.detectTrend(historicalData);
    const volatility = this.mlService.calculateVolatility(historicalData);

    // Calculate specific period predictions, from today
    const predicted30Day = this.sumPredictions(ahead.slice(0, 30));
    const predicted60Day = this.sumPredictions(ahead.slice(0, 60));
    const predicted90Day = this.sumPredictions(ahead.slice(0, 90));
    const predictedQuarter = this.sumPredictions(ahead.slice(0, 90));
    const predictedYear = predicted90Day * 4; // Rough estimate

    // Historical stats
    const historicalTotal = historicalData.reduce((sum, p) => sum + p.value, 0);
    const historicalAverage = historicalTotal / historicalData.length;

    const forecast: CostForecast = {
      id: randomUUID(),
      organizationId,
      generatedAt: new Date(),

      historicalData,
      historicalStartDate: historicalData[0].date,
      historicalEndDate: historicalData[historicalData.length - 1].date,
      historicalAverage,
      historicalTotal,

      predictions,
      predictionStartDate: predictions[0].date,
      forecastStartDate: new Date(`${today}T00:00:00.000Z`),
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
   * Get historical daily cost data from AWS Cost Explorer (via AWSCostService.fetchCostTrend),
   * the same live source that powers the dashboard's real cost trend chart. aws_resources
   * has no reliable daily-cost time series — created_at is a one-time discovery timestamp,
   * not a rolling cost date, so grouping by it never produced usable history.
   */
  private async getHistoricalCosts(
    organizationId: string,
    days: number
  ): Promise<TimeSeriesPoint[]> {
    const range = days <= 7 ? '7d' : days <= 30 ? '30d' : '90d';

    // A failed Cost Explorer read propagates (the forecast fails as an
    // error), so it is never mistaken for "not enough finished days yet".
    const trend = await awsCostService.fetchCostTrend(organizationId, range);

    // Final days only (review L-2): a day Cost Explorer has not reported yet
    // is not a $0 day of history, and a day it is still updating is a partial
    // amount. Points from a backend without reportState count as final.
    const dataPoints: TimeSeriesPoint[] = trend.filter(point => (point.reportState ?? 'final') === 'final').map(point => ({
      date: new Date(point.date),
      value: point.total,
      actual: true,
    }));

    // Fewer final days than requested (e.g. account newly connected): fill
    // the gaps BETWEEN real days only, labelled as estimates (fillGaps).
    if (dataPoints.length < days && dataPoints.length > 0) {
      return this.fillGaps(dataPoints, days);
    }

    return dataPoints;
  }

  /**
   * Fill the missing UTC days between the first and the last real day with the
   * real days' average, labelled `actual: false` (an estimate, never actual
   * spend: review L-2). Never extends past the last real day, so the days
   * Cost Explorer has not finished (dropped above) are not invented.
   */
  private fillGaps(data: TimeSeriesPoint[], targetDays: number): TimeSeriesPoint[] {
    if (data.length === 0) return [];

    const dayKey = (d: Date) => d.toISOString().slice(0, 10);
    const byDay = new Map(data.map(p => [dayKey(p.date), p]));
    const avgValue = data.reduce((sum, p) => sum + p.value, 0) / data.length;
    const first = data[0].date.getTime();
    const last = data[data.length - 1].date.getTime();

    const filled: TimeSeriesPoint[] = [];
    for (let i = 0; i < targetDays; i++) {
      const date = new Date(first + i * 86_400_000);
      if (date.getTime() > last) break;
      filled.push(byDay.get(dayKey(date)) ?? { date, value: avgValue, actual: false });
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
