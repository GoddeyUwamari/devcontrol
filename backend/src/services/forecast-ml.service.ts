import { TimeSeriesPoint, ForecastMethod } from '../types/forecast.types';

export class ForecastMLService {
  /**
   * Generate forecast using multiple ML methods and ensemble
   */
  generateForecast(
    historicalData: TimeSeriesPoint[],
    forecastDays: number,
    method: ForecastMethod = 'ensemble'
  ): {
    predictions: TimeSeriesPoint[];
    confidence: number;
    confidenceInterval: { lower: number; upper: number };
  } {
    if (historicalData.length < 7) {
      throw new Error('Need at least 7 days of historical data for forecasting');
    }

    let predictions: TimeSeriesPoint[];
    let confidence: number;

    switch (method) {
      case 'linear_regression':
        predictions = this.linearRegression(historicalData, forecastDays);
        confidence = 75;
        break;
      case 'moving_average':
        predictions = this.movingAverage(historicalData, forecastDays);
        confidence = 70;
        break;
      case 'exponential_smoothing':
        predictions = this.exponentialSmoothing(historicalData, forecastDays);
        confidence = 80;
        break;
      case 'ensemble':
      default:
        predictions = this.ensemble(historicalData, forecastDays);
        confidence = 85;
        break;
    }

    const confidenceInterval = this.calculateConfidenceInterval(
      historicalData,
      predictions
    );

    return { predictions, confidence, confidenceInterval };
  }

  /**
   * Linear Regression Forecasting
   */
  private linearRegression(
    historicalData: TimeSeriesPoint[],
    forecastDays: number
  ): TimeSeriesPoint[] {
    const n = historicalData.length;
    const values = historicalData.map(p => p.value);

    // Calculate linear regression coefficients
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    for (let i = 0; i < n; i++) {
      sumX += i;
      sumY += values[i];
      sumXY += i * values[i];
      sumXX += i * i;
    }

    const slope = (n * sumXY - sumX * sumY) / (n * sumXX - sumX * sumX);
    const intercept = (sumY - slope * sumX) / n;

    // Generate predictions
    const predictions: TimeSeriesPoint[] = [];
    const lastDate = new Date(historicalData[historicalData.length - 1].date);

    for (let i = 1; i <= forecastDays; i++) {
      const predictedValue = intercept + slope * (n + i - 1);
      const date = new Date(lastDate);
      date.setDate(date.getDate() + i);

      predictions.push({
        date,
        value: Math.max(0, predictedValue), // Ensure non-negative
        actual: false,
      });
    }

    return predictions;
  }

  /**
   * Moving Average Forecasting
   */
  private movingAverage(
    historicalData: TimeSeriesPoint[],
    forecastDays: number,
    window: number = 7
  ): TimeSeriesPoint[] {
    const values = historicalData.map(p => p.value);
    const lastDate = new Date(historicalData[historicalData.length - 1].date);

    // Calculate moving average of last N days
    const recentValues = values.slice(-window);
    const average = recentValues.reduce((a, b) => a + b, 0) / recentValues.length;

    // Calculate trend from last 2 windows
    const prevWindow = values.slice(-window * 2, -window);
    const prevAverage = prevWindow.reduce((a, b) => a + b, 0) / prevWindow.length;
    const trend = (average - prevAverage) / window;

    // Generate predictions
    const predictions: TimeSeriesPoint[] = [];

    for (let i = 1; i <= forecastDays; i++) {
      const predictedValue = average + (trend * i);
      const date = new Date(lastDate);
      date.setDate(date.getDate() + i);

      predictions.push({
        date,
        value: Math.max(0, predictedValue),
        actual: false,
      });
    }

    return predictions;
  }

  /**
   * Exponential Smoothing Forecasting
   */
  private exponentialSmoothing(
    historicalData: TimeSeriesPoint[],
    forecastDays: number,
    alpha: number = 0.3,
    beta: number = 0.1
  ): TimeSeriesPoint[] {
    const values = historicalData.map(p => p.value);
    const n = values.length;

    // Initialize level and trend
    let level = values[0];
    let trend = (values[n - 1] - values[0]) / n;

    // Apply exponential smoothing
    for (let i = 1; i < n; i++) {
      const prevLevel = level;
      level = alpha * values[i] + (1 - alpha) * (level + trend);
      trend = beta * (level - prevLevel) + (1 - beta) * trend;
    }

    // Generate predictions
    const predictions: TimeSeriesPoint[] = [];
    const lastDate = new Date(historicalData[historicalData.length - 1].date);

    for (let i = 1; i <= forecastDays; i++) {
      const predictedValue = level + (trend * i);
      const date = new Date(lastDate);
      date.setDate(date.getDate() + i);

      predictions.push({
        date,
        value: Math.max(0, predictedValue),
        actual: false,
      });
    }

    return predictions;
  }

  /**
   * Ensemble Method (combines multiple methods)
   */
  private ensemble(
    historicalData: TimeSeriesPoint[],
    forecastDays: number
  ): TimeSeriesPoint[] {
    const lr = this.linearRegression(historicalData, forecastDays);
    const ma = this.movingAverage(historicalData, forecastDays);
    const es = this.exponentialSmoothing(historicalData, forecastDays);

    // Weighted average (ES gets higher weight as it's often more accurate)
    const weights = { lr: 0.25, ma: 0.25, es: 0.50 };

    const predictions: TimeSeriesPoint[] = [];

    for (let i = 0; i < forecastDays; i++) {
      const value =
        lr[i].value * weights.lr +
        ma[i].value * weights.ma +
        es[i].value * weights.es;

      predictions.push({
        date: lr[i].date,
        value: Math.max(0, value),
        actual: false,
      });
    }

    return predictions;
  }

  /**
   * Calculate confidence intervals
   */
  private calculateConfidenceInterval(
    historicalData: TimeSeriesPoint[],
    predictions: TimeSeriesPoint[]
  ): { lower: number; upper: number } {
    const values = historicalData.map(p => p.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    // Calculate standard deviation
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);

    // 95% confidence interval (1.96 * stdDev)
    const margin = 1.96 * stdDev;

    const avgPrediction = predictions.reduce((sum, p) => sum + p.value, 0) / predictions.length;

    return {
      lower: Math.max(0, avgPrediction - margin),
      upper: avgPrediction + margin,
    };
  }

  /**
   * Detect trend direction
   */
  detectTrend(data: TimeSeriesPoint[]): 'increasing' | 'decreasing' | 'stable' {
    if (data.length < 7) return 'stable';

    const firstHalf = data.slice(0, Math.floor(data.length / 2));
    const secondHalf = data.slice(Math.floor(data.length / 2));

    const firstAvg = firstHalf.reduce((sum, p) => sum + p.value, 0) / firstHalf.length;
    const secondAvg = secondHalf.reduce((sum, p) => sum + p.value, 0) / secondHalf.length;

    const change = ((secondAvg - firstAvg) / firstAvg) * 100;

    if (change > 5) return 'increasing';
    if (change < -5) return 'decreasing';
    return 'stable';
  }

  /**
   * Calculate growth rate
   */
  calculateGrowthRate(data: TimeSeriesPoint[]): number {
    if (data.length < 7) return 0;

    const firstWeek = data.slice(0, 7);
    const lastWeek = data.slice(-7);

    const firstAvg = firstWeek.reduce((sum, p) => sum + p.value, 0) / 7;
    const lastAvg = lastWeek.reduce((sum, p) => sum + p.value, 0) / 7;

    return ((lastAvg - firstAvg) / firstAvg) * 100;
  }

  /**
   * Calculate volatility score (0-100)
   */
  calculateVolatility(data: TimeSeriesPoint[]): number {
    if (data.length < 7) return 0;

    const values = data.map(p => p.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;

    // Calculate coefficient of variation
    const variance = values.reduce((sum, val) => sum + Math.pow(val - mean, 2), 0) / values.length;
    const stdDev = Math.sqrt(variance);
    const coefficientOfVariation = (stdDev / mean) * 100;

    // Convert to 0-100 scale (cap at 100)
    return Math.min(100, coefficientOfVariation);
  }
}
