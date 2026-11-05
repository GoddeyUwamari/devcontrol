-- Rollback: AWS disconnect, stage C-1 (expand)
-- Paired with: 202611051200_aws_disconnect_expand.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback", and CI's schema bootstrap skips it too. Run it as the postgres
-- role in ONE transaction, stopping at the first error:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611051200_aws_disconnect_expand_rollback.sql
--
-- REFUSES once the disconnect lifecycle has been used: any aws_accounts row with
-- status 'disconnecting' or 'disconnected' or a lifecycle column set, or any row in
-- aws_preserved_customer_decisions, remediation_executions or
-- remediation_step_claims. Rolling back then would discard real history.
--
-- What is lost otherwise: only the stamps in risk_score_history.aws_connection_id
-- (the snapshot rows themselves are kept) and the empty new tables. The DELETE
-- grants this stage added are revoked (production had none before it).
--
-- Removes only what the paired migration created, and its schema_migrations
-- row. No statement uses CASCADE.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  marker CONSTANT TEXT := '[202611051200_aws_disconnect_expand]';
  n INTEGER;
BEGIN
  IF to_regclass('aws_accounts') IS NOT NULL
     AND EXISTS (SELECT 1 FROM pg_attribute
                  WHERE attrelid = 'aws_accounts'::regclass AND attname = 'disconnect_requested_at' AND NOT attisdropped) THEN
    EXECUTE $q$
      SELECT count(*) FROM aws_accounts
       WHERE status IN ('disconnecting', 'disconnected')
          OR disconnect_requested_at IS NOT NULL OR disconnect_requested_by IS NOT NULL
          OR disconnecting_at IS NOT NULL OR disconnected_at IS NOT NULL
          OR cleanup_attempts <> 0 OR cleanup_last_error_code IS NOT NULL OR cleanup_stalled_at IS NOT NULL $q$ INTO n;
    IF n > 0 THEN
      RAISE EXCEPTION '% aws_accounts row(s) carry disconnect lifecycle state -- refusing to roll back.', n;
    END IF;
  END IF;
  FOR n IN
    SELECT (SELECT count(*) FROM aws_preserved_customer_decisions)
         + (SELECT count(*) FROM remediation_executions)
         + (SELECT count(*) FROM remediation_step_claims)
  LOOP
    IF n > 0 THEN
      RAISE EXCEPTION '% row(s) in the disconnect tables -- refusing to roll back.', n;
    END IF;
  END LOOP;
  IF NOT starts_with(COALESCE(obj_description('aws_preserved_customer_decisions'::regclass, 'pg_class'), ''), marker)
     OR NOT starts_with(COALESCE(obj_description('remediation_executions'::regclass, 'pg_class'), ''), marker)
     OR NOT starts_with(COALESCE(obj_description('remediation_step_claims'::regclass, 'pg_class'), ''), marker) THEN
    RAISE EXCEPTION 'a table was not created by the paired migration (no marker) -- refusing to drop it.';
  END IF;
END $$;

REVOKE DELETE ON TABLE cost_finding_detections, observability_collection_scopes, resource_telemetry_observations FROM devcontrol;

DROP TRIGGER risk_score_history_stamp_connection ON risk_score_history;
DROP FUNCTION risk_score_history_stamp_connection();
ALTER TABLE risk_score_history DROP COLUMN aws_connection_id;

DROP TABLE remediation_step_claims;
DROP TABLE remediation_executions;
DROP TABLE aws_preserved_customer_decisions;

DO $$
BEGIN
  IF to_regclass('aws_accounts') IS NULL THEN
    RAISE NOTICE 'aws_accounts does not exist; nothing to roll back there.';
    RETURN;
  END IF;
  EXECUTE 'DROP INDEX IF EXISTS aws_accounts_live_org_uidx';
  EXECUTE 'DROP INDEX IF EXISTS aws_accounts_live_account_uidx';
  EXECUTE $q$
    ALTER TABLE aws_accounts
      DROP COLUMN IF EXISTS disconnect_requested_at,
      DROP COLUMN IF EXISTS disconnect_requested_by,
      DROP COLUMN IF EXISTS disconnecting_at,
      DROP COLUMN IF EXISTS disconnected_at,
      DROP COLUMN IF EXISTS cleanup_attempts,
      DROP COLUMN IF EXISTS cleanup_last_error_code,
      DROP COLUMN IF EXISTS cleanup_stalled_at $q$;
END $$;

DELETE FROM schema_migrations
 WHERE migration_name = '202611051200_aws_disconnect_expand.sql';

DO $$ BEGIN
  RAISE NOTICE 'Rolled back 202611051200_aws_disconnect_expand.sql';
END $$;
