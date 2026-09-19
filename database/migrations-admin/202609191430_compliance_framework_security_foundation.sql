-- Migration: 202609191430_compliance_framework_security_foundation.sql
-- Description: Phase 1 security foundation for Custom Compliance Frameworks
--   V1 (see the read-only audit this PR implements: "SECURITY FOUNDATION
--   REQUIRED BEFORE V1"). Closes the database-level gaps identified there:
--
--     1. compliance_frameworks, compliance_framework_rules, compliance_scans,
--        and compliance_scan_findings had no Row-Level Security at all --
--        isolation was application-layer organization_id filtering only.
--     2. compliance_framework_rules and compliance_scan_findings had no
--        organization_id column of their own, so RLS could not be applied to
--        them directly.
--     3. Nothing at the database level prevented a rule or finding from
--        legally claiming a different organization_id than its parent
--        framework/scan.
--     4. compliance_framework_rules.rule_type's CHECK constraint still
--        advertised 'custom_script' (unsandboxed `new Function(...)`
--        execution, removed in this same PR at the application layer) and
--        'relationship_check' (never implemented by the evaluator) as
--        accepted values.
--
--   This migration is purely additive/narrowing to schema and policy -- it
--   creates no new table, and (per the Step 0 guard below) refuses outright
--   rather than deleting or rewriting any row if production ever contains
--   data outside what it assumes. As of the read-only audit immediately
--   preceding this PR, all four tables have zero rows in production, but
--   this migration does not trust that assumption blindly -- see Step 0.
--
-- ADMINISTRATIVE MIGRATION -- see database/migrations-admin/README.md.
--
-- All four tables are confirmed postgres-owned in production (direct
-- pg_class / pg_get_userbyid query, 2026-09-19):
--
--   compliance_frameworks        | postgres | relrowsecurity=f | relforcerowsecurity=f
--   compliance_framework_rules   | postgres | relrowsecurity=f | relforcerowsecurity=f
--   compliance_scans             | postgres | relrowsecurity=f | relforcerowsecurity=f
--   compliance_scan_findings     | postgres | relrowsecurity=f | relforcerowsecurity=f
--
-- while the application's connecting role, devcontrol, is confirmed
-- non-superuser and non-owner. This is exactly why this file lives here
-- rather than in database/migrations/: devcontrol cannot ALTER TABLE, ADD
-- CONSTRAINT, ENABLE ROW LEVEL SECURITY, or CREATE POLICY against a table it
-- doesn't own (PostgreSQL 42501). It is also exactly why plain
-- ENABLE ROW LEVEL SECURITY (without FORCE ROW LEVEL SECURITY) is sufficient
-- here for genuine enforcement: FORCE ROW LEVEL SECURITY only changes
-- behavior for the owning role's own queries, and the application never
-- connects as the owner. See 202608221231_enable_rls_on_anomaly_rules.sql for
-- the identical reasoning, already established and precedented in this
-- codebase.
--
-- Application RLS context requires NO code change: compliance-frameworks.
-- routes.ts already gates every route behind authenticateToken
-- (backend/src/middleware/auth.middleware.ts), which already checks out a
-- dedicated client, runs `SELECT set_config('app.current_organization_id',
-- $1, false)` on it, and threads it through AsyncLocalStorage
-- (requestContext) so every `pool.query(...)` call anywhere in the request
-- -- including every method in ComplianceFrameworksRepository and
-- CustomComplianceService, both of which already call `this.pool.query(...)`
-- exclusively -- automatically runs on that exact, correctly-tagged
-- connection. This is the same mechanism every other RLS-protected table in
-- this codebase already relies on.
--
-- Execution:
--   cd /opt/devcontrol-admin
--   DB_USER=postgres DB_HOST=/var/run/postgresql \
--   node database/migrate.js --execute-only 202609191430_compliance_framework_security_foundation.sql
--
-- Do NOT run this migration via the generic --pending mode -- every
-- administrative migration requires its own separate, explicit execution
-- authorization; see database/migrations-admin/README.md.
-- Date: 2026-09-19

-- ==========================================================================
-- Step 0: Safety guards. Refuse rather than silently delete or rewrite data.
-- ==========================================================================
DO $$
DECLARE
  unsupported_rule_count INT;
BEGIN
  IF to_regclass('compliance_frameworks') IS NULL THEN
    RAISE EXCEPTION 'compliance_frameworks does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('compliance_framework_rules') IS NULL THEN
    RAISE EXCEPTION 'compliance_framework_rules does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('compliance_scans') IS NULL THEN
    RAISE EXCEPTION 'compliance_scans does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('compliance_scan_findings') IS NULL THEN
    RAISE EXCEPTION 'compliance_scan_findings does not exist -- refusing to proceed.';
  END IF;

  SELECT COUNT(*) INTO unsupported_rule_count
  FROM compliance_framework_rules
  WHERE rule_type NOT IN ('property_check', 'tag_required', 'tag_pattern', 'metadata_check');

  IF unsupported_rule_count > 0 THEN
    RAISE EXCEPTION
      'Found % existing compliance_framework_rules row(s) using a rule_type outside the V1 '
      'vocabulary (property_check/tag_required/tag_pattern/metadata_check) -- refusing to '
      'narrow the rule_type CHECK constraint or proceed further. Investigate these rows '
      '(they are not deleted or modified by this failed run) before re-running.',
      unsupported_rule_count;
  END IF;
END $$;

-- ==========================================================================
-- Step 1: Add organization_id to the two child tables that lack one,
-- backfilled from their parent. NOT NULL is only enforced after confirming
-- (in the same run) that the backfill left no row unresolved.
-- ==========================================================================
ALTER TABLE compliance_framework_rules
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE compliance_framework_rules r
SET organization_id = f.organization_id
FROM compliance_frameworks f
WHERE r.framework_id = f.id AND r.organization_id IS NULL;

DO $$
DECLARE
  orphaned_count INT;
BEGIN
  SELECT COUNT(*) INTO orphaned_count FROM compliance_framework_rules WHERE organization_id IS NULL;
  IF orphaned_count > 0 THEN
    RAISE EXCEPTION
      'Found % compliance_framework_rules row(s) whose framework_id does not resolve to any '
      'compliance_frameworks row -- cannot safely backfill organization_id, and refusing to '
      'enforce NOT NULL while orphaned rows exist. Investigate before re-running.',
      orphaned_count;
  END IF;
END $$;

ALTER TABLE compliance_framework_rules
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_compliance_framework_rules_org ON compliance_framework_rules(organization_id);

ALTER TABLE compliance_scan_findings
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

UPDATE compliance_scan_findings sf
SET organization_id = s.organization_id
FROM compliance_scans s
WHERE sf.scan_id = s.id AND sf.organization_id IS NULL;

DO $$
DECLARE
  orphaned_count INT;
BEGIN
  SELECT COUNT(*) INTO orphaned_count FROM compliance_scan_findings WHERE organization_id IS NULL;
  IF orphaned_count > 0 THEN
    RAISE EXCEPTION
      'Found % compliance_scan_findings row(s) whose scan_id does not resolve to any '
      'compliance_scans row -- cannot safely backfill organization_id, and refusing to '
      'enforce NOT NULL while orphaned rows exist. Investigate before re-running.',
      orphaned_count;
  END IF;
END $$;

ALTER TABLE compliance_scan_findings
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_compliance_scan_findings_org ON compliance_scan_findings(organization_id);

-- ==========================================================================
-- Step 2: DB-enforced parent/child organization consistency. A unique
-- constraint on the parent's (id, organization_id) lets a composite foreign
-- key from the child require that exact pair to exist -- so a rule, scan, or
-- finding can never legally claim an organization_id different from its
-- parent's, enforced by PostgreSQL itself rather than trusted application
-- code. This replaces each single-column framework_id/scan_id foreign key
-- with the equivalent composite one; nothing about the referenced columns'
-- own meaning changes, and ON DELETE CASCADE is preserved exactly.
-- ==========================================================================
-- Every pg_constraint/pg_policies existence check in this migration is
-- scoped by conrelid/schemaname (via regclass, which resolves through the
-- active search_path) rather than by name alone: constraint and policy
-- names are only unique per-table, not database-wide, so a name-only check
-- would find a same-named object on an unrelated table in a different
-- schema and wrongly skip creating this one -- harmless in production
-- (exactly one schema ever exists there) but a real false-idempotency risk
-- anywhere multiple schemas coexist (this migration's own isolated-schema
-- test suite, for one).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compliance_frameworks_id_org_unique' AND conrelid = 'compliance_frameworks'::regclass
  ) THEN
    ALTER TABLE compliance_frameworks
      ADD CONSTRAINT compliance_frameworks_id_org_unique UNIQUE (id, organization_id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compliance_scans_id_org_unique' AND conrelid = 'compliance_scans'::regclass
  ) THEN
    ALTER TABLE compliance_scans
      ADD CONSTRAINT compliance_scans_id_org_unique UNIQUE (id, organization_id);
  END IF;
END $$;

ALTER TABLE compliance_framework_rules
  DROP CONSTRAINT IF EXISTS compliance_framework_rules_framework_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compliance_framework_rules_framework_org_fkey' AND conrelid = 'compliance_framework_rules'::regclass
  ) THEN
    ALTER TABLE compliance_framework_rules
      ADD CONSTRAINT compliance_framework_rules_framework_org_fkey
      FOREIGN KEY (framework_id, organization_id)
      REFERENCES compliance_frameworks (id, organization_id)
      ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE compliance_scans
  DROP CONSTRAINT IF EXISTS compliance_scans_framework_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compliance_scans_framework_org_fkey' AND conrelid = 'compliance_scans'::regclass
  ) THEN
    ALTER TABLE compliance_scans
      ADD CONSTRAINT compliance_scans_framework_org_fkey
      FOREIGN KEY (framework_id, organization_id)
      REFERENCES compliance_frameworks (id, organization_id)
      ON DELETE CASCADE;
  END IF;
END $$;

ALTER TABLE compliance_scan_findings
  DROP CONSTRAINT IF EXISTS compliance_scan_findings_scan_id_fkey;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'compliance_scan_findings_scan_org_fkey' AND conrelid = 'compliance_scan_findings'::regclass
  ) THEN
    ALTER TABLE compliance_scan_findings
      ADD CONSTRAINT compliance_scan_findings_scan_org_fkey
      FOREIGN KEY (scan_id, organization_id)
      REFERENCES compliance_scans (id, organization_id)
      ON DELETE CASCADE;
  END IF;
END $$;

-- ==========================================================================
-- Step 3: Narrow rule_type to the V1 vocabulary. Step 0 above already
-- proved zero existing rows use either excluded value, in this run.
-- ==========================================================================
ALTER TABLE compliance_framework_rules
  DROP CONSTRAINT IF EXISTS compliance_framework_rules_rule_type_check;

ALTER TABLE compliance_framework_rules
  ADD CONSTRAINT compliance_framework_rules_rule_type_check
  CHECK (rule_type IN ('property_check', 'tag_required', 'tag_pattern', 'metadata_check'));

-- ==========================================================================
-- Step 4: Enable RLS and add isolation/insert policies on all four tables,
-- matching this codebase's established convention exactly (see
-- 202609141500_create_security_hub_foundation_tables.sql).
-- ==========================================================================
-- pg_policies.tablename/policyname are also not schema-qualified by
-- themselves -- every check below adds "AND schemaname = current_schema()"
-- for the same reason the pg_constraint checks above are scoped by conrelid.
ALTER TABLE compliance_frameworks ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'compliance_frameworks' AND policyname = 'compliance_frameworks_isolation_policy') THEN
    CREATE POLICY compliance_frameworks_isolation_policy ON compliance_frameworks
      FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'compliance_frameworks' AND policyname = 'compliance_frameworks_insert_policy') THEN
    CREATE POLICY compliance_frameworks_insert_policy ON compliance_frameworks
      FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
END $$;

ALTER TABLE compliance_framework_rules ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'compliance_framework_rules' AND policyname = 'compliance_framework_rules_isolation_policy') THEN
    CREATE POLICY compliance_framework_rules_isolation_policy ON compliance_framework_rules
      FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'compliance_framework_rules' AND policyname = 'compliance_framework_rules_insert_policy') THEN
    CREATE POLICY compliance_framework_rules_insert_policy ON compliance_framework_rules
      FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
END $$;

ALTER TABLE compliance_scans ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'compliance_scans' AND policyname = 'compliance_scans_isolation_policy') THEN
    CREATE POLICY compliance_scans_isolation_policy ON compliance_scans
      FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'compliance_scans' AND policyname = 'compliance_scans_insert_policy') THEN
    CREATE POLICY compliance_scans_insert_policy ON compliance_scans
      FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
END $$;

ALTER TABLE compliance_scan_findings ENABLE ROW LEVEL SECURITY;
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'compliance_scan_findings' AND policyname = 'compliance_scan_findings_isolation_policy') THEN
    CREATE POLICY compliance_scan_findings_isolation_policy ON compliance_scan_findings
      FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = current_schema() AND tablename = 'compliance_scan_findings' AND policyname = 'compliance_scan_findings_insert_policy') THEN
    CREATE POLICY compliance_scan_findings_insert_policy ON compliance_scan_findings
      FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
END $$;

-- Re-states grants devcontrol already holds on all four tables (confirmed via
-- information_schema.table_privileges, 2026-09-19: INSERT/SELECT/UPDATE/
-- DELETE/TRUNCATE/REFERENCES/TRIGGER already present on every one) -- this
-- does not broaden anything, it documents the expected grant set explicitly,
-- matching this codebase's established convention for every RLS migration.
GRANT ALL ON TABLE compliance_frameworks TO devcontrol;
GRANT ALL ON TABLE compliance_framework_rules TO devcontrol;
GRANT ALL ON TABLE compliance_scans TO devcontrol;
GRANT ALL ON TABLE compliance_scan_findings TO devcontrol;

DO $$
BEGIN
  RAISE NOTICE 'Migration 202609191430 completed successfully!';
  RAISE NOTICE 'compliance_framework_rules and compliance_scan_findings now have organization_id (NOT NULL)';
  RAISE NOTICE 'All four tables: composite parent/child FK consistency, RLS enabled, both policies present';
  RAISE NOTICE 'compliance_framework_rules.rule_type CHECK narrowed to the V1 vocabulary';
END $$;
