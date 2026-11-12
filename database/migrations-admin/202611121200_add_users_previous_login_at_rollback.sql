-- Rollback: users.previous_login_at (Dashboard PR-UI-a)
-- Paired with: 202611121200_add_users_previous_login_at.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback", and CI's schema bootstrap skips it too. Run it as the postgres
-- role in ONE transaction, stopping at the first error:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611121200_add_users_previous_login_at_rollback.sql
--
-- Run it only AFTER the application has been reverted to a release that does
-- not use the column (any release before PR-UI-a). The PR-UI-a release writes
-- it on every password and SAML sign-in and reads it in /me: with the column
-- gone, sign-in and /me fail.
--
-- What is lost: each user's previous sign-in time (display only). last_login_at
-- and every other column and row of users are kept.
--
-- Removes only the column carrying the paired migration's marker, and its
-- schema_migrations row. No statement uses CASCADE.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  marker CONSTANT TEXT := '[202611121200_add_users_previous_login_at]';
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_attribute
     WHERE attrelid = 'public.users'::regclass AND attname = 'previous_login_at' AND NOT attisdropped
       AND starts_with(COALESCE(col_description(attrelid, attnum), ''), marker)
  ) THEN
    RAISE EXCEPTION 'users.previous_login_at is absent or was not created by the paired migration -- refusing to roll back.';
  END IF;
END $$;

ALTER TABLE public.users DROP COLUMN previous_login_at;

DELETE FROM schema_migrations
 WHERE migration_name = '202611121200_add_users_previous_login_at.sql';

DO $$ BEGIN
  RAISE NOTICE 'Rolled back 202611121200_add_users_previous_login_at.sql';
END $$;
