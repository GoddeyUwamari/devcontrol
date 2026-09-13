import { Pool } from 'pg';
import { OptimizationRuleParameterDefinition, getOptimizationRuleParameterDefinition } from '../config/optimization-rules';

/**
 * Enterprise Workstream 3B, Phase C: persistence and resolution for
 * per-organization overrides of the two configurable optimization-rule
 * parameters (ec2_idle/cpu_threshold_percent, lambda_low_usage/max_invocations).
 *
 * As of this commit, nothing calls resolveEffectiveConfig() from
 * cost-optimization.service.ts yet -- detector wiring is Phase D, deliberately
 * deferred. This module establishes the durable configuration foundation only.
 *
 * The parameter-definition table in ../config/optimization-rules.ts
 * (OPTIMIZATION_RULE_PARAMETERS) remains the single source of truth for which
 * (ruleId, parameterId) pairs exist, their type, and their numeric bounds --
 * this service never invents or duplicates those numbers; it only reads them
 * to validate and resolve. The database's own CHECK constraints
 * (see 202609122100_create_organization_optimization_rule_configs.sql) mirror
 * the same numbers as defense-in-depth, not as an independent second opinion.
 */

export type ConfigSource = 'default' | 'organization_override';

/**
 * The detector-facing contract. Deliberately minimal: a detector consumes
 * `value` and nothing else -- it must not interpret units, bounds, or any
 * other configuration metadata. `source` exists purely for recommendation
 * provenance (Phase D), not for any decision the detector itself makes.
 */
export interface EffectiveOptimizationRuleConfig {
  ruleId: string;
  parameterId: string;
  value: number;
  source: ConfigSource;
}

export interface OrganizationOptimizationRuleConfig {
  id: string;
  organizationId: string;
  ruleId: string;
  parameterId: string;
  value: number;
  createdAt: Date;
  updatedAt: Date;
}

export class OptimizationRuleConfigValidationError extends Error {}

function mapRow(row: any): OrganizationOptimizationRuleConfig {
  return {
    id: row.id,
    organizationId: row.organization_id,
    ruleId: row.rule_id,
    parameterId: row.parameter_id,
    value: parseFloat(row.value_numeric),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * The single authoritative validator -- the future API layer (Phase F) must
 * call this rather than keeping its own copy of the numeric bounds. Throws
 * OptimizationRuleConfigValidationError on any failure; never returns a
 * partially-valid result. Exported standalone (not just as a private method)
 * so Phase F's route handlers, and this file's own write path, share the
 * exact same check.
 */
export function validateParameterValue(ruleId: string, parameterId: string, value: number): OptimizationRuleParameterDefinition {
  const definition = getOptimizationRuleParameterDefinition(ruleId, parameterId);
  if (!definition) {
    throw new OptimizationRuleConfigValidationError(`Unsupported rule/parameter combination: ${ruleId}/${parameterId}`);
  }
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new OptimizationRuleConfigValidationError(`${parameterId} must be a finite number`);
  }
  if (definition.type === 'integer' && !Number.isInteger(value)) {
    throw new OptimizationRuleConfigValidationError(`${parameterId} must be an integer`);
  }
  if (value < definition.min || value > definition.max) {
    throw new OptimizationRuleConfigValidationError(`${parameterId} must be between ${definition.min} and ${definition.max}`);
  }
  return definition;
}

export class OptimizationRuleConfigService {
  constructor(private pool: Pool) {}

  // ── Persistence ───────────────────────────────────────────────────────────
  // Every query is organization-scoped in the SQL itself (defense in depth on
  // top of RLS's app.current_organization_id session tag), matching
  // custom-anomaly-rules.service.ts / slo.service.ts's convention.

  async getOverride(organizationId: string, ruleId: string, parameterId: string): Promise<OrganizationOptimizationRuleConfig | null> {
    const { rows } = await this.pool.query(
      `SELECT * FROM organization_optimization_rule_configs
       WHERE organization_id = $1 AND rule_id = $2 AND parameter_id = $3`,
      [organizationId, ruleId, parameterId]
    );
    return rows.length > 0 ? mapRow(rows[0]) : null;
  }

  async getAllOverrides(organizationId: string): Promise<OrganizationOptimizationRuleConfig[]> {
    const { rows } = await this.pool.query(
      `SELECT * FROM organization_optimization_rule_configs
       WHERE organization_id = $1
       ORDER BY rule_id, parameter_id`,
      [organizationId]
    );
    return rows.map(mapRow);
  }

  /**
   * Upsert, not separate create/update -- "set this organization's override"
   * is a single idempotent operation from the caller's perspective (API
   * PUT semantics, Phase F), backed by the table's own
   * (organization_id, rule_id, parameter_id) UNIQUE constraint via
   * ON CONFLICT ... DO UPDATE. Repeated calls with the same tuple update the
   * existing row rather than creating duplicates or erroring.
   */
  async upsertOverride(organizationId: string, ruleId: string, parameterId: string, value: number): Promise<OrganizationOptimizationRuleConfig> {
    validateParameterValue(ruleId, parameterId, value);

    const { rows } = await this.pool.query(
      `INSERT INTO organization_optimization_rule_configs (organization_id, rule_id, parameter_id, value_numeric)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (organization_id, rule_id, parameter_id)
       DO UPDATE SET value_numeric = EXCLUDED.value_numeric, updated_at = NOW()
       RETURNING *`,
      [organizationId, ruleId, parameterId, value]
    );
    return mapRow(rows[0]);
  }

  /**
   * Reset = delete the override row, never "store the default value" --
   * keeps the table representing customization only, per the approved
   * design. A reset on an already-default parameter (no row exists) is a
   * no-op success, not an error: the caller asked for "make sure this is at
   * default," which is true either way.
   */
  async deleteOverride(organizationId: string, ruleId: string, parameterId: string): Promise<void> {
    await this.pool.query(
      `DELETE FROM organization_optimization_rule_configs
       WHERE organization_id = $1 AND rule_id = $2 AND parameter_id = $3`,
      [organizationId, ruleId, parameterId]
    );
  }

  // ── Resolution ────────────────────────────────────────────────────────────

  /**
   * registry definition/default -> organization override, if present ->
   * effective typed configuration. No caching (per the approved design --
   * this table is tiny and scans are already infrequent relative to a
   * database read). Not called from inside any detector; Phase D's
   * analyzeAllResources() is expected to call this once per configurable
   * rule at the top of a scan and pass the result down.
   */
  async resolveEffectiveConfig(organizationId: string, ruleId: string, parameterId: string): Promise<EffectiveOptimizationRuleConfig> {
    const definition = getOptimizationRuleParameterDefinition(ruleId, parameterId);
    if (!definition) {
      throw new OptimizationRuleConfigValidationError(`Unsupported rule/parameter combination: ${ruleId}/${parameterId}`);
    }

    const override = await this.getOverride(organizationId, ruleId, parameterId);
    if (!override) {
      return { ruleId, parameterId, value: definition.default, source: 'default' };
    }

    // Defense-in-depth re-validation: an existing row was valid under the
    // bounds in effect when it was written (validateParameterValue() at write
    // time, and the table's own CHECK constraint regardless of write path). If
    // a *future* migration ever tightens these bounds, a pre-existing row
    // could fall outside the new range -- fail safe to the registry default
    // rather than hand a detector a value outside its own documented contract.
    try {
      validateParameterValue(ruleId, parameterId, override.value);
    } catch (err) {
      console.error(
        `[OptimizationRuleConfig] Stored override for org ${organizationId} (${ruleId}/${parameterId}) is out of current bounds -- falling back to default.`,
        err
      );
      return { ruleId, parameterId, value: definition.default, source: 'default' };
    }

    return { ruleId, parameterId, value: override.value, source: 'organization_override' };
  }
}
