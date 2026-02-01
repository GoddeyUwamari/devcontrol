/**
 * Optimization Repository
 * Database operations for cost optimization recommendations
 */

import { Pool } from 'pg';
import { OptimizationRecommendation, OptimizationSummary, OptimizationType } from '../types/optimization.types';

export class OptimizationRepository {
  constructor(private pool: Pool) {}

  /**
   * Save recommendations to database
   */
  async saveRecommendations(recommendations: OptimizationRecommendation[]): Promise<void> {
    if (recommendations.length === 0) return;

    const query = `
      INSERT INTO cost_optimizations (
        id, organization_id, type, resource_id, resource_type, resource_name, region,
        current_cost, optimized_cost, monthly_savings, annual_savings,
        risk, effort, confidence, priority,
        title, description, reasoning, action, action_command,
        status, detected_at, utilization_metrics
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23)
      ON CONFLICT (organization_id, resource_id, type)
      DO UPDATE SET
        current_cost = EXCLUDED.current_cost,
        monthly_savings = EXCLUDED.monthly_savings,
        annual_savings = EXCLUDED.annual_savings,
        priority = EXCLUDED.priority,
        detected_at = EXCLUDED.detected_at,
        updated_at = NOW()
    `;

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');

      for (const rec of recommendations) {
        await client.query(query, [
          rec.id,
          rec.organizationId,
          rec.type,
          rec.resourceId,
          rec.resourceType,
          rec.resourceName,
          rec.region,
          rec.currentCost,
          rec.optimizedCost,
          rec.monthlySavings,
          rec.annualSavings,
          rec.risk,
          rec.effort,
          rec.confidence,
          rec.priority,
          rec.title,
          rec.description,
          rec.reasoning,
          rec.action,
          rec.actionCommand,
          rec.status,
          rec.detectedAt,
          JSON.stringify(rec.utilizationMetrics || {}),
        ]);
      }

      await client.query('COMMIT');
      console.log(`[Optimization Repo] Saved ${recommendations.length} recommendations`);
    } catch (error) {
      await client.query('ROLLBACK');
      console.error('[Optimization Repo] Error saving recommendations:', error);
      throw error;
    } finally {
      client.release();
    }
  }

  /**
   * Get recommendations for organization
   */
  async getRecommendations(organizationId: string, status?: string): Promise<OptimizationRecommendation[]> {
    let query = `
      SELECT * FROM cost_optimizations
      WHERE organization_id = $1
    `;

    const params: any[] = [organizationId];

    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }

    query += ` ORDER BY priority DESC, monthly_savings DESC`;

    const result = await this.pool.query(query, params);
    return result.rows.map(this.mapRow);
  }

  /**
   * Get summary statistics
   */
  async getSummary(organizationId: string): Promise<OptimizationSummary> {
    const query = `
      SELECT
        COUNT(*) as total,
        SUM(monthly_savings) as total_monthly,
        SUM(annual_savings) as total_annual,
        type,
        risk,
        status
      FROM cost_optimizations
      WHERE organization_id = $1
      GROUP BY type, risk, status
    `;

    const result = await this.pool.query(query, [organizationId]);

    const summary: OptimizationSummary = {
      totalRecommendations: 0,
      totalMonthlySavings: 0,
      totalAnnualSavings: 0,
      byType: {} as any,
      byRisk: { safe: 0, caution: 0, risky: 0 },
      byStatus: { pending: 0, approved: 0, applied: 0, dismissed: 0 },
    };

    for (const row of result.rows) {
      summary.totalRecommendations += parseInt(row.total);
      summary.totalMonthlySavings += parseFloat(row.total_monthly || 0);
      summary.totalAnnualSavings += parseFloat(row.total_annual || 0);

      if (!summary.byType[row.type]) {
        summary.byType[row.type] = { count: 0, savings: 0 };
      }
      summary.byType[row.type].count += parseInt(row.total);
      summary.byType[row.type].savings += parseFloat(row.total_monthly || 0);

      if (row.risk) {
        summary.byRisk[row.risk] = (summary.byRisk[row.risk] || 0) + parseInt(row.total);
      }

      if (row.status) {
        summary.byStatus[row.status] = (summary.byStatus[row.status] || 0) + parseInt(row.total);
      }
    }

    return summary;
  }

  /**
   * Update recommendation status
   */
  async updateStatus(id: string, status: string, appliedAt?: Date): Promise<void> {
    const query = `
      UPDATE cost_optimizations
      SET status = $1, applied_at = $2, updated_at = NOW()
      WHERE id = $3
    `;

    await this.pool.query(query, [status, appliedAt, id]);
    console.log(`[Optimization Repo] Updated status for ${id} to ${status}`);
  }

  /**
   * Delete old dismissed recommendations (cleanup)
   */
  async deleteOldDismissed(organizationId: string, daysOld: number = 90): Promise<number> {
    const query = `
      DELETE FROM cost_optimizations
      WHERE organization_id = $1
        AND status = 'dismissed'
        AND dismissed_at < NOW() - INTERVAL '${daysOld} days'
    `;

    const result = await this.pool.query(query, [organizationId]);
    const count = result.rowCount || 0;
    console.log(`[Optimization Repo] Deleted ${count} old dismissed recommendations`);
    return count;
  }

  /**
   * Map database row to recommendation
   */
  private mapRow(row: any): OptimizationRecommendation {
    return {
      id: row.id,
      organizationId: row.organization_id,
      type: row.type as OptimizationType,
      resourceId: row.resource_id,
      resourceType: row.resource_type,
      resourceName: row.resource_name,
      region: row.region,
      currentCost: parseFloat(row.current_cost),
      optimizedCost: parseFloat(row.optimized_cost),
      monthlySavings: parseFloat(row.monthly_savings),
      annualSavings: parseFloat(row.annual_savings),
      risk: row.risk,
      effort: row.effort,
      confidence: row.confidence,
      priority: row.priority,
      title: row.title,
      description: row.description,
      reasoning: row.reasoning,
      action: row.action,
      actionCommand: row.action_command,
      status: row.status,
      detectedAt: new Date(row.detected_at),
      appliedAt: row.applied_at ? new Date(row.applied_at) : undefined,
      dismissedAt: row.dismissed_at ? new Date(row.dismissed_at) : undefined,
      utilizationMetrics: row.utilization_metrics,
    };
  }
}
