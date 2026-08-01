import { pool } from '../config/database';
import { Deployment, DeploymentFilters, CreateDeploymentRequest } from '../types';

export class DeploymentsRepository {
  async findAll(filters: DeploymentFilters | undefined, organizationId: string): Promise<{ deployments: Deployment[]; total: number }> {
    let query = `
      SELECT
        d.*,
        s.name as service_name
      FROM deployments d
      LEFT JOIN services s ON d.service_id = s.id
      WHERE d.organization_id = $1
    `;
    const params: any[] = [organizationId];
    let paramCount = 1;

    if (filters?.service_id) {
      paramCount++;
      params.push(filters.service_id);
      query += ` AND d.service_id = $${paramCount}`;
    }

    if (filters?.environment) {
      paramCount++;
      params.push(filters.environment);
      query += ` AND d.environment = $${paramCount}`;
    }

    if (filters?.status) {
      paramCount++;
      params.push(filters.status);
      query += ` AND d.status = $${paramCount}`;
    }

    query += ' ORDER BY d.deployed_at DESC';

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

    const [deploymentsResult, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query('SELECT COUNT(*) FROM deployments WHERE organization_id = $1', [organizationId])
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

  async create(deployment: CreateDeploymentRequest): Promise<Deployment> {
    const query = `
      INSERT INTO deployments (
        service_id, environment, aws_region, status,
        cost_estimate, deployed_by, resources, metadata,
        organization_id, deployed_at
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, COALESCE($10, NOW()))
      RETURNING *
    `;
    const result = await pool.query(query, [
      deployment.service_id,
      deployment.environment,
      deployment.aws_region,
      deployment.status,
      deployment.cost_estimate || 0.00,
      deployment.deployed_by,
      JSON.stringify(deployment.resources || {}),
      JSON.stringify(deployment.metadata || {}),
      deployment.organization_id || null,
      deployment.deployed_at || null,
    ]);
    return result.rows[0];
  }

  async findByMetadataField(key: string, value: string): Promise<Deployment | null> {
    const result = await pool.query(
      `SELECT * FROM deployments WHERE metadata ->> $1 = $2 LIMIT 1`,
      [key, value]
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
