/**
 * Optimization Scanner Service
 * Scans AWS resources for cost optimization opportunities
 */

import { Pool } from 'pg';
import {
  OptimizationRecommendation,
  OptimizationType,
  OptimizationRisk,
  OptimizationEffort,
} from '../types/optimization.types';
import { v4 as uuidv4 } from 'uuid';

export class OptimizationScannerService {
  constructor(private pool: Pool) {}

  /**
   * Scan all resources for optimization opportunities
   */
  async scanOrganization(organizationId: string): Promise<OptimizationRecommendation[]> {
    console.log(`[Optimization Scanner] Scanning org ${organizationId}...`);

    const recommendations: OptimizationRecommendation[] = [];

    // Run all scanners in parallel
    const [
      idleEC2,
      oversizedEC2,
      unattachedVolumes,
      oldSnapshots,
      idleRDS,
      unusedEIPs,
      overProvisionedLambda,
    ] = await Promise.all([
      this.scanIdleEC2(organizationId),
      this.scanOversizedEC2(organizationId),
      this.scanUnattachedVolumes(organizationId),
      this.scanOldSnapshots(organizationId),
      this.scanIdleRDS(organizationId),
      this.scanUnusedElasticIPs(organizationId),
      this.scanOverProvisionedLambda(organizationId),
    ]);

    recommendations.push(
      ...idleEC2,
      ...oversizedEC2,
      ...unattachedVolumes,
      ...oldSnapshots,
      ...idleRDS,
      ...unusedEIPs,
      ...overProvisionedLambda
    );

    console.log(`[Optimization Scanner] Found ${recommendations.length} recommendations`);
    return recommendations;
  }

  /**
   * Scan for idle EC2 instances (CPU < 5% for 7+ days)
   */
  private async scanIdleEC2(organizationId: string): Promise<OptimizationRecommendation[]> {
    const query = `
      SELECT
        resource_id,
        resource_name,
        region,
        (tags->>'estimated_monthly_cost')::numeric as estimated_monthly_cost,
        tags
      FROM aws_resources
      WHERE organization_id = $1
        AND resource_type = 'ec2'
        AND (tags->>'state' = 'running')
        AND (tags->>'cpu_avg')::float < 5
        AND (tags->>'days_observed')::int >= 7
    `;

    try {
      const result = await this.pool.query(query, [organizationId]);

      return result.rows.map((row) => {
        const cpuAvg = parseFloat(row.tags?.cpu_avg || 0);
        const daysObserved = parseInt(row.tags?.days_observed || 7);

        return {
          id: uuidv4(),
          organizationId,
          type: 'idle_resource' as OptimizationType,
          resourceId: row.resource_id,
          resourceType: 'EC2',
          resourceName: row.resource_name || row.resource_id,
          region: row.region,
          currentCost: parseFloat(row.estimated_monthly_cost || 0),
          optimizedCost: 0,
          monthlySavings: parseFloat(row.estimated_monthly_cost || 0),
          annualSavings: parseFloat(row.estimated_monthly_cost || 0) * 12,
          risk: 'caution' as OptimizationRisk,
          effort: 'low' as OptimizationEffort,
          confidence: 95,
          priority: 8,
          title: `Idle EC2 instance: ${row.resource_name || row.resource_id}`,
          description: `This instance has averaged ${cpuAvg.toFixed(1)}% CPU over ${daysObserved} days`,
          reasoning:
            'Extremely low CPU usage suggests this instance is not being used and can be stopped or terminated',
          action: 'Stop instance (can be restarted if needed) or terminate if confirmed unused',
          actionCommand: `aws ec2 stop-instances --instance-ids ${row.resource_id} --region ${row.region}`,
          status: 'pending',
          detectedAt: new Date(),
          utilizationMetrics: {
            cpuAvg: cpuAvg,
            cpuMax: parseFloat(row.tags?.cpu_max || 0),
            memoryAvg: parseFloat(row.tags?.memory_avg || 0),
            networkAvg: parseFloat(row.tags?.network_avg || 0),
            daysObserved: daysObserved,
          },
        };
      });
    } catch (error) {
      console.error('[Optimization Scanner] Error scanning idle EC2:', error);
      return [];
    }
  }

  /**
   * Scan for oversized EC2 instances (CPU 5-30%)
   */
  private async scanOversizedEC2(organizationId: string): Promise<OptimizationRecommendation[]> {
    const query = `
      SELECT
        resource_id,
        resource_name,
        region,
        (tags->>'estimated_monthly_cost')::numeric as estimated_monthly_cost,
        tags
      FROM aws_resources
      WHERE organization_id = $1
        AND resource_type = 'ec2'
        AND (tags->>'state' = 'running')
        AND (tags->>'cpu_avg')::float < 30
        AND (tags->>'cpu_avg')::float >= 5
        AND (tags->>'days_observed')::int >= 14
    `;

    try {
      const result = await this.pool.query(query, [organizationId]);

      return result.rows.map((row) => {
        const currentCost = parseFloat(row.estimated_monthly_cost || 0);
        const cpuAvg = parseFloat(row.tags?.cpu_avg || 0);

        // Estimate 30-50% savings by downsizing
        const savingsPercent = cpuAvg < 15 ? 0.5 : 0.3;
        const monthlySavings = currentCost * savingsPercent;

        return {
          id: uuidv4(),
          organizationId,
          type: 'oversized_instance' as OptimizationType,
          resourceId: row.resource_id,
          resourceType: 'EC2',
          resourceName: row.resource_name || row.resource_id,
          region: row.region,
          currentCost,
          optimizedCost: currentCost - monthlySavings,
          monthlySavings,
          annualSavings: monthlySavings * 12,
          risk: 'caution' as OptimizationRisk,
          effort: 'medium' as OptimizationEffort,
          confidence: 85,
          priority: 7,
          title: `Oversized EC2 instance: ${row.resource_name || row.resource_id}`,
          description: `CPU usage averaging ${cpuAvg.toFixed(1)}% suggests instance is oversized`,
          reasoning: 'Low CPU utilization indicates you can downsize to a smaller instance type',
          action: 'Resize to smaller instance type (requires brief downtime)',
          status: 'pending',
          detectedAt: new Date(),
          utilizationMetrics: {
            cpuAvg: cpuAvg,
            cpuMax: parseFloat(row.tags?.cpu_max || 0),
            memoryAvg: parseFloat(row.tags?.memory_avg || 0),
            networkAvg: parseFloat(row.tags?.network_avg || 0),
            daysObserved: parseInt(row.tags?.days_observed || 14),
          },
        };
      });
    } catch (error) {
      console.error('[Optimization Scanner] Error scanning oversized EC2:', error);
      return [];
    }
  }

  /**
   * Scan for unattached EBS volumes
   */
  private async scanUnattachedVolumes(organizationId: string): Promise<OptimizationRecommendation[]> {
    const query = `
      SELECT
        resource_id,
        resource_name,
        region,
        (tags->>'estimated_monthly_cost')::numeric as estimated_monthly_cost,
        tags
      FROM aws_resources
      WHERE organization_id = $1
        AND resource_type = 'ebs'
        AND (tags->>'state' = 'available' OR tags->>'attached' = 'false')
    `;

    try {
      const result = await this.pool.query(query, [organizationId]);

      return result.rows.map((row) => {
        const monthlyCost = parseFloat(row.estimated_monthly_cost || 10);

        return {
          id: uuidv4(),
          organizationId,
          type: 'unattached_volume' as OptimizationType,
          resourceId: row.resource_id,
          resourceType: 'EBS',
          resourceName: row.resource_name || row.resource_id,
          region: row.region,
          currentCost: monthlyCost,
          optimizedCost: 0,
          monthlySavings: monthlyCost,
          annualSavings: monthlyCost * 12,
          risk: 'safe' as OptimizationRisk,
          effort: 'low' as OptimizationEffort,
          confidence: 98,
          priority: 9,
          title: `Unattached EBS volume: ${row.resource_name || row.resource_id}`,
          description: 'This volume is not attached to any instance',
          reasoning: 'Unattached volumes still incur costs. Create a snapshot and delete if not needed',
          action: 'Create snapshot, then delete volume',
          actionCommand: `aws ec2 create-snapshot --volume-id ${row.resource_id} --region ${row.region} && aws ec2 delete-volume --volume-id ${row.resource_id}`,
          status: 'pending',
          detectedAt: new Date(),
        };
      });
    } catch (error) {
      console.error('[Optimization Scanner] Error scanning unattached volumes:', error);
      return [];
    }
  }

  /**
   * Scan for old EBS snapshots (90+ days)
   */
  private async scanOldSnapshots(organizationId: string): Promise<OptimizationRecommendation[]> {
    const query = `
      SELECT
        resource_id,
        resource_name,
        region,
        (tags->>'estimated_monthly_cost')::numeric as estimated_monthly_cost,
        created_at,
        tags
      FROM aws_resources
      WHERE organization_id = $1
        AND resource_type = 's3'
        AND tags->>'snapshot' = 'true'
        AND created_at < NOW() - INTERVAL '90 days'
    `;

    try {
      const result = await this.pool.query(query, [organizationId]);

      return result.rows.map((row) => {
        const monthlyCost = parseFloat(row.estimated_monthly_cost || 5);
        const ageInDays = Math.floor(
          (Date.now() - new Date(row.created_at).getTime()) / (1000 * 60 * 60 * 24)
        );

        return {
          id: uuidv4(),
          organizationId,
          type: 'old_snapshot' as OptimizationType,
          resourceId: row.resource_id,
          resourceType: 'EBS_Snapshot',
          resourceName: row.resource_name || row.resource_id,
          region: row.region,
          currentCost: monthlyCost,
          optimizedCost: 0,
          monthlySavings: monthlyCost,
          annualSavings: monthlyCost * 12,
          risk: 'safe' as OptimizationRisk,
          effort: 'low' as OptimizationEffort,
          confidence: 90,
          priority: 6,
          title: `Old EBS snapshot (${ageInDays}+ days): ${row.resource_name || row.resource_id}`,
          description: `Snapshot created ${ageInDays} days ago`,
          reasoning: 'Old snapshots may no longer be needed. Verify and delete to save storage costs',
          action: 'Review and delete if no longer needed',
          actionCommand: `aws ec2 delete-snapshot --snapshot-id ${row.resource_id} --region ${row.region}`,
          status: 'pending',
          detectedAt: new Date(),
        };
      });
    } catch (error) {
      console.error('[Optimization Scanner] Error scanning old snapshots:', error);
      return [];
    }
  }

  /**
   * Scan for idle RDS instances
   */
  private async scanIdleRDS(organizationId: string): Promise<OptimizationRecommendation[]> {
    const query = `
      SELECT
        resource_id,
        resource_name,
        region,
        (tags->>'estimated_monthly_cost')::numeric as estimated_monthly_cost,
        tags
      FROM aws_resources
      WHERE organization_id = $1
        AND resource_type = 'rds'
        AND (tags->>'connections_avg')::float < 5
        AND (tags->>'days_observed')::int >= 7
    `;

    try {
      const result = await this.pool.query(query, [organizationId]);

      return result.rows.map((row) => {
        const monthlyCost = parseFloat(row.estimated_monthly_cost || 0);

        return {
          id: uuidv4(),
          organizationId,
          type: 'idle_resource' as OptimizationType,
          resourceId: row.resource_id,
          resourceType: 'RDS',
          resourceName: row.resource_name || row.resource_id,
          region: row.region,
          currentCost: monthlyCost,
          optimizedCost: 0,
          monthlySavings: monthlyCost,
          annualSavings: monthlyCost * 12,
          risk: 'risky' as OptimizationRisk,
          effort: 'low' as OptimizationEffort,
          confidence: 80,
          priority: 7,
          title: `Idle RDS instance: ${row.resource_name || row.resource_id}`,
          description: `Very low connection count (avg ${parseFloat(row.tags?.connections_avg || 0)} connections)`,
          reasoning: 'Database appears unused. Create snapshot and consider stopping or deleting',
          action: 'Create snapshot, then stop instance',
          status: 'pending',
          detectedAt: new Date(),
        };
      });
    } catch (error) {
      console.error('[Optimization Scanner] Error scanning idle RDS:', error);
      return [];
    }
  }

  /**
   * Scan for unused Elastic IPs
   */
  private async scanUnusedElasticIPs(organizationId: string): Promise<OptimizationRecommendation[]> {
    const query = `
      SELECT
        resource_id,
        resource_name,
        region,
        tags
      FROM aws_resources
      WHERE organization_id = $1
        AND resource_type = 'elastic_ip'
        AND (tags->>'associated' = 'false')
    `;

    try {
      const result = await this.pool.query(query, [organizationId]);

      const costPerEIP = 3.65; // $0.005/hour * 730 hours

      return result.rows.map((row) => {
        return {
          id: uuidv4(),
          organizationId,
          type: 'unused_elastic_ip' as OptimizationType,
          resourceId: row.resource_id,
          resourceType: 'ElasticIP',
          resourceName: row.resource_name || row.resource_id,
          region: row.region,
          currentCost: costPerEIP,
          optimizedCost: 0,
          monthlySavings: costPerEIP,
          annualSavings: costPerEIP * 12,
          risk: 'safe' as OptimizationRisk,
          effort: 'low' as OptimizationEffort,
          confidence: 99,
          priority: 8,
          title: `Unused Elastic IP: ${row.resource_id}`,
          description: 'This Elastic IP is not associated with any instance',
          reasoning: 'Unassociated Elastic IPs incur charges. Release if not needed',
          action: 'Release Elastic IP',
          actionCommand: `aws ec2 release-address --allocation-id ${row.resource_id} --region ${row.region}`,
          status: 'pending',
          detectedAt: new Date(),
        };
      });
    } catch (error) {
      console.error('[Optimization Scanner] Error scanning unused Elastic IPs:', error);
      return [];
    }
  }

  /**
   * Scan for over-provisioned Lambda functions
   */
  private async scanOverProvisionedLambda(organizationId: string): Promise<OptimizationRecommendation[]> {
    const query = `
      SELECT
        resource_id,
        resource_name,
        region,
        (tags->>'estimated_monthly_cost')::numeric as estimated_monthly_cost,
        tags
      FROM aws_resources
      WHERE organization_id = $1
        AND resource_type = 'lambda'
        AND (tags->>'memory_utilization')::float < 50
        AND (tags->>'invocations')::int > 1000
    `;

    try {
      const result = await this.pool.query(query, [organizationId]);

      return result.rows.map((row) => {
        const currentCost = parseFloat(row.estimated_monthly_cost || 0);
        const memoryUtil = parseFloat(row.tags?.memory_utilization || 50);

        // Estimate 20-40% savings by reducing memory
        const savingsPercent = memoryUtil < 30 ? 0.4 : 0.2;
        const monthlySavings = currentCost * savingsPercent;

        return {
          id: uuidv4(),
          organizationId,
          type: 'lambda_memory' as OptimizationType,
          resourceId: row.resource_id,
          resourceType: 'Lambda',
          resourceName: row.resource_name || row.resource_id,
          region: row.region,
          currentCost,
          optimizedCost: currentCost - monthlySavings,
          monthlySavings,
          annualSavings: monthlySavings * 12,
          risk: 'safe' as OptimizationRisk,
          effort: 'low' as OptimizationEffort,
          confidence: 85,
          priority: 6,
          title: `Over-provisioned Lambda: ${row.resource_name || row.resource_id}`,
          description: `Memory utilization only ${memoryUtil.toFixed(0)}%`,
          reasoning: 'Lambda is allocated more memory than needed. Reduce to save costs',
          action: 'Reduce Lambda memory allocation',
          status: 'pending',
          detectedAt: new Date(),
        };
      });
    } catch (error) {
      console.error('[Optimization Scanner] Error scanning over-provisioned Lambda:', error);
      return [];
    }
  }
}
