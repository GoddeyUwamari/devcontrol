// Anomaly types for frontend
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
  resourceId?: string;
  resourceType?: string;
  resourceName?: string;
  metric: string;
  currentValue: number;
  expectedValue: number;
  deviation: number;
  historicalAverage: number;
  historicalStdDev: number;
  detectedAt: Date | string;
  timeWindow: string;
  region?: string;
  title: string;
  description: string;
  aiExplanation: string;
  impact: string;
  recommendation: string;
  confidence: number;
  status: AnomalyStatus;
  acknowledgedAt?: Date | string;
  acknowledgedBy?: string;
  resolvedAt?: Date | string;
  notes?: string;
  relatedEvents?: string[];
  affectedResources?: string[];
}

export interface AnomalyStats {
  total: number;
  active: number;
  bySeverity: Record<AnomalySeverity, number>;
  byType: Record<AnomalyType, number>;
  mttr: number;
  falsePositiveRate: number;
}

export interface TimeSeriesDataPoint {
  timestamp: Date;
  value: number;
}

export interface AnomalyDetectionConfig {
  enabled: boolean;
  sensitivity: 'low' | 'medium' | 'high';
  minDataPoints: number;
  checkInterval: number;
  cooldownPeriod: number;
}
