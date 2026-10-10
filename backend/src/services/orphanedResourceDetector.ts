import { Pool, PoolClient } from 'pg';
import { assertTenantContext } from '../config/database';
import {
  AWSResource,
  OrphanedResource,
  OrphanedResourceType,
} from '../types/aws-resources.types';

/**
 * Orphaned Resource Detector Service
 * Identifies AWS resources that are not being actively used
 *
 * `pool` must be a connection already tagged for the organization being
 * scanned (discovery passes its own org-tagged client). aws_resources is
 * RLS-protected, so an untagged read would otherwise return zero rows and be
 * indistinguishable from "nothing is orphaned" -- detectOrphaned() checks the
 * tag first and throws instead.
 */
export class OrphanedResourceDetectorService {
  constructor(private pool: Pool | PoolClient) {}

  /**
   * Detect all orphaned resources for an organization.
   *
   * Stopped EC2 instances are deliberately not detected. Discovery records no
   * stop time (metadata.launch_time is the last start), and its upsert
   * refreshes updated_at on every run, so "stopped for more than 30 days" could
   * not be established -- and a stopped instance accrues no compute charge, so
   * its compute estimate was never a saving.
   */
  async detectOrphaned(organizationId: string): Promise<OrphanedResource[]> {
    await assertTenantContext(this.pool, organizationId);

    const orphanedResources: OrphanedResource[] = [];

    const emptyBuckets = await this.findEmptyS3Buckets(organizationId);
    orphanedResources.push(...emptyBuckets);

    return orphanedResources;
  }

  /**
   * S3 buckets recorded as holding zero objects. A bucket whose object count
   * was never recorded is unknown, not empty, and is not reported.
   */
  private async findEmptyS3Buckets(organizationId: string): Promise<OrphanedResource[]> {
    // The status filter keeps a terminated bucket's last-known metadata from
    // being reported for a bucket that no longer exists.
    const result = await this.pool.query(
      `SELECT * FROM aws_resources
       WHERE organization_id = $1
       AND resource_type = 's3'
       AND status != 'terminated'
       AND metadata->>'object_count' = '0'`,
      [organizationId]
    );

    return result.rows.map((resource: AWSResource) => ({
      resource,
      orphaned_type: 'empty_s3_bucket' as OrphanedResourceType,
      age_days: this.calculateAgeDays(resource.first_discovered_at),
      // An empty bucket stores nothing, so deleting it saves no storage cost;
      // the flat inventory estimate is not a saving.
      potential_savings: 0,
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
