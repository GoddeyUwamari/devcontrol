import { Pool } from 'pg';
import { RiskScoreHistoryRepository } from '../repositories/risk-score-history.repository';
import { AWSResourcesRepository } from '../repositories/awsResources.repository';
import { calculateRiskScore, RiskScore } from '../utils/riskScoring';

export interface RiskScoreTrendPoint {
  date: string; // ISO date string
  score: number;
  grade: 'A' | 'B' | 'C' | 'D' | 'F';
  factors: {
    encryption: number;
    publicAccess: number;
    backup: number;
    compliance: number;
    resourceManagement: number;
  };
}

export interface RiskScoreTrendResponse {
  current: RiskScore;
  trend: 'improving' | 'stable' | 'declining';
  trendPercentage: number; // % change from period start
  history: RiskScoreTrendPoint[];
  period: {
    start: string;
    end: string;
    days: number;
  };
}

export class RiskTrackingService {
  private repository: RiskScoreHistoryRepository;
  private resourcesRepository: AWSResourcesRepository;

  constructor(private pool: Pool) {
    this.repository = new RiskScoreHistoryRepository(pool);
    this.resourcesRepository = new AWSResourcesRepository(pool);
  }

  /**
   * Calculate current risk score for an organization
   * Reuses existing risk scoring logic from lib/utils/riskScoring.ts
   */
  async calculateCurrentRiskScore(organizationId: string): Promise<RiskScore> {
    const stats = await this.resourcesRepository.getStats(organizationId);

    const factors = {
      totalResources: stats.total_resources || 0,
      unencryptedCount: stats.unencrypted_count || 0,
      publicCount: stats.public_count || 0,
      missingBackupCount: stats.missing_backup_count || 0,
      complianceIssues: stats.compliance_stats?.by_severity || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      orphanedCount: stats.orphaned_count || 0,
    };

    return calculateRiskScore(factors);
  }

  /**
   * Store daily risk score snapshot
   * Should be called once per day via cron job
   */
  async storeDailySnapshot(organizationId: string): Promise<void> {
    const stats = await this.resourcesRepository.getStats(organizationId);
    const riskScore = await this.calculateCurrentRiskScore(organizationId);

    await this.repository.createSnapshot({
      organizationId,
      snapshotDate: new Date(),
      overallScore: riskScore.score,
      grade: riskScore.grade,
      encryptionScore: riskScore.factors.encryption,
      publicAccessScore: riskScore.factors.publicAccess,
      backupScore: riskScore.factors.backup,
      complianceScore: riskScore.factors.compliance,
      resourceManagementScore: riskScore.factors.resourceManagement,
      totalResources: stats.total_resources || 0,
      unencryptedCount: stats.unencrypted_count || 0,
      publicCount: stats.public_count || 0,
      missingBackupCount: stats.missing_backup_count || 0,
      complianceIssues: stats.compliance_stats?.by_severity || {
        critical: 0,
        high: 0,
        medium: 0,
        low: 0,
      },
      orphanedCount: stats.orphaned_count || 0,
    });
  }

  /**
   * Store snapshots for all active organizations
   * Called by daily cron job
   */
  async storeAllOrganizationSnapshots(): Promise<void> {
    const client = await this.pool.connect();
    try {
      const result = await client.query(
        'SELECT id, name FROM organizations WHERE is_active = true'
      );

      for (const org of result.rows) {
        try {
          await this.storeDailySnapshot(org.id);
          console.log(`[Risk Tracking] Snapshot stored for ${org.name}`);
        } catch (error: any) {
          console.error(`[Risk Tracking] Failed for ${org.name}:`, error.message);
        }
      }
    } finally {
      client.release();
    }
  }

  /**
   * Get risk score trend for a date range
   * @param organizationId - Organization UUID
   * @param dateRange - Time period: 7d, 30d, or 90d
   */
  async getRiskScoreTrend(
    organizationId: string,
    dateRange: '7d' | '30d' | '90d' = '30d'
  ): Promise<RiskScoreTrendResponse> {
    const days = parseInt(dateRange);
    const history = await this.repository.getHistory(organizationId, days);
    const current = await this.calculateCurrentRiskScore(organizationId);

    // Calculate trend
    let trend: 'improving' | 'stable' | 'declining' = 'stable';
    let trendPercentage = 0;

    if (history.length >= 2) {
      const firstScore = history[history.length - 1].overall_score;
      const lastScore = history[0].overall_score;

      // Avoid division by zero
      if (firstScore > 0) {
        trendPercentage = ((lastScore - firstScore) / firstScore) * 100;
      }

      if (Math.abs(trendPercentage) < 5) {
        trend = 'stable';
      } else if (trendPercentage > 0) {
        trend = 'improving'; // Higher score = better
      } else {
        trend = 'declining';
      }
    }

    // Map to response format
    const trendPoints: RiskScoreTrendPoint[] = history.map((h) => ({
      date: h.snapshot_date.toISOString().split('T')[0],
      score: h.overall_score,
      grade: h.grade as 'A' | 'B' | 'C' | 'D' | 'F',
      factors: {
        encryption: h.encryption_score,
        publicAccess: h.public_access_score,
        backup: h.backup_score,
        compliance: h.compliance_score,
        resourceManagement: h.resource_management_score,
      },
    }));

    const startDate = new Date();
    startDate.setDate(startDate.getDate() - days);

    return {
      current,
      trend,
      trendPercentage: Math.round(trendPercentage * 10) / 10,
      history: trendPoints,
      period: {
        start: startDate.toISOString().split('T')[0],
        end: new Date().toISOString().split('T')[0],
        days,
      },
    };
  }
}
