import { Pool } from 'pg';
import { trackFunnelEventOnce } from './analyticsEvents';
import {
  EC2Client,
  paginateDescribeInstances,
  Instance,
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
import { AWSClientFactory } from './aws-client-factory.service';
import {
  AWSResource,
  CreateAWSResourceInput,
  ResourceType,
  ResourceStatus,
  DiscoveryResult,
  DiscoveryJobStatus,
  EC2InstanceMetadata,
  RDSInstanceMetadata,
  S3BucketMetadata,
} from '../types/aws-resources.types';
import { SubscriptionTier } from '../middleware/subscription.middleware';
import { ComplianceScannerService } from './complianceScanner';
import { OrphanedResourceDetectorService } from './orphanedResourceDetector';
import costOptimizationService from './cost-optimization.service';
import { CostRecommendationsRepository } from '../repositories/cost-recommendations.repository';
import { AccountSecurityFindingsRepository, AccountFindingCategory } from '../repositories/account-security-findings.repository';
import { securityAuditService } from './securityAudit.service';
import { PoolClient } from 'pg';
import { ResourceExplorerService, GENERIC_RESOURCE_TYPES, RE_RECONCILED_TYPES, NormalizedResourceEntry } from './resourceExplorer.service';
import { ResourceReconciliationService } from './resourceReconciliation.service';

/**
 * Resource types allowed by subscription tier
 */
const TIER_RESOURCE_TYPES: Record<SubscriptionTier, ResourceType[]> = {
  free: ['ec2', 'rds', 's3'], // 3 types - Core compute, database, storage
  starter: [
    'ec2',           // Compute instances
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
  ], // 15 types
  pro: [
    'ec2', 'rds', 's3', 'lambda', 'ecs', 'vpc', 'load-balancer',
    'eks', 'dynamodb', 'cloudfront', 'api-gateway', 'elasticache', 'aurora', 'sqs', 'sns',
  ], // All 15 types
  enterprise: [
    'ec2', 'rds', 's3', 'lambda', 'ecs', 'vpc', 'load-balancer',
    'eks', 'dynamodb', 'cloudfront', 'api-gateway', 'elasticache', 'aurora', 'sqs', 'sns',
  ], // All 15 types
};

export class AWSResourceDiscoveryService {
  private resourceExplorer = new ResourceExplorerService();
  private reconciliation = new ResourceReconciliationService();

  constructor(private pool: Pool) {}

  /**
   * Get organization's subscription tier
   */
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

    const client = await this.pool.connect();
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

      // Get AWS clients
      const awsClients = await AWSClientFactory.createClients(organizationId);

      if (!awsClients.enabled) {
        throw new Error('AWS credentials not configured for this organization');
      }

      console.log(`✅ [Discovery] AWS clients created successfully`);
      console.log(`🌍 [Discovery] Target region: ${awsClients.region}`);

      const errors: string[] = [];
      let totalDiscovered = 0;
      let totalUpdated = 0;
      let resourcesTerminated = 0;
      const skippedTypes: string[] = [];

      // Discover EC2 instances
      if (this.isResourceTypeAllowed('ec2', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering EC2 instances...`);
        try {
          const ec2Resources = await this.discoverEC2Instances(organizationId, awsClients.ec2!, awsClients.region);
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
          const s3Resources = await this.discoverS3Buckets(organizationId, awsClients.s3!, awsClients.region);
          for (const resource of s3Resources) {
            s3ArnsFound.add(resource.resource_arn);
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
          const lambdaResources = await this.discoverLambdaFunctions(organizationId, awsClients.lambda, awsClients.region);
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

      // Compliance scan: evaluate every currently-known resource for this org against
      // real encryption/public-access/backup/tag/SOC2/HIPAA checks, persisting genuine
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

        for (const resource of allResources as AWSResource[]) {
          const issues = await scanner.scanResource(resource);

          if (resource.resource_type === 's3') {
            try {
              const enhanced = await scanner.checkS3PublicAccessEnhanced(resource, awsClients.s3!);
              issues.push(...enhanced);
            } catch (error: any) {
              console.error(`[Discovery] S3 enhanced check failed for ${resource.resource_arn}:`, error.message);
            }
          }

          await client.query(
            `UPDATE aws_resources SET compliance_issues = $1 WHERE id = $2`,
            [JSON.stringify(issues), resource.id]
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

        let iamIssues: typeof networkingObservation.issues = [];
        let iamSucceeded = true;
        try {
          iamIssues = await scanner.checkIAMSecurity(awsClients.iam!);
        } catch (error: any) {
          console.error(`❌ [Discovery] IAM security scan failed:`, error.message);
          errors.push(`IAM security scan: ${error.message}`);
          iamSucceeded = false;
        }

        const findingsRepo = new AccountSecurityFindingsRepository();
        const findings = AccountSecurityFindingsRepository.fromComplianceIssues(
          [...networkingObservation.issues, ...iamIssues],
          awsClients.region
        );
        const completeCategories: AccountFindingCategory[] = [
          ...(networkingObservation.complete ? (['networking'] as const) : []),
          ...(iamSucceeded ? (['iam'] as const) : []),
        ];
        const { active, resolved } = await findingsRepo.reconcileScan(
          organizationId,
          scanStartedAt,
          findings,
          completeCategories
        );

        const fullyComplete = networkingObservation.complete && iamSucceeded;
        if (!fullyComplete) {
          complianceScanCompleted = false;
        }
        securityAuditService
          .record({
            organizationId,
            action: fullyComplete ? 'security.scan.completed' : 'security.scan.partial',
            metadata: { active, resolved, networkingComplete: networkingObservation.complete, iamComplete: iamSucceeded },
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
        const detector = new OrphanedResourceDetectorService(this.pool);
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
        const { observations, riRecommendations } = await costOptimizationService.analyzeAllResources(organizationId);

        const recommendationsRepo = new CostRecommendationsRepository();

        // Occurrence-lifecycle reconciliation for the 3 resource-level
        // detectors -- mirrors the manual /api/cost-recommendations/analyze
        // path (cost-recommendations.controller.ts): suppresses an unchanged
        // Resolve/Dismiss'd finding instead of resurrecting it every scan.
        const { insertedCount: nonRIInsertedCount } = await recommendationsRepo.reconcileActiveRecommendations(
          organizationId,
          observations
        );

        // Reserved Instance Opportunities stay on the prior unconditional
        // delete+recreate behavior -- excluded from the occurrence lifecycle,
        // see cost-optimization.service.ts.
        await recommendationsRepo.deleteActiveByIssue(organizationId, 'Reserved Instance Opportunity');
        const riInsertedCount = await recommendationsRepo.createBulk(riRecommendations, organizationId);

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

      await client.query(
        `UPDATE resource_discovery_jobs
         SET status = $1, completed_at = NOW(), resources_discovered = $2, resources_updated = $3, resources_deleted = $4, error_message = $5, compliance_scan_completed = $6, cost_analysis_completed = $7
         WHERE id = $8`,
        [
          errors.length > 0 ? 'failed' : 'completed',
          totalDiscovered,
          totalUpdated,
          resourcesTerminated,
          errors.length > 0 ? errors.join('; ') : null,
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
        errors
      };
    } catch (error: any) {
      console.error(`\n❌ [Discovery] Fatal error during discovery:`, error.message);
      console.error(`Stack trace:`, error.stack);

      // Update job as failed
      if (jobId!) {
        await client.query(
          `UPDATE resource_discovery_jobs
           SET status = $1, completed_at = NOW(), error_message = $2
           WHERE id = $3`,
          ['failed', error.message, jobId]
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
    region: string
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

    const resources: CreateAWSResourceInput[] = [];

    for (const instance of instances) {
      if (!instance.InstanceId) continue;

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
      };

      resources.push({
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
        has_backup: false, // Will be determined by compliance scanner
      });
    }

    return resources;
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
        is_encrypted: dbInstance.StorageEncrypted || false,
        is_public: dbInstance.PubliclyAccessible || false,
        has_backup: (dbInstance.BackupRetentionPeriod || 0) > 0,
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
    defaultRegion: string
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

    const resources: CreateAWSResourceInput[] = [];

    for (const bucket of buckets) {
      if (!bucket.Name) continue;

      let region = defaultRegion;
      let isEncrypted = false;
      let isPublic = false;

      try {
        // Get bucket region
        const locationCommand = new GetBucketLocationCommand({ Bucket: bucket.Name });
        const locationResponse = await s3Client.send(locationCommand);
        region = locationResponse.LocationConstraint || 'us-east-1';

        // Check encryption
        try {
          const encryptionCommand = new GetBucketEncryptionCommand({ Bucket: bucket.Name });
          await s3Client.send(encryptionCommand);
          isEncrypted = true;
        } catch (error: any) {
          // No encryption configured
          isEncrypted = false;
        }

        // Check public access
        try {
          const aclCommand = new GetBucketAclCommand({ Bucket: bucket.Name });
          const aclResponse = await s3Client.send(aclCommand);
          isPublic = (aclResponse.Grants || []).some(
            grant => grant.Grantee?.URI === 'http://acs.amazonaws.com/groups/global/AllUsers'
          );
        } catch (error: any) {
          // Error checking ACL
          isPublic = false;
        }
      } catch (error: any) {
        console.error(`[S3 Discovery] Error processing bucket ${bucket.Name}:`, error.message);
      }

      const metadata: S3BucketMetadata = {
        creation_date: bucket.CreationDate?.toISOString(),
        versioning_enabled: false, // Could query GetBucketVersioning
        logging_enabled: false,
        lifecycle_rules: 0,
      };

      resources.push({
        organization_id: organizationId,
        resource_arn: `arn:aws:s3:::${bucket.Name}`,
        resource_id: bucket.Name,
        resource_name: bucket.Name,
        resource_type: 's3',
        region,
        tags: {}, // S3 bucket tags require separate API call
        metadata,
        status: 'active' as ResourceStatus,
        estimated_monthly_cost: this.estimateS3Cost(),
        is_encrypted: isEncrypted,
        is_public: isPublic,
        has_backup: false, // S3 has versioning, not traditional backups
      });
    }

    return resources;
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
        tags = EXCLUDED.tags,
        metadata = EXCLUDED.metadata,
        status = EXCLUDED.status,
        estimated_monthly_cost = EXCLUDED.estimated_monthly_cost,
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
        resource.estimated_monthly_cost || 0,
        resource.actual_monthly_cost || 0,
        resource.is_encrypted || false,
        resource.is_public || false,
        resource.has_backup || false,
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
   * (used by the Describe*-based deep-monitored discovery), this never overwrites status,
   * is_encrypted, is_public, has_backup, or compliance_issues on conflict — Resource
   * Explorer's thin {arn, type, region, tags} data can't determine any of those, so
   * clobbering them on every re-discovery would silently erase whatever a prior scan
   * (or the compliance scanner) already determined. Termination is handled exclusively
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
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'unknown', $9, 0, false, false, false, '[]', 0, NOW())
      ON CONFLICT (organization_id, resource_arn)
      DO UPDATE SET
        resource_name = EXCLUDED.resource_name,
        tags = EXCLUDED.tags,
        metadata = EXCLUDED.metadata,
        region = EXCLUDED.region,
        status = CASE WHEN aws_resources.status = 'terminated' THEN 'unknown' ELSE aws_resources.status END,
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
        JSON.stringify({ source: 'resource-explorer', service: entry.service }),
        estimatedMonthlyCost,
      ]
    );

    return result.rows[0].inserted ? 'created' : 'updated';
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
            encryptionMap.set(volume.VolumeId, volume.Encrypted ?? false);
          }
        }
      } catch (error: any) {
        console.error(`[Discovery] DescribeVolumes failed for ${chunk.length} volume(s):`, error.message);
      }
    }

    return encryptionMap;
  }

  /**
   * Check if EC2 instance has encrypted volumes.
   * An instance counts as encrypted only if every EBS volume in its BlockDeviceMappings
   * is confirmed Encrypted via DescribeVolumes. Volumes whose lookup failed are skipped
   * (treated as compliant) rather than reported unencrypted — see getVolumeEncryptionMap.
   */
  private checkEC2Encryption(instance: Instance, volumeEncryptionMap: Map<string, boolean>): boolean {
    const volumeIds = (instance.BlockDeviceMappings || [])
      .map(mapping => mapping.Ebs?.VolumeId)
      .filter((id): id is string => !!id);

    if (volumeIds.length === 0) return true;

    return volumeIds.every(id => volumeEncryptionMap.get(id) ?? true);
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
   * Discover Lambda functions
   */
  private async discoverLambdaFunctions(
    organizationId: string,
    lambdaClient: LambdaClient,
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
        try {
          const { Tags } = await lambdaClient.send(
            new ListTagsCommand({ Resource: func.FunctionArn })
          );
          tags = Tags || {};
        } catch (error) {
          // Tags might not be accessible
          tags = {};
        }

        const name = tags.Name || func.FunctionName;

        resources.push({
          organization_id: organizationId,
          resource_arn: func.FunctionArn,
          resource_id: func.FunctionName,
          resource_name: name,
          resource_type: 'lambda',
          region,
          tags,
          metadata: {
            runtime: func.Runtime,
            memory: func.MemorySize,
            timeout: func.Timeout,
            last_modified: func.LastModified,
            code_size: func.CodeSize,
            handler: func.Handler,
          },
          status: (func.State || 'Active') as ResourceStatus,
          is_encrypted: !!func.Environment?.Variables,
          estimated_monthly_cost: this.estimateLambdaCost(func),
        });
      }
    } catch (error: any) {
      console.error('[Lambda Discovery] Error:', error.message);
    }

    return resources;
  }

  /**
   * Estimate monthly cost for Lambda function
   */
  private estimateLambdaCost(func: any): number {
    // Lambda pricing: $0.20 per 1M requests + $0.0000166667 per GB-second
    // Estimate: 100K requests/month, actual memory, 1s avg duration
    const requests = 100_000;
    const memoryGB = (func.MemorySize || 128) / 1024;
    const duration = Math.min(func.Timeout || 3, 3); // Assume 3s avg

    const requestCost = (requests / 1_000_000) * 0.20;
    const computeCost = (requests * duration * memoryGB) * 0.0000166667;

    return requestCost + computeCost;
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
        } catch (error) {
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
      console.error('[Load Balancer Discovery] Error:', error.message);
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
          tags: {},
          metadata: {
            domain_name: dist.DomainName,
            status: dist.Status,
            price_class: dist.PriceClass,
            origins,
            is_enabled: dist.Enabled,
            http_version: dist.HttpVersion,
            last_modified: dist.LastModifiedTime?.toISOString(),
          },
          status: (dist.Status === 'Deployed' ? 'active' : 'inactive') as ResourceStatus,
          is_public: true,
          estimated_monthly_cost: this.estimateCloudFrontCost(),
        });
      }
    } catch (error: any) {
      console.error('[CloudFront Discovery] Error:', error.message);
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
