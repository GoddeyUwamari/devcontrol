/**
 * Cost Optimization Types
 * Automated cost optimization recommendations
 */

export type OptimizationType =
  | 'idle_resource'
  | 'oversized_instance'
  | 'unattached_volume'
  | 'old_snapshot'
  | 'reserved_instance'
  | 'lambda_memory'
  | 'unused_elastic_ip'
  | 'idle_load_balancer';

export type OptimizationRisk = 'safe' | 'caution' | 'risky';
export type OptimizationEffort = 'low' | 'medium' | 'high';
export type OptimizationStatus = 'pending' | 'approved' | 'applied' | 'dismissed';

export interface OptimizationRecommendation {
  id: string;
  organizationId: string;
  type: OptimizationType;
  resourceId: string;
  resourceType: string;
  resourceName: string;
  region: string;

  // Analysis
  currentCost: number; // monthly
  optimizedCost: number; // monthly
  monthlySavings: number;
  annualSavings: number;

  // Metadata
  risk: OptimizationRisk;
  effort: OptimizationEffort;
  confidence: number; // 0-100
  priority: number; // 1-10 (AI-generated)

  // Action
  title: string;
  description: string;
  reasoning: string;
  action: string; // Human-readable action
  actionCommand?: string; // CLI command (optional)

  // State
  status: OptimizationStatus;
  detectedAt: Date;
  appliedAt?: Date;
  dismissedAt?: Date;

  // Metrics
  utilizationMetrics?: {
    cpuAvg: number;
    cpuMax: number;
    memoryAvg: number;
    networkAvg: number;
    daysObserved: number;
  };
}

export interface OptimizationSummary {
  totalRecommendations: number;
  totalMonthlySavings: number;
  totalAnnualSavings: number;
  byType: Record<OptimizationType, {
    count: number;
    savings: number;
  }>;
  byRisk: Record<OptimizationRisk, number>;
  byStatus: Record<OptimizationStatus, number>;
}

export interface ScanResult {
  recommendations: OptimizationRecommendation[];
  summary: OptimizationSummary;
  scannedAt: Date;
  totalResourcesScanned: number;
}
