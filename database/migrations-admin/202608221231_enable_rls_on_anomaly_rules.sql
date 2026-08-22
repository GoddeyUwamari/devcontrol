-- Migration: 202608221231_enable_rls_on_anomaly_rules.sql
-- Description: Adopts the pre-existing, already-correctly-shaped production
--   table `anomaly_rules` as the backing store for the custom-anomaly-rules
--   feature, in place of the incompatible, never-used `custom_anomaly_rules`
--   table this migration deliberately does NOT touch (see the investigation
--   behind this decision: `anomaly_rules` already has organization_id UUID
--   NOT NULL with a FOREIGN KEY to organizations(id) ON DELETE CASCADE, and
--   every column custom-anomaly-rules.service.ts needs -- it was simply
--   never wired up because the application queried a different, prefixed
--   table name. That code now points at `anomaly_rules` directly; this
--   migration only adds the missing RLS layer, matching this repository's
--   established retrofit convention (022/026/027/028's ..._org_scoping.sql
--   pattern) rather than inventing a new one).
--
--   Deliberately ALTER-only: does not CREATE, DROP, or RENAME any table,
--   does not touch organization_id/its FK/its defaults, and does not touch
--   any existing row. Fails loudly (RAISE EXCEPTION, rolling back under
--   migrate.js's per-migration transaction) if `anomaly_rules` is missing
--   or doesn't already have the exact organization_id shape this migration
--   assumes -- it will never silently create a second table to paper over
--   a missing assumption.
--
--   All catalog lookups below resolve `anomaly_rules`/`organizations` via
--   to_regclass() (OID-based, respects search_path) rather than string-
--   matching table_schema/tablename columns, so this is unambiguous
--   regardless of schema -- deliberately, so this same file can be exercised
--   against an isolated test schema (see
--   backend/src/services/__tests__/anomaly-rules-rls-migration.test.ts)
--   without any risk of it accidentally matching a same-named object
--   elsewhere.
--
--   Unlike 026/027's own caution ("RLS alone doesn't enforce anything here
--   -- this app's pool connects as the postgres role, a superuser"):
--   `anomaly_rules` is postgres-owned, but this repository's actual
--   production runtime role is `devcontrol` (confirmed non-superuser,
--   non-owner, via direct pg_roles query) -- so unlike those two tables,
--   RLS here provides genuine enforcement for the app's real production
--   connection, not just documentation-of-intent. FORCE ROW LEVEL SECURITY
--   is therefore intentionally not needed (it only matters for restricting
--   the owning role/superusers, which the app never connects as).
-- Date: 2026-08-22

-- ADMINISTRATIVE MIGRATION -- see database/migrations-admin/README.md.
--
-- This file lives in database/migrations-admin/, NOT database/migrations/,
-- because it requires ownership-level DDL (ENABLE ROW LEVEL SECURITY,
-- CREATE POLICY) that the application's normal `devcontrol` database role
-- cannot perform -- devcontrol is deliberately non-owner/non-superuser on
-- every application table, which is exactly what makes RLS meaningful once
-- enabled. `anomaly_rules` is owned by `postgres`.
--
-- This structural separation (a different source directory, not a naming
-- convention or an exclusion list) is what guarantees this file can never
-- be picked up by an ordinary `node database/migrate.js --pending` sweep
-- or by .github/scripts/ci-bootstrap-schema.js, both of which only ever
-- scan database/migrations/.
--
-- IMPORTANT OPERATIONAL NOTE:
-- This migration must be executed explicitly, using the canonical
-- database/migrate.js runner (unmodified -- same checksum, transaction,
-- advisory-lock, and schema_migrations behavior as any normal migration),
-- pointed at the administrative deployment location and connected as
-- PostgreSQL role `postgres` via Unix-socket peer authentication (no
-- password, no new credential -- see database/migrations-admin/README.md
-- for the full mechanism):
--
--   cd /opt/devcontrol-admin
--   DB_USER=postgres DB_HOST=/var/run/postgresql \
--   node database/migrate.js --execute-only 202608221231_enable_rls_on_anomaly_rules.sql
--
-- No NODE_PATH override is needed or used: the administrative deployment
-- ships its own self-contained node_modules/ (just `pg` and its
-- dependencies) as a sibling of migrate.js, found by Node's ordinary
-- module resolution -- deliberately, so nothing here ever needs to read
-- from /home/ubuntu (see database/migrations-admin/README.md).
--
-- Do NOT run this migration via the generic --pending mode -- there is
-- currently no automated sweep of database/migrations-admin/ at all, by
-- design; every administrative migration requires its own separate,
-- explicit execution authorization.
--
-- Unrelated to this file's own classification, but worth restating: the
-- repository still separately contains the abandoned
-- database/migrations/202608221112_create_custom_anomaly_rules.sql, which
-- attempts to CREATE TABLE custom_anomaly_rules and would fail against the
-- existing, incompatible production table of that name. This migration
-- intentionally operates only on the existing anomaly_rules table and does
-- not create, drop, rename, or modify custom_anomaly_rules.

DO $$
DECLARE
  tbl_oid oid;
BEGIN
  tbl_oid := to_regclass('anomaly_rules');
  IF tbl_oid IS NULL THEN
    RAISE EXCEPTION
      'anomaly_rules does not exist. This migration adopts a pre-existing '
      'table and must not silently create one -- investigate before re-running.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a
    JOIN pg_type t ON t.oid = a.atttypid
    WHERE a.attrelid = tbl_oid
      AND a.attname = 'organization_id'
      AND t.typname = 'uuid'
      AND a.attnotnull
      AND NOT a.attisdropped
  ) THEN
    RAISE EXCEPTION
      'anomaly_rules.organization_id is missing, nullable, or not uuid -- '
      'does not match this migration''s required assumption. Refusing to proceed.';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = tbl_oid
      AND contype = 'f'
      AND confrelid = to_regclass('organizations')
  ) THEN
    RAISE EXCEPTION
      'anomaly_rules has no foreign key to organizations -- does not match '
      'this migration''s required assumption. Refusing to proceed.';
  END IF;
END $$;

ALTER TABLE anomaly_rules ENABLE ROW LEVEL SECURITY;

DO $$
DECLARE
  tbl_oid oid := to_regclass('anomaly_rules');
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = tbl_oid AND polname = 'anomaly_rules_isolation_policy') THEN
    CREATE POLICY anomaly_rules_isolation_policy ON anomaly_rules
      FOR ALL
      USING (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_policy WHERE polrelid = tbl_oid AND polname = 'anomaly_rules_insert_policy') THEN
    CREATE POLICY anomaly_rules_insert_policy ON anomaly_rules
      FOR INSERT
      WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'Migration 202608221231 completed successfully!';
  RAISE NOTICE 'anomaly_rules adopted: RLS enabled, both policies present, no table created/dropped/renamed, no data modified';
END $$;
