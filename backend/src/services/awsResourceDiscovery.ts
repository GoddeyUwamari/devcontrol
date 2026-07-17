import { Pool } from 'pg';
import {
  EC2Client,
  paginateDescribeInstances,
  Instance,
  DescribeVolumesCommand,
  DescribeAddressesCommand,
} from '@aws-sdk/client-ec2';
import {
  RDSClient,
  paginateDescribeDBInstances,
  paginateDescribeDBClusters,
  DBInstance,
  DBCluster,
} from '@aws-sdk/client-rds';
import {
  EKSClient,
  paginateListClusters as paginateEKSListClusters,
  DescribeClusterCommand as EKSDescribeClusterCommand,
} from '@aws-sdk/client-eks';
import {
  DynamoDBClient,
  paginateListTables,
  DescribeTableCommand,
} from '@aws-sdk/client-dynamodb';
import {
  CloudFrontClient,
  paginateListDistributions,
  DistributionSummary,
} from '@aws-sdk/client-cloudfront';
import {
  APIGatewayClient,
  paginateGetRestApis,
  RestApi,
} from '@aws-sdk/client-api-gateway';
import {
  ElastiCacheClient,
  paginateDescribeCacheClusters,
  CacheCluster,
} from '@aws-sdk/client-elasticache';
import {
  SQSClient,
  paginateListQueues,
  GetQueueAttributesCommand,
} from '@aws-sdk/client-sqs';
import {
  SNSClient,
  paginateListTopics,
  GetTopicAttributesCommand,
  Topic,
} from '@aws-sdk/client-sns';
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetBucketEncryptionCommand,
  GetBucketAclCommand,
  Bucket,
} from '@aws-sdk/client-s3';
import {
  LambdaClient,
  paginateListFunctions,
  ListTagsCommand,
  FunctionConfiguration,
} from '@aws-sdk/client-lambda';
import {
  ECSClient,
  paginateListClusters as paginateECSListClusters,
  paginateListServices,
  DescribeServicesCommand,
  Service,
} from '@aws-sdk/client-ecs';
import {
  ElasticLoadBalancingV2Client,
  paginateDescribeLoadBalancers,
  DescribeTagsCommand as DescribeELBTagsCommand,
  LoadBalancer,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  paginateDescribeVpcs,
  Vpc,
} from '@aws-sdk/client-ec2';
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
import { AccountSecurityFindingsRepository } from '../repositories/account-security-findings.repository';
import { PoolClient } from 'pg';

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

      // Discover S3 buckets
      if (this.isResourceTypeAllowed('s3', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering S3 buckets...`);
        try {
          const s3Resources = await this.discoverS3Buckets(organizationId, awsClients.s3!, awsClients.region);
          for (const resource of s3Resources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
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

      // Discover ECS services
      if (this.isResourceTypeAllowed('ecs', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering ECS services...`);
        try {
          const ecsResources = await this.discoverECSServices(organizationId, awsClients.ecs, awsClients.region);
          for (const resource of ecsResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${ecsResources.length} ECS services`);
        } catch (error: any) {
          console.error(`❌ [Discovery] ECS discovery failed:`, error.message);
          errors.push(`ECS: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping ECS services (not available in ${tier} tier)`);
        skippedTypes.push('ecs');
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

      // Discover VPC resources
      if (this.isResourceTypeAllowed('vpc', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering VPCs...`);
        try {
          const vpcResources = await this.discoverVPCResources(organizationId, awsClients.ec2!, awsClients.region);
          for (const resource of vpcResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${vpcResources.length} VPCs`);
        } catch (error: any) {
          console.error(`❌ [Discovery] VPC discovery failed:`, error.message);
          errors.push(`VPC: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping VPCs (not available in ${tier} tier)`);
        skippedTypes.push('vpc');
      }

      // Discover EKS clusters
      if (this.isResourceTypeAllowed('eks', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering EKS clusters...`);
        try {
          const eksResources = await this.discoverEKSClusters(organizationId, awsClients.eks, awsClients.region);
          for (const resource of eksResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${eksResources.length} EKS clusters`);
        } catch (error: any) {
          console.error(`❌ [Discovery] EKS discovery failed:`, error.message);
          errors.push(`EKS: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping EKS clusters (not available in ${tier} tier)`);
        skippedTypes.push('eks');
      }

      // Discover DynamoDB tables
      if (this.isResourceTypeAllowed('dynamodb', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering DynamoDB tables...`);
        try {
          const dynamoResources = await this.discoverDynamoDBTables(organizationId, awsClients.dynamodb, awsClients.region);
          for (const resource of dynamoResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${dynamoResources.length} DynamoDB tables`);
        } catch (error: any) {
          console.error(`❌ [Discovery] DynamoDB discovery failed:`, error.message);
          errors.push(`DynamoDB: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping DynamoDB tables (not available in ${tier} tier)`);
        skippedTypes.push('dynamodb');
      }

      // Discover CloudFront distributions
      if (this.isResourceTypeAllowed('cloudfront', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering CloudFront distributions...`);
        try {
          const cfResources = await this.discoverCloudFrontDistributions(organizationId, awsClients.cloudFront);
          for (const resource of cfResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${cfResources.length} CloudFront distributions`);
        } catch (error: any) {
          console.error(`❌ [Discovery] CloudFront discovery failed:`, error.message);
          errors.push(`CloudFront: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping CloudFront distributions (not available in ${tier} tier)`);
        skippedTypes.push('cloudfront');
      }

      // Discover API Gateway REST APIs
      if (this.isResourceTypeAllowed('api-gateway', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering API Gateway REST APIs...`);
        try {
          const agResources = await this.discoverAPIGatewayAPIs(organizationId, awsClients.apiGateway, awsClients.region);
          for (const resource of agResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${agResources.length} API Gateway REST APIs`);
        } catch (error: any) {
          console.error(`❌ [Discovery] API Gateway discovery failed:`, error.message);
          errors.push(`API Gateway: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping API Gateway REST APIs (not available in ${tier} tier)`);
        skippedTypes.push('api-gateway');
      }

      // Discover ElastiCache clusters
      if (this.isResourceTypeAllowed('elasticache', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering ElastiCache clusters...`);
        try {
          const ecResources = await this.discoverElastiCacheClusters(organizationId, awsClients.elastiCache, awsClients.region);
          for (const resource of ecResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${ecResources.length} ElastiCache clusters`);
        } catch (error: any) {
          console.error(`❌ [Discovery] ElastiCache discovery failed:`, error.message);
          errors.push(`ElastiCache: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping ElastiCache clusters (not available in ${tier} tier)`);
        skippedTypes.push('elasticache');
      }

      // Discover Aurora clusters
      if (this.isResourceTypeAllowed('aurora', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering Aurora clusters...`);
        try {
          const auroraResources = await this.discoverAuroraClusters(organizationId, awsClients.rds, awsClients.region);
          for (const resource of auroraResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${auroraResources.length} Aurora clusters`);
        } catch (error: any) {
          console.error(`❌ [Discovery] Aurora discovery failed:`, error.message);
          errors.push(`Aurora: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping Aurora clusters (not available in ${tier} tier)`);
        skippedTypes.push('aurora');
      }

      // Discover SQS queues
      if (this.isResourceTypeAllowed('sqs', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering SQS queues...`);
        try {
          const sqsResources = await this.discoverSQSQueues(organizationId, awsClients.sqs, awsClients.region);
          for (const resource of sqsResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${sqsResources.length} SQS queues`);
        } catch (error: any) {
          console.error(`❌ [Discovery] SQS discovery failed:`, error.message);
          errors.push(`SQS: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping SQS queues (not available in ${tier} tier)`);
        skippedTypes.push('sqs');
      }

      // Discover SNS topics
      if (this.isResourceTypeAllowed('sns', allowedTypes)) {
        console.log(`🔎 [Discovery] Discovering SNS topics...`);
        try {
          const snsResources = await this.discoverSNSTopics(organizationId, awsClients.sns, awsClients.region);
          for (const resource of snsResources) {
            const result = await this.upsertResource(client, resource);
            if (result === 'created') totalDiscovered++;
            else if (result === 'updated') totalUpdated++;
          }
          console.log(`✅ [Discovery] Found ${snsResources.length} SNS topics`);
        } catch (error: any) {
          console.error(`❌ [Discovery] SNS discovery failed:`, error.message);
          errors.push(`SNS: ${error.message}`);
        }
      } else {
        console.log(`⏭️  [Discovery] Skipping SNS topics (not available in ${tier} tier)`);
        skippedTypes.push('sns');
      }

      // Compliance scan: evaluate every currently-known resource for this org against
      // real encryption/public-access/backup/tag/SOC2/HIPAA checks, persisting genuine
      // compliance_issues instead of the stubbed always-[] value.
      let complianceScanCompleted = false;
      try {
        console.log(`🔎 [Discovery] Running compliance scan...`);
        const scanner = new ComplianceScannerService();
        const { rows: allResources } = await client.query(
          `SELECT * FROM aws_resources WHERE organization_id = $1`,
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
      try {
        console.log(`🔎 [Discovery] Running account-level security scan (security groups + IAM)...`);
        const scanner = new ComplianceScannerService();
        const scanStartedAt = new Date();

        const [sgIssues, iamIssues] = await Promise.all([
          scanner.checkSecurityGroups(awsClients.ec2!, awsClients.region, awsClients.accountId),
          scanner.checkIAMSecurity(awsClients.iam!),
        ]);

        const findingsRepo = new AccountSecurityFindingsRepository();
        const findings = AccountSecurityFindingsRepository.fromComplianceIssues(
          [...sgIssues, ...iamIssues],
          awsClients.region
        );
        const { active, resolved } = await findingsRepo.reconcileScan(organizationId, scanStartedAt, findings);

        console.log(`✅ [Discovery] Account-level security scan complete (${active} active, ${resolved} resolved)`);
      } catch (error: any) {
        console.error(`❌ [Discovery] Account-level security scan failed:`, error.message);
        errors.push(`Account-level security scan: ${error.message}`);
        complianceScanCompleted = false;
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
        const recommendations = await costOptimizationService.analyzeAllResources(organizationId);

        const recommendationsRepo = new CostRecommendationsRepository();
        await recommendationsRepo.deleteAllActive(organizationId);
        await recommendationsRepo.createBulk(recommendations, organizationId);

        console.log(`✅ [Discovery] Cost optimization analysis complete (${recommendations.length} opportunities found)`);
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
         SET status = $1, completed_at = NOW(), resources_discovered = $2, resources_updated = $3, error_message = $4, compliance_scan_completed = $5, cost_analysis_completed = $6
         WHERE id = $7`,
        [
          errors.length > 0 ? 'failed' : 'completed',
          totalDiscovered,
          totalUpdated,
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

      return {
        job_id: jobId,
        resources_discovered: totalDiscovered,
        resources_updated: totalUpdated,
        resources_deleted: 0,
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
   * Estimate monthly cost for S3 bucket
   * Fixed estimate (actual cost depends on storage and requests)
   */
  private estimateS3Cost(): number {
    return 5; // $5/month baseline estimate
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
   * Discover ECS services
   */
  private async discoverECSServices(
    organizationId: string,
    ecsClient: ECSClient,
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const resources: CreateAWSResourceInput[] = [];

    try {
      // List all clusters
      const clusterArns: string[] = [];
      let clusterPageCount = 0;
      for await (const page of paginateECSListClusters({ client: ecsClient }, {})) {
        clusterPageCount++;
        clusterArns.push(...(page.clusterArns || []));
      }
      this.logIfPaginated('ECS clusters', clusterPageCount, clusterArns.length);

      for (const clusterArn of clusterArns) {
        // List services in cluster (default page size is only 10 — must paginate)
        const serviceArns: string[] = [];
        let servicePageCount = 0;
        for await (const page of paginateListServices({ client: ecsClient }, { cluster: clusterArn })) {
          servicePageCount++;
          serviceArns.push(...(page.serviceArns || []));
        }
        this.logIfPaginated(`ECS services in cluster ${clusterArn}`, servicePageCount, serviceArns.length);

        if (serviceArns.length === 0) continue;

        // DescribeServices accepts at most 10 service ARNs per call — chunk
        // accordingly (same pattern as getVolumeEncryptionMap's 200-id chunking below)
        const services: Service[] = [];
        const chunkSize = 10;
        for (let i = 0; i < serviceArns.length; i += chunkSize) {
          const chunk = serviceArns.slice(i, i + chunkSize);
          const { services: chunkServices } = await ecsClient.send(
            new DescribeServicesCommand({ cluster: clusterArn, services: chunk })
          );
          services.push(...(chunkServices || []));
        }

        for (const service of services) {
          if (!service.serviceArn || !service.serviceName) continue;

          const tags = (service.tags || []).reduce((acc, tag) => {
            if (tag.key && tag.value) {
              acc[tag.key] = tag.value;
            }
            return acc;
          }, {} as Record<string, string>);

          const name = tags.Name || service.serviceName;

          resources.push({
            organization_id: organizationId,
            resource_arn: service.serviceArn,
            resource_id: service.serviceName,
            resource_name: name,
            resource_type: 'ecs',
            region,
            tags,
            metadata: {
              cluster: service.clusterArn,
              task_definition: service.taskDefinition,
              desired_count: service.desiredCount,
              running_count: service.runningCount,
              launch_type: service.launchType,
            },
            status: (service.status || 'UNKNOWN') as ResourceStatus,
            estimated_monthly_cost: this.estimateECSCost(service),
          });
        }
      }
    } catch (error: any) {
      console.error('[ECS Discovery] Error:', error.message);
    }

    return resources;
  }

  /**
   * Estimate monthly cost for ECS service
   */
  private estimateECSCost(service: any): number {
    // Fargate pricing: $0.04048 per vCPU/hour, $0.004445 per GB/hour
    // Estimate: 0.25 vCPU, 0.5 GB, running 24/7
    const vCPU = 0.25;
    const memoryGB = 0.5;
    const hours = 730; // hours per month
    const tasks = service.desiredCount || 1;

    const cpuCost = vCPU * 0.04048 * hours * tasks;
    const memoryCost = memoryGB * 0.004445 * hours * tasks;

    return cpuCost + memoryCost;
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
   * Discover VPC resources (VPCs, Subnets, Security Groups)
   */
  private async discoverVPCResources(
    organizationId: string,
    ec2Client: EC2Client,
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const resources: CreateAWSResourceInput[] = [];

    try {
      // Discover VPCs
      const vpcs: Vpc[] = [];
      let pageCount = 0;
      for await (const page of paginateDescribeVpcs({ client: ec2Client }, {})) {
        pageCount++;
        vpcs.push(...(page.Vpcs || []));
      }
      this.logIfPaginated('VPCs', pageCount, vpcs.length);

      for (const vpc of vpcs) {
        if (!vpc.VpcId) continue;

        const tags = this.extractTags(vpc.Tags);
        const name = tags.Name || vpc.VpcId;

        // Get account ID from VPC owner ID
        const accountId = vpc.OwnerId || '*';

        resources.push({
          organization_id: organizationId,
          resource_arn: `arn:aws:ec2:${region}:${accountId}:vpc/${vpc.VpcId}`,
          resource_id: vpc.VpcId,
          resource_name: name,
          resource_type: 'vpc',
          region,
          tags,
          metadata: {
            cidr_block: vpc.CidrBlock,
            is_default: vpc.IsDefault,
            state: vpc.State,
          },
          status: (vpc.State || 'available') as ResourceStatus,
          estimated_monthly_cost: 0, // VPCs are free
        });
      }
    } catch (error: any) {
      console.error('[VPC Discovery] Error:', error.message);
    }

    return resources;
  }

  /**
   * Discover EKS clusters
   */
  private async discoverEKSClusters(
    organizationId: string,
    eksClient: EKSClient,
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const resources: CreateAWSResourceInput[] = [];

    try {
      const clusterNames: string[] = [];
      let pageCount = 0;
      for await (const page of paginateEKSListClusters({ client: eksClient }, {})) {
        pageCount++;
        clusterNames.push(...(page.clusters || []));
      }
      this.logIfPaginated('EKS clusters', pageCount, clusterNames.length);

      if (clusterNames.length === 0) return resources;

      for (const clusterName of clusterNames) {
        try {
          const { cluster } = await eksClient.send(
            new EKSDescribeClusterCommand({ name: clusterName })
          );

          if (!cluster || !cluster.arn || !cluster.name) continue;

          const tags = cluster.tags || {};

          resources.push({
            organization_id: organizationId,
            resource_arn: cluster.arn,
            resource_id: cluster.name,
            resource_name: cluster.name,
            resource_type: 'eks',
            region,
            tags,
            metadata: {
              kubernetes_version: cluster.version,
              status: cluster.status,
              endpoint: cluster.endpoint,
              role_arn: cluster.roleArn,
              created_at: cluster.createdAt?.toISOString(),
            },
            status: (cluster.status === 'ACTIVE' ? 'active' : 'inactive') as ResourceStatus,
            estimated_monthly_cost: this.estimateEKSCost(),
          });
        } catch (error: any) {
          console.error(`[EKS Discovery] Error describing cluster ${clusterName}:`, error.message);
        }
      }
    } catch (error: any) {
      console.error('[EKS Discovery] Error:', error.message);
    }

    return resources;
  }

  /**
   * Estimate monthly cost for EKS cluster
   */
  private estimateEKSCost(): number {
    // EKS control plane: $0.10/hour = $73/month
    return 73;
  }

  /**
   * Discover DynamoDB tables
   */
  private async discoverDynamoDBTables(
    organizationId: string,
    dynamoClient: DynamoDBClient,
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const resources: CreateAWSResourceInput[] = [];

    try {
      const tableNames: string[] = [];
      let pageCount = 0;
      for await (const page of paginateListTables({ client: dynamoClient }, {})) {
        pageCount++;
        tableNames.push(...(page.TableNames || []));
      }
      this.logIfPaginated('DynamoDB tables', pageCount, tableNames.length);

      for (const tableName of tableNames) {
        try {
          const { Table } = await dynamoClient.send(
            new DescribeTableCommand({ TableName: tableName })
          );

          if (!Table || !Table.TableArn || !Table.TableName) continue;

          resources.push({
            organization_id: organizationId,
            resource_arn: Table.TableArn,
            resource_id: Table.TableName,
            resource_name: Table.TableName,
            resource_type: 'dynamodb',
            region,
            tags: {},
            metadata: {
              status: Table.TableStatus,
              item_count: Table.ItemCount,
              table_size_bytes: Table.TableSizeBytes,
              billing_mode: Table.BillingModeSummary?.BillingMode || 'PROVISIONED',
              read_capacity: Table.ProvisionedThroughput?.ReadCapacityUnits,
              write_capacity: Table.ProvisionedThroughput?.WriteCapacityUnits,
            },
            status: (Table.TableStatus === 'ACTIVE' ? 'active' : 'inactive') as ResourceStatus,
            estimated_monthly_cost: this.estimateDynamoDBCost(Table),
          });
        } catch (error: any) {
          console.error(`[DynamoDB Discovery] Error describing table ${tableName}:`, error.message);
        }
      }
    } catch (error: any) {
      console.error('[DynamoDB Discovery] Error:', error.message);
    }

    return resources;
  }

  /**
   * Estimate monthly cost for DynamoDB table
   */
  private estimateDynamoDBCost(table: any): number {
    // On-demand pricing estimate: $1.25 per million writes, $0.25 per million reads
    // Provisioned: $0.00065/RCU/hour, $0.00013/WCU/hour
    const rcu = table.ProvisionedThroughput?.ReadCapacityUnits || 5;
    const wcu = table.ProvisionedThroughput?.WriteCapacityUnits || 5;
    const hours = 730;
    return (rcu * 0.00065 + wcu * 0.00013) * hours;
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

  /**
   * Discover API Gateway REST APIs
   */
  private async discoverAPIGatewayAPIs(
    organizationId: string,
    agClient: APIGatewayClient,
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const resources: CreateAWSResourceInput[] = [];

    try {
      const apis: RestApi[] = [];
      let pageCount = 0;
      for await (const page of paginateGetRestApis({ client: agClient }, {})) {
        pageCount++;
        apis.push(...(page.items || []));
      }
      this.logIfPaginated('API Gateway REST APIs', pageCount, apis.length);

      for (const api of apis) {
        if (!api.id || !api.name) continue;

        const arn = `arn:aws:apigateway:${region}::/restapis/${api.id}`;

        resources.push({
          organization_id: organizationId,
          resource_arn: arn,
          resource_id: api.id,
          resource_name: api.name,
          resource_type: 'api-gateway',
          region,
          tags: api.tags || {},
          metadata: {
            api_id: api.id,
            protocol: 'REST',
            description: api.description,
            created_date: api.createdDate?.toISOString(),
            endpoint_type: api.endpointConfiguration?.types?.[0],
          },
          status: 'active' as ResourceStatus,
          estimated_monthly_cost: this.estimateAPIGatewayCost(),
        });
      }
    } catch (error: any) {
      console.error('[API Gateway Discovery] Error:', error.message);
    }

    return resources;
  }

  /**
   * Estimate monthly cost for API Gateway REST API
   */
  private estimateAPIGatewayCost(): number {
    // $3.50 per million API calls — estimate 1M calls/month
    return 3.5;
  }

  /**
   * Discover ElastiCache clusters
   */
  private async discoverElastiCacheClusters(
    organizationId: string,
    ecClient: ElastiCacheClient,
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const resources: CreateAWSResourceInput[] = [];

    try {
      const cacheClusters: CacheCluster[] = [];
      let pageCount = 0;
      for await (const page of paginateDescribeCacheClusters({ client: ecClient }, { ShowCacheNodeInfo: true })) {
        pageCount++;
        cacheClusters.push(...(page.CacheClusters || []));
      }
      this.logIfPaginated('ElastiCache clusters', pageCount, cacheClusters.length);

      for (const cluster of cacheClusters) {
        if (!cluster.CacheClusterId) continue;

        const arn = cluster.ARN || `arn:aws:elasticache:${region}:*:cluster:${cluster.CacheClusterId}`;

        resources.push({
          organization_id: organizationId,
          resource_arn: arn,
          resource_id: cluster.CacheClusterId,
          resource_name: cluster.CacheClusterId,
          resource_type: 'elasticache',
          region,
          tags: {},
          metadata: {
            engine: cluster.Engine,
            engine_version: cluster.EngineVersion,
            node_type: cluster.CacheNodeType,
            num_nodes: cluster.NumCacheNodes,
            status: cluster.CacheClusterStatus,
            preferred_az: cluster.PreferredAvailabilityZone,
          },
          status: (cluster.CacheClusterStatus === 'available' ? 'available' : 'inactive') as ResourceStatus,
          estimated_monthly_cost: this.estimateElastiCacheCost(cluster.CacheNodeType || 'cache.t3.micro'),
        });
      }
    } catch (error: any) {
      console.error('[ElastiCache Discovery] Error:', error.message);
    }

    return resources;
  }

  /**
   * Estimate monthly cost for ElastiCache cluster
   */
  private estimateElastiCacheCost(nodeType: string): number {
    const costs: Record<string, number> = {
      'cache.t3.micro':  13,
      'cache.t3.small':  26,
      'cache.t3.medium': 52,
      'cache.r6g.large': 122,
      'cache.r6g.xlarge': 244,
    };
    return costs[nodeType] || 25;
  }

  /**
   * Discover Aurora clusters
   * Filters RDS DB clusters by Aurora engine families
   */
  private async discoverAuroraClusters(
    organizationId: string,
    rdsClient: RDSClient,
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const resources: CreateAWSResourceInput[] = [];

    try {
      const dbClusters: DBCluster[] = [];
      let pageCount = 0;
      for await (const page of paginateDescribeDBClusters({ client: rdsClient }, {})) {
        pageCount++;
        dbClusters.push(...(page.DBClusters || []));
      }
      this.logIfPaginated('Aurora/RDS clusters', pageCount, dbClusters.length);

      const auroraEngines = new Set(['aurora', 'aurora-mysql', 'aurora-postgresql']);

      for (const cluster of dbClusters) {
        if (!cluster.DBClusterIdentifier || !cluster.Engine) continue;
        if (!auroraEngines.has(cluster.Engine)) continue;

        const arn = cluster.DBClusterArn || `arn:aws:rds:${region}:*:cluster:${cluster.DBClusterIdentifier}`;
        const tags = (cluster.TagList || []).reduce((acc: Record<string, string>, tag: any) => {
          if (tag.Key && tag.Value) acc[tag.Key] = tag.Value;
          return acc;
        }, {});

        resources.push({
          organization_id: organizationId,
          resource_arn: arn,
          resource_id: cluster.DBClusterIdentifier,
          resource_name: cluster.DBClusterIdentifier,
          resource_type: 'aurora',
          region,
          tags,
          metadata: {
            engine: cluster.Engine,
            engine_version: cluster.EngineVersion,
            status: cluster.Status,
            multi_az: cluster.MultiAZ,
            db_cluster_members: cluster.DBClusterMembers?.length,
            endpoint: cluster.Endpoint,
            reader_endpoint: cluster.ReaderEndpoint,
          },
          status: (cluster.Status || 'unknown') as ResourceStatus,
          is_encrypted: cluster.StorageEncrypted || false,
          has_backup: (cluster.BackupRetentionPeriod || 0) > 0,
          estimated_monthly_cost: this.estimateAuroraCost(cluster),
        });
      }
    } catch (error: any) {
      console.error('[Aurora Discovery] Error:', error.message);
    }

    return resources;
  }

  /**
   * Estimate monthly cost for Aurora cluster
   */
  private estimateAuroraCost(cluster: any): number {
    // Aurora Serverless v2: ~$0.12/ACU/hour; provisioned: varies by instance class
    // Estimate based on member count
    const members = cluster.DBClusterMembers?.length || 1;
    return members * 150; // ~$150/instance/month baseline
  }

  /**
   * Discover SQS queues
   */
  private async discoverSQSQueues(
    organizationId: string,
    sqsClient: SQSClient,
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const resources: CreateAWSResourceInput[] = [];

    try {
      const queueUrls: string[] = [];
      let pageCount = 0;
      for await (const page of paginateListQueues({ client: sqsClient }, {})) {
        pageCount++;
        queueUrls.push(...(page.QueueUrls || []));
      }
      this.logIfPaginated('SQS queues', pageCount, queueUrls.length);

      for (const queueUrl of queueUrls) {
        try {
          const { Attributes } = await sqsClient.send(
            new GetQueueAttributesCommand({
              QueueUrl: queueUrl,
              AttributeNames: [
                'QueueArn',
                'ApproximateNumberOfMessages',
                'VisibilityTimeout',
                'CreatedTimestamp',
                'FifoQueue',
              ],
            })
          );

          if (!Attributes?.QueueArn) continue;

          const queueName = queueUrl.split('/').pop() || queueUrl;

          resources.push({
            organization_id: organizationId,
            resource_arn: Attributes.QueueArn,
            resource_id: queueName,
            resource_name: queueName,
            resource_type: 'sqs',
            region,
            tags: {},
            metadata: {
              queue_url: queueUrl,
              approximate_number_of_messages: parseInt(Attributes.ApproximateNumberOfMessages || '0'),
              visibility_timeout: parseInt(Attributes.VisibilityTimeout || '30'),
              is_fifo: queueName.endsWith('.fifo'),
            },
            status: 'active' as ResourceStatus,
            estimated_monthly_cost: this.estimateSQSCost(),
          });
        } catch (error: any) {
          console.error(`[SQS Discovery] Error describing queue ${queueUrl}:`, error.message);
        }
      }
    } catch (error: any) {
      console.error('[SQS Discovery] Error:', error.message);
    }

    return resources;
  }

  /**
   * Estimate monthly cost for SQS queue
   */
  private estimateSQSCost(): number {
    // $0.40 per million requests — estimate 1M requests/month
    return 0.4;
  }

  /**
   * Discover SNS topics
   */
  private async discoverSNSTopics(
    organizationId: string,
    snsClient: SNSClient,
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const resources: CreateAWSResourceInput[] = [];

    try {
      const topics: Topic[] = [];
      let pageCount = 0;
      for await (const page of paginateListTopics({ client: snsClient }, {})) {
        pageCount++;
        topics.push(...(page.Topics || []));
      }
      this.logIfPaginated('SNS topics', pageCount, topics.length);

      for (const topic of topics) {
        if (!topic.TopicArn) continue;

        try {
          const { Attributes } = await snsClient.send(
            new GetTopicAttributesCommand({ TopicArn: topic.TopicArn })
          );

          const topicName = topic.TopicArn.split(':').pop() || topic.TopicArn;

          resources.push({
            organization_id: organizationId,
            resource_arn: topic.TopicArn,
            resource_id: topicName,
            resource_name: topicName,
            resource_type: 'sns',
            region,
            tags: {},
            metadata: {
              subscriptions_confirmed: parseInt(Attributes?.SubscriptionsConfirmed || '0'),
              subscriptions_pending: parseInt(Attributes?.SubscriptionsPending || '0'),
              display_name: Attributes?.DisplayName,
              fifo_topic: Attributes?.FifoTopic === 'true',
            },
            status: 'active' as ResourceStatus,
            estimated_monthly_cost: this.estimateSNSCost(
              parseInt(Attributes?.SubscriptionsConfirmed || '0')
            ),
          });
        } catch (error: any) {
          console.error(`[SNS Discovery] Error describing topic ${topic.TopicArn}:`, error.message);
        }
      }
    } catch (error: any) {
      console.error('[SNS Discovery] Error:', error.message);
    }

    return resources;
  }

  /**
   * Estimate monthly cost for SNS topic
   */
  private estimateSNSCost(subscriptionCount: number): number {
    // $0.50 per million publishes — estimate 100K publishes, $0.09/1000 deliveries
    return 0.5 + (subscriptionCount * 0.09 / 1000);
  }
}
