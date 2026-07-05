import { PoolClient } from 'pg';
import { pool } from '../config/database';
import {
  CostRecommendation,
  CreateRecommendationRequest,
  RecommendationFilters,
  RecommendationStats,
  RecommendationStatus,
} from '../types';

export class CostRecommendationsRepository {
  /**
   * Hold a single client for the whole call and set org context session-scoped
   * (is_local = false) so it survives across multiple statements / an explicit
   * transaction on that connection — matches the pattern used across the rest
   * of the backend for RLS-gated tables.
   */
  private async withOrgClient<T>(
    organizationId: string,
    fn: (client: PoolClient) => Promise<T>
  ): Promise<T> {
    const client = await pool.connect();
    try {
      await client.query(
        "SELECT set_config('app.current_organization_id', $1, false)",
        [organizationId]
      );
      return await fn(client);
    } finally {
      client.release();
    }
  }

  /**
   * Find all recommendations with optional filters
   */
  async findAll(
    organizationId: string,
    filters?: RecommendationFilters
  ): Promise<CostRecommendation[]> {
    return this.withOrgClient(organizationId, async (client) => {
      let query = `
        SELECT *
        FROM cost_recommendations
        WHERE organization_id = $1
      `;
      const params: any[] = [organizationId];
      let paramCount = 1;

      if (filters?.severity) {
        paramCount++;
        params.push(filters.severity);
        query += ` AND severity = $${paramCount}`;
      }

      if (filters?.status) {
        paramCount++;
        params.push(filters.status);
        query += ` AND status = $${paramCount}`;
      }

      if (filters?.resource_type) {
        paramCount++;
        params.push(filters.resource_type);
        query += ` AND resource_type = $${paramCount}`;
      }

      query += ' ORDER BY potential_savings DESC, created_at DESC';

      if (filters?.limit) {
        paramCount++;
        params.push(filters.limit);
        query += ` LIMIT $${paramCount}`;
      }

      if (filters?.offset) {
        paramCount++;
        params.push(filters.offset);
        query += ` OFFSET $${paramCount}`;
      }

      const result = await client.query(query, params);
      return result.rows;
    });
  }

  /**
   * Find recommendation by ID
   */
  async findById(id: string, organizationId: string): Promise<CostRecommendation | null> {
    return this.withOrgClient(organizationId, async (client) => {
      const query = 'SELECT * FROM cost_recommendations WHERE id = $1 AND organization_id = $2';
      const result = await client.query(query, [id, organizationId]);
      return result.rows[0] || null;
    });
  }

  /**
   * Create a new recommendation
   */
  async create(
    recommendation: CreateRecommendationRequest,
    organizationId: string
  ): Promise<CostRecommendation> {
    return this.withOrgClient(organizationId, async (client) => {
      const query = `
        INSERT INTO cost_recommendations (
          organization_id, resource_id, resource_name, resource_type, issue, description,
          potential_savings, severity, aws_region, metadata
        )
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
        RETURNING *
      `;

      const result = await client.query(query, [
        organizationId,
        recommendation.resource_id,
        recommendation.resource_name,
        recommendation.resource_type,
        recommendation.issue,
        recommendation.description,
        recommendation.potential_savings,
        recommendation.severity,
        recommendation.aws_region,
        JSON.stringify(recommendation.metadata || {}),
      ]);

      return result.rows[0];
    });
  }

  /**
   * Create multiple recommendations in bulk
   */
  async createBulk(
    recommendations: CreateRecommendationRequest[],
    organizationId: string
  ): Promise<number> {
    if (recommendations.length === 0) return 0;

    return this.withOrgClient(organizationId, async (client) => {
      try {
        await client.query('BEGIN');

        let insertedCount = 0;
        for (const rec of recommendations) {
          const query = `
            INSERT INTO cost_recommendations (
              organization_id, resource_id, resource_name, resource_type, issue, description,
              potential_savings, severity, aws_region, metadata
            )
            VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
          `;

          await client.query(query, [
            organizationId,
            rec.resource_id,
            rec.resource_name,
            rec.resource_type,
            rec.issue,
            rec.description,
            rec.potential_savings,
            rec.severity,
            rec.aws_region,
            JSON.stringify(rec.metadata || {}),
          ]);

          insertedCount++;
        }

        await client.query('COMMIT');
        return insertedCount;
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      }
    });
  }

  /**
   * Update recommendation status
   */
  async updateStatus(
    id: string,
    status: RecommendationStatus,
    organizationId: string
  ): Promise<CostRecommendation | null> {
    return this.withOrgClient(organizationId, async (client) => {
      const query = `
        UPDATE cost_recommendations
        SET status = $1::VARCHAR,
            updated_at = NOW(),
            resolved_at = CASE WHEN $1::VARCHAR = 'RESOLVED' THEN NOW() ELSE resolved_at END
        WHERE id = $2::UUID AND organization_id = $3
        RETURNING *
      `;

      const result = await client.query(query, [status, id, organizationId]);
      return result.rows[0] || null;
    });
  }

  /**
   * Delete recommendation
   */
  async delete(id: string, organizationId: string): Promise<boolean> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        'DELETE FROM cost_recommendations WHERE id = $1 AND organization_id = $2',
        [id, organizationId]
      );
      return result.rowCount ? result.rowCount > 0 : false;
    });
  }

  /**
   * Delete all active recommendations for an organization (used before re-analyzing)
   */
  async deleteAllActive(organizationId: string): Promise<number> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        'DELETE FROM cost_recommendations WHERE status = $1 AND organization_id = $2',
        ['ACTIVE', organizationId]
      );
      return result.rowCount || 0;
    });
  }

  /**
   * Get recommendation statistics for an organization
   */
  async getStats(organizationId: string): Promise<RecommendationStats> {
    return this.withOrgClient(organizationId, async (client) => {
      const totalQuery = await client.query(
        'SELECT COUNT(*) as count FROM cost_recommendations WHERE organization_id = $1',
        [organizationId]
      );
      const activeQuery = await client.query(
        'SELECT COUNT(*) as count FROM cost_recommendations WHERE status = $1 AND organization_id = $2',
        ['ACTIVE', organizationId]
      );
      const savingsQuery = await client.query(
        'SELECT COALESCE(SUM(potential_savings), 0) as total FROM cost_recommendations WHERE status = $1 AND organization_id = $2',
        ['ACTIVE', organizationId]
      );

      const severityQuery = await client.query(
        `
        SELECT
          COALESCE(SUM(CASE WHEN severity = 'HIGH' AND status = 'ACTIVE' THEN 1 ELSE 0 END), 0) as high,
          COALESCE(SUM(CASE WHEN severity = 'MEDIUM' AND status = 'ACTIVE' THEN 1 ELSE 0 END), 0) as medium,
          COALESCE(SUM(CASE WHEN severity = 'LOW' AND status = 'ACTIVE' THEN 1 ELSE 0 END), 0) as low
        FROM cost_recommendations
        WHERE organization_id = $1
      `,
        [organizationId]
      );

      return {
        total_recommendations: parseInt(totalQuery.rows[0].count),
        active_recommendations: parseInt(activeQuery.rows[0].count),
        total_potential_savings: parseFloat(savingsQuery.rows[0].total),
        by_severity: {
          high: parseInt(severityQuery.rows[0].high),
          medium: parseInt(severityQuery.rows[0].medium),
          low: parseInt(severityQuery.rows[0].low),
        },
      };
    });
  }

  /**
   * Get count of active recommendations for an organization
   */
  async getActiveCount(organizationId: string): Promise<number> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        'SELECT COUNT(*) as count FROM cost_recommendations WHERE status = $1 AND organization_id = $2',
        ['ACTIVE', organizationId]
      );
      return parseInt(result.rows[0].count);
    });
  }
}
