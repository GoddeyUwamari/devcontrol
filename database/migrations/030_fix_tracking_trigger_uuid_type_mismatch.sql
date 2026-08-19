-- Migration: 030_fix_tracking_trigger_uuid_type_mismatch.sql
-- Description: Corrects track_service_created() and track_deployment_created()
--   (the public.services / public.deployments AFTER INSERT triggers), whose
--   LIVE production definitions match neither 010_create_analytics_events.sql
--   nor 025_fix_onboarding_tracking_triggers_created_by.sql, and currently
--   fail every INSERT into either table.
--
--   track_event()'s live signature (confirmed via pg_get_functiondef(), not
--   assumed from any migration file) is:
--     track_event(p_user_id uuid, p_organization_id uuid, p_event_name varchar,
--                 p_event_category varchar DEFAULT NULL, p_properties jsonb
--                 DEFAULT '{}')
--   Both trigger functions currently pass a free-text VARCHAR(255) column
--   positionally into p_user_id (uuid), confirmed live:
--     - trigger_track_service_created    -> NEW.owner        (services.owner)
--     - trigger_track_deployment_created -> NEW.deployed_by  (deployments.deployed_by)
--   Neither owner nor deployed_by is ever a UUID (an email, a name, or the
--   literal 'github-actions@webhook') — Postgres has no implicit VARCHAR->UUID
--   cast, so every call raises "function track_event(character varying, uuid,
--   unknown, unknown, jsonb) does not exist" and the INSERT's transaction
--   aborts. As of this migration, production has 0 rows in both services and
--   deployments — every INSERT into either table has failed for the life of
--   this database.
--
--   This is NOT the bug 025 fixed (025 addressed NEW.created_by, a column
--   that never existed on either table, per its own description). What's
--   actually live today matches neither 010's original (NEW.created_by) nor
--   025's fix (NULL) — it's a third, undocumented variant, apparently
--   hotfixed directly on production again after 025, that reintroduced the
--   identical class of bug (a non-UUID value into a UUID parameter) with a
--   different source column. Production has no schema_migrations table and
--   no reliable record of when or why (see the accompanying investigation —
--   reconstructing migration tracking is explicitly out of scope here). This
--   migration exists only to correct these two functions to a known-good
--   state, independent of tracking history.
--
--   Fix: pass NULL for p_user_id — analytics_events.user_id is nullable
--   (ON DELETE SET NULL, see 010_create_analytics_events.sql) — same
--   precedent as 025, and keep the original owner/deployed_by string in
--   `properties` instead, so the event is still attributable without a
--   broken/guessed FK. Event names/categories ('service_created'/'service',
--   'deployment_created'/'deployment'), trigger names, and AFTER INSERT
--   timing are all unchanged from what's live today. track_event() itself
--   and the services/deployments table schemas are not touched.
--   CREATE OR REPLACE FUNCTION is sufficient and idempotent — the trigger
--   objects (trigger_track_service_created, trigger_track_deployment_created)
--   resolve the function to call by name at fire time, not by a fixed
--   definition captured at CREATE TRIGGER time, so replacing the function
--   bodies takes effect immediately with no DROP TRIGGER / CREATE TRIGGER
--   needed and no lock beyond the brief catalog update every
--   CREATE OR REPLACE FUNCTION takes.
-- Date: 2026-08-19

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
  RAISE NOTICE 'Migration 030 completed successfully!';
  RAISE NOTICE 'track_service_created() and track_deployment_created() no longer pass NEW.owner/NEW.deployed_by (VARCHAR) into track_event()''s uuid p_user_id parameter';
END $$;
