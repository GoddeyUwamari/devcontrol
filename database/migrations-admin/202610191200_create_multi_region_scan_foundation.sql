-- Migration: multi-region scan foundation (M3, additive schema only)
--
-- Storage that later multi-region work reads and writes. Nothing in the
-- application reads or writes any of it yet: discovery and scanning are
-- unchanged by this migration.
--
--   aws_account_regions          per (organization, AWS account, region): whether
--                                the region is enabled, whether it may be scanned,
--                                and the latest scan's status, times and error.
--   aws_scan_leases              one scan at a time per (organization, AWS account,
--                                scan kind), across every entry point and process.
--   job_leases                   one run of a scheduled job at a time per
--                                (organization, job name), across processes.
--   organization_feature_flags   per-organization feature flags; a flag with no
--                                row, or with enabled = false, is OFF.
--   resource_discovery_jobs.warnings
--                                one new nullable JSONB column: non-fatal problems
--                                a discovery job recorded (NULL = none recorded).
--
-- The column is the only change to an existing table. aws_accounts is not
-- touched: production's shape is unknown until the S3a drift check is run.
--
-- ADMINISTRATIVE MIGRATION (see database/migrations-admin/README.md):
--   - resource_discovery_jobs is postgres-owned in production, so even a plain
--     ADD COLUMN needs the owner;
--   - ENABLE/FORCE ROW LEVEL SECURITY and CREATE POLICY on the new tables,
--     which the postgres role creates and therefore owns.
--
-- RE-RUN SAFE. Every statement is IF NOT EXISTS or conditional, so executing
-- this file again changes nothing (database/migrate.js itself refuses to
-- re-execute an applied file; this covers a manual or bootstrap re-run). Each
-- table this migration creates carries a COMMENT starting with the marker
-- [202610191200_create_multi_region_scan_foundation]. A table of the same name
-- WITHOUT the marker was not created here, and the migration refuses to run
-- rather than adopt it. The paired rollback drops only marked objects.
--
-- warnings column: added (and commented with the marker) only when absent. If
-- a column of that name already exists it must be JSONB and is left exactly as
-- it is -- no comment is written -- and the rollback will not drop it.
--
-- LEASE CONTRACT (aws_scan_leases and job_leases; M4 implements the checks,
-- this migration makes them possible):
--
--   fencing_token  BIGINT GENERATED ALWAYS AS IDENTITY (NO CYCLE), UNIQUE.
--                  The token of the CURRENT holder of the lease row.
--     generation   A new value is drawn from the table's identity sequence on
--                  every acquisition, and only by the database: INSERT takes the
--                  default, a takeover sets `fencing_token = DEFAULT`, and any
--                  other explicit value is rejected by GENERATED ALWAYS.
--     monotonic    Per lease key, every acquisition's token is greater than all
--                  earlier ones: a key's row is created once and never deleted
--                  (devcontrol has no DELETE on these tables; release marks the
--                  row released instead), and every later acquisition draws its
--                  token from the sequence while holding the row lock.
--     never reused NO CYCLE, so the sequence never wraps; a value is handed out
--                  once. UNIQUE (fencing_token) additionally rejects two rows
--                  holding the same token.
--     uniqueness   Unique across the whole table (all organizations and keys),
--                  so a token alone identifies one acquisition.
--
--   A lease is HELD by fencing_token exactly while
--     released_at IS NULL AND expires_at > now().
--
--   Acquire   INSERT ... VALUES (<key>, <holder>, now(), now(), now() + <ttl>)
--             ON CONFLICT (<key>) DO UPDATE
--               SET fencing_token = DEFAULT, holder = EXCLUDED.holder,
--                   acquired_at = now(), heartbeat_at = now(),
--                   expires_at = EXCLUDED.expires_at, released_at = NULL [, job_id]
--             WHERE <table>.released_at IS NOT NULL OR <table>.expires_at <= now()
--             RETURNING fencing_token;
--             No row returned: someone else holds it.
--   Renew     UPDATE ... SET heartbeat_at = now(), expires_at = now() + <ttl>
--             WHERE <key> AND fencing_token = $token
--               AND released_at IS NULL AND expires_at > now();
--             0 rows: the lease was lost; stop at the next checkpoint.
--   Commit    Inside the transaction that does the destructive write, first:
--             SELECT 1 FROM ... WHERE <key> AND fencing_token = $token
--               AND released_at IS NULL AND expires_at > clock_timestamp() FOR SHARE;
--             No row: ROLLBACK, write nothing. FOR SHARE blocks a takeover's
--             UPDATE until this transaction ends, so a stale holder cannot
--             commit after a takeover.
--   Release   UPDATE ... SET released_at = now()
--             WHERE <key> AND fencing_token = $token AND released_at IS NULL;
--             Never DELETE (that would let the key start again at a lower token).
--   job_leases only: completion sets last_completed_at = now() (and released_at)
--             under the same `fencing_token = $token` condition as Release.
--
-- Row-level security is ENABLED and FORCED on all four tables, with one policy
-- each reading app.current_organization_id, as in
-- 202610161210_create_resource_health_evaluations.sql: an unset or empty value
-- matches no row, and a value that is not a UUID raises an error -- both fail
-- closed.
--
-- Grants to devcontrol (never TRUNCATE: TRUNCATE is not subject to row-level
-- security):
--   aws_account_regions           SELECT, INSERT, UPDATE, DELETE
--   aws_scan_leases, job_leases   SELECT, INSERT, UPDATE (no DELETE, see above)
--   organization_feature_flags    SELECT only; flags are written by a
--                                 platform-staff script as the owner, never by
--                                 the application.
-- No sequence grant: an identity column's sequence is used with the table's
-- INSERT/UPDATE privilege.
--
-- Written for PostgreSQL 14 and later: no syntax introduced after 14.
--
-- Rollback: 202610191200_create_multi_region_scan_foundation_rollback.sql
-- (manual; database/migrate.js never runs a file whose name contains
-- "rollback").

-- ADD COLUMN takes a brief ACCESS EXCLUSIVE lock on resource_discovery_jobs
-- (no default, so no table rewrite). Fail instead of queueing behind long
-- transactions, which would block every later reader while it waited.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  marker CONSTANT TEXT := '[202610191200_create_multi_region_scan_foundation]';
  t TEXT;
  existing_type TEXT;
BEGIN
  IF to_regclass('organizations') IS NULL THEN
    RAISE EXCEPTION 'organizations does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('resource_discovery_jobs') IS NULL THEN
    RAISE EXCEPTION 'resource_discovery_jobs does not exist -- refusing to proceed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcontrol') THEN
    RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.';
  END IF;

  FOREACH t IN ARRAY ARRAY['aws_account_regions', 'aws_scan_leases', 'job_leases', 'organization_feature_flags'] LOOP
    IF to_regclass(t) IS NOT NULL
       AND COALESCE(obj_description(to_regclass(t), 'pg_class'), '') NOT LIKE marker || '%' THEN
      RAISE EXCEPTION
        '% already exists and was not created by this migration -- refusing to proceed. '
        'Investigate before re-running.', t;
    END IF;
  END LOOP;

  SELECT format_type(atttypid, atttypmod) INTO existing_type
    FROM pg_attribute
   WHERE attrelid = 'resource_discovery_jobs'::regclass AND attname = 'warnings' AND NOT attisdropped;
  IF existing_type IS NULL THEN
    ALTER TABLE resource_discovery_jobs ADD COLUMN IF NOT EXISTS warnings JSONB;
    EXECUTE format(
      'COMMENT ON COLUMN resource_discovery_jobs.warnings IS %L',
      marker || ' Non-fatal problems recorded by the discovery job (for example a region or '
             || 'source that could not be read), as a JSON array. NULL means none were recorded.');
  ELSIF existing_type <> 'jsonb' THEN
    RAISE EXCEPTION
      'resource_discovery_jobs.warnings already exists with type % (expected jsonb) -- refusing to proceed.',
      existing_type;
  ELSIF COALESCE(col_description('resource_discovery_jobs'::regclass,
                                 (SELECT attnum FROM pg_attribute
                                   WHERE attrelid = 'resource_discovery_jobs'::regclass
                                     AND attname = 'warnings' AND NOT attisdropped)), '') LIKE marker || '%' THEN
    RAISE NOTICE 'resource_discovery_jobs.warnings was already added by this migration; nothing to do.';
  ELSE
    RAISE NOTICE 'resource_discovery_jobs.warnings already exists as jsonb (not added by this migration); left as it is.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- aws_account_regions
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aws_account_regions (
  organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The 12-digit AWS account id. Not a foreign key: aws_accounts has no
  -- canonical definition, and the history should survive a reconnect.
  aws_account_id        VARCHAR(12) NOT NULL CHECK (aws_account_id ~ '^[0-9]{12}$'),
  region                VARCHAR(32) NOT NULL CHECK (region ~ '^[a-z]{2}(-[a-z]+)+-[0-9]{1,2}$'),
  -- As reported by the region list (e.g. opt-in-not-required, opted-in,
  -- not-opted-in); NULL until listed.
  opt_in_status         VARCHAR(32) CHECK (opt_in_status ~ '^[a-z][a-z-]{0,31}$'),
  enabled               BOOLEAN NOT NULL,
  -- The customer allow-list: false = never scanned even when enabled.
  scan_enabled          BOOLEAN NOT NULL DEFAULT true,
  first_seen_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_listed_at        TIMESTAMPTZ,
  -- Set when a previously enabled region is reported not enabled.
  disabled_at           TIMESTAMPTZ,
  last_scan_started_at  TIMESTAMPTZ,
  last_scan_finished_at TIMESTAMPTZ,
  last_success_at       TIMESTAMPTZ,
  last_scan_status      VARCHAR(16) NOT NULL DEFAULT 'never_scanned'
                          CHECK (last_scan_status IN ('ok', 'partial', 'denied', 'failed', 'timed_out',
                                                      'skipped_locked', 'not_enabled', 'never_scanned')),
  -- An AWS or internal error code, never a message.
  last_error_code       VARCHAR(64) CHECK (last_error_code ~ '^[A-Za-z][A-Za-z0-9_.:-]{0,63}$'),
  -- Sanitised by the writer: no ARNs with account ids, no request ids.
  last_error_message    TEXT CHECK (char_length(last_error_message) <= 500),
  consecutive_failures  INTEGER NOT NULL DEFAULT 0 CHECK (consecutive_failures >= 0),
  updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, aws_account_id, region),
  CONSTRAINT aws_account_regions_scan_time_order
    CHECK (last_scan_finished_at IS NULL OR last_scan_started_at IS NULL
           OR last_scan_finished_at >= last_scan_started_at),
  CONSTRAINT aws_account_regions_error_only_with_code
    CHECK (last_error_message IS NULL OR last_error_code IS NOT NULL)
);

-- The scanner's "regions to scan for this account" read.
CREATE INDEX IF NOT EXISTS aws_account_regions_scannable
  ON aws_account_regions (organization_id, aws_account_id)
  WHERE enabled AND scan_enabled;

-- ---------------------------------------------------------------------------
-- aws_scan_leases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS aws_scan_leases (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  aws_account_id  VARCHAR(12) NOT NULL CHECK (aws_account_id ~ '^[0-9]{12}$'),
  -- 'discovery' first; e.g. 'security_hub_sync', 'cost_analyze' later.
  scan_kind       VARCHAR(32) NOT NULL CHECK (scan_kind ~ '^[a-z][a-z0-9_]{0,31}$'),
  fencing_token   BIGINT GENERATED ALWAYS AS IDENTITY (NO CYCLE),
  -- <hostname>:<pid>:<run id>, for logs only; kept after release.
  holder          VARCHAR(255) NOT NULL CHECK (char_length(holder) > 0),
  -- resource_discovery_jobs.id of the scan, when there is one. Not a foreign
  -- key: that would add a trigger to an existing table.
  job_id          UUID,
  acquired_at     TIMESTAMPTZ NOT NULL,
  heartbeat_at    TIMESTAMPTZ NOT NULL,
  expires_at      TIMESTAMPTZ NOT NULL,
  released_at     TIMESTAMPTZ,
  PRIMARY KEY (organization_id, aws_account_id, scan_kind),
  CONSTRAINT aws_scan_leases_fencing_token_unique UNIQUE (fencing_token),
  CONSTRAINT aws_scan_leases_time_order
    CHECK (heartbeat_at >= acquired_at AND expires_at > acquired_at
           AND (released_at IS NULL OR released_at >= acquired_at))
);

-- Leases currently not released, per organization ("scan in progress since").
CREATE INDEX IF NOT EXISTS aws_scan_leases_unreleased
  ON aws_scan_leases (organization_id, expires_at)
  WHERE released_at IS NULL;

-- ---------------------------------------------------------------------------
-- job_leases
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS job_leases (
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- e.g. 'resource_discovery'.
  job_name          VARCHAR(64) NOT NULL CHECK (job_name ~ '^[a-z][a-z0-9_]{0,63}$'),
  fencing_token     BIGINT GENERATED ALWAYS AS IDENTITY (NO CYCLE),
  holder            VARCHAR(255) NOT NULL CHECK (char_length(holder) > 0),
  acquired_at       TIMESTAMPTZ NOT NULL,
  heartbeat_at      TIMESTAMPTZ NOT NULL,
  expires_at        TIMESTAMPTZ NOT NULL,
  released_at       TIMESTAMPTZ,
  -- Set by the holder whose token is current when the run finishes; a tick
  -- skips the job while this is recent.
  last_completed_at TIMESTAMPTZ,
  PRIMARY KEY (organization_id, job_name),
  CONSTRAINT job_leases_fencing_token_unique UNIQUE (fencing_token),
  CONSTRAINT job_leases_time_order
    CHECK (heartbeat_at >= acquired_at AND expires_at > acquired_at
           AND (released_at IS NULL OR released_at >= acquired_at))
);

CREATE INDEX IF NOT EXISTS job_leases_unreleased
  ON job_leases (organization_id, expires_at)
  WHERE released_at IS NULL;

-- ---------------------------------------------------------------------------
-- organization_feature_flags
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS organization_feature_flags (
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- e.g. 'multi_region_discovery'.
  flag            VARCHAR(64) NOT NULL CHECK (flag ~ '^[a-z][a-z0-9_]{0,63}$'),
  enabled         BOOLEAN NOT NULL DEFAULT false,
  -- Who set it (a platform-staff identifier), for audit; never a secret.
  set_by          TEXT CHECK (char_length(set_by) <= 255),
  set_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  note            TEXT CHECK (char_length(note) <= 500),
  PRIMARY KEY (organization_id, flag)
);

-- Organizations a flag is ON for (rollout review).
CREATE INDEX IF NOT EXISTS organization_feature_flags_enabled
  ON organization_feature_flags (flag, organization_id)
  WHERE enabled;

-- ---------------------------------------------------------------------------
-- Comments (the table comment's leading marker is what the rollback checks)
-- ---------------------------------------------------------------------------
COMMENT ON TABLE aws_account_regions IS
  '[202610191200_create_multi_region_scan_foundation] Per organization, AWS account and region: '
  'whether the region is enabled and may be scanned, and the latest scan''s status, times and error.';
COMMENT ON COLUMN aws_account_regions.enabled IS 'Derived from opt_in_status: the region can be scanned.';
COMMENT ON COLUMN aws_account_regions.scan_enabled IS 'Customer allow-list; false = never scanned.';
COMMENT ON COLUMN aws_account_regions.last_scan_status IS
  'ok, partial, denied, failed, timed_out, skipped_locked, not_enabled or never_scanned.';
COMMENT ON COLUMN aws_account_regions.last_error_message IS
  'Sanitised, at most 500 characters: no ARNs with account ids, no request ids.';

COMMENT ON TABLE aws_scan_leases IS
  '[202610191200_create_multi_region_scan_foundation] One scan at a time per organization, AWS account '
  'and scan kind. Held by fencing_token while released_at IS NULL AND expires_at > now(). Rows are never '
  'deleted; see the migration header for the acquire/renew/commit/release contract.';
COMMENT ON COLUMN aws_scan_leases.fencing_token IS
  'Current holder''s token. Database-generated on every acquisition (fencing_token = DEFAULT), '
  'strictly increasing per key, unique and never reused. Renew, release and destructive commits '
  'proceed only while it still equals the caller''s token.';
COMMENT ON COLUMN aws_scan_leases.holder IS '<hostname>:<pid>:<run id>, for logs only.';
COMMENT ON COLUMN aws_scan_leases.job_id IS 'resource_discovery_jobs.id of the scan, if any (not a foreign key).';

COMMENT ON TABLE job_leases IS
  '[202610191200_create_multi_region_scan_foundation] One run of a scheduled job at a time per '
  'organization and job name. Same fencing-token contract as aws_scan_leases; rows are never deleted.';
COMMENT ON COLUMN job_leases.fencing_token IS
  'Current holder''s token. Database-generated on every acquisition (fencing_token = DEFAULT), '
  'strictly increasing per key, unique and never reused. Renew, release and completion '
  'proceed only while it still equals the caller''s token.';
COMMENT ON COLUMN job_leases.last_completed_at IS
  'Set at completion by the holder whose token is current.';

COMMENT ON TABLE organization_feature_flags IS
  '[202610191200_create_multi_region_scan_foundation] Per-organization feature flags. No row, or '
  'enabled = false, means OFF. Written only by a platform-staff script as the table owner.';

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------
ALTER TABLE aws_account_regions ENABLE ROW LEVEL SECURITY;
ALTER TABLE aws_account_regions FORCE ROW LEVEL SECURITY;
ALTER TABLE aws_scan_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE aws_scan_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE job_leases ENABLE ROW LEVEL SECURITY;
ALTER TABLE job_leases FORCE ROW LEVEL SECURITY;
ALTER TABLE organization_feature_flags ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_feature_flags FORCE ROW LEVEL SECURITY;

DO $$
DECLARE
  t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['aws_account_regions', 'aws_scan_leases', 'job_leases', 'organization_feature_flags'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policy WHERE polrelid = to_regclass(t) AND polname = t || '_tenant'
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON %I FOR ALL '
        'USING (organization_id = NULLIF(current_setting(''app.current_organization_id'', true), '''')::uuid) '
        'WITH CHECK (organization_id = NULLIF(current_setting(''app.current_organization_id'', true), '''')::uuid)',
        t || '_tenant', t);
    END IF;
  END LOOP;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE aws_account_regions TO devcontrol;
GRANT SELECT, INSERT, UPDATE ON TABLE aws_scan_leases TO devcontrol;
GRANT SELECT, INSERT, UPDATE ON TABLE job_leases TO devcontrol;
GRANT SELECT ON TABLE organization_feature_flags TO devcontrol;
