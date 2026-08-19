import { Pool } from 'pg';
import {
  AWSResource,
  OrphanedResource,
  OrphanedResourceType,
} from '../types/aws-resources.types';

/**
 * Orphaned Resource Detector Service
 * Identifies AWS resources that are not being actively used
 */
export class OrphanedResourceDetectorService {
  constructor(private pool: Pool) {}

  /**
   * Detect all orphaned resources for an organization
   */
  async detectOrphaned(organizationId: string): Promise<OrphanedResource[]> {
    const orphanedResources: OrphanedResource[] = [];

    // Find stopped EC2 instances (stopped for > 30 days)
    const stoppedInstances = await this.findStoppedInstances(organizationId);
    orphanedResources.push(...stoppedInstances);

    // Find empty S3 buckets (placeholder - would need object count from metadata)
    const emptyBuckets = await this.findEmptyS3Buckets(organizationId);
    orphanedResources.push(...emptyBuckets);

    // TODO: Add more orphaned resource types:
    // - Unattached EBS volumes
    // - Unused Elastic IPs
    // - Idle RDS instances

    return orphanedResources;
  }

  /**
   * Find EC2 instances that have been stopped for > 30 days
   */
  private async findStoppedInstances(organizationId: string): Promise<OrphanedResource[]> {
    const result = await this.pool.query(
      `SELECT * FROM aws_resources
       WHERE organization_id = $1
       AND resource_type = 'ec2'
       AND status = 'stopped'
       AND updated_at < NOW() - INTERVAL '30 days'`,
      [organizationId]
    );

    return result.rows.map((resource: AWSResource) => ({
      resource,
      orphaned_type: 'stopped_instance' as OrphanedResourceType,
      age_days: this.calculateAgeDays(resource.updated_at),
      potential_savings: resource.estimated_monthly_cost,
    }));
  }

  /**
   * Find S3 buckets that appear to be empty
   * Note: This is a simplified check - real implementation would query S3 for object count
   */
  private async findEmptyS3Buckets(organizationId: string): Promise<OrphanedResource[]> {
    // Unlike findStoppedInstances (whose status = 'stopped' condition already
    // excludes 'terminated' by construction), this has no status filter at all —
    // a terminated bucket's last-known metadata could otherwise still match and
    // get flagged as "orphaned" savings for a bucket that no longer exists.
    const result = await this.pool.query(
      `SELECT * FROM aws_resources
       WHERE organization_id = $1
       AND resource_type = 's3'
       AND status != 'terminated'
       AND (metadata->>'object_count' = '0' OR metadata->>'object_count' IS NULL)`,
      [organizationId]
    );

    return result.rows.map((resource: AWSResource) => ({
      resource,
      orphaned_type: 'empty_s3_bucket' as OrphanedResourceType,
      age_days: this.calculateAgeDays(resource.first_discovered_at),
      potential_savings: resource.estimated_monthly_cost * 0.8, // Estimate 80% savings from deleting empty bucket
    }));
  }

  /**
   * Calculate age in days from a given date
   */
  private calculateAgeDays(date: Date): number {
    const now = new Date();
    const diffTime = Math.abs(now.getTime() - new Date(date).getTime());
    const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
    return diffDays;
  }

  /**
   * Calculate total potential savings from orphaned resources
   */
  async calculateTotalSavings(orphanedResources: OrphanedResource[]): Promise<number> {
    return orphanedResources.reduce((total, orphaned) => {
      return total + orphaned.potential_savings;
    }, 0);
  }

  /**
   * Group orphaned resources by type
   */
  groupByType(orphanedResources: OrphanedResource[]): Map<OrphanedResourceType, OrphanedResource[]> {
    const grouped = new Map<OrphanedResourceType, OrphanedResource[]>();

    for (const resource of orphanedResources) {
      const type = resource.orphaned_type;
      if (!grouped.has(type)) {
        grouped.set(type, []);
      }
      grouped.get(type)!.push(resource);
    }

    return grouped;
  }

  /**
   * Get display name for orphaned resource type
   */
  static getOrphanedTypeDisplayName(type: OrphanedResourceType): string {
    const names: Record<OrphanedResourceType, string> = {
      unattached_volume: 'Unattached EBS Volumes',
      unused_elastic_ip: 'Unused Elastic IPs',
      stopped_instance: 'Stopped EC2 Instances',
      empty_s3_bucket: 'Empty S3 Buckets',
    };
    return names[type];
  }

  /**
   * Get recommendation for orphaned resource
   */
  static getRecommendation(type: OrphanedResourceType): string {
    const recommendations: Record<OrphanedResourceType, string> = {
      unattached_volume: 'Delete the volume if no longer needed, or create a snapshot for backup before deletion.',
      unused_elastic_ip: 'Release the Elastic IP if not in use. You are charged for unused Elastic IPs.',
      stopped_instance: 'Terminate the instance if no longer needed, or create an AMI for future use.',
      empty_s3_bucket: 'Delete the bucket if no longer needed to avoid storage costs.',
    };
    return recommendations[type];
  }
}
