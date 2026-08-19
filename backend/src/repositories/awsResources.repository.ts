import { Pool, PoolClient } from 'pg';
import {
  AWSResource,
  ResourceFilters,
  ResourceListResponse,
  ResourceStats,
  ComplianceStats,
  OrphanedResource,
  ResourceType,
  ComplianceIssue,
} from '../types/aws-resources.types';

export class AWSResourcesRepository {
  constructor(private pool: Pool) {}

  /**
   * Find all resources with optional filters and pagination
   */
  async findAll(
    organizationId: string,
    filters?: ResourceFilters
  ): Promise<ResourceListResponse> {
    const conditions: string[] = ['organization_id = $1'];
    const values: any[] = [organizationId];
    let paramIndex = 2;

    // Build WHERE conditions
    if (filters?.resource_type) {
      conditions.push(`resource_type = $${paramIndex++}`);
      values.push(filters.resource_type);
    }

    if (filters?.region) {
      conditions.push(`region = $${paramIndex++}`);
      values.push(filters.region);
    }

    if (filters?.status) {
      conditions.push(`status = $${paramIndex++}`);
      values.push(filters.status);
    } else {
      // Operational default: current inventory excludes soft-terminated rows
      // (see resourceReconciliation.service.ts). An explicit status filter —
      // including status=terminated for an audit/history view — overrides this.
      conditions.push(`status != 'terminated'`);
    }

    if (filters?.is_encrypted !== undefined) {
      conditions.push(`is_encrypted = $${paramIndex++}`);
      values.push(filters.is_encrypted);
    }

    if (filters?.is_public !== undefined) {
      conditions.push(`is_public = $${paramIndex++}`);
      values.push(filters.is_public);
    }

    if (filters?.has_backup !== undefined) {
      conditions.push(`has_backup = $${paramIndex++}`);
      values.push(filters.has_backup);
    }

    if (filters?.search) {
      conditions.push(`(
        resource_name ILIKE $${paramIndex} OR
        resource_id ILIKE $${paramIndex} OR
        resource_arn ILIKE $${paramIndex}
      )`);
      values.push(`%${filters.search}%`);
      paramIndex++;
    }

    const whereClause = `WHERE ${conditions.join(' AND ')}`;

    // Count total
    const countResult = await this.pool.query(
      `SELECT COUNT(*) as total FROM aws_resources ${whereClause}`,
      values
    );
    const total = parseInt(countResult.rows[0].total);

    // Pagination
    const page = filters?.page || 1;
    const limit = filters?.limit || 50;
    const offset = (page - 1) * limit;

    // Query resources
    const query = `
      SELECT * FROM aws_resources
      ${whereClause}
      ORDER BY created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;
    values.push(limit, offset);

    const result = await this.pool.query(query, values);

    return {
      resources: result.rows,
      total,
      page,
      limit,
    };
  }

  /**
   * Find resource by ID
   */
  async findById(id: string, organizationId: string): Promise<AWSResource | null> {
    const result = await this.pool.query(
      'SELECT * FROM aws_resources WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );

    return result.rows[0] || null;
  }

  /**
   * Delete resource tracking
   */
  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await this.pool.query(
      'DELETE FROM aws_resources WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );

    return result.rowCount! > 0;
  }

  /**
   * Get resource statistics
   */
  async getStats(organizationId: string, executor?: PoolClient): Promise<ResourceStats> {
    const client = executor ?? await this.pool.connect();
    try {
      // ResourceStats represents CURRENT resource inventory/posture (dashboard totals,
      // cost, compliance, encryption/public/backup posture) — every sub-query below
      // excludes soft-terminated rows (see resourceReconciliation.service.ts) so a
      // resource AWS no longer has doesn't keep contaminating current-state figures.
      // Historical/audit access to terminated rows still exists via findAll() with an
      // explicit status=terminated filter.

      // Total resources
      const totalResult = await client.query(
        `SELECT COUNT(*) as count FROM aws_resources WHERE organization_id = $1 AND status != 'terminated'`,
        [organizationId]
      );
      const total = parseInt(totalResult.rows[0].count);

      // By type
      const typeResult = await client.query(
        `SELECT resource_type, COUNT(*) as count
         FROM aws_resources
         WHERE organization_id = $1 AND status != 'terminated'
         GROUP BY resource_type`,
        [organizationId]
      );
      const byType: Record<ResourceType, number> = {} as any;
      typeResult.rows.forEach(row => {
        byType[row.resource_type as ResourceType] = parseInt(row.count);
      });

      // By region
      const regionResult = await client.query(
        `SELECT region, COUNT(*) as count
         FROM aws_resources
         WHERE organization_id = $1 AND status != 'terminated'
         GROUP BY region`,
        [organizationId]
      );
      const byRegion: Record<string, number> = {};
      regionResult.rows.forEach(row => {
        byRegion[row.region] = parseInt(row.count);
      });

      // By status — still scoped to current (non-terminated) inventory, so this
      // breaks down the operational statuses (running/stopped/pending/etc.) making
      // up `total` above, consistent with it. Historical status breakdowns including
      // 'terminated' are available via findAll(filters.status).
      const statusResult = await client.query(
        `SELECT status, COUNT(*) as count
         FROM aws_resources
         WHERE organization_id = $1 AND status IS NOT NULL AND status != 'terminated'
         GROUP BY status`,
        [organizationId]
      );
      const byStatus: Record<string, number> = {};
      statusResult.rows.forEach(row => {
        byStatus[row.status] = parseInt(row.count);
      });

      // Total monthly cost
      const costResult = await client.query(
        `SELECT SUM(estimated_monthly_cost) as total FROM aws_resources WHERE organization_id = $1 AND status != 'terminated'`,
        [organizationId]
      );
      const totalMonthlyCost = parseFloat(costResult.rows[0].total || 0);

      // Cost by type
      const costByTypeResult = await client.query(
        `SELECT resource_type, SUM(estimated_monthly_cost) as total
         FROM aws_resources
         WHERE organization_id = $1 AND status != 'terminated'
         GROUP BY resource_type`,
        [organizationId]
      );
      const costByType: Record<ResourceType, number> = {} as any;
      costByTypeResult.rows.forEach(row => {
        costByType[row.resource_type as ResourceType] = parseFloat(row.total);
      });

      // Compliance stats
      const complianceStats = await this.getComplianceStats(client, organizationId);

      // Counts for specific issues
      const unencryptedResult = await client.query(
        `SELECT COUNT(*) as count FROM aws_resources WHERE organization_id = $1 AND is_encrypted = false AND status != 'terminated'`,
        [organizationId]
      );
      const unencryptedCount = parseInt(unencryptedResult.rows[0].count);

      const publicResult = await client.query(
        `SELECT COUNT(*) as count FROM aws_resources WHERE organization_id = $1 AND is_public = true AND status != 'terminated'`,
        [organizationId]
      );
      const publicCount = parseInt(publicResult.rows[0].count);

      const missingBackupResult = await client.query(
        `SELECT COUNT(*) as count FROM aws_resources WHERE organization_id = $1 AND has_backup = false AND resource_type IN ('rds', 'ec2') AND status != 'terminated'`,
        [organizationId]
      );
      const missingBackupCount = parseInt(missingBackupResult.rows[0].count);

      const orphanedResult = await client.query(
        `SELECT COUNT(*) as count, COALESCE(SUM(orphaned_monthly_savings), 0) as savings
         FROM aws_resources WHERE organization_id = $1 AND is_orphaned = true AND status != 'terminated'`,
        [organizationId]
      );
      const orphanedCount = parseInt(orphanedResult.rows[0].count);
      const orphanedSavings = parseFloat(orphanedResult.rows[0].savings);

      // A genuine scan means ComplianceScannerService + OrphanedResourceDetectorService
      // have both completed without error for this org at least once — see
      // awsResourceDiscovery.ts::discoverAllResources.
      const scanResult = await client.query(
        `SELECT 1 FROM resource_discovery_jobs
         WHERE organization_id = $1 AND compliance_scan_completed = true
         LIMIT 1`,
        [organizationId]
      );
      const scanCompleted = (scanResult.rowCount ?? 0) > 0;

      return {
        total_resources: total,
        by_type: byType,
        by_region: byRegion,
        by_status: byStatus,
        total_monthly_cost: totalMonthlyCost,
        cost_by_type: costByType,
        compliance_stats: complianceStats,
        orphaned_count: orphanedCount,
        orphaned_savings: orphanedSavings,
        unencrypted_count: unencryptedCount,
        public_count: publicCount,
        missing_backup_count: missingBackupCount,
        scan_completed: scanCompleted,
      };
    } finally {
      if (!executor) client.release();
    }
  }

  /**
   * Get compliance statistics
   */
  private async getComplianceStats(
    client: PoolClient,
    organizationId: string
  ): Promise<ComplianceStats> {
    const result = await client.query(
      `SELECT compliance_issues FROM aws_resources WHERE organization_id = $1 AND status != 'terminated'`,
      [organizationId]
    );

    const allIssues: ComplianceIssue[] = [];
    result.rows.forEach(row => {
      if (row.compliance_issues && Array.isArray(row.compliance_issues)) {
        allIssues.push(...row.compliance_issues);
      }
    });

    const bySeverity = {
      critical: 0,
      high: 0,
      medium: 0,
      low: 0,
    };

    const byCategory = {
      encryption: 0,
      backups: 0,
      public_access: 0,
      tagging: 0,
      iam: 0,
      networking: 0,
    };

    allIssues.forEach(issue => {
      bySeverity[issue.severity]++;
      byCategory[issue.category]++;
    });

    return {
      total_issues: allIssues.length,
      by_severity: bySeverity,
      by_category: byCategory,
    };
  }

  /**
   * Get all compliance issues across all resources
   */
  async getComplianceIssues(organizationId: string): Promise<Array<AWSResource & { issues: ComplianceIssue[] }>> {
    // Current compliance posture — compliance_issues is overwritten in place on every
    // scan (not an append-only findings log), so a terminated resource's issues are
    // stale-by-definition, not a historical record worth surfacing here.
    const result = await this.pool.query(
      `SELECT * FROM aws_resources
       WHERE organization_id = $1
       AND status != 'terminated'
       AND jsonb_array_length(compliance_issues) > 0
       ORDER BY created_at DESC`,
      [organizationId]
    );

    return result.rows.map(row => ({
      ...row,
      issues: row.compliance_issues || [],
    }));
  }

  /**
   * Get orphaned resources
   * Note: This is a placeholder - actual orphaned detection is done by OrphanedResourceDetectorService
   */
  async getOrphaned(organizationId: string): Promise<AWSResource[]> {
    // Return resources that are likely orphaned based on simple criteria
    const result = await this.pool.query(
      `SELECT * FROM aws_resources
       WHERE organization_id = $1
       AND status != 'terminated'
       AND (
         (resource_type = 'ec2' AND status = 'stopped') OR
         (resource_type = 's3' AND metadata->>'object_count' = '0')
       )
       ORDER BY estimated_monthly_cost DESC`,
      [organizationId]
    );

    return result.rows;
  }

  /**
   * Update compliance issues for a resource
   */
  async updateComplianceIssues(
    resourceId: string,
    organizationId: string,
    issues: ComplianceIssue[]
  ): Promise<void> {
    await this.pool.query(
      `UPDATE aws_resources
       SET compliance_issues = $1, updated_at = NOW()
       WHERE id = $2 AND organization_id = $3`,
      [JSON.stringify(issues), resourceId, organizationId]
    );
  }

  /**
   * Get latest discovery job
   */
  async getLatestDiscoveryJob(organizationId: string) {
    const result = await this.pool.query(
      `SELECT * FROM resource_discovery_jobs
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId]
    );

    return result.rows[0] || null;
  }

  /**
   * Get all discovery jobs
   */
  async getDiscoveryJobs(organizationId: string, limit: number = 10) {
    const result = await this.pool.query(
      `SELECT * FROM resource_discovery_jobs
       WHERE organization_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [organizationId, limit]
    );

    return result.rows;
  }
}
