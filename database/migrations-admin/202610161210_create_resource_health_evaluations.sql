-- Migration: create resource health evaluation storage
--
-- Persisted per-resource health evaluations for Services Intelligence: a
-- scheduled job (a later change) evaluates each organization's resources and
-- writes one run plus one result per evaluated resource; GET
-- /api/services/intelligence then reads stored results instead of a
-- per-process in-memory cache, so restarts and multiple processes no longer
-- decide whether health is reported. This migration only creates storage;
-- nothing writes or reads these tables yet.
--
-- ADMINISTRATIVE MIGRATION (see database/migrations-admin/README.md):
--   - the new tables' composite foreign keys need a unique constraint on the
--     postgres-owned aws_resources (added only when none exists, see below);
--   - ENABLE/FORCE ROW LEVEL SECURITY and CREATE POLICY on the new tables,
--     which the postgres role creates and therefore owns.
--
-- A plain CREATE: it refuses to run if either table already exists.
--
-- aws_resources (id, organization_id) UNIQUENESS. The composite foreign key
-- below needs a unique constraint over exactly (id, organization_id).
-- 202610112300_create_framework_evaluation_persistence.sql already adds or
-- reuses one, and sorts before this file everywhere (production applied it
-- first; CI and local bootstraps sort it first). So this migration:
--   - reuses any existing unique/primary-key constraint over exactly
--     (id, organization_id), whatever its name, and adds nothing -- the
--     expected case on every database; or
--   - when there is none, adds its own, aws_resources_id_org_unique.
-- The paired rollback drops only aws_resources_id_org_unique, and only when
-- no other foreign key uses it; a reused constraint is never dropped.
--
-- Tenant integrity is enforced by the database, not by the writer: a result
-- references its run by (run_id, organization_id) and its resource by
-- (resource_id, organization_id), so a result's organization must equal both
-- its run's and its resource's.
--
-- Run lifecycle (enforced by CHECK constraints):
--   running   claimed and in progress; at most one per organization
--             (resource_health_evaluation_runs_one_running).
--   complete  finished; every evaluable resource was evaluated (failed_count = 0).
--   partial   finished; at least one resource could not be evaluated
--             (failed_count > 0), recorded as an 'evaluation_failed' result.
--   failed    the run as a whole failed (failure_code says why; 'abandoned'
--             for a running run that outlived its time limit).
--
-- Results carry their own evidence, so a stored row is read as written,
-- never re-derived from rows that may have changed since:
--   health_state           the state shown for the resource (checks_passing,
--                          check_failing, no_signal), as decided at evaluation
--                          time; not_supported resources get no row.
--   reason_code            why the state is no_signal; set exactly then.
--   lifecycle_state        aws_resources.status when evaluated.
--   telemetry_observed_at  when the newest datapoint or observation the check
--                          used was taken (NULL when there was none).
--   evidence_basis         what kind of evidence decided the state.
--   evidence               small, versioned, structured detail (an object
--                          with schema_version, at most 4 KiB) -- the evidence
--                          contract of 202610112300.
-- NO FREE TEXT: every explanatory column is a code checked against a format;
-- wording is rendered by the application. A passing or failing state needs
-- evidence (basis not 'none' or 'tag'); passing additionally needs a
-- monitored resource whose check reported healthy.
--
-- Staleness, and how stale, failed, partial and abandoned evaluations are
-- shown, are defined in database/migrations-admin/README.md ("Showing stored
-- resource health"). A run's evaluated_at is the time staleness is measured
-- from.
--
-- Row-level security is ENABLED and FORCED on both tables. The policy reads
-- app.current_organization_id: an unset or empty value matches no row, and a
-- value that is not a UUID raises an error -- both fail closed.
--
-- devcontrol receives SELECT, INSERT, UPDATE and DELETE only. Not TRUNCATE:
-- TRUNCATE is not subject to row-level security.
--
-- Written for PostgreSQL 14 and later: no syntax introduced after 14.
--
-- Rollback: 202610161210_create_resource_health_evaluations_rollback.sql
-- (manual; database/migrate.js never runs a file whose name contains
-- "rollback").

-- Adding the aws_resources constraint (only when none exists) takes an ACCESS
-- EXCLUSIVE lock while it builds its index. Fail instead of queueing behind
-- long transactions, which would block every later reader of aws_resources
-- while it waited.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  id_attnum  SMALLINT;
  org_attnum SMALLINT;
BEGIN
  IF to_regclass('organizations') IS NULL THEN
    RAISE EXCEPTION 'organizations does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('aws_resources') IS NULL THEN
    RAISE EXCEPTION 'aws_resources does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('resource_health_evaluation_runs') IS NOT NULL
     OR to_regclass('resource_health_evaluation_results') IS NOT NULL THEN
    RAISE EXCEPTION
      'resource_health_evaluation_runs or resource_health_evaluation_results already exists -- '
      'this migration creates them and refuses to proceed. Investigate before re-running.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcontrol') THEN
    RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.';
  END IF;

  SELECT attnum INTO id_attnum FROM pg_attribute
   WHERE attrelid = 'aws_resources'::regclass AND attname = 'id' AND NOT attisdropped;
  SELECT attnum INTO org_attnum FROM pg_attribute
   WHERE attrelid = 'aws_resources'::regclass AND attname = 'organization_id' AND NOT attisdropped;
  IF id_attnum IS NULL OR org_attnum IS NULL THEN
    RAISE EXCEPTION 'aws_resources has no id or organization_id column -- refusing to proceed.';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'aws_resources'::regclass
       AND contype IN ('u', 'p')
       AND conkey = ARRAY[id_attnum, org_attnum]
  ) THEN
    RAISE NOTICE 'aws_resources already has a unique constraint over (id, organization_id); reusing it.';
  ELSE
    IF EXISTS (
      SELECT 1 FROM pg_constraint
       WHERE conname = 'aws_resources_id_org_unique' AND conrelid = 'aws_resources'::regclass
    ) THEN
      RAISE EXCEPTION
        'aws_resources_id_org_unique exists but is not a unique constraint over (id, organization_id) -- '
        'refusing to proceed. Investigate before re-running.';
    END IF;
    -- id is already the primary key, so this cannot fail on existing rows.
    ALTER TABLE aws_resources
      ADD CONSTRAINT aws_resources_id_org_unique UNIQUE (id, organization_id);
    RAISE NOTICE 'Added aws_resources_id_org_unique UNIQUE (id, organization_id).';
  END IF;
END $$;

CREATE TABLE resource_health_evaluation_runs (
  id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status            VARCHAR(16) NOT NULL
                      CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  -- What produced the run, e.g. the scheduled evaluator.
  source            VARCHAR(32) NOT NULL CHECK (source ~ '^[a-z][a-z0-9_]{0,31}$'),
  evaluator_version VARCHAR(32) NOT NULL
                      CHECK (evaluator_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  evaluation_range  VARCHAR(8) NOT NULL CHECK (evaluation_range IN ('1h')),
  started_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The end of the metric window the evaluation used. Set when the run
  -- finishes; staleness is measured from it.
  evaluated_at      TIMESTAMPTZ,
  finished_at       TIMESTAMPTZ,
  inventory_count   INTEGER CHECK (inventory_count >= 0),
  evaluated_count   INTEGER CHECK (evaluated_count >= 0),
  failed_count      INTEGER CHECK (failed_count >= 0),
  -- Per resource type: { inventory, evaluated, failed }.
  type_outcomes     JSONB,
  failure_code      VARCHAR(32)
                      CHECK (failure_code IN ('client_unavailable', 'timeout', 'abandoned', 'persist_error', 'unexpected')),
  CONSTRAINT resource_health_evaluation_runs_id_org_unique UNIQUE (id, organization_id),
  CONSTRAINT resource_health_evaluation_runs_lifecycle CHECK (
       (status = 'running'
          AND finished_at IS NULL AND evaluated_at IS NULL AND failure_code IS NULL)
    OR (status IN ('complete', 'partial')
          AND finished_at IS NOT NULL AND evaluated_at IS NOT NULL AND failure_code IS NULL
          AND inventory_count IS NOT NULL AND evaluated_count IS NOT NULL AND failed_count IS NOT NULL)
    OR (status = 'failed'
          AND finished_at IS NOT NULL AND failure_code IS NOT NULL)
  ),
  CONSTRAINT resource_health_evaluation_runs_complete_no_failures
    CHECK (status <> 'complete' OR failed_count = 0),
  CONSTRAINT resource_health_evaluation_runs_partial_has_failures
    CHECK (status <> 'partial' OR failed_count > 0),
  CONSTRAINT resource_health_evaluation_runs_time_order
    CHECK (finished_at IS NULL OR finished_at >= started_at)
);

-- At most one run in progress per organization, whichever process claims it.
CREATE UNIQUE INDEX resource_health_evaluation_runs_one_running
  ON resource_health_evaluation_runs (organization_id) WHERE status = 'running';

-- Latest run per organization (any status), and retention by age.
CREATE INDEX resource_health_evaluation_runs_org_started
  ON resource_health_evaluation_runs (organization_id, started_at DESC);

-- Latest finished run per organization: the run health is read from.
CREATE INDEX resource_health_evaluation_runs_org_finished
  ON resource_health_evaluation_runs (organization_id, evaluated_at DESC)
  WHERE status IN ('complete', 'partial');

CREATE TABLE resource_health_evaluation_results (
  run_id                UUID NOT NULL,
  organization_id       UUID NOT NULL,
  -- aws_resources.id
  resource_id           UUID NOT NULL,
  resource_type         VARCHAR(50) NOT NULL,
  outcome               VARCHAR(20) NOT NULL CHECK (outcome IN ('evaluated', 'evaluation_failed')),
  evaluator_status      VARCHAR(16)
                          CHECK (evaluator_status IN ('healthy', 'degraded', 'critical', 'down', 'unknown')),
  monitored             BOOLEAN,
  check_name            VARCHAR(64) CHECK (check_name ~ '^[a-z][a-z0-9_]{0,63}$'),
  health_state          VARCHAR(16) NOT NULL
                          CHECK (health_state IN ('checks_passing', 'check_failing', 'no_signal')),
  reason_code           VARCHAR(48) CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,47}$'),
  -- aws_resources.status at evaluation time. AWS state names only.
  lifecycle_state       VARCHAR(64) CHECK (lifecycle_state ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  telemetry_observed_at TIMESTAMPTZ,
  evidence_basis        VARCHAR(32) NOT NULL CHECK (evidence_basis ~ '^[a-z][a-z0-9_]{0,31}$'),
  evidence              JSONB,
  -- Equal to the run's evaluated_at; kept here so the reader's index covers it.
  evaluated_at          TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (run_id, resource_id),
  CONSTRAINT resource_health_evaluation_results_run_fk
    FOREIGN KEY (run_id, organization_id)
    REFERENCES resource_health_evaluation_runs (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT resource_health_evaluation_results_resource_fk
    FOREIGN KEY (resource_id, organization_id)
    REFERENCES aws_resources (id, organization_id) ON DELETE CASCADE,
  -- An evaluated row says what the check reported; a failed one says nothing
  -- about the resource and can only be no_signal. Written so that no branch
  -- can evaluate to NULL (which a CHECK would accept).
  CONSTRAINT resource_health_evaluation_results_outcome_shape CHECK (
       (outcome = 'evaluated'
          AND evaluator_status IS NOT NULL AND monitored IS NOT NULL AND check_name IS NOT NULL)
    OR (outcome = 'evaluation_failed'
          AND evaluator_status IS NULL AND monitored IS NULL AND check_name IS NULL
          AND health_state = 'no_signal' AND telemetry_observed_at IS NULL)
  ),
  -- A reason exactly when there is no signal.
  CONSTRAINT resource_health_evaluation_results_reason_only_on_no_signal
    CHECK ((health_state = 'no_signal') = (reason_code IS NOT NULL)),
  -- Passing needs a monitored resource whose check reported healthy.
  CONSTRAINT resource_health_evaluation_results_passing_needs_healthy_check
    CHECK (health_state <> 'checks_passing'
           OR (outcome = 'evaluated' AND monitored IS TRUE AND evaluator_status = 'healthy')),
  -- A pass or a fail needs evidence. A tag, or nothing, is not evidence.
  CONSTRAINT resource_health_evaluation_results_conclusive_needs_evidence
    CHECK (health_state NOT IN ('checks_passing', 'check_failing') OR evidence_basis NOT IN ('tag', 'none')),
  -- Small, versioned, structured evidence only -- never a raw AWS response.
  CONSTRAINT resource_health_evaluation_results_evidence_shape CHECK (
    evidence IS NULL
    OR (jsonb_typeof(evidence) = 'object' AND evidence ? 'schema_version' AND pg_column_size(evidence) <= 4096)
  )
);

-- The reader's latest result per resource, and the cascade from aws_resources
-- on (resource_id, organization_id). The cascade from a run uses the primary key.
CREATE INDEX resource_health_evaluation_results_org_resource_time
  ON resource_health_evaluation_results (organization_id, resource_id, evaluated_at DESC);

ALTER TABLE resource_health_evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_health_evaluation_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE resource_health_evaluation_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_health_evaluation_results FORCE ROW LEVEL SECURITY;

CREATE POLICY resource_health_evaluation_runs_tenant ON resource_health_evaluation_runs
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

CREATE POLICY resource_health_evaluation_results_tenant ON resource_health_evaluation_results
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE resource_health_evaluation_runs TO devcontrol;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE resource_health_evaluation_results TO devcontrol;
