/**
 * AWS Resource Inventory Types
 * Defines all types for AWS resource discovery, compliance scanning, and orphaned resource detection
 */

// =====================================================
// AWS RESOURCE TYPES
// =====================================================

export type ResourceType =
  | 'ec2'
  | 'rds'
  | 's3'
  | 'lambda'
  | 'ecs'
  | 'elb'
  | 'load-balancer'
  | 'vpc'
  | 'eks'
  | 'dynamodb'
  | 'cloudfront'
  | 'api-gateway'
  | 'elasticache'
  | 'aurora'
  | 'sqs'
  | 'sns';

export type ResourceStatus =
  | 'running'
  | 'stopped'
  | 'available'
  | 'unavailable'
  | 'active'
  | 'inactive'
  | 'terminated'
  | 'Active'
  | 'pending'
  | 'failed'
  | 'unknown'
  | 'UNKNOWN';

export interface AWSResource {
  id: string;
  organization_id: string;
  resource_arn: string;
  resource_id: string;
  resource_name: string | null;
  resource_type: ResourceType;
  region: string;
  tags: Record<string, string>;
  metadata: Record<string, any>;
  status: ResourceStatus | null;
  estimated_monthly_cost: number;
  actual_monthly_cost: number;
  is_encrypted: boolean;
  is_public: boolean;
  has_backup: boolean;
  compliance_issues: ComplianceIssue[];
  last_synced_at: Date | null;
  first_discovered_at: Date;
  created_at: Date;
  updated_at: Date;
}

export interface CreateAWSResourceInput {
  organization_id: string;
  resource_arn: string;
  resource_id: string;
  resource_name?: string;
  resource_type: ResourceType;
  region: string;
  tags?: Record<string, string>;
  metadata?: Record<string, any>;
  status?: ResourceStatus;
  estimated_monthly_cost?: number;
  actual_monthly_cost?: number;
  is_encrypted?: boolean;
  is_public?: boolean;
  has_backup?: boolean;
  compliance_issues?: ComplianceIssue[];
}

// =====================================================
// COMPLIANCE TYPES
// =====================================================

export type ComplianceSeverity = 'critical' | 'high' | 'medium' | 'low';

export type ComplianceCategory =
  | 'encryption'
  | 'backups'
  | 'public_access'
  | 'tagging'
  | 'iam'
  | 'networking';

export interface ComplianceIssue {
  severity: ComplianceSeverity;
  category: ComplianceCategory;
  issue: string;
  recommendation: string;
  resource_arn?: string;
}

export interface ComplianceStats {
  total_issues: number;
  by_severity: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  by_category: {
    encryption: number;
    backups: number;
    public_access: number;
    tagging: number;
    iam: number;
    networking: number;
  };
}

// =====================================================
// DISCOVERY JOB TYPES
// =====================================================

export type DiscoveryJobStatus = 'pending' | 'running' | 'completed' | 'failed';

export interface ResourceDiscoveryJob {
  id: string;
  organization_id: string;
  status: DiscoveryJobStatus;
  resources_discovered: number;
  resources_updated: number;
  resources_deleted: number;
  regions: string[] | null;
  resource_types: ResourceType[] | null;
  error_message: string | null;
  started_at: Date | null;
  completed_at: Date | null;
  created_at: Date;
}

export interface CreateDiscoveryJobInput {
  organization_id: string;
  regions?: string[];
  resource_types?: ResourceType[];
}

export interface UpdateDiscoveryJobInput {
  status?: DiscoveryJobStatus;
  resources_discovered?: number;
  resources_updated?: number;
  resources_deleted?: number;
  error_message?: string;
  started_at?: Date;
  completed_at?: Date;
}

export interface DiscoveryResult {
  job_id: string;
  resources_discovered: number;
  resources_updated: number;
  resources_deleted: number;
  errors: string[];
}

// =====================================================
// ORPHANED RESOURCE TYPES
// =====================================================

export type OrphanedResourceType =
  | 'unattached_volume'
  | 'unused_elastic_ip'
  | 'stopped_instance'
  | 'empty_s3_bucket';

export interface OrphanedResource {
  resource: AWSResource;
  orphaned_type: OrphanedResourceType;
  age_days: number;
  potential_savings: number;
}

// =====================================================
// FILTER TYPES
// =====================================================

export interface ResourceFilters {
  resource_type?: ResourceType;
  region?: string;
  status?: ResourceStatus;
  is_encrypted?: boolean;
  is_public?: boolean;
  has_backup?: boolean;
  search?: string; // Search in name, ARN, or tags
  page?: number;
  limit?: number;
}

// =====================================================
// STATS TYPES
// =====================================================

export interface ResourceStats {
  total_resources: number;
  by_type: Record<ResourceType, number>;
  by_region: Record<string, number>;
  by_status: Record<ResourceStatus, number>;
  total_monthly_cost: number;
  cost_by_type: Record<ResourceType, number>;
  compliance_stats: ComplianceStats;
  orphaned_count: number;
  orphaned_savings: number;
  unencrypted_count: number;
  public_count: number;
  missing_backup_count: number;
}

// =====================================================
// AWS SDK RESPONSE TYPES (for mapping)
// =====================================================

export interface EC2InstanceMetadata {
  instance_type: string;
  platform?: string;
  vpc_id?: string;
  subnet_id?: string;
  public_ip?: string;
  private_ip?: string;
  availability_zone?: string;
  launch_time?: string;
}

export interface RDSInstanceMetadata {
  db_instance_class: string;
  engine: string;
  engine_version: string;
  allocated_storage?: number;
  multi_az?: boolean;
  publicly_accessible?: boolean;
  vpc_id?: string;
}

export interface S3BucketMetadata {
  creation_date?: string;
  versioning_enabled?: boolean;
  logging_enabled?: boolean;
  lifecycle_rules?: number;
}

// =====================================================
// API RESPONSE TYPES
// =====================================================

export interface ResourceListResponse {
  resources: AWSResource[];
  total: number;
  page: number;
  limit: number;
}

export interface ResourceDetailResponse {
  resource: AWSResource;
}
