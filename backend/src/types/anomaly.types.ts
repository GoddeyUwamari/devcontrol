export type AnomalyType =
  | 'cost_spike'
  | 'cost_drop'
  | 'cpu_spike'
  | 'memory_spike'
  | 'invocation_spike'
  | 'error_rate_spike'
  | 'traffic_drop'
  | 'deployment_impact';

export type AnomalySeverity = 'info' | 'warning' | 'critical';
export type AnomalyStatus = 'active' | 'acknowledged' | 'resolved' | 'false_positive';

export interface AnomalyDetection {
  id: string;
  organizationId: string;
  type: AnomalyType;
  severity: AnomalySeverity;

  // What was detected
  resourceId?: string;
  resourceType?: string;
  resourceName?: string;
  metric: string; // 'cost', 'cpu_utilization', 'invocations', etc.

  // Statistical analysis
  currentValue: number;
  expectedValue: number;
  deviation: number; // percentage or z-score
  historicalAverage: number;
  historicalStdDev: number;

  // Context
  detectedAt: Date;
  timeWindow: string; // '1h', '24h', '7d'
  region?: string;

  // AI-generated insights
  title: string;
  description: string;
  aiExplanation: string; // Why this is anomalous
  impact: string; // Business/technical impact
  recommendation: string; // What to do
  confidence: number; // 0-100

  // Metadata
  status: AnomalyStatus;
  acknowledgedAt?: Date;
  acknowledgedBy?: string;
  resolvedAt?: Date;
  notes?: string;

  // Related data
  relatedEvents?: string[]; // Deployment IDs, alert IDs
  affectedResources?: string[];
}

export interface AnomalyStats {
  total: number;
  active: number;
  bySeverity: Record<AnomalySeverity, number>;
  byType: Record<AnomalyType, number>;
  mttr: number; // Mean time to resolve (hours)
  falsePositiveRate: number;
}

export interface TimeSeriesDataPoint {
  timestamp: Date;
  value: number;
}

export interface AnomalyDetectionConfig {
  enabled: boolean;
  sensitivity: 'low' | 'medium' | 'high'; // Affects z-score threshold
  minDataPoints: number; // Minimum history required
  checkInterval: number; // Minutes between checks
  cooldownPeriod: number; // Minutes before re-alerting same anomaly
}
