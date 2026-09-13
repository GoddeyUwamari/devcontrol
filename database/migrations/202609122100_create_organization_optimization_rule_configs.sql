-- Migration: 202609122100_create_organization_optimization_rule_configs.sql
-- Description: Creates organization_optimization_rule_configs, the backing table for
--   Enterprise Workstream 3B ("Enterprise Optimization Controls" -- configurable
--   thresholds for supported cost-optimization rules). Consumed by
--   backend/src/services/optimization-rule-config.service.ts (Phase C). Detector
--   wiring (Phase D) is explicitly deferred -- this migration and its consuming
--   service exist, but nothing in the existing optimization scan reads from this
--   table yet as of this commit.
--
--   Scope is deliberately narrow, per the approved 3B plan: exactly two
--   (rule_id, parameter_id) pairs are representable, each with its own numeric
--   range enforced by CHECK constraints, mirroring
--   202608221112_create_custom_anomaly_rules.sql's condition/severity CHECK
--   convention and 202609121200_create_slo_definitions.sql's cross-field
--   pairing-CHECK convention:
--     - ec2_idle / cpu_threshold_percent, range [1, 20] (percent CPU). The
--       existing detector (cost-optimization.service.ts's detectIdleEC2Instances)
--       has always used a bare, unbounded `< 5` literal -- this [1, 20] range is a
--       NEW product constraint introduced by 3B, not something inherited from
--       existing code, which enforced no range at all.
--     - lambda_low_usage / max_invocations, range [0, 1000] (integer invocation
--       count over the existing 30-day evidence window). Same story: the existing
--       detector's LAMBDA_LOW_USAGE_MAX_INVOCATIONS_30D = 10 constant has never
--       been bounded; [0, 1000] is a new product decision.
--     - This is a closed, two-pair set by design (rule_id_check + parameter_id_check
--       + the cross-field rule_parameter_pairing check below) specifically so this
--       table can never represent a rule/parameter combination the application has
--       no detector wired for -- widening it is a deliberate follow-up (Phase D+),
--       not a migration to relax casually.
--
--   organization_id is UUID with a REFERENCES/ON DELETE CASCADE FK and full RLS
--   (isolation + insert policy pair), matching every other org-scoped Enterprise
--   configuration table's convention in this repository -- most directly
--   custom_anomaly_rules and slo_definitions, since this is the same
--   Enterprise-tier per-parameter override shape.
--
--   Deliberately NOT a generic JSON configuration blob, and deliberately NOT one
--   row per rule with a column per parameter: one row per (organization, rule,
--   parameter) tuple keeps the schema typed, gives a single UNIQUE constraint for
--   both "does an override exist" and "prevent duplicates," and requires no schema
--   change to add a third configurable parameter later (just a widened CHECK set),
--   without ever needing an untyped JSON value column.
--
--   Backward compatibility: this migration seeds ZERO rows for existing
--   organizations. Absence of a row IS the "use registry default" state -- see
--   optimization-rule-config.service.ts's resolveEffectiveConfig(). No existing
--   cost_recommendations row is read, modified, or backfilled by this migration.
-- Date: 2026-09-12

CREATE TABLE organization_optimization_rule_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  rule_id VARCHAR(50) NOT NULL CHECK (rule_id IN ('ec2_idle', 'lambda_low_usage')),
  parameter_id VARCHAR(50) NOT NULL CHECK (parameter_id IN ('cpu_threshold_percent', 'max_invocations')),
  value_numeric NUMERIC(7,3) NOT NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Defense in depth: the service layer (optimization-rule-config.service.ts's
  -- validateParameterValue()) is the authoritative validator and is what the API
  -- actually relies on to reject a bad request before it ever reaches the
  -- database -- this constraint exists so a row violating the contract can never
  -- exist even if that application layer were bypassed, not as an independent
  -- second opinion that could disagree with it. Its numbers must stay in sync
  -- with the parameter-definition table in optimization-rules.ts by hand; there
  -- is no code generation linking the two.
  CONSTRAINT org_opt_rule_configs_rule_matches_parameter CHECK (
    (rule_id = 'ec2_idle' AND parameter_id = 'cpu_threshold_percent') OR
    (rule_id = 'lambda_low_usage' AND parameter_id = 'max_invocations')
  ),

  CONSTRAINT org_opt_rule_configs_value_valid CHECK (
    (rule_id = 'ec2_idle' AND value_numeric >= 1 AND value_numeric <= 20) OR
    (rule_id = 'lambda_low_usage' AND value_numeric >= 0 AND value_numeric <= 1000 AND value_numeric = ROUND(value_numeric, 0))
  ),

  CONSTRAINT org_opt_rule_configs_unique_override UNIQUE (organization_id, rule_id, parameter_id)
);

ALTER TABLE organization_optimization_rule_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_opt_rule_configs_isolation_policy ON organization_optimization_rule_configs
  FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));

CREATE POLICY org_opt_rule_configs_insert_policy ON organization_optimization_rule_configs
  FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

GRANT ALL ON TABLE organization_optimization_rule_configs TO devcontrol;

COMMENT ON TABLE organization_optimization_rule_configs IS
  'Enterprise Workstream 3B: per-organization threshold overrides for supported cost-optimization rules (backend/src/services/optimization-rule-config.service.ts). Absence of a row for a given (organization_id, rule_id, parameter_id) means "use the registry default" -- this table is deliberately not seeded for existing organizations. Detector wiring is a separate, later phase (3B Phase D); this table has no effect on the optimization scan until that phase ships.';
COMMENT ON COLUMN organization_optimization_rule_configs.rule_id IS
  'Closed set: ec2_idle | lambda_low_usage. Must match an id in backend/src/config/optimization-rules.ts. Widening requires a new migration, not an application-only change.';
COMMENT ON COLUMN organization_optimization_rule_configs.parameter_id IS
  'Closed set: cpu_threshold_percent (ec2_idle) | max_invocations (lambda_low_usage). Paired with rule_id by org_opt_rule_configs_rule_matches_parameter -- an arbitrary rule/parameter combination cannot be stored.';
COMMENT ON COLUMN organization_optimization_rule_configs.value_numeric IS
  'Range depends on rule_id: ec2_idle in [1, 20] (percent CPU); lambda_low_usage in [0, 1000], integer-valued (invocations per the existing 30-day evidence window). See org_opt_rule_configs_value_valid.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202609122100 completed successfully!';
  RAISE NOTICE 'organization_optimization_rule_configs created with organization_id (UUID, FK, NOT NULL), RLS enabled, and both policies';
END $$;
