/**
 * AWS Resource Inventory Types
 * Defines all types for AWS resource discovery, compliance scanning, and orphaned resource detection
 */

// =====================================================
// AWS RESOURCE TYPES
// =====================================================

export type ResourceType =
  | 'ec2'
  | 'ebs'
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
  | 'UNKNOWN'
  // A CloudFront distribution whose latest change is still propagating.
  | 'in-progress'
  // The resource type has no lifecycle status (S3, SNS, VPC): see utils/resourceLifecycle.ts.
  | 'not_applicable';

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
  // null means "not yet calculated" (e.g. a Lambda function whose CloudWatch
  // usage lookup failed on its most recent discovery) -- never coerce to 0.
  estimated_monthly_cost: number | null;
  actual_monthly_cost: number;
  // null = unknown/unavailable/not evaluated (e.g. an AWS Backup lookup that hit
  // AccessDenied or another API failure) -- never coerce to false. See
  // awsResourceDiscovery.ts's discoverEC2Instances/discoverEBSVolumes and
  // aws-backup-evidence.util.ts.
  is_encrypted: boolean | null;
  // null = unknown/unavailable/not evaluated (e.g. an S3 GetBucketAcl call that hit
  // AccessDenied or another API failure) -- never coerce to false. See
  // awsResourceDiscovery.ts's discoverS3Buckets.
  is_public: boolean | null;
  has_backup: boolean | null;
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
  estimated_monthly_cost?: number | null;
  actual_monthly_cost?: number;
  // null = unknown/unavailable/not evaluated -- see AWSResource.is_encrypted/is_public/has_backup.
  is_encrypted?: boolean | null;
  is_public?: boolean | null;
  has_backup?: boolean | null;
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
  | 'networking'
  | 'observability';

/**
 * Where a ComplianceIssue's underlying evidence came from — NOT an evaluation
 * outcome. This is deliberately a different axis from Security Hub's
 * FoundationControlStatus (PASS/FAIL/UNKNOWN/NOT_EVALUATED/etc., which answers
 * "did the check pass," not "what kind of evidence backs it") and must not be
 * conflated with it or imported alongside it.
 *
 *   OBSERVED       — a real AWS API call verified the underlying condition
 *                     (e.g. is_encrypted/has_backup, a live DescribeSecurityGroups
 *                     or ListAccessKeys result).
 *   DERIVED         — computed/inferred from other observed evidence, not a
 *                      direct 1:1 API observation itself. Not yet produced by
 *                      any current detector; reserved for future use.
 *   SELF_ATTESTED   — inferred only from customer-provided metadata (e.g. tag
 *                      presence/absence), with no AWS API call verifying the
 *                      underlying condition.
 *
 * Optional and unpopulated on older/unclassified findings — absence must never
 * be read as an implicit provenance value.
 */
export type ComplianceIssueProvenance = 'OBSERVED' | 'DERIVED' | 'SELF_ATTESTED';

/**
 * Whether a compliance framework applies to an organization. A framework is
 * evaluated only when it is explicitly enabled; nothing else is read as enabled.
 *
 *   enabled        — a setting explicitly enables it.
 *   disabled       — a setting explicitly disables it.
 *   not_configured — no setting is recorded for it.
 *   unavailable    — the settings could not be read.
 *   invalid        — a setting exists but cannot be interpreted (a non-boolean value,
 *                     conflicting settings, or a framework nothing evaluates).
 *
 * This is configuration, not an evaluation outcome and not a severity.
 */
export type FrameworkApplicabilityState = 'enabled' | 'disabled' | 'not_configured' | 'unavailable' | 'invalid';

/**
 * What happened when a check was run — a different axis from severity (how much a
 * failure matters) and from provenance (where the evidence came from).
 *
 *   failed             — evaluated, and the evidence shows the control is not met.
 *   passed             — evaluated, and the evidence shows the control is met.
 *   unable_to_evaluate — the evidence needed is missing or is not evidence (a tag).
 *   error              — the check itself could not complete.
 *   not_evaluated      — the check was not run (its framework is not enabled, or
 *                         its applicability could not be determined).
 *   not_applicable     — the check does not apply to the resource (any more). Only
 *                         ever a stored state: see compliance_check_evaluations.
 */
export type FindingEvaluationState =
  | 'failed'
  | 'passed'
  | 'unable_to_evaluate'
  | 'error'
  | 'not_evaluated'
  | 'not_applicable';

/** What a check's outcome rests on: an AWS API observation, a resource tag, or nothing collected. */
export type FindingEvidenceBasis = 'aws_api' | 'tag' | 'none';

export interface ComplianceIssue {
  severity: ComplianceSeverity;
  category: ComplianceCategory;
  issue: string;
  recommendation: string;
  resource_arn?: string;
  /**
   * Optional stable identity, set by detectors that have one (checkSecurityGroups,
   * checkIAMSecurity, the S3 security evaluation) instead of relying on AccountSecurityFindingsRepository's
   * generic resource_arn|category|issue hash, which is unstable when `issue`
   * embeds a mutable human-readable name or value (e.g. an access key's age).
   */
  findingKey?: string;
  /** Optional narrow, versioned evidence — only set by detectors that define one. */
  evidence?: FindingEvidence;
  /**
   * Set on an EC2 public-IP finding: what the instance's security groups show.
   * A description of rules, never of access that took place.
   */
  network_exposure?: NetworkExposureEvidence;
  /** Optional evidence-source classification — see ComplianceIssueProvenance. */
  provenance?: ComplianceIssueProvenance;
  /**
   * 'unverified': a finding carried forward from an earlier scan because this scan
   * could not evaluate the check. It was true when last verified and is not a fresh
   * observation. Absent on findings this scan verified.
   */
  verification?: 'unverified';
  /** The compliance framework this finding belongs to. Absent on baseline (non-framework) findings. */
  framework?: string;
  /** The framework's applicability when this entry was written. Absent on baseline findings. */
  applicability?: FrameworkApplicabilityState;
  /**
   * Absent on baseline findings and on entries written before this field existed.
   * When present, only 'failed' is a current finding: any other value marks an entry
   * retained from an earlier scan that this scan could not re-evaluate.
   */
  evaluation_state?: FindingEvaluationState;
  evidence_basis?: FindingEvidenceBasis;
  /** Why the entry has its evaluation_state. Fixed wording; never raw error text. */
  evaluation_reason?: string;
}

/**
 * One framework check's outcome for one resource, or (check: null) the reason a
 * framework was not evaluated at all. Returned by the scanner for every outcome,
 * including the ones that are not findings, and stored in
 * compliance_check_evaluations. Severity is set only on a 'failed' outcome.
 */
export interface FrameworkCheckEvaluation {
  framework: string;
  /** The check's stable key (the finding's findingKey); null = the framework as a whole. */
  check: string | null;
  applicability: FrameworkApplicabilityState;
  evaluation_state: FindingEvaluationState;
  severity: ComplianceSeverity | null;
  evidence_basis: FindingEvidenceBasis;
  provenance: ComplianceIssueProvenance | null;
  /** Closed vocabulary (utils/frameworkApplicability.ts EvaluationReasonCode). */
  reason_code: string;
  /** The fixed wording for reason_code. */
  reason: string;
  /** Set only on 'error': a category, never the error's text. */
  error_code: string | null;
  resource_arn: string;
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
 * What an EC2 public-IP finding rests on. `state` is the outcome of reading the
 * instance's security groups (utils/adminPortExposure.ts):
 *   open_admin_port   `rules` lists the internet-open rules that cover an
 *                     administrative or database port.
 *   not_established   the groups were read and no such rule was found.
 *   unknown           the groups could not be read, or a rule on such a port takes its
 *                     sources from a prefix list that was not resolved; nothing is
 *                     claimed either way.
 *   not_checked       nothing is recorded for the instance yet: its groups have not
 *                     been read (which is not the same as a read that failed).
 */
export interface NetworkExposureEvidence {
  schema_version: 1;
  state: 'open_admin_port' | 'not_established' | 'unknown' | 'not_checked';
  summary: string;
  rules: Array<{
    security_group_id: string;
    protocol: string;
    from_port: number | null;
    to_port: number | null;
    cidr: string;
    admin_ports: number[];
  }>;
}

/**
 * Whether a resource's `tags` are what AWS reported.
 *   observed      the tags were read; an empty set means the resource has none.
 *   unavailable   they could not be read, or this resource type's tags are not
 *                 read at all. `tags` is then empty and says nothing.
 */
export type TagsState = 'observed' | 'unavailable';

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
    observability: number;
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
  /** Codes from services/discovery-warnings.ts: checks not run this cycle, which do not fail the job. */
  warnings?: string[];
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
  /** The security groups attached to the instance, as DescribeInstances reports them. */
  security_group_ids?: string[];
  /** Read from those groups on each discovery: see utils/adminPortExposure.ts. */
  network_exposure?: {
    state: 'open_admin_port' | 'not_established' | 'unknown';
    reason?: 'security_groups_unreadable' | 'prefix_list_source';
    rules?: NetworkExposureEvidence['rules'];
  };
  /** Always 'observed': the tags come inline with the Describe response that listed the resource. */
  tags_state?: TagsState;
}

export interface RDSInstanceMetadata {
  db_instance_class: string;
  engine: string;
  engine_version: string;
  allocated_storage?: number;
  multi_az?: boolean;
  publicly_accessible?: boolean;
  vpc_id?: string;
  /** Always 'observed': the tags come inline with the Describe response that listed the resource. */
  tags_state?: TagsState;
}

export interface EBSVolumeMetadata {
  volume_type: string;
  size_gb: number;
  iops?: number;
  throughput?: number;
  availability_zone?: string;
  attached: boolean;
  attached_instance_id?: string;
  /** Always 'observed': the tags come inline with the Describe response that listed the resource. */
  tags_state?: TagsState;
}

export interface S3BucketMetadata {
  creation_date?: string;
  // Versioning and access logging are not read, so neither is recorded. They used
  // to be stored as `false` without being queried.
  tags_state?: TagsState;
  // Count of *enabled* rules from a real GetBucketLifecycleConfiguration
  // response (see s3-lifecycle.util.ts) -- 0 is a genuine "no rules" finding,
  // never a placeholder default. Absent entirely when lifecycle_status is
  // 'unavailable' (the call itself failed/was denied), since 0 there would
  // misrepresent "we don't know" as "confirmed none".
  lifecycle_rules?: number;
  // 'unavailable' means the AWS call failed (AccessDenied, throttling, etc.)
  // -- never coerced into 'no_lifecycle_configuration'. See s3-lifecycle.util.ts.
  lifecycle_status?: 'no_lifecycle_configuration' | 'has_lifecycle_rules' | 'unavailable';
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
