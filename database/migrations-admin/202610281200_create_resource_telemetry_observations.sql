-- Migration: create resource telemetry observation storage
--
-- Memory beyond one metrics window for the Observability page:
--
--   resource_telemetry_observations   per (organization, AWS account, region,
--                                     resource): the newest CloudWatch datapoint
--                                     ever seen for the resource (Last seen) and
--                                     the last time every query its check needs
--                                     completed.
--   observability_collection_scopes   per (organization, AWS account, region):
--                                     the last collection in which every query
--                                     completed (the page's "checked at"), and
--                                     the latest attempt's outcome. A partial
--                                     or failed collection never advances
--                                     last_full_success_at.
--
-- ADDITIVE ONLY. Two new tables; no existing table or column changes. Every
-- non-key column is nullable, and a missing row reads as "never observed":
-- the application treats an empty table, and a missing table, as no stored
-- history.
--
-- ADMINISTRATIVE MIGRATION (see database/migrations-admin/README.md):
--   - resource_telemetry_observations' composite foreign key references the
--     postgres-owned aws_resources (id, organization_id), which needs the
--     owner (REFERENCES privilege);
--   - ENABLE/FORCE ROW LEVEL SECURITY and CREATE POLICY on the new tables,
--     which the postgres role creates and therefore owns.
--
-- aws_resources (id, organization_id) UNIQUENESS. The foreign key needs a
-- unique constraint over exactly (id, organization_id).
-- 202610112300_create_framework_evaluation_persistence.sql adds or reuses one
-- and sorts before this file everywhere. This migration only reuses it: it
-- never alters aws_resources, and refuses to run when no such constraint
-- exists.
--
-- Scope: every row carries the organization, the 12-digit AWS account id and
-- the region it was observed under, and every read filters on all of them, so
-- an observation is never shown for another organization, another account
-- (after a reconnect) or another region. aws_resources has no account column,
-- so its id alone identifies the resource but does not scope the observation.
-- Tenant integrity is also enforced by the database: an observation
-- references its resource by (resource_id, organization_id).
--
-- devcontrol receives SELECT, INSERT and UPDATE only. Rows go away with their
-- resource or organization (ON DELETE CASCADE); nothing deletes them
-- directly. Not TRUNCATE: TRUNCATE is not subject to row-level security.
--
-- A plain CREATE: it refuses to run if either table already exists.
--
-- Written for PostgreSQL 14 and later: no syntax introduced after 14.
--
-- Rollback: 202610281200_create_resource_telemetry_observations_rollback.sql
-- (manual; database/migrate.js never runs a file whose name contains
-- "rollback").

-- The foreign key takes SHARE ROW EXCLUSIVE on aws_resources and organizations
-- until COMMIT (blocks their writes, not their reads). Fail instead of
-- queueing behind long transactions.
SET LOCAL lock_timeout = '5s';

DO $$
DECLARE
  id_attnum  SMALLINT;
  org_attnum SMALLINT;
BEGIN
  IF to_regclass('organizations') IS NULL THEN
    RAISE EXCEPTION 'organizations does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('aws_resources') IS NULL THEN
    RAISE EXCEPTION 'aws_resources does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('resource_telemetry_observations') IS NOT NULL
     OR to_regclass('observability_collection_scopes') IS NOT NULL THEN
    RAISE EXCEPTION
      'resource_telemetry_observations or observability_collection_scopes already exists -- '
      'this migration creates them and refuses to proceed. Investigate before re-running.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcontrol') THEN
    RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.';
  END IF;

  SELECT attnum INTO id_attnum FROM pg_attribute
   WHERE attrelid = 'aws_resources'::regclass AND attname = 'id' AND NOT attisdropped;
  SELECT attnum INTO org_attnum FROM pg_attribute
   WHERE attrelid = 'aws_resources'::regclass AND attname = 'organization_id' AND NOT attisdropped;
  IF id_attnum IS NULL OR org_attnum IS NULL THEN
    RAISE EXCEPTION 'aws_resources has no id or organization_id column -- refusing to proceed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'aws_resources'::regclass
       AND contype IN ('u', 'p')
       AND conkey = ARRAY[id_attnum, org_attnum]
  ) THEN
    RAISE EXCEPTION
      'aws_resources has no unique constraint over (id, organization_id) -- apply '
      '202610112300_create_framework_evaluation_persistence.sql first. Refusing to proceed.';
  END IF;
END $$;

CREATE TABLE resource_telemetry_observations (
  organization_id          UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  aws_account_id           VARCHAR(12) NOT NULL CHECK (aws_account_id ~ '^[0-9]{12}$'),
  region                   VARCHAR(32) NOT NULL CHECK (region ~ '^[a-z]{2}(-[a-z]+)+-[0-9]{1,2}$'),
  -- aws_resources.id, not the AWS-side identifier.
  resource_id              UUID NOT NULL,
  -- The newest CloudWatch datapoint timestamp seen for the resource, in any
  -- window. Only ever moves forward.
  last_datapoint_at        TIMESTAMPTZ,
  -- The last time every query or describe call the resource's check needs
  -- completed. Only ever moves forward.
  last_successful_check_at TIMESTAMPTZ,
  updated_at               TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, aws_account_id, region, resource_id),
  CONSTRAINT resource_telemetry_observations_resource_fk
    FOREIGN KEY (resource_id, organization_id)
    REFERENCES aws_resources (id, organization_id) ON DELETE CASCADE,
  CONSTRAINT resource_telemetry_observations_has_observation
    CHECK (last_datapoint_at IS NOT NULL OR last_successful_check_at IS NOT NULL)
);

-- The cascade from aws_resources on (resource_id, organization_id).
CREATE INDEX resource_telemetry_observations_resource
  ON resource_telemetry_observations (resource_id, organization_id);

CREATE TABLE observability_collection_scopes (
  organization_id      UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  aws_account_id       VARCHAR(12) NOT NULL CHECK (aws_account_id ~ '^[0-9]{12}$'),
  region               VARCHAR(32) NOT NULL CHECK (region ~ '^[a-z]{2}(-[a-z]+)+-[0-9]{1,2}$'),
  -- The last collection in which every query completed. Never advanced by a
  -- partial or failed collection.
  last_full_success_at TIMESTAMPTZ,
  last_attempt_at      TIMESTAMPTZ,
  last_attempt_outcome VARCHAR(10) CHECK (last_attempt_outcome IN ('complete', 'partial', 'failed')),
  updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (organization_id, aws_account_id, region),
  CONSTRAINT observability_collection_scopes_attempt_shape
    CHECK ((last_attempt_at IS NULL) = (last_attempt_outcome IS NULL))
);

COMMENT ON TABLE resource_telemetry_observations IS
  'Per organization, AWS account, region and resource: the newest CloudWatch datapoint seen (Last seen) '
  'and the last time every query the resource''s check needs completed.';
COMMENT ON TABLE observability_collection_scopes IS
  'Per organization, AWS account and region: the last metrics collection in which every query completed '
  '(checked at), and the latest attempt''s outcome.';

ALTER TABLE resource_telemetry_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE resource_telemetry_observations FORCE ROW LEVEL SECURITY;
ALTER TABLE observability_collection_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE observability_collection_scopes FORCE ROW LEVEL SECURITY;

CREATE POLICY resource_telemetry_observations_tenant ON resource_telemetry_observations
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

CREATE POLICY observability_collection_scopes_tenant ON observability_collection_scopes
  FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

REVOKE ALL ON TABLE resource_telemetry_observations, observability_collection_scopes FROM PUBLIC, devcontrol;
GRANT SELECT, INSERT, UPDATE ON TABLE resource_telemetry_observations TO devcontrol;
GRANT SELECT, INSERT, UPDATE ON TABLE observability_collection_scopes TO devcontrol;
