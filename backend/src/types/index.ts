import { Request, Response } from 'express';

// Database Models
export interface Team {
  id: string;
  name: string;
  owner: string;
  description?: string;
  organization_id: string;
  created_at: Date;
  updated_at: Date;
}

export interface Service {
  id: string;
  name: string;
  template: 'api' | 'frontend' | 'worker' | 'database';
  owner: string;
  team_id: string;
  github_url?: string;
  description?: string;
  status: 'active' | 'inactive' | 'archived';
  organization_id?: string;
  created_at: Date;
  updated_at: Date;
}

export interface Deployment {
  id: string;
  service_id: string;
  environment: 'development' | 'staging' | 'production';
  aws_region: string;
  status: 'running' | 'stopped' | 'deploying' | 'failed' | 'success';
  cost_estimate: number;
  deployed_by: string;
  deployed_at: Date;
  resources?: Record<string, any>;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
}

export interface InfrastructureResource {
  id: string;
  service_id: string;
  resource_type: 'ec2' | 'rds' | 'vpc' | 's3' | 'lambda' | 'elasticache' | 'other';
  aws_id: string;
  aws_region: string;
  status: 'running' | 'stopped' | 'terminated';
  cost_per_month: number;
  metadata?: Record<string, any>;
  organization_id?: string;
  created_at: Date;
  updated_at: Date;
}

// API Request/Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  data?: T;
  error?: string;
  message?: string;
  code?: string;
  total?: number;
}

export interface PaginationQuery {
  limit?: number;
  offset?: number;
}

export interface ServiceFilters extends PaginationQuery {
  status?: string;
  team_id?: string;
  template?: string;
}

export interface DeploymentFilters extends PaginationQuery {
  service_id?: string;
  environment?: string;
  status?: string;
}

export interface InfrastructureFilters extends PaginationQuery {
  service_id?: string;
  resource_type?: string;
  status?: string;
}

// Create/Update Request Bodies
export interface CreateServiceRequest {
  name: string;
  template: 'api' | 'frontend' | 'worker' | 'database';
  owner: string;
  team_id: string;
  github_url?: string;
  description?: string;
}

export interface UpdateServiceRequest {
  name?: string;
  status?: 'active' | 'inactive' | 'archived';
  description?: string;
  github_url?: string;
}

export interface CreateDeploymentRequest {
  service_id: string;
  environment: 'development' | 'staging' | 'production';
  aws_region: string;
  status: 'running' | 'stopped' | 'deploying' | 'failed' | 'success';
  cost_estimate?: number;
  deployed_by: string;
  deployed_at?: Date;
  resources?: Record<string, any>;
  metadata?: Record<string, any>;
  organization_id?: string;
}

export interface CreateInfrastructureRequest {
  service_id: string;
  resource_type: 'ec2' | 'rds' | 'vpc' | 's3' | 'lambda' | 'elasticache' | 'other';
  aws_id: string;
  aws_region: string;
  status: 'running' | 'stopped' | 'terminated';
  cost_per_month: number;
  metadata?: Record<string, any>;
}

export interface CreateTeamRequest {
  name: string;
  owner: string;
  description?: string;
}

// Platform Stats
export interface PlatformStats {
  total_services: number;
  active_deployments: number;
  total_infrastructure_cost: number;
  cost_source: 'actual' | 'estimated';
  free_tier_remaining: number;
  recent_deployments: Deployment[];
  service_health: {
    healthy: number;
    unhealthy: number;
  };
}

export interface CostBreakdown {
  total_monthly_cost: number;
  by_service: Array<{ service_name: string; cost: number }>;
  by_resource_type: Array<{ resource_type: string; cost: number }>;
  by_team: Array<{ team_name: string; cost: number }>;
}

// Express Extensions
export interface TypedRequest<T = any> extends Request {
  body: T;
}

export interface TypedResponse<T = any> extends Response {
  json: (body: ApiResponse<T>) => this;
}

// Cost Recommendations
export type RecommendationSeverity = 'LOW' | 'MEDIUM' | 'HIGH';
export type RecommendationStatus = 'ACTIVE' | 'RESOLVED' | 'DISMISSED';

export interface CostRecommendation {
  id: string;
  resource_id: string;
  resource_name?: string;
  resource_type: string;
  issue: string;
  description?: string;
  potential_savings: number;
  severity: RecommendationSeverity;
  status: RecommendationStatus;
  aws_region?: string;
  metadata?: Record<string, any>;
  created_at: Date;
  updated_at: Date;
  resolved_at?: Date;
}

export interface CreateRecommendationRequest {
  resource_id: string;
  resource_name?: string;
  resource_type: string;
  issue: string;
  description?: string;
  potential_savings: number;
  severity: RecommendationSeverity;
  aws_region?: string;
  metadata?: Record<string, any>;
}

export interface RecommendationFilters extends PaginationQuery {
  severity?: RecommendationSeverity;
  status?: RecommendationStatus;
  resource_type?: string;
}

export interface RecommendationStats {
  total_recommendations: number;
  active_recommendations: number;
  total_potential_savings: number;
  by_severity: {
    high: number;
    medium: number;
    low: number;
  };
}

// Service Dependencies
export interface ServiceDependency {
  id: string;
  organization_id: string;
  source_service_id: string;
  target_service_id: string;
  dependency_type: 'api' | 'database' | 'event' | 'data' | 'other';
  description?: string;
  is_critical: boolean;
  metadata?: Record<string, any>;
  created_by: string;
  created_at: Date;
  updated_at: Date;
  // Joined fields from services table
  source_service_name?: string;
  target_service_name?: string;
  source_service_status?: string;
  target_service_status?: string;
}

export interface CreateDependencyRequest {
  source_service_id: string;
  target_service_id: string;
  dependency_type: 'api' | 'database' | 'event' | 'data' | 'other';
  description?: string;
  is_critical?: boolean;
  metadata?: Record<string, any>;
}

export interface UpdateDependencyRequest {
  dependency_type?: 'api' | 'database' | 'event' | 'data' | 'other';
  description?: string;
  is_critical?: boolean;
  metadata?: Record<string, any>;
}

export interface DependencyFilters extends PaginationQuery {
  source_service_id?: string;
  target_service_id?: string;
  dependency_type?: string;
  is_critical?: boolean;
}

// Dependency Graph (for React Flow visualization)
export interface DependencyGraphNode {
  id: string;
  type: string;
  position: {
    x: number;
    y: number;
  };
  data: {
    label: string;
    status: string;
    owner: string;
    template: string;
  };
}

export interface DependencyGraphEdge {
  id: string;
  source: string;
  target: string;
  type: string;
  label: string;
  animated: boolean;
  data: {
    dependency_type: string;
    is_critical: boolean;
    description?: string;
  };
}

export interface DependencyGraph {
  nodes: DependencyGraphNode[];
  edges: DependencyGraphEdge[];
}

// Impact Analysis
export interface ImpactAnalysis {
  service_id: string;
  service_name: string;
  upstream_dependencies: Array<{
    id: string;
    name: string;
    dependency_type: string;
    is_critical: boolean;
  }>;
  downstream_dependencies: Array<{
    id: string;
    name: string;
    dependency_type: string;
    is_critical: boolean;
  }>;
  total_upstream: number;
  total_downstream: number;
  total_affected_if_fails: number;
  critical_path: boolean;
}

// Circular Dependency Detection
export interface CircularDependency {
  cycle: Array<{
    service_id: string;
    service_name: string;
  }>;
  path: string;
  dependency_ids: string[];
  severity: string;
}

// Deployment extended properties
export interface DeploymentExtended extends Deployment {
  organization_id: string;
  service_name?: string;
}

// Service extended properties
export interface ServiceExtended extends Service {
  organization_id: string;
}
