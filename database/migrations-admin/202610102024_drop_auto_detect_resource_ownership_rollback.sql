-- Rollback: 202610102024_drop_auto_detect_resource_ownership_rollback.sql
-- Paired with: 202610102024_drop_auto_detect_resource_ownership.sql
-- Date: 2026-10-10
--
-- !!! UNSAFE -- MANUAL RECOVERY ONLY -- NEVER RUN IN NORMAL OPERATIONS !!!
--
-- Restoring this function REINTRODUCES THE CROSS-TENANT OWNERSHIP-ASSIGNMENT
-- RISK the paired migration removes. auto_detect_resource_ownership() matches
-- aws_resources tags against teams.name and services.name with no
-- organization_id predicate, so when run by a role that bypasses row-level
-- security it can attach one organization's resources to another
-- organization's team or service.
--
-- This file is kept only to follow this repository's paired-rollback
-- convention and to record the exact definition that was removed. It is not
-- a migration:
--   - database/migrate.js and .github/scripts/ci-bootstrap-schema.js skip
--     every filename containing "rollback", so no sweep applies it and
--     `--execute-only` refuses it as not found.
--   - It refuses to run unless the session explicitly opts in (see the guard
--     below) and the current schema is public, which is where migration 011
--     created the function (011's CREATE is schema-unqualified).
--
-- If it must ever be run, it is a separate, explicitly authorized, manual
-- operation, executed as the function's original owner, in one transaction:
--   PGOPTIONS='-c devcontrol.allow_unsafe_auto_detect_rollback=reintroduce-cross-tenant-risk' \
--     psql -v ON_ERROR_STOP=1 --single-transaction -f <this file>
-- After restoring, never run the function itself.
--
-- The function definition below (from the "FUNCTION: AUTO-DETECT OWNERSHIP"
-- comment block through "$$ LANGUAGE plpgsql;") is copied byte-for-byte from
-- 011_add_cost_attribution_to_aws_resources.sql, lines 66-119. It is not a
-- rewrite. 011 sets no COMMENT ON FUNCTION, SECURITY DEFINER, volatility or
-- search_path, so none is set here: the function comes back
-- SECURITY INVOKER, VOLATILE, with no proconfig, exactly as 011 created it.
-- 011 also has no GRANT/REVOKE for it; recreating it as its original owner
-- restores the default privileges it had then.

DO $$
BEGIN
  IF pg_catalog.current_setting('devcontrol.allow_unsafe_auto_detect_rollback', true)
       IS DISTINCT FROM 'reintroduce-cross-tenant-risk' THEN
    RAISE EXCEPTION
      'Refusing to restore auto_detect_resource_ownership(): it reintroduces cross-tenant ownership-assignment risk'
      USING HINT = 'Manual recovery only. See this file''s header for the explicit opt-in.';
  END IF;
  IF pg_catalog.current_schema() IS DISTINCT FROM 'public' THEN
    RAISE EXCEPTION
      'Refusing to restore auto_detect_resource_ownership(): current schema is %, migration 011 created it in public',
      pg_catalog.current_schema();
  END IF;
END $$;

-- =====================================================
-- FUNCTION: AUTO-DETECT OWNERSHIP FROM AWS TAGS
-- =====================================================
-- This function attempts to populate team/service/environment from AWS tags
-- Common tag patterns: Team, Owner, Service, Environment, CostCenter, etc.

CREATE OR REPLACE FUNCTION auto_detect_resource_ownership()
RETURNS VOID AS $$
BEGIN
  -- Auto-assign environment from tags
  UPDATE aws_resources
  SET environment = COALESCE(
    tags->>'Environment',
    tags->>'environment',
    tags->>'Env',
    tags->>'env'
  )
  WHERE environment IS NULL
    AND (tags ? 'Environment' OR tags ? 'environment' OR tags ? 'Env' OR tags ? 'env');

  -- Auto-assign owner email from tags
  UPDATE aws_resources
  SET owner_email = COALESCE(
    tags->>'Owner',
    tags->>'owner',
    tags->>'OwnerEmail',
    tags->>'owner_email'
  )
  WHERE owner_email IS NULL
    AND (tags ? 'Owner' OR tags ? 'owner' OR tags ? 'OwnerEmail' OR tags ? 'owner_email');

  -- Try to match team by name from tags
  UPDATE aws_resources ar
  SET team_id = t.id
  FROM teams t
  WHERE ar.team_id IS NULL
    AND (
      LOWER(ar.tags->>'Team') = LOWER(t.name) OR
      LOWER(ar.tags->>'team') = LOWER(t.name)
    );

  -- Try to match service by name from tags
  UPDATE aws_resources ar
  SET service_id = s.id
  FROM services s
  WHERE ar.service_id IS NULL
    AND (
      LOWER(ar.tags->>'Service') = LOWER(s.name) OR
      LOWER(ar.tags->>'service') = LOWER(s.name)
    );

  RAISE NOTICE 'Auto-detection completed: environment, owner, team, and service associations updated from AWS tags';
END;
$$ LANGUAGE plpgsql;

DO $$
BEGIN
  RAISE WARNING 'public.auto_detect_resource_ownership() restored. It has no tenant isolation: do not run it.';
END $$;
