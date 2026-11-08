-- Migration: self-serve Checkout reservation and billing identity indexes
--
-- Billing integrity: at most one billable self-serve subscription per
-- organization. This migration only ADDS:
--
--   organizations
--     + checkout_reservation_id (uuid), checkout_reservation_plan,
--       checkout_reservation_expires_at, checkout_session_id: all nullable, no
--       default (no table rewrite). A short-lived reservation of the window
--       before a subscription exists; never an ownership record (ownership is
--       stripe_subscription_id). Nothing deployed before this release reads
--       or writes them.
--     + organizations_checkout_reservation_complete: a CHECK that the
--       reservation columns are set together. Every existing row has them all
--       NULL, so it holds at once.
--     + idx_organizations_stripe_subscription_unique: UNIQUE (stripe_subscription_id)
--       WHERE stripe_subscription_id IS NOT NULL -- one subscription maps to
--       at most one organization.
--     + idx_organizations_stripe_customer_unique: UNIQUE (stripe_customer_id)
--       WHERE stripe_customer_id IS NOT NULL -- one customer maps to at most
--       one organization. 202608270610_add_stripe_fields.sql already defines
--       this index; it is created here only if absent, and an existing index
--       of that name must have exactly this definition.
--
-- REFUSES (nothing applied) if any stripe_subscription_id or
-- stripe_customer_id is shared by two organizations, or if a column, the
-- CHECK or the subscription index already exists.
--
-- Every object this migration creates carries the marker
-- [202611071200_add_checkout_reservation] in its comment; the paired
-- rollback drops only marked objects, so a customer index that predates this
-- migration is never dropped.
--
-- ADMINISTRATIVE MIGRATION (database/migrations-admin/README.md): applied by
-- hand as postgres BEFORE the code that uses it is merged. The runner applies
-- this file and its ledger row in ONE transaction: any failure, including the
-- 3 s lock timeout below, leaves nothing applied.
--
-- Written for PostgreSQL 14 and later.

SET LOCAL lock_timeout = '3s';

DO $$
DECLARE
  n INTEGER;
BEGIN
  IF to_regclass('organizations') IS NULL THEN
    RAISE EXCEPTION 'organizations does not exist -- refusing to proceed.';
  END IF;

  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = 'organizations'::regclass AND NOT attisdropped
     AND attname IN ('stripe_customer_id', 'stripe_subscription_id', 'subscription_status', 'subscription_tier', 'deleted_at');
  IF n <> 5 THEN
    RAISE EXCEPTION 'organizations lacks a billing column this migration depends on -- refusing to proceed.';
  END IF;

  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = 'organizations'::regclass AND NOT attisdropped
     AND attname IN ('checkout_reservation_id', 'checkout_reservation_plan', 'checkout_reservation_expires_at', 'checkout_session_id');
  IF n <> 0 THEN
    RAISE EXCEPTION 'a checkout reservation column already exists -- refusing to proceed. Investigate before re-running.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_checkout_reservation_complete') THEN
    RAISE EXCEPTION 'organizations_checkout_reservation_complete already exists -- refusing to proceed.';
  END IF;

  IF to_regclass('idx_organizations_stripe_subscription_unique') IS NOT NULL THEN
    RAISE EXCEPTION 'idx_organizations_stripe_subscription_unique already exists -- refusing to proceed.';
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT stripe_subscription_id FROM organizations
     WHERE stripe_subscription_id IS NOT NULL
     GROUP BY stripe_subscription_id HAVING count(*) > 1) d;
  IF n <> 0 THEN
    RAISE EXCEPTION '% Stripe subscription id(s) are recorded on more than one organization -- refusing to proceed (nothing applied).', n;
  END IF;

  SELECT count(*) INTO n FROM (
    SELECT stripe_customer_id FROM organizations
     WHERE stripe_customer_id IS NOT NULL
     GROUP BY stripe_customer_id HAVING count(*) > 1) d;
  IF n <> 0 THEN
    RAISE EXCEPTION '% Stripe customer id(s) are recorded on more than one organization -- refusing to proceed (nothing applied).', n;
  END IF;
END $$;

ALTER TABLE organizations
  ADD COLUMN checkout_reservation_id UUID,
  ADD COLUMN checkout_reservation_plan VARCHAR(32),
  ADD COLUMN checkout_reservation_expires_at TIMESTAMPTZ,
  ADD COLUMN checkout_session_id VARCHAR(255);

ALTER TABLE organizations
  ADD CONSTRAINT organizations_checkout_reservation_complete CHECK (
    (checkout_reservation_id IS NULL) = (checkout_reservation_expires_at IS NULL)
    AND (checkout_reservation_id IS NULL) = (checkout_reservation_plan IS NULL)
    AND (checkout_session_id IS NULL OR checkout_reservation_id IS NOT NULL)
  );

CREATE UNIQUE INDEX idx_organizations_stripe_subscription_unique
  ON organizations (stripe_subscription_id)
  WHERE stripe_subscription_id IS NOT NULL;

DO $$
DECLARE
  existing_def TEXT;
BEGIN
  IF to_regclass('idx_organizations_stripe_customer_unique') IS NULL THEN
    EXECUTE 'CREATE UNIQUE INDEX idx_organizations_stripe_customer_unique
               ON organizations (stripe_customer_id)
               WHERE stripe_customer_id IS NOT NULL';
    EXECUTE $q$ COMMENT ON INDEX idx_organizations_stripe_customer_unique IS
      '[202611071200_add_checkout_reservation] One Stripe customer maps to at most one organization.' $q$;
  ELSE
    SELECT pg_get_indexdef(i.indexrelid) INTO existing_def
      FROM pg_index i
     WHERE i.indexrelid = 'idx_organizations_stripe_customer_unique'::regclass
       AND i.indrelid = 'organizations'::regclass
       AND i.indisunique AND i.indisvalid;
    IF existing_def IS NULL
       OR existing_def NOT LIKE '%(stripe_customer_id) WHERE (stripe_customer_id IS NOT NULL)' THEN
      RAISE EXCEPTION 'idx_organizations_stripe_customer_unique exists but is not a valid UNIQUE (stripe_customer_id) WHERE stripe_customer_id IS NOT NULL index on organizations -- refusing to proceed.';
    END IF;
    RAISE NOTICE 'idx_organizations_stripe_customer_unique already exists with the expected definition; kept as is.';
  END IF;
END $$;

COMMENT ON COLUMN organizations.checkout_reservation_id IS
  '[202611071200_add_checkout_reservation] Self-serve Checkout reservation (also the Stripe idempotency key suffix for its customer and session). Never an ownership record: ownership is stripe_subscription_id. Taken by one conditional UPDATE; see checkout-reservation.service.';
COMMENT ON COLUMN organizations.checkout_reservation_plan IS
  '[202611071200_add_checkout_reservation] The plan the reservation is for, as tier:interval.';
COMMENT ON COLUMN organizations.checkout_reservation_expires_at IS
  '[202611071200_add_checkout_reservation] Reservation expiry: always 5 minutes after the Stripe session expires_at, so an expired reservation never leaves a completable session.';
COMMENT ON COLUMN organizations.checkout_session_id IS
  '[202611071200_add_checkout_reservation] Stripe Checkout session created under the current reservation; cleared when checkout.session.completed is processed.';
COMMENT ON CONSTRAINT organizations_checkout_reservation_complete ON organizations IS
  '[202611071200_add_checkout_reservation] Reservation columns are set together.';
COMMENT ON INDEX idx_organizations_stripe_subscription_unique IS
  '[202611071200_add_checkout_reservation] One Stripe subscription maps to at most one organization.';

DO $$ BEGIN
  RAISE NOTICE 'Migration 202611071200_add_checkout_reservation completed';
END $$;
