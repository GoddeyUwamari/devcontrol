import { Pool } from 'pg';
import { requestContext } from '../config/database';
import { trackFunnelEventOnce } from './analyticsEvents';
import {
  EC2Client,
  paginateDescribeInstances,
  paginateDescribeVolumes,
  paginateDescribeSecurityGroups,
  Instance,
  Volume,
  DescribeVolumesCommand,
} from '@aws-sdk/client-ec2';
import {
  RDSClient,
  paginateDescribeDBInstances,
  DBInstance,
} from '@aws-sdk/client-rds';
import {
  LambdaClient,
  paginateListFunctions,
  ListTagsCommand,
  FunctionConfiguration,
} from '@aws-sdk/client-lambda';
import {
  ElasticLoadBalancingV2Client,
  paginateDescribeLoadBalancers,
  DescribeTagsCommand as DescribeELBTagsCommand,
  LoadBalancer,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetBucketEncryptionCommand,
  GetBucketAclCommand,
  Bucket,
} from '@aws-sdk/client-s3';
import {
  CloudFrontClient,
  paginateListDistributions,
  DistributionSummary,
} from '@aws-sdk/client-cloudfront';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { AWSClients } from './aws-client-factory.service';
import { ScanContext } from './scan-context';
import { isPlatformAwsCredentialsUnavailable, PLATFORM_AWS_UNAVAILABLE_MESSAGE } from './platform-sts';
import { createAwsBackupEvidenceCache, checkEBSBackupCoverage, BackupEvidenceResult } from './aws-backup-evidence.util';
import {
  AWSResource,
  ComplianceIssue,
  FrameworkCheckEvaluation,
  CreateAWSResourceInput,
  ResourceType,
  ResourceStatus,
  DiscoveryResult,
  DiscoveryJobStatus,
  EC2InstanceMetadata,
  EBSVolumeMetadata,
  RDSInstanceMetadata,
  S3BucketMetadata,
  TagsState,
} from '../types/aws-resources.types';
import { SubscriptionTier } from '../middleware/subscription.middleware';
import { ComplianceScannerService } from './complianceScanner';
import { getBucketTags, regionFromLocationConstraint } from './s3-bucket-tags.util';
import { NetworkExposure, SecurityGroupRules, evaluateNetworkExposure } from '../utils/adminPortExposure';
import { NOT_APPLICABLE_STATUS, UNKNOWN_STATUS, storedStatusFor } from '../utils/resourceLifecycle';
import { AwsCallPolicy, DEFAULT_AWS_CALL_POLICY, mapWithConcurrency, withCallPolicy } from '../utils/awsCallPolicy';
import { readBuiltInFrameworkSettings } from '../repositories/compliance-frameworks.repository';
import { FrameworkApplicability, REGISTERED_FRAMEWORKS, resolveFrameworkApplicability } from '../utils/frameworkApplicability';
import { FRAMEWORK_EVALUATOR_VERSION } from './framework-checks';
import {
  FrameworkRun,
  failFrameworkRun,
  finishFrameworkRun,
  frameworkEvaluationStorageAvailable,
  heartbeatFrameworkRun,
  persistResourceEvaluation,
  recordReconciliationRequired,
  startFrameworkRun,
  writeBaselinePreservingFrameworkFindings,
} from '../repositories/framework-evaluations.repository';

/** One scan's framework evaluation: the runs it opened and how its resources fared. */
interface FrameworkEvaluationScan {
  /** False = frameworks are not evaluated this scan (see startFrameworkEvaluation). */
  storageAvailable: boolean;
  runs: FrameworkRun[];
  /** Resources whose evaluation was stored / could not be stored. */
  persisted: number;
  failed: number;
  /** Per framework, how many check outcomes of each state were stored. */
  stateCounts: Record<string, Record<string, number>>;
}
import { OrphanedResourceDetectorService } from './orphanedResourceDetector';
import costOptimizationService from './cost-optimization.service';
import { CostRecommendationsRepository } from '../repositories/cost-recommendations.repository';
import { AccountSecurityFindingsRepository, AccountFindingCategory } from '../repositories/account-security-findings.repository';
import { securityAuditService } from './securityAudit.service';
import { PoolClient } from 'pg';
import { ResourceExplorerService, GENERIC_RESOURCE_TYPES, RE_RECONCILED_TYPES, NormalizedResourceEntry } from './resourceExplorer.service';
import { ResourceReconciliationService } from './resourceReconciliation.service';
import { ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY } from '../config/optimization-rules';
import { getBucketLifecycleStatus } from './s3-lifecycle.util';
import { estimateEBSMonthlyCost, estimateLambdaMonthlyCostFromUsage } from '../config/aws-pricing';
import { getLambdaUsageOverWindow, LAMBDA_USAGE_WINDOW_DAYS } from './lambda-usage.util';
import { describeDynamoDBTable } from './dynamodb-table.util';
import { describeDynamoDBAutoscaling } from './dynamodb-autoscaling.util';
import { describeAuroraClusters } from './aurora-cluster.util';
import { DISCOVERY_WARNING_TRUNCATED_INDEX, DiscoveryWarning, joinDiscoveryMessage } from './discovery-warnings';
import {
  S3SecurityEvaluation,
  carryForwardUnverifiedS3Findings,
  unknownS3Evaluation,
  newS3EvaluationTally,
  addToS3EvaluationTally,
  formatS3EvaluationTally,
} from './s3-security-evaluation';

/**
 * Resource types allowed by subscription tier
 */
const TIER_RESOURCE_TYPES: Record<SubscriptionTier, ResourceType[]> = {
  free: ['ec2', 'ebs', 'rds', 's3'], // 4 types - Core compute (+ its attached storage), database, storage
  starter: [
    'ec2',           // Compute instances
    'ebs',           // Block storage volumes
    'rds',           // Relational databases
    's3',            // Object storage
    'lambda',        // Serverless functions
    'ecs',           // Container orchestration
    'vpc',           // Virtual networks
    'load-balancer', // Load balancers
    'eks',           // Kubernetes clusters
    'dynamodb',      // NoSQL tables
    'cloudfront',    // CDN distributions
    'api-gateway',   // API Gateway REST APIs
    'elasticache',   // In-memory cache clusters
    'aurora',        // Aurora DB clusters
    'sqs',           // SQS queues
    'sns',           // SNS topics
  ], // 16 types
  pro: [
    'ec2', 'ebs', 'rds', 's3', 'lambda', 'ecs', 'vpc', 'load-balancer',
    'eks', 'dynamodb', 'cloudfront', 'api-gateway', 'elasticache', 'aurora', 'sqs', 'sns',
  ], // All 16 types
  enterprise: [
    'ec2', 'ebs', 'rds', 's3', 'lambda', 'ecs', 'vpc', 'load-balancer',
    'eks', 'dynamodb', 'cloudfront', 'api-gateway', 'elasticache', 'aurora', 'sqs', 'sns',
  ], // All 16 types
};

/** What a fatally failed discovery job stores in error_message, for the organization to read. */
export const DISCOVERY_FAILED_MESSAGE = 'Discovery could not complete. Check the AWS connection in Settings, then try again.';

/**
 * The user-safe error_message for a discovery run that failed before
 * finishing. Unprefixed, so the readiness discovery gate still treats it as
 * an unrecognized failure (observability-readiness.service.ts).
 */
export function fatalDiscoveryErrorMessage(error: unknown): string {
  return isPlatformAwsCredentialsUnavailable(error) ? PLATFORM_AWS_UNAVAILABLE_MESSAGE : DISCOVERY_FAILED_MESSAGE;
}

export class AWSResourceDiscoveryService {
  private resourceExplorer = new ResourceExplorerService();
  private reconciliation = new ResourceReconciliationService();
  // How the per-bucket, per-instance, per-volume and per-region AWS calls are made:
  // bounded concurrency, a time limit per call, throttled calls retried with backoff.
  private callPolicy: AwsCallPolicy = DEFAULT_AWS_CALL_POLICY;

  constructor(private pool: Pool) {}

  /**
   * The clients discovery makes its per-resource calls with, each call under
   * callPolicy (a time limit, and retries with backoff when throttled). Regional
   * clients are built once per region and reused.
   */
  private applyCallPolicy(clients: AWSClients): AWSClients {
    const regional = <T extends { send: (...args: any[]) => any }>(build?: (region: string) => T) => {
      if (!build) return undefined;
      const byRegion = new Map<string, T>();
      return (region: string): T => {
        let client = byRegion.get(region);
        if (!client) {
          client = withCallPolicy(build(region), this.callPolicy);
          byRegion.set(region, client);
        }
        return client;
      };
    };
    return {
      ...clients,
      ec2: withCallPolicy(clients.ec2, this.callPolicy),
      s3: withCallPolicy(clients.s3, this.callPolicy),
      backup: withCallPolicy(clients.backup, this.callPolicy),
      getS3ClientForRegion: regional(clients.getS3ClientForRegion),
    };
  }

  /**
   * Get organization's subscription tier
   */
  /**
   * The organization's framework applicability for this scan. A failed settings
   * read is reported as 'unavailable' for every framework and logged; it is not
   * rethrown, because the baseline checks do not depend on it, and it is never
   * resolved to enabled or to disabled.
   */
  private async resolveFrameworkApplicability(client: PoolClient, organizationId: string): Promise<FrameworkApplicability[]> {
    try {
      const rows = await readBuiltInFrameworkSettings(client, organizationId);
      return resolveFrameworkApplicability({ status: 'ok', rows });
    } catch (error: any) {
      console.error(`❌ [Discovery] Framework settings could not be read; framework checks not evaluated:`, error.message);
      return resolveFrameworkApplicability({ status: 'unavailable' });
    }
  }

  /**
   * Opens one run per registered framework, or establishes that there is nowhere
   * to store an evaluation.
   *
   * STORAGE UNAVAILABLE (the evaluation tables do not exist, or a run cannot be
   * written). For this scan: no framework check is evaluated; nothing is written
   * to the evaluation tables; each resource's baseline findings are refreshed and
   * its existing framework findings are left exactly as they are. One error line
   * with the token FRAMEWORK_EVAL_STORAGE_UNAVAILABLE is logged per scan, and the
   * API reports the storage as unavailable instead of describing those findings
   * as current. The first scan after the storage exists opens a run and rebuilds
   * every resource's framework findings from what it then stores.
   */
  private async startFrameworkEvaluation(
    client: PoolClient,
    organizationId: string,
    jobId: string,
    applicability: FrameworkApplicability[]
  ): Promise<FrameworkEvaluationScan> {
    const scan: FrameworkEvaluationScan = { storageAvailable: false, runs: [], persisted: 0, failed: 0, stateCounts: {} };
    try {
      if (!(await frameworkEvaluationStorageAvailable(client))) {
        console.error(
          `❌ [Discovery] FRAMEWORK_EVAL_STORAGE_UNAVAILABLE: the framework evaluation tables do not exist; ` +
          `frameworks were not evaluated and existing framework findings were kept unverified.`
        );
        return scan;
      }
      // Only registered frameworks get a run: a setting that names anything else is
      // reported in the applicability log line and evaluated by nothing.
      const registered = new Set(REGISTERED_FRAMEWORKS.map((f) => f.key));
      for (const framework of applicability.filter((a) => registered.has(a.framework))) {
        scan.runs.push(
          await startFrameworkRun(client, {
            organizationId,
            framework: framework.framework,
            applicability: framework.state,
            reasonCode: framework.reason_code,
            discoveryJobId: jobId,
            evaluatorVersion: FRAMEWORK_EVALUATOR_VERSION,
          })
        );
      }
      scan.storageAvailable = true;
      return scan;
    } catch (error: any) {
      console.error(
        `❌ [Discovery] FRAMEWORK_EVAL_STORAGE_UNAVAILABLE: a framework evaluation run could not be started; ` +
        `frameworks were not evaluated and existing framework findings were kept unverified:`,
        error.message
      );
      // Runs opened before the failure are closed: a run that will store nothing must
      // not be left looking as though it is in progress.
      await this.failFrameworkEvaluation(client, organizationId, scan);
      return { ...scan, storageAvailable: false, runs: [] };
    }
  }

  /**
   * Stores one resource's framework evaluation and writes its findings.
   *
   *   stored (one transaction)   compliance_issues = baseline + the stored failures.
   *   resource gone              nothing to write.
   *   lock timeout               another scan holds the resource and is writing it;
   *                              this scan writes nothing for it.
   *   any other failure          the transaction rolled back, so the check rows and the
   *                              framework findings are both still what they were. The
   *                              baseline findings are then written on their own, with
   *                              the framework findings left untouched.
   *
   * In both failure cases the resource counts as failed (the run ends 'partial'),
   * its check rows keep their older generation (so they read as stale once this
   * run finishes), and a reconciliation marker is recorded. The next scan retries
   * the resource; nothing here retries in a loop.
   */
  private async persistResourceCompliance(
    client: PoolClient,
    organizationId: string,
    scanner: ComplianceScannerService,
    resource: AWSResource,
    baselineIssues: ComplianceIssue[],
    frameworkEvaluations: FrameworkCheckEvaluation[],
    scan: FrameworkEvaluationScan
  ): Promise<void> {
    if (!scan.storageAvailable) {
      await writeBaselinePreservingFrameworkFindings(client, { organizationId, resourceId: resource.id, baselineIssues });
      return;
    }

    const result = await persistResourceEvaluation(client, {
      organizationId,
      resourceId: resource.id,
      evaluatorVersion: FRAMEWORK_EVALUATOR_VERSION,
      baselineIssues,
      frameworks: scan.runs.map((run) => ({
        run,
        evaluations: frameworkEvaluations.filter((e) => e.framework === run.framework && e.check !== null),
        registeredCheckKeys: scanner.registeredCheckKeys(run.framework),
      })),
      project: (failures) =>
        failures.map((failure) => scanner.frameworkFinding(resource, failure.framework, failure.check, failure)),
    });

    if (result.outcome === 'resource_missing') return;

    if (result.outcome === 'persisted') {
      scan.persisted++;
      for (const evaluation of frameworkEvaluations) {
        if (evaluation.check === null) continue;
        const counts = (scan.stateCounts[evaluation.framework] ??= {});
        counts[evaluation.evaluation_state] = (counts[evaluation.evaluation_state] ?? 0) + 1;
      }
      return;
    }

    scan.failed++;
    console.error(
      `[Discovery] Framework evaluation for ${resource.resource_arn} could not be stored (${result.failureCode}); ` +
      `previous framework findings kept.`
    );
    // Each of the two statements below is independent of the other and of the scan:
    // a failure of either is logged and the scan goes on to the next resource.
    const newestGeneration = scan.runs.reduce((max, run) => (BigInt(run.generation) > BigInt(max) ? run.generation : max), '0');
    await recordReconciliationRequired(client, {
      organizationId,
      resourceId: resource.id,
      failureCode: result.failureCode,
      generation: newestGeneration,
    }).catch((error: any) => {
      console.error(`[Discovery] Could not record the reconciliation marker for ${resource.resource_arn}:`, error.message);
    });
    if (result.failureCode !== 'lock_timeout') {
      await writeBaselinePreservingFrameworkFindings(client, { organizationId, resourceId: resource.id, baselineIssues }).catch(
        (error: any) => {
          console.error(`[Discovery] Could not write baseline findings for ${resource.resource_arn}:`, error.message);
        }
      );
    }
  }

  private async heartbeatFrameworkEvaluation(client: PoolClient, organizationId: string, scan: FrameworkEvaluationScan): Promise<void> {
    for (const run of scan.runs) {
      await heartbeatFrameworkRun(client, organizationId, run.id).catch(() => {});
    }
  }

  /** complete when every resource was stored, partial otherwise -- the same count the stale rule follows from. */
  private async finishFrameworkEvaluation(
    client: PoolClient,
    organizationId: string,
    scan: FrameworkEvaluationScan,
    inScope: number
  ): Promise<void> {
    for (const run of scan.runs) {
      const finished = await finishFrameworkRun(client, organizationId, run.id, {
        inScope,
        persisted: scan.persisted,
        failed: scan.failed,
        stateCounts: scan.stateCounts[run.framework] ?? {},
      });
      if (!finished) {
        console.error(`[Discovery] Framework evaluation run for ${run.framework} was closed before it finished; its stored results stand.`);
      }
    }
  }

  /** Best effort: the scan is already failing, and a run left 'running' is closed as abandoned by a later scan. */
  private async failFrameworkEvaluation(client: PoolClient, organizationId: string, scan: FrameworkEvaluationScan): Promise<void> {
    for (const run of scan.runs) {
      await failFrameworkRun(client, organizationId, run.id, 'unexpected').catch(() => {});
    }
  }

  private async getOrganizationTier(organizationId: string, executor?: PoolClient): Promise<SubscriptionTier> {
    const result = await (executor ?? this.pool).query(
      'SELECT subscription_tier FROM organizations WHERE id = $1 AND deleted_at IS NULL',
      [organizationId]
    );

    if (result.rows.length === 0) {
      return 'free'; // Default to free if org not found
    }

    return (result.rows[0].subscription_tier as SubscriptionTier) || 'free';
  }

  /**
   * Get allowed resource types for a subscription tier
   */
  private getAllowedResourceTypes(tier: SubscriptionTier): ResourceType[] {
    return TIER_RESOURCE_TYPES[tier] || TIER_RESOURCE_TYPES.free;
  }

  /**
   * Check if a resource type is allowed for the organization's tier
   */
  private isResourceTypeAllowed(resourceType: ResourceType, allowedTypes: ResourceType[]): boolean {
    return allowedTypes.includes(resourceType);
  }

  /**
   * Discover all AWS resources for an organization
   * Creates a discovery job and scans resources based on subscription tier
   */
  async discoverAllResources(organizationId: string): Promise<DiscoveryResult> {
    console.log(`\n🔍 [Discovery] Starting AWS resource discovery for organization: ${organizationId}`);

    // Discovery always runs on its own connection and binds it as the ambient
    // requestContext for its whole duration. Callers like POST /api/aws/accounts
    // start this fire-and-forget from inside an authenticated request, whose
    // requestContext client is released as soon as the response is sent --
    // without this rebinding, every ambient pool.query() below (e.g.
    // AWSClientFactory) would keep running on that released connection,
    // which the pool may by then have handed to another org's request.
    const client = await this.pool.connect();
    return requestContext.run(client, () => this.runDiscovery(organizationId, client));
  }

  private async runDiscovery(organizationId: string, client: PoolClient): Promise<DiscoveryResult> {
    let jobId: string;

    try {
      // NOTE: must be session-scoped (is_local = false), not transaction-local.
      // This method issues many separate statements on `client` with no wrapping
      // BEGIN/COMMIT, so each one auto-commits its own implicit transaction — a
      // `true` (local) setting reverts the instant this SELECT's transaction ends,
      // leaving every later statement (including the resource_discovery_jobs INSERT)
      // without the org context RLS requires.
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [organizationId]
      );

      // Get organization's subscription tier
      const tier = await this.getOrganizationTier(organizationId, client);
      const allowedTypes = this.getAllowedResourceTypes(tier);

      console.log(`🎫 [Discovery] Subscription tier: ${tier}`);
      console.log(`📦 [Discovery] Allowed resource types: ${allowedTypes.join(', ')}`);

      // Create discovery job with allowed resource types
      const jobResult = await client.query(
        `INSERT INTO resource_discovery_jobs (organization_id, status, started_at, resource_types, regions)
         VALUES ($1, $2, NOW(), $3, $4)
         RETURNING id`,
        [
          organizationId,
          'running' as DiscoveryJobStatus,
          allowedTypes,
          [] // Will be populated during discovery
        ]
      );
      jobId = jobResult.rows[0].id;
      console.log(`📋 [Discovery] Created discovery job: ${jobId}`);

      // The scan's account context: one AssumeRole for discovery and the cost
      // detectors, refreshed before it expires (scan-context.ts).
      const scanContext = await ScanContext.forOrg(organizationId);
      const connectedClients = scanContext.clientsFor(scanContext.region);

      if (!connectedClients.enabled) {
        throw new Error('AWS credentials not configured for this organization');
      }
      const awsClients = this.applyCallPolicy(connectedClients);

      console.log(`✅ [Discovery] AWS clients created successfully`);
      console.log(`🌍 [Discovery] Target region: ${awsClients.region}`);

      // Security Truthfulness #41: one shared per-run AWS Backup evidence cache, so an
      // EC2 instance's own has_backup lookup and every attached EBS volume's
      // parent-instance fallback lookup reuse a single AWS call per unique ARN instead of
      // re-querying AWS Backup for the same instance multiple times. AWS Backup has no
      // multi-ARN batch API -- this cache is the only available N+1 mitigation.
      const checkBackupEvidence = createAwsBackupEvidenceCache(awsClients.backup!);

      const errors: string[] = [];
      // Checks deliberately not run this cycle; they do not fail the job (see discovery-warnings.ts).
      const warnings: DiscoveryWarning[] = [];
      let totalDiscovered = 0;
      let totalUpdated = 0;
      let resourcesTerminated = 0;
      const skippedTypes: string[] = [];

      // Discover EC2 instances
      if (this.isResourceTypeAllowed('ec2', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering EC2 instances...`);
        try {
          const ec2Resources = await this.discoverEC2Instances(organizationId, awsClients.ec2!, awsClients.region, awsClients.accountId, checkBackupEvidence);
          for (const resource of ec2Resources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${ec2Resources.length} EC2 instances`);
        } catch (error: any) {
          console.error(`❌ [Discovery] EC2 discovery failed:`, error.message);
          errors.push(`EC2: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping EC2 instances (not available in ${tier} tier)`);
        skippedTypes.push('ec2');
      }

      // Discover EBS volumes. Own dedicated discovery + reconcile() call
      // (same pattern as S3/CloudFront below) rather than folding into the
      // generic Resource Explorer path -- EBS needs real per-volume metadata
      // (size, type, state) for the ebs_unattached analyzer, which the
      // generic path's ARN-only presence signal can't provide.
      let ebsDiscoverySucceeded = false;
      const ebsArnsFound = new Set<string>();
      if (this.isResourceTypeAllowed('ebs', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering EBS volumes...`);
        try {
          const ebsResources = await this.discoverEBSVolumes(organizationId, awsClients.ec2!, awsClients.region, awsClients.accountId, checkBackupEvidence);
          for (const resource of ebsResources) {
            ebsArnsFound.add(resource.resource_arn);
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          ebsDiscoverySucceeded = true;
          console.log(`✅ [Discovery] Found ${ebsResources.length} EBS volumes`);
        } catch (error: any) {
          console.error(`❌ [Discovery] EBS discovery failed:`, error.message);
          errors.push(`EBS: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping EBS volumes (not available in ${tier} tier)`);
        skippedTypes.push('ebs');
      }

      // Discover RDS databases
      if (this.isResourceTypeAllowed('rds', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering RDS databases...`);
        try {
          const rdsResources = await this.discoverRDSDatabases(organizationId, awsClients.rds!, awsClients.region);
          for (const resource of rdsResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${rdsResources.length} RDS databases`);
        } catch (error: any) {
          console.error(`❌ [Discovery] RDS discovery failed:`, error.message);
          errors.push(`RDS: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping RDS databases (not available in ${tier} tier)`);
        skippedTypes.push('rds');
      }

      // Discover S3 buckets. Kept as its own dedicated discovery (not folded into the
      // generic Resource Explorer path) because ListBuckets is account-wide and
      // region-independent, while Resource Explorer's Search is scoped to a single
      // region's LOCAL index — see resourceExplorer.service.ts's OWN_DISCOVERY_CFN_TYPES
      // doc comment. s3ArnsFound feeds S3's own reconcile() call below instead of relying
      // on the (region-limited) Resource Explorer search for S3 presence.
      let s3DiscoverySucceeded = false;
      const s3ArnsFound = new Set<string>();
      if (this.isResourceTypeAllowed('s3', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering S3 buckets...`);
        try {
          const unlocatedBucketArns = new Set<string>();
          const s3Resources = await this.discoverS3Buckets(
            organizationId, awsClients.s3!, awsClients.region, awsClients.getS3ClientForRegion, unlocatedBucketArns
          );
          for (const resource of s3Resources) {
            // Listed, so present: never counted missing.
            s3ArnsFound.add(resource.resource_arn);
            // Its region is unknown, though. A stored row keeps its stored region (the
            // upsert never changes it); no new row is written with a guessed region.
            if (unlocatedBucketArns.has(resource.resource_arn) && !(await this.resourceStored(client, organizationId, resource.resource_arn))) {
              continue;
            }
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          s3DiscoverySucceeded = true;
          console.log(`✅ [Discovery] Found ${s3Resources.length} S3 buckets`);
        } catch (error: any) {
          console.error(`❌ [Discovery] S3 discovery failed:`, error.message);
          errors.push(`S3: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping S3 buckets (not available in ${tier} tier)`);
        skippedTypes.push('s3');
      }

      // Discover Lambda functions
      if (this.isResourceTypeAllowed('lambda', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering Lambda functions...`);
        try {
          const lambdaResources = await this.discoverLambdaFunctions(organizationId, awsClients.lambda, awsClients.cloudWatch, awsClients.region);
          for (const resource of lambdaResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${lambdaResources.length} Lambda functions`);
        } catch (error: any) {
          console.error(`❌ [Discovery] Lambda discovery failed:`, error.message);
          errors.push(`Lambda: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping Lambda functions (not available in ${tier} tier)`);
        skippedTypes.push('lambda');
      }

      // Discover Load Balancers
      if (this.isResourceTypeAllowed('load-balancer', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering Load Balancers...`);
        try {
          const lbResources = await this.discoverLoadBalancers(organizationId, awsClients.elb, awsClients.region);
          for (const resource of lbResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${lbResources.length} Load Balancers`);
        } catch (error: any) {
          console.error(`❌ [Discovery] Load Balancer discovery failed:`, error.message);
          errors.push(`Load Balancer: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping Load Balancers (not available in ${tier} tier)`);
        skippedTypes.push('load-balancer');
      }

      // Discover CloudFront distributions. Kept as its own dedicated discovery, pinned to
      // us-east-1 regardless of the org's configured region — CloudFront is a global service
      // and live-testing confirmed Resource Explorer only indexes global-service resources
      // via the us-east-1 index (a truly-global IAM resource appeared in a us-east-1 search
      // but not in an ap-southeast-1 search of the same account). A generic search scoped to
      // the org's own region would silently find zero CloudFront distributions for any org
      // whose configured region isn't us-east-1. See OWN_DISCOVERY_CFN_TYPES.
      let cloudFrontDiscoverySucceeded = false;
      const cloudFrontArnsFound = new Set<string>();
      if (this.isResourceTypeAllowed('cloudfront', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering CloudFront distributions...`);
        try {
          const cfResources = await this.discoverCloudFrontDistributions(organizationId, awsClients.cloudFront);
          for (const resource of cfResources) {
            cloudFrontArnsFound.add(resource.resource_arn);
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          cloudFrontDiscoverySucceeded = true;
          console.log(`✅ [Discovery] Found ${cfResources.length} CloudFront distributions`);
        } catch (error: any) {
          console.error(`❌ [Discovery] CloudFront discovery failed:`, error.message);
          errors.push(`CloudFront: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping CloudFront distributions (not available in ${tier} tier)`);
        skippedTypes.push('cloudfront');
      }

      // Generic resource inventory via AWS Resource Explorer (Phase 2B): replaces the old
      // Describe*-based discovery for every type that isn't deep-monitored and doesn't have
      // its own dedicated discovery (ecs, vpc, eks, dynamodb, api-gateway, elasticache, aurora,
      // sqs, sns). S3 and CloudFront are deliberately excluded — see their own discovery blocks
      // above. A single Search call both populates these generic rows AND supplies the presence
      // signal that reconciliation uses to conservatively terminate stale rows for every type
      // it's a valid signal for (RE_RECONCILED_TYPES) — see resourceReconciliation.service.ts
      // for why a failed Search here must never advance any resource's missing_scan_count.
      const allowedGenericTypes = GENERIC_RESOURCE_TYPES.filter((t) => this.isResourceTypeAllowed(t, allowedTypes));
      const skippedGenericTypes = GENERIC_RESOURCE_TYPES.filter((t) => !allowedGenericTypes.includes(t));
      skippedGenericTypes.forEach((t) => {
        console.log(`⏭️  [Discovery] Skipping ${t} (not available in ${tier} tier)`);
        skippedTypes.push(t);
      });

      console.log(`🔎 [Discovery] Searching AWS Resource Explorer for generic inventory + reconciliation...`);
      const searchResult = await this.resourceExplorer.search(awsClients.resourceExplorer, awsClients.region);

      if (searchResult.success) {
        const { allArns, genericEntries } = this.resourceExplorer.normalize(searchResult.resources, awsClients.region);
        const allowedEntries = genericEntries.filter((e) => allowedGenericTypes.includes(e.resourceType));

        try {
          for (const entry of allowedEntries) {
            const result = await this.upsertGenericResource(client, organizationId, entry);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${allowedEntries.length} generic resources via Resource Explorer (${searchResult.resources.length} total indexed)`);
        } catch (error: any) {
          console.error(`❌ [Discovery] Resource Explorer generic upsert failed:`, error.message);
          errors.push(`Resource Explorer inventory: ${error.message}`);
        }

        try {
          const dynamoDbEntries = allowedEntries.filter((e) => e.resourceType === 'dynamodb');
          if (dynamoDbEntries.length > 0) {
            const enrichedCount = await this.enrichDynamoDBTables(organizationId, client, awsClients, dynamoDbEntries);
            console.log(`✅ [Discovery] Enriched ${enrichedCount} of ${dynamoDbEntries.length} DynamoDB table(s) with real configuration`);
          }
        } catch (error: any) {
          console.error(`❌ [Discovery] DynamoDB enrichment failed:`, error.message);
          errors.push(`DynamoDB enrichment: ${error.message}`);
        }

        try {
          const auroraEntries = allowedEntries.filter((e) => e.resourceType === 'aurora');
          if (auroraEntries.length > 0) {
            const { confirmed, reclassified } = await this.enrichAuroraClusters(organizationId, client, awsClients.rds!, auroraEntries);
            console.log(`✅ [Discovery] Confirmed ${confirmed} Aurora cluster(s), reclassified ${reclassified} non-Aurora DB cluster(s) out of 'aurora'`);
          }
        } catch (error: any) {
          console.error(`❌ [Discovery] Aurora cluster enrichment failed:`, error.message);
          errors.push(`Aurora cluster enrichment: ${error.message}`);
        }

        if (!searchResult.complete) {
          // The search may have been cut off (see SearchResult): the resources it did return
          // are real and were upserted above, but a resource missing from it may simply be
          // past the cut-off. No row's missing_scan_count moves this cycle. A large account
          // always lands here, so it is a warning, not a failure: the inventory still refreshed.
          console.warn(
            `⚠️  [Discovery] Resource Explorer search may be truncated (${searchResult.resources.length} results), reconciliation skipped`
          );
          warnings.push(DISCOVERY_WARNING_TRUNCATED_INDEX);
        } else {
          try {
            const reconciliation = await this.reconciliation.reconcile(client, organizationId, awsClients.region, allArns, RE_RECONCILED_TYPES);
            console.log(
              `✅ [Discovery] Reconciliation complete (${reconciliation.resetCount} confirmed present, ` +
              `${reconciliation.incrementedCount} absent this scan, ${reconciliation.terminatedArns.length} newly terminated)`
            );
            resourcesTerminated += reconciliation.terminatedArns.length;
          } catch (error: any) {
            console.error(`❌ [Discovery] Reconciliation failed:`, error.message);
            errors.push(`Reconciliation: ${error.message}`);
          }
        }
      } else {
        // Search itself failed (no index/view provisioned, throttling, permission error, etc.) —
        // this is "no data this cycle", not "everything is gone". Skip both the generic upsert
        // and reconciliation entirely; every aws_resources row keeps its last-known-good state.
        console.error(`❌ [Discovery] Resource Explorer search failed, skipping generic inventory + reconciliation:`, searchResult.error);
        errors.push(`Resource Explorer: ${searchResult.error}`);
      }

      // S3 and CloudFront each get their own independent reconcile() call using their own
      // dedicated discovery's ARN list — see the doc comments on their discovery blocks above
      // for why the Resource Explorer search above isn't a valid presence signal for them.
      // region: null because S3 buckets can each live in a different region than the org's
      // configured region, and CloudFront rows are always stored with region='global'.
      if (s3DiscoverySucceeded) {
        try {
          const s3Reconciliation = await this.reconciliation.reconcile(client, organizationId, null, s3ArnsFound, ['s3']);
          console.log(
            `✅ [Discovery] S3 reconciliation complete (${s3Reconciliation.resetCount} confirmed present, ` +
            `${s3Reconciliation.incrementedCount} absent this scan, ${s3Reconciliation.terminatedArns.length} newly terminated)`
          );
          resourcesTerminated += s3Reconciliation.terminatedArns.length;
        } catch (error: any) {
          console.error(`❌ [Discovery] S3 reconciliation failed:`, error.message);
          errors.push(`S3 reconciliation: ${error.message}`);
        }
      }

      if (cloudFrontDiscoverySucceeded) {
        try {
          const cfReconciliation = await this.reconciliation.reconcile(client, organizationId, null, cloudFrontArnsFound, ['cloudfront']);
          console.log(
            `✅ [Discovery] CloudFront reconciliation complete (${cfReconciliation.resetCount} confirmed present, ` +
            `${cfReconciliation.incrementedCount} absent this scan, ${cfReconciliation.terminatedArns.length} newly terminated)`
          );
          resourcesTerminated += cfReconciliation.terminatedArns.length;
        } catch (error: any) {
          console.error(`❌ [Discovery] CloudFront reconciliation failed:`, error.message);
          errors.push(`CloudFront reconciliation: ${error.message}`);
        }
      }

      if (ebsDiscoverySucceeded) {
        try {
          const ebsReconciliation = await this.reconciliation.reconcile(client, organizationId, awsClients.region, ebsArnsFound, ['ebs']);
          console.log(
            `✅ [Discovery] EBS reconciliation complete (${ebsReconciliation.resetCount} confirmed present, ` +
            `${ebsReconciliation.incrementedCount} absent this scan, ${ebsReconciliation.terminatedArns.length} newly terminated)`
          );
          resourcesTerminated += ebsReconciliation.terminatedArns.length;
        } catch (error: any) {
          console.error(`❌ [Discovery] EBS reconciliation failed:`, error.message);
          errors.push(`EBS reconciliation: ${error.message}`);
        }
      }

      // Compliance scan: evaluate every currently-known resource for this org against
      // real encryption/public-access/backup/tag checks, plus the checks of any framework
      // the organization has explicitly enabled, persisting genuine
      // compliance_issues instead of the stubbed always-[] value. Excludes soft-terminated
      // rows (see resourceReconciliation.service.ts / ResourceReconciliationService, NOT
      // touched by this line) — a resource AWS no longer has can't be re-scanned for real
      // encryption/public-access state, and doing so would waste AWS API calls and could
      // overwrite its last-known compliance_issues with a scan against a gone resource.
      let complianceScanCompleted = false;
      try {
        console.log(`🔎 [Discovery] Running compliance scan...`);
        const scanner = new ComplianceScannerService();
        const { rows: allResources } = await client.query(
          `SELECT * FROM aws_resources WHERE organization_id = $1 AND status != 'terminated'`,
          [organizationId]
        );

        // Framework checks run only for a framework this organization has explicitly
        // enabled. Settings that are missing, unreadable or uninterpretable are each
        // their own state, and none of them is treated as enabled.
        const frameworkApplicability = await this.resolveFrameworkApplicability(client, organizationId);
        console.log(
          `🧭 [Discovery] Framework applicability: ` +
          frameworkApplicability.map((f) => `${f.framework}=${f.state} (${f.reason_code})`).join(', ')
        );
        // Framework outcomes are stored in their own tables, and the framework findings
        // in compliance_issues are rebuilt from what is stored. When there is nowhere to
        // store them, frameworks are NOT evaluated this scan: see the storage-unavailable
        // branch below.
        const evaluation = await this.startFrameworkEvaluation(client, organizationId, jobId, frameworkApplicability);

        // Each bucket's S3 security evaluation is several AWS calls. They are made
        // ahead of the loop below, a bounded number of buckets at a time, so the loop
        // (which writes to the database one resource after another) does not wait on
        // AWS bucket by bucket. A bucket whose evaluation throws is settled here as an
        // error for that bucket alone.
        type S3Outcome = { result: Awaited<ReturnType<ComplianceScannerService['evaluateS3Security']>> } | { error: any };
        const s3Resources = (allResources as AWSResource[]).filter((resource) => resource.resource_type === 's3');
        const s3Outcomes = new Map<string, S3Outcome>();
        await mapWithConcurrency(s3Resources, this.callPolicy.concurrency, async (resource) => {
          try {
            // Read in the bucket's own region (its stored region, normalized for rows
            // written before 'EU' was mapped to eu-west-1).
            const bucketClient = this.s3ClientInRegion(
              awsClients.s3!,
              awsClients.region,
              awsClients.getS3ClientForRegion,
              regionFromLocationConstraint(resource.region)
            );
            const result = await scanner.evaluateS3Security(resource, bucketClient, {
              s3Control: awsClients.s3Control,
              accountId: awsClients.accountId,
            });
            s3Outcomes.set(resource.id, { result });
          } catch (error: any) {
            s3Outcomes.set(resource.id, { error });
          }
        });

        const s3Tally = newS3EvaluationTally();
        let scanned = 0;
        try {
          for (const resource of allResources as AWSResource[]) {
            const evaluated = evaluation.storageAvailable
              ? await scanner.evaluateResource(resource, frameworkApplicability)
              : { baselineIssues: scanner.evaluateBaseline(resource), frameworkEvaluations: [] };
            const baselineIssues = [...evaluated.baselineIssues];

            if (resource.resource_type === 's3') {
              let s3Evaluation: S3SecurityEvaluation;
              try {
                const outcome = s3Outcomes.get(resource.id)!;
                if ('error' in outcome) throw outcome.error;
                const result = outcome.result;
                s3Evaluation = result!.evaluation;
                baselineIssues.push(...result!.issues);
              } catch (error: any) {
                console.error(`[Discovery] S3 security evaluation failed for ${resource.resource_arn}:`, error.message);
                s3Evaluation = unknownS3Evaluation('evaluation failed');
                baselineIssues.push(...carryForwardUnverifiedS3Findings(resource.compliance_issues, s3Evaluation, 'exception'));
              }
              addToS3EvaluationTally(s3Tally, s3Evaluation);
            }

            await this.persistResourceCompliance(client, organizationId, scanner, resource, baselineIssues, evaluated.frameworkEvaluations, evaluation);

            scanned++;
            if (scanned % 25 === 0) await this.heartbeatFrameworkEvaluation(client, organizationId, evaluation);
          }
        } catch (error) {
          await this.failFrameworkEvaluation(client, organizationId, evaluation);
          throw error;
        }
        await this.finishFrameworkEvaluation(client, organizationId, evaluation, allResources.length);

        if (s3Tally.buckets > 0) {
          console.log(`🪣 [Discovery] S3 security evaluation: ${formatS3EvaluationTally(s3Tally)}`);
        }
        if (Object.keys(evaluation.stateCounts).length > 0) {
          console.log(
            `🧭 [Discovery] Framework check outcomes: ` +
            Object.entries(evaluation.stateCounts)
              .flatMap(([framework, counts]) => Object.entries(counts).map(([state, count]) => `${framework} ${state}=${count}`))
              .join(', ')
          );
        }
        if (evaluation.failed > 0) {
          console.error(
            `❌ [Discovery] FRAMEWORK_EVAL_RECONCILIATION_REQUIRED: the framework evaluation of ${evaluation.failed} ` +
            `resource(s) could not be stored; their previous findings were kept and are reported as not re-verified.`
          );
        }
        console.log(`✅ [Discovery] Compliance scan complete (${allResources.length} resources scanned)`);
        complianceScanCompleted = true;
      } catch (error: any) {
        console.error(`❌ [Discovery] Compliance scan failed:`, error.message);
        errors.push(`Compliance scan: ${error.message}`);
      }

      // Account-level security findings: security groups and IAM users aren't rows in
      // aws_resources, so these run once per org (not per-resource) against the same
      // org-scoped AWS clients, persisting into account_security_findings instead.
      //
      // Networking (checkSecurityGroups) and IAM (checkIAMSecurity) are scanned and
      // caught independently — deliberately not a combined Promise.all/try-catch —
      // so an unrelated IAM failure (e.g. AccessDenied on ListUsers) can't discard
      // otherwise-valid, already-collected security-group findings, and vice versa.
      // Only a category whose scan actually completed is allowed to resolve that
      // category's stale findings; a partial/failed scan's findings are still
      // upserted (real evidence is real evidence) but can never imply absence.
      securityAuditService
        .record({ organizationId, action: 'security.scan.started' })
        .catch(() => {});

      try {
        console.log(`🔎 [Discovery] Running account-level security scan (security groups + IAM)...`);
        const scanner = new ComplianceScannerService();
        const scanStartedAt = new Date();

        const networkingObservation = await scanner
          .checkSecurityGroups(awsClients.ec2!, awsClients.region, awsClients.accountId)
          .catch((error: any) => {
            console.error(`❌ [Discovery] Security group scan failed:`, error.message);
            errors.push(`Security group scan: ${error.message}`);
            return { category: 'networking' as const, complete: false, issues: [] };
          });

        // checkIAMSecurity now returns the same CategoryObservation shape as
        // checkSecurityGroups (previously it threw on any per-user failure,
        // discarding findings from users already successfully processed
        // earlier in that same call — see complianceScanner.ts). `.complete`
        // is the honest completeness signal now; "didn't throw" is no longer
        // how success is defined here.
        const iamObservation = await scanner
          .checkIAMSecurity(awsClients.iam!)
          .catch((error: any) => {
            console.error(`❌ [Discovery] IAM security scan failed:`, error.message);
            errors.push(`IAM security scan: ${error.message}`);
            return { category: 'iam' as const, complete: false, issues: [] };
          });

        const findingsRepo = new AccountSecurityFindingsRepository();
        const findings = AccountSecurityFindingsRepository.fromComplianceIssues(
          [...networkingObservation.issues, ...iamObservation.issues],
          awsClients.region
        );
        const completeCategories: AccountFindingCategory[] = [
          ...(networkingObservation.complete ? (['networking'] as const) : []),
          ...(iamObservation.complete ? (['iam'] as const) : []),
        ];
        const { active, resolved } = await findingsRepo.reconcileScan(
          organizationId,
          scanStartedAt,
          findings,
          completeCategories
        );

        const fullyComplete = networkingObservation.complete && iamObservation.complete;
        if (!fullyComplete) {
          complianceScanCompleted = false;
        }
        securityAuditService
          .record({
            organizationId,
            action: fullyComplete ? 'security.scan.completed' : 'security.scan.partial',
            metadata: { active, resolved, networkingComplete: networkingObservation.complete, iamComplete: iamObservation.complete },
          })
          .catch(() => {});

        console.log(
          `✅ [Discovery] Account-level security scan ${fullyComplete ? 'complete' : 'partial'} (${active} active, ${resolved} resolved)`
        );
      } catch (error: any) {
        console.error(`❌ [Discovery] Account-level security scan failed:`, error.message);
        errors.push(`Account-level security scan: ${error.message}`);
        complianceScanCompleted = false;
        securityAuditService
          .record({ organizationId, action: 'security.scan.failed', metadata: { error: error.message } })
          .catch(() => {});
      }

      // Orphaned-resource detection: identify stopped/unused resources from what's
      // already synced, persisting real is_orphaned / orphaned_monthly_savings instead
      // of the stubbed always-0 orphaned_count.
      try {
        console.log(`🔎 [Discovery] Running orphaned-resource detection...`);
        const detector = new OrphanedResourceDetectorService(client);
        const orphaned = await detector.detectOrphaned(organizationId);

        await client.query(
          `UPDATE aws_resources SET is_orphaned = false, orphaned_monthly_savings = 0 WHERE organization_id = $1`,
          [organizationId]
        );

        for (const o of orphaned) {
          await client.query(
            `UPDATE aws_resources SET is_orphaned = true, orphaned_monthly_savings = $1 WHERE id = $2`,
            [o.potential_savings, o.resource.id]
          );
        }

        console.log(`✅ [Discovery] Orphaned-resource detection complete (${orphaned.length} found)`);
      } catch (error: any) {
        console.error(`❌ [Discovery] Orphaned-resource detection failed:`, error.message);
        errors.push(`Orphaned detection: ${error.message}`);
        complianceScanCompleted = false;
      }

      // Cost optimization analysis: run the same CloudWatch/EC2/RDS checks the manual
      // "Analyze Costs" button triggers, persisting real cost_recommendations instead
      // of leaving the table permanently empty (it previously had no automatic trigger).
      let costAnalysisCompleted = false;
      try {
        console.log(`🔎 [Discovery] Running cost optimization analysis...`);
        const { observations, riRecommendations, riSucceeded } = await costOptimizationService.analyzeAllResources(organizationId, scanContext);

        const recommendationsRepo = new CostRecommendationsRepository();

        // Occurrence-lifecycle reconciliation for the 3 resource-level
        // detectors -- mirrors the manual /api/cost-recommendations/analyze
        // path (cost-recommendations.controller.ts): suppresses an unchanged
        // Resolve/Dismiss'd finding instead of resurrecting it every scan.
        const { insertedCount: nonRIInsertedCount } = await recommendationsRepo.reconcileActiveRecommendations(
          organizationId,
          observations
        );

        // Reserved Instance Opportunities stay on delete+recreate -- excluded from
        // the occurrence lifecycle, see cost-optimization.service.ts -- but only
        // when the RI check completed: a failed check is no answer, and the stored
        // RI rows stay as they are.
        let riInsertedCount = 0;
        if (riSucceeded) {
          await recommendationsRepo.deleteActiveByIssue(organizationId, ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY);
          riInsertedCount = await recommendationsRepo.createBulk(riRecommendations, organizationId);
        }

        const insertedCount = nonRIInsertedCount + riInsertedCount;
        const totalFound = observations.reduce((sum, o) => sum + o.recommendations.length, 0) + riRecommendations.length;

        // first_insight_generated: mirrors the manual /api/cost-recommendations/analyze
        // path (cost-recommendations.controller.ts) so an org whose first-ever
        // recommendations arrive from this scheduled scan -- not a manual click --
        // still fires the funnel event. Guarded once-per-org by trackFunnelEventOnce,
        // so a later scan (manual or scheduled) for the same org never re-fires it.
        if (insertedCount > 0) {
          const stats = await recommendationsRepo.getStats(organizationId);
          await trackFunnelEventOnce({
            organizationId,
            eventName: 'first_insight_generated',
            properties: {
              recommendationCount: insertedCount,
              totalMonthlySavings: stats.total_potential_savings,
            },
          });
        }

        console.log(`✅ [Discovery] Cost optimization analysis complete (${totalFound} opportunities found)`);
        costAnalysisCompleted = true;
      } catch (error: any) {
        console.error(`❌ [Discovery] Cost optimization analysis failed:`, error.message);
        errors.push(`Cost analysis: ${error.message}`);
      }

      // Update job status
      console.log(`\n📊 [Discovery] Discovery Summary:`);
      console.log(`  - Subscription tier: ${tier}`);
      console.log(`  - Total resources discovered (new): ${totalDiscovered}`);
      console.log(`  - Total resources updated: ${totalUpdated}`);
      console.log(`  - Total resources: ${totalDiscovered + totalUpdated}`);
      console.log(`  - Resources newly terminated (reconciliation): ${resourcesTerminated}`);

      if (skippedTypes.length > 0) {
        console.log(`  - ⏭️  Resource types skipped (tier limitation): ${skippedTypes.join(', ')}`);
        console.log(`  - 💡 Upgrade to access: ${skippedTypes.join(', ')}`);
      }

      if (errors.length > 0) {
        console.log(`  - Errors encountered: ${errors.length}`);
        errors.forEach((err, idx) => {
          console.log(`    ${idx + 1}. ${err}`);
        });
      }
      if (warnings.length > 0) {
        console.log(`  - Warnings: ${warnings.join(', ')}`);
      }

      await client.query(
        `UPDATE resource_discovery_jobs
         SET status = $1, completed_at = NOW(), resources_discovered = $2, resources_updated = $3, resources_deleted = $4, error_message = $5, compliance_scan_completed = $6, cost_analysis_completed = $7
         WHERE id = $8`,
        [
          errors.length > 0 ? 'failed' : 'completed',
          totalDiscovered,
          totalUpdated,
          resourcesTerminated,
          joinDiscoveryMessage(errors, warnings),
          complianceScanCompleted,
          costAnalysisCompleted,
          jobId
        ]
      );

      if (errors.length > 0) {
        console.log(`⚠️  [Discovery] Completed with errors`);
      } else {
        console.log(`🎉 [Discovery] AWS resource discovery completed successfully!\n`);
      }

      // Funnel: "resources actually persisted" is the correct completion
      // signal here, not this job's own status column -- errors.length > 0
      // marks the whole job 'failed' even when the core resource scans
      // succeeded (e.g. a missing peripheral IAM permission for the
      // compliance/security sub-scans), the exact reason onboarding.service
      // .ts already checks aws_resources existence directly instead of
      // trusting this status. aws_resources remains the authoritative
      // product state; this only decides whether the one-time funnel event
      // fires, guarded per-org so rescans/retries never re-fire it.
      if (totalDiscovered > 0 || totalUpdated > 0) {
        await trackFunnelEventOnce({
          organizationId,
          eventName: 'discovery_completed',
          properties: { resourcesDiscovered: totalDiscovered, resourcesUpdated: totalUpdated },
        });
      }

      return {
        job_id: jobId,
        resources_discovered: totalDiscovered,
        resources_updated: totalUpdated,
        resources_deleted: resourcesTerminated,
        errors,
        warnings
      };
    } catch (error: any) {
      console.error(`\n❌ [Discovery] Fatal error during discovery:`, error.message);
      console.error(`Stack trace:`, error.stack);

      // Update job as failed. error_message is shown to the organization
      // (GET /api/aws-resources/discovery/jobs), so it carries a fixed message,
      // never error.message: that can hold internal tags, ARNs, account IDs or
      // raw AWS text. The full error is logged above.
      if (jobId!) {
        await client.query(
          `UPDATE resource_discovery_jobs
           SET status = $1, completed_at = NOW(), error_message = $2
           WHERE id = $3`,
          ['failed', fatalDiscoveryErrorMessage(error), jobId]
        );
      }
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Discover EC2 instances
   */
  private async discoverEC2Instances(
    organizationId: string,
    ec2Client: EC2Client,
    region: string,
    accountId: string | undefined,
    checkBackupEvidence: (resourceArn: string) => Promise<BackupEvidenceResult>
  ): Promise<CreateAWSResourceInput[]> {
    const instances: Instance[] = [];
    let pageCount = 0;
    for await (const page of paginateDescribeInstances({ client: ec2Client }, {})) {
      pageCount++;
      for (const reservation of page.Reservations || []) {
        instances.push(...(reservation.Instances || []));
      }
    }
    this.logIfPaginated('EC2 instances', pageCount, instances.length);

    const volumeEncryptionMap = await this.getVolumeEncryptionMap(ec2Client, instances);
    // One read for the region, and only when an instance has a group to look up.
    const securityGroups = instances.some((instance) => (instance.SecurityGroups || []).length > 0)
      ? await this.readSecurityGroups(ec2Client, region)
      : new Map<string, SecurityGroupRules>();

    // One unit of work per instance, a bounded number at a time (utils/awsCallPolicy.ts).
    const resources = await mapWithConcurrency(instances, this.callPolicy.concurrency, async (instance): Promise<CreateAWSResourceInput | null> => {
      if (!instance.InstanceId) return null;

      const tags = this.extractTags(instance.Tags);
      const name = tags.Name || instance.InstanceId;

      const metadata: EC2InstanceMetadata = {
        instance_type: instance.InstanceType || 'unknown',
        platform: instance.Platform,
        vpc_id: instance.VpcId,
        subnet_id: instance.SubnetId,
        public_ip: instance.PublicIpAddress,
        private_ip: instance.PrivateIpAddress,
        availability_zone: instance.Placement?.AvailabilityZone,
        launch_time: instance.LaunchTime?.toISOString(),
        tags_state: 'observed',
      };

      // What the instance's security groups show, read in the region it was listed in.
      // Recorded on every discovery, whether or not the instance has a public IP, and
      // graded by ComplianceScannerService.checkPublicAccess.
      const securityGroupIds = (instance.SecurityGroups || []).map((group) => group.GroupId).filter((id): id is string => !!id);
      const exposure: NetworkExposure = evaluateNetworkExposure(securityGroupIds, securityGroups);
      metadata.security_group_ids = securityGroupIds;
      metadata.network_exposure = exposure;

      // Security Truthfulness #41: has_backup is real AWS Backup recovery-point evidence,
      // never a hardcoded value. A real ARN (with the actual account ID) is required for
      // the AWS Backup API call -- resource_arn below uses a wildcard account segment and
      // is not usable for this lookup. Without a known account ID, the answer is
      // genuinely unknown -- never fabricated as false, and no AWS call is even attempted.
      const realInstanceArn = accountId ? `arn:aws:ec2:${region}:${accountId}:instance/${instance.InstanceId}` : null;
      const hasBackup: BackupEvidenceResult = realInstanceArn ? await checkBackupEvidence(realInstanceArn) : null;

      return {
        organization_id: organizationId,
        resource_arn: `arn:aws:ec2:${region}:*:instance/${instance.InstanceId}`,
        resource_id: instance.InstanceId,
        resource_name: name,
        resource_type: 'ec2',
        region,
        tags,
        metadata,
        status: this.mapEC2Status(instance.State?.Name),
        estimated_monthly_cost: this.estimateEC2Cost(instance.InstanceType || 'unknown'),
        is_encrypted: this.checkEC2Encryption(instance, volumeEncryptionMap),
        is_public: !!instance.PublicIpAddress,
        has_backup: hasBackup,
      };
    });

    return resources.filter((resource): resource is CreateAWSResourceInput => resource !== null);
  }

  /**
   * Discover EBS volumes (all states, not just unattached -- the
   * ebs_unattached analyzer in cost-optimization.service.ts filters for
   * State: 'available' itself via its own independent DescribeVolumes call,
   * same pattern as every other detector in that file. This discovery method
   * only populates aws_resources inventory).
   */
  private async discoverEBSVolumes(
    organizationId: string,
    ec2Client: EC2Client,
    region: string,
    accountId: string | undefined,
    checkBackupEvidence: (resourceArn: string) => Promise<BackupEvidenceResult>
  ): Promise<CreateAWSResourceInput[]> {
    const volumes: Volume[] = [];
    let pageCount = 0;
    for await (const page of paginateDescribeVolumes({ client: ec2Client }, {})) {
      pageCount++;
      volumes.push(...(page.Volumes || []));
    }
    this.logIfPaginated('EBS volumes', pageCount, volumes.length);

    // One unit of work per volume, a bounded number at a time (utils/awsCallPolicy.ts).
    const resources = await mapWithConcurrency(volumes, this.callPolicy.concurrency, async (volume): Promise<CreateAWSResourceInput | null> => {
      if (!volume.VolumeId) return null;

      const tags = this.extractTags(volume.Tags);
      const name = tags.Name || volume.VolumeId;
      const attachment = (volume.Attachments || [])[0];

      const metadata: EBSVolumeMetadata = {
        volume_type: volume.VolumeType || 'unknown',
        size_gb: volume.Size || 0,
        iops: volume.Iops,
        throughput: volume.Throughput,
        availability_zone: volume.AvailabilityZone,
        attached: !!attachment,
        attached_instance_id: attachment?.InstanceId,
        tags_state: 'observed',
      };

      // Security Truthfulness #41: same real AWS Backup evidence model as EC2, plus the
      // parent-instance fallback -- AWS Backup can protect an EC2 instance as a whole,
      // implicitly covering its attached volumes, without a separate per-volume
      // protected-resource entry existing. Checking only the volume's own ARN would
      // under-report that valid coverage. No known account ID -> unknown, no AWS call.
      const volumeRegion = volume.AvailabilityZone?.slice(0, -1) || region;
      const realVolumeArn = accountId ? `arn:aws:ec2:${volumeRegion}:${accountId}:volume/${volume.VolumeId}` : null;
      const realParentInstanceArn = accountId && attachment?.InstanceId
        ? `arn:aws:ec2:${volumeRegion}:${accountId}:instance/${attachment.InstanceId}`
        : null;
      const hasBackup: BackupEvidenceResult = realVolumeArn
        ? await checkEBSBackupCoverage(checkBackupEvidence, realVolumeArn, realParentInstanceArn)
        : null;

      return {
        organization_id: organizationId,
        resource_arn: `arn:aws:ec2:${volume.AvailabilityZone?.slice(0, -1) || region}:*:volume/${volume.VolumeId}`,
        resource_id: volume.VolumeId,
        resource_name: name,
        resource_type: 'ebs',
        region,
        tags,
        metadata,
        status: this.mapEBSStatus(volume.State),
        estimated_monthly_cost: this.estimateEBSCost(volume.VolumeType, volume.Size || 0),
        // As DescribeVolumes reports it. A volume it reports nothing for is unknown,
        // never "not encrypted".
        is_encrypted: typeof volume.Encrypted === 'boolean' ? volume.Encrypted : null,
        // A volume has no network address: not applicable, recorded as false.
        is_public: false,
        has_backup: hasBackup,
      };
    });

    return resources.filter((resource): resource is CreateAWSResourceInput => resource !== null);
  }

  /**
   * Discover RDS database instances
   */
  private async discoverRDSDatabases(
    organizationId: string,
    rdsClient: RDSClient,
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const dbInstances: DBInstance[] = [];
    let pageCount = 0;
    for await (const page of paginateDescribeDBInstances({ client: rdsClient }, {})) {
      pageCount++;
      dbInstances.push(...(page.DBInstances || []));
    }
    this.logIfPaginated('RDS instances', pageCount, dbInstances.length);

    const resources: CreateAWSResourceInput[] = [];

    for (const dbInstance of dbInstances) {
      if (!dbInstance.DBInstanceIdentifier) continue;

      const tags = this.extractTags(dbInstance.TagList);
      const name = tags.Name || dbInstance.DBInstanceIdentifier;

      const metadata: RDSInstanceMetadata = {
        db_instance_class: dbInstance.DBInstanceClass || 'unknown',
        engine: dbInstance.Engine || 'unknown',
        engine_version: dbInstance.EngineVersion || 'unknown',
        allocated_storage: dbInstance.AllocatedStorage,
        multi_az: dbInstance.MultiAZ,
        publicly_accessible: dbInstance.PubliclyAccessible,
        vpc_id: dbInstance.DBSubnetGroup?.VpcId,
        tags_state: 'observed',
      };

      resources.push({
        organization_id: organizationId,
        resource_arn: dbInstance.DBInstanceArn || `arn:aws:rds:${region}:*:db:${dbInstance.DBInstanceIdentifier}`,
        resource_id: dbInstance.DBInstanceIdentifier,
        resource_name: name,
        resource_type: 'rds',
        region,
        tags,
        metadata,
        status: this.mapRDSStatus(dbInstance.DBInstanceStatus),
        estimated_monthly_cost: this.estimateRDSCost(dbInstance.DBInstanceClass || 'unknown'),
        // As DescribeDBInstances reports them. A field it leaves out is unknown, never false.
        is_encrypted: dbInstance.StorageEncrypted ?? null,
        is_public: dbInstance.PubliclyAccessible ?? null,
        has_backup: typeof dbInstance.BackupRetentionPeriod === 'number' ? dbInstance.BackupRetentionPeriod > 0 : null,
      });
    }

    return resources;
  }

  /**
   * Discover S3 buckets
   */
  private async discoverS3Buckets(
    organizationId: string,
    s3Client: S3Client,
    defaultRegion: string,
    s3ClientForRegion?: (region: string) => S3Client,
    // Receives the ARN of every listed bucket whose GetBucketLocation failed: its
    // returned region is then the home region, a guess, not the bucket's region.
    unlocatedBucketArns?: Set<string>
  ): Promise<CreateAWSResourceInput[]> {
    // No generated paginator for ListBuckets in this SDK version — manual
    // ContinuationToken loop (added along with S3's 2023 quota increase to
    // 10,000 buckets/account; older accounts never see a token and this loop
    // runs exactly once, identical to the prior single call).
    const buckets: Bucket[] = [];
    let continuationToken: string | undefined;
    let pageCount = 0;
    do {
      const response = await s3Client.send(new ListBucketsCommand({ ContinuationToken: continuationToken }));
      pageCount++;
      buckets.push(...(response.Buckets || []));
      continuationToken = response.ContinuationToken;
    } while (continuationToken);
    this.logIfPaginated('S3 buckets', pageCount, buckets.length);

    // One unit of work per bucket, a bounded number at a time (utils/awsCallPolicy.ts).
    const resources = await mapWithConcurrency(buckets, this.callPolicy.concurrency, async (bucket): Promise<CreateAWSResourceInput | null> => {
      if (!bucket.Name) return null;

      // Security Truthfulness #40 (extended to S3): null means unknown/unavailable
      // evidence -- never coerce a failed AWS call into a confirmed negative. Only a
      // verified, specific AWS signal may set these to `false`.
      let isEncrypted: boolean | null = null;
      let isPublic: boolean | null = null;
      // The bucket's region, stored and used for every per-bucket read below. The home
      // region until GetBucketLocation answers; getBucketTags follows S3's redirect if
      // that turns out to be wrong.
      let bucketRegion = defaultRegion;
      // The client for the bucket's own region: S3 answers a bucket's configuration
      // there, so reads through a client for another region do not get the answer.
      let bucketClient = s3Client;
      let located = false;

      try {
        // Get bucket region. A legacy eu-west-1 bucket reports 'EU', normalized here.
        const locationCommand = new GetBucketLocationCommand({ Bucket: bucket.Name });
        const locationResponse = await s3Client.send(locationCommand);
        bucketRegion = regionFromLocationConstraint(locationResponse.LocationConstraint);
        located = true;
        bucketClient = this.s3ClientInRegion(s3Client, defaultRegion, s3ClientForRegion, bucketRegion);

        // Check encryption. AWS's well-known signal for "no default encryption
        // configured" is a ServerSideEncryptionConfigurationNotFoundError -- the S3
        // equivalent of GetBucketPolicy's NoSuchBucketPolicy (see
        // s3-security-evaluation.ts). Only that specific, confirmed-negative
        // error may set isEncrypted = false; any other error (AccessDenied,
        // throttling, a transient failure) leaves it null/unknown rather than
        // fabricating a "not encrypted" finding.
        try {
          const encryptionCommand = new GetBucketEncryptionCommand({ Bucket: bucket.Name });
          await bucketClient.send(encryptionCommand);
          isEncrypted = true;
        } catch (error: any) {
          isEncrypted = error.name === 'ServerSideEncryptionConfigurationNotFoundError' ? false : null;
        }

        // Check public access via bucket ACL. Unlike encryption, GetBucketAcl has no
        // "confirmed absent" error -- every bucket has an ACL, so any failure here
        // (AccessDenied, throttling, etc.) is a genuine unknown, never a confirmed
        // "not public".
        try {
          const aclCommand = new GetBucketAclCommand({ Bucket: bucket.Name });
          const aclResponse = await bucketClient.send(aclCommand);
          isPublic = (aclResponse.Grants || []).some(
            grant => grant.Grantee?.URI === 'http://acs.amazonaws.com/groups/global/AllUsers'
          );
        } catch (error: any) {
          isPublic = null;
        }
      } catch (error: any) {
        console.error(`[S3 Discovery] Error processing bucket ${bucket.Name}:`, error.message);
      }
      if (!located) unlocatedBucketArns?.add(`arn:aws:s3:::${bucket.Name}`);

      // Real lifecycle status from AWS (see s3-lifecycle.util.ts) -- replaces
      // the old `lifecycle_rules: 0` placeholder that was never actually
      // queried. An 'unavailable' read (AccessDenied/throttling/etc.) is
      // stored as such, not silently written as "no rules".
      const lifecycleStatus = await getBucketLifecycleStatus(bucketClient, bucket.Name);

      // The bucket's tags, read in its own region. 'unavailable' (denied, throttled)
      // is recorded as such: the tags are then unknown, and no tag finding is raised.
      const bucketTags = await getBucketTags(
        (target) => (target === bucketRegion ? bucketClient : this.s3ClientInRegion(s3Client, defaultRegion, s3ClientForRegion, target)),
        bucket.Name,
        bucketRegion
      );
      if (bucketTags.state === 'unavailable') {
        console.error(`[S3 Discovery] Tags of bucket ${bucket.Name} could not be read (${bucketTags.reason}); recorded as unknown`);
      }

      const metadata: S3BucketMetadata = {
        creation_date: bucket.CreationDate?.toISOString(),
        tags_state: bucketTags.state,
        lifecycle_status: lifecycleStatus.state,
        ...(lifecycleStatus.state === 'has_lifecycle_rules' ? { lifecycle_rules: lifecycleStatus.enabledRuleCount } : {}),
        ...(lifecycleStatus.state === 'no_lifecycle_configuration' ? { lifecycle_rules: 0 } : {}),
      };

      return {
        organization_id: organizationId,
        resource_arn: `arn:aws:s3:::${bucket.Name}`,
        resource_id: bucket.Name,
        resource_name: bucket.Name,
        resource_type: 's3',
        region: bucketRegion,
        tags: bucketTags.state === 'observed' ? bucketTags.tags : {},
        metadata,
        // A bucket has no lifecycle status: see utils/resourceLifecycle.ts.
        status: storedStatusFor('s3', UNKNOWN_STATUS) as ResourceStatus,
        estimated_monthly_cost: this.estimateS3Cost(),
        is_encrypted: isEncrypted,
        is_public: isPublic,
        // Nothing reads a bucket's versioning or backups, so this is unknown.
        has_backup: null,
      };
    });

    return resources.filter((resource): resource is CreateAWSResourceInput => resource !== null);
  }

  /** Whether this organization's inventory already holds a row for `resourceArn`. */
  private async resourceStored(client: PoolClient, organizationId: string, resourceArn: string): Promise<boolean> {
    const { rowCount } = await client.query(
      `SELECT 1 FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
      [organizationId, resourceArn]
    );
    return (rowCount ?? 0) > 0;
  }

  /**
   * The S3 client for `region`: the home client for the home region (or when no
   * regional factory is available), otherwise the regional client.
   */
  private s3ClientInRegion(
    homeClient: S3Client,
    homeRegion: string,
    s3ClientForRegion: ((region: string) => S3Client) | undefined,
    region: string
  ): S3Client {
    return region === homeRegion || !s3ClientForRegion ? homeClient : s3ClientForRegion(region);
  }

  /**
   * Estimate monthly cost for S3 bucket
   * Fixed estimate (actual cost depends on storage and requests)
   */
  private estimateS3Cost(): number {
    return 5; // $5/month baseline estimate
  }

  /**
   * Logs only when a paginated list call actually followed more than one page —
   * lets a multi-page run be confirmed from logs alone, without noise on the
   * single-page case every real org hits today.
   */
  private logIfPaginated(label: string, pageCount: number, itemCount: number): void {
    if (pageCount > 1) {
      console.log(`📄 [Discovery] ${label}: followed ${pageCount} pages (${itemCount} total items)`);
    }
  }

  /**
   * Upsert resource into database
   * Returns 'created' or 'updated'
   */
  private async upsertResource(
    client: any,
    resource: CreateAWSResourceInput
  ): Promise<'created' | 'updated'> {
    const result = await client.query(
      `INSERT INTO aws_resources (
        organization_id, resource_arn, resource_id, resource_name, resource_type, region,
        tags, metadata, status, estimated_monthly_cost, actual_monthly_cost,
        is_encrypted, is_public, has_backup, compliance_issues, last_synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, NOW())
      ON CONFLICT (organization_id, resource_arn)
      DO UPDATE SET
        resource_name = EXCLUDED.resource_name,
        -- The region is otherwise kept as first stored. The one correction: S3 buckets
        -- stored with GetBucketLocation's legacy 'EU' get the region it stands for.
        region = CASE WHEN aws_resources.region = 'EU' AND EXCLUDED.region = 'eu-west-1'
                      THEN EXCLUDED.region ELSE aws_resources.region END,
        tags = EXCLUDED.tags,
        metadata = EXCLUDED.metadata,
        status = EXCLUDED.status,
        -- COALESCE, not a plain overwrite: a NULL here means this cycle's
        -- calculation was unavailable (e.g. a Lambda function's CloudWatch
        -- usage lookup failed), not a confirmed $0 -- so the previously
        -- persisted value is preserved instead of being clobbered. See
        -- discoverLambdaFunctions()'s doc comment.
        estimated_monthly_cost = COALESCE(EXCLUDED.estimated_monthly_cost, aws_resources.estimated_monthly_cost),
        is_encrypted = EXCLUDED.is_encrypted,
        is_public = EXCLUDED.is_public,
        has_backup = EXCLUDED.has_backup,
        last_synced_at = NOW(),
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted`,
      [
        resource.organization_id,
        resource.resource_arn,
        resource.resource_id,
        resource.resource_name,
        resource.resource_type,
        resource.region,
        JSON.stringify(resource.tags || {}),
        JSON.stringify(resource.metadata || {}),
        resource.status,
        resource.estimated_monthly_cost ?? null,
        resource.actual_monthly_cost || 0,
        // Security Truthfulness #40/#41: each flag is stored as discovery determined
        // it. `null` (a lookup that came back indeterminate) and `undefined` (this
        // resource type's discovery does not read the field at all -- e.g. has_backup
        // for Lambda, load balancers and CloudFront) are both stored as NULL, unknown.
        // `undefined` used to be stored as `false`, which stated "not encrypted",
        // "not public" or "no backup" for a field nothing had read.
        resource.is_encrypted ?? null,
        resource.is_public ?? null,
        resource.has_backup ?? null,
        JSON.stringify(resource.compliance_issues || []),
      ]
    );

    return result.rows[0].inserted ? 'created' : 'updated';
  }

  /**
   * Flat monthly cost baselines for Resource Explorer-sourced generic types. The old
   * Describe*-based methods computed per-resource estimates from live capacity/usage data
   * (RCU/WCU, node type, task count, cluster member count) that Resource Explorer's
   * {arn, type, region, tags} shape doesn't provide — these are typical-case placeholders,
   * not per-resource calculations.
   */
  private static readonly GENERIC_COST_BASELINE: Partial<Record<ResourceType, number>> = {
    ecs: 9,
    vpc: 0,
    eks: 73,
    dynamodb: 3,
    'api-gateway': 3.5,
    elasticache: 25,
    aurora: 150,
    sqs: 0.4,
    sns: 0.5,
  };

  /**
   * Upsert a Resource Explorer-sourced generic-inventory resource. Unlike upsertResource
   * (used by the Describe*-based deep-monitored discovery), this never overwrites
   * compliance_issues on conflict, and keeps a known status (see below).
   *
   * is_encrypted, is_public and has_backup are written as NULL (unknown), on insert
   * and again on every conflict: Resource Explorer's {arn, type, region, tags} data
   * says nothing about any of them. They used to be inserted as `false` and then
   * never rewritten, so rows written by an earlier release kept a "not encrypted"
   * that nothing had observed.
   *
   * GUARD: the per-discovery NULL rewrite is only safe while no enrichment step
   * (enrichDynamoDBTables, enrichAuroraClusters, or a new one) writes these three
   * columns for a generic type. One that starts to must stop this upsert from
   * clearing what it wrote, in the same change. awsResourceDiscovery.placeholder-
   * unknown.test.ts fails if an enrichment step writes them.
   *
   * A type with no lifecycle status (utils/resourceLifecycle.ts) is stored with
   * NOT_APPLICABLE_STATUS, on insert and on conflict, replacing the 'active' or
   * 'available' an earlier release stored for it. Termination is handled exclusively
   * by ResourceReconciliationService, never by this upsert — except for the one case
   * this upsert must undo: if the row was previously terminated and Resource Explorer
   * just found its ARN again (this method only runs for entries the scan returned),
   * status is reset to 'unknown' so it doesn't stay stuck at 'terminated' forever.
   * ResourceReconciliationService's reset query explicitly skips rows still marked
   * 'terminated' (see its `status != 'terminated'` guard), so this upsert — which
   * always runs before reconcile() in discoverAllResources — is what has to clear the
   * flag first; the same present-again ARN is what makes reconcile() zero out
   * missing_scan_count for it right after. This mirrors upsertResource's plain
   * `status = EXCLUDED.status`, just constrained to the one honest value this
   * thinner data source can assert.
   *
   * status is inserted as 'unknown', not 'active' — Resource Explorer doesn't report
   * operational state (a DynamoDB table stuck CREATING or an ECS service DRAINING would
   * be indistinguishable from a healthy one), so claiming 'active' would be fabricating
   * data DevControl doesn't actually have. 'unknown' is an existing ResourceStatus value
   * (see mapEC2Status/mapRDSStatus's fallback) — this generic path is honest about being
   * inventory-only, the same way cloudwatch.service.ts's rdsCapability is honest about
   * having no CloudWatch metrics wired up. Never overwritten on conflict, so a resource
   * whose status was previously known (e.g. from before it became generic-only) keeps it.
   */
  private async upsertGenericResource(
    client: any,
    organizationId: string,
    entry: NormalizedResourceEntry
  ): Promise<'created' | 'updated'> {
    const resourceId = this.resourceExplorer.extractResourceId(entry.arn);
    const resourceName = entry.tags.Name || resourceId;
    const estimatedMonthlyCost = AWSResourceDiscoveryService.GENERIC_COST_BASELINE[entry.resourceType] ?? 0;

    const result = await client.query(
      `INSERT INTO aws_resources (
        organization_id, resource_arn, resource_id, resource_name, resource_type, region,
        tags, metadata, status, estimated_monthly_cost, actual_monthly_cost,
        is_encrypted, is_public, has_backup, compliance_issues, missing_scan_count, last_synced_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $10, $9, 0, NULL, NULL, NULL, '[]', 0, NOW())
      ON CONFLICT (organization_id, resource_arn)
      DO UPDATE SET
        resource_name = EXCLUDED.resource_name,
        tags = EXCLUDED.tags,
        -- Unknown, rewritten on every discovery: Resource Explorer reports none of the
        -- three, and nothing else writes them for a generic type (see the doc comment).
        -- This is what clears the 'false' an earlier release stored for these rows.
        is_encrypted = NULL,
        is_public = NULL,
        has_backup = NULL,
        -- Merge, not overwrite: a dedicated enrichment step (e.g.
        -- enrichDynamoDBTables()) can add real per-resource config on top of
        -- this generic {source, service} baseline in the same discovery run.
        -- An unconditional overwrite here would silently erase that
        -- enrichment on every subsequent cycle whose own enrichment attempt
        -- happens to fail transiently (AWS throttling, a permissions blip),
        -- even though nothing about the resource actually changed -- the
        -- same class of bug Phase 3B fixed for Lambda's estimated_monthly_cost
        -- via COALESCE. Behavior-preserving for every generic type that
        -- writes no metadata beyond {source, service} (every one of them,
        -- as of this change): EXCLUDED.metadata's keys still take precedence
        -- on overlap, so a changed service/source value still updates.
        metadata = aws_resources.metadata || EXCLUDED.metadata,
        region = EXCLUDED.region,
        status = CASE
          WHEN EXCLUDED.status = '${NOT_APPLICABLE_STATUS}' THEN EXCLUDED.status
          WHEN aws_resources.status = 'terminated' THEN '${UNKNOWN_STATUS}'
          ELSE aws_resources.status
        END,
        last_synced_at = NOW(),
        updated_at = NOW()
      RETURNING (xmax = 0) AS inserted`,
      [
        organizationId,
        entry.arn,
        resourceId,
        resourceName,
        entry.resourceType,
        entry.region,
        JSON.stringify(entry.tags || {}),
        JSON.stringify({ source: 'resource-explorer', service: entry.service, tags_state: entry.tagsState }),
        estimatedMonthlyCost,
        storedStatusFor(entry.resourceType, UNKNOWN_STATUS),
      ]
    );

    return result.rows[0].inserted ? 'created' : 'updated';
  }

  /**
   * Enriches already-upserted generic DynamoDB rows with real per-table
   * configuration from DescribeTable -- billing mode, provisioned capacity,
   * table class, GSIs, and Global Table replicas (see dynamodb-table.util.ts).
   * Foundation only: this never fetches CloudWatch telemetry, never touches
   * pricing/estimated_monthly_cost, and never creates a cost_recommendations
   * row -- see cost-optimization.service.ts's future dynamodb_* detectors
   * (not yet built) for that layer.
   *
   * A table whose DescribeTable call fails this cycle (permissions,
   * throttling, a deleted table) is left completely untouched -- no metadata
   * write at all for that one table, preserving whatever it already had from
   * a prior successful cycle (see upsertGenericResource's metadata-merge
   * comment for why an unconditional overwrite would be unsafe here). This
   * never fabricates a billing mode or any other field.
   *
   * Builds one DynamoDBClient and one ApplicationAutoScalingClient per
   * DISTINCT region actually reported for these tables (via
   * AWSClientFactory.getDynamoDBClientForRegion/
   * getApplicationAutoScalingClientForRegion), not the org's single
   * configured/primary region -- a table's real region, from Resource
   * Explorer's per-resource Region field, is not guaranteed to match it.
   * Reuses the same AssumeRole credentials already established for this
   * discovery run; costs zero additional AssumeRole calls.
   *
   * Autoscaling (Phase 3E, Checkpoint C): a table's autoscaling state comes
   * from a genuinely separate AWS API (Application Auto Scaling's
   * DescribeScalableTargets, see dynamodb-autoscaling.util.ts) than
   * DescribeTable. Its failure is NOT treated the same as a DescribeTable
   * failure: if DescribeTable succeeds but the autoscaling check fails, the
   * real DescribeTable-derived fields are still persisted, with
   * autoscaling_state explicitly recorded as AUTOSCALING_UNKNOWN -- never
   * silently omitted, and never collapsed into AUTOSCALING_DISABLED. Only a
   * DescribeTable failure skips the table entirely, as before.
   */
  private async enrichDynamoDBTables(
    organizationId: string,
    client: PoolClient,
    awsClients: Pick<AWSClients, 'getDynamoDBClientForRegion' | 'getApplicationAutoScalingClientForRegion'>,
    entries: NormalizedResourceEntry[]
  ): Promise<number> {
    let enrichedCount = 0;
    const dynamoDbClientsByRegion = new Map<string, ReturnType<AWSClients['getDynamoDBClientForRegion']>>();
    const autoscalingClientsByRegion = new Map<string, ReturnType<AWSClients['getApplicationAutoScalingClientForRegion']>>();

    for (const entry of entries) {
      let regionalClient = dynamoDbClientsByRegion.get(entry.region);
      if (!regionalClient) {
        regionalClient = awsClients.getDynamoDBClientForRegion(entry.region);
        dynamoDbClientsByRegion.set(entry.region, regionalClient);
      }

      let regionalAutoscalingClient = autoscalingClientsByRegion.get(entry.region);
      if (!regionalAutoscalingClient) {
        regionalAutoscalingClient = awsClients.getApplicationAutoScalingClientForRegion(entry.region);
        autoscalingClientsByRegion.set(entry.region, regionalAutoscalingClient);
      }

      const tableName = this.resourceExplorer.extractResourceId(entry.arn);
      const result = await describeDynamoDBTable(regionalClient, tableName);

      if (result.status !== 'described') {
        console.error(`[Discovery] DynamoDB DescribeTable unavailable for ${tableName} (${entry.region}): ${result.reason}`);
        continue;
      }

      const autoscalingResult = await describeDynamoDBAutoscaling(regionalAutoscalingClient, tableName);
      const autoscaling_state =
        autoscalingResult.status === 'described' ? autoscalingResult.config.autoscaling_state : 'AUTOSCALING_UNKNOWN';
      if (autoscalingResult.status !== 'described') {
        console.error(
          `[Discovery] Application Auto Scaling DescribeScalableTargets unavailable for ${tableName} (${entry.region}): ${autoscalingResult.reason}`
        );
      }

      const metadata = {
        ...result.config,
        autoscaling_state,
        ...(autoscalingResult.status === 'described'
          ? {
              read_capacity_autoscaled: autoscalingResult.config.read_capacity_autoscaled,
              write_capacity_autoscaled: autoscalingResult.config.write_capacity_autoscaled,
            }
          : {}),
      };

      await client.query(
        `UPDATE aws_resources
         SET metadata = metadata || $1::jsonb, updated_at = NOW()
         WHERE organization_id = $2 AND resource_arn = $3`,
        [JSON.stringify(metadata), organizationId, entry.arn]
      );
      enrichedCount++;
    }

    return enrichedCount;
  }

  /**
   * Aurora Service Health: corrects the generic Resource Explorer
   * classification for AWS::RDS::DBCluster rows, which cannot distinguish a
   * real Aurora cluster from a non-Aurora RDS Multi-AZ DB cluster (both
   * surface identically -- see resourceExplorer.service.ts's own comment on
   * this). One unfiltered, paginated DescribeDBClusters call for the whole
   * region (see aurora-cluster.util.ts) -- never one call per cluster.
   *
   * A candidate not found in this cycle's DescribeDBClusters response
   * (transient Resource Explorer/RDS skew, a deletion in progress, or a
   * permissions gap) is left completely untouched -- same "no data this
   * cycle means no write at all" precedent as enrichDynamoDBTables(): never
   * reclassified away from 'aurora' on mere absence, and never guessed at.
   *
   * A candidate whose real Engine is confirmed NOT an Aurora engine is
   * reclassified into the existing 'rds' type (never a new type invented
   * for this) and flagged in metadata + a console warning for review --
   * approved policy. Its resource_arn/resource_id/identity are untouched;
   * only resource_type and metadata change, so the underlying AWS inventory
   * row is corrected, not corrupted or dropped.
   */
  private async enrichAuroraClusters(
    organizationId: string,
    client: PoolClient,
    rdsClient: RDSClient,
    entries: NormalizedResourceEntry[]
  ): Promise<{ confirmed: number; reclassified: number }> {
    const result = await describeAuroraClusters(rdsClient);
    if (result.status === 'unavailable') {
      console.error(`[Discovery] Aurora cluster enrichment unavailable this cycle: ${result.reason}`);
      return { confirmed: 0, reclassified: 0 };
    }

    let confirmed = 0;
    let reclassified = 0;

    for (const entry of entries) {
      const clusterId = this.resourceExplorer.extractResourceId(entry.arn);
      const cluster = result.clustersById.get(clusterId);

      if (!cluster) continue;

      if (!cluster.isAuroraEngine) {
        console.warn(
          `[Discovery] Reclassifying ${entry.arn} out of 'aurora': DescribeDBClusters reports Engine=${cluster.engine || 'unknown'}, not an Aurora engine`
        );
        await client.query(
          `UPDATE aws_resources
           SET resource_type = 'rds',
               metadata = metadata || $1::jsonb,
               updated_at = NOW()
           WHERE organization_id = $2 AND resource_arn = $3`,
          [
            JSON.stringify({
              engine: cluster.engine || 'unknown',
              reclassified_from: 'aurora',
              reclassification_reason: `DescribeDBClusters reported Engine=${cluster.engine || 'unknown'}, which is not an Aurora engine`,
            }),
            organizationId,
            entry.arn,
          ]
        );
        reclassified++;
        continue;
      }

      await client.query(
        `UPDATE aws_resources
         SET metadata = metadata || $1::jsonb, updated_at = NOW()
         WHERE organization_id = $2 AND resource_arn = $3`,
        [
          JSON.stringify({
            engine: cluster.engine,
            engine_mode: cluster.engineMode,
            cluster_status: cluster.status,
            has_reader: cluster.hasReader,
          }),
          organizationId,
          entry.arn,
        ]
      );
      confirmed++;
    }

    return { confirmed, reclassified };
  }

  /**
   * Extract tags from AWS tag format
   */
  private extractTags(tags: any[] | undefined): Record<string, string> {
    if (!tags) return {};
    return tags.reduce((acc, tag) => {
      if (tag.Key && tag.Value) {
        acc[tag.Key] = tag.Value;
      }
      return acc;
    }, {} as Record<string, string>);
  }

  /**
   * Map EC2 instance state to our status
   */
  private mapEC2Status(state: string | undefined): ResourceStatus {
    const mapping: Record<string, ResourceStatus> = {
      pending: 'pending',
      running: 'running',
      'shutting-down': 'stopped',
      terminated: 'terminated',
      stopping: 'stopped',
      stopped: 'stopped',
    };
    return mapping[state || ''] || 'unknown';
  }

  /**
   * Map RDS instance status to our status
   */
  private mapRDSStatus(status: string | undefined): ResourceStatus {
    return (status || 'unknown') as ResourceStatus;
  }

  /** A CloudFront distribution's Status as a stored status. */
  private mapCloudFrontStatus(status: string | undefined): ResourceStatus {
    if (status === 'Deployed') return 'active';
    if (status === 'InProgress') return 'in-progress';
    return UNKNOWN_STATUS as ResourceStatus;
  }

  /**
   * EBS volume State maps directly onto ResourceStatus's existing
   * 'available'/'unavailable' values -- no translation table needed, unlike
   * EC2/RDS whose AWS-side state names don't already match ResourceStatus.
   */
  private mapEBSStatus(state: string | undefined): ResourceStatus {
    return (state || 'unknown') as ResourceStatus;
  }

  /**
   * Approximate EBS monthly cost -- see config/aws-pricing.ts, shared with
   * cost-optimization.service.ts's ebs_unattached analyzer so both agree on
   * the same pricing assumption.
   */
  private estimateEBSCost(volumeType: string | undefined, sizeGB: number): number {
    return estimateEBSMonthlyCost(volumeType, sizeGB);
  }

  /**
   * Fetch real encryption status for every EBS volume attached to the given instances,
   * via a single batched DescribeVolumes call (chunked at 200 IDs, the API limit).
   * On a failed lookup, the affected volumes are simply absent from the map rather than
   * defaulted to unencrypted, so checkEC2Encryption doesn't fabricate a finding.
   */
  private async getVolumeEncryptionMap(
    ec2Client: EC2Client,
    instances: Instance[]
  ): Promise<Map<string, boolean>> {
    const volumeIds = Array.from(new Set(
      instances.flatMap(instance =>
        (instance.BlockDeviceMappings || [])
          .map(mapping => mapping.Ebs?.VolumeId)
          .filter((id): id is string => !!id)
      )
    ));

    const encryptionMap = new Map<string, boolean>();
    if (volumeIds.length === 0) return encryptionMap;

    const chunkSize = 200;
    for (let i = 0; i < volumeIds.length; i += chunkSize) {
      const chunk = volumeIds.slice(i, i + chunkSize);
      try {
        const { Volumes } = await ec2Client.send(new DescribeVolumesCommand({ VolumeIds: chunk }));
        for (const volume of Volumes || []) {
          if (volume.VolumeId) {
            // Only what AWS reported. A volume with no reported value stays out of
            // the map, i.e. unknown.
            if (typeof volume.Encrypted === 'boolean') encryptionMap.set(volume.VolumeId, volume.Encrypted);
          }
        }
      } catch (error: any) {
        console.error(`[Discovery] DescribeVolumes failed for ${chunk.length} volume(s):`, error.message);
      }
    }

    return encryptionMap;
  }

  /**
   * Whether an EC2 instance's EBS volumes are encrypted, from DescribeVolumes.
   *
   *   false   a volume is confirmed unencrypted (whatever the others are).
   *   true    every volume is confirmed encrypted.
   *   null    unknown: a volume's lookup failed or reported nothing, or the instance
   *           has no EBS volume to speak of. Never "encrypted" by default.
   */
  private checkEC2Encryption(instance: Instance, volumeEncryptionMap: Map<string, boolean>): boolean | null {
    const volumeIds = (instance.BlockDeviceMappings || [])
      .map(mapping => mapping.Ebs?.VolumeId)
      .filter((id): id is string => !!id);

    if (volumeIds.length === 0) return null;

    const states = volumeIds.map(id => volumeEncryptionMap.get(id));
    if (states.some(state => state === false)) return false;
    return states.every(state => state === true) ? true : null;
  }

  /**
   * Every security group of the region the instances were listed in, by group id,
   * read with the client that listed them. null when the read fails (denied,
   * throttled, any error): the instances' exposure is then unknown, and what was read
   * before the failure is not used, because a partial read cannot show that a rule is
   * absent.
   *
   * The region is the listing region, never one derived from an instance's
   * availability zone: an instance in a Local Zone or Wavelength Zone (for example
   * us-west-2-lax-1a) belongs to, and has its security groups in, the parent region
   * it was listed in.
   */
  private async readSecurityGroups(ec2Client: EC2Client, region: string): Promise<Map<string, SecurityGroupRules> | null> {
    try {
      const groups = new Map<string, SecurityGroupRules>();
      for await (const page of paginateDescribeSecurityGroups({ client: ec2Client }, {})) {
        for (const group of page.SecurityGroups || []) {
          if (group.GroupId) groups.set(group.GroupId, group);
        }
      }
      return groups;
    } catch (error: any) {
      console.error(`[Discovery] DescribeSecurityGroups failed in ${region}; instance exposure recorded as unknown:`, error.message);
      return null;
    }
  }

  /**
   * Estimate monthly cost for EC2 instance
   * Hardcoded estimates based on instance type
   */
  private estimateEC2Cost(instanceType: string): number {
    const costs: Record<string, number> = {
      't2.micro': 8.5,
      't2.small': 17,
      't2.medium': 34,
      't2.large': 67,
      't2.xlarge': 134,
      't3.micro': 7.5,
      't3.small': 15,
      't3.medium': 30,
      't3.large': 60,
      't3.xlarge': 120,
      'm5.large': 70,
      'm5.xlarge': 140,
      'm5.2xlarge': 280,
      'c5.large': 62,
      'c5.xlarge': 124,
      'r5.large': 91,
      'r5.xlarge': 182,
    };
    return costs[instanceType] || 50; // Default estimate
  }

  /**
   * Estimate monthly cost for RDS instance
   * Hardcoded estimates based on instance class
   */
  private estimateRDSCost(instanceClass: string): number {
    const costs: Record<string, number> = {
      'db.t3.micro': 12,
      'db.t3.small': 24,
      'db.t3.medium': 48,
      'db.t3.large': 96,
      'db.m5.large': 122,
      'db.m5.xlarge': 244,
      'db.r5.large': 175,
      'db.r5.xlarge': 350,
    };
    return costs[instanceClass] || 75; // Default estimate
  }

  /**
   * Discover Lambda functions.
   *
   * `estimated_monthly_cost` is now a real usage-based estimate -- real
   * 30-day CloudWatch Invocations/Duration (via the shared
   * getLambdaUsageOverWindow(), lambda-usage.util.ts) run through the same
   * published AWS pricing formula the lambda_low_usage optimization detector
   * already uses (estimateLambdaMonthlyCostFromUsage(), aws-pricing.ts) --
   * replacing the previous fabricated assumption of 100K invocations/month,
   * which never reflected any real account's actual usage. Discovery and
   * the optimization scan now share one implementation and cannot disagree.
   *
   * A per-function CloudWatch failure (throttling, permissions, network) is
   * never coerced into a $0 or fabricated estimate: `estimated_monthly_cost`
   * is left `null` for that function this cycle. upsertResource's
   * ON CONFLICT clause preserves whatever value was already persisted from a
   * prior successful discovery rather than overwriting it with a NULL, so a
   * transient failure never silently erases a previously-known-good
   * estimate; only a function whose very first discovery hits a CloudWatch
   * failure would show `null` (genuinely "not yet calculated", not "$0").
   *
   * Known limitations, disclosed rather than silently modeled: the pricing
   * formula does not account for AWS Lambda's free tier, Graviton/arm64's
   * ~20% lower per-GB-second price (the function's real Architectures value
   * is recorded in metadata but not yet priced differently), or Provisioned
   * Concurrency (which carries real cost independent of invocation count --
   * a zero-invocation function with provisioned concurrency is NOT actually
   * $0/month; this is a known follow-up, not something this estimate claims
   * to cover).
   */
  private async discoverLambdaFunctions(
    organizationId: string,
    lambdaClient: LambdaClient,
    cloudWatchClient: CloudWatchClient,
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const resources: CreateAWSResourceInput[] = [];

    try {
      const functions: FunctionConfiguration[] = [];
      let pageCount = 0;
      for await (const page of paginateListFunctions({ client: lambdaClient }, {})) {
        pageCount++;
        functions.push(...(page.Functions || []));
      }
      this.logIfPaginated('Lambda functions', pageCount, functions.length);

      for (const func of functions) {
        if (!func.FunctionArn || !func.FunctionName) continue;

        let tags: Record<string, string> = {};
        let tagsState: TagsState = 'unavailable';
        try {
          const { Tags } = await lambdaClient.send(
            new ListTagsCommand({ Resource: func.FunctionArn })
          );
          tags = Tags || {};
          tagsState = 'observed';
        } catch (error) {
          // The tags could not be read: unknown, not "no tags".
          tags = {};
        }

        const name = tags.Name || func.FunctionName;
        const memoryMB = func.MemorySize || 128;
        const usage = await getLambdaUsageOverWindow(cloudWatchClient, organizationId, func.FunctionName);

        resources.push({
          organization_id: organizationId,
          resource_arn: func.FunctionArn,
          resource_id: func.FunctionName,
          resource_name: name,
          resource_type: 'lambda',
          region,
          tags,
          metadata: {
            tags_state: tagsState,
            runtime: func.Runtime,
            memory: func.MemorySize,
            timeout: func.Timeout,
            last_modified: func.LastModified,
            code_size: func.CodeSize,
            handler: func.Handler,
            architecture: func.Architectures?.[0] || 'x86_64',
            ...(usage
              ? {
                  cost_basis: `usage_based: real ${LAMBDA_USAGE_WINDOW_DAYS}-day CloudWatch Invocations/Duration x published on-demand pricing; does not model the Lambda free tier, Provisioned Concurrency, or an arm64/Graviton price difference`,
                  invocations_30d: usage.invocations,
                  avg_duration_ms: usage.avgDurationMs,
                  usage_state: usage.invocations === 0 ? 'zero_usage' : 'normal_usage',
                }
              : { usage_state: 'unavailable' }),
          },
          // The function's State as AWS reported it. ListFunctions usually leaves State
          // out (GetFunction returns it), and a function with no reported state is
          // unknown: it used to be stored as 'Active'.
          status: (func.State || UNKNOWN_STATUS) as ResourceStatus,
          // Unknown, not `true`. Lambda does encrypt environment variables and the
          // deployment packages uploaded to it at rest, always ("Data encryption at
          // rest for AWS Lambda", Lambda Developer Guide). But the same page excepts
          // functions that use self-managed S3 code storage: their code stays in the
          // customer's bucket and "encryption at rest for your source code is managed
          // by your S3 bucket configuration". Discovery does not read which kind a
          // function is, so it cannot state `true` for every function. No finding
          // depends on this: 'lambda' is not in ENCRYPTION_EVIDENCE_TYPES, and the
          // presence or absence of environment variables says nothing either way.
          is_encrypted: null,
          // null (never 0) when CloudWatch usage couldn't be determined -- see
          // doc comment above and upsertResource's COALESCE-based merge.
          estimated_monthly_cost: usage
            ? estimateLambdaMonthlyCostFromUsage(usage.invocations, usage.avgDurationMs, memoryMB)
            : null,
        });
      }
    } catch (error: any) {
      // A failed or partial listing is not the account's list: rethrown so the caller
      // records the failure, upserts nothing from it, and never treats it as complete.
      console.error('[Lambda Discovery] Error:', error.message);
      throw error;
    }

    return resources;
  }

  /**
   * Discover Application Load Balancers
   */
  private async discoverLoadBalancers(
    organizationId: string,
    elbClient: ElasticLoadBalancingV2Client,
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const resources: CreateAWSResourceInput[] = [];

    try {
      const loadBalancers: LoadBalancer[] = [];
      let pageCount = 0;
      for await (const page of paginateDescribeLoadBalancers({ client: elbClient }, {})) {
        pageCount++;
        loadBalancers.push(...(page.LoadBalancers || []));
      }
      this.logIfPaginated('Load Balancers', pageCount, loadBalancers.length);

      for (const lb of loadBalancers) {
        if (!lb.LoadBalancerArn || !lb.LoadBalancerName) continue;

        let tags: Record<string, string> = {};
        let tagsState: TagsState = 'unavailable';
        try {
          const { TagDescriptions } = await elbClient.send(
            new DescribeELBTagsCommand({ ResourceArns: [lb.LoadBalancerArn] })
          );

          tags = (TagDescriptions?.[0]?.Tags || []).reduce((acc, tag) => {
            if (tag.Key && tag.Value) {
              acc[tag.Key] = tag.Value;
            }
            return acc;
          }, {} as Record<string, string>);
          tagsState = 'observed';
        } catch (error) {
          // The tags could not be read: unknown, not "no tags".
          tags = {};
        }

        const name = tags.Name || lb.LoadBalancerName;

        resources.push({
          organization_id: organizationId,
          resource_arn: lb.LoadBalancerArn,
          resource_id: lb.LoadBalancerName,
          resource_name: name,
          resource_type: 'load-balancer',
          region,
          tags,
          metadata: {
            tags_state: tagsState,
            type: lb.Type,
            scheme: lb.Scheme,
            vpc_id: lb.VpcId,
            dns_name: lb.DNSName,
            availability_zones: lb.AvailabilityZones,
          },
          status: (lb.State?.Code || 'unknown') as ResourceStatus,
          is_public: lb.Scheme === 'internet-facing',
          estimated_monthly_cost: this.estimateLBCost(lb),
        });
      }
    } catch (error: any) {
      // A failed or partial listing is not the account's list: rethrown so the caller
      // records the failure, upserts nothing from it, and never treats it as complete.
      console.error('[Load Balancer Discovery] Error:', error.message);
      throw error;
    }

    return resources;
  }

  /**
   * Estimate monthly cost for Load Balancer
   */
  private estimateLBCost(lb: any): number {
    // ALB pricing: $0.0225 per hour + $0.008 per LCU-hour
    // Estimate: 1 ALB running 24/7, 10 LCUs
    const hours = 730;
    const fixedCost = 0.0225 * hours;
    const lcuCost = 0.008 * 10 * hours;

    return fixedCost + lcuCost;
  }

  /**
   * Discover CloudFront distributions
   * CloudFront is a global service — uses us-east-1 endpoint
   */
  private async discoverCloudFrontDistributions(
    organizationId: string,
    cfClient: CloudFrontClient
  ): Promise<CreateAWSResourceInput[]> {
    const resources: CreateAWSResourceInput[] = [];

    try {
      const distributions: DistributionSummary[] = [];
      let pageCount = 0;
      for await (const page of paginateListDistributions({ client: cfClient }, {})) {
        pageCount++;
        // A page that says more follow but gives no marker to read them by ends the
        // listing early: what was read is not the account's list.
        if (page.DistributionList?.IsTruncated && !page.DistributionList.NextMarker) {
          throw new Error('ListDistributions returned a truncated page with no NextMarker');
        }
        distributions.push(...(page.DistributionList?.Items || []));
      }
      this.logIfPaginated('CloudFront distributions', pageCount, distributions.length);

      for (const dist of distributions) {
        if (!dist.ARN || !dist.Id) continue;

        const origins = (dist.Origins?.Items || []).map((o: any) => o.DomainName);

        resources.push({
          organization_id: organizationId,
          resource_arn: dist.ARN,
          resource_id: dist.Id,
          resource_name: dist.DomainName || dist.Id,
          resource_type: 'cloudfront',
          region: 'global',
          // A distribution's tags are not read (that takes ListTagsForResource per
          // distribution), so they are unknown rather than empty.
          tags: {},
          metadata: {
            tags_state: 'unavailable' as TagsState,
            domain_name: dist.DomainName,
            status: dist.Status,
            price_class: dist.PriceClass,
            origins,
            is_enabled: dist.Enabled,
            http_version: dist.HttpVersion,
            last_modified: dist.LastModifiedTime?.toISOString(),
          },
          // Deployed -> active; InProgress (a change is propagating) -> in-progress;
          // anything else, or nothing, is unknown. Never 'inactive' by default.
          status: this.mapCloudFrontStatus(dist.Status),
          // is_public is not set: a distribution is an internet endpoint by design,
          // which is not a public-access problem to report (see checkPublicAccess).
          estimated_monthly_cost: this.estimateCloudFrontCost(),
        });
      }
    } catch (error: any) {
      // A failed or partial listing is not the account's list: rethrown so the caller
      // records the failure, upserts nothing from it, and never reconciles from it.
      console.error('[CloudFront Discovery] Error:', error.message);
      throw error;
    }

    return resources;
  }

  /**
   * Estimate monthly cost for CloudFront distribution
   */
  private estimateCloudFrontCost(): number {
    // $0.0085 per 10,000 HTTPS requests — estimate 10M requests/month
    return 8.5;
  }

}
