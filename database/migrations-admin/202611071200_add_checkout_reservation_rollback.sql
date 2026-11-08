-- Rollback: self-serve Checkout reservation and billing identity indexes
-- Paired with: 202611071200_add_checkout_reservation.sql
--
-- Manual only. database/migrate.js never runs a file whose name contains
-- "rollback", and CI's schema bootstrap skips it too. Run it as the postgres
-- role in ONE transaction, stopping at the first error:
--
--   psql -v ON_ERROR_STOP=1 --single-transaction -d <database> \
--     -f 202611071200_add_checkout_reservation_rollback.sql
--
-- Run it only with an application release that does not use the reservation
-- columns (any release before billing safety PR A).
--
-- What is lost: only open Checkout reservations (each lasts at most 35
-- minutes). No subscription, customer or tier value is touched.
--
-- Removes only objects carrying the paired migration's marker, and its
-- schema_migrations row. A customer index that predates the paired migration
-- (202608270610_add_stripe_fields.sql) has no marker and is kept. No
-- statement uses CASCADE.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  marker CONSTANT TEXT := '[202611071200_add_checkout_reservation]';
  col TEXT;
BEGIN
  FOREACH col IN ARRAY ARRAY['checkout_reservation_id', 'checkout_reservation_plan', 'checkout_reservation_expires_at', 'checkout_session_id'] LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
       WHERE attrelid = 'organizations'::regclass AND attname = col AND NOT attisdropped
         AND starts_with(COALESCE(col_description('organizations'::regclass, attnum), ''), marker)
    ) THEN
      RAISE EXCEPTION 'organizations.% is absent or was not created by the paired migration -- refusing to roll back.', col;
    END IF;
  END LOOP;
  IF to_regclass('idx_organizations_stripe_subscription_unique') IS NULL
     OR NOT starts_with(COALESCE(obj_description('idx_organizations_stripe_subscription_unique'::regclass, 'pg_class'), ''), marker) THEN
    RAISE EXCEPTION 'idx_organizations_stripe_subscription_unique is absent or was not created by the paired migration -- refusing to roll back.';
  END IF;
END $$;

ALTER TABLE organizations DROP CONSTRAINT organizations_checkout_reservation_complete;

DROP INDEX idx_organizations_stripe_subscription_unique;

DO $$ BEGIN
  IF to_regclass('idx_organizations_stripe_customer_unique') IS NOT NULL
     AND starts_with(COALESCE(obj_description('idx_organizations_stripe_customer_unique'::regclass, 'pg_class'), ''), '[202611071200_add_checkout_reservation]') THEN
    EXECUTE 'DROP INDEX idx_organizations_stripe_customer_unique';
    RAISE NOTICE 'idx_organizations_stripe_customer_unique (created by the paired migration) dropped.';
  ELSE
    RAISE NOTICE 'idx_organizations_stripe_customer_unique predates the paired migration (or is absent); kept.';
  END IF;
END $$;

ALTER TABLE organizations
  DROP COLUMN checkout_session_id,
  DROP COLUMN checkout_reservation_expires_at,
  DROP COLUMN checkout_reservation_plan,
  DROP COLUMN checkout_reservation_id;

DELETE FROM schema_migrations
 WHERE migration_name = '202611071200_add_checkout_reservation.sql';

DO $$ BEGIN
  RAISE NOTICE 'Rolled back 202611071200_add_checkout_reservation.sql';
END $$;
