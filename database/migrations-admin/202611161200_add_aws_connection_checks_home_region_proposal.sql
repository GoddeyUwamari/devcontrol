-- Migration: home-region proposal columns on aws_connection_checks (home region HR-0)
--
-- The connect flow proposes a home region for a NEW AWS connection from one
-- Cost Explorer request (spend grouped by region, the connected account only,
-- the last 30 days). The owner confirms or dismisses it; nothing changes the
-- home region by itself. This migration only ADDS, to aws_connection_checks
-- (one row per aws_accounts row; postgres-owned, row level security forced):
--
--   + home_region_proposal        jsonb: what was proposed and from what
--                                 evidence (region codes, rounded shares and
--                                 USD usage amounts rounded to cents; never an
--                                 AWS message or a credential)
--   + home_region_proposal_state  'proposed' | 'split' | 'accepted' |
--                                 'dismissed' | 'superseded' | 'no_signal' |
--                                 'unavailable' (split: spend spread over
--                                 several regions, the owner is asked to choose)
--   + home_region_proposed_at     when the evidence was evaluated
--   + home_region_decided_at      when the owner decided (accepted, dismissed)
--                                 or the home region was changed to another
--                                 region (superseded)
--
--   and three named CHECK constraints tying them together:
--     _object    the proposal is a JSON object
--     _state     the state is one of the seven values
--     _complete  a state has its evaluation time; proposed, split, accepted,
--                dismissed and superseded carry a proposal; a decision time
--                exactly for accepted, dismissed and superseded
--
-- Nullable with no default: a catalog-only change, no table rewrite. Every
-- existing row reads NULL, which means "never proposed": existing connections
-- are never given a proposal (no backfill). Private notes:
-- home-region-step1.md §C.2, HR-D2 (founder decisions Nov 16).
--
-- REFUSES (nothing applied) when not run as a superuser, when
-- aws_connection_checks is missing or not owned by the role running this, or
-- when any of the four columns or three constraints already exists. Checks
-- itself before commit.
--
-- Every column and constraint carries the marker
-- [202611161200_add_aws_connection_checks_home_region_proposal] in its
-- comment; the paired rollback drops them only if every marker is there.
--
-- ADMINISTRATIVE MIGRATION (database/migrations-admin/README.md):
-- aws_connection_checks is postgres-owned, so ALTER TABLE needs the owner. The
-- application role reaches the new columns through its existing table-level
-- SELECT, INSERT and UPDATE; no grant changes. The release running when this
-- is applied never reads or writes the columns. The runner applies this file
-- and its ledger row in ONE transaction: any failure, including the 3 s lock
-- timeout below, leaves nothing applied. Lock: ACCESS EXCLUSIVE on
-- aws_connection_checks for the ADD COLUMNs and the CHECK validation (one row
-- per connection; milliseconds once granted).
--
-- Written for PostgreSQL 14 and later.

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF current_setting('is_superuser') <> 'on' THEN
    RAISE EXCEPTION 'run as a superuser (postgres) -- refusing to proceed.';
  END IF;
  IF to_regclass('public.aws_connection_checks') IS NULL THEN
    RAISE EXCEPTION 'aws_connection_checks does not exist (apply 202611111200_create_aws_connection_checks.sql first) -- refusing to proceed.';
  END IF;
  IF pg_get_userbyid((SELECT relowner FROM pg_class WHERE oid = 'public.aws_connection_checks'::regclass)) <> current_user THEN
    RAISE EXCEPTION 'aws_connection_checks is not owned by the role running this migration -- refusing to proceed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.aws_connection_checks'::regclass AND NOT attisdropped
       AND attname IN ('home_region_proposal', 'home_region_proposal_state', 'home_region_proposed_at', 'home_region_decided_at')
  ) THEN
    RAISE EXCEPTION 'a home_region_* column already exists on aws_connection_checks -- refusing to proceed. Investigate before re-running.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'public.aws_connection_checks'::regclass
       AND conname IN ('aws_connection_checks_home_region_proposal_object',
                       'aws_connection_checks_home_region_proposal_state',
                       'aws_connection_checks_home_region_proposal_complete')
  ) THEN
    RAISE EXCEPTION 'a home-region proposal constraint already exists on aws_connection_checks -- refusing to proceed. Investigate before re-running.';
  END IF;
END $$;

ALTER TABLE public.aws_connection_checks
  ADD COLUMN home_region_proposal JSONB,
  ADD COLUMN home_region_proposal_state VARCHAR(16),
  ADD COLUMN home_region_proposed_at TIMESTAMPTZ,
  ADD COLUMN home_region_decided_at TIMESTAMPTZ,
  ADD CONSTRAINT aws_connection_checks_home_region_proposal_object
    CHECK (jsonb_typeof(home_region_proposal) = 'object'),
  ADD CONSTRAINT aws_connection_checks_home_region_proposal_state
    CHECK (home_region_proposal_state IN ('proposed', 'split', 'accepted', 'dismissed', 'superseded', 'no_signal', 'unavailable')),
  ADD CONSTRAINT aws_connection_checks_home_region_proposal_complete
    CHECK (
      (home_region_proposal_state IS NULL) = (home_region_proposed_at IS NULL)
      AND (home_region_proposal IS NOT NULL
           OR COALESCE(home_region_proposal_state NOT IN ('proposed', 'split', 'accepted', 'dismissed', 'superseded'), true))
      AND (home_region_decided_at IS NOT NULL)
          = COALESCE(home_region_proposal_state IN ('accepted', 'dismissed', 'superseded'), false)
    );

COMMENT ON COLUMN public.aws_connection_checks.home_region_proposal IS
  '[202611161200_add_aws_connection_checks_home_region_proposal] The home region proposed for this connection and its evidence: region codes, rounded shares and USD amounts (cents) of the connected account''s usage charges over 30 days by region (Cost Explorer). Never an AWS message or a credential.';
COMMENT ON COLUMN public.aws_connection_checks.home_region_proposal_state IS
  '[202611161200_add_aws_connection_checks_home_region_proposal] proposed, split (spend spread over several regions: the owner is asked to choose), accepted, dismissed, superseded (the home region was changed to another region), no_signal (too little spend, or the current home region leads) or unavailable (Cost Explorer could not answer). NULL: never proposed.';
COMMENT ON COLUMN public.aws_connection_checks.home_region_proposed_at IS
  '[202611161200_add_aws_connection_checks_home_region_proposal] When the evidence was evaluated.';
COMMENT ON COLUMN public.aws_connection_checks.home_region_decided_at IS
  '[202611161200_add_aws_connection_checks_home_region_proposal] When the owner accepted or dismissed the proposal, or the home region was changed to another region.';
COMMENT ON CONSTRAINT aws_connection_checks_home_region_proposal_object ON public.aws_connection_checks IS
  '[202611161200_add_aws_connection_checks_home_region_proposal] The proposal is a JSON object.';
COMMENT ON CONSTRAINT aws_connection_checks_home_region_proposal_state ON public.aws_connection_checks IS
  '[202611161200_add_aws_connection_checks_home_region_proposal] The proposal state is one of the seven values.';
COMMENT ON CONSTRAINT aws_connection_checks_home_region_proposal_complete ON public.aws_connection_checks IS
  '[202611161200_add_aws_connection_checks_home_region_proposal] A state has its evaluation time; a proposal-bearing state has its proposal; a decision time exactly for accepted, dismissed and superseded.';

-- Self-check before commit: four marked, nullable columns of the expected types
-- with no default; three marked, validated constraints; the table still
-- postgres-owned with row level security enabled and forced; the application
-- role reaches every new column with SELECT, INSERT and UPDATE.
DO $$
DECLARE
  marker CONSTANT TEXT := '[202611161200_add_aws_connection_checks_home_region_proposal]';
BEGIN
  IF (SELECT count(*) FROM pg_attribute
       WHERE attrelid = 'public.aws_connection_checks'::regclass AND NOT attisdropped AND NOT attnotnull AND NOT atthasdef
         AND starts_with(COALESCE(col_description(attrelid, attnum), ''), marker)
         AND (attname, format_type(atttypid, atttypmod)) IN (
               ('home_region_proposal', 'jsonb'),
               ('home_region_proposal_state', 'character varying(16)'),
               ('home_region_proposed_at', 'timestamp with time zone'),
               ('home_region_decided_at', 'timestamp with time zone'))) <> 4 THEN
    RAISE EXCEPTION 'the four home_region_* columns are not marked, nullable, of the expected types and without a default -- refusing to commit.';
  END IF;
  IF (SELECT count(*) FROM pg_constraint
       WHERE conrelid = 'public.aws_connection_checks'::regclass AND contype = 'c' AND convalidated
         AND starts_with(COALESCE(obj_description(oid, 'pg_constraint'), ''), marker)
         AND conname IN ('aws_connection_checks_home_region_proposal_object',
                         'aws_connection_checks_home_region_proposal_state',
                         'aws_connection_checks_home_region_proposal_complete')) <> 3 THEN
    RAISE EXCEPTION 'the three home-region proposal constraints are not marked and validated -- refusing to commit.';
  END IF;
  IF NOT (SELECT relrowsecurity AND relforcerowsecurity FROM pg_class WHERE oid = 'public.aws_connection_checks'::regclass) THEN
    RAISE EXCEPTION 'row level security is no longer enabled and forced on aws_connection_checks -- refusing to commit.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM unnest(ARRAY['home_region_proposal', 'home_region_proposal_state', 'home_region_proposed_at', 'home_region_decided_at']) c,
                  unnest(ARRAY['SELECT', 'INSERT', 'UPDATE']) p
     WHERE NOT has_column_privilege('devcontrol', 'public.aws_connection_checks', c, p)
  ) THEN
    RAISE EXCEPTION 'devcontrol cannot SELECT, INSERT and UPDATE every new column of aws_connection_checks -- refusing to commit.';
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202611161200_add_aws_connection_checks_home_region_proposal completed';
END $$;
