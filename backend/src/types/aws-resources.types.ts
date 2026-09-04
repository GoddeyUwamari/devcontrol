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
  is_orphaned: boolean;
  orphaned_monthly_savings: number;
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
  /**
   * Optional stable identity, set by detectors that have one (checkSecurityGroups,
   * checkIAMSecurity) instead of relying on AccountSecurityFindingsRepository's
   * generic resource_arn|category|issue hash, which is unstable when `issue`
   * embeds a mutable human-readable name or value (e.g. an access key's age).
   */
  findingKey?: string;
  /** Optional narrow, versioned evidence — only set by detectors that define one. */
  evidence?: FindingEvidence;
}

/**
 * Narrow, versioned evidence for an unrestricted-security-group-ingress finding.
 * Deliberately not a generic evidence abstraction — see account_security_findings
 * migration comment for schema_version's role.
 */
export interface SecurityGroupEvidence {
  schema_version: 1;
  security_group_id: string;
  security_group_name: string;
  vpc_id?: string;
  region: string;
  direction: 'ingress' | 'egress';
  protocol: string;
  from_port: number;
  to_port: number;
  ip_version: 'v4' | 'v6';
  cidr: string;
  detected_at: string;
}

/**
 * Narrow, versioned evidence for an IAM-user-missing-MFA finding.
 * `has_login_profile` is `'unknown'` when GetLoginProfile could not confirm
 * or deny console access (e.g. AccessDenied on that specific call) — this
 * must never be conflated with `true` or `false`; see checkIAMSecurity's
 * three-case handling (confirmed console user / confirmed no console access /
 * unknown) and securityFrameworkMappings.ts, which only attaches CIS IAM.5
 * when this is `true`.
 */
export interface IamMfaEvidence {
  schema_version: 1;
  resource_type: 'iam_user';
  resource_identifier: string;
  resource_name: string;
  finding_type: 'mfa_not_enabled';
  relevant_aws_attributes: {
    has_login_profile: boolean | 'unknown';
    mfa_device_count: number;
  };
  detected_at: string;
}

/**
 * Narrow, versioned evidence for a stale-IAM-access-key finding.
 * `access_key_id` is an identifier, not a secret — ListAccessKeys never
 * returns the actual secret access-key value, so there is nothing sensitive
 * to accidentally capture here.
 */
export interface IamAccessKeyEvidence {
  schema_version: 1;
  resource_type: 'iam_access_key';
  resource_identifier: string;
  resource_name: string;
  finding_type: 'access_key_stale';
  relevant_aws_attributes: {
    access_key_id: string;
    age_in_days: number;
    key_status: string;
  };
  detected_at: string;
}

/**
 * Union of every detector's evidence shape. Deliberately not a generic
 * evidence framework — each member stays narrow and versioned; a new
 * detector adds a new member here rather than generalizing the shape.
 * SecurityGroupEvidence has no `resource_type` discriminant field (it
 * predates this union); code that needs to distinguish members can check
 * `'resource_type' in evidence` — present only on the IAM variants.
 */
export type FindingEvidence = SecurityGroupEvidence | IamMfaEvidence | IamAccessKeyEvidence;

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
  environment?: string;
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
  // True once ComplianceScannerService + OrphanedResourceDetectorService have both
  // completed at least one discovery run without error for this org — see
  // resource_discovery_jobs.compliance_scan_completed, set in awsResourceDiscovery.ts.
  scan_completed: boolean;
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
