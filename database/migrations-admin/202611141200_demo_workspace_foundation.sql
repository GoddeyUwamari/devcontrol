-- Migration: demo workspace foundation (T2: the demo marker, its billing and
-- credential CHECK, the demo access grant, and the integration refusals)
--
-- The demo is a tenant: ONE server-side organization holding synthetic sample
-- data, read through the normal data path. This migration only adds the
-- database facts the later code relies on; no application code reads any of
-- it yet. Private notes: review-logs/demo/demo-step1.md §C.3, §D.3-§D.4,
-- t2-build-stop.md, founder decisions DEMO-D1..D20 and T2-D1..D4 (2026-11-14:
-- one combined admin migration; the grant carries no organization column; the
-- demo's aws_accounts row is constrained here; pinned to origin/main).
--
--   + organizations.is_demo  boolean NOT NULL DEFAULT false (catalog-only add).
--   + organizations_single_demo_uidx: at most ONE demo organization.
--   + organizations_demo_holds_no_billing_or_credentials (CHECK): a demo
--     organization is on the free tier and holds no Stripe customer,
--     subscription, subscription status other than the default 'free',
--     period, cancel flag or processed-event watermark; no payment failure or
--     grace period (billing_lifecycle_state 'healthy'); no checkout
--     reservation; no trial claim; no stored AWS credentials. Absence is NULL
--     in every one of these columns (the application writes NULL, never '').
--   + organizations_demo_flag_immutable (trigger): is_demo is fixed when the
--     row is inserted. No existing organization can become the demo, and the
--     demo can never become a real organization (which would put its
--     placeholder AWS row in front of discovery).
--   + demo_workspace_access (user_id PK -> users ON DELETE CASCADE,
--     granted_at, source 'self'|'founder'): who may enter the demo. It has NO
--     organization column, so no row can name an organization at all; the one
--     organization a grant admits to is "the is_demo organization", of which
--     the unique index allows one and the immutability trigger makes sure it
--     was a demo from its first moment. A grant can only be inserted while a
--     demo organization exists. Not a tenant table (T-OWN: no organization_id
--     or org_id column): it is read before the tenant tag is set, like
--     organization_memberships. devcontrol gets SELECT, INSERT, DELETE (enter,
--     check, leave; PR-2), nothing else.
--   + demo_workspace_refuse_row (trigger, BEFORE INSERT OR UPDATE OF
--     organization_id) on organization_invitations, scheduled_reports,
--     observability_collection_scopes, aws_org_external_ids and
--     aws_connection_checks: a row for the demo organization is refused.
--   + demo_workspace_constrain_aws_account (trigger) on aws_accounts, ONLY if
--     that table exists (production has it from before the ledger; CI and
--     test databases create it as a fixture after the bootstrap): the demo's
--     row must be the placeholder AWS documentation account 111122223333,
--     its role in that account, and no External ID. Other organizations'
--     rows are unaffected.
--
-- NOT covered here, pending production verification (no canonical migration
-- creates them, so their production shape is unverified): sso_configurations,
-- api_usage, tenants. Not in production at all: api_keys, webhook_endpoints.
--
-- The trigger functions are postgres-owned SECURITY DEFINER with
-- search_path = pg_catalog, pg_temp and schema-qualified references, so a
-- refusal never depends on the caller's grants or on row level security; they
-- return trigger and cannot be called directly, and EXECUTE is revoked from
-- PUBLIC. Every object carries the marker [202611141200_demo_workspace_foundation]
-- in its comment; the paired rollback removes only marked objects.
--
-- ADMINISTRATIVE MIGRATION (database/migrations-admin/README.md): it alters
-- the postgres-owned organizations, creates a table and functions (devcontrol
-- has no CREATE on public since 202611091300) and creates triggers on
-- postgres-owned tables. Applied by hand as postgres; no application release
-- reads or writes any of it until PR-1a (which reads is_demo), so apply it
-- BEFORE PR-1a is merged. The runner applies this file and its ledger row in
-- ONE transaction: any failure, including the 3 s lock timeout below, leaves
-- nothing applied. Locks (each held to commit; milliseconds on these small
-- tables once granted): ACCESS EXCLUSIVE on organizations (ADD COLUMN, ADD
-- CONSTRAINT with a validating scan); SHARE on organizations (index build);
-- SHARE ROW EXCLUSIVE on users (the new foreign key) and on each table that
-- gets a trigger. While it waits, new queries on organizations (including the
-- per-request membership check) queue behind it for at most 3 s.
--
-- Written for PostgreSQL 14 and later.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  t TEXT;
  required_columns CONSTANT TEXT[] := ARRAY[
    'subscription_tier', 'subscription_status', 'stripe_customer_id', 'stripe_subscription_id',
    'subscription_current_period_start', 'subscription_current_period_end', 'subscription_cancel_at_period_end',
    'billing_lifecycle_state', 'payment_failed_at', 'grace_period_ends_at', 'payment_failed_notification_sent_at',
    'latest_processed_invoice_created_at', 'latest_processed_subscription_event_created_at',
    'checkout_reservation_id', 'checkout_reservation_plan', 'checkout_reservation_expires_at', 'checkout_session_id',
    'trial_used_at', 'trial_subscription_id', 'aws_credentials_encrypted'];
  missing TEXT[];
BEGIN
  IF current_setting('is_superuser') <> 'on' THEN
    RAISE EXCEPTION 'run as a superuser (postgres) -- refusing to proceed.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'devcontrol') THEN
    RAISE EXCEPTION 'role devcontrol does not exist -- refusing to proceed.';
  END IF;
  FOREACH t IN ARRAY ARRAY['organizations', 'users', 'organization_invitations', 'scheduled_reports',
                           'observability_collection_scopes', 'aws_org_external_ids', 'aws_connection_checks'] LOOP
    IF to_regclass('public.' || t) IS NULL THEN
      RAISE EXCEPTION '% does not exist -- refusing to proceed.', t;
    END IF;
  END LOOP;
  FOREACH t IN ARRAY ARRAY['organization_invitations', 'scheduled_reports', 'observability_collection_scopes',
                           'aws_org_external_ids', 'aws_connection_checks'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = ('public.' || t)::regclass AND attname = 'organization_id' AND NOT attisdropped
         AND atttypid = 'uuid'::regtype
    ) THEN
      RAISE EXCEPTION '%.organization_id (uuid) does not exist -- refusing to proceed.', t;
    END IF;
  END LOOP;
  SELECT array_agg(c) INTO missing FROM unnest(required_columns) c
   WHERE NOT EXISTS (SELECT 1 FROM pg_attribute
                      WHERE attrelid = 'public.organizations'::regclass AND attname = c AND NOT attisdropped);
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION 'organizations lacks %: are 202611071200_add_checkout_reservation and 202611091200_add_trial_used_at applied? -- refusing to proceed.', missing;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute
              WHERE attrelid = 'public.organizations'::regclass AND attname = 'is_demo' AND NOT attisdropped) THEN
    RAISE EXCEPTION 'organizations.is_demo already exists -- refusing to proceed. Investigate before re-running.';
  END IF;
  IF to_regclass('public.demo_workspace_access') IS NOT NULL THEN
    RAISE EXCEPTION 'demo_workspace_access already exists -- refusing to proceed. Investigate before re-running.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'demo\_workspace\_%') THEN
    RAISE EXCEPTION 'a public.demo_workspace_* function already exists -- refusing to proceed.';
  END IF;
  -- Nested, not AND-ed: a regclass cast of a missing table would fail at plan time.
  IF to_regclass('public.aws_accounts') IS NOT NULL THEN
    IF (SELECT format_type(atttypid, atttypmod) FROM pg_attribute
         WHERE attrelid = to_regclass('public.aws_accounts') AND attname = 'org_id' AND NOT attisdropped) IS DISTINCT FROM 'uuid'
       OR (SELECT count(*) FROM pg_attribute
            WHERE attrelid = to_regclass('public.aws_accounts') AND attname IN ('account_id', 'role_arn', 'external_id')
              AND NOT attisdropped) <> 3 THEN
      RAISE EXCEPTION 'aws_accounts exists but lacks org_id (uuid), account_id, role_arn or external_id -- refusing to proceed.';
    END IF;
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- The marker, the one-demo index and the billing and credential CHECK.
-- ---------------------------------------------------------------------------
ALTER TABLE public.organizations ADD COLUMN is_demo BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN public.organizations.is_demo IS
  '[202611141200_demo_workspace_foundation] True only for the one demo (sample data) organization. Fixed when the row is inserted (organizations_demo_flag_immutable). Never read from a client, token or request.';

CREATE UNIQUE INDEX organizations_single_demo_uidx ON public.organizations ((true)) WHERE is_demo;

COMMENT ON INDEX public.organizations_single_demo_uidx IS
  '[202611141200_demo_workspace_foundation] At most one organization has is_demo = true.';

ALTER TABLE public.organizations ADD CONSTRAINT organizations_demo_holds_no_billing_or_credentials CHECK (
  NOT is_demo OR (
        subscription_tier = 'free'
    AND (subscription_status IS NULL OR subscription_status = 'free')
    AND stripe_customer_id IS NULL
    AND stripe_subscription_id IS NULL
    AND subscription_current_period_start IS NULL
    AND subscription_current_period_end IS NULL
    AND subscription_cancel_at_period_end IS NOT TRUE
    AND latest_processed_invoice_created_at IS NULL
    AND latest_processed_subscription_event_created_at IS NULL
    AND billing_lifecycle_state = 'healthy'
    AND payment_failed_at IS NULL
    AND grace_period_ends_at IS NULL
    AND payment_failed_notification_sent_at IS NULL
    AND checkout_reservation_id IS NULL
    AND checkout_reservation_plan IS NULL
    AND checkout_reservation_expires_at IS NULL
    AND checkout_session_id IS NULL
    AND trial_used_at IS NULL
    AND trial_subscription_id IS NULL
    AND aws_credentials_encrypted IS NULL
  )
);

COMMENT ON CONSTRAINT organizations_demo_holds_no_billing_or_credentials ON public.organizations IS
  '[202611141200_demo_workspace_foundation] The demo organization is on the free tier and holds no Stripe, subscription, payment-failure, checkout, trial or stored AWS credential state.';

CREATE FUNCTION public.demo_workspace_flag_immutable() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.is_demo IS DISTINCT FROM OLD.is_demo THEN
    RAISE EXCEPTION 'organizations.is_demo is fixed when the organization is created and cannot be changed'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER organizations_demo_flag_immutable
  BEFORE UPDATE OF is_demo ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.demo_workspace_flag_immutable();

-- ---------------------------------------------------------------------------
-- Who may enter the demo. No organization column (T2-D2).
-- ---------------------------------------------------------------------------
CREATE TABLE public.demo_workspace_access (
  user_id     UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  granted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  source      VARCHAR(16) NOT NULL CONSTRAINT demo_workspace_access_source_check CHECK (source IN ('self', 'founder'))
);

COMMENT ON TABLE public.demo_workspace_access IS
  '[202611141200_demo_workspace_foundation] Users who may enter the demo organization (the one is_demo organization), read-only. Not an organization membership and names no organization. Deleted when the user is deleted or leaves.';

CREATE FUNCTION public.demo_workspace_access_requires_demo() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.organizations WHERE is_demo) THEN
    RAISE EXCEPTION 'no demo organization exists: demo access cannot be granted'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER demo_workspace_access_requires_demo
  BEFORE INSERT ON public.demo_workspace_access
  FOR EACH ROW EXECUTE FUNCTION public.demo_workspace_access_requires_demo();

REVOKE ALL ON TABLE public.demo_workspace_access FROM PUBLIC, devcontrol;
GRANT SELECT, INSERT, DELETE ON TABLE public.demo_workspace_access TO devcontrol;

-- ---------------------------------------------------------------------------
-- Integration rows the demo organization may never hold.
-- ---------------------------------------------------------------------------
CREATE FUNCTION public.demo_workspace_refuse_row() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
DECLARE
  target UUID := (to_jsonb(NEW) ->> TG_ARGV[0])::uuid;
BEGIN
  IF target IS NOT NULL AND EXISTS (SELECT 1 FROM public.organizations WHERE id = target AND is_demo) THEN
    RAISE EXCEPTION '% rows are not allowed for the demo organization', TG_TABLE_NAME
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

CREATE TRIGGER demo_workspace_refuse_row
  BEFORE INSERT OR UPDATE OF organization_id ON public.organization_invitations
  FOR EACH ROW EXECUTE FUNCTION public.demo_workspace_refuse_row('organization_id');
CREATE TRIGGER demo_workspace_refuse_row
  BEFORE INSERT OR UPDATE OF organization_id ON public.scheduled_reports
  FOR EACH ROW EXECUTE FUNCTION public.demo_workspace_refuse_row('organization_id');
CREATE TRIGGER demo_workspace_refuse_row
  BEFORE INSERT OR UPDATE OF organization_id ON public.observability_collection_scopes
  FOR EACH ROW EXECUTE FUNCTION public.demo_workspace_refuse_row('organization_id');
CREATE TRIGGER demo_workspace_refuse_row
  BEFORE INSERT OR UPDATE OF organization_id ON public.aws_org_external_ids
  FOR EACH ROW EXECUTE FUNCTION public.demo_workspace_refuse_row('organization_id');
CREATE TRIGGER demo_workspace_refuse_row
  BEFORE INSERT OR UPDATE OF organization_id ON public.aws_connection_checks
  FOR EACH ROW EXECUTE FUNCTION public.demo_workspace_refuse_row('organization_id');

-- The demo's AWS row may only be the documentation placeholder, with no External ID.
CREATE FUNCTION public.demo_workspace_constrain_aws_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW.org_id IS NOT NULL AND EXISTS (SELECT 1 FROM public.organizations WHERE id = NEW.org_id AND is_demo)
     AND NOT (NEW.account_id = '111122223333'
              AND NEW.role_arn LIKE 'arn:aws:iam::111122223333:role/%'
              AND NEW.external_id IS NULL) THEN
    RAISE EXCEPTION 'the demo organization''s AWS row must be the placeholder account 111122223333, a role in it, and no External ID'
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$;

DO $$
BEGIN
  IF to_regclass('public.aws_accounts') IS NULL THEN
    RAISE NOTICE 'aws_accounts does not exist; demo_workspace_constrain_aws_account was created but not attached.';
    RETURN;
  END IF;
  EXECUTE $q$ CREATE TRIGGER demo_workspace_constrain_aws_account
    BEFORE INSERT OR UPDATE ON public.aws_accounts
    FOR EACH ROW EXECUTE FUNCTION public.demo_workspace_constrain_aws_account() $q$;
  EXECUTE $q$ COMMENT ON TRIGGER demo_workspace_constrain_aws_account ON public.aws_accounts IS
    '[202611141200_demo_workspace_foundation] The demo organization''s AWS row is the placeholder 111122223333 with no External ID.' $q$;
END $$;

DO $$
DECLARE t TEXT;
BEGIN
  FOREACH t IN ARRAY ARRAY['organization_invitations', 'scheduled_reports', 'observability_collection_scopes',
                           'aws_org_external_ids', 'aws_connection_checks'] LOOP
    EXECUTE format('COMMENT ON TRIGGER demo_workspace_refuse_row ON public.%I IS %L', t,
      '[202611141200_demo_workspace_foundation] Refuses a row for the demo organization.');
  END LOOP;
END $$;

COMMENT ON TRIGGER organizations_demo_flag_immutable ON public.organizations IS
  '[202611141200_demo_workspace_foundation] is_demo cannot change after insert.';
COMMENT ON TRIGGER demo_workspace_access_requires_demo ON public.demo_workspace_access IS
  '[202611141200_demo_workspace_foundation] A grant needs an existing demo organization.';
COMMENT ON FUNCTION public.demo_workspace_flag_immutable() IS
  '[202611141200_demo_workspace_foundation] Trigger: organizations.is_demo cannot change after insert.';
COMMENT ON FUNCTION public.demo_workspace_access_requires_demo() IS
  '[202611141200_demo_workspace_foundation] Trigger: demo access needs an existing demo organization.';
COMMENT ON FUNCTION public.demo_workspace_refuse_row() IS
  '[202611141200_demo_workspace_foundation] Trigger: refuses a row whose organization (column named by the trigger argument) is the demo organization.';
COMMENT ON FUNCTION public.demo_workspace_constrain_aws_account() IS
  '[202611141200_demo_workspace_foundation] Trigger: the demo organization''s aws_accounts row is the placeholder 111122223333 with no External ID.';

REVOKE ALL ON FUNCTION public.demo_workspace_flag_immutable() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demo_workspace_access_requires_demo() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demo_workspace_refuse_row() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.demo_workspace_constrain_aws_account() FROM PUBLIC;

-- ---------------------------------------------------------------------------
-- Self-check before commit.
-- ---------------------------------------------------------------------------
DO $$
DECLARE
  marker CONSTANT TEXT := '[202611141200_demo_workspace_foundation]';
  t TEXT;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute a JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
     WHERE a.attrelid = 'public.organizations'::regclass AND a.attname = 'is_demo' AND NOT a.attisdropped
       AND a.atttypid = 'boolean'::regtype AND a.attnotnull AND pg_get_expr(d.adbin, d.adrelid) = 'false'
       AND starts_with(COALESCE(col_description(a.attrelid, a.attnum), ''), marker)
  ) THEN
    RAISE EXCEPTION 'organizations.is_demo is not a marked boolean NOT NULL DEFAULT false -- refusing to commit.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.organizations WHERE is_demo) THEN
    RAISE EXCEPTION 'an organization is already a demo -- refusing to commit.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_index i WHERE i.indexrelid = 'public.organizations_single_demo_uidx'::regclass
                  AND i.indisunique AND i.indisvalid AND pg_get_expr(i.indpred, i.indrelid) = 'is_demo') THEN
    RAISE EXCEPTION 'organizations_single_demo_uidx is not a valid unique index on is_demo -- refusing to commit.';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.organizations'::regclass
                  AND conname = 'organizations_demo_holds_no_billing_or_credentials' AND contype = 'c' AND convalidated) THEN
    RAISE EXCEPTION 'organizations_demo_holds_no_billing_or_credentials is missing or not validated -- refusing to commit.';
  END IF;
  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.demo_workspace_access'::regclass)) <> current_user THEN
    RAISE EXCEPTION 'demo_workspace_access is not owned by the role running this migration -- refusing to commit.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_attribute WHERE attrelid = 'public.demo_workspace_access'::regclass
              AND attname IN ('organization_id', 'org_id') AND NOT attisdropped) THEN
    RAISE EXCEPTION 'demo_workspace_access has an organization column -- refusing to commit.';
  END IF;
  IF has_table_privilege('devcontrol', 'public.demo_workspace_access', 'UPDATE')
     OR has_table_privilege('devcontrol', 'public.demo_workspace_access', 'TRUNCATE')
     OR has_table_privilege('devcontrol', 'public.demo_workspace_access', 'REFERENCES')
     OR has_table_privilege('devcontrol', 'public.demo_workspace_access', 'TRIGGER')
     OR NOT has_table_privilege('devcontrol', 'public.demo_workspace_access', 'SELECT')
     OR NOT has_table_privilege('devcontrol', 'public.demo_workspace_access', 'INSERT')
     OR NOT has_table_privilege('devcontrol', 'public.demo_workspace_access', 'DELETE') THEN
    RAISE EXCEPTION 'devcontrol does not have exactly SELECT, INSERT and DELETE on demo_workspace_access -- refusing to commit.';
  END IF;
  FOREACH t IN ARRAY ARRAY['organization_invitations', 'scheduled_reports', 'observability_collection_scopes',
                           'aws_org_external_ids', 'aws_connection_checks'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid = ('public.' || t)::regclass
                    AND tgname = 'demo_workspace_refuse_row' AND tgenabled = 'O') THEN
      RAISE EXCEPTION 'demo_workspace_refuse_row is missing or disabled on % -- refusing to commit.', t;
    END IF;
  END LOOP;
  IF to_regclass('public.aws_accounts') IS NOT NULL AND NOT EXISTS (
       SELECT 1 FROM pg_trigger WHERE tgrelid = to_regclass('public.aws_accounts')
          AND tgname = 'demo_workspace_constrain_aws_account' AND tgenabled = 'O') THEN
    RAISE EXCEPTION 'demo_workspace_constrain_aws_account is missing or disabled on aws_accounts -- refusing to commit.';
  END IF;
  IF EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
              WHERE n.nspname = 'public' AND p.proname LIKE 'demo\_workspace\_%'
                AND (pg_get_userbyid(p.proowner) <> current_user OR NOT p.prosecdef
                     OR p.proconfig IS DISTINCT FROM ARRAY['search_path=pg_catalog, pg_temp']
                     OR has_function_privilege('devcontrol', p.oid, 'EXECUTE'))) THEN
    RAISE EXCEPTION 'a demo_workspace_* function is not a postgres-owned SECURITY DEFINER with search_path pg_catalog, pg_temp and no EXECUTE for devcontrol -- refusing to commit.';
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202611141200_demo_workspace_foundation completed';
END $$;
