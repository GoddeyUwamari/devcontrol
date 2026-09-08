/**
 * Optimization Rule Registry.
 *
 * Single source of truth for what Cost Optimization can and cannot check
 * today. Every rule here is either:
 *
 *   - 'implemented': a real analyzer runs for it (see
 *     services/cost-optimization.service.ts) and it can produce real
 *     cost_recommendations rows. Its `issue` field is the exact, canonical
 *     `cost_recommendations.issue` string that detector emits/reconciles
 *     against (see CostRecommendationsRepository.reconcileActiveRecommendations()
 *     and deleteActiveByIssue()).
 *   - 'planned': registered for product-roadmap/UI purposes only. No
 *     analyzer exists yet, no AWS calls are made for it, and it must never
 *     produce a cost_recommendations row. It intentionally has no `issue`
 *     field -- there is no canonical identity to reconcile against yet.
 *
 * Resource *discovery* (backend/src/services/awsResourceDiscovery.ts,
 * aws_resources table) covers more AWS services than this registry
 * *optimizes* -- discovering an S3 bucket or a DynamoDB table is not the same
 * as having a savings analyzer for it. Do not infer optimization coverage
 * from discovery coverage.
 *
 * This module is pure data + accessors. It performs no AWS calls and no DB
 * queries, so it is safe to import from both the analysis service and the
 * read-only API surface the frontend's rule catalog consumes.
 */

export type OptimizationRuleStatus = 'implemented' | 'planned';

export interface OptimizationRule {
  /** Stable, machine-readable identifier. Never reuse or repurpose once shipped. */
  id: string;
  /** One of OPTIMIZATION_RULE_SERVICES. */
  service: string;
  name: string;
  detail: string;
  status: OptimizationRuleStatus;
  /**
   * The canonical cost_recommendations.issue string this rule's detector
   * writes. Present if and only if status === 'implemented'.
   */
  issue?: string;
}

// Canonical issue identities for the analyzers that exist today. Both
// cost-optimization.service.ts (the producer) and
// cost-recommendations.repository.ts / cost-recommendations.controller.ts /
// awsResourceDiscovery.ts (the consumers of that identity for occurrence
// lifecycle and re-analysis) import these instead of repeating the literal
// strings, so the two sides can never silently drift apart.
export const ISSUE_EC2_IDLE_INSTANCE = 'Idle Instance';
export const ISSUE_RDS_OVERSIZED_INSTANCE = 'Oversized Instance';
export const ISSUE_EC2_UNUSED_ELASTIC_IP = 'Unused Elastic IP';
export const ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY = 'Reserved Instance Opportunity';
export const ISSUE_EBS_UNATTACHED_VOLUME = 'Unattached EBS Volume';
export const ISSUE_EBS_GP2_TO_GP3 = 'gp2 to gp3 Migration Opportunity';
export const ISSUE_EC2_OLD_GENERATION_INSTANCE = 'Old-Generation Instance';
export const ISSUE_S3_LIFECYCLE_OPTIMIZATION = 'S3 Lifecycle Optimization';
export const ISSUE_LAMBDA_LOW_USAGE = 'Low-Usage Lambda Function';
export const ISSUE_DYNAMODB_CAPACITY = 'DynamoDB Capacity Review Opportunity';
export const ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED = 'DynamoDB Capacity Mode Comparison';

/** Display/grouping order used by the UI's service coverage list. */
export const OPTIMIZATION_RULE_SERVICES = [
  'EC2',
  'EBS',
  'RDS',
  'S3',
  'Lambda',
  'DynamoDB',
  'NAT Gateway',
  'ECS',
  'EKS',
  'CloudWatch',
  'Redshift',
  'Aurora',
] as const;

export const OPTIMIZATION_RULES: OptimizationRule[] = [
  // ── EC2 ──────────────────────────────────────────────────────────────
  {
    id: 'ec2_idle',
    service: 'EC2',
    name: 'Idle EC2 instances',
    detail: 'CPU utilization below 5% averaged over 7 days',
    status: 'implemented',
    issue: ISSUE_EC2_IDLE_INSTANCE,
  },
  {
    id: 'ec2_unused_elastic_ip',
    service: 'EC2',
    name: 'Unused Elastic IPs',
    detail: 'Allocated IPs not attached to a running instance',
    status: 'implemented',
    issue: ISSUE_EC2_UNUSED_ELASTIC_IP,
  },
  {
    id: 'ec2_reserved_instances',
    service: 'EC2',
    name: 'Reserved Instance opportunities',
    detail: 'On-demand instances that could shift to Reserved pricing',
    status: 'implemented',
    issue: ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY,
  },
  {
    id: 'ec2_rightsizing',
    service: 'EC2',
    name: 'EC2 rightsizing',
    detail: 'Instances sized larger than their observed CPU/memory usage requires',
    status: 'planned',
  },
  {
    id: 'ec2_old_generation',
    service: 'EC2',
    name: 'Old-generation instances',
    detail: 'Instance families superseded by newer, cheaper generations',
    status: 'planned',
  },
  {
    id: 'ec2_graviton',
    service: 'EC2',
    name: 'Graviton migration',
    detail: 'Workloads eligible for lower-cost Graviton (ARM) instance types',
    status: 'planned',
  },

  // ── EBS ──────────────────────────────────────────────────────────────
  {
    id: 'ebs_unattached',
    service: 'EBS',
    name: 'Unattached volumes',
    detail: 'Volumes not attached to any instance',
    status: 'implemented',
    issue: ISSUE_EBS_UNATTACHED_VOLUME,
  },
  {
    id: 'ebs_gp2_to_gp3',
    service: 'EBS',
    name: 'gp2 to gp3 migration',
    detail: 'gp2 volumes that would cost less on gp3 at equivalent performance',
    status: 'implemented',
    issue: ISSUE_EBS_GP2_TO_GP3,
  },
  {
    id: 'ebs_oversized',
    service: 'EBS',
    name: 'Oversized volumes',
    detail: 'Provisioned volume size far exceeding actual usage',
    status: 'planned',
  },

  // ── RDS ──────────────────────────────────────────────────────────────
  {
    id: 'rds_idle',
    service: 'RDS',
    name: 'Idle databases',
    detail: 'Databases with negligible connection/query activity',
    status: 'planned',
  },
  {
    id: 'rds_rightsizing',
    service: 'RDS',
    name: 'Oversized RDS instances',
    detail: 'Non-production databases on production-sized instance classes',
    status: 'implemented',
    issue: ISSUE_RDS_OVERSIZED_INSTANCE,
  },
  {
    id: 'rds_storage',
    service: 'RDS',
    name: 'Storage optimization',
    detail: 'Allocated storage far exceeding actual usage',
    status: 'planned',
  },
  {
    id: 'rds_reserved_instance',
    service: 'RDS',
    name: 'Reserved Instance opportunities',
    detail: 'On-demand databases that could shift to Reserved pricing',
    status: 'planned',
  },

  // ── S3 ───────────────────────────────────────────────────────────────
  {
    id: 's3_lifecycle',
    service: 'S3',
    name: 'Lifecycle optimization',
    detail: 'Buckets without lifecycle rules to transition or expire aging objects',
    status: 'implemented',
    issue: ISSUE_S3_LIFECYCLE_OPTIMIZATION,
  },
  {
    id: 's3_storage_class',
    service: 'S3',
    name: 'Storage-class optimization',
    detail: 'Objects sitting in a storage class costlier than their access pattern needs',
    status: 'planned',
  },
  {
    id: 's3_noncurrent_versions',
    service: 'S3',
    name: 'Old/noncurrent object versions',
    detail: 'Versioned buckets accumulating noncurrent versions with no expiration',
    status: 'planned',
  },

  // ── Lambda ───────────────────────────────────────────────────────────
  {
    id: 'lambda_memory',
    service: 'Lambda',
    name: 'Memory optimization',
    detail: 'Functions configured with more memory than their usage requires',
    status: 'planned',
  },
  {
    id: 'lambda_runtime',
    service: 'Lambda',
    name: 'Runtime optimization',
    detail: 'Functions on deprecated or costlier runtimes/architectures',
    status: 'planned',
  },
  {
    id: 'lambda_low_usage',
    service: 'Lambda',
    name: 'Low-value/infrequent functions',
    detail: 'Functions invoked rarely relative to their provisioned/idle cost',
    status: 'implemented',
    issue: ISSUE_LAMBDA_LOW_USAGE,
  },

  // ── DynamoDB ─────────────────────────────────────────────────────────
  {
    id: 'dynamodb_capacity',
    service: 'DynamoDB',
    name: 'Capacity/utilization optimization',
    detail: 'Provisioned read/write capacity far exceeding consumed capacity',
    status: 'implemented',
    issue: ISSUE_DYNAMODB_CAPACITY,
  },
  {
    id: 'dynamodb_capacity_mode',
    service: 'DynamoDB',
    name: 'On-demand vs provisioned capacity',
    detail: 'Evidence-based comparison of modeled provisioned vs. on-demand cost from a table’s observed 30-day workload; flags a mode-switch opportunity only when the cost advantage, utilization, and workload-shape evidence together clear DevControl’s confidence policy',
    status: 'implemented',
    issue: ISSUE_DYNAMODB_ON_DEMAND_VS_PROVISIONED,
  },

  // ── NAT Gateway ──────────────────────────────────────────────────────
  {
    id: 'nat_gateway_data_processing',
    service: 'NAT Gateway',
    name: 'Unnecessary data processing',
    detail: 'NAT Gateway data-processing charges reducible via VPC endpoints or routing changes',
    status: 'planned',
  },

  // ── ECS ──────────────────────────────────────────────────────────────
  {
    id: 'ecs_rightsizing',
    service: 'ECS',
    name: 'Service/task rightsizing',
    detail: 'Task definitions provisioned above observed CPU/memory usage',
    status: 'planned',
  },
  {
    id: 'ecs_capacity',
    service: 'ECS',
    name: 'Capacity optimization',
    detail: 'Cluster capacity provisioned above sustained service demand',
    status: 'planned',
  },

  // ── EKS ──────────────────────────────────────────────────────────────
  {
    id: 'eks_capacity',
    service: 'EKS',
    name: 'Node/pod capacity optimization',
    detail: 'Node group capacity provisioned above scheduled pod requests',
    status: 'planned',
  },
  {
    id: 'eks_underutilized_nodes',
    service: 'EKS',
    name: 'Underutilized nodes',
    detail: 'Nodes running with sustained low CPU/memory utilization',
    status: 'planned',
  },

  // ── CloudWatch ───────────────────────────────────────────────────────
  {
    id: 'cloudwatch_unused_logs',
    service: 'CloudWatch',
    name: 'Unused/expensive log groups',
    detail: 'Log groups with high ingestion/storage cost and negligible query activity',
    status: 'planned',
  },
  {
    id: 'cloudwatch_log_retention',
    service: 'CloudWatch',
    name: 'Excessive log retention',
    detail: 'Log groups retaining data far longer than any compliance or operational need',
    status: 'planned',
  },

  // ── Redshift ─────────────────────────────────────────────────────────
  {
    id: 'redshift_rightsizing',
    service: 'Redshift',
    name: 'Cluster rightsizing',
    detail: 'Clusters provisioned above observed query/storage load',
    status: 'planned',
  },
  {
    id: 'redshift_idle',
    service: 'Redshift',
    name: 'Idle cluster detection',
    detail: 'Clusters with negligible query activity',
    status: 'planned',
  },

  // ── Aurora ───────────────────────────────────────────────────────────
  {
    id: 'aurora_rightsizing',
    service: 'Aurora',
    name: 'Instance/storage rightsizing',
    detail: 'Instances or storage provisioned above observed usage',
    status: 'planned',
  },
  {
    id: 'aurora_idle',
    service: 'Aurora',
    name: 'Idle Aurora resources',
    detail: 'Clusters/instances with negligible connection or query activity',
    status: 'planned',
  },
];

export function getOptimizationRules(): OptimizationRule[] {
  return OPTIMIZATION_RULES;
}

export function getImplementedOptimizationRules(): OptimizationRule[] {
  return OPTIMIZATION_RULES.filter((rule) => rule.status === 'implemented');
}

export interface OptimizationRuleServiceCoverage {
  service: string;
  implementedCount: number;
  plannedCount: number;
  totalCount: number;
}

export interface OptimizationRuleSummary {
  totalRules: number;
  implementedCount: number;
  plannedCount: number;
  services: OptimizationRuleServiceCoverage[];
}

/**
 * Aggregate counts for the UI's "Implemented / Coverage / Planned" split.
 * Deliberately does not hardcode "30" anywhere -- these numbers are derived
 * from OPTIMIZATION_RULES so they can never drift from what's actually
 * registered (see optimization-rules.test.ts for the guard that keeps the
 * registry itself matching the product-approved rule set).
 */
export function getOptimizationRuleSummary(): OptimizationRuleSummary {
  const implementedCount = OPTIMIZATION_RULES.filter((r) => r.status === 'implemented').length;
  const plannedCount = OPTIMIZATION_RULES.length - implementedCount;

  const services = OPTIMIZATION_RULE_SERVICES.map((service) => {
    const rulesForService = OPTIMIZATION_RULES.filter((r) => r.service === service);
    return {
      service,
      implementedCount: rulesForService.filter((r) => r.status === 'implemented').length,
      plannedCount: rulesForService.filter((r) => r.status === 'planned').length,
      totalCount: rulesForService.length,
    };
  });

  return {
    totalRules: OPTIMIZATION_RULES.length,
    implementedCount,
    plannedCount,
    services,
  };
}
