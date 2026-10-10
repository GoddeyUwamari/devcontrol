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
--   - ALTER TABLE aws_resources requires ownership of a postgres-owned table;
--   - ENABLE/FORCE ROW LEVEL SECURITY and CREATE POLICY on the new tables,
--     which the postgres role creates and therefore owns.
--
-- A plain CREATE: it refuses to run if either table, or the aws_resources
-- composite key, already exists. There is nothing to reconcile.
--
-- Tenant integrity is enforced by the database, not by the writer:
--   - aws_resources gains UNIQUE (id, organization_id) as a composite
--     foreign-key target (aws_resources_id_org_unique);
--   - a result references its run by (run_id, organization_id) and its
--     resource by (resource_id, organization_id), so a result's organization
--     must equal both its run's and its resource's.
--
-- Run lifecycle (enforced by CHECK constraints):
--   running   claimed and in progress; at most one per organization
--             (resource_health_evaluation_runs_one_running).
--   complete  finished; every evaluable resource was evaluated (failed_count = 0).
--   partial   finished; at least one resource could not be evaluated
--             (failed_count > 0), recorded as an 'evaluation_failed' result.
--   failed    the run as a whole failed (failure_code says why).
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
-- Rollback: 202610101200_create_resource_health_evaluations_rollback.sql
-- (manual; database/migrate.js never runs a file whose name contains
-- "rollback").

-- The aws_resources ALTER below takes an ACCESS EXCLUSIVE lock while it
-- builds its index. Fail instead of queueing behind long transactions, which
-- would block every later reader of aws_resources while it waited.
SET LOCAL lock_timeout = '5s';

DO $$
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
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'aws_resources_id_org_unique' AND conrelid = 'aws_resources'::regclass
  ) THEN
    RAISE EXCEPTION 'aws_resources_id_org_unique already exists -- refusing to proceed. Investigate before re-running.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcontrol') THEN
    RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.';
  END IF;
END $$;

-- Composite foreign-key target. id is already the primary key, so this
-- cannot fail on existing rows.
ALTER TABLE aws_resources
  ADD CONSTRAINT aws_resources_id_org_unique UNIQUE (id, organization_id);

CREATE TABLE resource_health_evaluation_runs (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  status           VARCHAR(16) NOT NULL
                     CHECK (status IN ('running', 'complete', 'partial', 'failed')),
  evaluation_range VARCHAR(8) NOT NULL CHECK (evaluation_range IN ('1h')),
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The end of the metric window the evaluation used. Set when the run finishes.
  evaluated_at     TIMESTAMPTZ,
  finished_at      TIMESTAMPTZ,
  inventory_count  INTEGER CHECK (inventory_count >= 0),
  evaluated_count  INTEGER CHECK (evaluated_count >= 0),
  failed_count     INTEGER CHECK (failed_count >= 0),
  -- Per resource type: { inventory, evaluated, failed }.
  type_outcomes    JSONB,
  failure_code     VARCHAR(32)
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

-- Latest run per organization, and retention by age.
CREATE INDEX resource_health_evaluation_runs_org_started
  ON resource_health_evaluation_runs (organization_id, started_at DESC);

CREATE TABLE resource_health_evaluation_results (
  run_id           UUID NOT NULL,
  organization_id  UUID NOT NULL,
  -- aws_resources.id
  resource_id      UUID NOT NULL,
  resource_type    VARCHAR(50) NOT NULL,
  outcome          VARCHAR(20) NOT NULL CHECK (outcome IN ('evaluated', 'evaluation_failed')),
  evaluator_status VARCHAR(16)
                     CHECK (evaluator_status IN ('healthy', 'degraded', 'critical', 'down', 'unknown')),
  monitored        BOOLEAN,
  check_name       VARCHAR(64),
  -- Equal to the run's evaluated_at; kept here so the reader's index covers it.
  evaluated_at     TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (run_id, resource_id),
  CONSTRAINT resource_health_evaluation_results_run_fk
    FOREIGN KEY (run_id, organization_id)
    REFERENCES resource_health_evaluation_runs (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT resource_health_evaluation_results_resource_fk
    FOREIGN KEY (resource_id, organization_id)
    REFERENCES aws_resources (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT resource_health_evaluation_results_outcome_shape CHECK (
       (outcome = 'evaluated'
          AND evaluator_status IS NOT NULL AND monitored IS NOT NULL AND check_name IS NOT NULL)
    OR (outcome = 'evaluation_failed'
          AND evaluator_status IS NULL AND monitored IS NULL AND check_name IS NULL)
  )
);

-- The reader's per-resource selection, and the cascade from aws_resources on
-- (resource_id, organization_id). The cascade from a run uses the primary key.
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
