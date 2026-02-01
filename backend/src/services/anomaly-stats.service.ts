import { TimeSeriesDataPoint } from '../types/anomaly.types';

export class AnomalyStatsService {
  /**
   * Calculate z-score for anomaly detection
   * Z-score > 2 = moderate anomaly (95th percentile)
   * Z-score > 3 = severe anomaly (99.7th percentile)
   */
  calculateZScore(
    currentValue: number,
    mean: number,
    stdDev: number
  ): number {
    if (stdDev === 0) return 0;
    return Math.abs(currentValue - mean) / stdDev;
  }

  /**
   * Calculate moving average
   */
  calculateMovingAverage(
    data: TimeSeriesDataPoint[],
    windowSize: number
  ): number {
    if (data.length < windowSize) return 0;

    const recentData = data.slice(-windowSize);
    const sum = recentData.reduce((acc, point) => acc + point.value, 0);
    return sum / windowSize;
  }

  /**
   * Calculate standard deviation
   */
  calculateStdDev(data: TimeSeriesDataPoint[]): number {
    if (data.length < 2) return 0;

    const values = data.map(d => d.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((acc, val) => acc + Math.pow(val - mean, 2), 0) / values.length;
    return Math.sqrt(variance);
  }

  /**
   * Detect if current value is anomalous
   */
  isAnomaly(
    currentValue: number,
    historicalData: TimeSeriesDataPoint[],
    sensitivity: 'low' | 'medium' | 'high' = 'medium'
  ): {
    isAnomaly: boolean;
    zScore: number;
    mean: number;
    stdDev: number;
    deviation: number;
  } {
    if (historicalData.length < 10) {
      return {
        isAnomaly: false,
        zScore: 0,
        mean: 0,
        stdDev: 0,
        deviation: 0,
      };
    }

    const values = historicalData.map(d => d.value);
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const stdDev = this.calculateStdDev(historicalData);
    const zScore = this.calculateZScore(currentValue, mean, stdDev);

    // Sensitivity thresholds
    const thresholds = {
      low: 3.5,    // 99.95th percentile - very rare
      medium: 2.5, // 98.76th percentile - rare
      high: 2.0,   // 97.72th percentile - uncommon
    };

    const deviation = mean !== 0 ? ((currentValue - mean) / mean) * 100 : 0;

    return {
      isAnomaly: zScore > thresholds[sensitivity],
      zScore,
      mean,
      stdDev,
      deviation,
    };
  }

  /**
   * Detect percentage change anomalies (simpler method)
   */
  isPercentageAnomaly(
    currentValue: number,
    previousValue: number,
    thresholdPercent: number = 30
  ): {
    isAnomaly: boolean;
    percentChange: number;
  } {
    if (previousValue === 0) {
      return {
        isAnomaly: currentValue > 0,
        percentChange: currentValue > 0 ? 100 : 0,
      };
    }

    const percentChange = ((currentValue - previousValue) / previousValue) * 100;

    return {
      isAnomaly: Math.abs(percentChange) > thresholdPercent,
      percentChange,
    };
  }

  /**
   * Detect trend anomalies (sudden changes in trend)
   */
  detectTrendChange(
    data: TimeSeriesDataPoint[],
    windowSize: number = 10
  ): {
    hasTrendChange: boolean;
    currentTrend: 'increasing' | 'decreasing' | 'stable';
    trendStrength: number; // 0-1
  } {
    if (data.length < windowSize * 2) {
      return {
        hasTrendChange: false,
        currentTrend: 'stable',
        trendStrength: 0,
      };
    }

    // Compare recent trend to historical trend
    const recentData = data.slice(-windowSize);
    const historicalData = data.slice(-windowSize * 2, -windowSize);

    const recentSlope = this.calculateSlope(recentData);
    const historicalSlope = this.calculateSlope(historicalData);

    const trendChange = Math.abs(recentSlope - historicalSlope);
    const hasTrendChange = trendChange > 0.5; // Configurable threshold

    let currentTrend: 'increasing' | 'decreasing' | 'stable' = 'stable';
    if (recentSlope > 0.1) currentTrend = 'increasing';
    if (recentSlope < -0.1) currentTrend = 'decreasing';

    return {
      hasTrendChange,
      currentTrend,
      trendStrength: Math.abs(recentSlope),
    };
  }

  /**
   * Calculate slope (linear regression)
   */
  private calculateSlope(data: TimeSeriesDataPoint[]): number {
    if (data.length < 2) return 0;

    const n = data.length;
    let sumX = 0, sumY = 0, sumXY = 0, sumXX = 0;

    data.forEach((point, index) => {
      sumX += index;
      sumY += point.value;
      sumXY += index * point.value;
      sumXX += index * index;
    });

    const denominator = n * sumXX - sumX * sumX;
    if (denominator === 0) return 0;

    const slope = (n * sumXY - sumX * sumY) / denominator;
    return slope;
  }
}
