/**
 * Live-Postgres coverage for OptimizationRuleConfigService (Enterprise Workstream
 * 3B, Phase C) -- persistence, resolution, validation, and organization isolation
 * for per-organization optimization-rule parameter overrides. Same disposable-schema
 * technique as custom-anomaly-rules.service.test.ts and slo.service.test.ts: a
 * throwaway schema holds a minimal `organizations` fixture and a
 * `organization_optimization_rule_configs` table shaped exactly like the real
 * migration (202609122100_create_organization_optimization_rule_configs.sql),
 * CHECK constraints included, so constraint-violation behavior is exercised for
 * real rather than assumed.
 *
 * Detector wiring (Phase D) is out of scope here -- this file only proves the
 * persistence/resolution layer itself.
 */

import { Pool, Client } from 'pg';
import {
  OptimizationRuleConfigService,
  OptimizationRuleConfigValidationError,
  validateParameterValue,
} from '../optimization-rule-config.service';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const schemaName = `org_opt_rule_configs_test_${Date.now()}`;
let admin: Client;
let pool: Pool;
let orgA: string;
let orgB: string;

beforeAll(async () => {
  admin = new Client(dbConfig());
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  await admin.query(`SET search_path TO ${schemaName}, public`);

  await admin.query(`CREATE TABLE organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR NOT NULL)`);

  // Shaped exactly like 202609122100_create_organization_optimization_rule_configs.sql,
  // CHECK constraints included, so this suite proves the real constraints, not a
  // looser approximation.
  await admin.query(`
    CREATE TABLE organization_optimization_rule_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      rule_id VARCHAR(50) NOT NULL CHECK (rule_id IN ('ec2_idle', 'lambda_low_usage')),
      parameter_id VARCHAR(50) NOT NULL CHECK (parameter_id IN ('cpu_threshold_percent', 'max_invocations')),
      value_numeric NUMERIC(7,3) NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      CONSTRAINT org_opt_rule_configs_rule_matches_parameter CHECK (
        (rule_id = 'ec2_idle' AND parameter_id = 'cpu_threshold_percent') OR
        (rule_id = 'lambda_low_usage' AND parameter_id = 'max_invocations')
      ),
      CONSTRAINT org_opt_rule_configs_value_valid CHECK (
        (rule_id = 'ec2_idle' AND value_numeric >= 1 AND value_numeric <= 20) OR
        (rule_id = 'lambda_low_usage' AND value_numeric >= 0 AND value_numeric <= 1000 AND value_numeric = ROUND(value_numeric, 0))
      ),
      CONSTRAINT org_opt_rule_configs_unique_override UNIQUE (organization_id, rule_id, parameter_id)
    )
  `);

  const orgs = await admin.query(`INSERT INTO organizations (name) VALUES ('org-a'), ('org-b') RETURNING id`);
  orgA = orgs.rows[0].id;
  orgB = orgs.rows[1].id;

  pool = new Pool({ ...dbConfig(), options: `-c search_path=${schemaName},public` });
});

afterEach(async () => {
  await admin.query(`DELETE FROM organization_optimization_rule_configs`);
});

afterAll(async () => {
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end();
  await pool.end();
});

describe('validateParameterValue — pure validation, no DB access', () => {
  it.each([
    ['ec2_idle', 'cpu_threshold_percent', 0],
    ['ec2_idle', 'cpu_threshold_percent', 20.1],
    ['lambda_low_usage', 'max_invocations', -1],
    ['lambda_low_usage', 'max_invocations', 1001],
    ['lambda_low_usage', 'max_invocations', 10.5],
  ])('(1) rejects %s/%s = %s', (ruleId, parameterId, value) => {
    expect(() => validateParameterValue(ruleId, parameterId, value)).toThrow(OptimizationRuleConfigValidationError);
  });

  it.each([
    ['ec2_idle', 'cpu_threshold_percent', 1],
    ['ec2_idle', 'cpu_threshold_percent', 20],
    ['lambda_low_usage', 'max_invocations', 0],
    ['lambda_low_usage', 'max_invocations', 1000],
    ['lambda_low_usage', 'max_invocations', 10],
  ])('(2) accepts %s/%s = %s', (ruleId, parameterId, value) => {
    expect(() => validateParameterValue(ruleId, parameterId, value)).not.toThrow();
  });

  it('(3) rejects an unsupported rule ID', () => {
    expect(() => validateParameterValue('rds_idle', 'cpu_threshold_percent', 5)).toThrow(OptimizationRuleConfigValidationError);
  });

  it('(4) rejects an unsupported parameter ID', () => {
    expect(() => validateParameterValue('ec2_idle', 'unknown_param', 5)).toThrow(OptimizationRuleConfigValidationError);
  });

  it('(5) rejects a mismatched rule/parameter pair', () => {
    expect(() => validateParameterValue('ec2_idle', 'max_invocations', 5)).toThrow(OptimizationRuleConfigValidationError);
    expect(() => validateParameterValue('lambda_low_usage', 'cpu_threshold_percent', 5)).toThrow(OptimizationRuleConfigValidationError);
  });
});

describe('OptimizationRuleConfigService — default resolution (no override)', () => {
  it('(6) EC2 resolves to the registry default of 5 with source "default"', async () => {
    const service = new OptimizationRuleConfigService(pool);
    const effective = await service.resolveEffectiveConfig(orgA, 'ec2_idle', 'cpu_threshold_percent');
    expect(effective).toEqual({ ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 5, source: 'default' });
  });

  it('(7) Lambda resolves to the registry default of 10 with source "default"', async () => {
    const service = new OptimizationRuleConfigService(pool);
    const effective = await service.resolveEffectiveConfig(orgA, 'lambda_low_usage', 'max_invocations');
    expect(effective).toEqual({ ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default' });
  });
});

describe('OptimizationRuleConfigService — override resolution', () => {
  it('(8) a stored EC2 override of 10 resolves to 10 with source "organization_override"', async () => {
    const service = new OptimizationRuleConfigService(pool);
    await service.upsertOverride(orgA, 'ec2_idle', 'cpu_threshold_percent', 10);

    const effective = await service.resolveEffectiveConfig(orgA, 'ec2_idle', 'cpu_threshold_percent');
    expect(effective).toEqual({ ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 10, source: 'organization_override' });
  });

  it('(9) a stored Lambda override of 100 resolves to 100 with source "organization_override"', async () => {
    const service = new OptimizationRuleConfigService(pool);
    await service.upsertOverride(orgA, 'lambda_low_usage', 'max_invocations', 100);

    const effective = await service.resolveEffectiveConfig(orgA, 'lambda_low_usage', 'max_invocations');
    expect(effective).toEqual({ ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 100, source: 'organization_override' });
  });

  it('(10) upsertOverride rejects an out-of-range value before it ever reaches the database', async () => {
    const service = new OptimizationRuleConfigService(pool);
    await expect(service.upsertOverride(orgA, 'ec2_idle', 'cpu_threshold_percent', 25)).rejects.toBeInstanceOf(OptimizationRuleConfigValidationError);
    expect(await service.getOverride(orgA, 'ec2_idle', 'cpu_threshold_percent')).toBeNull();
  });
});

describe('OptimizationRuleConfigService — reset', () => {
  it('(11) deleting an override reverts resolution to the registry default', async () => {
    const service = new OptimizationRuleConfigService(pool);
    await service.upsertOverride(orgA, 'ec2_idle', 'cpu_threshold_percent', 15);
    expect((await service.resolveEffectiveConfig(orgA, 'ec2_idle', 'cpu_threshold_percent')).source).toBe('organization_override');

    await service.deleteOverride(orgA, 'ec2_idle', 'cpu_threshold_percent');

    const effective = await service.resolveEffectiveConfig(orgA, 'ec2_idle', 'cpu_threshold_percent');
    expect(effective).toEqual({ ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 5, source: 'default' });
  });

  it('(12) resetting an already-default parameter (no row exists) is a no-op success, not an error', async () => {
    const service = new OptimizationRuleConfigService(pool);
    await expect(service.deleteOverride(orgA, 'lambda_low_usage', 'max_invocations')).resolves.toBeUndefined();
  });
});

describe('OptimizationRuleConfigService — tenant isolation', () => {
  it('(13) org A\'s override is invisible to org B\'s resolution — org B still gets the default', async () => {
    const service = new OptimizationRuleConfigService(pool);
    await service.upsertOverride(orgA, 'ec2_idle', 'cpu_threshold_percent', 18);

    const orgAEffective = await service.resolveEffectiveConfig(orgA, 'ec2_idle', 'cpu_threshold_percent');
    const orgBEffective = await service.resolveEffectiveConfig(orgB, 'ec2_idle', 'cpu_threshold_percent');

    expect(orgAEffective).toEqual({ ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 18, source: 'organization_override' });
    expect(orgBEffective).toEqual({ ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 5, source: 'default' });
  });

  it('(14) getOverride/getAllOverrides never cross the organization boundary', async () => {
    const service = new OptimizationRuleConfigService(pool);
    await service.upsertOverride(orgA, 'ec2_idle', 'cpu_threshold_percent', 12);
    await service.upsertOverride(orgB, 'lambda_low_usage', 'max_invocations', 200);

    expect(await service.getOverride(orgB, 'ec2_idle', 'cpu_threshold_percent')).toBeNull();
    expect(await service.getOverride(orgA, 'lambda_low_usage', 'max_invocations')).toBeNull();

    const orgAAll = await service.getAllOverrides(orgA);
    const orgBAll = await service.getAllOverrides(orgB);
    expect(orgAAll.map((o) => o.ruleId)).toEqual(['ec2_idle']);
    expect(orgBAll.map((o) => o.ruleId)).toEqual(['lambda_low_usage']);
  });

  it('(15) the DB CHECK constraint itself rejects an out-of-range value even bypassing the service', async () => {
    await expect(
      admin.query(
        `INSERT INTO organization_optimization_rule_configs (organization_id, rule_id, parameter_id, value_numeric) VALUES ($1, 'ec2_idle', 'cpu_threshold_percent', 0)`,
        [orgA]
      )
    ).rejects.toThrow(/org_opt_rule_configs_value_valid/);
  });

  it('(16) the DB CHECK constraint itself rejects a mismatched rule/parameter pair even bypassing the service', async () => {
    await expect(
      admin.query(
        `INSERT INTO organization_optimization_rule_configs (organization_id, rule_id, parameter_id, value_numeric) VALUES ($1, 'ec2_idle', 'max_invocations', 5)`,
        [orgA]
      )
    ).rejects.toThrow(/org_opt_rule_configs_rule_matches_parameter/);
  });

  it('(17) the DB CHECK constraint itself rejects a non-integer Lambda value even bypassing the service', async () => {
    await expect(
      admin.query(
        `INSERT INTO organization_optimization_rule_configs (organization_id, rule_id, parameter_id, value_numeric) VALUES ($1, 'lambda_low_usage', 'max_invocations', 10.5)`,
        [orgA]
      )
    ).rejects.toThrow(/org_opt_rule_configs_value_valid/);
  });
});

describe('OptimizationRuleConfigService — idempotency / upsert', () => {
  it('(18) repeatedly setting the same organization/rule/parameter updates the existing row, never creates duplicates', async () => {
    const service = new OptimizationRuleConfigService(pool);
    await service.upsertOverride(orgA, 'ec2_idle', 'cpu_threshold_percent', 8);
    await service.upsertOverride(orgA, 'ec2_idle', 'cpu_threshold_percent', 12);
    await service.upsertOverride(orgA, 'ec2_idle', 'cpu_threshold_percent', 16);

    const { rows } = await admin.query(
      `SELECT COUNT(*)::int AS count FROM organization_optimization_rule_configs WHERE organization_id = $1 AND rule_id = 'ec2_idle' AND parameter_id = 'cpu_threshold_percent'`,
      [orgA]
    );
    expect(rows[0].count).toBe(1);

    const effective = await service.resolveEffectiveConfig(orgA, 'ec2_idle', 'cpu_threshold_percent');
    expect(effective.value).toBe(16);
  });

  it('(19) upsertOverride updates updated_at on a repeated call', async () => {
    const service = new OptimizationRuleConfigService(pool);
    const first = await service.upsertOverride(orgA, 'lambda_low_usage', 'max_invocations', 50);
    await new Promise((r) => setTimeout(r, 10));
    const second = await service.upsertOverride(orgA, 'lambda_low_usage', 'max_invocations', 75);

    expect(second.id).toBe(first.id);
    expect(second.updatedAt.getTime()).toBeGreaterThan(first.updatedAt.getTime());
  });
});
