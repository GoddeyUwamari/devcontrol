import { Pool } from 'pg';
import { v4 as uuidv4 } from 'uuid';
import { AnomalyDetection, AnomalyType, AnomalySeverity } from '../types/anomaly.types';

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

  async getRules(organizationId: string): Promise<CustomAnomalyRule[]> {
    const result = await this.pool.query(
      `SELECT * FROM custom_anomaly_rules
       WHERE organization_id = $1
       ORDER BY created_at DESC`,
      [organizationId]
    );
    return result.rows.map(this.mapRow);
  }

  async createRule(organizationId: string, payload: CreateRulePayload): Promise<CustomAnomalyRule> {
    const result = await this.pool.query(
      `INSERT INTO custom_anomaly_rules
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

    if (payload.name !== undefined)        { fields.push(`name = ${idx++}`);        values.push(payload.name); }
    if (payload.description !== undefined) { fields.push(`description = ${idx++}`); values.push(payload.description); }
    if (payload.metric !== undefined)      { fields.push(`metric = ${idx++}`);      values.push(payload.metric); }
    if (payload.condition !== undefined)   { fields.push(`condition = ${idx++}`);   values.push(payload.condition); }
    if (payload.threshold !== undefined)   { fields.push(`threshold = ${idx++}`);   values.push(payload.threshold); }
    if (payload.timeWindow !== undefined)  { fields.push(`time_window = ${idx++}`); values.push(payload.timeWindow); }
    if (payload.severity !== undefined)    { fields.push(`severity = ${idx++}`);    values.push(payload.severity); }
    if (payload.enabled !== undefined)     { fields.push(`enabled = ${idx++}`);     values.push(payload.enabled); }

    fields.push(`updated_at = NOW()`);
    values.push(id, organizationId);

    const result = await this.pool.query(
      `UPDATE custom_anomaly_rules
       SET ${fields.join(', ')}
       WHERE id = ${idx++} AND organization_id = ${idx++}
       RETURNING *`,
      values
    );

    if (result.rowCount === 0) throw new Error('Rule not found');
    return this.mapRow(result.rows[0]);
  }

  async deleteRule(id: string, organizationId: string): Promise<void> {
    const result = await this.pool.query(
      `DELETE FROM custom_anomaly_rules
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
   * Run all enabled custom rules for an org against current AWS metrics.
   * Returns AnomalyDetection[] in the same shape as the statistical detectors
   * so the AI enrichment layer treats them identically.
   */
  async evaluateRules(organizationId: string): Promise<AnomalyDetection[]> {
    const rules = await this.getRules(organizationId);
    const enabled = rules.filter(r => r.enabled);
    if (enabled.length === 0) return [];

    const anomalies: AnomalyDetection[] = [];

    for (const rule of enabled) {
      try {
        const result = await this.evaluateSingleRule(organizationId, rule);
        if (result) anomalies.push(result);
      } catch (err) {
        console.error(`[Custom Rules] Error evaluating rule ${rule.id}:`, err);
      }
    }

    return anomalies;
  }

  private async evaluateSingleRule(
    organizationId: string,
    rule: CustomAnomalyRule
  ): Promise<AnomalyDetection | null> {
    // Fetch current metric value from aws_resources tags
    const currentResult = await this.pool.query(
      `SELECT AVG((tags->$1)::numeric) as current_value
       FROM aws_resources
       WHERE organization_id = $2
         AND tags ? $1
         AND (tags->$1) ~ '^[0-9]+(\.[0-9]+)?`,
      [rule.metric, organizationId]
    );

    const currentValue = parseFloat(currentResult.rows[0]?.current_value ?? '0');
    if (currentValue === 0) return null;

    // Fetch historical average for the time window
    const historicalResult = await this.pool.query(
      `SELECT AVG((tags->$1)::numeric) as historical_avg,
              STDDEV((tags->$1)::numeric) as historical_std
       FROM aws_resources
       WHERE organization_id = $2
         AND tags ? $1
         AND (tags->$1) ~ '^[0-9]+(\.[0-9]+)?
         AND created_at > NOW() - INTERVAL '30 days'`,
      [rule.metric, organizationId]
    );

    const historicalAvg = parseFloat(historicalResult.rows[0]?.historical_avg ?? '0');
    const historicalStd = parseFloat(historicalResult.rows[0]?.historical_std ?? '0');

    // Evaluate condition
    let triggered = false;
    let deviation = 0;

    switch (rule.condition) {
      case 'greater_than':
        triggered = currentValue > rule.threshold;
        deviation = historicalAvg > 0 ? ((currentValue - historicalAvg) / historicalAvg) * 100 : 0;
        break;
      case 'less_than':
        triggered = currentValue < rule.threshold;
        deviation = historicalAvg > 0 ? ((historicalAvg - currentValue) / historicalAvg) * 100 : 0;
        break;
      case 'percent_change_up':
        deviation = historicalAvg > 0 ? ((currentValue - historicalAvg) / historicalAvg) * 100 : 0;
        triggered = deviation > rule.threshold;
        break;
      case 'percent_change_down':
        deviation = historicalAvg > 0 ? ((historicalAvg - currentValue) / historicalAvg) * 100 : 0;
        triggered = deviation > rule.threshold;
        break;
    }

    if (!triggered) return null;

    // Map metric to anomaly type
    const typeMap: Record<string, AnomalyType> = {
      cost:         'cost_spike',
      cpu:          'cpu_spike',
      memory:       'memory_spike',
      error_rate:   'error_rate_spike',
      invocations:  'invocation_spike',
    };
    const anomalyType: AnomalyType = typeMap[rule.metric] ?? 'cost_spike';

    return {
      id:               uuidv4(),
      organizationId,
      type:             anomalyType,
      severity:         rule.severity,
      metric:           rule.metric,
      currentValue,
      expectedValue:    rule.threshold,
      deviation,
      historicalAverage: historicalAvg,
      historicalStdDev:  historicalStd,
      confidence:       75,
      title:            `Custom Rule: ${rule.name}`,
      description:      `${rule.metric} ${rule.condition.replace(/_/g, ' ')} threshold of ${rule.threshold}`,
      aiExplanation:    '',
      impact:           '',
      recommendation:   '',
      detectedAt:       new Date(),
      timeWindow:       rule.timeWindow,
      status:           'active',
    };
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
