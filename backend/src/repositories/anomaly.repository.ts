import { Pool } from 'pg';
import { AnomalyDetection, AnomalyStats, AnomalySeverity, AnomalyType } from '../types/anomaly.types';

export class AnomalyRepository {
  constructor(private pool: Pool) {}

  /**
   * Save detected anomalies
   */
  async saveAnomalies(anomalies: AnomalyDetection[]): Promise<void> {
    if (anomalies.length === 0) return;

    const query = `
      INSERT INTO anomaly_detections (
        id, organization_id, type, severity,
        resource_id, resource_type, resource_name, region, metric,
        current_value, expected_value, deviation,
        historical_average, historical_std_dev,
        detected_at, time_window,
        title, description, ai_explanation, impact, recommendation, confidence,
        status
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      ON CONFLICT (id) DO UPDATE SET
        current_value = EXCLUDED.current_value,
        deviation = EXCLUDED.deviation,
        detected_at = EXCLUDED.detected_at,
        ai_explanation = EXCLUDED.ai_explanation,
        impact = EXCLUDED.impact,
        recommendation = EXCLUDED.recommendation
    `;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const anomaly of anomalies) {
        await client.query(query, [
          anomaly.id,
          anomaly.organizationId,
          anomaly.type,
          anomaly.severity,
          anomaly.resourceId || null,
          anomaly.resourceType || null,
          anomaly.resourceName || null,
          anomaly.region || null,
          anomaly.metric,
          anomaly.currentValue,
          anomaly.expectedValue,
          anomaly.deviation,
          anomaly.historicalAverage,
          anomaly.historicalStdDev,
          anomaly.detectedAt,
          anomaly.timeWindow,
          anomaly.title,
          anomaly.description,
          anomaly.aiExplanation,
          anomaly.impact,
          anomaly.recommendation,
          anomaly.confidence,
          anomaly.status,
        ]);
      }

      await client.query('COMMIT');
      console.log(`[Anomaly Repo] Saved ${anomalies.length} anomalies`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[Anomaly Repo] Error saving anomalies:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get active anomalies for organization
   */
  async getActiveAnomalies(organizationId: string): Promise<AnomalyDetection[]> {
    const query = `
      SELECT * FROM anomaly_detections
      WHERE organization_id = $1
        AND status = 'active'
        AND detected_at > NOW() - INTERVAL '24 hours'
      ORDER BY
        CASE severity
          WHEN 'critical' THEN 1
          WHEN 'warning' THEN 2
          WHEN 'info' THEN 3
        END,
        detected_at DESC
    `;

    const result = await this.pool.query(query, [organizationId]);
    return result.rows.map(this.mapRow);
  }

  /**
   * Get all anomalies for organization (including resolved)
   */
  async getAllAnomalies(organizationId: string, limit: number = 100): Promise<AnomalyDetection[]> {
    const query = `
      SELECT * FROM anomaly_detections
      WHERE organization_id = $1
        AND detected_at > NOW() - INTERVAL '7 days'
      ORDER BY detected_at DESC
      LIMIT $2
    `;

    const result = await this.pool.query(query, [organizationId, limit]);
    return result.rows.map(this.mapRow);
  }

  /**
   * Get anomaly statistics
   */
  async getStats(organizationId: string): Promise<AnomalyStats> {
    const query = `
      SELECT
        COUNT(*) as total,
        COUNT(*) FILTER (WHERE status = 'active') as active,
        COUNT(*) FILTER (WHERE severity = 'critical') as critical,
        COUNT(*) FILTER (WHERE severity = 'warning') as warning,
        COUNT(*) FILTER (WHERE severity = 'info') as info,
        COUNT(*) FILTER (WHERE status = 'false_positive') as false_positives,
        AVG(EXTRACT(EPOCH FROM (resolved_at - detected_at)) / 3600)
          FILTER (WHERE resolved_at IS NOT NULL) as avg_resolution_hours
      FROM anomaly_detections
      WHERE organization_id = $1
        AND detected_at > NOW() - INTERVAL '7 days'
    `;

    const typeQuery = `
      SELECT type, COUNT(*) as count
      FROM anomaly_detections
      WHERE organization_id = $1
        AND detected_at > NOW() - INTERVAL '7 days'
      GROUP BY type
    `;

    const [statsResult, typeResult] = await Promise.all([
      this.pool.query(query, [organizationId]),
      this.pool.query(typeQuery, [organizationId]),
    ]);

    const row = statsResult.rows[0] || {};
    const total = parseInt(row.total || 0);
    const falsePositives = parseInt(row.false_positives || 0);

    const byType: Record<AnomalyType, number> = {} as Record<AnomalyType, number>;
    for (const typeRow of typeResult.rows) {
      byType[typeRow.type as AnomalyType] = parseInt(typeRow.count);
    }

    return {
      total,
      active: parseInt(row.active || 0),
      bySeverity: {
        critical: parseInt(row.critical || 0),
        warning: parseInt(row.warning || 0),
        info: parseInt(row.info || 0),
      },
      byType,
      mttr: parseFloat(row.avg_resolution_hours || 0),
      falsePositiveRate: total > 0 ? (falsePositives / total) * 100 : 0,
    };
  }

  /**
   * Acknowledge anomaly
   */
  async acknowledge(id: string, userId: string): Promise<void> {
    const query = `
      UPDATE anomaly_detections
      SET status = 'acknowledged',
          acknowledged_at = NOW(),
          acknowledged_by = $2,
          updated_at = NOW()
      WHERE id = $1
    `;

    await this.pool.query(query, [id, userId]);
  }

  /**
   * Resolve anomaly
   */
  async resolve(id: string, notes?: string): Promise<void> {
    const query = `
      UPDATE anomaly_detections
      SET status = 'resolved',
          resolved_at = NOW(),
          notes = COALESCE($2, notes),
          updated_at = NOW()
      WHERE id = $1
    `;

    await this.pool.query(query, [id, notes]);
  }

  /**
   * Mark as false positive
   */
  async markFalsePositive(id: string, notes?: string): Promise<void> {
    const query = `
      UPDATE anomaly_detections
      SET status = 'false_positive',
          resolved_at = NOW(),
          notes = COALESCE($2, notes),
          updated_at = NOW()
      WHERE id = $1
    `;

    await this.pool.query(query, [id, notes]);
  }

  /**
   * Check for recent similar anomaly (deduplication)
   */
  async hasRecentSimilar(
    organizationId: string,
    type: string,
    resourceId: string | null,
    metric: string,
    cooldownMinutes: number = 60
  ): Promise<boolean> {
    const query = `
      SELECT EXISTS(
        SELECT 1 FROM anomaly_detections
        WHERE organization_id = $1
          AND type = $2
          AND COALESCE(resource_id, '') = COALESCE($3, '')
          AND metric = $4
          AND status = 'active'
          AND detected_at > NOW() - INTERVAL '1 minute' * $5
      ) as exists
    `;

    const result = await this.pool.query(query, [
      organizationId,
      type,
      resourceId,
      metric,
      cooldownMinutes,
    ]);

    return result.rows[0]?.exists || false;
  }

  /**
   * Map database row to anomaly object
   */
  private mapRow(row: any): AnomalyDetection {
    return {
      id: row.id,
      organizationId: row.organization_id,
      type: row.type,
      severity: row.severity,
      resourceId: row.resource_id,
      resourceType: row.resource_type,
      resourceName: row.resource_name,
      region: row.region,
      metric: row.metric,
      currentValue: parseFloat(row.current_value),
      expectedValue: parseFloat(row.expected_value),
      deviation: parseFloat(row.deviation),
      historicalAverage: parseFloat(row.historical_average),
      historicalStdDev: parseFloat(row.historical_std_dev),
      detectedAt: new Date(row.detected_at),
      timeWindow: row.time_window,
      title: row.title,
      description: row.description,
      aiExplanation: row.ai_explanation,
      impact: row.impact,
      recommendation: row.recommendation,
      confidence: row.confidence,
      status: row.status,
      acknowledgedAt: row.acknowledged_at ? new Date(row.acknowledged_at) : undefined,
      acknowledgedBy: row.acknowledged_by,
      resolvedAt: row.resolved_at ? new Date(row.resolved_at) : undefined,
      notes: row.notes,
      relatedEvents: row.related_events,
      affectedResources: row.affected_resources,
    };
  }
}
