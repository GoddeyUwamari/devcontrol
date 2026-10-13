-- Migration: framework evaluation persistence
-- Created: 2026-10-11
--
-- ADMINISTRATIVE (postgres role, database/migrations-admin/): creates tables
-- the application role must not own, forces row-level security on them, and
-- may add a unique constraint to aws_resources (postgres-owned).
--
-- Three tables:
--
--   framework_evaluation_runs          history: one row per organization x
--                                      framework x compliance scan. Says why a
--                                      framework was or was not evaluated, and
--                                      how the scan ended.
--   compliance_check_evaluations       current state: one row per resource x
--                                      check, whatever the outcome (failed,
--                                      passed, unable_to_evaluate, error,
--                                      not_evaluated, not_applicable).
--   framework_evaluation_reconciliations
--                                      one row per resource whose evaluation
--                                      could not be stored on the last attempt.
--
-- aws_resources.compliance_issues is NOT changed here: it stays the list of
-- current failures only, rebuilt from compliance_check_evaluations by the scan.
--
-- ORDERING. A check row is ordered by framework_evaluation_runs.generation, a
-- database-assigned identity, never by a timestamp. compliance_check_evaluations
-- carries the generation as a plain value (run_generation), deliberately NOT a
-- foreign key: pruning run history can then never remove or alter current state.
--
-- NO FREE TEXT. Every explanatory column is a short code checked against a
-- format; wording is rendered by the application from the code. There is no
-- column an exception message, an ARN or an AWS response could be written to.
--
-- aws_resources (id, organization_id) UNIQUENESS. The composite foreign keys
-- below need a unique constraint over exactly (id, organization_id). Another
-- pending migration (resource health evaluations) adds one named
-- aws_resources_id_org_unique and refuses to run if that NAME already exists.
-- So this migration:
--   - reuses any existing unique/primary-key constraint over exactly
--     (id, organization_id), whatever its name, and adds nothing; or
--   - when there is none, adds its own under a DIFFERENT name
--     (aws_resources_compliance_evaluation_ref_key), which leaves the other
--     migration free to apply afterwards unedited.
-- The paired rollback only ever drops aws_resources_compliance_evaluation_ref_key,
-- and only when no foreign key still uses it.
--
-- Plain create: refuses to run if any of the three tables already exists.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('organizations') IS NULL THEN
    RAISE EXCEPTION 'organizations does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('aws_resources') IS NULL THEN
    RAISE EXCEPTION 'aws_resources does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('resource_discovery_jobs') IS NULL THEN
    RAISE EXCEPTION 'resource_discovery_jobs does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('framework_evaluation_runs') IS NOT NULL
     OR to_regclass('compliance_check_evaluations') IS NOT NULL
     OR to_regclass('framework_evaluation_reconciliations') IS NOT NULL THEN
    RAISE EXCEPTION
      'framework_evaluation_runs, compliance_check_evaluations or framework_evaluation_reconciliations '
      'already exists -- this migration creates them and refuses to proceed. Investigate before re-running.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'aws_resources_compliance_evaluation_ref_key' AND conrelid = 'aws_resources'::regclass
  ) THEN
    RAISE EXCEPTION
      'aws_resources_compliance_evaluation_ref_key already exists -- refusing to proceed. Investigate before re-running.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcontrol') THEN
    RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.';
  END IF;
END $$;

-- Reuse a suitable constraint when one exists; add our own only when none does.
DO $$
DECLARE
  id_attnum  SMALLINT;
  org_attnum SMALLINT;
BEGIN
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
    ALTER TABLE aws_resources
      ADD CONSTRAINT aws_resources_compliance_evaluation_ref_key UNIQUE (id, organization_id);
    RAISE NOTICE 'Added aws_resources_compliance_evaluation_ref_key UNIQUE (id, organization_id).';
  END IF;
END $$;

-- =====================================================================
-- framework_evaluation_runs (history)
-- =====================================================================
CREATE TABLE framework_evaluation_runs (
  id                        UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id           UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  -- The only ordering key. Assigned by the database, so application clocks
  -- cannot reorder runs. Never returned to a client: it is one sequence for
  -- every organization, and its gaps would reveal other tenants' activity.
  generation                BIGINT GENERATED ALWAYS AS IDENTITY,
  framework                 VARCHAR(64) NOT NULL
                              CHECK (framework ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  applicability             VARCHAR(16) NOT NULL
                              CHECK (applicability IN ('enabled', 'disabled', 'not_configured', 'unavailable', 'invalid')),
  applicability_reason_code VARCHAR(48) NOT NULL
                              CHECK (applicability_reason_code ~ '^[a-z][a-z0-9_]{0,47}$'),
  status                    VARCHAR(16) NOT NULL DEFAULT 'running'
                              CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  started_at                TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  heartbeat_at              TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  finished_at               TIMESTAMPTZ,
  -- Single-column key: resource_discovery_jobs has no (id, organization_id)
  -- constraint. The application inserts this value through a subquery that
  -- also matches the job's organization, so a foreign job is recorded as NULL.
  discovery_job_id          UUID REFERENCES resource_discovery_jobs(id) ON DELETE SET NULL,
  evaluator_version         VARCHAR(32) NOT NULL
                              CHECK (evaluator_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  resources_in_scope        INTEGER CHECK (resources_in_scope >= 0),
  resources_persisted       INTEGER CHECK (resources_persisted >= 0),
  resources_failed          INTEGER CHECK (resources_failed >= 0),
  -- Per-state counts at the moment the run finished. Historical only: current
  -- counts are always read from compliance_check_evaluations.
  state_counts              JSONB CHECK (state_counts IS NULL OR jsonb_typeof(state_counts) = 'object'),
  failure_code              VARCHAR(16)
                              CHECK (failure_code IN ('abandoned', 'persist_error', 'unexpected')),
  CONSTRAINT framework_evaluation_runs_generation_unique UNIQUE (generation),
  CONSTRAINT framework_evaluation_runs_lifecycle CHECK (
       (status = 'running'
          AND finished_at IS NULL AND failure_code IS NULL)
    OR (status IN ('complete', 'partial')
          AND finished_at IS NOT NULL AND failure_code IS NULL
          AND resources_in_scope IS NOT NULL AND resources_persisted IS NOT NULL AND resources_failed IS NOT NULL)
    OR (status = 'failed'
          AND finished_at IS NOT NULL AND failure_code IS NOT NULL)
  ),
  -- complete = every resource's evaluation was stored; partial = at least one was not.
  CONSTRAINT framework_evaluation_runs_complete_no_failures
    CHECK (status <> 'complete' OR resources_failed = 0),
  CONSTRAINT framework_evaluation_runs_partial_has_failures
    CHECK (status <> 'partial' OR resources_failed > 0)
);

-- "Latest finished run for this organization and framework", and pruning.
CREATE INDEX framework_evaluation_runs_org_framework_generation
  ON framework_evaluation_runs (organization_id, framework, generation DESC);

-- The abandoned-run sweep and the API's "a scan is running" flag.
CREATE INDEX framework_evaluation_runs_org_running
  ON framework_evaluation_runs (organization_id) WHERE status = 'running';

-- =====================================================================
-- compliance_check_evaluations (current state)
-- =====================================================================
CREATE TABLE compliance_check_evaluations (
  organization_id          UUID NOT NULL,
  resource_id              UUID NOT NULL,
  -- What produced the check. 'framework' + the framework key today; a later
  -- evaluation domain is another source_kind, with no schema change.
  source_kind              VARCHAR(32) NOT NULL CHECK (source_kind ~ '^[a-z][a-z0-9_]{0,31}$'),
  source_key               VARCHAR(64) NOT NULL CHECK (source_key ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$'),
  check_key                VARCHAR(96) NOT NULL CHECK (check_key ~ '^[a-z0-9][a-z0-9._-]{0,95}$'),
  evaluation_state         VARCHAR(24) NOT NULL
                             CHECK (evaluation_state IN
                               ('failed', 'passed', 'unable_to_evaluate', 'error', 'not_evaluated', 'not_applicable')),
  severity                 VARCHAR(10) CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  evidence_basis           VARCHAR(32) NOT NULL CHECK (evidence_basis ~ '^[a-z][a-z0-9_]{0,31}$'),
  provenance               VARCHAR(16) CHECK (provenance IN ('OBSERVED', 'DERIVED', 'SELF_ATTESTED')),
  reason_code              VARCHAR(48) NOT NULL CHECK (reason_code ~ '^[a-z][a-z0-9_]{0,47}$'),
  error_code               VARCHAR(48) CHECK (error_code ~ '^[a-z][a-z0-9_]{0,47}$'),
  evidence                 JSONB,
  evaluated_at             TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  -- framework_evaluation_runs.generation of the run that wrote this row. Not a
  -- foreign key (see ORDERING above).
  run_generation           BIGINT NOT NULL,
  evaluator_version        VARCHAR(32) NOT NULL
                             CHECK (evaluator_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,31}$'),
  -- The last real pass or fail, kept while the current state is not one.
  last_conclusive_state    VARCHAR(8) CHECK (last_conclusive_state IN ('failed', 'passed')),
  last_conclusive_at       TIMESTAMPTZ,
  last_conclusive_severity VARCHAR(10) CHECK (last_conclusive_severity IN ('critical', 'high', 'medium', 'low')),
  PRIMARY KEY (organization_id, resource_id, source_kind, source_key, check_key),
  -- The resource belongs to the same organization as the row, enforced by the
  -- database. Deleting the resource removes its evaluations.
  CONSTRAINT compliance_check_evaluations_resource_fk
    FOREIGN KEY (resource_id, organization_id)
    REFERENCES aws_resources (id, organization_id) ON DELETE CASCADE,
  -- Severity says how much a failure matters. Nothing else has one.
  CONSTRAINT compliance_check_evaluations_severity_only_on_failed
    CHECK ((evaluation_state = 'failed') = (severity IS NOT NULL)),
  CONSTRAINT compliance_check_evaluations_error_code_only_on_error
    CHECK ((evaluation_state = 'error') = (error_code IS NOT NULL)),
  -- A pass or a fail needs evidence. A tag, or nothing, is not evidence.
  CONSTRAINT compliance_check_evaluations_conclusive_needs_evidence
    CHECK (evaluation_state NOT IN ('failed', 'passed') OR evidence_basis NOT IN ('tag', 'none')),
  -- All three unset, or state and time set with a severity exactly when the state
  -- is 'failed'. Written so that no branch can evaluate to NULL (which a CHECK
  -- would accept).
  CONSTRAINT compliance_check_evaluations_last_conclusive_shape CHECK (
       (last_conclusive_state IS NULL AND last_conclusive_at IS NULL AND last_conclusive_severity IS NULL)
    OR (last_conclusive_state IS NOT NULL AND last_conclusive_at IS NOT NULL
        AND (last_conclusive_state = 'failed') = (last_conclusive_severity IS NOT NULL))
  ),
  -- Small, versioned, structured evidence only -- never a raw AWS response.
  CONSTRAINT compliance_check_evaluations_evidence_shape CHECK (
    evidence IS NULL
    OR (jsonb_typeof(evidence) = 'object' AND evidence ? 'schema_version' AND pg_column_size(evidence) <= 4096)
  )
);

-- Per-framework state counts for an organization.
CREATE INDEX compliance_check_evaluations_org_source_state
  ON compliance_check_evaluations (organization_id, source_kind, source_key, evaluation_state);

-- =====================================================================
-- framework_evaluation_reconciliations
-- =====================================================================
-- A row exists exactly while a resource's last evaluation could not be stored.
-- The scan writes it after the failed transaction has rolled back, and the
-- next successful transaction for that resource deletes it.
CREATE TABLE framework_evaluation_reconciliations (
  organization_id     UUID NOT NULL,
  resource_id         UUID NOT NULL,
  first_failed_at     TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  last_failed_at      TIMESTAMPTZ NOT NULL DEFAULT clock_timestamp(),
  failure_count       INTEGER NOT NULL DEFAULT 1 CHECK (failure_count >= 1),
  failure_code        VARCHAR(48) NOT NULL CHECK (failure_code ~ '^[a-z][a-z0-9_]{0,47}$'),
  last_run_generation BIGINT NOT NULL,
  PRIMARY KEY (organization_id, resource_id),
  CONSTRAINT framework_evaluation_reconciliations_resource_fk
    FOREIGN KEY (resource_id, organization_id)
    REFERENCES aws_resources (id, organization_id) ON DELETE CASCADE
);

-- =====================================================================
-- Row-level security and grants
-- =====================================================================
-- postgres owns these tables and devcontrol does not, so the policies apply to
-- the application role. FORCE also applies them to the owner.
ALTER TABLE framework_evaluation_runs ENABLE ROW LEVEL SECURITY;
ALTER TABLE framework_evaluation_runs FORCE ROW LEVEL SECURITY;
ALTER TABLE compliance_check_evaluations ENABLE ROW LEVEL SECURITY;
ALTER TABLE compliance_check_evaluations FORCE ROW LEVEL SECURITY;
ALTER TABLE framework_evaluation_reconciliations ENABLE ROW LEVEL SECURITY;
ALTER TABLE framework_evaluation_reconciliations FORCE ROW LEVEL SECURITY;

CREATE POLICY framework_evaluation_runs_tenant ON framework_evaluation_runs
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

CREATE POLICY compliance_check_evaluations_tenant ON compliance_check_evaluations
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

CREATE POLICY framework_evaluation_reconciliations_tenant ON framework_evaluation_reconciliations
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

-- No TRUNCATE (row-level security does not apply to it). No sequence grant:
-- an identity column's sequence is used with the table's INSERT privilege.
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE framework_evaluation_runs TO devcontrol;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE compliance_check_evaluations TO devcontrol;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE framework_evaluation_reconciliations TO devcontrol;

COMMENT ON TABLE framework_evaluation_runs IS
  'History of compliance-framework evaluation runs: one row per organization x framework x scan. Pruned after 90 days; pruning never affects compliance_check_evaluations.';
COMMENT ON TABLE compliance_check_evaluations IS
  'Current outcome of each compliance check for each resource, including outcomes that are not findings. aws_resources.compliance_issues holds only the failed ones, rebuilt from this table.';
COMMENT ON COLUMN compliance_check_evaluations.run_generation IS
  'framework_evaluation_runs.generation of the run that wrote the row. A row is only overwritten by an equal or higher generation. Lower than the latest finished run for the same organization and framework = stale.';
COMMENT ON TABLE framework_evaluation_reconciliations IS
  'Resources whose last framework evaluation could not be stored. Deleted by the next successful evaluation of the resource.';

DO $$
BEGIN
  RAISE NOTICE 'Created framework_evaluation_runs, compliance_check_evaluations, framework_evaluation_reconciliations (RLS enabled and forced).';
END $$;
