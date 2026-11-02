-- Migration: extend cost_analysis_runs into the one run record for every cost analysis
--
-- Until now cost_analysis_runs recorded manual "Run cost analysis" runs only,
-- with one count that could not tell "nothing detected" from "detected, but
-- hidden by an earlier decision". This adds, on the same table:
--
--   source                       manual (POST /api/cost-recommendations/analyze)
--                                or discovery (the cost step of any discovery scan).
--   discovery_job_id             the resource_discovery_jobs row a discovery run
--                                belongs to. Deliberately no foreign key: adding one
--                                would take a lock on that busy table for no
--                                behaviour the application relies on.
--   detected, new, refreshed,    reconciling counts:
--   suppressed_*, duplicate,       detected = new + refreshed + suppressed_resolved
--   persisted                        + suppressed_dismissed + duplicate
--                                  persisted = new + refreshed
--   failed_detector,             per-run detector and resource coverage.
--   unknown_resource
--   checks                       one entry per detector: rule id, issue, outcome,
--                                detected, unknown. Never error text or resource IDs.
--   lease_acquired_at            when this run took the scan lease. NULL while queued.
--
-- and widens status with:
--   partial       some detectors completed, some failed.
--   interrupted   the worker lost its lease or stopped before finishing.
--
-- ADDITIVE ONLY, and safe BEFORE the code that uses it is deployed: every new
-- column is nullable or has a default, and the status CHECK only widens, so the
-- currently deployed application keeps inserting and updating as it does today.
-- source defaults to manual, which is correct for every existing row.
--
-- Counts stay NULL on existing rows: NULL means "not recorded" and must never
-- be read as 0.
--
-- ADMINISTRATIVE MIGRATION (see database/migrations-admin/README.md): applied
-- by hand as postgres, before the code is merged, so that the schema is in
-- place on the deploy. Owner and grants are unchanged. Row-level security is
-- unchanged too: this table is owned by the application role in production, so
-- every statement against it carries an explicit organization_id predicate.
--
-- Written for PostgreSQL 14 and later: no syntax introduced after 14.

SET LOCAL lock_timeout = '5s';

ALTER TABLE cost_analysis_runs
  ADD COLUMN source VARCHAR(20) NOT NULL DEFAULT 'manual',
  ADD COLUMN discovery_job_id UUID,
  ADD COLUMN detected_count INTEGER,
  ADD COLUMN new_count INTEGER,
  ADD COLUMN refreshed_count INTEGER,
  ADD COLUMN suppressed_resolved_count INTEGER,
  ADD COLUMN suppressed_dismissed_count INTEGER,
  ADD COLUMN duplicate_count INTEGER,
  ADD COLUMN persisted_count INTEGER,
  ADD COLUMN failed_detector_count INTEGER,
  ADD COLUMN unknown_resource_count INTEGER,
  ADD COLUMN checks JSONB,
  ADD COLUMN lease_acquired_at TIMESTAMPTZ;

ALTER TABLE cost_analysis_runs
  ADD CONSTRAINT cost_analysis_runs_source_check CHECK (source IN ('manual', 'discovery'));

ALTER TABLE cost_analysis_runs DROP CONSTRAINT cost_analysis_runs_status_check;
ALTER TABLE cost_analysis_runs
  ADD CONSTRAINT cost_analysis_runs_status_check
  CHECK (status IN ('running', 'completed', 'partial', 'failed', 'interrupted'));

CREATE INDEX idx_cost_analysis_runs_org_source_created
  ON cost_analysis_runs (organization_id, source, created_at DESC);

COMMENT ON TABLE cost_analysis_runs IS
  'One row per cost analysis: manual (POST /api/cost-recommendations/analyze) or the cost step of a discovery scan. resource_discovery_jobs stays the record of discovery itself.';
COMMENT ON COLUMN cost_analysis_runs.status IS
  'running: in flight. completed: every detector completed. partial: some detectors failed. failed: no detector completed, or the analysis could not finish or save. interrupted: the worker stopped or lost its lease.';
COMMENT ON COLUMN cost_analysis_runs.detected_count IS
  'Findings from detectors that completed. NULL means not recorded, never 0. detected = new + refreshed + suppressed_resolved + suppressed_dismissed + duplicate.';
COMMENT ON COLUMN cost_analysis_runs.checks IS
  'One entry per detector: rule_id, issue, outcome (complete or failed), detected, unknown. Never error text, ARNs or resource IDs.';
COMMENT ON COLUMN cost_analysis_runs.lease_acquired_at IS
  'When this run took the scan lease. A running row with an earlier value than a newly acquired lease belongs to a worker that is gone.';
