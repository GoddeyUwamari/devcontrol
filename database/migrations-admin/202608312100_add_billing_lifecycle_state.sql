-- Migration: 202608312100_add_billing_lifecycle_state.sql
-- Description: Adds the P0 payment-failure lifecycle's persisted state to
--   organizations -- billing_lifecycle_state, payment_failed_at,
--   grace_period_ends_at -- consumed by StripeController.
--   handleInvoicePaymentFailed/handleInvoicePaid (backend/src/controllers/
--   stripe.controller.ts), StripeService.recordPaymentFailure/
--   recordPaymentRecovery (backend/src/services/stripe.service.ts), the
--   enforcement path in backend/src/middleware/subscription.middleware.ts
--   (getOrganizationTier/getOrganizationLimits/isOrgRestricted), and the
--   hourly reconciliation job (backend/src/jobs/
--   grace-period-enforcement.job.ts).
--
--   Classified administrative (this directory, not database/migrations/)
--   for the same reason as 202608270610_add_stripe_fields.sql -- the only
--   other migration that ALTERs this exact table: `organizations` is
--   `postgres`-owned in production, while the ordinary migration runner
--   connects as `devcontrol`, which cannot ALTER a table it does not own
--   (PostgreSQL 42501). See that migration and this directory's README.md
--   for the full ownership audit -- unchanged since, and re-verified
--   locally for this migration (`pg_get_userbyid(relowner)` on
--   `organizations` still returns a non-devcontrol owner).
--
--   Design notes (see the P0 payment-failure lifecycle plan for the full
--   rationale):
--   - billing_lifecycle_state is a NEW, application-level concept,
--     deliberately kept separate from subscription_status (which remains a
--     pure, unmodified mirror of Stripe's own subscription.status).
--     Overloading subscription_status with grace-period semantics would
--     make it ambiguous between "what Stripe says" and "what DevControl
--     has decided to do about it" -- this migration keeps those two
--     questions answerable independently.
--   - Exactly three states: 'healthy' (default, also the natural state for
--     Stripe statuses that never trigger the grace-period machinery, e.g.
--     free, trialing, active, canceled), 'grace_period' (a payment failed;
--     the org keeps its paid tier until grace_period_ends_at), and
--     'restricted' (grace expired without recovery; paid entitlements are
--     withheld -- see subscription.middleware.ts -- but subscription_tier
--     itself, and the org's max_services/max_users/
--     max_deployments_per_month override columns, are left completely
--     untouched, so recovery needs no repair step).
--   - payment_failed_at/grace_period_ends_at are both nullable and are only
--     ever set together, by StripeService.recordPaymentFailure, and only
--     when billing_lifecycle_state is currently 'healthy' -- see that
--     method's own comment for why this is what makes repeated/duplicate
--     invoice.payment_failed delivery safe (the grace deadline is
--     established once, by the first failure in an episode, and cannot be
--     pushed later by retries).
--   - No CHECK tying payment_failed_at/grace_period_ends_at nullability to
--     billing_lifecycle_state: both application code paths that write
--     these columns (recordPaymentFailure, recordPaymentRecovery) always
--     set all three together, so a cross-column CHECK would duplicate an
--     invariant already enforced by the only two write paths, for a
--     column set no other code touches.
-- Date: 2026-08-31

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS billing_lifecycle_state VARCHAR(20) NOT NULL DEFAULT 'healthy'
  CHECK (billing_lifecycle_state IN ('healthy', 'grace_period', 'restricted')),
ADD COLUMN IF NOT EXISTS payment_failed_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS grace_period_ends_at TIMESTAMPTZ;

-- Serves the reconciliation job's exact scan (WHERE billing_lifecycle_state
-- = 'grace_period' AND grace_period_ends_at < now()) and the lazy
-- isOrgRestricted() check's equivalent read.
CREATE INDEX IF NOT EXISTS idx_organizations_grace_period_ends_at
  ON organizations(grace_period_ends_at)
  WHERE billing_lifecycle_state = 'grace_period';

COMMENT ON COLUMN organizations.billing_lifecycle_state IS
  'Application-level payment-failure lifecycle state: healthy | grace_period | restricted. Deliberately independent of subscription_status (Stripe''s own, unmodified status) -- see StripeController.handleInvoicePaymentFailed/handleInvoicePaid and subscription.middleware.ts''s isOrgRestricted.';
COMMENT ON COLUMN organizations.payment_failed_at IS
  'When the CURRENT payment-failure episode began (T0). Set once per episode by StripeService.recordPaymentFailure; cleared on recovery or cancellation. Repeated invoice.payment_failed events during the same episode do not move this.';
COMMENT ON COLUMN organizations.grace_period_ends_at IS
  'T0 + 7 days, persisted server-side at first-failure time (see StripeService.recordPaymentFailure). Never client-supplied, never extended by repeated failures. Cleared on recovery or cancellation.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202608312100 completed successfully!';
  RAISE NOTICE 'organizations.billing_lifecycle_state / payment_failed_at / grace_period_ends_at added, default healthy';
END $$;
