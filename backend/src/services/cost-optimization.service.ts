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
  Instance,
} from '@aws-sdk/client-ec2';
import {
  RDSClient,
  DescribeDBInstancesCommand,
  DBInstance,
} from '@aws-sdk/client-rds';
import { CreateRecommendationRequest, RecommendationSeverity } from '../types';

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

class CostOptimizationService {
  private cloudWatchClient: CloudWatchClient;
  private ec2Client: EC2Client;
  private rdsClient: RDSClient;
  private enabled: boolean;

  constructor() {
    this.enabled = this.checkAWSCredentials();

    if (this.enabled) {
      const config = {
        region: process.env.AWS_REGION || 'us-east-1',
        credentials: {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
        },
      };

      this.cloudWatchClient = new CloudWatchClient(config);
      this.ec2Client = new EC2Client(config);
      this.rdsClient = new RDSClient(config);
    } else {
      this.cloudWatchClient = {} as CloudWatchClient;
      this.ec2Client = {} as EC2Client;
      this.rdsClient = {} as RDSClient;
    }
  }

  private checkAWSCredentials(): boolean {
    return !!(
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY &&
      process.env.AWS_REGION
    );
  }

  /**
   * Main analysis function - detects all cost optimization opportunities
   */
  async analyzeAllResources(): Promise<CreateRecommendationRequest[]> {
    if (!this.enabled) {
      console.log('AWS credentials not configured, skipping analysis');
      return [];
    }

    try {
      const [idleEC2, oversizedRDS, unusedEIPs, riOpportunities] = await Promise.all([
        this.detectIdleEC2Instances(),
        this.detectOversizedRDSInstances(),
        this.detectUnusedElasticIPs(),
        this.detectReservedInstanceOpportunities(),
      ]);

      const allIssues = [...idleEC2, ...oversizedRDS, ...unusedEIPs, ...riOpportunities];

      // Convert to CreateRecommendationRequest format
      return allIssues.map((issue) => ({
        resource_id: issue.resourceId,
        resource_name: issue.resourceName,
        resource_type: issue.resourceType,
        issue: issue.issue,
        description: issue.description,
        potential_savings: issue.potentialSavings,
        severity: issue.severity,
        aws_region: issue.awsRegion,
        metadata: issue.metadata,
      }));
    } catch (error) {
      console.error('Error analyzing resources:', error);
      throw error;
    }
  }

  /**
   * Detect idle EC2 instances (CPU < 5% for 7+ days)
   */
  private async detectIdleEC2Instances(): Promise<OptimizationIssue[]> {
    if (!this.enabled) return [];

    try {
      const command = new DescribeInstancesCommand({
        Filters: [
          {
            Name: 'instance-state-name',
            Values: ['running'],
          },
        ],
      });

      const response = await this.ec2Client.send(command);
      const issues: OptimizationIssue[] = [];

      for (const reservation of response.Reservations || []) {
        for (const instance of reservation.Instances || []) {
          if (!instance.InstanceId) continue;

          // Check CPU utilization for the last 7 days
          const avgCPU = await this.getAverageCPUUtilization(
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
              issue: 'Idle Instance',
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

      return issues;
    } catch (error) {
      console.error('Error detecting idle EC2 instances:', error);
      return [];
    }
  }

  /**
   * Detect oversized RDS instances (dev/staging using production-sized instances)
   */
  private async detectOversizedRDSInstances(): Promise<OptimizationIssue[]> {
    if (!this.enabled) return [];

    try {
      const command = new DescribeDBInstancesCommand({});
      const response = await this.rdsClient.send(command);
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
              issue: 'Oversized Instance',
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

      return issues;
    } catch (error) {
      console.error('Error detecting oversized RDS instances:', error);
      return [];
    }
  }

  /**
   * Detect unused Elastic IPs
   */
  private async detectUnusedElasticIPs(): Promise<OptimizationIssue[]> {
    if (!this.enabled) return [];

    try {
      const command = new DescribeAddressesCommand({});
      const response = await this.ec2Client.send(command);
      const issues: OptimizationIssue[] = [];

      for (const address of response.Addresses || []) {
        // Elastic IPs not attached to an instance are charged
        if (!address.InstanceId && !address.NetworkInterfaceId) {
          const monthlyCost = 3.6; // $0.005/hour * 24 * 30 = $3.6/month

          issues.push({
            resourceId: address.AllocationId || address.PublicIp || 'unknown',
            resourceName: address.PublicIp || 'Unknown EIP',
            resourceType: 'EIP',
            issue: 'Unused Elastic IP',
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

      return issues;
    } catch (error) {
      console.error('Error detecting unused Elastic IPs:', error);
      return [];
    }
  }

  /**
   * Detect Reserved Instance opportunities
   */
  private async detectReservedInstanceOpportunities(): Promise<OptimizationIssue[]> {
    if (!this.enabled) return [];

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
      const instancesResponse = await this.ec2Client.send(instancesCommand);

      // Get existing Reserved Instances
      const riCommand = new DescribeReservedInstancesCommand({
        Filters: [
          {
            Name: 'state',
            Values: ['active'],
          },
        ],
      });
      const riResponse = await this.ec2Client.send(riCommand);

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
            issue: 'Reserved Instance Opportunity',
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

      const response = await this.cloudWatchClient.send(command);

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
