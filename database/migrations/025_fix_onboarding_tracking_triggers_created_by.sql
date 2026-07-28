-- Migration: 025_fix_onboarding_tracking_triggers_created_by.sql
-- Description: Fix track_service_created() and track_deployment_created() (added in
--   010_create_analytics_events.sql) referencing NEW.created_by, a column that has
--   never existed on either table — services has `owner`, deployments has
--   `deployed_by` (see 001_create_platform_tables.sql). Every INSERT into services
--   or deployments was throwing "record \"new\" has no field \"created_by\"" and
--   rolling back, in every environment that ran this migration — i.e. service and
--   deployment creation, and the onboarding create_service/log_deployment stages
--   that depend on it, were completely broken.
--
--   `owner`/`deployed_by` are free-text VARCHAR columns (whatever string the client
--   sends — an email, a name, a team slug), not a users.id UUID, so they can't be
--   passed directly as track_event()'s p_user_id (UUID) parameter without risking
--   the same class of failure (invalid UUID input) for any value that isn't itself
--   a UUID. Pass NULL for p_user_id instead — analytics_events.user_id is nullable
--   (ON DELETE SET NULL) — and keep the original string in `properties` so the
--   event is still attributable without a broken/guessed FK.
--
--   Hotfixed directly on production via SSH to stop the bleeding immediately;
--   this migration tracks that same fix in version control so a future migration
--   run (or a fresh environment bootstrap) doesn't silently reintroduce it.
-- Date: 2026-07-28

CREATE OR REPLACE FUNCTION track_service_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM track_event(
    NULL,
    NEW.organization_id,
    'service_created',
    'service',
    jsonb_build_object(
      'service_id', NEW.id,
      'service_name', NEW.name,
      'owner', NEW.owner
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION track_deployment_created()
RETURNS TRIGGER AS $$
BEGIN
  PERFORM track_event(
    NULL,
    NEW.organization_id,
    'deployment_created',
    'deployment',
    jsonb_build_object(
      'deployment_id', NEW.id,
      'service_id', NEW.service_id,
      'environment', NEW.environment,
      'status', NEW.status,
      'deployed_by', NEW.deployed_by
    )
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  RAISE NOTICE 'Migration 025 completed successfully!';
  RAISE NOTICE 'track_service_created() and track_deployment_created() no longer reference the nonexistent created_by column';
END $$;
