-- Migration: 027_webhook_endpoints_org_scoping.sql
-- Description: webhook_endpoints had no organization_id at all -- every route in
--   webhooks.routes.ts operated globally (GET listed every org's webhook URLs/events,
--   POST registered endpoints with no owning org, DELETE could remove any org's
--   endpoint by id, and the route had no auth middleware at all). This adds the
--   column, backfills existing rows, and enables RLS + isolation policies, same
--   pattern as 022_cost_recommendations_org_scoping.sql and
--   026_api_keys_org_scoping.sql.
--
--   NOTE: as with those two, RLS alone doesn't enforce anything here -- this app's
--   pool connects as the `postgres` role, a superuser, and PostgreSQL bypasses RLS
--   for superusers/table owners unless FORCE ROW LEVEL SECURITY is also set. The
--   real enforcement is the explicit organization_id filtering added to
--   webhooks.routes.ts alongside this migration and the authenticateToken middleware
--   added to the same router; RLS here is defense-in-depth / documents intent.
-- Date: 2026-08-01

ALTER TABLE webhook_endpoints
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Backfill pre-existing unscoped rows. Same placeholder as 022/026 -- this
-- environment's only AWS-connected org -- verify this matches intent before
-- running against another environment.
UPDATE webhook_endpoints
SET organization_id = 'c4c6d2b0-3a4d-4507-8577-fc232c5e99fb'
WHERE organization_id IS NULL;

ALTER TABLE webhook_endpoints
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_webhook_endpoints_org ON webhook_endpoints(organization_id);

ALTER TABLE webhook_endpoints ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'webhook_endpoints' AND policyname = 'webhook_endpoints_isolation_policy'
  ) THEN
    CREATE POLICY webhook_endpoints_isolation_policy ON webhook_endpoints
      FOR ALL
      USING (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'webhook_endpoints' AND policyname = 'webhook_endpoints_insert_policy'
  ) THEN
    CREATE POLICY webhook_endpoints_insert_policy ON webhook_endpoints
      FOR INSERT
      WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'Migration 027 completed successfully!';
  RAISE NOTICE 'webhook_endpoints now has organization_id (NOT NULL), RLS enabled, and both policies';
END $$;
