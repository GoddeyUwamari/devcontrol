-- Migration: 022_cost_recommendations_org_scoping.sql
-- Description: cost_recommendations was created in 002 (pre-multi-tenancy). Migration
--   004 was supposed to add organization_id + RLS to it (and 005 to backfill/enforce
--   NOT NULL), but a direct schema check found at least one environment where neither
--   ever actually ran against this table: no organization_id column, RLS disabled, zero
--   policies -- even though later migrations (017-021) were present. This applies
--   exactly the missing piece, scoped to cost_recommendations only: it does not touch
--   teams/services/deployments/infrastructure_resources/alert_history (004's other
--   tables) and does not seed a default org/admin user (005's side effect). Every
--   statement is guarded so it's safe to run again on an environment where 004/005
--   already applied this table correctly.
-- Date: 2026-07-05

ALTER TABLE cost_recommendations
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Backfill pre-existing unscoped rows. Placeholder below is this environment's only
-- AWS-connected org (the sole plausible owner of any row inserted before scoping
-- existed) -- verify this matches intent before running against another environment.
UPDATE cost_recommendations
SET organization_id = 'c4c6d2b0-3a4d-4507-8577-fc232c5e99fb'
WHERE organization_id IS NULL;

ALTER TABLE cost_recommendations
  ALTER COLUMN organization_id SET NOT NULL;

CREATE INDEX IF NOT EXISTS idx_cost_recommendations_org ON cost_recommendations(organization_id);

ALTER TABLE cost_recommendations ENABLE ROW LEVEL SECURITY;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cost_recommendations' AND policyname = 'cost_recommendations_isolation_policy'
  ) THEN
    CREATE POLICY cost_recommendations_isolation_policy ON cost_recommendations
      FOR ALL
      USING (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'cost_recommendations' AND policyname = 'cost_recommendations_insert_policy'
  ) THEN
    CREATE POLICY cost_recommendations_insert_policy ON cost_recommendations
      FOR INSERT
      WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));
  END IF;
END $$;

DO $$
BEGIN
  RAISE NOTICE 'Migration 022 completed successfully!';
  RAISE NOTICE 'cost_recommendations now has organization_id (NOT NULL), RLS enabled, and both policies';
END $$;
