import { pool } from '../config/database';
import { InfrastructureResource, InfrastructureFilters, CreateInfrastructureRequest, CostBreakdown } from '../types';

export class InfrastructureRepository {
  async findAll(filters?: InfrastructureFilters): Promise<InfrastructureResource[]> {
    let query = `
      SELECT
        i.*,
        s.name as service_name
      FROM infrastructure_resources i
      LEFT JOIN services s ON i.service_id = s.id
      WHERE 1=1
    `;
    const params: any[] = [];
    let paramCount = 0;

    if (filters?.service_id) {
      paramCount++;
      params.push(filters.service_id);
      query += ` AND i.service_id = $${paramCount}`;
    }

    if (filters?.resource_type) {
      paramCount++;
      params.push(filters.resource_type);
      query += ` AND i.resource_type = $${paramCount}`;
    }

    if (filters?.status) {
      paramCount++;
      params.push(filters.status);
      query += ` AND i.status = $${paramCount}`;
    }

    query += ' ORDER BY i.created_at DESC';

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

  async findById(id: string, organizationId: string): Promise<InfrastructureResource | null> {
    const query = `
      SELECT
        i.*,
        s.name as service_name
      FROM infrastructure_resources i
      LEFT JOIN services s ON i.service_id = s.id
      WHERE i.id = $1 AND i.organization_id = $2
    `;
    const result = await pool.query(query, [id, organizationId]);
    return result.rows[0] || null;
  }

  async create(resource: CreateInfrastructureRequest, organizationId: string): Promise<InfrastructureResource> {
    const query = `
      INSERT INTO infrastructure_resources (
        service_id, resource_type, aws_id, aws_region,
        status, cost_per_month, metadata, organization_id
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const result = await pool.query(query, [
      resource.service_id,
      resource.resource_type,
      resource.aws_id,
      resource.aws_region,
      resource.status,
      resource.cost_per_month,
      JSON.stringify(resource.metadata || {}),
      organizationId,
    ]);
    return result.rows[0];
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM infrastructure_resources WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    return result.rowCount ? result.rowCount > 0 : false;
  }

  async getCostBreakdown(organizationId: string): Promise<CostBreakdown> {
    // Total monthly cost
    const totalResult = await pool.query(
      'SELECT COALESCE(SUM(cost_per_month), 0) as total FROM infrastructure_resources WHERE status = $1 AND organization_id = $2',
      ['running', organizationId]
    );

    // Cost by service
    const byServiceResult = await pool.query(
      `SELECT s.name as service_name, COALESCE(SUM(ir.cost_per_month), 0) as cost
       FROM services s
       LEFT JOIN infrastructure_resources ir ON s.id = ir.service_id AND ir.status = 'running' AND ir.organization_id = $1
       WHERE s.organization_id = $1
       GROUP BY s.id, s.name
       ORDER BY cost DESC`,
      [organizationId]
    );

    // Cost by resource type
    const byResourceTypeResult = await pool.query(
      `SELECT resource_type, COALESCE(SUM(cost_per_month), 0) as cost
       FROM infrastructure_resources
       WHERE status = 'running' AND organization_id = $1
       GROUP BY resource_type
       ORDER BY cost DESC`,
      [organizationId]
    );

    // Cost by team
    const byTeamResult = await pool.query(
      `SELECT t.name as team_name, COALESCE(SUM(ir.cost_per_month), 0) as cost
       FROM teams t
       LEFT JOIN services s ON t.id = s.team_id AND s.organization_id = $1
       LEFT JOIN infrastructure_resources ir ON s.id = ir.service_id AND ir.status = 'running' AND ir.organization_id = $1
       WHERE t.organization_id = $1
       GROUP BY t.id, t.name
       ORDER BY cost DESC`,
      [organizationId]
    );

    return {
      total_monthly_cost: parseFloat(totalResult.rows[0].total),
      by_service: byServiceResult.rows.map(row => ({
        service_name: row.service_name,
        cost: parseFloat(row.cost)
      })),
      by_resource_type: byResourceTypeResult.rows.map(row => ({
        resource_type: row.resource_type,
        cost: parseFloat(row.cost)
      })),
      by_team: byTeamResult.rows.map(row => ({
        team_name: row.team_name,
        cost: parseFloat(row.cost)
      }))
    };
  }

  async getTotalMonthlyCost(): Promise<number> {
    const result = await pool.query(
      'SELECT COALESCE(SUM(cost_per_month), 0) as total FROM infrastructure_resources WHERE status = $1',
      ['running']
    );
    return parseFloat(result.rows[0].total);
  }
}
