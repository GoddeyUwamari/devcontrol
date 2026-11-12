-- Migration: users.previous_login_at (Dashboard PR-UI-a, DB-D8)
--
-- The Dashboard header shows "Last login": the sign-in BEFORE the current one.
-- users.last_login_at cannot answer that: every sign-in overwrites it, so
-- during a session it is the current sign-in. This migration only ADDS, to
-- users:
--
--   + previous_login_at (timestamptz, nullable, no default): the value
--     last_login_at had when the latest sign-in replaced it. Both sign-in
--     paths (password login, SAML) set
--       previous_login_at = last_login_at, last_login_at = NOW()
--     in one UPDATE (the right-hand side reads the old row). Token refresh
--     and every other path leave both columns alone.
--
-- Nullable with no default: no table rewrite, existing rows read NULL. No
-- backfill: the first sign-in after this release copies the stored
-- last_login_at, which IS that user's previous sign-in. Private notes:
-- dashboard-step1.md §C.2, DB-D8 (founder decisions Nov 12).
--
-- REFUSES (nothing applied) when not run as a superuser, when users or
-- users.last_login_at (timestamptz) is missing, or when
-- users.previous_login_at already exists. Checks itself before commit.
--
-- The column carries the marker [202611121200_add_users_previous_login_at]
-- in its comment; the paired rollback drops it only if the marker is there.
--
-- ADMINISTRATIVE MIGRATION (database/migrations-admin/README.md): users is
-- postgres-owned, so ALTER TABLE needs the owner. Applied by hand as postgres
-- BEFORE the code that uses it is merged: the release after it writes and
-- reads the column, and fails without it. The runner applies this file and
-- its ledger row in ONE transaction: any failure, including the 3 s lock
-- timeout below, leaves nothing applied. Lock: ACCESS EXCLUSIVE on users for
-- the catalog-only ADD COLUMN (milliseconds once granted).
--
-- Written for PostgreSQL 14 and later.

SET LOCAL lock_timeout = '3s';

DO $$
BEGIN
  IF current_setting('is_superuser') <> 'on' THEN
    RAISE EXCEPTION 'run as a superuser (postgres) -- refusing to proceed.';
  END IF;
  IF to_regclass('public.users') IS NULL THEN
    RAISE EXCEPTION 'users does not exist -- refusing to proceed.';
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.users'::regclass AND attname = 'last_login_at' AND NOT attisdropped
       AND atttypid = 'timestamptz'::regtype
  ) THEN
    RAISE EXCEPTION 'users.last_login_at (timestamptz) does not exist -- refusing to proceed.';
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.users'::regclass AND attname = 'previous_login_at' AND NOT attisdropped
  ) THEN
    RAISE EXCEPTION 'users.previous_login_at already exists -- refusing to proceed. Investigate before re-running.';
  END IF;
END $$;

ALTER TABLE public.users ADD COLUMN previous_login_at TIMESTAMPTZ;

COMMENT ON COLUMN public.users.previous_login_at IS
  '[202611121200_add_users_previous_login_at] The sign-in before the latest one: last_login_at as it was when the latest password or SAML sign-in replaced it. NULL until a second sign-in. Token refresh never changes it.';

-- Self-check before commit: nullable, no default, marked. (That devcontrol
-- reaches the column through its table-level SELECT and UPDATE on users is a
-- production fact, checked before and after by the founder apply script; CI
-- and test schemas grant devcontrol nothing on users.)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.users'::regclass AND attname = 'previous_login_at' AND NOT attisdropped
       AND atttypid = 'timestamptz'::regtype AND NOT attnotnull AND NOT atthasdef
       AND starts_with(COALESCE(col_description(attrelid, attnum), ''), '[202611121200_add_users_previous_login_at]')
  ) THEN
    RAISE EXCEPTION 'users.previous_login_at is not a marked, nullable timestamptz without a default -- refusing to commit.';
  END IF;
END $$;

DO $$ BEGIN
  RAISE NOTICE 'Migration 202611121200_add_users_previous_login_at completed';
END $$;
