-- Migration: GitHub App ingestion foundation (D8a)
--
-- Per-customer pipeline connection through a GitHub App: installation claims,
-- install-flow states, repository mappings (keyed by GitHub's stable
-- repository id), a durable idempotent events log, and a holding table for
-- deliveries of installations no DevControl organization has claimed yet.
-- Also the two deployments indexes that make pipeline records idempotent,
-- deployments.aws_region nullable (pipelines carry no region), and the D6
-- merge-commit index on the events log. One migration for D8a-1, D8a-2 and
-- D6 (founder ruling D8-N10, 2026-11-20). Private notes: d8a-build.md §1.
--
-- ADMINISTRATIVE (database/migrations-admin/README.md): every new object is
-- created by postgres. The four tenant tables have row level security
-- enabled AND forced with one tenant policy. github_held_deliveries has no
-- organization column, RLS enabled and forced with NO policy, and no
-- privilege for devcontrol at all: it is reached only through the
-- SECURITY DEFINER functions below, each with a pinned search_path and
-- EXECUTE for devcontrol only.
--
-- Changes to existing tables:
--   deployments: two partial unique indexes on metadata job / deployment id
--                (SHARE lock while they build), aws_region DROP NOT NULL
--                (catalog-only, brief ACCESS EXCLUSIVE lock). No row changes.
--   demo_workspace_refuse_row triggers on the four new tenant tables.
-- Nothing else on an existing table changes.
--
-- Run with: one transaction (database/migrate.js), as postgres.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  t TEXT;
BEGIN
  IF current_setting('is_superuser') <> 'on' THEN
    RAISE EXCEPTION 'run as a superuser (postgres) -- refusing to proceed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcontrol') THEN
    RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.';
  END IF;
  FOREACH t IN ARRAY ARRAY['organizations', 'users', 'services', 'deployments'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% does not exist -- refusing to proceed.', t;
    END IF;
    IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
         WHERE attrelid = ('public.' || t)::regclass AND attname = 'id' AND NOT attisdropped) IS DISTINCT FROM 'uuid' THEN
      RAISE EXCEPTION '%.id must be uuid -- refusing to proceed.', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['services', 'deployments'] LOOP
    IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
         WHERE attrelid = ('public.' || t)::regclass AND attname = 'organization_id' AND NOT attisdropped) IS DISTINCT FROM 'uuid' THEN
      RAISE EXCEPTION '%.organization_id must be uuid -- refusing to proceed.', t;
    END IF;
  END LOOP;
  IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
       WHERE attrelid = 'public.deployments'::regclass AND attname = 'metadata' AND NOT attisdropped) IS DISTINCT FROM 'jsonb' THEN
    RAISE EXCEPTION 'deployments.metadata must be jsonb -- refusing to proceed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_attribute
       WHERE attrelid = 'public.deployments'::regclass AND attname = 'aws_region' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'deployments.aws_region does not exist -- refusing to proceed.';
  END IF;
  IF col_description('public.deployments'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.deployments'::regclass AND attname = 'aws_region')) IS NOT NULL THEN
    RAISE EXCEPTION 'deployments.aws_region already has a comment -- refusing to proceed. Investigate before re-running.';
  END IF;
  IF to_regprocedure('public.demo_workspace_refuse_row()') IS NULL THEN
    RAISE EXCEPTION 'demo_workspace_refuse_row() does not exist (202611141200_demo_workspace_foundation first) -- refusing to proceed.';
  END IF;
  FOREACH t IN ARRAY ARRAY['github_installations', 'github_install_states', 'pipeline_repositories', 'pipeline_events',
                           'github_held_deliveries', 'deployments_github_job_uidx', 'deployments_github_deployment_uidx'] LOOP
    IF to_regclass('public.' || t) IS NOT NULL THEN
      RAISE EXCEPTION '% already exists -- this migration creates it and refuses to proceed. Investigate before re-running.', t;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM pg_proc WHERE pronamespace = 'public'::regnamespace AND proname IN (
       'github_installation_org', 'github_hold_delivery', 'github_installer_of', 'github_release_held_deliveries',
       'github_purge_held_deliveries', 'pipeline_repositories_service_same_org')) THEN
    RAISE EXCEPTION 'a github_* / pipeline_* function of this migration already exists -- refusing to proceed.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deployments WHERE metadata ? 'github_job_id'
              GROUP BY organization_id, metadata ->> 'github_job_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'deployments holds duplicate (organization_id, metadata github_job_id) rows -- the unique index cannot be built; refusing to proceed.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deployments WHERE metadata ? 'github_deployment_id'
              GROUP BY organization_id, metadata ->> 'github_deployment_id' HAVING count(*) > 1) THEN
    RAISE EXCEPTION 'deployments holds duplicate (organization_id, metadata github_deployment_id) rows -- refusing to proceed.';
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Installation claims: one DevControl organization per GitHub installation.
-- ---------------------------------------------------------------------------
CREATE TABLE public.github_installations (
  installation_id             BIGINT PRIMARY KEY CHECK (installation_id > 0),
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  account_id                  BIGINT NOT NULL CHECK (account_id > 0),
  account_login               VARCHAR(100) NOT NULL CHECK (char_length(account_login) BETWEEN 1 AND 100),
  account_type                VARCHAR(16) NOT NULL CHECK (account_type IN ('User', 'Organization', 'Enterprise')),
  repository_selection        VARCHAR(8) NOT NULL CHECK (repository_selection IN ('all', 'selected')),
  permissions                 JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(permissions) = 'object'),
  events                      JSONB NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(events) = 'array'),
  permissions_state           VARCHAR(16) NOT NULL CHECK (permissions_state IN ('expected', 'mismatch')),
  installer_github_user_id    BIGINT NOT NULL CHECK (installer_github_user_id > 0),
  claimed_by_user_id          UUID REFERENCES public.users(id) ON DELETE SET NULL,
  claimed_by_github_user_id   BIGINT NOT NULL CHECK (claimed_by_github_user_id > 0),
  claimed_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  suspended_at                TIMESTAMPTZ,
  deleted_at                  TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT github_installations_installation_org_key UNIQUE (installation_id, organization_id)
);
CREATE INDEX github_installations_org_idx ON public.github_installations (organization_id);

-- ---------------------------------------------------------------------------
-- Install-flow states: only sha256(state) is stored, bound to user + org.
-- ---------------------------------------------------------------------------
CREATE TABLE public.github_install_states (
  state_hash                  BYTEA PRIMARY KEY CHECK (octet_length(state_hash) = 32),
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id                     UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at                  TIMESTAMPTZ NOT NULL,
  consumed_at                 TIMESTAMPTZ,
  verified_github_user_id     BIGINT CHECK (verified_github_user_id > 0),
  verified_installation_id    BIGINT CHECK (verified_installation_id > 0),
  verified_at                 TIMESTAMPTZ,
  retry_count                 SMALLINT NOT NULL DEFAULT 0 CHECK (retry_count BETWEEN 0 AND 10),
  CONSTRAINT github_install_states_expiry CHECK (expires_at > created_at AND expires_at <= created_at + interval '1 hour'),
  CONSTRAINT github_install_states_verified CHECK (
    (verified_at IS NULL) = (verified_github_user_id IS NULL)
    AND (verified_at IS NULL) = (verified_installation_id IS NULL)
    AND (verified_at IS NULL OR consumed_at IS NOT NULL))
);
CREATE INDEX github_install_states_org_user_idx ON public.github_install_states (organization_id, user_id);

-- ---------------------------------------------------------------------------
-- Repository mappings: one row per (organization, GitHub repository id).
-- ---------------------------------------------------------------------------
CREATE TABLE public.pipeline_repositories (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  github_repo_id              BIGINT NOT NULL CHECK (github_repo_id > 0),
  installation_id             BIGINT,
  full_name                   VARCHAR(255) NOT NULL CHECK (char_length(full_name) BETWEEN 3 AND 255 AND position('/' IN full_name) > 1),
  default_branch              VARCHAR(255),
  service_id                  UUID REFERENCES public.services(id) ON DELETE SET NULL,
  deploy_rule                 JSONB CHECK (deploy_rule IS NULL OR jsonb_typeof(deploy_rule) = 'object'),
  access_state                VARCHAR(12) NOT NULL DEFAULT 'accessible' CHECK (access_state IN ('accessible', 'removed')),
  removed_at                  TIMESTAMPTZ,
  last_event_at               TIMESTAMPTZ,
  created_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at                  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT pipeline_repositories_org_repo_key UNIQUE (organization_id, github_repo_id),
  CONSTRAINT pipeline_repositories_removed CHECK ((access_state = 'removed') = (removed_at IS NOT NULL)),
  CONSTRAINT pipeline_repositories_installation_fk FOREIGN KEY (installation_id, organization_id)
    REFERENCES public.github_installations (installation_id, organization_id)
);
CREATE INDEX pipeline_repositories_installation_idx ON public.pipeline_repositories (installation_id);
CREATE INDEX pipeline_repositories_service_idx ON public.pipeline_repositories (service_id);

-- A repository can only be mapped to a service of its own organization. Invoker
-- rights: a tagged devcontrol connection sees only its own organization's
-- services, so another organization's service reads as missing.
CREATE FUNCTION public.pipeline_repositories_service_same_org() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.service_id IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM public.services s WHERE s.id = NEW.service_id AND s.organization_id = NEW.organization_id) THEN
    RAISE EXCEPTION 'pipeline_repositories.service_id must name a service of the same organization'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION public.pipeline_repositories_service_same_org() FROM PUBLIC;

CREATE TRIGGER pipeline_repositories_service_same_org
  BEFORE INSERT OR UPDATE OF service_id, organization_id ON public.pipeline_repositories
  FOR EACH ROW EXECUTE FUNCTION public.pipeline_repositories_service_same_org();

-- ---------------------------------------------------------------------------
-- Events log: named fields only (never a raw payload), one row per delivery.
-- ---------------------------------------------------------------------------
CREATE TABLE public.pipeline_events (
  id                          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  delivery_id                 UUID NOT NULL,
  organization_id             UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  installation_id             BIGINT NOT NULL CHECK (installation_id > 0),
  github_repo_id              BIGINT CHECK (github_repo_id > 0),
  event                       VARCHAR(32) NOT NULL CHECK (event IN ('workflow_job', 'workflow_run', 'deployment', 'deployment_status',
                                                                    'pull_request', 'installation', 'installation_repositories')),
  action                      VARCHAR(32) NOT NULL CHECK (action ~ '^[a-z_]{1,32}$'),
  event_key                   VARCHAR(160),
  occurred_at                 TIMESTAMPTZ,
  received_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  held_at                     TIMESTAMPTZ,
  normalizer_version          SMALLINT NOT NULL CHECK (normalizer_version >= 1),
  facts                       JSONB NOT NULL CHECK (jsonb_typeof(facts) = 'object' AND pg_column_size(facts) <= 65536),
  payload_sha256              CHAR(64) CHECK (payload_sha256 ~ '^[0-9a-f]{64}$'),
  processing_status           VARCHAR(16) NOT NULL DEFAULT 'pending'
                                CHECK (processing_status IN ('pending', 'processed', 'ignored', 'unmapped', 'over_limit', 'failed')),
  processing_reason           VARCHAR(64) CHECK (processing_reason ~ '^[a-z0-9_]{1,64}$'),
  processing_attempts         SMALLINT NOT NULL DEFAULT 0 CHECK (processing_attempts >= 0),
  processed_at                TIMESTAMPTZ,
  deployment_id               UUID REFERENCES public.deployments(id) ON DELETE SET NULL,
  CONSTRAINT pipeline_events_delivery_key UNIQUE (delivery_id)
);
CREATE UNIQUE INDEX pipeline_events_org_event_key_uidx ON public.pipeline_events (organization_id, event_key) WHERE event_key IS NOT NULL;
CREATE INDEX pipeline_events_org_received_idx ON public.pipeline_events (organization_id, received_at DESC);
CREATE INDEX pipeline_events_org_repo_event_idx ON public.pipeline_events (organization_id, github_repo_id, event, occurred_at);
CREATE INDEX pipeline_events_merge_sha_idx ON public.pipeline_events (organization_id, github_repo_id, (facts ->> 'merge_commit_sha'))
  WHERE event = 'pull_request';
CREATE INDEX pipeline_events_retry_idx ON public.pipeline_events (organization_id, processing_status)
  WHERE processing_status IN ('pending', 'failed', 'unmapped', 'over_limit');
CREATE INDEX pipeline_events_installation_idx ON public.pipeline_events (installation_id, event, action);

-- ---------------------------------------------------------------------------
-- Deliveries of installations no organization has claimed (yet). No
-- organization column; devcontrol has no privilege on it.
-- ---------------------------------------------------------------------------
CREATE TABLE public.github_held_deliveries (
  delivery_id                 UUID PRIMARY KEY,
  installation_id             BIGINT NOT NULL CHECK (installation_id > 0),
  github_repo_id              BIGINT CHECK (github_repo_id > 0),
  event                       VARCHAR(32) NOT NULL CHECK (event IN ('workflow_job', 'workflow_run', 'deployment', 'deployment_status',
                                                                    'pull_request', 'installation', 'installation_repositories')),
  action                      VARCHAR(32) NOT NULL CHECK (action ~ '^[a-z_]{1,32}$'),
  event_key                   VARCHAR(160),
  occurred_at                 TIMESTAMPTZ,
  received_at                 TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  normalizer_version          SMALLINT NOT NULL CHECK (normalizer_version >= 1),
  facts                       JSONB NOT NULL CHECK (jsonb_typeof(facts) = 'object' AND pg_column_size(facts) <= 65536),
  payload_sha256              CHAR(64) CHECK (payload_sha256 ~ '^[0-9a-f]{64}$')
);
CREATE INDEX github_held_deliveries_installation_idx ON public.github_held_deliveries (installation_id);
CREATE INDEX github_held_deliveries_received_idx ON public.github_held_deliveries (received_at);

-- ---------------------------------------------------------------------------
-- The only paths past row level security (postgres-owned, SECURITY DEFINER).
-- ---------------------------------------------------------------------------

-- installation id -> organization id, nothing else.
CREATE FUNCTION public.github_installation_org(p_installation_id BIGINT) RETURNS UUID
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT organization_id FROM public.github_installations WHERE installation_id = p_installation_id
$$;

-- Holds one delivery of an unclaimed installation. Serialized with a claim's
-- release by a transaction advisory lock on the installation id, so a
-- delivery is either released by the claim or reported 'claimed' here (the
-- caller then stores it for the organization) -- never left behind.
CREATE FUNCTION public.github_hold_delivery(
  p_delivery_id UUID, p_installation_id BIGINT, p_event TEXT, p_action TEXT, p_github_repo_id BIGINT,
  p_event_key TEXT, p_occurred_at TIMESTAMPTZ, p_normalizer_version SMALLINT, p_facts JSONB, p_payload_sha256 TEXT
) RETURNS TEXT
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  inserted INTEGER;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('github_installation:' || p_installation_id::text, 0));
  IF EXISTS (SELECT 1 FROM public.github_installations WHERE installation_id = p_installation_id) THEN
    RETURN 'claimed';
  END IF;
  IF EXISTS (SELECT 1 FROM public.pipeline_events WHERE delivery_id = p_delivery_id) THEN
    RETURN 'duplicate';
  END IF;
  IF p_event_key IS NOT NULL AND EXISTS (
       SELECT 1 FROM public.github_held_deliveries WHERE installation_id = p_installation_id AND event_key = p_event_key) THEN
    RETURN 'duplicate';
  END IF;
  INSERT INTO public.github_held_deliveries
    (delivery_id, installation_id, github_repo_id, event, action, event_key, occurred_at, normalizer_version, facts, payload_sha256)
  VALUES
    (p_delivery_id, p_installation_id, p_github_repo_id, p_event, p_action, p_event_key, p_occurred_at, p_normalizer_version, p_facts, p_payload_sha256)
  ON CONFLICT (delivery_id) DO NOTHING;
  GET DIAGNOSTICS inserted = ROW_COUNT;
  RETURN CASE WHEN inserted = 1 THEN 'held' ELSE 'duplicate' END;
END $$;

-- The GitHub user id that created the installation (sender of the signed
-- installation.created delivery), held or already released. NULL if unknown.
CREATE FUNCTION public.github_installer_of(p_installation_id BIGINT) RETURNS BIGINT
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
  SELECT (d.facts -> 'sender' ->> 'id')::bigint
    FROM (
      SELECT facts, received_at FROM public.github_held_deliveries
       WHERE installation_id = p_installation_id AND event = 'installation' AND action = 'created'
      UNION ALL
      SELECT facts, received_at FROM public.pipeline_events
       WHERE installation_id = p_installation_id AND event = 'installation' AND action = 'created'
    ) d
   WHERE (d.facts -> 'sender' ->> 'id') ~ '^[1-9][0-9]{0,17}$'
   ORDER BY d.received_at
   LIMIT 1
$$;

-- Moves an installation's held deliveries to pipeline_events, only for the
-- organization the calling connection is tagged for, and only when that
-- organization holds the installation's claim. Returns the rows moved.
CREATE FUNCTION public.github_release_held_deliveries(p_installation_id BIGINT) RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  tag TEXT := NULLIF(pg_catalog.current_setting('app.current_organization_id', true), '');
  owner_org UUID;
  moved INTEGER;
BEGIN
  IF tag IS NULL THEN
    RETURN 0;
  END IF;
  PERFORM pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended('github_installation:' || p_installation_id::text, 0));
  SELECT organization_id INTO owner_org FROM public.github_installations WHERE installation_id = p_installation_id;
  IF owner_org IS NULL OR owner_org::text <> pg_catalog.lower(tag) THEN
    RETURN 0;
  END IF;
  WITH taken AS (
    DELETE FROM public.github_held_deliveries h WHERE h.installation_id = p_installation_id
    RETURNING h.*
  )
  INSERT INTO public.pipeline_events
    (delivery_id, organization_id, installation_id, github_repo_id, event, action, event_key, occurred_at,
     received_at, held_at, normalizer_version, facts, payload_sha256)
  SELECT delivery_id, owner_org, installation_id, github_repo_id, event, action, event_key, occurred_at,
         received_at, received_at, normalizer_version, facts, payload_sha256
    FROM taken
  ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS moved = ROW_COUNT;
  RETURN moved;
END $$;

-- Retention for held deliveries (d8a-build.md D8-D15: 7 days), at most 5,000 per call.
CREATE FUNCTION public.github_purge_held_deliveries() RETURNS INTEGER
LANGUAGE plpgsql VOLATILE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  purged INTEGER;
BEGIN
  DELETE FROM public.github_held_deliveries
   WHERE delivery_id IN (SELECT delivery_id FROM public.github_held_deliveries
                          WHERE received_at < pg_catalog.now() - interval '7 days'
                          ORDER BY received_at LIMIT 5000);
  GET DIAGNOSTICS purged = ROW_COUNT;
  RETURN purged;
END $$;

REVOKE ALL ON FUNCTION public.github_installation_org(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.github_hold_delivery(UUID, BIGINT, TEXT, TEXT, BIGINT, TEXT, TIMESTAMPTZ, SMALLINT, JSONB, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.github_installer_of(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.github_release_held_deliveries(BIGINT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.github_purge_held_deliveries() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.github_installation_org(BIGINT) TO devcontrol;
GRANT EXECUTE ON FUNCTION public.github_hold_delivery(UUID, BIGINT, TEXT, TEXT, BIGINT, TEXT, TIMESTAMPTZ, SMALLINT, JSONB, TEXT) TO devcontrol;
GRANT EXECUTE ON FUNCTION public.github_installer_of(BIGINT) TO devcontrol;
GRANT EXECUTE ON FUNCTION public.github_release_held_deliveries(BIGINT) TO devcontrol;
GRANT EXECUTE ON FUNCTION public.github_purge_held_deliveries() TO devcontrol;

-- ---------------------------------------------------------------------------
-- Row level security, policies, grants.
-- ---------------------------------------------------------------------------
ALTER TABLE public.github_installations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_installations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.github_install_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_install_states FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_repositories FORCE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.pipeline_events FORCE ROW LEVEL SECURITY;
ALTER TABLE public.github_held_deliveries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.github_held_deliveries FORCE ROW LEVEL SECURITY;

CREATE POLICY github_installations_tenant ON public.github_installations FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
CREATE POLICY github_install_states_tenant ON public.github_install_states FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
CREATE POLICY pipeline_repositories_tenant ON public.pipeline_repositories FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);
CREATE POLICY pipeline_events_tenant ON public.pipeline_events FOR ALL
  USING (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid)
  WITH CHECK (organization_id = NULLIF(current_setting('app.current_organization_id', true), '')::uuid);

REVOKE ALL ON TABLE public.github_installations FROM PUBLIC, devcontrol;
REVOKE ALL ON TABLE public.github_install_states FROM PUBLIC, devcontrol;
REVOKE ALL ON TABLE public.pipeline_repositories FROM PUBLIC, devcontrol;
REVOKE ALL ON TABLE public.pipeline_events FROM PUBLIC, devcontrol;
REVOKE ALL ON TABLE public.github_held_deliveries FROM PUBLIC, devcontrol;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.github_installations TO devcontrol;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.github_install_states TO devcontrol;
GRANT SELECT, INSERT, UPDATE ON TABLE public.pipeline_repositories TO devcontrol;
GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE public.pipeline_events TO devcontrol;

-- Rows the demo organization may never hold (202611141200_demo_workspace_foundation).
CREATE TRIGGER demo_workspace_refuse_row
  BEFORE INSERT OR UPDATE OF organization_id ON public.github_installations
  FOR EACH ROW EXECUTE FUNCTION public.demo_workspace_refuse_row('organization_id');
CREATE TRIGGER demo_workspace_refuse_row
  BEFORE INSERT OR UPDATE OF organization_id ON public.github_install_states
  FOR EACH ROW EXECUTE FUNCTION public.demo_workspace_refuse_row('organization_id');
CREATE TRIGGER demo_workspace_refuse_row
  BEFORE INSERT OR UPDATE OF organization_id ON public.pipeline_repositories
  FOR EACH ROW EXECUTE FUNCTION public.demo_workspace_refuse_row('organization_id');
CREATE TRIGGER demo_workspace_refuse_row
  BEFORE INSERT OR UPDATE OF organization_id ON public.pipeline_events
  FOR EACH ROW EXECUTE FUNCTION public.demo_workspace_refuse_row('organization_id');

-- ---------------------------------------------------------------------------
-- deployments: idempotent pipeline records; region not always known.
-- ---------------------------------------------------------------------------
CREATE UNIQUE INDEX deployments_github_job_uidx ON public.deployments (organization_id, (metadata ->> 'github_job_id'))
  WHERE metadata ? 'github_job_id';
CREATE UNIQUE INDEX deployments_github_deployment_uidx ON public.deployments (organization_id, (metadata ->> 'github_deployment_id'))
  WHERE metadata ? 'github_deployment_id';
ALTER TABLE public.deployments ALTER COLUMN aws_region DROP NOT NULL;

-- ---------------------------------------------------------------------------
-- Markers (the rollback drops only what carries one).
-- ---------------------------------------------------------------------------
COMMENT ON TABLE public.github_installations IS
  '[202611201200_create_github_app_ingestion] One DevControl organization per GitHub App installation, claimed by the GitHub user who installed it. Never a token or key.';
COMMENT ON TABLE public.github_install_states IS
  '[202611201200_create_github_app_ingestion] Install-flow states: sha256 of the state only, bound to one user and organization, single use, 15 minutes.';
COMMENT ON TABLE public.pipeline_repositories IS
  '[202611201200_create_github_app_ingestion] Repositories by GitHub repository id (stable across renames and transfers), with the service they map to. Never created as a service.';
COMMENT ON TABLE public.pipeline_events IS
  '[202611201200_create_github_app_ingestion] GitHub App deliveries for an organization: named fields only, never a raw payload, commit message, email or PR body. 180-day retention.';
COMMENT ON TABLE public.github_held_deliveries IS
  '[202611201200_create_github_app_ingestion] Deliveries of installations no organization has claimed. No application access; definer functions only. 7-day retention.';
COMMENT ON FUNCTION public.github_installation_org(BIGINT) IS '[202611201200_create_github_app_ingestion] installation id -> organization id.';
COMMENT ON FUNCTION public.github_hold_delivery(UUID, BIGINT, TEXT, TEXT, BIGINT, TEXT, TIMESTAMPTZ, SMALLINT, JSONB, TEXT) IS
  '[202611201200_create_github_app_ingestion] Holds a delivery of an unclaimed installation.';
COMMENT ON FUNCTION public.github_installer_of(BIGINT) IS '[202611201200_create_github_app_ingestion] Sender id of installation.created.';
COMMENT ON FUNCTION public.github_release_held_deliveries(BIGINT) IS
  '[202611201200_create_github_app_ingestion] Releases held deliveries to the claiming (tagged) organization.';
COMMENT ON FUNCTION public.github_purge_held_deliveries() IS '[202611201200_create_github_app_ingestion] 7-day retention for held deliveries.';
COMMENT ON FUNCTION public.pipeline_repositories_service_same_org() IS
  '[202611201200_create_github_app_ingestion] A repository maps only to a service of its own organization.';
COMMENT ON INDEX public.deployments_github_job_uidx IS
  '[202611201200_create_github_app_ingestion] One deployment row per GitHub Actions job per organization (legacy webhook and App).';
COMMENT ON INDEX public.deployments_github_deployment_uidx IS
  '[202611201200_create_github_app_ingestion] One deployment row per GitHub Deployment per organization.';
COMMENT ON COLUMN public.deployments.aws_region IS
  '[202611201200_create_github_app_ingestion] NULL = not recorded (a pipeline record carries no region).';

-- ---------------------------------------------------------------------------
-- Self-check before commit.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  t TEXT;
  f TEXT;
  expected TEXT;
  actual TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['github_installations', 'github_install_states', 'pipeline_repositories', 'pipeline_events', 'github_held_deliveries'] LOOP
    IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = ('public.' || t)::regclass)) <> current_user THEN
      RAISE EXCEPTION '% is not owned by the role running this migration -- refusing to commit.', t;
    END IF;
    IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = ('public.' || t)::regclass) THEN
      RAISE EXCEPTION 'row level security is not enabled and forced on % -- refusing to commit.', t;
    END IF;
    expected := CASE t WHEN 'pipeline_repositories' THEN 'INSERT,SELECT,UPDATE'
                       WHEN 'github_held_deliveries' THEN ''
                       ELSE 'DELETE,INSERT,SELECT,UPDATE' END;
    SELECT COALESCE(string_agg(p, ',' ORDER BY p), '') INTO actual
      FROM unnest(ARRAY['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']) p
     WHERE has_table_privilege('devcontrol', ('public.' || t)::regclass, p);
    IF actual <> expected THEN
      RAISE EXCEPTION 'devcontrol has % on % (expected %) -- refusing to commit.', actual, t, expected;
    END IF;
    IF EXISTS (SELECT 1 FROM pg_class c, aclexplode(c.relacl) a WHERE c.oid = ('public.' || t)::regclass AND a.grantee = 0) THEN
      RAISE EXCEPTION 'PUBLIC holds a privilege on % -- refusing to commit.', t;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.github_installation_org(bigint)',
                           'public.github_hold_delivery(uuid,bigint,text,text,bigint,text,timestamptz,smallint,jsonb,text)',
                           'public.github_installer_of(bigint)', 'public.github_release_held_deliveries(bigint)',
                           'public.github_purge_held_deliveries()'] LOOP
    IF NOT (SELECT prosecdef AND pg_get_userbyid(proowner) = current_user
                   AND proconfig = ARRAY['search_path=pg_catalog, pg_temp']
              FROM pg_proc WHERE oid = f::regprocedure) THEN
      RAISE EXCEPTION '% is not a postgres-owned SECURITY DEFINER function with search_path pg_catalog, pg_temp -- refusing to commit.', f;
    END IF;
    IF has_function_privilege('public', f, 'EXECUTE') OR NOT has_function_privilege('devcontrol', f, 'EXECUTE') THEN
      RAISE EXCEPTION 'EXECUTE on % is not exactly devcontrol -- refusing to commit.', f;
    END IF;
  END LOOP;
  IF (SELECT count(*) FROM pg_policy WHERE polrelid = 'public.github_held_deliveries'::regclass) <> 0 THEN
    RAISE EXCEPTION 'github_held_deliveries must have no policy -- refusing to commit.';
  END IF;
  IF (SELECT attnotnull FROM pg_attribute WHERE attrelid = 'public.deployments'::regclass AND attname = 'aws_region') THEN
    RAISE EXCEPTION 'deployments.aws_region is still NOT NULL -- refusing to commit.';
  END IF;
END $$;
