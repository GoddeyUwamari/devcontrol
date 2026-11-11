-- Migration: create aws_connection_checks (AWS connect PR D1a)
--
-- One row per AWS connection (aws_accounts row): the connection's health
-- (ok / failing / lost, from the AssumeRole each scan, the connect check and
-- the owner's "Check again" make), the role's unique ID, the saved permission
-- probes, the policy-set compare, how each scan listing fared, and the Check
-- again cooldown. Private notes: connect-d1-step1.md §1-§2, founder decisions
-- D1-D1..D1-D14 (2026-11-11).
--
-- ADMINISTRATIVE (database/migrations-admin/README.md): postgres owns the
-- table (it is created by postgres), row level security is enabled AND forced,
-- one tenant policy, and devcontrol gets SELECT, INSERT and UPDATE only (no
-- DELETE: the disconnect cleanup, C-b, adds the DELETE it needs). The unique
-- index and the foreign key on aws_accounts need its owner too.
--
-- aws_accounts is not created by any migration in this repository (production
-- has it from before the migration ledger; CI and tests create it as a test
-- fixture after the schema bootstrap). Like 202611051200_aws_disconnect_expand,
-- the parts that touch it run only when it exists:
--   - CREATE UNIQUE INDEX aws_accounts_id_org_uidx ON aws_accounts (id, org_id)
--   - the composite foreign key (aws_account_id, organization_id) ->
--     aws_accounts (id, org_id) ON DELETE CASCADE, so a row can never name
--     another organization's connection.
--
-- Additive: one new table, its policy and grants, one new index on
-- aws_accounts. No existing row or column is changed. Locks: SHARE on
-- aws_accounts while the index builds and SHARE ROW EXCLUSIVE while the
-- foreign key is added (the table is small; milliseconds); nothing else.
--
-- Run with: one transaction (database/migrate.js), as postgres.

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF current_setting('is_superuser') <> 'on' THEN
    RAISE EXCEPTION 'run as a superuser (postgres) -- refusing to proceed.';
  END IF;
  IF to_regclass('public.organizations') IS NULL THEN
    RAISE EXCEPTION 'organizations does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('public.aws_connection_checks') IS NOT NULL THEN
    RAISE EXCEPTION 'aws_connection_checks already exists -- this migration creates it and refuses to proceed. Investigate before re-running.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcontrol') THEN
    RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('public.aws_accounts') IS NOT NULL THEN
    IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
         WHERE attrelid = 'public.aws_accounts'::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'uuid'
       OR (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
         WHERE attrelid = 'public.aws_accounts'::regclass AND attname = 'org_id' AND NOT attisdropped) IS DISTINCT FROM 'uuid' THEN
      RAISE EXCEPTION 'aws_accounts.id and aws_accounts.org_id must both be uuid -- refusing to proceed.';
    END IF;
    IF to_regclass('public.aws_accounts_id_org_uidx') IS NOT NULL THEN
      RAISE EXCEPTION 'aws_accounts_id_org_uidx already exists -- refusing to proceed.';
    END IF;
  END IF;
END $$;

CREATE TABLE public.aws_connection_checks (
  aws_account_id              UUID PRIMARY KEY,
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,

  -- Health (connection-health.ts)
  last_attempt_at             TIMESTAMPTZ,
  last_attempt_result         VARCHAR(24)
                                CHECK (last_attempt_result IN ('ok', 'role_refused', 'role_not_found', 'role_error', 'aws_unavailable', 'platform_unavailable')),
  last_conclusive_at          TIMESTAMPTZ,
  last_ok_at                  TIMESTAMPTZ,
  health_state                VARCHAR(8) CHECK (health_state IN ('ok', 'failing', 'lost')),
  failing_since               TIMESTAMPTZ,
  lost_at                     TIMESTAMPTZ,
  consecutive_role_failures   INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_role_failures >= 0),

  -- The role's unique ID (from AssumedRoleUser.AssumedRoleId)
  role_unique_id              VARCHAR(128) CHECK (role_unique_id ~ '^[A-Za-z0-9_]{16,128}$'),
  role_unique_id_source       VARCHAR(16) CHECK (role_unique_id_source IN ('connect', 'scan', 'check_again')),
  role_unique_id_recorded_at  TIMESTAMPTZ,
  role_replaced_at            TIMESTAMPTZ,

  -- Saved permission probes (connect, Check again)
  permission_results          JSONB CHECK (jsonb_typeof(permission_results) = 'array'),
  permission_checked_at       TIMESTAMPTZ,
  permission_trigger          VARCHAR(16) CHECK (permission_trigger IN ('connect', 'check_again')),

  -- Policy-set compare (verdicts, AWS-managed names and counts only)
  policy_result               JSONB CHECK (jsonb_typeof(policy_result) = 'object'),
  policy_checked_at           TIMESTAMPTZ,
  policy_trigger              VARCHAR(24) CHECK (policy_trigger IN ('connect', 'check_again', 'scan_access_denied', 'role_replaced')),
  policy_contract_version     SMALLINT CHECK (policy_contract_version >= 1),

  -- How each listing of the latest scan fared
  scan_sources                JSONB CHECK (jsonb_typeof(scan_sources) = 'object'),
  scan_sources_job_id         UUID,
  scan_sources_at             TIMESTAMPTZ,

  -- Check again cooldown
  check_again_started_at      TIMESTAMPTZ,

  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT aws_connection_checks_conclusive_state CHECK ((health_state IS NULL) = (last_conclusive_at IS NULL)),
  CONSTRAINT aws_connection_checks_failing_since CHECK ((health_state IN ('failing', 'lost')) = (failing_since IS NOT NULL)),
  CONSTRAINT aws_connection_checks_lost_at CHECK ((health_state = 'lost') = (lost_at IS NOT NULL))
);

CREATE INDEX aws_connection_checks_org_idx ON public.aws_connection_checks (organization_id);

COMMENT ON TABLE public.aws_connection_checks IS
  '[202611111200_create_aws_connection_checks] One row per AWS connection: health from AssumeRole outcomes, '
  'the role unique ID, saved permission probes, the policy-set compare, per-source scan outcomes and the '
  'Check again cooldown. Never a credential, External ID, policy document or AWS message.';

DO $$
BEGIN
  IF to_regclass('public.aws_accounts') IS NULL THEN
    RAISE NOTICE 'aws_accounts does not exist; its (id, org_id) index and the foreign key to it were skipped.';
    RETURN;
  END IF;
  EXECUTE $q$ CREATE UNIQUE INDEX aws_accounts_id_org_uidx ON public.aws_accounts (id, org_id) $q$;
  EXECUTE $q$ COMMENT ON INDEX public.aws_accounts_id_org_uidx IS
    '[202611111200_create_aws_connection_checks] The target of aws_connection_checks'' (aws_account_id, organization_id) foreign key.' $q$;
  EXECUTE $q$ ALTER TABLE public.aws_connection_checks
    ADD CONSTRAINT aws_connection_checks_connection_fk
    FOREIGN KEY (aws_account_id, organization_id) REFERENCES public.aws_accounts (id, org_id) ON DELETE CASCADE $q$;
END $$;

ALTER TABLE public.aws_connection_checks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.aws_connection_checks FORCE ROW LEVEL SECURITY;

CREATE POLICY aws_connection_checks_tenant ON public.aws_connection_checks FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

REVOKE ALL ON TABLE public.aws_connection_checks FROM PUBLIC, devcontrol;
GRANT SELECT, INSERT, UPDATE ON TABLE public.aws_connection_checks TO devcontrol;

DO $$
BEGIN
  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.aws_connection_checks'::regclass)) <> current_user THEN
    RAISE EXCEPTION 'aws_connection_checks is not owned by the role running this migration -- refusing to commit.';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.aws_connection_checks'::regclass) THEN
    RAISE EXCEPTION 'row level security is not enabled and forced on aws_connection_checks -- refusing to commit.';
  END IF;
  IF has_table_privilege('devcontrol', 'public.aws_connection_checks', 'DELETE')
     OR has_table_privilege('devcontrol', 'public.aws_connection_checks', 'TRUNCATE')
     OR has_table_privilege('devcontrol', 'public.aws_connection_checks', 'REFERENCES')
     OR has_table_privilege('devcontrol', 'public.aws_connection_checks', 'TRIGGER')
     OR NOT has_table_privilege('devcontrol', 'public.aws_connection_checks', 'SELECT')
     OR NOT has_table_privilege('devcontrol', 'public.aws_connection_checks', 'INSERT')
     OR NOT has_table_privilege('devcontrol', 'public.aws_connection_checks', 'UPDATE') THEN
    RAISE EXCEPTION 'devcontrol does not have exactly SELECT, INSERT and UPDATE on aws_connection_checks -- refusing to commit.';
  END IF;
END $$;
