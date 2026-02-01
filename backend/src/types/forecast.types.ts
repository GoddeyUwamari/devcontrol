export type ForecastPeriod = '30d' | '60d' | '90d' | 'quarter' | 'year';
export type ForecastMethod = 'linear_regression' | 'moving_average' | 'exponential_smoothing' | 'ensemble';
export type ScenarioType = 'baseline' | 'traffic_2x' | 'traffic_half' | 'new_service' | 'optimization' | 'custom';

export interface TimeSeriesPoint {
  date: Date;
  value: number;
  actual?: boolean; // true for historical data, false for predictions
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

  // Forecast results
  predicted30Day: number;
  predicted60Day: number;
  predicted90Day: number;
  predictedQuarter: number;
  predictedYear: number;

  // Trends
  growthRate: number; // percentage
  trend: 'increasing' | 'decreasing' | 'stable';
  seasonality: boolean;
  volatility: number; // 0-100 score

  // Confidence
  confidence: number; // 0-100
  confidenceInterval: {
    lower: number;
    upper: number;
  };

  // AI insights
  aiSummary: string;
  aiRisks: string[];
  aiRecommendations: string[];

  // Metadata
  accuracy?: number; // How accurate past predictions were
  modelVersion: string;
}

export interface Budget {
  id: string;
  organizationId: string;
  name: string;

  // Budget settings
  amount: number;
  period: 'monthly' | 'quarterly' | 'yearly';
  startDate: Date;
  endDate: Date;

  // Current status
  currentSpend: number;
  projectedSpend: number;
  remainingBudget: number;
  percentUsed: number;

  // Alerts
  alertThresholds: number[]; // e.g., [50, 75, 90, 100]
  alertsTriggered: {
    threshold: number;
    triggeredAt: Date;
    notified: boolean;
  }[];

  // Status
  status: 'on_track' | 'at_risk' | 'over_budget';
  daysRemaining: number;
  burnRate: number; // daily spend rate

  createdAt: Date;
  updatedAt: Date;
}

export interface Scenario {
  id: string;
  organizationId: string;
  type: ScenarioType;
  name: string;
  description: string;

  // Scenario parameters
  trafficMultiplier?: number; // 2.0 = 2x traffic
  newServiceCost?: number;
  optimizationSavings?: number;
  customAdjustment?: number;

  // Results
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

export interface ForecastAccuracy {
  organizationId: string;
  predictions: {
    date: Date;
    predicted: number;
    actual: number;
    error: number;
    errorPercent: number;
  }[];
  meanAbsoluteError: number;
  meanAbsolutePercentageError: number;
  accuracy: number; // 0-100
}
