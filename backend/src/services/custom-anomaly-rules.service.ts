import { Pool, PoolClient } from 'pg';
import { AnomalyDetection, AnomalySeverity } from '../types/anomaly.types';

export interface CustomAnomalyRule {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  metric: string;
  condition: 'greater_than' | 'less_than' | 'percent_change_up' | 'percent_change_down';
  threshold: number;
  timeWindow: string;
  severity: AnomalySeverity;
  enabled: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface CreateRulePayload {
  name: string;
  description?: string;
  metric: string;
  condition: CustomAnomalyRule['condition'];
  threshold: number;
  timeWindow?: string;
  severity?: AnomalySeverity;
}

export class CustomAnomalyRulesService {
  constructor(private pool: Pool) {}

  // ── CRUD ──────────────────────────────────────────────────────────────────

  async getRules(organizationId: string, client?: PoolClient): Promise<CustomAnomalyRule[]> {
    const result = await (client ?? this.pool).query(
      `SELECT * FROM anomaly_rules
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [organizationId]
    );
    return result.rows.map(this.mapRow);
  }

  async createRule(organizationId: string, payload: CreateRulePayload): Promise<CustomAnomalyRule> {
    const result = await this.pool.query(
      `INSERT INTO anomaly_rules
         (organization_id, name, description, metric, condition, threshold, time_window, severity)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING *`,
      [
        organizationId,
        payload.name,
        payload.description ?? null,
        payload.metric,
        payload.condition,
        payload.threshold,
        payload.timeWindow ?? '1h',
        payload.severity ?? 'warning',
      ]
    );
    return this.mapRow(result.rows[0]);
  }

  async updateRule(id: string, organizationId: string, payload: Partial<CreateRulePayload & { enabled: boolean }>): Promise<CustomAnomalyRule> {
    const fields: string[] = [];
    const values: any[] = [];
    let idx = 1;

    if (payload.name !== undefined)        { fields.push(`name = $${idx++}`);        values.push(payload.name); }
    if (payload.description !== undefined) { fields.push(`description = $${idx++}`); values.push(payload.description); }
    if (payload.metric !== undefined)      { fields.push(`metric = $${idx++}`);      values.push(payload.metric); }
    if (payload.condition !== undefined)   { fields.push(`condition = $${idx++}`);   values.push(payload.condition); }
    if (payload.threshold !== undefined)   { fields.push(`threshold = $${idx++}`);   values.push(payload.threshold); }
    if (payload.timeWindow !== undefined)  { fields.push(`time_window = $${idx++}`); values.push(payload.timeWindow); }
    if (payload.severity !== undefined)    { fields.push(`severity = $${idx++}`);    values.push(payload.severity); }
    if (payload.enabled !== undefined)     { fields.push(`enabled = $${idx++}`);     values.push(payload.enabled); }

    fields.push(`updated_at = NOW()`);
    values.push(id, organizationId);

    const result = await this.pool.query(
      `UPDATE anomaly_rules
       SET ${fields.join(', ')}
       WHERE id = $${idx++} AND organization_id = $${idx++}
       RETURNING *`,
      values
    );

    if (result.rowCount === 0) throw new Error('Rule not found');
    return this.mapRow(result.rows[0]);
  }

  async deleteRule(id: string, organizationId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM anomaly_rules
       WHERE id = $1 AND organization_id = $2`,
      [id, organizationId]
    );
    if (result.rowCount === 0) throw new Error('Rule not found');
  }

  async toggleRule(id: string, organizationId: string, enabled: boolean): Promise<CustomAnomalyRule> {
    return this.updateRule(id, organizationId, { enabled });
  }

  // ── Rule Engine ───────────────────────────────────────────────────────────

  /**
   * Custom rules are not evaluated. Every rule metric ("EC2 CPU Usage",
   * "Total AWS Cost", ...) used to be read from aws_resources.tags -- the
   * resource's own AWS tags, not a measurement -- so a rule either silently
   * never fired or fired on customer-set text. Rules are still stored and
   * managed; evaluation returns only once backed by real measured data.
   */
  async evaluateRules(_organizationId: string, _client?: PoolClient): Promise<AnomalyDetection[]> {
    return [];
  }

  private mapRow(row: any): CustomAnomalyRule {
    return {
      id:             row.id,
      organizationId: row.organization_id,
      name:           row.name,
      description:    row.description ?? undefined,
      metric:         row.metric,
      condition:      row.condition,
      threshold:      parseFloat(row.threshold),
      timeWindow:     row.time_window,
      severity:       row.severity,
      enabled:        row.enabled,
      createdAt:      row.created_at,
      updatedAt:      row.updated_at,
    };
  }
}
