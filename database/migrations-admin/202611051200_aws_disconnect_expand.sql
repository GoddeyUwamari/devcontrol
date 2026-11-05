-- Migration: AWS disconnect, stage C-1 (expand)
--
-- Schema the AWS disconnect lifecycle will use. This stage only ADDS: new
-- nullable columns, partial unique indexes that the existing constraints
-- already imply, new tables nothing reads yet, one non-restrictive trigger
-- that fills a new column, and DELETE grants. Nothing it adds can refuse a
-- write the currently deployed application makes:
--
--   aws_accounts
--     + disconnect_requested_at, disconnect_requested_by, disconnecting_at,
--       disconnected_at, cleanup_last_error_code, cleanup_stalled_at (nullable)
--       and cleanup_attempts (NOT NULL DEFAULT 0, a constant default: no rewrite).
--       The deployed INSERT names its columns, so the new ones take their
--       defaults; no reader selects *.
--     + aws_accounts_live_org_uidx (org_id) and aws_accounts_live_account_uidx
--       (account_id), both partial: WHERE status IN ('active','disconnecting').
--       Each is implied by the existing full UNIQUE constraint on the same
--       column, so no row the deployed code can insert violates one without
--       violating the other. The deployed INSERT's ON CONFLICT (org_id) has no
--       predicate and keeps inferring the full constraint as its arbiter.
--   aws_preserved_customer_decisions, remediation_executions,
--   remediation_step_claims: new tables, read by nothing deployed.
--   risk_score_history
--     + aws_connection_id (nullable uuid, the type of aws_accounts.id): the
--       aws_accounts.id of the connection that was live when the snapshot was
--       written.
--     + a BEFORE INSERT trigger that fills it when the writer did not, from the
--       organization's one active aws_accounts row (left NULL for none or more
--       than one). It never raises.
--     + a backfill of the existing rows of every organization that has exactly
--       one aws_accounts row, and that row active.
--   GRANT DELETE to devcontrol on cost_finding_detections,
--   observability_collection_scopes and resource_telemetry_observations.
--
-- Nothing restrictive is in this stage: status CHECK, NOT NULL, the lifecycle
-- and write guards and the ownership changes come in a later stage, after the
-- application that relies on them has been deployed.
--
-- aws_accounts is defined outside the canonical migrations. When it is absent,
-- as in CI's bootstrap, its part and the risk backfill are skipped with a
-- NOTICE, and the stamp trigger leaves new snapshots unstamped.
--
-- ADMINISTRATIVE MIGRATION (database/migrations-admin/README.md): applied by
-- hand as postgres BEFORE the code that uses it is merged. The runner applies
-- this file and its ledger row in ONE transaction: any failure, including the
-- 3 s lock timeout below, leaves nothing applied.
--
-- Written for PostgreSQL 14 and later.

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF to_regclass('organizations') IS NULL THEN
    RAISE EXCEPTION 'organizations does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('risk_score_history') IS NULL THEN
    RAISE EXCEPTION 'risk_score_history does not exist -- refusing to proceed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcontrol') THEN
    RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('aws_preserved_customer_decisions') IS NOT NULL
     OR to_regclass('remediation_executions') IS NOT NULL
     OR to_regclass('remediation_step_claims') IS NOT NULL THEN
    RAISE EXCEPTION 'a table this migration creates already exists -- refusing to proceed. Investigate before re-running.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'risk_score_history'::regclass AND attname = 'aws_connection_id' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'risk_score_history.aws_connection_id already exists -- refusing to proceed.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- aws_accounts: lifecycle columns and the live-connection partial indexes
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF to_regclass('aws_accounts') IS NULL THEN
    RAISE NOTICE 'aws_accounts does not exist; its lifecycle columns and indexes were skipped.';
    RETURN;
  END IF;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'aws_accounts'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'uuid' THEN
    RAISE EXCEPTION 'aws_accounts.id is not uuid -- refusing to proceed: the connection-id columns this migration adds are uuid.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'aws_accounts'::regclass AND attname = 'disconnect_requested_at' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'aws_accounts.disconnect_requested_at already exists -- refusing to proceed.';
  END IF;

  EXECUTE $q$
    ALTER TABLE aws_accounts
      ADD COLUMN disconnect_requested_at TIMESTAMPTZ,
      ADD COLUMN disconnect_requested_by UUID,
      ADD COLUMN disconnecting_at        TIMESTAMPTZ,
      ADD COLUMN disconnected_at         TIMESTAMPTZ,
      ADD COLUMN cleanup_attempts        INTEGER NOT NULL DEFAULT 0,
      ADD COLUMN cleanup_last_error_code VARCHAR(64),
      ADD COLUMN cleanup_stalled_at      TIMESTAMPTZ $q$;

  EXECUTE $q$
    CREATE UNIQUE INDEX aws_accounts_live_org_uidx
      ON aws_accounts (org_id) WHERE status IN ('active', 'disconnecting') $q$;
  EXECUTE $q$
    CREATE UNIQUE INDEX aws_accounts_live_account_uidx
      ON aws_accounts (account_id) WHERE status IN ('active', 'disconnecting') $q$;

  EXECUTE $q$ COMMENT ON INDEX aws_accounts_live_org_uidx IS
    '[202611051200_aws_disconnect_expand] At most one live (active or disconnecting) connection per organization.' $q$;
  EXECUTE $q$ COMMENT ON INDEX aws_accounts_live_account_uidx IS
    '[202611051200_aws_disconnect_expand] At most one live (active or disconnecting) connection per AWS account.' $q$;
  EXECUTE $q$ COMMENT ON COLUMN aws_accounts.disconnect_requested_at IS
    '[202611051200_aws_disconnect_expand] When the owner asked to disconnect; NULL while no disconnect was requested.' $q$;
END $$;

-- ---------------------------------------------------------------------------
-- Customer decisions kept across a disconnect (keyed by the AWS account)
-- ---------------------------------------------------------------------------
CREATE TABLE aws_preserved_customer_decisions (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  aws_account_id        VARCHAR(12) NOT NULL CHECK (aws_account_id ~ '^[0-9]{12}$'),
  source_connection_id  UUID NOT NULL,
  kind                  VARCHAR(40) NOT NULL
                          CHECK (kind IN ('security_finding_disposition', 'cost_dismissal', 'resource_attribution')),
  stable_key            TEXT NOT NULL,
  decision              JSONB NOT NULL,
  decided_by            UUID,
  decided_at            TIMESTAMPTZ,
  state                 VARCHAR(16) NOT NULL DEFAULT 'pending'
                          CHECK (state IN ('pending', 'applied', 'expired', 'superseded')),
  preserved_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  applied_at            TIMESTAMPTZ,
  applied_connection_id UUID,
  UNIQUE (organization_id, aws_account_id, kind, stable_key)
);
COMMENT ON TABLE aws_preserved_customer_decisions IS
  '[202611051200_aws_disconnect_expand] A customer decision kept when an AWS account is disconnected, '
  're-applied only if the same AWS account is connected again. Never AWS-derived content.';

-- ---------------------------------------------------------------------------
-- Remediation executions and their per-AWS-call step claims
-- ---------------------------------------------------------------------------
CREATE TABLE remediation_executions (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  workflow_id       UUID NOT NULL,
  kind              VARCHAR(16) NOT NULL DEFAULT 'execute' CHECK (kind IN ('execute', 'rollback')),
  aws_connection_id UUID NOT NULL,
  state             VARCHAR(24) NOT NULL DEFAULT 'running'
                      CHECK (state IN ('running', 'completed', 'failed', 'stopped_by_disconnect', 'outcome_unknown')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at       TIMESTAMPTZ
);
CREATE UNIQUE INDEX remediation_executions_one_running_uidx
  ON remediation_executions (workflow_id) WHERE state = 'running';
CREATE INDEX remediation_executions_org_idx ON remediation_executions (organization_id);
COMMENT ON TABLE remediation_executions IS
  '[202611051200_aws_disconnect_expand] One row per execute or rollback attempt of a remediation workflow.';

CREATE TABLE remediation_step_claims (
  fencing_token        BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  execution_id         UUID NOT NULL REFERENCES remediation_executions(id),
  step                 VARCHAR(64) NOT NULL,
  attempt              SMALLINT NOT NULL DEFAULT 1 CHECK (attempt >= 1),
  state                VARCHAR(24) NOT NULL DEFAULT 'claimed'
                         CHECK (state IN ('claimed', 'in_flight_at_disconnect', 'succeeded', 'failed', 'not_dispatched', 'outcome_unknown')),
  claimed_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  marked_in_flight_at  TIMESTAMPTZ,
  outcome_at           TIMESTAMPTZ,
  outcome_code         VARCHAR(64),
  aws_request_id       VARCHAR(128),
  UNIQUE (execution_id, step, attempt)
);
CREATE INDEX remediation_step_claims_open_idx
  ON remediation_step_claims (organization_id) WHERE state IN ('claimed', 'in_flight_at_disconnect');
COMMENT ON TABLE remediation_step_claims IS
  '[202611051200_aws_disconnect_expand] One row per mutating AWS call of a remediation execution; '
  'its fencing_token guards every outcome write.';

-- ---------------------------------------------------------------------------
-- risk_score_history: the connection each snapshot belongs to
-- ---------------------------------------------------------------------------
ALTER TABLE risk_score_history ADD COLUMN aws_connection_id UUID;
COMMENT ON COLUMN risk_score_history.aws_connection_id IS
  '[202611051200_aws_disconnect_expand] The aws_accounts.id of the connection that was live when this snapshot '
  'was written; NULL when there was none (or it could not be told). Never shown to users.';

CREATE FUNCTION risk_score_history_stamp_connection() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public
AS $$
DECLARE
  live UUID;
BEGIN
  IF NEW.aws_connection_id IS NULL AND NEW.organization_id IS NOT NULL
     AND to_regclass('public.aws_accounts') IS NOT NULL THEN
    BEGIN
      -- uuid has no min(); with count(*) = 1 the text round-trip returns that one id.
      EXECUTE 'SELECT CASE WHEN count(*) = 1 THEN min(id::text)::uuid END
                 FROM public.aws_accounts WHERE org_id = $1 AND status = ''active'''
        INTO live USING NEW.organization_id;
      NEW.aws_connection_id := live;
    EXCEPTION WHEN OTHERS THEN
      -- Never refuse a snapshot: an unreadable connection leaves it unstamped.
      RAISE WARNING 'risk_score_history_stamp_connection: connection not read (SQLSTATE %); snapshot left unstamped', SQLSTATE;
    END;
  END IF;
  RETURN NEW;
END $$;
COMMENT ON FUNCTION risk_score_history_stamp_connection() IS
  '[202611051200_aws_disconnect_expand] Fills risk_score_history.aws_connection_id when the writer did not.';

CREATE TRIGGER risk_score_history_stamp_connection
  BEFORE INSERT ON risk_score_history
  FOR EACH ROW EXECUTE FUNCTION risk_score_history_stamp_connection();

DO $$
DECLARE
  n_stamped   INTEGER := 0;
  n_unstamped INTEGER := 0;
BEGIN
  IF to_regclass('aws_accounts') IS NULL THEN
    RAISE NOTICE 'aws_accounts does not exist; risk_score_history backfill skipped.';
  ELSE
    -- Only an organization that has ever had exactly one aws_accounts row, and that
    -- row active: every snapshot it has was written while that connection was live.
    EXECUTE $q$
      UPDATE risk_score_history h
         SET aws_connection_id = s.id
        FROM (SELECT org_id, min(id::text)::uuid AS id
                FROM aws_accounts
               WHERE org_id IS NOT NULL
               GROUP BY org_id
              HAVING count(*) = 1 AND bool_and(status = 'active')) s
       WHERE h.organization_id = s.org_id AND h.aws_connection_id IS NULL $q$;
    GET DIAGNOSTICS n_stamped = ROW_COUNT;
  END IF;
  SELECT count(*) INTO n_unstamped FROM risk_score_history WHERE aws_connection_id IS NULL;
  RAISE NOTICE 'risk_score_history backfill: % row(s) stamped; % row(s) left unstamped (no single active connection).',
    n_stamped, n_unstamped;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security and grants for the new tables
-- ---------------------------------------------------------------------------
ALTER TABLE aws_preserved_customer_decisions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aws_preserved_customer_decisions FORCE ROW LEVEL SECURITY;
CREATE POLICY aws_preserved_customer_decisions_tenant ON aws_preserved_customer_decisions FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE remediation_executions ENABLE ROW LEVEL SECURITY;
ALTER TABLE remediation_executions FORCE ROW LEVEL SECURITY;
CREATE POLICY remediation_executions_tenant ON remediation_executions FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

ALTER TABLE remediation_step_claims ENABLE ROW LEVEL SECURITY;
ALTER TABLE remediation_step_claims FORCE ROW LEVEL SECURITY;
CREATE POLICY remediation_step_claims_tenant ON remediation_step_claims FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

REVOKE ALL ON TABLE aws_preserved_customer_decisions, remediation_executions, remediation_step_claims FROM PUBLIC, devcontrol;
GRANT SELECT, INSERT, UPDATE ON TABLE aws_preserved_customer_decisions, remediation_executions, remediation_step_claims TO devcontrol;
REVOKE ALL ON FUNCTION risk_score_history_stamp_connection() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- DELETE grants the disconnect cleanup needs
-- ---------------------------------------------------------------------------
GRANT DELETE ON TABLE cost_finding_detections, observability_collection_scopes, resource_telemetry_observations TO devcontrol;
