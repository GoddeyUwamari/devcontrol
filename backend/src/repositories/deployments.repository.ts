import { PoolClient } from 'pg';
import { pool } from '../config/database';
import { Deployment, DeploymentFilters, CreateDeploymentRequest } from '../types';
import { DEFAULT_PAGE_SIZE, STATS_WINDOW_DAYS } from '../services/deployment-status';

export class DeploymentsRepository {
  // One organization's deployments, newest first, one page at a time. The
  // total is counted with the same predicates as the page, so it always
  // matches what the filters select. date_range is by deployed_at, the same
  // window GET /api/deployments/stats counts over.
  async findAll(filters: DeploymentFilters | undefined, organizationId: string): Promise<{ deployments: Deployment[]; total: number }> {
    const where: string[] = ['d.organization_id = $1'];
    const params: any[] = [organizationId];

    if (filters?.service_id) {
      params.push(filters.service_id);
      where.push(`d.service_id = $${params.length}`);
    }

    if (filters?.environment) {
      params.push(filters.environment);
      where.push(`d.environment = $${params.length}`);
    }

    if (filters?.status) {
      params.push(filters.status);
      where.push(`d.status = $${params.length}`);
    }

    if (filters?.date_range) {
      params.push(STATS_WINDOW_DAYS[filters.date_range]);
      where.push(`d.deployed_at >= NOW() - make_interval(days => $${params.length})`);
    }

    const whereSql = where.join(' AND ');
    const limit = filters?.limit ?? DEFAULT_PAGE_SIZE;
    const offset = filters?.offset ?? 0;

    const [deploymentsResult, countResult] = await Promise.all([
      pool.query(
        `SELECT
           d.*,
           s.name as service_name
         FROM deployments d
         LEFT JOIN services s ON d.service_id = s.id
         WHERE ${whereSql}
         ORDER BY d.deployed_at DESC NULLS LAST, d.id DESC
         LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset]
      ),
      pool.query(`SELECT COUNT(*) FROM deployments d WHERE ${whereSql}`, params),
    ]);

    return {
      deployments: deploymentsResult.rows,
      total: parseInt(countResult.rows[0].count)
    };
  }

  async findById(id: string, organizationId: string): Promise<Deployment | null> {
    const query = `
      SELECT
        d.*,
        s.name as service_name
      FROM deployments d
      LEFT JOIN services s ON d.service_id = s.id
      WHERE d.id = $1 AND d.organization_id = $2
    `;
    const result = await pool.query(query, [id, organizationId]);
    return result.rows[0] || null;
  }

  // Inserts only when the referenced service belongs to the deployment's own
  // organization -- checked and row-locked in the same statement as the
  // insert, so the service can't be deleted or moved in between. Returns null
  // when it doesn't (missing, another organization's, or no organization
  // given); callers must not distinguish those cases to the client.
  //
  // Nothing records a cost today: an absent cost_estimate is stored as NULL
  // (not recorded), never as 0.00.
  async create(deployment: CreateDeploymentRequest): Promise<Deployment | null> {
    const query = `
      INSERT INTO deployments (
        service_id, environment, aws_region, status,
        cost_estimate, deployed_by, resources, metadata,
        organization_id, deployed_at
      )
      SELECT
        s.id, $2::varchar, $3::varchar, $4::varchar,
        $5::numeric, $6::varchar, $7::jsonb, $8::jsonb,
        s.organization_id, COALESCE($10::timestamptz, NOW())
      FROM services s
      WHERE s.id = $1::uuid AND s.organization_id = $9::uuid
      FOR SHARE OF s
      RETURNING *
    `;
    const result = await pool.query(query, [
      deployment.service_id,
      deployment.environment,
      deployment.aws_region,
      deployment.status,
      deployment.cost_estimate ?? null,
      deployment.deployed_by,
      JSON.stringify(deployment.resources || {}),
      JSON.stringify(deployment.metadata || {}),
      deployment.organization_id || null,
      deployment.deployed_at || null,
    ]);
    return result.rows[0] || null;
  }

  async findByMetadataField(key: string, value: string, organizationId: string): Promise<Deployment | null> {
    const result = await pool.query(
      `SELECT * FROM deployments WHERE organization_id = $3 AND metadata ->> $1 = $2 LIMIT 1`,
      [key, value, organizationId]
    );
    return result.rows[0] || null;
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM deployments WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async findRecentByLimit(organizationId: string, limit: number): Promise<Deployment[]> {
    const query = `
      SELECT
        d.*,
        s.name as service_name
      FROM deployments d
      LEFT JOIN services s ON d.service_id = s.id
      WHERE d.organization_id = $1
      ORDER BY d.deployed_at DESC
      LIMIT $2
    `;
    const result = await pool.query(query, [organizationId, limit]);
    return result.rows;
  }

  async countByStatus(organizationId: string, status: string): Promise<number> {
    const result = await pool.query(
      'SELECT COUNT(*) FROM deployments WHERE organization_id = $1 AND status = $2',
      [organizationId, status]
    );
    return parseInt(result.rows[0].count);
  }
}

/** The two unique deployment keys a pipeline row carries (admin migration 202611201200). */
export type PipelineDeploymentKey = 'github_job_id' | 'github_deployment_id';

export interface PipelineDeploymentInsert {
  organizationId: string;
  serviceId: string;
  environment: string;
  awsRegion: string | null;
  status: 'success' | 'failed';
  deployedBy: string;
  deployedAt: string;
  metadata: Record<string, unknown>;
}

/**
 * Inserts a GitHub App deployment row on the caller's tenant-tagged client
 * (D8a-2). Same guard as DeploymentsRepository.create: the service must be
 * the organization's, checked and row-locked in the same statement. A row
 * that already exists for the same job or deployment id is left alone (the
 * partial unique indexes). Returns the new id, or null when nothing was
 * inserted (service missing, or already recorded: the caller tells them apart).
 * cost_estimate stays NULL: nothing recorded a cost.
 */
export async function insertPipelineDeployment(client: PoolClient, row: PipelineDeploymentInsert): Promise<string | null> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO deployments (service_id, environment, aws_region, status, cost_estimate, deployed_by, resources, metadata, organization_id, deployed_at)
     SELECT s.id, $2::varchar, $3::varchar, $4::varchar, NULL, $5::varchar, '{}'::jsonb, $6::jsonb, s.organization_id, $8::timestamptz
       FROM services s
      WHERE s.id = $1::uuid AND s.organization_id = $7::uuid
        FOR SHARE OF s
     ON CONFLICT DO NOTHING
     RETURNING id::text AS id`,
    [row.serviceId, row.environment, row.awsRegion, row.status, row.deployedBy.slice(0, 255), JSON.stringify(row.metadata),
      row.organizationId, row.deployedAt]
  );
  return rows[0]?.id ?? null;
}

export interface PipelineDeploymentRef {
  id: string;
  status: string;
}

/** The organization's deployment row carrying this job or deployment id (its id and status), or null. */
export async function findPipelineDeployment(
  client: PoolClient,
  organizationId: string,
  key: PipelineDeploymentKey,
  value: number
): Promise<PipelineDeploymentRef | null> {
  // The predicate repeats the partial index's own (metadata ? key) so the index applies.
  const { rows } = await client.query<PipelineDeploymentRef>(
    key === 'github_job_id'
      ? `SELECT id::text AS id, status FROM deployments
          WHERE organization_id = $1 AND metadata ? 'github_job_id' AND metadata ->> 'github_job_id' = $2 LIMIT 1`
      : `SELECT id::text AS id, status FROM deployments
          WHERE organization_id = $1 AND metadata ? 'github_deployment_id' AND metadata ->> 'github_deployment_id' = $2 LIMIT 1`,
    [organizationId, String(value)]
  );
  return rows[0] ?? null;
}

/**
 * Deployments the organization has in the calendar month of `at` (ruling Q10):
 * the same predicate shape as the quota count in subscription.middleware.ts,
 * anchored on the row's own month so a replay into a past month counts there.
 */
export async function countDeploymentsInMonthOf(client: PoolClient, organizationId: string, at: string): Promise<number> {
  const { rows } = await client.query<{ n: string }>(
    `SELECT COUNT(*) AS n FROM deployments
      WHERE organization_id = $1
        AND deployed_at >= date_trunc('month', $2::timestamptz)
        AND deployed_at < date_trunc('month', $2::timestamptz) + interval '1 month'`,
    [organizationId, at]
  );
  return parseInt(rows[0].n, 10);
}
