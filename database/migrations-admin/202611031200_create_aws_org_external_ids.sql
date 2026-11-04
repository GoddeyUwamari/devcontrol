-- Migration: one stable AWS External ID per organization
--
-- Until now the External ID shown on the Connect AWS page lived in
-- aws_connect_sessions for one hour. After that, the next page load generated
-- a new value, so a role or CloudFormation stack built with the earlier value
-- could no longer be assumed. A connected account keeps its own copy in
-- aws_accounts.external_id, and that copy is what every AssumeRole sends.
--
-- This adds aws_org_external_ids: one value per organization, never expiring,
-- never updated. The Connect page and every later connect use it.
--
-- CANONICAL SOURCE AND PRECEDENCE (backfill here, and the same order at runtime
-- in backend/src/repositories/aws-external-id.repository.ts for organizations
-- that have no row yet):
--   1. connection  An aws_accounts row of the organization with a well-formed
--                  external_id: the value AWS already trusts. Rows with status
--                  'active' first, then the most recent connected_at, then id.
--   2. session     Otherwise the organization's aws_connect_sessions value,
--                  expired or not: the customer may already have put it in a
--                  trust policy.
--   3. generated   Otherwise no row is written here. The application generates
--                  one (crypto.randomBytes(24), base64url) on the next visit.
-- A trusted value is never replaced: rows are only ever inserted, and an
-- existing row always wins (ON CONFLICT DO NOTHING).
--
-- WELL-FORMED means 2 to 64 characters from AWS's ExternalId alphabet
-- [A-Za-z0-9+=,.@:/_-]. 64 is the width of both source columns. A NULL, empty or
-- otherwise malformed historical value is skipped, never copied; the next
-- source in the order above is used. Skipped and conflicting rows are counted
-- in NOTICEs. Conflicting means an organization whose aws_accounts rows hold
-- more than one distinct well-formed value; UNIQUE (org_id) on aws_accounts
-- should make that impossible.
--
-- EXISTING CONNECTIONS ARE UNTOUCHED. aws_accounts.external_id stays the value
-- each connection's AssumeRole sends, whatever this table holds.
--
-- ADDITIVE ONLY, and safe BEFORE the code that uses it is deployed. Nothing that
-- exists is altered, and the currently deployed application never reads this
-- table. Its connect flow (aws_connect_sessions) keeps working unchanged.
--
-- aws_accounts and aws_connect_sessions are defined outside the canonical
-- migrations (backend/migrations/019, 020). When either is absent, as in CI's
-- bootstrap, its step of the backfill is skipped with a NOTICE.
--
-- ADMINISTRATIVE MIGRATION (see database/migrations-admin/README.md): applied by
-- hand as postgres before the code is merged. The table is owned by postgres,
-- has row-level security forced on app.current_organization_id, and devcontrol
-- gets SELECT and INSERT only. No UPDATE or DELETE grant, and a trigger refuses
-- any UPDATE: a value can never be changed or rotated by the application.
--
-- Written for PostgreSQL 14 and later.

SET LOCAL lock_timeout = '5s';

DO $$
BEGIN
  IF to_regclass('organizations') IS NULL THEN
    RAISE EXCEPTION 'organizations does not exist -- refusing to proceed.';
  END IF;
  IF to_regclass('aws_org_external_ids') IS NOT NULL THEN
    RAISE EXCEPTION
      'aws_org_external_ids already exists -- this migration creates it and refuses to proceed. '
      'Investigate before re-running.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcontrol') THEN
    RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.';
  END IF;
END $$;

CREATE TABLE aws_org_external_ids (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
  external_id     VARCHAR(64) NOT NULL
                    CHECK (external_id ~ '^[A-Za-z0-9+=,.@:/_-]{2,64}$'),
  source          VARCHAR(16) NOT NULL
                    CHECK (source IN ('connection', 'session', 'generated')),
  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE aws_org_external_ids IS
  '[202611031200_create_aws_org_external_ids] The one AWS External ID per organization that the '
  'Connect AWS page shows and every new connection uses. Never updated; rows are only inserted.';
COMMENT ON COLUMN aws_org_external_ids.source IS
  'Where the value came from: connection (an aws_accounts row), session (aws_connect_sessions) '
  'or generated (crypto.randomBytes by the application).';

CREATE FUNCTION aws_org_external_ids_refuse_update() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'aws_org_external_ids rows are immutable: an External ID is never changed or rotated';
END $$;

CREATE TRIGGER aws_org_external_ids_immutable
  BEFORE UPDATE ON aws_org_external_ids
  FOR EACH ROW EXECUTE FUNCTION aws_org_external_ids_refuse_update();

-- ---------------------------------------------------------------------------
-- Backfill. It runs as postgres, a superuser that row-level security never restricts.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  well_formed CONSTANT TEXT := '^[A-Za-z0-9+=,.@:/_-]{2,64}$';
  n_conn      INTEGER := 0;
  n_sess      INTEGER := 0;
  n_skipped   INTEGER := 0;
  n_conflict  INTEGER := 0;
BEGIN
  IF to_regclass('aws_accounts') IS NULL THEN
    RAISE NOTICE 'aws_accounts does not exist; connection backfill skipped.';
  ELSE
    EXECUTE format($q$
      SELECT count(*) FROM (
        SELECT org_id FROM aws_accounts
         WHERE org_id IS NOT NULL AND external_id ~ %L
         GROUP BY org_id HAVING count(DISTINCT external_id) > 1
      ) c $q$, well_formed) INTO n_conflict;

    EXECUTE format($q$
      SELECT count(*) FROM aws_accounts
       WHERE org_id IS NOT NULL AND (external_id IS NULL OR external_id !~ %L) $q$, well_formed)
      INTO n_skipped;

    EXECUTE format($q$
      INSERT INTO aws_org_external_ids (organization_id, external_id, source)
      SELECT DISTINCT ON (a.org_id) a.org_id, a.external_id, 'connection'
        FROM aws_accounts a
        JOIN organizations o ON o.id = a.org_id
       WHERE a.external_id ~ %L
       ORDER BY a.org_id,
                (a.status = 'active') DESC NULLS LAST,
                a.connected_at DESC NULLS LAST,
                a.id::text DESC
      ON CONFLICT (organization_id) DO NOTHING $q$, well_formed);
    GET DIAGNOSTICS n_conn = ROW_COUNT;
  END IF;

  IF to_regclass('aws_connect_sessions') IS NULL THEN
    RAISE NOTICE 'aws_connect_sessions does not exist; session backfill skipped.';
  ELSE
    EXECUTE format($q$
      INSERT INTO aws_org_external_ids (organization_id, external_id, source)
      SELECT s.org_id, s.external_id, 'session'
        FROM aws_connect_sessions s
        JOIN organizations o ON o.id = s.org_id
       WHERE s.external_id ~ %L
      ON CONFLICT (organization_id) DO NOTHING $q$, well_formed);
    GET DIAGNOSTICS n_sess = ROW_COUNT;
  END IF;

  RAISE NOTICE 'aws_org_external_ids backfill: % from connections, % from sessions; % aws_accounts row(s) with a missing or malformed external_id skipped; % organization(s) with conflicting connection values (active, then newest, kept).',
    n_conn, n_sess, n_skipped, n_conflict;
END $$;

-- ---------------------------------------------------------------------------
-- Row-level security and grants
-- ---------------------------------------------------------------------------
ALTER TABLE aws_org_external_ids ENABLE ROW LEVEL SECURITY;
ALTER TABLE aws_org_external_ids FORCE ROW LEVEL SECURITY;

CREATE POLICY aws_org_external_ids_tenant ON aws_org_external_ids FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

REVOKE ALL ON TABLE aws_org_external_ids FROM PUBLIC, devcontrol;
GRANT SELECT, INSERT ON TABLE aws_org_external_ids TO devcontrol;
REVOKE ALL ON FUNCTION aws_org_external_ids_refuse_update() FROM PUBLIC;
