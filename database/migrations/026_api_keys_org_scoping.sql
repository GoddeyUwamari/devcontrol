-- Migration: 026_api_keys_org_scoping.sql
-- Description: api_keys was created with no organization_id at all -- every route in
--   api-keys.routes.ts operated globally (GET listed every org's keys, DELETE could
--   revoke any org's key by id). A prior pass added authenticateToken to that router,
--   which stopped fully-unauthenticated access, but any authenticated user from any
--   org could still see/revoke other orgs' keys since there was no column to scope by.
--   This adds the column, backfills existing rows, and enables RLS + isolation
--   policies for parity with 022's cost_recommendations_org_scoping pattern.
--
--   NOTE: RLS alone is not sufficient here -- this app's pool connects as the
--   `postgres` role, which is a superuser, and PostgreSQL bypasses RLS for
--   superusers/table owners unless FORCE ROW LEVEL SECURITY is also set (confirmed
--   via pg_class.relrowsecurity/relforcerowsecurity while investigating the same gap
--   on `teams`). The real enforcement is the explicit organization_id filtering added
--   to api-keys.routes.ts alongside this migration; RLS here is defense-in-depth /
--   documents intent, matching the existing (equally superuser-bypassed) convention
--   already in place on teams and cost_recommendations.
-- Date: 2026-08-01

ALTER TABLE api_keys
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Backfill pre-existing unscoped rows. Placeholder below is this environment's only
-- AWS-connected org (same placeholder migration 022 used for the identical situation
-- on cost_recommendations) -- verify this matches intent before running against
-- another environment.
UPDATE api_keys
SET organization_id = 'c4c6d2b0-3a4d-4507-8577-fc232c5e99fb'
WHERE organization_id IS NULL;

ALTER TABLE api_keys
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_api_keys_org ON api_keys(organization_id);

ALTER TABLE api_keys ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'api_keys' AND policyname = 'api_keys_isolation_policy'
  ) THEN
    CREATE POLICY api_keys_isolation_policy ON api_keys
      FOR ALL
      USING (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'api_keys' AND policyname = 'api_keys_insert_policy'
  ) THEN
    CREATE POLICY api_keys_insert_policy ON api_keys
      FOR INSERT
      WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'Migration 026 completed successfully!';
  RAISE NOTICE 'api_keys now has organization_id (NOT NULL), RLS enabled, and both policies';
END $$;
