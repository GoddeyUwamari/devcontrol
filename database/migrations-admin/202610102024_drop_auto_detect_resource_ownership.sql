-- Migration: 202610102024_drop_auto_detect_resource_ownership.sql
-- Description: Removes public.auto_detect_resource_ownership(), an unused
--   function with no tenant isolation. It was created by
--   011_add_cost_attribution_to_aws_resources.sql (also in this directory).
--   It sets aws_resources.team_id and aws_resources.service_id by matching
--   the Team/team and Service/service tags against teams.name and
--   services.name, case-insensitively, with no organization_id predicate on
--   either side of the match. Run by a role that bypasses row-level security
--   (postgres, which is how administrative SQL runs in production), it can
--   attach one organization's resources to another organization's team or
--   service. Its environment/owner_email updates also run across every
--   organization at once.
-- Date: 2026-10-10
--
-- ADMINISTRATIVE MIGRATION -- see database/migrations-admin/README.md.
--
-- PLACEMENT NOTE: classified into database/migrations-admin/ from the start.
-- The function was created by an administrative migration (011, run as
-- postgres), so it is expected to be owned by postgres, and only a
-- function's owner (or a superuser) can drop it. The owner-only pre-check
-- SQL for this change confirms the actual owner before execution.
--
-- No caller is expected: no trigger, application code, script, scheduled job
-- or CI step invokes it, and the frontend method that pointed at a backend
-- route for it (which never existed) is removed in the same change. It is
-- removed as a security precaution, not because a wrong mapping is known to
-- exist.
--
-- Safety:
--   - Idempotent. If 011 was never applied, or the function is already gone,
--     the guard finds nothing and DROP FUNCTION IF EXISTS is a no-op.
--   - Exact identity only: public.auto_detect_resource_ownership() with no
--     arguments, resolved with to_regprocedure. A function with the same
--     name in another schema, or with arguments, is not touched.
--   - No CASCADE. Before dropping, the guard below looks for anything that
--     uses the function and raises an exception naming what it found, so
--     the runner rolls back with nothing dropped. The DROP itself is RESTRICT
--     (the default): if a dependent appeared between the check and the drop,
--     PostgreSQL refuses the drop instead of removing that object.
--
-- What the guard checks, and why:
--   1. pg_depend rows whose REFERENCED object is the function
--      (refclassid = pg_proc, refobjid = the function). These are the
--      objects that depend on it: triggers, views and materialized views
--      (through their rewrite rules), SQL-standard function bodies
--      (BEGIN ATOMIC), column defaults, constraints, policies, casts,
--      operators, aggregates, event triggers. Every deptype counts. 'n'
--      would make a plain DROP fail with a generic error; 'a' and 'i' would
--      be dropped along with the function without any message. Either way
--      the migration stops and names them.
--      Rows where the function is the DEPENDENT (classid = pg_proc,
--      objid = the function) are excluded by construction, since the filter
--      is on refobjid. Those rows record the function's own dependencies:
--      its schema, its language (plpgsql), its return type (void). They
--      don't stop a drop and are removed with it. A row of the function
--      referencing itself is excluded explicitly as well; PostgreSQL does
--      not record one, so that exclusion only guards against a false
--      positive. Owner and privileges live in pg_shdepend and proacl. They
--      describe the function itself, not separate objects, and go away
--      with it.
--   2. Extension membership (a pg_depend row with the function as
--      dependent and deptype 'e'). A member function must be removed
--      through its extension, not dropped directly.
--   3. Callers that PostgreSQL does not track: a PL/pgSQL (or string-body
--      SQL) function that calls auto_detect_resource_ownership() records no
--      pg_depend row, and a pg_cron job stores its command as text. So the
--      guard also scans the source of every other function in pg_proc and,
--      if pg_cron is installed, cron.job.command for the name. This is a
--      text match: a mention inside a comment also stops the migration,
--      which is the intended direction to err in.
--
-- Reverse (manual only, unsafe, never part of normal operations):
--   202610102024_drop_auto_detect_resource_ownership_rollback.sql
-- It restores the function exactly as 011 defined it, and with it the
-- cross-tenant ownership-assignment risk this migration removes.
-- database/migrate.js and .github/scripts/ci-bootstrap-schema.js both skip
-- any filename containing "rollback", so it is never applied by a sweep and
-- --execute-only refuses it as not found.

DO $$
DECLARE
  target_fn oid := pg_catalog.to_regprocedure('public.auto_detect_resource_ownership()');
  dependent_count integer;
  dependent_list text;
  extension_name text;
  caller_count integer;
  caller_list text;
  cron_count integer;
  cron_list text;
BEGIN
  IF target_fn IS NULL THEN
    RAISE NOTICE 'public.auto_detect_resource_ownership() does not exist; nothing to drop.';
    RETURN;
  END IF;

  SELECT count(*), string_agg(dep.description, '; ' ORDER BY dep.description)
    INTO dependent_count, dependent_list
    FROM (
      SELECT pg_catalog.pg_describe_object(d.classid, d.objid, d.objsubid)
               || ' (deptype ' || d.deptype::text || ')' AS description
        FROM pg_catalog.pg_depend d
       WHERE d.refclassid = 'pg_catalog.pg_proc'::pg_catalog.regclass
         AND d.refobjid = target_fn
         AND NOT (d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
                  AND d.objid = target_fn)
    ) dep;

  IF dependent_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop public.auto_detect_resource_ownership(): % dependent object(s) found: %',
      dependent_count, dependent_list
      USING HINT = 'Nothing was dropped. Review and remove each dependent deliberately, then re-run. Never use CASCADE.';
  END IF;

  SELECT e.extname
    INTO extension_name
    FROM pg_catalog.pg_depend d
    JOIN pg_catalog.pg_extension e ON e.oid = d.refobjid
   WHERE d.classid = 'pg_catalog.pg_proc'::pg_catalog.regclass
     AND d.objid = target_fn
     AND d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass
     AND d.deptype = 'e';

  IF extension_name IS NOT NULL THEN
    RAISE EXCEPTION
      'Refusing to drop public.auto_detect_resource_ownership(): it is a member of extension %',
      extension_name
      USING HINT = 'Nothing was dropped. This migration only removes the function created by migration 011.';
  END IF;

  SELECT count(*), string_agg(caller.signature, '; ' ORDER BY caller.signature)
    INTO caller_count, caller_list
    FROM (
      SELECT p.oid::pg_catalog.regprocedure::text AS signature
        FROM pg_catalog.pg_proc p
       WHERE p.oid <> target_fn
         AND pg_catalog.strpos(pg_catalog.lower(p.prosrc), 'auto_detect_resource_ownership') > 0
    ) caller;

  IF caller_count > 0 THEN
    RAISE EXCEPTION
      'Refusing to drop public.auto_detect_resource_ownership(): % other function(s) mention it in their source: %',
      caller_count, caller_list
      USING HINT = 'Nothing was dropped. PL/pgSQL calls are not tracked in pg_depend; review each function before re-running.';
  END IF;

  IF pg_catalog.to_regclass('cron.job') IS NOT NULL THEN
    EXECUTE $q$
      SELECT count(*), string_agg(jobid::text, ', ' ORDER BY jobid)
        FROM cron.job
       WHERE pg_catalog.strpos(pg_catalog.lower(command), 'auto_detect_resource_ownership') > 0
    $q$ INTO cron_count, cron_list;

    IF cron_count > 0 THEN
      RAISE EXCEPTION
        'Refusing to drop public.auto_detect_resource_ownership(): % pg_cron job(s) call it (jobid %)',
        cron_count, cron_list
        USING HINT = 'Nothing was dropped. Unschedule those jobs deliberately before re-running.';
    END IF;
  END IF;

  RAISE NOTICE 'No dependents or callers of public.auto_detect_resource_ownership() found; dropping it.';
END $$;

DROP FUNCTION IF EXISTS public.auto_detect_resource_ownership();

DO $$
BEGIN
  RAISE NOTICE 'Migration 202610102024 completed successfully!';
  RAISE NOTICE 'public.auto_detect_resource_ownership() is absent (dropped, or was never created)';
END $$;
