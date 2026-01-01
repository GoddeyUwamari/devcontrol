/**
 * Audit Logger Service
 * Handles querying and retrieving audit logs
 */

import { pool } from '../config/database';

export interface AuditLogFilters {
  organizationId: string;
  userId?: string;
  action?: string;
  resourceType?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

export interface AuditLog {
  id: string;
  organization_id: string;
  user_id: string | null;
  user_email: string | null;
  action: string;
  resource_type: string | null;
  resource_id: string | null;
  ip_address: string;
  user_agent: string;
  metadata: any;
  method?: string;
  path?: string;
  status_code?: number;
  duration_ms?: number;
  error_message?: string;
  created_at: string;
}

export const auditLogger = {
  /**
   * Get audit logs with filters
   */
  async getLogs(filters: AuditLogFilters): Promise<AuditLog[]> {
    const conditions: string[] = ['al.organization_id = $1'];
    const params: any[] = [filters.organizationId];
    let paramIndex = 2;

    // Add optional filters
    if (filters.userId) {
      conditions.push(`al.user_id = $${paramIndex}`);
      params.push(filters.userId);
      paramIndex++;
    }

    if (filters.action) {
      conditions.push(`al.action = $${paramIndex}`);
      params.push(filters.action);
      paramIndex++;
    }

    if (filters.resourceType) {
      conditions.push(`al.resource_type = $${paramIndex}`);
      params.push(filters.resourceType);
      paramIndex++;
    }

    if (filters.startDate) {
      conditions.push(`al.created_at >= $${paramIndex}`);
      params.push(filters.startDate);
      paramIndex++;
    }

    if (filters.endDate) {
      conditions.push(`al.created_at <= $${paramIndex}`);
      params.push(filters.endDate);
      paramIndex++;
    }

    const limit = filters.limit || 100;
    const offset = filters.offset || 0;

    const query = `
      SELECT
        al.id,
        al.organization_id,
        al.user_id,
        u.email as user_email,
        al.action,
        al.resource_type,
        al.resource_id,
        al.ip_address,
        al.user_agent,
        al.metadata,
        al.metadata->>'method' as method,
        al.metadata->>'path' as path,
        (al.metadata->>'statusCode')::int as status_code,
        (al.metadata->>'duration')::int as duration_ms,
        al.metadata->>'errorMessage' as error_message,
        al.created_at
      FROM audit_logs al
      LEFT JOIN users u ON al.user_id = u.id
      WHERE ${conditions.join(' AND ')}
      ORDER BY al.created_at DESC
      LIMIT $${paramIndex} OFFSET $${paramIndex + 1}
    `;

    params.push(limit, offset);

    const result = await pool.query(query, params);
    return result.rows;
  },

  /**
   * Get total count of logs matching filters
   */
  async getCount(filters: AuditLogFilters): Promise<number> {
    const conditions: string[] = ['organization_id = $1'];
    const params: any[] = [filters.organizationId];
    let paramIndex = 2;

    if (filters.userId) {
      conditions.push(`user_id = $${paramIndex}`);
      params.push(filters.userId);
      paramIndex++;
    }

    if (filters.action) {
      conditions.push(`action = $${paramIndex}`);
      params.push(filters.action);
      paramIndex++;
    }

    if (filters.resourceType) {
      conditions.push(`resource_type = $${paramIndex}`);
      params.push(filters.resourceType);
      paramIndex++;
    }

    if (filters.startDate) {
      conditions.push(`created_at >= $${paramIndex}`);
      params.push(filters.startDate);
      paramIndex++;
    }

    if (filters.endDate) {
      conditions.push(`created_at <= $${paramIndex}`);
      params.push(filters.endDate);
      paramIndex++;
    }

    const query = `
      SELECT COUNT(*) as count
      FROM audit_logs
      WHERE ${conditions.join(' AND ')}
    `;

    const result = await pool.query(query, params);
    return parseInt(result.rows[0].count);
  },

  /**
   * Get unique actions for filter dropdown
   */
  async getUniqueActions(organizationId: string): Promise<string[]> {
    const query = `
      SELECT DISTINCT action
      FROM audit_logs
      WHERE organization_id = $1
      ORDER BY action
    `;

    const result = await pool.query(query, [organizationId]);
    return result.rows.map(row => row.action);
  },

  /**
   * Get unique resource types for filter dropdown
   */
  async getUniqueResourceTypes(organizationId: string): Promise<string[]> {
    const query = `
      SELECT DISTINCT resource_type
      FROM audit_logs
      WHERE organization_id = $1
        AND resource_type IS NOT NULL
      ORDER BY resource_type
    `;

    const result = await pool.query(query, [organizationId]);
    return result.rows.map(row => row.resource_type);
  },
};
