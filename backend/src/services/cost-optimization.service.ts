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
import { PoolClient } from 'pg';
import { CreateRecommendationRequest, RecommendationSeverity } from '../types';
import { AWSClientFactory, AWSClients } from './aws-client-factory.service';
import { pool } from '../config/database';
import {
  ISSUE_EC2_IDLE_INSTANCE,
  ISSUE_RDS_OVERSIZED_INSTANCE,
  ISSUE_EC2_UNUSED_ELASTIC_IP,
  ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY,
  ISSUE_EBS_UNATTACHED_VOLUME,
  ISSUE_EBS_GP2_TO_GP3,
  ISSUE_S3_LIFECYCLE_OPTIMIZATION,
  ISSUE_LAMBDA_LOW_USAGE,
  ISSUE_DYNAMODB_CAPACITY,
} from '../config/optimization-rules';
import {
  estimateEBSMonthlyCost,
  S3_STANDARD_PER_GB_MONTH_USD,
  S3_STANDARD_IA_PER_GB_MONTH_USD,
  estimateLambdaMonthlyCostFromUsage,
  estimateDynamoDBProvisionedMonthlyCost,
} from '../config/aws-pricing';
import { getBucketLifecycleStatus, hasOnlyNonExpiringRules } from './s3-lifecycle.util';
import { getLambdaUsageOverWindow, LAMBDA_USAGE_WINDOW_DAYS } from './lambda-usage.util';
import { describeDynamoDBTable, DynamoDBTableConfig } from './dynamodb-table.util';
import { describeDynamoDBAutoscaling } from './dynamodb-autoscaling.util';
import {
  fetchDynamoDBCapacityMetrics,
  analyzeDynamoDBCapacityDimension,
  DynamoDBCapacityDimensionAnalysis,
  DYNAMODB_CAPACITY_ANALYSIS_WINDOW_DAYS,
  DYNAMODB_CAPACITY_PERIOD_SECONDS,
} from './dynamodb-capacity-analysis.util';

// Heuristic threshold, same convention as idle EC2's "<5% CPU over 7 days":
// an explicit, disclosed number rather than a hidden one. 30-day window
// (longer than idle EC2's 7-day window) because Lambda invocation patterns
// legitimately include weekly/monthly batch jobs that a 7-day window would
// misclassify as unused.
const LAMBDA_LOW_USAGE_MAX_INVOCATIONS_30D = 10;

// Phase 3E, dynamodb_capacity: locked v1 eligibility policy (see the
// methodology checkpoints -- do not change without a new methodology
// review). 20% is AWS's own documented reference investigation signal
// (https://docs.aws.amazon.com/amazondynamodb/latest/developerguide/CostOptimization_RightSizedProvisioning.html),
// adopted as DevControl's v1 threshold -- NOT an AWS-mandated rule, and
// never described as one in evidence text. 85%/576 are DevControl policy
// choices (conservative, not AWS-derived): a table must show hourly-average
// utilization below 20% for at least 85% of its valid hourly intervals, over
// a real, non-sparse sample (>=576 of the nominal 720 hourly intervals in a
// 30-day window actually had both a consumed and a provisioned datapoint).
const DYNAMODB_CAPACITY_REFERENCE_UTILIZATION_THRESHOLD_PERCENT = 20;
const DYNAMODB_CAPACITY_MIN_LOW_UTILIZATION_INTERVAL_PERCENT = 85;
const DYNAMODB_CAPACITY_NOMINAL_INTERVALS = (DYNAMODB_CAPACITY_ANALYSIS_WINDOW_DAYS * 24 * 60 * 60) / DYNAMODB_CAPACITY_PERIOD_SECONDS; // 720
const DYNAMODB_CAPACITY_MIN_VALID_INTERVALS = Math.round(DYNAMODB_CAPACITY_NOMINAL_INTERVALS * 0.8); // 576 -- 80% of nominal

// AWS-published gp3 baseline performance included at no extra charge --
// exceeding either means real AWS charges for provisioned IOPS/throughput
// that this codebase does not price anywhere, so gp2_to_gp3 must not
// recommend migration for a volume that would need it.
const GP3_INCLUDED_BASELINE_IOPS = 3000;
const GP3_INCLUDED_BASELINE_THROUGHPUT_MIBPS = 125;
// AWS-published gp2 IOPS formula, used only as a fallback when AWS doesn't
// report a real Iops value on the volume itself.
const GP2_BASELINE_IOPS_PER_GB = 3;
const GP2_MIN_IOPS = 100;
const GP2_MAX_IOPS = 16000;

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
      const [idleEC2, oversizedRDS, unusedEIPs, unattachedEBS, gp2ToGp3, s3Lifecycle, lowUsageLambda, dynamoDBCapacity, riOpportunities] = await Promise.all([
        this.detectIdleEC2Instances(clients.ec2, clients.cloudWatch),
        this.detectOversizedRDSInstances(clients.rds),
        this.detectUnusedElasticIPs(clients.ec2),
        this.detectUnattachedEBSVolumes(clients.ec2),
        this.detectGp2ToGp3Migrations(clients.ec2),
        this.detectS3LifecycleOptimization(clients.s3, clients.cloudWatch),
        this.detectLowUsageLambdaFunctions(organizationId, clients.lambda, clients.cloudWatch),
        this.detectDynamoDBCapacityOptimization(organizationId, clients),
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
        { issue: ISSUE_EBS_GP2_TO_GP3, success: gp2ToGp3.success, recommendations: gp2ToGp3.issues.map(toRequest) },
        { issue: ISSUE_S3_LIFECYCLE_OPTIMIZATION, success: s3Lifecycle.success, recommendations: s3Lifecycle.issues.map(toRequest) },
        { issue: ISSUE_LAMBDA_LOW_USAGE, success: lowUsageLambda.success, recommendations: lowUsageLambda.issues.map(toRequest) },
        { issue: ISSUE_DYNAMODB_CAPACITY, success: dynamoDBCapacity.success, recommendations: dynamoDBCapacity.issues.map(toRequest) },
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
   * Detect gp2 volumes that would cost less on gp3 at the same provisioned
   * size, with no performance regression.
   *
   * Savings is the storage-rate delta only (estimateEBSMonthlyCost('gp2', ...)
   * minus estimateEBSMonthlyCost('gp3', ...), the same shared pricing helper
   * discovery and ebs_unattached already use -- never a second EBS pricing
   * calculation). This is a real, non-speculative saving *only* for volumes
   * whose performance profile stays within gp3's included baseline (3,000
   * IOPS / 125 MiB/s) -- gp3's provisioned-IOPS/throughput pricing above
   * that baseline is not implemented anywhere in this codebase, so a volume
   * that would need it is skipped entirely rather than understating its
   * true post-migration cost.
   *
   * gp2's IOPS is either the value AWS itself reports on the volume, or (if
   * that's absent) derived from AWS's published gp2 formula: baseline
   * 100 IOPS, +3 IOPS per provisioned GB, capped at 16,000 IOPS. Either way,
   * exceeding gp3's 3,000-IOPS free baseline is a hard exclusion, not a
   * lower-confidence recommendation -- there is no partial-credit savings
   * figure to offer once that line is crossed. gp2 has no independently
   * configurable throughput (unlike gp3/io1/io2), so no separate throughput
   * gate is evaluated; the IOPS gate is the sole, conservative eligibility
   * check.
   *
   * Missing/invalid VolumeId, size, or a volume type other than gp2 all
   * result in the volume being skipped -- never a fabricated or zero
   * savings figure.
   */
  private async detectGp2ToGp3Migrations(ec2Client: EC2Client): Promise<DetectorResult> {
    try {
      const command = new DescribeVolumesCommand({
        Filters: [
          {
            Name: 'volume-type',
            Values: ['gp2'],
          },
        ],
      });

      const response = await ec2Client.send(command);
      const issues: OptimizationIssue[] = [];

      for (const volume of response.Volumes || []) {
        if (!volume.VolumeId) continue;
        if (volume.VolumeType !== 'gp2') continue; // defensive -- the API filter already guarantees this

        const sizeGB = volume.Size;
        if (typeof sizeGB !== 'number' || !Number.isFinite(sizeGB) || sizeGB <= 0) continue; // insufficient evidence -- skip, never assume a size

        const currentIops = this.resolveGp2Iops(volume.Iops, sizeGB);
        if (currentIops === null || currentIops > GP3_INCLUDED_BASELINE_IOPS) continue; // exceeds gp3's free baseline -- cannot defensibly price, skip

        const currentMonthlyCost = estimateEBSMonthlyCost('gp2', sizeGB);
        const proposedMonthlyCost = estimateEBSMonthlyCost('gp3', sizeGB);
        const monthlySavings = currentMonthlyCost - proposedMonthlyCost;
        if (!(monthlySavings > 0)) continue; // no real saving to report (also guards against pricing-table drift)

        const nameTag = volume.Tags?.find((tag) => tag.Key === 'Name');

        issues.push({
          resourceId: volume.VolumeId,
          resourceName: nameTag?.Value || volume.VolumeId,
          resourceType: 'EBS',
          issue: ISSUE_EBS_GP2_TO_GP3,
          description: `This ${sizeGB}GB gp2 volume (~${currentIops} IOPS) can migrate to gp3 at the same size for a lower storage rate, with no performance change -- it stays within gp3's included ${GP3_INCLUDED_BASELINE_IOPS.toLocaleString()} IOPS / ${GP3_INCLUDED_BASELINE_THROUGHPUT_MIBPS} MiB/s baseline, so no paid provisioned performance is required.`,
          potentialSavings: monthlySavings,
          severity: this.calculateSeverity(monthlySavings),
          awsRegion: volume.AvailabilityZone?.slice(0, -1) || process.env.AWS_REGION || 'us-east-1',
          metadata: {
            volume_type: 'gp2',
            recommended_volume_type: 'gp3',
            size_gb: sizeGB,
            current_iops: currentIops,
            gp3_included_baseline_iops: GP3_INCLUDED_BASELINE_IOPS,
            gp3_included_baseline_throughput_mibps: GP3_INCLUDED_BASELINE_THROUGHPUT_MIBPS,
            current_monthly_cost: currentMonthlyCost,
            proposed_monthly_cost: proposedMonthlyCost,
            savings_basis: 'estimated: gp2-to-gp3 storage-rate difference at the same provisioned size; limited to volumes whose IOPS stays within gp3\'s included baseline; does not model paid gp3 provisioned IOPS/throughput above that baseline',
            availability_zone: volume.AvailabilityZone,
            encrypted: volume.Encrypted || false,
          },
        });
      }

      return { success: true, issues };
    } catch (error) {
      console.error('Error detecting gp2-to-gp3 migration opportunities:', error);
      return { success: false, issues: [] };
    }
  }

  /**
   * gp2's real, AWS-reported IOPS value when present; otherwise AWS's
   * published gp2 formula (baseline 100, +3 per GB, capped at 16,000) as a
   * fallback derived strictly from already-discovered size. Returns null
   * only when neither a real value nor a valid size is available -- the
   * caller must treat that as "cannot evaluate the safety gate" and skip
   * the volume, never assume it's within baseline.
   */
  private resolveGp2Iops(reportedIops: number | undefined, sizeGB: number): number | null {
    if (typeof reportedIops === 'number' && Number.isFinite(reportedIops) && reportedIops > 0) {
      return reportedIops;
    }
    if (typeof sizeGB !== 'number' || !Number.isFinite(sizeGB) || sizeGB <= 0) return null;
    return Math.min(GP2_MAX_IOPS, Math.max(GP2_MIN_IOPS, GP2_BASELINE_IOPS_PER_GB * sizeGB));
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
   * Detect DynamoDB tables whose provisioned RCU/WCU has substantially
   * exceeded observed workload demand over a real, recent window (Phase 3E
   * `dynamodb_capacity`) -- foundation for this detector is PR #61/#62
   * (billing mode, real capacity, GSI/replica metadata, real Application
   * Auto Scaling state, capacity-change timestamps); methodology is locked
   * by three prior audit/design checkpoints and must not be changed here:
   *
   * - 30-day window, 3,600s (1-hour) period, `Sum` for consumed/throttle,
   *   `Average` for provisioned -- see dynamodb-capacity-analysis.util.ts.
   * - Reference investigation signal: 20% hourly-average utilization (AWS's
   *   own documented reference point, not an AWS-mandated rule).
   * - Eligibility: >=85% of a dimension's valid hourly intervals must be
   *   below 20%, over a real sample of >=576 (80% of the nominal 720)
   *   valid intervals -- read and write evaluated fully independently, and
   *   read OR write qualifying is sufficient (the occurrence identity is
   *   (organization_id, resource_id, issue), so at most one row per table).
   * - Any confirmed table-level provisioned-throughput throttling (Sum>0 in
   *   any valid throttle interval) disqualifies that dimension. Zero valid
   *   throttle datapoints also disqualifies -- "no throttling" can never be
   *   claimed from zero evidence. Evidence text says exactly "no table-level
   *   provisioned-throughput throttling observed," never the broader,
   *   unproven "no throttling occurred" (table-level metrics cannot see
   *   partition/key-range or account-level throttling).
   * - GSI-bearing and Global Table (replica) tables are excluded outright --
   *   AWS's own metrics reference confirms `TableName`-only queries (what
   *   this detector uses) are blind to GSI-scoped consumption AND GSI-scoped
   *   throttling; Global Tables have a separate, unmodeled replication-write
   *   cost this codebase's pricing does not account for.
   * - No exact recommended RCU/WCU is ever produced (Model B, evidence-only).
   *   The cost figure is an explicitly-labeled illustrative scenario --
   *   "modeled monthly savings if provisioned capacity matched the highest
   *   hourly-average demand observed" -- never "recommended," "safe,"
   *   "ceiling," or "maximum required" capacity. `savings_basis` always
   *   starts with `scenario:`, never `ceiling:`.
   *
   * Architecture: reads already-enriched `aws_resources` metadata (written
   * by awsResourceDiscovery.ts's enrichDynamoDBTables(), which already runs
   * every six hours) as a cheap initial filter -- never re-runs DescribeTable
   * for every table. Only candidates surviving that cheap filter get a
   * targeted, fresh live DescribeTable + DescribeScalableTargets
   * re-confirmation (via the table's own persisted region, using the
   * regional client getters -- never the org's default single-region
   * `clients.dynamodb`/`clients.cloudWatch`) before any CloudWatch call or
   * cost calculation; a live-verification failure, or the fresh data itself
   * failing any gate, fails that table closed rather than trusting stale
   * metadata. Never reads `aws_resources.estimated_monthly_cost` (the
   * unrelated flat `$3` generic placeholder) -- current and scenario cost
   * are always computed fresh via estimateDynamoDBProvisionedMonthlyCost().
   */
  private async detectDynamoDBCapacityOptimization(
    organizationId: string,
    awsClients: Pick<AWSClients, 'getDynamoDBClientForRegion' | 'getCloudWatchClientForRegion' | 'getApplicationAutoScalingClientForRegion'>
  ): Promise<DetectorResult> {
    let client: PoolClient | undefined;
    try {
      client = await pool.connect();
      // Session-scoped (is_local = false) -- this same client runs the one
      // aws_resources SELECT below, then is released immediately (never held
      // open across the AWS calls that follow). Same fix as a1f894b/3687608
      // (see system-intelligence.service.ts's computeSecurityScore()):
      // a `true` (local) value would revert before this RLS-protected query
      // ever ran, silently returning zero rows instead of erroring.
      await client.query("SELECT set_config('app.current_organization_id', $1, false)", [organizationId]);

      const tablesResult = await client.query(
        `SELECT resource_id, resource_name, region, metadata
         FROM aws_resources
         WHERE organization_id = $1 AND resource_type = 'dynamodb'`,
        [organizationId]
      );
      client.release();
      client = undefined;

      const issues: OptimizationIssue[] = [];
      const now = new Date();

      for (const row of tablesResult.rows) {
        const metadata = (row.metadata || {}) as Record<string, any>;
        const cheapGate = this.checkDynamoDBCapacityEligibilityGates(metadata, now);
        if (!cheapGate.eligible) continue;

        const tableName: string = row.resource_id;
        const region: string = row.region;

        const dynamoDBClient = awsClients.getDynamoDBClientForRegion(region);
        const autoscalingClient = awsClients.getApplicationAutoScalingClientForRegion(region);

        const tableResult = await describeDynamoDBTable(dynamoDBClient, tableName);
        if (tableResult.status !== 'described') {
          console.error(`[dynamodb_capacity] Live DescribeTable unavailable for ${tableName} (${region}): ${tableResult.reason}`);
          continue; // fail closed -- never fall back to the stale metadata snapshot for the final decision
        }

        const autoscalingResult = await describeDynamoDBAutoscaling(autoscalingClient, tableName);
        if (autoscalingResult.status !== 'described') {
          console.error(`[dynamodb_capacity] Live Application Auto Scaling check unavailable for ${tableName} (${region}): ${autoscalingResult.reason}`);
          continue; // fail closed -- never assume AUTOSCALING_DISABLED
        }

        const freshConfig: DynamoDBTableConfig = tableResult.config;
        const freshAutoscalingState = autoscalingResult.config.autoscaling_state;
        const freshGate = this.checkDynamoDBCapacityEligibilityGates(
          { ...freshConfig, autoscaling_state: freshAutoscalingState },
          now
        );
        if (!freshGate.eligible) continue;

        const currentReadCapacity = freshConfig.provisioned_read_capacity;
        const currentWriteCapacity = freshConfig.provisioned_write_capacity;
        if (currentReadCapacity === undefined || currentWriteCapacity === undefined) continue; // insufficient evidence, never assumed

        const cloudWatchClient = awsClients.getCloudWatchClientForRegion(region);
        const metricsResult = await fetchDynamoDBCapacityMetrics(cloudWatchClient, tableName);
        if (metricsResult.status !== 'fetched') {
          console.error(`[dynamodb_capacity] CloudWatch capacity metrics unavailable for ${tableName} (${region}): ${metricsResult.reason}`);
          continue;
        }
        const series = metricsResult.series;

        const readAnalysis = analyzeDynamoDBCapacityDimension(
          series.consumedReadPerSecond,
          series.provisionedRead,
          series.readThrottleEvents,
          DYNAMODB_CAPACITY_REFERENCE_UTILIZATION_THRESHOLD_PERCENT
        );
        const writeAnalysis = analyzeDynamoDBCapacityDimension(
          series.consumedWritePerSecond,
          series.provisionedWrite,
          series.writeThrottleEvents,
          DYNAMODB_CAPACITY_REFERENCE_UTILIZATION_THRESHOLD_PERCENT
        );

        const readQualifies = this.dynamoDBCapacityDimensionQualifies(readAnalysis);
        const writeQualifies = this.dynamoDBCapacityDimensionQualifies(writeAnalysis);
        if (!readQualifies && !writeQualifies) continue; // no defensible review opportunity on either dimension

        const tableClass = freshConfig.table_class;
        const currentMonthlyCost = estimateDynamoDBProvisionedMonthlyCost(currentReadCapacity, currentWriteCapacity, tableClass);

        // Scenario capacity per dimension: only a qualifying dimension is
        // ever moved away from its real current value -- a non-qualifying
        // dimension contributes its own current (unchanged) capacity, never
        // a fabricated reduction.
        const scenarioReadCapacity =
          readQualifies && readAnalysis.highestHourlyAverageThroughputPerSecond !== null
            ? Math.ceil(readAnalysis.highestHourlyAverageThroughputPerSecond)
            : currentReadCapacity;
        const scenarioWriteCapacity =
          writeQualifies && writeAnalysis.highestHourlyAverageThroughputPerSecond !== null
            ? Math.ceil(writeAnalysis.highestHourlyAverageThroughputPerSecond)
            : currentWriteCapacity;

        const scenarioMonthlyCost = estimateDynamoDBProvisionedMonthlyCost(scenarioReadCapacity, scenarioWriteCapacity, tableClass);
        const modeledMonthlySavings = Math.max(0, currentMonthlyCost - scenarioMonthlyCost);

        const tableAgeDays = Math.floor((now.getTime() - Date.parse(freshConfig.creation_date_time!)) / (24 * 60 * 60 * 1000));

        const description = this.buildDynamoDBCapacityDescription({
          currentReadCapacity,
          currentWriteCapacity,
          readAnalysis,
          writeAnalysis,
          readQualifies,
          writeQualifies,
          billingMode: freshConfig.billing_mode,
          autoscalingState: freshAutoscalingState,
          tableAgeDays,
          currentMonthlyCost,
          modeledMonthlySavings,
        });

        const savingsBasis =
          'scenario:highest_observed_hourly_average — modeled monthly cost if provisioned capacity matched the single ' +
          'highest hourly-average RCU/WCU observed in the 30-day analysis window; not a recommended or safe capacity ' +
          'setting, no safety margin applied; does not account for sub-hour spikes hidden by hourly averaging, traffic ' +
          'growth, or burst capacity';

        issues.push({
          resourceId: tableName,
          resourceName: row.resource_name || tableName,
          resourceType: 'DynamoDB',
          issue: ISSUE_DYNAMODB_CAPACITY,
          description,
          potentialSavings: modeledMonthlySavings,
          severity: this.calculateSeverity(modeledMonthlySavings),
          awsRegion: region,
          metadata: {
            billing_mode: freshConfig.billing_mode,
            autoscaling_state: freshAutoscalingState,
            table_class: tableClass,
            table_age_days: tableAgeDays,
            analysis_window_days: DYNAMODB_CAPACITY_ANALYSIS_WINDOW_DAYS,
            period_seconds: DYNAMODB_CAPACITY_PERIOD_SECONDS,
            reference_utilization_threshold_percent: DYNAMODB_CAPACITY_REFERENCE_UTILIZATION_THRESHOLD_PERCENT,
            min_low_utilization_interval_percent: DYNAMODB_CAPACITY_MIN_LOW_UTILIZATION_INTERVAL_PERCENT,
            min_valid_intervals: DYNAMODB_CAPACITY_MIN_VALID_INTERVALS,
            nominal_intervals: DYNAMODB_CAPACITY_NOMINAL_INTERVALS,
            read: {
              qualifies: readQualifies,
              provisioned_read_capacity: currentReadCapacity,
              valid_intervals: readAnalysis.validUtilizationIntervals,
              total_intervals: readAnalysis.totalIntervals,
              low_utilization_interval_percentage: readAnalysis.lowUtilizationPercentage,
              highest_hourly_average_utilization_percent: readAnalysis.highestHourlyAverageUtilizationPercent,
              throttle_valid_intervals: readAnalysis.throttleValidIntervals,
              throttle_confirmed_intervals: readAnalysis.throttleConfirmedIntervals,
            },
            write: {
              qualifies: writeQualifies,
              provisioned_write_capacity: currentWriteCapacity,
              valid_intervals: writeAnalysis.validUtilizationIntervals,
              total_intervals: writeAnalysis.totalIntervals,
              low_utilization_interval_percentage: writeAnalysis.lowUtilizationPercentage,
              highest_hourly_average_utilization_percent: writeAnalysis.highestHourlyAverageUtilizationPercent,
              throttle_valid_intervals: writeAnalysis.throttleValidIntervals,
              throttle_confirmed_intervals: writeAnalysis.throttleConfirmedIntervals,
            },
            current_monthly_cost: currentMonthlyCost,
            scenario_monthly_cost: scenarioMonthlyCost,
            savings_basis: savingsBasis,
          },
        });
      }

      return { success: true, issues };
    } catch (error) {
      console.error('Error detecting DynamoDB capacity optimization opportunities:', error);
      return { success: false, issues: [] };
    } finally {
      if (client) client.release();
    }
  }

  /**
   * Shared eligibility-gate check for `dynamodb_capacity`, used identically
   * for the cheap pass over persisted `aws_resources.metadata` (a pure
   * performance filter -- deciding which tables are worth 2 live API calls)
   * and the authoritative final pass over freshly re-confirmed live data.
   * Loosely typed so it structurally accepts both the raw JSONB metadata
   * shape and a live `DynamoDBTableConfig` merged with a fresh autoscaling
   * state -- see the two call sites above.
   */
  private checkDynamoDBCapacityEligibilityGates(
    config: {
      billing_mode?: string;
      autoscaling_state?: string;
      global_secondary_indexes?: unknown[];
      replica_regions?: unknown[];
      creation_date_time?: string;
      last_increase_date_time?: string;
      last_decrease_date_time?: string;
    },
    now: Date
  ): { eligible: boolean; reason?: string } {
    if (config.billing_mode !== 'PROVISIONED') {
      return { eligible: false, reason: `billing_mode is ${config.billing_mode ?? 'unknown'}, not PROVISIONED` };
    }
    if (config.autoscaling_state !== 'AUTOSCALING_DISABLED') {
      return { eligible: false, reason: `autoscaling_state is ${config.autoscaling_state ?? 'unknown'}, not AUTOSCALING_DISABLED` };
    }
    if (Array.isArray(config.global_secondary_indexes) && config.global_secondary_indexes.length > 0) {
      return { eligible: false, reason: 'table has one or more Global Secondary Indexes' };
    }
    if (Array.isArray(config.replica_regions) && config.replica_regions.length > 0) {
      return { eligible: false, reason: 'table is a Global Table with replica regions' };
    }

    const windowStartMs = now.getTime() - DYNAMODB_CAPACITY_ANALYSIS_WINDOW_DAYS * 24 * 60 * 60 * 1000;

    if (!config.creation_date_time) {
      return { eligible: false, reason: 'creation timestamp unavailable -- cannot confirm the table existed for the full analysis window' };
    }
    const creationMs = Date.parse(config.creation_date_time);
    if (!Number.isFinite(creationMs) || creationMs > windowStartMs) {
      return { eligible: false, reason: 'table has not existed for the full 30-day analysis window' };
    }

    const changeTimestamps: Array<[string, string | undefined]> = [
      ['last_increase_date_time', config.last_increase_date_time],
      ['last_decrease_date_time', config.last_decrease_date_time],
    ];
    for (const [label, ts] of changeTimestamps) {
      if (!ts) continue; // absence == no known change, per the locked methodology -- never invented
      const changeMs = Date.parse(ts);
      if (Number.isFinite(changeMs) && changeMs >= windowStartMs) {
        return { eligible: false, reason: `${label} falls inside the analysis window` };
      }
    }

    return { eligible: true };
  }

  /** Locked v1 per-dimension eligibility policy -- see the class-level constants' doc comment. */
  private dynamoDBCapacityDimensionQualifies(analysis: DynamoDBCapacityDimensionAnalysis): boolean {
    return (
      analysis.validUtilizationIntervals >= DYNAMODB_CAPACITY_MIN_VALID_INTERVALS &&
      analysis.lowUtilizationPercentage >= DYNAMODB_CAPACITY_MIN_LOW_UTILIZATION_INTERVAL_PERCENT &&
      analysis.throttleValidIntervals > 0 &&
      analysis.throttleConfirmedIntervals === 0
    );
  }

  private buildDynamoDBCapacityDescription(input: {
    currentReadCapacity: number;
    currentWriteCapacity: number;
    readAnalysis: DynamoDBCapacityDimensionAnalysis;
    writeAnalysis: DynamoDBCapacityDimensionAnalysis;
    readQualifies: boolean;
    writeQualifies: boolean;
    billingMode: string;
    autoscalingState: string;
    tableAgeDays: number;
    currentMonthlyCost: number;
    modeledMonthlySavings: number;
  }): string {
    const pct = (n: number) => `${Math.round(n)}%`;
    const dimensionBlock = (
      label: 'Read' | 'Write',
      unit: 'RCU' | 'WCU',
      provisioned: number,
      analysis: DynamoDBCapacityDimensionAnalysis,
      qualifies: boolean
    ): string =>
      `${label} capacity\n` +
      `- Provisioned: ${provisioned} ${unit}\n` +
      `- Valid intervals: ${analysis.validUtilizationIntervals}/${analysis.totalIntervals}\n` +
      `- Intervals below ${DYNAMODB_CAPACITY_REFERENCE_UTILIZATION_THRESHOLD_PERCENT}% hourly-average utilization: ${
        analysis.validUtilizationIntervals > 0 ? pct(analysis.lowUtilizationPercentage) : 'insufficient evidence'
      }\n` +
      `- Highest hourly-average utilization observed: ${
        analysis.highestHourlyAverageUtilizationPercent !== null ? pct(analysis.highestHourlyAverageUtilizationPercent) : 'insufficient evidence'
      }\n` +
      `- Table-level provisioned-throughput ${label.toLowerCase()} throttling: ${
        analysis.throttleValidIntervals > 0 ? (analysis.throttleConfirmedIntervals > 0 ? 'observed' : 'none observed') : 'insufficient evidence'
      }\n` +
      `- Qualifies for review: ${qualifies ? 'YES' : 'NO'}`;

    return (
      `DynamoDB capacity review identified\n\n` +
      `${dimensionBlock('Read', 'RCU', input.currentReadCapacity, input.readAnalysis, input.readQualifies)}\n\n` +
      `${dimensionBlock('Write', 'WCU', input.currentWriteCapacity, input.writeAnalysis, input.writeQualifies)}\n\n` +
      `Table context\n` +
      `- Billing mode: ${input.billingMode}\n` +
      `- Autoscaling: ${input.autoscalingState}\n` +
      `- Global Secondary Indexes: none\n` +
      `- Global Table replicas: none\n` +
      `- Table age: ${input.tableAgeDays} days\n` +
      `- Capacity changes inside analysis window: none\n\n` +
      `Analysis\n` +
      `- Window: ${DYNAMODB_CAPACITY_ANALYSIS_WINDOW_DAYS} days\n` +
      `- Period: 1 hour\n` +
      `- Reference threshold: ${DYNAMODB_CAPACITY_REFERENCE_UTILIZATION_THRESHOLD_PERCENT}% hourly-average utilization -- ` +
      `AWS's own documented reference point for investigating possible over-provisioning, adopted by DevControl as its v1 ` +
      `investigation threshold. Not independently validated against DevControl's own customer base, and not an AWS-mandated rule.\n` +
      `- DevControl qualification policy: >=${DYNAMODB_CAPACITY_MIN_LOW_UTILIZATION_INTERVAL_PERCENT}% of valid intervals below ` +
      `threshold, >=${DYNAMODB_CAPACITY_MIN_VALID_INTERVALS}/${DYNAMODB_CAPACITY_NOMINAL_INTERVALS} valid utilization sample required\n\n` +
      `Potential cost scenario\n` +
      `- Current modeled monthly cost: $${input.currentMonthlyCost.toFixed(2)}/month\n` +
      `- Modeled monthly savings if provisioned capacity matched the highest hourly-average demand observed during the analysis window: ` +
      `$${input.modeledMonthlySavings.toFixed(2)}/month\n\n` +
      `This is an illustrative cost scenario, not a recommended capacity setting. Short-lived spikes narrower than one hour, workload ` +
      `growth, burst capacity, and other DynamoDB capacity considerations are not fully modeled. Table-level throttle metrics confirm no ` +
      `provisioned-throughput throttling at the table level; they do not by themselves rule out partition-level or account-level throttling.`
    );
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
