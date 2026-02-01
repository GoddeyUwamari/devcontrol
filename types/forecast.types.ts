// Cost Forecasting Types
export type ForecastPeriod = '30d' | '60d' | '90d' | 'quarter' | 'year';
export type ForecastMethod = 'linear_regression' | 'moving_average' | 'exponential_smoothing' | 'ensemble';
export type ScenarioType = 'baseline' | 'traffic_2x' | 'traffic_half' | 'new_service' | 'optimization' | 'custom';

export interface TimeSeriesPoint {
  date: Date;
  value: number;
  actual?: boolean;
}

export interface CostForecast {
  id: string;
  organizationId: string;
  generatedAt: Date;

  // Historical data
  historicalData: TimeSeriesPoint[];
  historicalStartDate: Date;
  historicalEndDate: Date;
  historicalAverage: number;
  historicalTotal: number;

  // Predictions
  predictions: TimeSeriesPoint[];
  predictionStartDate: Date;
  predictionEndDate: Date;
  forecastPeriod: ForecastPeriod;
  forecastMethod: ForecastMethod;

  // Forecast values
  predicted30Day: number;
  predicted60Day: number;
  predicted90Day: number;
  predictedQuarter: number;
  predictedYear: number;

  // Trend analysis
  growthRate: number;
  trend: 'increasing' | 'decreasing' | 'stable';
  seasonality: boolean;
  volatility: number;

  // Confidence
  confidence: number;
  confidenceInterval: {
    lower: number;
    upper: number;
  };

  // AI insights
  aiSummary: string;
  aiRisks: string[];
  aiRecommendations: string[];

  // Model info
  accuracy?: number;
  modelVersion: string;
}

export interface Scenario {
  id: string;
  organizationId: string;
  type: ScenarioType;
  name: string;
  description: string;

  // Scenario parameters
  trafficMultiplier?: number;
  newServiceCost?: number;
  optimizationSavings?: number;
  customAdjustment?: number;

  // Cost comparison
  baselineCost: number;
  scenarioCost: number;
  costDelta: number;
  costDeltaPercent: number;

  // Predictions
  predictions: TimeSeriesPoint[];
  predicted30Day: number;
  predicted90Day: number;

  // AI analysis
  aiAnalysis: string;
  aiRecommendations: string[];

  createdAt: Date;
}
