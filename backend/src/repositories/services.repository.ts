import { pool } from '../config/database';
import { Service, ServiceFilters, CreateServiceRequest, UpdateServiceRequest } from '../types';

export class ServicesRepository {
  async findAll(filters?: ServiceFilters): Promise<{ services: Service[]; total: number }> {
    let query = 'SELECT * FROM services WHERE 1=1';
    const params: any[] = [];
    let paramCount = 0;

    if (filters?.status) {
      paramCount++;
      params.push(filters.status);
      query += ` AND status = $${paramCount}`;
    }

    if (filters?.team_id) {
      paramCount++;
      params.push(filters.team_id);
      query += ` AND team_id = $${paramCount}`;
    }

    if (filters?.template) {
      paramCount++;
      params.push(filters.template);
      query += ` AND template = $${paramCount}`;
    }

    query += ' ORDER BY created_at DESC';

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

    const [servicesResult, countResult] = await Promise.all([
      pool.query(query, params),
      pool.query('SELECT COUNT(*) FROM services')
    ]);

    return {
      services: servicesResult.rows,
      total: parseInt(countResult.rows[0].count)
    };
  }

  async findById(id: string, organizationId: string): Promise<Service | null> {
    const result = await pool.query(
      'SELECT * FROM services WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    return result.rows[0] || null;
  }

  async create(service: CreateServiceRequest, organizationId: string): Promise<Service> {
    const query = `
      INSERT INTO services (name, template, owner, team_id, github_url, description, status, organization_id)
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
      RETURNING *
    `;
    const result = await pool.query(query, [
      service.name,
      service.template,
      service.owner,
      service.team_id,
      service.github_url,
      service.description,
      'active', // default status
      organizationId,
    ]);
    return result.rows[0];
  }

  async update(id: string, updates: UpdateServiceRequest, organizationId: string): Promise<Service | null> {
    const fields: string[] = [];
    const values: any[] = [];
    let paramCount = 0;

    if (updates.name !== undefined) {
      paramCount++;
      fields.push(`name = $${paramCount}`);
      values.push(updates.name);
    }

    if (updates.status !== undefined) {
      paramCount++;
      fields.push(`status = $${paramCount}`);
      values.push(updates.status);
    }

    if (updates.description !== undefined) {
      paramCount++;
      fields.push(`description = $${paramCount}`);
      values.push(updates.description);
    }

    if (updates.github_url !== undefined) {
      paramCount++;
      fields.push(`github_url = $${paramCount}`);
      values.push(updates.github_url);
    }

    if (fields.length === 0) {
      return this.findById(id, organizationId);
    }

    paramCount++;
    fields.push(`updated_at = NOW()`);
    values.push(id);

    paramCount++;
    values.push(organizationId);

    const query = `
      UPDATE services
      SET ${fields.join(', ')}
      WHERE id = $${paramCount - 1} AND organization_id = $${paramCount}
      RETURNING *
    `;

    const result = await pool.query(query, values);
    return result.rows[0] || null;
  }

  async delete(id: string, organizationId: string): Promise<boolean> {
    const result = await pool.query(
      'DELETE FROM services WHERE id = $1 AND organization_id = $2',
      [id, organizationId]
    );
    return result.rowCount ? result.rowCount > 0 : false;
  }
}
