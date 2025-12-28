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
   * Find all recommendations with optional filters
   */
  async findAll(filters?: RecommendationFilters): Promise<CostRecommendation[]> {
    let query = `
      SELECT *
      FROM cost_recommendations
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;

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

    const result = await pool.query(query, params);
    return result.rows;
  }

  /**
   * Find recommendation by ID
   */
  async findById(id: string): Promise<CostRecommendation | null> {
    const query = 'SELECT * FROM cost_recommendations WHERE id = $1';
    const result = await pool.query(query, [id]);
    return result.rows[0] || null;
  }

  /**
   * Create a new recommendation
   */
  async create(recommendation: CreateRecommendationRequest): Promise<CostRecommendation> {
    const query = `
      INSERT INTO cost_recommendations (
        resource_id, resource_name, resource_type, issue, description,
        potential_savings, severity, aws_region, metadata
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *
    `;

    const result = await pool.query(query, [
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
  }

  /**
   * Create multiple recommendations in bulk
   */
  async createBulk(recommendations: CreateRecommendationRequest[]): Promise<number> {
    if (recommendations.length === 0) return 0;

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      let insertedCount = 0;
      for (const rec of recommendations) {
        const query = `
          INSERT INTO cost_recommendations (
            resource_id, resource_name, resource_type, issue, description,
            potential_savings, severity, aws_region, metadata
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `;

        await client.query(query, [
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
    } finally {
      client.release();
    }
  }

  /**
   * Update recommendation status
   */
  async updateStatus(
    id: string,
    status: RecommendationStatus
  ): Promise<CostRecommendation | null> {
    const query = `
      UPDATE cost_recommendations
      SET status = $1::VARCHAR,
          updated_at = NOW(),
          resolved_at = CASE WHEN $1::VARCHAR = 'RESOLVED' THEN NOW() ELSE resolved_at END
      WHERE id = $2::UUID
      RETURNING *
    `;

    const result = await pool.query(query, [status, id]);
    return result.rows[0] || null;
  }

  /**
   * Delete recommendation
   */
  async delete(id: string): Promise<boolean> {
    const result = await pool.query('DELETE FROM cost_recommendations WHERE id = $1', [id]);
    return result.rowCount ? result.rowCount > 0 : false;
  }

  /**
   * Delete all active recommendations (used before re-analyzing)
   */
  async deleteAllActive(): Promise<number> {
    const result = await pool.query('DELETE FROM cost_recommendations WHERE status = $1', [
      'ACTIVE',
    ]);
    return result.rowCount || 0;
  }

  /**
   * Get recommendation statistics
   */
  async getStats(): Promise<RecommendationStats> {
    const totalQuery = await pool.query('SELECT COUNT(*) as count FROM cost_recommendations');
    const activeQuery = await pool.query(
      'SELECT COUNT(*) as count FROM cost_recommendations WHERE status = $1',
      ['ACTIVE']
    );
    const savingsQuery = await pool.query(
      'SELECT COALESCE(SUM(potential_savings), 0) as total FROM cost_recommendations WHERE status = $1',
      ['ACTIVE']
    );

    const severityQuery = await pool.query(`
      SELECT
        COALESCE(SUM(CASE WHEN severity = 'HIGH' AND status = 'ACTIVE' THEN 1 ELSE 0 END), 0) as high,
        COALESCE(SUM(CASE WHEN severity = 'MEDIUM' AND status = 'ACTIVE' THEN 1 ELSE 0 END), 0) as medium,
        COALESCE(SUM(CASE WHEN severity = 'LOW' AND status = 'ACTIVE' THEN 1 ELSE 0 END), 0) as low
      FROM cost_recommendations
    `);

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
  }

  /**
   * Get count of active recommendations
   */
  async getActiveCount(): Promise<number> {
    const result = await pool.query(
      'SELECT COUNT(*) as count FROM cost_recommendations WHERE status = $1',
      ['ACTIVE']
    );
    return parseInt(result.rows[0].count);
  }
}
