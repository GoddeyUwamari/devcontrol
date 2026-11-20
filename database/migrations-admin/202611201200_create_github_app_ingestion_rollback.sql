-- Rollback: 202611201200_create_github_app_ingestion (D8a)
--
-- Manual only, as postgres, in one transaction, AFTER reverting the
-- application to a release before D8a:
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> -f 202611201200_create_github_app_ingestion_rollback.sql
--
-- Loses every installation claim, install state, repository mapping, stored
-- and held GitHub event. Deployment rows are kept. Refuses while any
-- deployment has aws_region NULL (restoring NOT NULL would fail; set a value
-- deliberately first). Drops only objects carrying the migration's marker,
-- never with CASCADE, and its schema_migrations row.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  marker CONSTANT TEXT := '[202611201200_create_github_app_ingestion]';
  t TEXT;
  f TEXT;
BEGIN
  IF current_setting('is_superuser') <> 'on' THEN
    RAISE EXCEPTION 'run as a superuser (postgres) -- refusing to proceed.';
  END IF;
  FOREACH t IN ARRAY ARRAY['github_installations', 'github_install_states', 'pipeline_repositories', 'pipeline_events', 'github_held_deliveries'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% does not exist -- nothing to roll back, or a partial state: investigate.', t;
    END IF;
    IF NOT starts_with(COALESCE(obj_description(('public.' || t)::regclass, 'pg_class'), ''), marker) THEN
      RAISE EXCEPTION '% was not created by the paired migration (no marker) -- refusing to drop it.', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['deployments_github_job_uidx', 'deployments_github_deployment_uidx'] LOOP
    IF to_regclass('public.' || t) IS NULL
       OR NOT starts_with(COALESCE(obj_description(('public.' || t)::regclass, 'pg_class'), ''), marker) THEN
      RAISE EXCEPTION '% is missing or not created by the paired migration -- refusing to proceed.', t;
    END IF;
  END LOOP;
  FOREACH f IN ARRAY ARRAY['public.github_installation_org(bigint)',
                           'public.github_hold_delivery(uuid,bigint,text,text,bigint,text,timestamptz,smallint,jsonb,text)',
                           'public.github_installer_of(bigint)', 'public.github_release_held_deliveries(bigint)',
                           'public.github_purge_held_deliveries()', 'public.pipeline_repositories_service_same_org()'] LOOP
    IF to_regprocedure(f) IS NULL
       OR NOT starts_with(COALESCE(obj_description(to_regprocedure(f), 'pg_proc'), ''), marker) THEN
      RAISE EXCEPTION '% is missing or not created by the paired migration -- refusing to proceed.', f;
    END IF;
  END LOOP;
  IF NOT starts_with(COALESCE(col_description('public.deployments'::regclass,
       (SELECT attnum FROM pg_attribute WHERE attrelid = 'public.deployments'::regclass AND attname = 'aws_region')), ''), marker) THEN
    RAISE EXCEPTION 'deployments.aws_region does not carry the migration marker -- refusing to proceed.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.deployments WHERE aws_region IS NULL) THEN
    RAISE EXCEPTION '% deployments have aws_region NULL -- NOT NULL cannot be restored; set a value deliberately first. Nothing was changed.',
      (SELECT count(*) FROM public.deployments WHERE aws_region IS NULL);
  END IF;
END $$;

DROP TRIGGER demo_workspace_refuse_row ON public.github_installations;
DROP TRIGGER demo_workspace_refuse_row ON public.github_install_states;
DROP TRIGGER demo_workspace_refuse_row ON public.pipeline_repositories;
DROP TRIGGER demo_workspace_refuse_row ON public.pipeline_events;
DROP TRIGGER pipeline_repositories_service_same_org ON public.pipeline_repositories;

DROP FUNCTION public.github_installation_org(BIGINT);
DROP FUNCTION public.github_hold_delivery(UUID, BIGINT, TEXT, TEXT, BIGINT, TEXT, TIMESTAMPTZ, SMALLINT, JSONB, TEXT);
DROP FUNCTION public.github_installer_of(BIGINT);
DROP FUNCTION public.github_release_held_deliveries(BIGINT);
DROP FUNCTION public.github_purge_held_deliveries();
DROP FUNCTION public.pipeline_repositories_service_same_org();

DROP TABLE public.pipeline_events;
DROP TABLE public.pipeline_repositories;
DROP TABLE public.github_install_states;
DROP TABLE public.github_installations;
DROP TABLE public.github_held_deliveries;

DROP INDEX public.deployments_github_job_uidx;
DROP INDEX public.deployments_github_deployment_uidx;
ALTER TABLE public.deployments ALTER COLUMN aws_region SET NOT NULL;
COMMENT ON COLUMN public.deployments.aws_region IS NULL;

DELETE FROM schema_migrations
 WHERE migration_name = '202611201200_create_github_app_ingestion.sql';
