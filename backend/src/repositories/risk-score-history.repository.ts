import { Pool } from 'pg';

export interface RiskScoreSnapshot {
  id?: string;
  organizationId: string;
  snapshotDate: Date;
  overallScore: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  encryptionScore: number;
  publicAccessScore: number;
  backupScore: number;
  complianceScore: number;
  resourceManagementScore: number;
  totalResources: number;
  unencryptedCount: number;
  publicCount: number;
  missingBackupCount: number;
  complianceIssues: {
    critical: number;
    high: number;
    medium: number;
    low: number;
  };
  orphanedCount: number;
  createdAt?: Date;
}

export class RiskScoreHistoryRepository {
  constructor(private pool: Pool) {}

  /**
   * Create a daily snapshot (upsert)
   * Uses ON CONFLICT to ensure only one snapshot per org per day
   */
  async createSnapshot(snapshot: RiskScoreSnapshot): Promise<void> {
    const query = `
      INSERT INTO risk_score_history (
        organization_id, snapshot_date, overall_score, grade,
        encryption_score, public_access_score, backup_score,
        compliance_score, resource_management_score,
        total_resources, unencrypted_count, public_count,
        missing_backup_count, compliance_issues, orphaned_count
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
      ON CONFLICT (organization_id, snapshot_date)
      DO UPDATE SET
        overall_score = EXCLUDED.overall_score,
        grade = EXCLUDED.grade,
        encryption_score = EXCLUDED.encryption_score,
        public_access_score = EXCLUDED.public_access_score,
        backup_score = EXCLUDED.backup_score,
        compliance_score = EXCLUDED.compliance_score,
        resource_management_score = EXCLUDED.resource_management_score,
        total_resources = EXCLUDED.total_resources,
        unencrypted_count = EXCLUDED.unencrypted_count,
        public_count = EXCLUDED.public_count,
        missing_backup_count = EXCLUDED.missing_backup_count,
        compliance_issues = EXCLUDED.compliance_issues,
        orphaned_count = EXCLUDED.orphaned_count
    `;

    const values = [
      snapshot.organizationId,
      snapshot.snapshotDate,
      snapshot.overallScore,
      snapshot.grade,
      snapshot.encryptionScore,
      snapshot.publicAccessScore,
      snapshot.backupScore,
      snapshot.complianceScore,
      snapshot.resourceManagementScore,
      snapshot.totalResources,
      snapshot.unencryptedCount,
      snapshot.publicCount,
      snapshot.missingBackupCount,
      JSON.stringify(snapshot.complianceIssues),
      snapshot.orphanedCount,
    ];

    await this.pool.query(query, values);
  }

  /**
   * Get historical snapshots for an organization
   * @param organizationId - Organization UUID
   * @param days - Number of days to retrieve (7, 30, or 90)
   */
  async getHistory(organizationId: string, days: number): Promise<any[]> {
    const query = `
      SELECT *
      FROM risk_score_history
      WHERE organization_id = $1
        AND snapshot_date >= CURRENT_DATE - INTERVAL '${days} days'
      ORDER BY snapshot_date DESC
    `;

    const result = await this.pool.query(query, [organizationId]);
    return result.rows;
  }

  /**
   * Get latest snapshot for an organization
   */
  async getLatest(organizationId: string): Promise<any | null> {
    const query = `
      SELECT *
      FROM risk_score_history
      WHERE organization_id = $1
      ORDER BY snapshot_date DESC
      LIMIT 1
    `;

    const result = await this.pool.query(query, [organizationId]);
    return result.rows[0] || null;
  }

  /**
   * Delete snapshots older than specified days (for cleanup)
   */
  async deleteOldSnapshots(daysToKeep: number = 365): Promise<number> {
    const query = `
      DELETE FROM risk_score_history
      WHERE snapshot_date < CURRENT_DATE - INTERVAL '${daysToKeep} days'
    `;

    const result = await this.pool.query(query);
    return result.rowCount || 0;
  }
}
