-- Migration: one free trial per organization
--
-- The self-serve free trial (14 days, card required, Cost Control and
-- Optimization Engine only; backend/src/config/trial.ts). This migration only
-- ADDS, to organizations:
--
--   + trial_used_at (timestamptz): when the organization used its one trial.
--     Set once, by one conditional UPDATE, when Stripe first shows a trial on
--     a subscription verified as the organization's own; never cleared, so a
--     canceled trial still counts. The ONLY trial-eligibility marker.
--   + trial_subscription_id (varchar 255): the subscription that used it.
--     An audit / reference field only; never an eligibility input.
--   + organizations_trial_claim_complete: a CHECK that trial_subscription_id
--     is set only together with trial_used_at.
--
-- Both columns are nullable with no default: no table rewrite, and every
-- existing row satisfies the CHECK. No backfill: no row has used a trial.
-- Nothing deployed before this release reads or writes them, so this is safe
-- to apply before the code that uses them.
--
-- REFUSES (nothing applied) if the billing columns it depends on are missing
-- (including 202611071200_add_checkout_reservation's), or if a trial column or
-- the CHECK already exists.
--
-- Every object this migration creates carries the marker
-- [202611091200_add_trial_used_at] in its comment; the paired rollback drops
-- only marked objects.
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
     AND attname IN ('stripe_customer_id', 'stripe_subscription_id', 'subscription_status',
                     'subscription_tier', 'deleted_at', 'checkout_reservation_id');
  IF n <> 6 THEN
    RAISE EXCEPTION 'organizations lacks a billing column this migration depends on (is 202611071200_add_checkout_reservation applied?) -- refusing to proceed.';
  END IF;

  SELECT count(*) INTO n FROM pg_attribute
   WHERE attrelid = 'organizations'::regclass AND NOT attisdropped
     AND attname IN ('trial_used_at', 'trial_subscription_id');
  IF n <> 0 THEN
    RAISE EXCEPTION 'a trial column already exists -- refusing to proceed. Investigate before re-running.';
  END IF;

  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'organizations_trial_claim_complete') THEN
    RAISE EXCEPTION 'organizations_trial_claim_complete already exists -- refusing to proceed.';
  END IF;
END $$;

ALTER TABLE organizations
  ADD COLUMN trial_used_at TIMESTAMPTZ,
  ADD COLUMN trial_subscription_id VARCHAR(255);

ALTER TABLE organizations
  ADD CONSTRAINT organizations_trial_claim_complete
  CHECK (trial_subscription_id IS NULL OR trial_used_at IS NOT NULL);

COMMENT ON COLUMN organizations.trial_used_at IS
  '[202611091200_add_trial_used_at] When this organization used its one free trial (Stripe first showed a trial on a subscription verified as its own). Never cleared; a canceled trial still counts. The only trial-eligibility marker.';
COMMENT ON COLUMN organizations.trial_subscription_id IS
  '[202611091200_add_trial_used_at] The subscription that used the trial. Audit / reference only; never an eligibility input.';
COMMENT ON CONSTRAINT organizations_trial_claim_complete ON organizations IS
  '[202611091200_add_trial_used_at] A trial subscription is recorded only with its claim.';

DO $$ BEGIN
  RAISE NOTICE 'Migration 202611091200_add_trial_used_at completed';
END $$;
