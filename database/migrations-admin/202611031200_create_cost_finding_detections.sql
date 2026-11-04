-- Cost Optimization PR 3a: per-finding detection evidence.
--
-- One row per finding identity (organization, resource, issue) that a cost
-- analysis observed while the finding was hidden by an open Resolved or
-- Dismissed decision. Written only by
-- CostRecommendationsRepository.reconcileActiveRecommendations(), inside its
-- locked, fenced transaction:
--
--   outcome 'detected'  a detector that completed saw this resource with this
--                       issue in run run_id; the evidence columns hold what
--                       that detector reported (the same fields an ACTIVE row
--                       would have held)
--   outcome 'unknown'   a detector that completed listed this resource but
--                       could not evaluate it in run run_id; the evidence
--                       columns keep the last detection, if any
--
-- "Still detected" is derived when read, never stored: the row names the
-- organization's latest leased cost analysis run, that run completed or was
-- partial, its check for the issue completed, the outcome is 'detected', and
-- the observation is newer than the finding's latest decision. Anything else
-- reads "not confirmed". Existing rows are not backfilled: a historical
-- cost_recommendations row never proves current detection.
--
-- run_id has no foreign key: cost_analysis_runs rows can be deleted (the PR 1
-- rollback deletes discovery rows), and a run id that no longer exists simply
-- never names the latest run.
--
-- ADMIN MIGRATION: run as postgres. The table is postgres-owned, with row-level
-- security enabled and forced, and the application role devcontrol limited to
-- SELECT, INSERT and UPDATE. Every application statement on it also carries an
-- explicit organization_id predicate (static test
-- cost-finding-detections.tenant-scope.test.ts).
--
-- No existing table is changed, so the release running when this is applied
-- is unaffected: nothing in it reads or writes this table.
SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('organizations') IS NULL THEN
    RAISE EXCEPTION 'organizations does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('cost_recommendations') IS NULL THEN
    RAISE EXCEPTION 'cost_recommendations does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('cost_analysis_runs') IS NULL THEN
    RAISE EXCEPTION 'cost_analysis_runs does not exist -- refusing to proceed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cost_analysis_runs' AND column_name = 'checks'
  ) OR NOT EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'cost_analysis_runs' AND column_name = 'lease_acquired_at'
  ) THEN
    RAISE EXCEPTION
      'cost_analysis_runs has no checks or lease_acquired_at column -- apply '
      '202611021200_extend_cost_analysis_runs.sql first. Refusing to proceed.';
  END IF;
  IF to_regclass('cost_finding_detections') IS NOT NULL THEN
    RAISE EXCEPTION
      'cost_finding_detections already exists -- this migration creates it and refuses to proceed. '
      'Investigate before re-running.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcontrol') THEN
    RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.';
  END IF;
END $$;

CREATE TABLE cost_finding_detections (
  organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  resource_id       VARCHAR(255) NOT NULL,
  issue             VARCHAR(255) NOT NULL,
  -- The cost analysis run of the latest observation. NULL when that run had no
  -- run record (run tracking is best-effort): such an observation never confirms.
  run_id            UUID,
  outcome           VARCHAR(10) NOT NULL CHECK (outcome IN ('detected', 'unknown')),
  observed_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- The latest detection and what the detector reported then.
  detected_at       TIMESTAMPTZ,
  resource_name     VARCHAR(255),
  resource_type     VARCHAR(50),
  aws_region        VARCHAR(50),
  description       TEXT,
  potential_savings DECIMAL(10,2),
  severity          VARCHAR(20) CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  metadata          JSONB,
  PRIMARY KEY (organization_id, resource_id, issue),
  CONSTRAINT cost_finding_detections_detected_has_evidence
    CHECK (outcome <> 'detected' OR (detected_at IS NOT NULL AND potential_savings IS NOT NULL AND severity IS NOT NULL))
);

COMMENT ON TABLE cost_finding_detections IS
  'Per organization, resource and issue: the latest cost analysis observation of a finding hidden by an open '
  'Resolved or Dismissed decision, and the evidence of its latest detection. Written only by cost analysis '
  'reconciliation. "Still detected" is derived when read; existing findings are not backfilled.';
COMMENT ON COLUMN cost_finding_detections.run_id IS
  'cost_analysis_runs.id of the latest observation (no foreign key). NULL: the run had no run record.';
COMMENT ON COLUMN cost_finding_detections.outcome IS
  'detected: a completed detector saw the finding in run_id. unknown: a completed detector listed the '
  'resource but could not evaluate it in run_id.';
COMMENT ON COLUMN cost_finding_detections.observed_at IS
  'When run_id reconciled this finding.';
COMMENT ON COLUMN cost_finding_detections.detected_at IS
  'When the finding was last detected; the evidence columns are from that detection.';

ALTER TABLE cost_finding_detections ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_finding_detections FORCE ROW LEVEL SECURITY;

CREATE POLICY cost_finding_detections_tenant ON cost_finding_detections
  USING (organization_id::text = current_setting('app.current_organization_id', true))
  WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

REVOKE ALL ON TABLE cost_finding_detections FROM PUBLIC, devcontrol;
GRANT SELECT, INSERT, UPDATE ON TABLE cost_finding_detections TO devcontrol;
