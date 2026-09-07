import {
  CloudWatchClient,
  GetMetricStatisticsCommand,
  Statistic,
} from '@aws-sdk/client-cloudwatch';
import {
  EC2Client,
  DescribeInstancesCommand,
  DescribeAddressesCommand,
  DescribeReservedInstancesCommand,
  DescribeVolumesCommand,
  Instance,
} from '@aws-sdk/client-ec2';
import {
  RDSClient,
  DescribeDBInstancesCommand,
  DBInstance,
} from '@aws-sdk/client-rds';
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';
import { LambdaClient, ListFunctionsCommand } from '@aws-sdk/client-lambda';
import { CreateRecommendationRequest, RecommendationSeverity } from '../types';
import { AWSClientFactory } from './aws-client-factory.service';
import {
  ISSUE_EC2_IDLE_INSTANCE,
  ISSUE_RDS_OVERSIZED_INSTANCE,
  ISSUE_EC2_UNUSED_ELASTIC_IP,
  ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY,
  ISSUE_EBS_UNATTACHED_VOLUME,
  ISSUE_S3_LIFECYCLE_OPTIMIZATION,
  ISSUE_LAMBDA_LOW_USAGE,
} from '../config/optimization-rules';
import {
  estimateEBSMonthlyCost,
  S3_STANDARD_PER_GB_MONTH_USD,
  S3_STANDARD_IA_PER_GB_MONTH_USD,
  estimateLambdaMonthlyCostFromUsage,
} from '../config/aws-pricing';
import { getBucketLifecycleStatus, hasOnlyNonExpiringRules } from './s3-lifecycle.util';
import { getLambdaUsageOverWindow, LAMBDA_USAGE_WINDOW_DAYS } from './lambda-usage.util';

// Heuristic threshold, same convention as idle EC2's "<5% CPU over 7 days":
// an explicit, disclosed number rather than a hidden one. 30-day window
// (longer than idle EC2's 7-day window) because Lambda invocation patterns
// legitimately include weekly/monthly batch jobs that a 7-day window would
// misclassify as unused.
const LAMBDA_LOW_USAGE_MAX_INVOCATIONS_30D = 10;

interface OptimizationIssue {
  resourceId: string;
  resourceName: string;
  resourceType: string;
  issue: string;
  description: string;
  potentialSavings: number;
  severity: RecommendationSeverity;
  awsRegion: string;
  metadata: Record<string, any>;
}

// success=false means the detector's AWS call(s) threw internally (auth
// failure, timeout, rate limit, etc.) -- issues is always [] in that case,
// and MUST NOT be interpreted as "this detector found nothing." Only
// success=true means the returned issues array is the complete observation
// for that detector's scope this scan. Reserved Instance Opportunities are
// deliberately NOT wrapped in this contract -- see analyzeAllResources().
interface DetectorResult {
  success: boolean;
  issues: OptimizationIssue[];
}

// One entry per non-RI detector category, tagged with the fixed `issue`
// string that detector always emits (the same canonical, already-stored
// discriminator used as the identity tuple's third column) so the
// repository's reconciliation logic knows which existing rows a given
// category's success/failure applies to, without re-deriving that mapping.
export interface DetectorObservation {
  issue: string;
  success: boolean;
  recommendations: CreateRecommendationRequest[];
}

class CostOptimizationService {
  /**
   * Main analysis function - detects all cost optimization opportunities
   * for the given organization's connected AWS account.
   *
   * Returns the 3 resource-level detectors' output separately from Reserved
   * Instance Opportunities: RI findings use a synthetic, fleet-level
   * aggregate resource_id (`ri-opportunity-${instanceType}`), not a discrete
   * AWS resource, so they are explicitly excluded from the occurrence
   * lifecycle (resolve/dismiss suppression, disappearance/recurrence
   * tracking) applied to the other three -- see
   * CostRecommendationsRepository.reconcileActiveRecommendations() vs.
   * deleteActiveByIssue()+createBulk() for how the two paths diverge.
   */
  async analyzeAllResources(organizationId: string): Promise<{
    observations: DetectorObservation[];
    riRecommendations: CreateRecommendationRequest[];
  }> {
    const clients = await AWSClientFactory.createClients(organizationId);

    if (!clients.enabled) {
      console.log(`AWS not connected for org ${organizationId}, skipping cost analysis`);
      return { observations: [], riRecommendations: [] };
    }

    try {
      const [idleEC2, oversizedRDS, unusedEIPs, unattachedEBS, s3Lifecycle, lowUsageLambda, riOpportunities] = await Promise.all([
        this.detectIdleEC2Instances(clients.ec2, clients.cloudWatch),
        this.detectOversizedRDSInstances(clients.rds),
        this.detectUnusedElasticIPs(clients.ec2),
        this.detectUnattachedEBSVolumes(clients.ec2),
        this.detectS3LifecycleOptimization(clients.s3, clients.cloudWatch),
        this.detectLowUsageLambdaFunctions(organizationId, clients.lambda, clients.cloudWatch),
        this.detectReservedInstanceOpportunities(clients.ec2),
      ]);

      const toRequest = (issue: OptimizationIssue): CreateRecommendationRequest => ({
        resource_id: issue.resourceId,
        resource_name: issue.resourceName,
        resource_type: issue.resourceType,
        issue: issue.issue,
        description: issue.description,
        potential_savings: issue.potentialSavings,
        severity: issue.severity,
        aws_region: issue.awsRegion,
        metadata: issue.metadata,
      });

      const observations: DetectorObservation[] = [
        { issue: ISSUE_EC2_IDLE_INSTANCE, success: idleEC2.success, recommendations: idleEC2.issues.map(toRequest) },
        { issue: ISSUE_RDS_OVERSIZED_INSTANCE, success: oversizedRDS.success, recommendations: oversizedRDS.issues.map(toRequest) },
        { issue: ISSUE_EC2_UNUSED_ELASTIC_IP, success: unusedEIPs.success, recommendations: unusedEIPs.issues.map(toRequest) },
        { issue: ISSUE_EBS_UNATTACHED_VOLUME, success: unattachedEBS.success, recommendations: unattachedEBS.issues.map(toRequest) },
        { issue: ISSUE_S3_LIFECYCLE_OPTIMIZATION, success: s3Lifecycle.success, recommendations: s3Lifecycle.issues.map(toRequest) },
        { issue: ISSUE_LAMBDA_LOW_USAGE, success: lowUsageLambda.success, recommendations: lowUsageLambda.issues.map(toRequest) },
      ];

      return {
        observations,
        riRecommendations: riOpportunities.map(toRequest),
      };
    } catch (error) {
      console.error('Error analyzing resources:', error);
      throw error;
    }
  }

  /**
   * Detect idle EC2 instances (CPU < 5% for 7+ days)
   */
  private async detectIdleEC2Instances(
    ec2Client: EC2Client,
    cloudWatchClient: CloudWatchClient
  ): Promise<DetectorResult> {
    try {
      const command = new DescribeInstancesCommand({
        Filters: [
          {
            Name: 'instance-state-name',
            Values: ['running'],
          },
        ],
      });

      const response = await ec2Client.send(command);
      const issues: OptimizationIssue[] = [];

      for (const reservation of response.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          if (!instance.InstanceId) continue;

          // Check CPU utilization for the last 7 days
          const avgCPU = await this.getAverageCPUUtilization(
            cloudWatchClient,
            instance.InstanceId,
            7
          );

          if (avgCPU < 5) {
            const nameTag = instance.Tags?.find((tag) => tag.Key === 'Name');
            const monthlyCost = this.estimateEC2Cost(instance.InstanceType || '');

            issues.push({
              resourceId: instance.InstanceId,
              resourceName: nameTag?.Value || instance.InstanceId,
              resourceType: 'EC2',
              issue: ISSUE_EC2_IDLE_INSTANCE,
              description: `This EC2 instance has averaged ${avgCPU.toFixed(2)}% CPU utilization over the past 7 days. Consider stopping or downsizing it.`,
              potentialSavings: monthlyCost,
              severity: this.calculateSeverity(monthlyCost),
              awsRegion: instance.Placement?.AvailabilityZone?.slice(0, -1) || process.env.AWS_REGION || 'us-east-1',
              metadata: {
                instance_type: instance.InstanceType,
                average_cpu: avgCPU,
                days_analyzed: 7,
              },
            });
          }
        }
      }

      return { success: true, issues };
    } catch (error) {
      console.error('Error detecting idle EC2 instances:', error);
      return { success: false, issues: [] };
    }
  }

  /**
   * Detect oversized RDS instances (dev/staging using production-sized instances)
   */
  private async detectOversizedRDSInstances(rdsClient: RDSClient): Promise<DetectorResult> {
    try {
      const command = new DescribeDBInstancesCommand({});
      const response = await rdsClient.send(command);
      const issues: OptimizationIssue[] = [];

      for (const instance of response.DBInstances || []) {
        if (!instance.DBInstanceIdentifier) continue;

        // Check if it's a dev/staging environment (common naming patterns)
        const identifier = instance.DBInstanceIdentifier.toLowerCase();
        const isNonProd =
          identifier.includes('dev') ||
          identifier.includes('staging') ||
          identifier.includes('test');

        // Check if using large instance types
        const instanceClass = instance.DBInstanceClass || '';
        const isOversized =
          instanceClass.includes('large') ||
          instanceClass.includes('xlarge') ||
          instanceClass.includes('2xlarge');

        if (isNonProd && isOversized) {
          const currentCost = this.estimateRDSCost(instanceClass);
          const recommendedClass = this.recommendSmallerRDSInstance(instanceClass);
          const recommendedCost = this.estimateRDSCost(recommendedClass);
          const savings = currentCost - recommendedCost;

          if (savings > 0) {
            issues.push({
              resourceId: instance.DBInstanceIdentifier,
              resourceName: instance.DBInstanceIdentifier,
              resourceType: 'RDS',
              issue: ISSUE_RDS_OVERSIZED_INSTANCE,
              description: `Non-production RDS instance using ${instanceClass}. Consider downsizing to ${recommendedClass} to save $${savings.toFixed(2)}/month.`,
              potentialSavings: savings,
              severity: this.calculateSeverity(savings),
              awsRegion: instance.AvailabilityZone?.slice(0, -1) || process.env.AWS_REGION || 'us-east-1',
              metadata: {
                current_instance_class: instanceClass,
                recommended_instance_class: recommendedClass,
                environment: isNonProd ? 'non-production' : 'production',
              },
            });
          }
        }
      }

      return { success: true, issues };
    } catch (error) {
      console.error('Error detecting oversized RDS instances:', error);
      return { success: false, issues: [] };
    }
  }

  /**
   * Detect unused Elastic IPs
   */
  private async detectUnusedElasticIPs(ec2Client: EC2Client): Promise<DetectorResult> {
    try {
      const command = new DescribeAddressesCommand({});
      const response = await ec2Client.send(command);
      const issues: OptimizationIssue[] = [];

      for (const address of response.Addresses || []) {
        // Elastic IPs not attached to an instance are charged
        if (!address.InstanceId && !address.NetworkInterfaceId) {
          const monthlyCost = 3.6; // $0.005/hour * 24 * 30 = $3.6/month

          issues.push({
            resourceId: address.AllocationId || address.PublicIp || 'unknown',
            resourceName: address.PublicIp || 'Unknown EIP',
            resourceType: 'EIP',
            issue: ISSUE_EC2_UNUSED_ELASTIC_IP,
            description: `Elastic IP ${address.PublicIp} is not attached to any instance. Unattached Elastic IPs incur charges.`,
            potentialSavings: monthlyCost,
            severity: 'LOW',
            awsRegion: process.env.AWS_REGION || 'us-east-1',
            metadata: {
              public_ip: address.PublicIp,
              allocation_id: address.AllocationId,
            },
          });
        }
      }

      return { success: true, issues };
    } catch (error) {
      console.error('Error detecting unused Elastic IPs:', error);
      return { success: false, issues: [] };
    }
  }

  /**
   * Detect unattached EBS volumes.
   *
   * "Available" is AWS's own volume-state value for a volume that exists but
   * is not attached to any instance -- this is read directly from the
   * DescribeVolumes response, never inferred from missing tags/metadata (an
   * untagged-but-attached volume must not be flagged).
   */
  private async detectUnattachedEBSVolumes(ec2Client: EC2Client): Promise<DetectorResult> {
    try {
      const command = new DescribeVolumesCommand({
        Filters: [
          {
            Name: 'status',
            Values: ['available'],
          },
        ],
      });

      const response = await ec2Client.send(command);
      const issues: OptimizationIssue[] = [];

      for (const volume of response.Volumes || []) {
        if (!volume.VolumeId) continue;

        const nameTag = volume.Tags?.find((tag) => tag.Key === 'Name');
        const sizeGB = volume.Size || 0;
        const volumeType = volume.VolumeType || 'unknown';
        const monthlyCost = estimateEBSMonthlyCost(volumeType, sizeGB);

        issues.push({
          resourceId: volume.VolumeId,
          resourceName: nameTag?.Value || volume.VolumeId,
          resourceType: 'EBS',
          issue: ISSUE_EBS_UNATTACHED_VOLUME,
          description: `This ${sizeGB}GB ${volumeType} volume is not attached to any instance. Unattached EBS volumes continue to incur storage charges.`,
          potentialSavings: monthlyCost,
          severity: this.calculateSeverity(monthlyCost),
          awsRegion: volume.AvailabilityZone?.slice(0, -1) || process.env.AWS_REGION || 'us-east-1',
          metadata: {
            volume_type: volumeType,
            size_gb: sizeGB,
            availability_zone: volume.AvailabilityZone,
            encrypted: volume.Encrypted || false,
          },
        });
      }

      return { success: true, issues };
    } catch (error) {
      console.error('Error detecting unattached EBS volumes:', error);
      return { success: false, issues: [] };
    }
  }

  /**
   * Detect S3 buckets that would benefit from a lifecycle policy.
   *
   * Uses the same getBucketLifecycleStatus() helper as awsResourceDiscovery.ts
   * so the two never disagree about what "has a lifecycle policy" means. A
   * per-bucket AWS failure (AccessDenied/throttling on either the lifecycle
   * check or the size metric) skips that one bucket -- logged, never
   * escalated into a false "no lifecycle configuration" finding and never
   * failing the whole detector.
   *
   * Savings is a disclosed ceiling, not a guarantee: real current Standard
   * storage size (CloudWatch BucketSizeBytes) x the real published
   * Standard-vs-Standard-IA per-GB-month price difference, assuming 100% of
   * the bucket's current data would qualify for transition -- the same
   * "assumes full remediation" framing every other detector in this file
   * already uses. A bucket with no BucketSizeBytes datapoint (empty, or the
   * daily metric hasn't published yet) is skipped rather than assumed to be
   * 0 -- see getBucketStandardStorageGB().
   */
  private async detectS3LifecycleOptimization(
    s3Client: S3Client,
    cloudWatchClient: CloudWatchClient
  ): Promise<DetectorResult> {
    try {
      const response = await s3Client.send(new ListBucketsCommand({}));
      const issues: OptimizationIssue[] = [];

      for (const bucket of response.Buckets || []) {
        if (!bucket.Name) continue;

        const lifecycleStatus = await getBucketLifecycleStatus(s3Client, bucket.Name);

        let lifecycleState: 'no_lifecycle_configuration' | 'incomplete_lifecycle_rules' | null = null;
        let enabledRuleCount: number | undefined;

        if (lifecycleStatus.state === 'no_lifecycle_configuration') {
          lifecycleState = 'no_lifecycle_configuration';
        } else if (lifecycleStatus.state === 'has_lifecycle_rules') {
          if (hasOnlyNonExpiringRules(lifecycleStatus.rules)) {
            lifecycleState = 'incomplete_lifecycle_rules';
            enabledRuleCount = lifecycleStatus.enabledRuleCount;
          }
          // else: has real expiring/transitioning rules -- sufficient, no finding
        }
        // lifecycleStatus.state === 'unavailable' -- skip, don't guess

        if (!lifecycleState) continue;

        const sizeGB = await this.getBucketStandardStorageGB(cloudWatchClient, bucket.Name);
        if (sizeGB === null || sizeGB <= 0) continue; // no reliable size signal or genuinely empty -- nothing to recommend

        const monthlySavingsCeiling = sizeGB * (S3_STANDARD_PER_GB_MONTH_USD - S3_STANDARD_IA_PER_GB_MONTH_USD);

        const description = lifecycleState === 'no_lifecycle_configuration'
          ? `This bucket has no lifecycle configuration. If all ${sizeGB.toFixed(1)}GB of its current Standard storage qualified for a transition to Standard-IA, the maximum possible saving is estimated below -- actual savings depend on how much of this data is genuinely infrequently accessed, since Standard-IA adds a retrieval fee.`
          : `This bucket has a lifecycle configuration, but its ${enabledRuleCount} enabled rule(s) only transition storage class and never expire objects or abort incomplete multipart uploads. The estimate below is the same storage-class-transition ceiling as a bucket with no configuration at all.`;

        issues.push({
          resourceId: bucket.Name,
          resourceName: bucket.Name,
          resourceType: 'S3',
          issue: ISSUE_S3_LIFECYCLE_OPTIMIZATION,
          description,
          potentialSavings: monthlySavingsCeiling,
          severity: this.calculateSeverity(monthlySavingsCeiling),
          awsRegion: process.env.AWS_REGION || 'us-east-1',
          metadata: {
            lifecycle_state: lifecycleState,
            enabled_rule_count: enabledRuleCount,
            standard_storage_gb: sizeGB,
            savings_basis: 'ceiling: assumes 100% of current Standard storage transitions to Standard-IA; does not net out Standard-IA retrieval fees',
          },
        });
      }

      return { success: true, issues };
    } catch (error) {
      console.error('Error detecting S3 lifecycle optimization opportunities:', error);
      return { success: false, issues: [] };
    }
  }

  /**
   * Real current Standard-storage size for a bucket, from CloudWatch's daily
   * BucketSizeBytes metric (free, always-on, no extra permission beyond
   * cloudwatch:GetMetricStatistics). Returns null -- never 0 -- when there is
   * no datapoint in the lookback window, since that's indistinguishable from
   * "hasn't published yet" and must not be treated as "confirmed empty".
   */
  private async getBucketStandardStorageGB(
    cloudWatchClient: CloudWatchClient,
    bucketName: string
  ): Promise<number | null> {
    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - 2 * 24 * 60 * 60 * 1000); // BucketSizeBytes publishes once/day

      const response = await cloudWatchClient.send(
        new GetMetricStatisticsCommand({
          Namespace: 'AWS/S3',
          MetricName: 'BucketSizeBytes',
          Dimensions: [
            { Name: 'BucketName', Value: bucketName },
            { Name: 'StorageType', Value: 'StandardStorage' },
          ],
          StartTime: startTime,
          EndTime: endTime,
          Period: 86400,
          Statistics: [Statistic.Average],
        })
      );

      if (!response.Datapoints || response.Datapoints.length === 0) {
        return null;
      }

      const latest = response.Datapoints.sort(
        (a, b) => (b.Timestamp?.getTime() || 0) - (a.Timestamp?.getTime() || 0)
      )[0];

      return latest.Average != null ? latest.Average / (1024 * 1024 * 1024) : null;
    } catch (error) {
      console.error(`Error fetching BucketSizeBytes for ${bucketName}:`, error);
      return null;
    }
  }

  /**
   * Detect low-usage/infrequently-invoked Lambda functions.
   *
   * A function's own single-bucket CloudWatch failure skips only that
   * function (logged), never fails the whole detector or is assumed zero.
   * Savings uses this function's REAL 30-day invocation count and average
   * duration through AWS's public Lambda pricing formula -- via the shared
   * getLambdaUsageOverWindow() (lambda-usage.util.ts), the same source
   * awsResourceDiscovery.ts now uses for `estimated_monthly_cost`, so
   * inventory and optimization can never disagree about a function's usage.
   */
  private async detectLowUsageLambdaFunctions(
    organizationId: string,
    lambdaClient: LambdaClient,
    cloudWatchClient: CloudWatchClient
  ): Promise<DetectorResult> {
    try {
      const response = await lambdaClient.send(new ListFunctionsCommand({}));
      const issues: OptimizationIssue[] = [];

      for (const func of response.Functions || []) {
        if (!func.FunctionName) continue;

        const usage = await getLambdaUsageOverWindow(cloudWatchClient, organizationId, func.FunctionName);
        if (usage === null) continue; // CloudWatch call itself failed -- never assumed zero

        const { invocations, avgDurationMs } = usage;
        if (invocations > LAMBDA_LOW_USAGE_MAX_INVOCATIONS_30D) continue; // normal usage

        const memoryMB = func.MemorySize || 128;
        const monthlyCost = estimateLambdaMonthlyCostFromUsage(invocations, avgDurationMs, memoryMB);

        issues.push({
          resourceId: func.FunctionName,
          resourceName: func.FunctionName,
          resourceType: 'Lambda',
          issue: ISSUE_LAMBDA_LOW_USAGE,
          description: invocations === 0
            ? `This function had zero invocations over the last ${LAMBDA_USAGE_WINDOW_DAYS} days.`
            : `This function was invoked only ${invocations} time(s) over the last ${LAMBDA_USAGE_WINDOW_DAYS} days. Estimated cost below is based on its actual invocation count and average duration in that window, not an assumed usage level.`,
          potentialSavings: monthlyCost,
          severity: this.calculateSeverity(monthlyCost),
          awsRegion: process.env.AWS_REGION || 'us-east-1',
          metadata: {
            invocations_30d: invocations,
            avg_duration_ms: avgDurationMs,
            memory_mb: memoryMB,
            usage_state: invocations === 0 ? 'zero_usage' : 'low_usage',
          },
        });
      }

      return { success: true, issues };
    } catch (error) {
      console.error('Error detecting low-usage Lambda functions:', error);
      return { success: false, issues: [] };
    }
  }

  /**
   * Detect Reserved Instance opportunities
   */
  private async detectReservedInstanceOpportunities(
    ec2Client: EC2Client
  ): Promise<OptimizationIssue[]> {
    try {
      // Get running instances
      const instancesCommand = new DescribeInstancesCommand({
        Filters: [
          {
            Name: 'instance-state-name',
            Values: ['running'],
          },
        ],
      });
      const instancesResponse = await ec2Client.send(instancesCommand);

      // Get existing Reserved Instances
      const riCommand = new DescribeReservedInstancesCommand({
        Filters: [
          {
            Name: 'state',
            Values: ['active'],
          },
        ],
      });
      const riResponse = await ec2Client.send(riCommand);

      // Count instances by type
      const instanceCounts: Record<string, number> = {};
      for (const reservation of instancesResponse.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          const type = instance.InstanceType || 'unknown';
          instanceCounts[type] = (instanceCounts[type] || 0) + 1;
        }
      }

      // Count reserved instances by type
      const riCounts: Record<string, number> = {};
      for (const ri of riResponse.ReservedInstances || []) {
        const type = ri.InstanceType || 'unknown';
        riCounts[type] = (riCounts[type] || 0) + (ri.InstanceCount || 0);
      }

      const issues: OptimizationIssue[] = [];

      // Find instances running for 3+ months without RI (simplified: if count > 2, suggest RI)
      for (const [instanceType, count] of Object.entries(instanceCounts)) {
        const reservedCount = riCounts[instanceType] || 0;
        const unconveredCount = count - reservedCount;

        if (unconveredCount >= 2) {
          // RI typically saves 30-40% vs on-demand
          const onDemandCost = this.estimateEC2Cost(instanceType);
          const riCost = onDemandCost * 0.65; // 35% savings
          const monthlySavings = (onDemandCost - riCost) * unconveredCount;

          issues.push({
            resourceId: `ri-opportunity-${instanceType}`,
            resourceName: `${unconveredCount}x ${instanceType}`,
            resourceType: 'EC2',
            issue: ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY,
            description: `You have ${unconveredCount} ${instanceType} instance(s) running without Reserved Instance coverage. Purchasing RIs could save approximately $${monthlySavings.toFixed(2)}/month (35% discount).`,
            potentialSavings: monthlySavings,
            severity: this.calculateSeverity(monthlySavings),
            awsRegion: process.env.AWS_REGION || 'us-east-1',
            metadata: {
              instance_type: instanceType,
              uncovered_count: unconveredCount,
              estimated_discount: '35%',
            },
          });
        }
      }

      return issues;
    } catch (error) {
      console.error('Error detecting RI opportunities:', error);
      return [];
    }
  }

  /**
   * Get average CPU utilization from CloudWatch
   */
  private async getAverageCPUUtilization(
    cloudWatchClient: CloudWatchClient,
    instanceId: string,
    days: number
  ): Promise<number> {
    try {
      const endTime = new Date();
      const startTime = new Date(endTime.getTime() - days * 24 * 60 * 60 * 1000);

      const command = new GetMetricStatisticsCommand({
        Namespace: 'AWS/EC2',
        MetricName: 'CPUUtilization',
        Dimensions: [
          {
            Name: 'InstanceId',
            Value: instanceId,
          },
        ],
        StartTime: startTime,
        EndTime: endTime,
        Period: 3600, // 1 hour
        Statistics: [Statistic.Average],
      });

      const response = await cloudWatchClient.send(command);

      if (!response.Datapoints || response.Datapoints.length === 0) {
        return 0;
      }

      const sum = response.Datapoints.reduce(
        (acc, dp) => acc + (dp.Average || 0),
        0
      );
      return sum / response.Datapoints.length;
    } catch (error) {
      console.error(`Error getting CPU utilization for ${instanceId}:`, error);
      return 0;
    }
  }

  /**
   * Calculate severity based on potential savings
   */
  private calculateSeverity(monthlySavings: number): RecommendationSeverity {
    if (monthlySavings >= 100) return 'HIGH';
    if (monthlySavings >= 50) return 'MEDIUM';
    return 'LOW';
  }

  /**
   * Estimate EC2 monthly cost
   */
  private estimateEC2Cost(instanceType: string): number {
    const costs: Record<string, number> = {
      't2.micro': 8.5,
      't2.small': 17,
      't2.medium': 34,
      't2.large': 68,
      't3.micro': 7.5,
      't3.small': 15,
      't3.medium': 30,
      't3.large': 60,
      't3.xlarge': 120,
      't3.2xlarge': 240,
      'm5.large': 70,
      'm5.xlarge': 140,
      'm5.2xlarge': 280,
      'm5.4xlarge': 560,
      'c5.large': 62,
      'c5.xlarge': 124,
      'c5.2xlarge': 248,
      'r5.large': 91,
      'r5.xlarge': 182,
      'r5.2xlarge': 364,
    };

    return costs[instanceType] || 50;
  }

  /**
   * Estimate RDS monthly cost
   */
  private estimateRDSCost(instanceClass: string): number {
    const costs: Record<string, number> = {
      'db.t3.micro': 12,
      'db.t3.small': 24,
      'db.t3.medium': 48,
      'db.t3.large': 96,
      'db.m5.large': 122,
      'db.m5.xlarge': 244,
      'db.m5.2xlarge': 488,
      'db.r5.large': 175,
      'db.r5.xlarge': 350,
      'db.r5.2xlarge': 700,
    };

    return costs[instanceClass] || 75;
  }

  /**
   * Recommend smaller RDS instance
   */
  private recommendSmallerRDSInstance(currentClass: string): string {
    const downsizeMap: Record<string, string> = {
      'db.m5.2xlarge': 'db.t3.medium',
      'db.m5.xlarge': 'db.t3.small',
      'db.m5.large': 'db.t3.small',
      'db.r5.2xlarge': 'db.t3.medium',
      'db.r5.xlarge': 'db.t3.small',
      'db.r5.large': 'db.t3.small',
      'db.t3.large': 'db.t3.medium',
    };

    return downsizeMap[currentClass] || 'db.t3.micro';
  }
}

export default new CostOptimizationService();
