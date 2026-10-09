/**
 * Read model for GET /api/services/intelligence.
 *
 * Tenant isolation is enforced twice, independently:
 *   - every statement carries an explicit organization predicate, and every
 *     join carries it on both sides;
 *   - the statements run on a dedicated connection tagged with
 *     app.current_organization_id, so the tables' RLS policies apply to the
 *     application role as well.
 * Neither is relied on alone. The organization id is always the caller's
 * authenticated organization, never a value the client supplied.
 *
 * All statements run in one READ ONLY, REPEATABLE READ transaction: the
 * resources, services, and recommendations describe the same instant, and
 * the database itself refuses any write.
 */
import { PoolClient } from 'pg';
import { pool } from '../config/database';

export interface IntelligenceResourceRow {
  id: string;
  resource_arn: string;
  resource_id: string;
  resource_name: string | null;
  resource_type: string;
  region: string;
  status: string | null;
  /** metadata->>'type': the load balancer kind, which decides whether it is health-checked. */
  metadata_type: string | null;
  compliance_issues: unknown;
  last_synced_at: Date | null;
  /** Set only when the referenced service belongs to the same organization. */
  service_id: string | null;
}

export interface IntelligenceServiceRow {
  id: string;
  name: string;
  description: string | null;
  owner: string | null;
  team_id: string | null;
  team_name: string | null;
}

export interface IntelligenceRecommendationRow {
  id: string;
  resource_id: string;
  resource_type: string;
  issue: string;
  severity: string;
}

export interface IntelligenceDiscoveryJobRow {
  id: string;
  status: string;
  started_at: Date | null;
  completed_at: Date | null;
}

export interface ServicesIntelligenceRows {
  resources: IntelligenceResourceRow[];
  services: IntelligenceServiceRow[];
  recommendations: IntelligenceRecommendationRow[];
  /** aws_accounts.region; null when the organization has no connected account. */
  primaryRegion: string | null;
  hasConnectedAccount: boolean;
  lastDiscoveryJob: IntelligenceDiscoveryJobRow | null;
  inventoryRefreshedAt: Date | null;
}

type Queryable = Pick<PoolClient, 'query'>;

export class ServicesIntelligenceRepository {
  async read(organizationId: string): Promise<ServicesIntelligenceRows> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      try {
        // Transaction-local: gone at COMMIT/ROLLBACK, so nothing outlives this read.
        await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
        const rows = await this.readWith(client, organizationId);
        await client.query('COMMIT');
        return rows;
      } catch (err) {
        // Keep the original error if the rollback itself fails.
        await client.query('ROLLBACK').catch(() => {});
        throw err;
      }
    } finally {
      client.release();
    }
  }

  /**
   * The statements themselves, on a connection the caller has already tagged.
   * Separate from read() so the same SQL can be run under a role that RLS
   * applies to.
   */
  async readWith(executor: Queryable, organizationId: string): Promise<ServicesIntelligenceRows> {
    // Inventory = non-terminated rows (a NULL status is still inventory).
    // service_id comes from the joined service, not the column: a reference
    // to a service outside this organization resolves to NULL, so the
    // resource is reported as unassigned and the foreign id is never read out.
    const resources = await executor.query<IntelligenceResourceRow>(
      `SELECT r.id,
              r.resource_arn,
              r.resource_id,
              r.resource_name,
              r.resource_type,
              r.region,
              r.status,
              r.metadata->>'type' AS metadata_type,
              r.compliance_issues,
              r.last_synced_at,
              s.id AS service_id
         FROM aws_resources r
         LEFT JOIN services s
           ON s.id = r.service_id
          AND s.organization_id = r.organization_id
          AND s.organization_id = $1
        WHERE r.organization_id = $1
          AND r.status IS DISTINCT FROM 'terminated'
        ORDER BY r.resource_type ASC, r.resource_name ASC NULLS LAST, r.resource_id ASC, r.id ASC`,
      [organizationId]
    );

    const services = await executor.query<IntelligenceServiceRow>(
      `SELECT s.id,
              s.name,
              s.description,
              s.owner,
              t.id   AS team_id,
              t.name AS team_name
         FROM services s
         LEFT JOIN teams t
           ON t.id = s.team_id
          AND t.organization_id = s.organization_id
          AND t.organization_id = $1
        WHERE s.organization_id = $1
        ORDER BY LOWER(s.name) ASC, s.id ASC`,
      [organizationId]
    );

    const recommendations = await executor.query<IntelligenceRecommendationRow>(
      `SELECT cr.id, cr.resource_id, cr.resource_type, cr.issue, cr.severity
         FROM cost_recommendations cr
        WHERE cr.organization_id = $1
          AND cr.status = 'ACTIVE'
        ORDER BY cr.id ASC`,
      [organizationId]
    );

    const account = await executor.query<{ region: string | null }>(
      'SELECT region FROM aws_accounts WHERE org_id = $1 LIMIT 1',
      [organizationId]
    );

    const lastJob = await executor.query<IntelligenceDiscoveryJobRow>(
      `SELECT id, status, started_at, completed_at
         FROM resource_discovery_jobs
        WHERE organization_id = $1
        ORDER BY created_at DESC, id DESC
        LIMIT 1`,
      [organizationId]
    );

    // 'completed' is written only when the job recorded no error at all, so
    // every resource step in it succeeded. A 'failed' job may also have
    // refreshed inventory, but its stored error text does not say which steps
    // failed, so it is not counted.
    const refreshed = await executor.query<{ completed_at: Date | null }>(
      `SELECT MAX(completed_at) AS completed_at
         FROM resource_discovery_jobs
        WHERE organization_id = $1
          AND status = 'completed'`,
      [organizationId]
    );

    return {
      resources: resources.rows,
      services: services.rows,
      recommendations: recommendations.rows,
      primaryRegion: account.rows[0]?.region ?? null,
      hasConnectedAccount: account.rows.length > 0,
      lastDiscoveryJob: lastJob.rows[0] ?? null,
      inventoryRefreshedAt: refreshed.rows[0]?.completed_at ?? null,
    };
  }
}
