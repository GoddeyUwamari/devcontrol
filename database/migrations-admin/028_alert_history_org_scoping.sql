-- Migration: 028_alert_history_org_scoping.sql
-- Description: alert_history had no organization_id at all -- every route in
--   alert-history.routes.ts had zero auth middleware AND the repository had no
--   org scoping regardless, so any unauthenticated caller could read every org's
--   alerts and acknowledge/resolve/delete any of them. Same shape as
--   026_api_keys_org_scoping.sql / 027_webhook_endpoints_org_scoping.sql.
--
--   Left NULLABLE (unlike 026/027) rather than NOT NULL: alerts are also
--   created by alert-sync.job.ts, a single global job that polls one shared
--   Prometheus instance with no per-organization context at all (confirmed:
--   no org loop, no org id anywhere in that job or in
--   AlertHistoryService.processPrometheusAlert). This whole subsystem predates
--   or was never adapted for multi-tenancy -- there's no correct organization_id
--   to assign at alert-creation time yet, and forcing NOT NULL here would break
--   that job the moment Prometheus is actually configured (it's currently
--   skipped/dormant in every environment observed). Application-level reads are
--   scoped by organization_id regardless (NULL never matches a real org id, so
--   this fails closed -- unassigned alerts are simply invisible to everyone --
--   rather than leaking cross-tenant). Fully attributing synced alerts to an org
--   requires making the Prometheus integration multi-tenant-aware, which is a
--   separate, larger change than this auth/scoping fix.
--
--   NOTE: RLS is included for parity with the established convention on other
--   org-scoped tables in this codebase, but is not the real enforcement -- the
--   app's pool connects as the `postgres` superuser, which bypasses RLS
--   regardless of FORCE ROW LEVEL SECURITY. The real enforcement is the
--   explicit organization_id filtering added to alert-history repository/routes
--   alongside this migration.
-- Date: 2026-08-01

ALTER TABLE alert_history
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Backfill pre-existing unscoped rows. Same placeholder as 022/026/027 -- this
-- environment's only AWS-connected org -- verify this matches intent before
-- running against another environment.
UPDATE alert_history
SET organization_id = 'c4c6d2b0-3a4d-4507-8577-fc232c5e99fb'
WHERE organization_id IS NULL;

CREATE INDEX IF NOT EXISTS idx_alert_history_org ON alert_history(organization_id);

ALTER TABLE alert_history ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'alert_history' AND policyname = 'alert_history_isolation_policy'
  ) THEN
    CREATE POLICY alert_history_isolation_policy ON alert_history
      FOR ALL
      USING (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'alert_history' AND policyname = 'alert_history_insert_policy'
  ) THEN
    CREATE POLICY alert_history_insert_policy ON alert_history
      FOR INSERT
      WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'Migration 028 completed successfully!';
  RAISE NOTICE 'alert_history now has organization_id (nullable), RLS enabled, and both policies';
END $$;
