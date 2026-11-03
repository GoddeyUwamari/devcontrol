-- Rollback: return cost_analysis_runs to its manual-runs-only shape
-- Paired with: 202611021200_extend_cost_analysis_runs.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback", and CI's schema bootstrap skips it too. Run it as the postgres
-- role in ONE transaction, stopping at the first error, AFTER the application
-- has been reverted to a release that does not read these columns:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611021200_extend_cost_analysis_runs_rollback.sql
--
-- Discards data on purpose:
--   - discovery rows are deleted: without the source column they would read as
--     manual runs. resource_discovery_jobs still records those scans.
--   - partial and interrupted rows become failed, because the restored CHECK
--     does not allow them. Their classified state is lost.
--   - every count, checks and lease_acquired_at value is dropped.
--
-- Removes only what the paired migration added, and its schema_migrations row.
-- No statement uses CASCADE.

SET LOCAL lock_timeout = '5s';

DELETE FROM cost_analysis_runs WHERE source = 'discovery';

UPDATE cost_analysis_runs
   SET status = 'failed',
       completed_at = COALESCE(completed_at, NOW())
 WHERE status IN ('partial', 'interrupted');

DROP INDEX idx_cost_analysis_runs_org_source_created;

ALTER TABLE cost_analysis_runs DROP CONSTRAINT cost_analysis_runs_status_check;
ALTER TABLE cost_analysis_runs
  ADD CONSTRAINT cost_analysis_runs_status_check
  CHECK (status IN ('running', 'completed', 'failed'));

ALTER TABLE cost_analysis_runs DROP CONSTRAINT cost_analysis_runs_source_check;

ALTER TABLE cost_analysis_runs
  DROP COLUMN source,
  DROP COLUMN discovery_job_id,
  DROP COLUMN detected_count,
  DROP COLUMN new_count,
  DROP COLUMN refreshed_count,
  DROP COLUMN suppressed_resolved_count,
  DROP COLUMN suppressed_dismissed_count,
  DROP COLUMN duplicate_count,
  DROP COLUMN persisted_count,
  DROP COLUMN failed_detector_count,
  DROP COLUMN unknown_resource_count,
  DROP COLUMN checks,
  DROP COLUMN lease_acquired_at;

COMMENT ON TABLE cost_analysis_runs IS
  'One row per manual "Run cost analysis" invocation (POST /api/cost-recommendations/analyze). Distinct from resource_discovery_jobs, which tracks the separate, much broader scheduled discovery+cost-analysis cron -- see this migration''s header comment for why the two are not merged.';
COMMENT ON COLUMN cost_analysis_runs.status IS
  'running: analyzeAllResources() in flight. completed: finished without throwing. failed: threw before completing -- see error_message.';

DELETE FROM schema_migrations WHERE migration_name = '202611021200_extend_cost_analysis_runs.sql';
