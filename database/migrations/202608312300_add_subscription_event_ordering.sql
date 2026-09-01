-- Migration: 202608312300_add_subscription_event_ordering.sql
-- Description: Adds the subscription-domain ordering high-water mark that
--   closes the P1 found in review: a stale customer.subscription.updated
--   event (Stripe does not guarantee webhook delivery order -- see
--   https://docs.stripe.com/webhooks) whose own payload still shows a
--   pre-cancellation snapshot (e.g. status=active, an old price) could
--   otherwise resurrect paid entitlement after a legitimate cancellation,
--   because StripeController.handleSubscriptionUpdated/handleSubscription
--   Deleted (backend/src/controllers/stripe.controller.ts) and
--   StripeService.updateOrganizationSubscription (backend/src/services/
--   stripe.service.ts) had no way to tell a stale event's payload apart
--   from a fresh one -- both are perfectly valid Subscription snapshots,
--   just from different points in time. The existing terminal-status check
--   (status IN ('canceled','incomplete_expired') -> force tier=free) only
--   inspects the payload's own content and cannot detect staleness at all.
--
--   PLACEMENT NOTE: this migration ALTERs `organizations`, adding a
--   column, exactly like 202608270610_add_stripe_fields.sql and
--   202608312100_add_billing_lifecycle_state.sql before it -- both of
--   which are classified in database/migrations-admin/, not here, because
--   `organizations` is verified `postgres`-owned in production
--   (`pg_get_userbyid(relowner)`), while the ordinary runner connects as
--   `devcontrol`, which cannot ALTER a table it does not own (PostgreSQL
--   42501 -- this is not hypothetical: `202608270610` failed with exactly
--   this error on a real, non-dry-run production attempt; see
--   database/migrations-admin/README.md's "Production execution history"
--   section for the full record). This file is placed in the ordinary
--   database/migrations/ path on explicit instruction, not because the
--   ownership finding has changed -- it has not been re-verified as
--   changed, and the local ownership check backing that finding was
--   re-confirmed unchanged during this same implementation session.
--   Executing this specific file via the ordinary devcontrol-authenticated
--   runner against production is expected to fail with the same 42501
--   error, requiring the same reclassification-and-retry
--   `202608270610` already went through. Flagged here so that failure, if
--   it happens, is recognized immediately rather than re-diagnosed from
--   scratch.
--
--   Design notes:
--   - Deliberately a SEPARATE column from latest_processed_invoice_
--     created_at (202608312100_add_billing_lifecycle_state.sql), not a
--     reuse of it. That column is compared against Invoice.created, a
--     different Stripe object's clock for a different domain (payment
--     failure/recovery ordering); this column is compared against the
--     Stripe Event envelope's own `created` (see below for why the
--     envelope, not any field on the Subscription object itself). Reusing
--     one column for both would let an invoice event spuriously advance or
--     block a subscription-event comparison and vice versa -- the same
--     separation-of-concerns reasoning 202608312100 already applied to
--     billing_lifecycle_state vs subscription_status.
--   - Ordering signal is Stripe's Event envelope `created` (Unix seconds --
--     see Event.created in node_modules/stripe/types/Events.d.ts), NOT any
--     field on the Subscription payload itself. The Subscription object's
--     own `created` is fixed at subscription-creation time and never
--     changes across updates (see Subscriptions.d.ts) -- every
--     customer.subscription.updated for the same subscription carries an
--     identical value, making it useless for comparing one update against
--     another. current_period_start/current_period_end are not even
--     present as top-level Subscription fields in the installed API
--     version, and canceled_at is null except at cancellation. Only the
--     enclosing Event's own `created` -- when Stripe generated this
--     specific notification -- increases with each real, distinct
--     mutation Stripe reports, independent of delivery order.
--   - Nullable, monotonically non-decreasing, never cleared by any
--     subscription lifecycle transition -- same invariant shape as
--     latest_processed_invoice_created_at. See StripeService.
--     updateOrganizationSubscription's own comment for the exact CAS
--     UPDATE shape and the deliberate asymmetry between
--     customer.subscription.updated (strict `>`, a tie is rejected) and
--     customer.subscription.deleted (`>=`, a tie is accepted -- deletion
--     is authoritative/terminal and wins ties, since no Stripe operation
--     ever "un-deletes" a subscription). Stripe Event.created has
--     one-second resolution, so a same-second collision between an
--     .updated and a .deleted fired from the same cancellation is the
--     expected common case, not a rare edge case -- this asymmetry is
--     load-bearing, not decorative.
--   - Organization-scoped (one mark per organization, on the organizations
--     row itself) -- no per-subscription-id tracking needed. A stale
--     event's Event.created is fixed at generation time and cannot exceed
--     the moment the subscription it describes was last mutated, so a
--     resubscription's later events always exceed anything a prior,
--     canceled subscription could produce, with no additional scoping
--     required.
--   - No index added. Unlike grace_period_ends_at (scanned by the hourly
--     reconciliation job across all organizations), this column is only
--     ever read via a primary-key `WHERE id = $1` lookup as part of the
--     same CAS UPDATE that writes it -- no query scans by this column's
--     value across organizations, so no index has a demonstrated purpose.
--   - Protects every current updateOrganizationSubscription call site
--     (StripeController.cancelSubscription/changePlan/resumeSubscription/
--     handleCheckoutSessionCompleted/handleSubscriptionUpdated/
--     handleSubscriptionDeleted), not only the two webhook handlers --
--     the same resurrection can happen against a synchronous cancellation/
--     plan-change if a stale webhook arrives afterward with no ordering
--     guard on that write either.
-- Date: 2026-08-31

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS latest_processed_subscription_event_created_at TIMESTAMPTZ;

COMMENT ON COLUMN organizations.latest_processed_subscription_event_created_at IS
  'High-water mark (Stripe Event.created, Unix seconds, stored as a timestamp) of the newest subscription-lifecycle event (customer.subscription.created/updated/deleted, and every synchronous cancelSubscription/changePlan/resumeSubscription write) this organization has actually accepted. Never cleared -- only ever advanced -- so a stale/out-of-order subscription event can never resurrect entitlement a newer event or synchronous action has already superseded. Separate from latest_processed_invoice_created_at (different Stripe clock, different domain). See StripeService.updateOrganizationSubscription.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202608312300 completed successfully!';
  RAISE NOTICE 'organizations.latest_processed_subscription_event_created_at added';
END $$;
