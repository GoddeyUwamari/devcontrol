import { PoolClient } from 'pg';
import { pool } from '../config/database';

export type CostAnalysisRunStatus = 'running' | 'completed' | 'failed';

export interface CostAnalysisRun {
  id: string;
  organization_id: string;
  status: CostAnalysisRunStatus;
  recommendations_found: number | null;
  total_potential_savings: string | null; // NUMERIC comes back from pg as a string
  error_message: string | null;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

/**
 * Persistence for manual "Run cost analysis" runs (POST
 * /api/cost-recommendations/analyze) -- see
 * database/migrations/202609060900_create_cost_analysis_runs.sql for why
 * this is a separate table from resource_discovery_jobs rather than a new
 * row shape in it.
 *
 * Mirrors CostRecommendationsRepository's withOrgClient pattern: a single
 * held client with session-scoped (is_local = false) org context, matching
 * every other RLS-gated table in this codebase.
 */
export class CostAnalysisRunsRepository {
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
   * Creates a 'running' row at the start of a manual analysis. Callers
   * should treat a failure here as non-fatal to the actual analysis --
   * bookkeeping must never block the real, already-working analyze
   * behavior (see CostRecommendationsController.analyze()).
   */
  async create(organizationId: string): Promise<CostAnalysisRun> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        `INSERT INTO cost_analysis_runs (organization_id, status, started_at)
         VALUES ($1, 'running', NOW())
         RETURNING *`,
        [organizationId]
      );
      return result.rows[0];
    });
  }

  /**
   * Marks a run completed. Only ever called after analyzeAllResources() +
   * reconciliation have actually succeeded -- never speculatively.
   */
  async markCompleted(
    id: string,
    organizationId: string,
    data: { recommendationsFound: number; totalPotentialSavings: number }
  ): Promise<void> {
    await this.withOrgClient(organizationId, async (client) => {
      await client.query(
        `UPDATE cost_analysis_runs
         SET status = 'completed', completed_at = NOW(),
             recommendations_found = $1, total_potential_savings = $2
         WHERE id = $3 AND organization_id = $4`,
        [data.recommendationsFound, data.totalPotentialSavings, id, organizationId]
      );
    });
  }

  /**
   * Marks a run failed, storing the full real error for server-side
   * diagnostics. GET /api/cost-recommendations/analysis-runs deliberately
   * does not return this column verbatim to the frontend.
   */
  async markFailed(id: string, organizationId: string, errorMessage: string): Promise<void> {
    await this.withOrgClient(organizationId, async (client) => {
      await client.query(
        `UPDATE cost_analysis_runs
         SET status = 'failed', completed_at = NOW(), error_message = $1
         WHERE id = $2 AND organization_id = $3`,
        [errorMessage, id, organizationId]
      );
    });
  }

  /**
   * Most recent runs, latest first -- same ordering convention as
   * AWSResourcesRepository.getDiscoveryJobs().
   */
  async getLatest(organizationId: string, limit: number = 5): Promise<CostAnalysisRun[]> {
    return this.withOrgClient(organizationId, async (client) => {
      const result = await client.query(
        `SELECT * FROM cost_analysis_runs WHERE organization_id = $1 ORDER BY created_at DESC LIMIT $2`,
        [organizationId, limit]
      );
      return result.rows;
    });
  }
}
