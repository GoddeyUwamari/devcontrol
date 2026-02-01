/**
 * Cost Optimization Types (Frontend)
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
  currentCost: number;
  optimizedCost: number;
  monthlySavings: number;
  annualSavings: number;
  risk: OptimizationRisk;
  effort: OptimizationEffort;
  confidence: number;
  priority: number;
  title: string;
  description: string;
  reasoning: string;
  action: string;
  actionCommand?: string;
  status: OptimizationStatus;
  detectedAt: Date;
  appliedAt?: Date;
  dismissedAt?: Date;
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
  byType: Record<
    OptimizationType,
    {
      count: number;
      savings: number;
    }
  >;
  byRisk: Record<OptimizationRisk, number>;
  byStatus: Record<OptimizationStatus, number>;
}
