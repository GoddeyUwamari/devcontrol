-- Migration: 202609060900_create_cost_analysis_runs.sql
-- Description: Persists manual "Run cost analysis" runs
--   (POST /api/cost-recommendations/analyze), which today complete a real
--   cost analysis but leave no server-side trace of when they ran or
--   whether they succeeded -- the Cost Optimization page's "Last Analysis" /
--   Analysis Status previously could only reflect resource_discovery_jobs,
--   which is written exclusively by the separate, much broader scheduled
--   discovery cron (backend/src/jobs/resourceDiscovery.job.ts ->
--   AWSResourceDiscoveryService.discoverAllResources()).
--
--   Design notes:
--   - Deliberately a NEW, separate table rather than an added row shape in
--     resource_discovery_jobs. That table's own columns
--     (resources_discovered/updated/deleted, resource_types[], regions[])
--     assume every row represents a full resource-discovery attempt --
--     discovery has no "did it run" boolean of its own (unlike the optional
--     compliance_scan_completed/cost_analysis_completed sub-step flags)
--     because every existing writer of that table always performs discovery
--     first. A manual-cost-analysis-only run has none of that: it discovers
--     nothing, scans no particular resource_types/regions "scope", and would
--     have to fake resources_discovered=0 / resource_types=[] to fit --
--     indistinguishable from a real discovery job that happened to find
--     zero resources in zero allowed types. That ambiguity is exactly the
--     "resurrection" pattern this repository already treats as a scoping
--     hazard elsewhere (see 022_cost_recommendations_org_scoping.sql,
--     202609031800_add_cost_recommendations_occurrence_lifecycle.sql) --
--     reusing resource_discovery_jobs here would corrupt its existing
--     meaning for every current reader (system-intelligence.service.ts's
--     computeCostScore() readiness check, the Cost Optimization page's own
--     Analysis Status derivation, and any future consumer of "how many
--     resources did discovery find").
--   - This is a brand-new table created (and owned) by devcontrol itself --
--     like refunds (202608311500_create_refunds.sql) and platform_staff
--     (202609051200_create_platform_staff.sql) -- so it belongs in the
--     ordinary database/migrations/ path, not database/migrations-admin/:
--     devcontrol owns whatever it creates, so ENABLE ROW LEVEL SECURITY and
--     CREATE POLICY below hit no ownership restriction.
--   - IS org-scoped with RLS (unlike platform_staff): a cost analysis run is
--     a tenant-scoped resource, same as cost_recommendations itself.
--   - No new locking is introduced for concurrent manual runs. The
--     underlying cost_recommendations mutation this table merely records
--     metadata about is already serialized per-organization by
--     CostRecommendationsRepository.reconcileActiveRecommendations()'s
--     existing pg_advisory_lock (hashtextextended salt 1) -- two concurrent
--     manual runs, or a manual run racing the scheduled cron, each get their
--     own honest row here (two real attempts did happen) while the actual
--     recommendation data stays safely serialized exactly as it already was
--     before this migration. See the accompanying repository/controller
--     changes for how rows here are created/updated.
--   - status intentionally mirrors resource_discovery_jobs.status's
--     'running'/'completed'/'failed' vocabulary (no 'pending': a manual run
--     is created and begins immediately, never queued).
--   - recommendations_found/total_potential_savings are nullable: a 'running'
--     row has neither yet, and a 'failed' row may never get either.
--   - error_message stores the full real error for server-side diagnostics.
--     The read endpoint that exposes this table to the frontend
--     (GET /api/cost-recommendations/analysis-runs) deliberately does NOT
--     return this column verbatim -- see
--     CostRecommendationsController.getAnalysisRuns() -- to avoid leaking
--     raw AWS SDK error detail to the client, unlike the pre-existing
--     resource_discovery_jobs read path, which already does return its raw
--     error_message today (a pre-existing precedent, not repeated here).
-- Date: 2026-09-06

CREATE TABLE cost_analysis_runs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  status VARCHAR(20) NOT NULL DEFAULT 'running' CHECK (status IN ('running', 'completed', 'failed')),

  recommendations_found INTEGER,
  total_potential_savings NUMERIC(12,2),
  error_message TEXT,

  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

GRANT ALL ON TABLE cost_analysis_runs TO devcontrol;

CREATE INDEX idx_cost_analysis_runs_org_created ON cost_analysis_runs(organization_id, created_at DESC);

ALTER TABLE cost_analysis_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY cost_analysis_runs_isolation_policy ON cost_analysis_runs
  FOR ALL
  USING (organization_id::text = current_setting('app.current_organization_id', true));

CREATE POLICY cost_analysis_runs_insert_policy ON cost_analysis_runs
  FOR INSERT
  WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

COMMENT ON TABLE cost_analysis_runs IS
  'One row per manual "Run cost analysis" invocation (POST /api/cost-recommendations/analyze). Distinct from resource_discovery_jobs, which tracks the separate, much broader scheduled discovery+cost-analysis cron -- see this migration''s header comment for why the two are not merged.';
COMMENT ON COLUMN cost_analysis_runs.status IS
  'running: analyzeAllResources() in flight. completed: finished without throwing. failed: threw before completing -- see error_message.';
COMMENT ON COLUMN cost_analysis_runs.recommendations_found IS
  'Same value returned to the client as AnalysisResult.recommendationsFound for this run (net inserted count, post-reconciliation). NULL until the run reaches a terminal state.';
COMMENT ON COLUMN cost_analysis_runs.total_potential_savings IS
  'Org-wide SUM(potential_savings) WHERE status=ACTIVE immediately after this run completed -- the same figure returned as AnalysisResult.totalPotentialSavings. NULL until completed.';
COMMENT ON COLUMN cost_analysis_runs.error_message IS
  'Full real error for server-side diagnostics only. Not returned verbatim by GET /api/cost-recommendations/analysis-runs -- see this migration''s header comment.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202609060900 completed successfully!';
  RAISE NOTICE 'cost_analysis_runs created (organization_id NOT NULL, RLS enabled, both policies) -- table starts empty';
END $$;
