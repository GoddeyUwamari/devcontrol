import { Pool } from 'pg';
import {
  EC2Client,
  DescribeInstancesCommand,
  Instance,
  DescribeVolumesCommand,
  DescribeAddressesCommand,
} from '@aws-sdk/client-ec2';
import {
  RDSClient,
  DescribeDBInstancesCommand,
  DBInstance,
} from '@aws-sdk/client-rds';
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetBucketEncryptionCommand,
  GetBucketAclCommand,
} from '@aws-sdk/client-s3';
import {
  LambdaClient,
  ListFunctionsCommand,
  ListTagsCommand,
} from '@aws-sdk/client-lambda';
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
} from '@aws-sdk/client-ecs';
import {
  ElasticLoadBalancingV2Client,
  DescribeLoadBalancersCommand,
  DescribeTagsCommand as DescribeELBTagsCommand,
} from '@aws-sdk/client-elastic-load-balancing-v2';
import {
  DescribeVpcsCommand,
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
    // Note: 7 types currently implemented. To reach 10, add: DynamoDB, ElastiCache, CloudFront
    // These would require implementation of discovery methods
  ], // 7 types (expandable to 10)
  pro: ['ec2', 'rds', 's3', 'lambda', 'ecs', 'vpc', 'load-balancer'], // All current types
  enterprise: ['ec2', 'rds', 's3', 'lambda', 'ecs', 'vpc', 'load-balancer'], // All current types
};

export class AWSResourceDiscoveryService {
  constructor(private pool: Pool) {}

  /**
   * Get organization's subscription tier
   */
  private async getOrganizationTier(organizationId: string): Promise<SubscriptionTier> {
    const result = await this.pool.query(
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
      // Get organization's subscription tier
      const tier = await this.getOrganizationTier(organizationId);
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
          const lambdaResources = await this.discoverLambdaFunctions(organizationId, awsClients.region);
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
          const ecsResources = await this.discoverECSServices(organizationId, awsClients.region);
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
          const lbResources = await this.discoverLoadBalancers(organizationId, awsClients.region);
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
         SET status = $1, completed_at = NOW(), resources_discovered = $2, resources_updated = $3, error_message = $4
         WHERE id = $5`,
        [
          errors.length > 0 ? 'failed' : 'completed',
          totalDiscovered,
          totalUpdated,
          errors.length > 0 ? errors.join('; ') : null,
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
    const command = new DescribeInstancesCommand({});
    const response = await ec2Client.send(command);

    const resources: CreateAWSResourceInput[] = [];

    for (const reservation of response.Reservations || []) {
      for (const instance of reservation.Instances || []) {
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
          is_encrypted: this.checkEC2Encryption(instance),
          is_public: !!instance.PublicIpAddress,
          has_backup: false, // Will be determined by compliance scanner
        });
      }
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
    const command = new DescribeDBInstancesCommand({});
    const response = await rdsClient.send(command);

    const resources: CreateAWSResourceInput[] = [];

    for (const dbInstance of response.DBInstances || []) {
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
    const command = new ListBucketsCommand({});
    const response = await s3Client.send(command);

    const resources: CreateAWSResourceInput[] = [];

    for (const bucket of response.Buckets || []) {
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
   * Check if EC2 instance has encrypted volumes
   */
  private checkEC2Encryption(instance: Instance): boolean {
    // Check if EBS volumes are encrypted
    // For simplicity, assume not encrypted (real check would query volumes)
    return false;
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
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const lambdaClient = new LambdaClient({ region });
    const resources: CreateAWSResourceInput[] = [];

    try {
      const { Functions } = await lambdaClient.send(new ListFunctionsCommand({}));

      for (const func of Functions || []) {
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
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const ecsClient = new ECSClient({ region });
    const resources: CreateAWSResourceInput[] = [];

    try {
      // List all clusters
      const { clusterArns } = await ecsClient.send(new ListClustersCommand({}));

      for (const clusterArn of clusterArns || []) {
        // List services in cluster
        const { serviceArns } = await ecsClient.send(
          new ListServicesCommand({ cluster: clusterArn })
        );

        if (!serviceArns || serviceArns.length === 0) continue;

        // Describe services
        const { services } = await ecsClient.send(
          new DescribeServicesCommand({
            cluster: clusterArn,
            services: serviceArns,
          })
        );

        for (const service of services || []) {
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
    region: string
  ): Promise<CreateAWSResourceInput[]> {
    const elbClient = new ElasticLoadBalancingV2Client({ region });
    const resources: CreateAWSResourceInput[] = [];

    try {
      const { LoadBalancers } = await elbClient.send(new DescribeLoadBalancersCommand({}));

      for (const lb of LoadBalancers || []) {
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
      const { Vpcs } = await ec2Client.send(new DescribeVpcsCommand({}));

      for (const vpc of Vpcs || []) {
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
}
