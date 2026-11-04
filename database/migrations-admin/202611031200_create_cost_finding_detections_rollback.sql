-- Rollback for 202611031200_create_cost_finding_detections.sql. Run as postgres,
-- AFTER the application has been reverted to a release that does not read or
-- write cost_finding_detections.
--
-- What this drops: cost_finding_detections, which holds derived data only (the
-- latest observation of each hidden finding). The first cost analysis after a
-- re-apply rebuilds it.
--
-- What this deliberately keeps: every audit_logs row (resolve, dismiss, reopen
-- and delete events, with their actors), every cost_recommendations row
-- (occurrences ended by a reopen stay ended; ACTIVE rows a reopen inserted
-- stay ACTIVE). Under the reverted code an ended occurrence no longer hides a
-- finding, which is what the reopen asked for; the cost_recommendation.reopened
-- audit event records that it was a reopen rather than the finding going away.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  dependents TEXT;
BEGIN
  IF to_regclass('cost_finding_detections') IS NULL THEN
    RAISE EXCEPTION
      'cost_finding_detections not found -- the paired migration is not applied here; nothing to roll back. '
      'Refusing to proceed.';
  END IF;
  SELECT string_agg(format('%s on %s', fk.conname, fk.conrelid::regclass), ', ')
    INTO dependents
    FROM pg_constraint fk
   WHERE fk.contype = 'f'
     AND fk.confrelid = 'cost_finding_detections'::regclass;
  IF dependents IS NOT NULL THEN
    RAISE EXCEPTION 'cost_finding_detections is referenced by other foreign keys (%) -- refusing to drop it.', dependents;
  END IF;
END $$;

DROP TABLE cost_finding_detections;

DELETE FROM schema_migrations
 WHERE migration_name = '202611031200_create_cost_finding_detections.sql';

DO $$
BEGIN
  RAISE NOTICE 'Rolled back 202611031200_create_cost_finding_detections.sql';
END $$;
