-- Resolve/Dismiss occurrence-lifecycle fix for cost_recommendations.
--
-- Problem: resolving or dismissing a recommendation only ever flipped its
-- status; the next scan's deleteAllActive()+createBulk() had no awareness of
-- RESOLVED/DISMISSED rows at all, so an unchanged AWS condition was silently
-- re-inserted as a brand-new ACTIVE row every scan, undoing the user's
-- action. Reserved Instance Opportunity findings are explicitly excluded
-- from this lifecycle (synthetic, fleet-level aggregate identity, not a
-- discrete resource) and are unaffected by this migration's semantics --
-- see backend/src/repositories/cost-recommendations.repository.ts.
--
-- occurrence_ended_at: NULL means "this RESOLVED/DISMISSED row's occurrence
-- is still open" (the default, safe state for every pre-existing row -- no
-- backfill needed, since NULL is already correct: a completed, successful
-- detector observation is required to set it, and none has run yet against
-- this column for historical rows). Once a successful, complete detector
-- observation confirms the underlying resource+issue is genuinely absent,
-- this is set once and never cleared; a later identical finding is then
-- treated as a new, independent occurrence rather than a resurrection of
-- the old one. ACTIVE rows never have this column set.
ALTER TABLE cost_recommendations
  ADD COLUMN occurrence_ended_at TIMESTAMPTZ NULL DEFAULT NULL;

-- Guards against duplicate ACTIVE rows for the same (org, resource, issue)
-- tuple under concurrent scans (manual analyze vs. the 6-hour cron, or two
-- overlapping manual scans) -- required for the reconciliation transaction's
-- INSERT ... ON CONFLICT ... DO NOTHING to have a target constraint.
--
-- Deliberately NOT CREATE INDEX CONCURRENTLY: this repository's migration
-- runner (database/migrate.js) wraps every migration in BEGIN/COMMIT
-- unconditionally, and PostgreSQL forbids CONCURRENTLY inside a transaction
-- block. A plain CREATE UNIQUE INDEX briefly locks the table against writes
-- while it builds.
--
-- DEPLOYMENT PRECONDITION -- must be verified before this migration is
-- applied to production (not verified by this migration or by the session
-- that authored it; this session has no production access):
--
--   SELECT organization_id, resource_id, issue, COUNT(*)
--   FROM cost_recommendations
--   WHERE status = 'ACTIVE'
--   GROUP BY organization_id, resource_id, issue
--   HAVING COUNT(*) > 1;
--
-- If this returns any rows, they must be reconciled (e.g. keep the newest,
-- resolve/delete the rest) before this migration can be applied -- it will
-- otherwise fail outright with a unique-violation during index creation.
CREATE UNIQUE INDEX idx_cost_recommendations_active_identity
  ON cost_recommendations (organization_id, resource_id, issue)
  WHERE status = 'ACTIVE';
