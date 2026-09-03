import { PoolClient } from 'pg';
import { pool } from '../config/database';
import {
  CostRecommendation,
  CreateRecommendationRequest,
  RecommendationFilters,
  RecommendationStats,
  RecommendationStatus,
} from '../types';
import { DetectorObservation } from '../services/cost-optimization.service';

// Fixed, canonical issue strings for the 3 detectors this occurrence
// lifecycle applies to (backend/src/services/cost-optimization.service.ts).
// Reserved Instance Opportunity is deliberately excluded -- its resource_id
// is a synthetic, fleet-level aggregate (`ri-opportunity-${instanceType}`),
// not a discrete AWS resource, so it keeps the pre-existing unconditional
// delete+recreate behavior via deleteActiveByIssue()+createBulk() instead of
// reconcileActiveRecommendations().
const NON_RI_ISSUES = ['Idle Instance', 'Oversized Instance', 'Unused Elastic IP'] as const;

// Distinct from the migration runner's single-integer advisory lock
// (database/migrate.js, key 727271, the untyped single-bigint keyspace) and
// from stripe-webhook-ledger.service.ts's hashtextextended(id, 0) locks
// (same two-argument keyspace, salt 0) -- this uses the same keyspace with
// a different salt so none of the three can collide with each other.
const RECONCILIATION_LOCK_SALT = 1;

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
   * Create multiple recommendations in bulk. Used for Reserved Instance
   * Opportunities (unconditional insert, no occurrence-lifecycle awareness
   * -- see the NON_RI_ISSUES comment above) and by callers that don't need
   * suppression logic. ON CONFLICT DO NOTHING guards against
   * idx_cost_recommendations_active_identity without aborting the whole
   * batch on one incidental duplicate -- Postgres never raises an error to
   * the client for a DO NOTHING conflict, so no per-row try/catch or
   * savepoint is needed.
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
            ON CONFLICT (organization_id, resource_id, issue) WHERE status = 'ACTIVE' DO NOTHING
          `;

          const result = await client.query(query, [
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

          insertedCount += result.rowCount || 0;
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
   * Reconciles ACTIVE recommendations for the 3 occurrence-lifecycle-aware
   * detector categories (NON_RI_ISSUES) against this scan's fresh detector
   * output, in one locked transaction per organization.
   *
   * For each category whose detector completed successfully this scan
   * (observation.success === true):
   *  - any RESOLVED/DISMISSED row for that issue whose resource_id is
   *    absent from this scan's findings has its occurrence marked ended
   *    (occurrence_ended_at set, once, if not already set) -- a completed,
   *    successful "not found" observation is the only thing allowed to end
   *    an occurrence.
   *  - existing ACTIVE rows for that issue are replaced with this scan's
   *    fresh findings, except a finding is skipped (suppressed) if a
   *    RESOLVED/DISMISSED row for the same (organization_id, resource_id,
   *    issue) still has an open occurrence (occurrence_ended_at IS NULL) --
   *    this is the actual Resolve/Dismiss fix: an unchanged condition no
   *    longer resurrects as a new ACTIVE row every scan.
   *
   * A category whose detector did NOT complete successfully this scan is
   * left entirely untouched -- no rows ended, no ACTIVE rows deleted or
   * replaced -- exactly preserving whatever was true as of the last
   * successful scan, per the requirement that detector failure/timeout/
   * AWS-not-connected must never be interpreted as disappearance.
   *
   * Serialized per-organization via a session-level advisory lock
   * (hashtextextended keyspace, salt distinct from the migration runner's
   * plain-integer lock and from stripe-webhook-ledger.service.ts's salt 0)
   * so a concurrent scan for the same org -- manual analyze racing the
   * 6-hour cron, or two overlapping manual scans -- waits rather than
   * racing. Without this, a delete-then-insert split across two separately
   * committed operations can both duplicate rows and silently drop a
   * just-inserted row from a still-running concurrent scan.
   */
  async reconcileActiveRecommendations(
    organizationId: string,
    observations: DetectorObservation[]
  ): Promise<{ insertedCount: number }> {
    const successful = observations.filter((o) => o.success);
    if (successful.length === 0) {
      return { insertedCount: 0 };
    }

    return this.withOrgClient(organizationId, async (client) => {
      await client.query(
        `SELECT pg_advisory_lock(hashtextextended($1, ${RECONCILIATION_LOCK_SALT}))`,
        [organizationId]
      );

      try {
        await client.query('BEGIN');

        let insertedCount = 0;

        for (const observation of successful) {
          const presentResourceIds = observation.recommendations.map((r) => r.resource_id);

          // `<> ALL($3)` over an empty array is vacuously true for every row --
          // correctly ends every open occurrence in this category when the
          // detector completed successfully but found nothing at all.
          await client.query(
            `UPDATE cost_recommendations
             SET occurrence_ended_at = NOW()
             WHERE organization_id = $1
               AND issue = $2
               AND status IN ('RESOLVED', 'DISMISSED')
               AND occurrence_ended_at IS NULL
               AND resource_id <> ALL($3::varchar[])`,
            [organizationId, observation.issue, presentResourceIds]
          );

          await client.query(
            `DELETE FROM cost_recommendations
             WHERE organization_id = $1 AND status = 'ACTIVE' AND issue = $2`,
            [organizationId, observation.issue]
          );

          for (const rec of observation.recommendations) {
            // Skip (suppress) if an open RESOLVED/DISMISSED occurrence exists
            // for this exact tuple. ON CONFLICT is defense-in-depth against
            // idx_cost_recommendations_active_identity -- the DELETE above
            // already cleared this category's ACTIVE rows within this same
            // transaction, so a conflict here would only arise from a
            // pre-existing duplicate predating this migration.
            const result = await client.query(
              `INSERT INTO cost_recommendations (
                 organization_id, resource_id, resource_name, resource_type, issue, description,
                 potential_savings, severity, aws_region, metadata, status
               )
               SELECT $1::UUID, $2::VARCHAR, $3::VARCHAR, $4::VARCHAR, $5::VARCHAR, $6::TEXT,
                      $7::NUMERIC, $8::VARCHAR, $9::VARCHAR, $10::JSONB, 'ACTIVE'
               WHERE NOT EXISTS (
                 SELECT 1 FROM cost_recommendations
                 WHERE organization_id = $1::UUID AND resource_id = $2::VARCHAR AND issue = $5::VARCHAR
                   AND status IN ('RESOLVED', 'DISMISSED') AND occurrence_ended_at IS NULL
               )
               ON CONFLICT (organization_id, resource_id, issue) WHERE status = 'ACTIVE' DO NOTHING`,
              [
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
              ]
            );
            insertedCount += result.rowCount || 0;
          }
        }

        await client.query('COMMIT');
        return { insertedCount };
      } catch (error) {
        await client.query('ROLLBACK');
        throw error;
      } finally {
        await client.query(
          `SELECT pg_advisory_unlock(hashtextextended($1, ${RECONCILIATION_LOCK_SALT}))`,
          [organizationId]
        );
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
   * Delete active recommendations for one issue category (used before
   * re-analyzing). Scoped by issue rather than org-wide so a caller can
   * clear exactly the category it just got fresh detector results for --
   * e.g. Reserved Instance Opportunities, which are re-derived unconditionally
   * every scan (see createBulk() above), independent of the occurrence
   * lifecycle reconcileActiveRecommendations() applies to the other three.
   */
  async deleteActiveByIssue(organizationId: string, issue: string): Promise<number> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        'DELETE FROM cost_recommendations WHERE status = $1 AND organization_id = $2 AND issue = $3',
        ['ACTIVE', organizationId, issue]
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
