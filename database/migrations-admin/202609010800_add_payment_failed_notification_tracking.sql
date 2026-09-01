-- Migration: 202609010800_add_payment_failed_notification_tracking.sql
-- Description: Adds the payment-failure notification-delivery tracking
--   column that closes the reliability gap found in review: the only
--   existing signal for "should we email the org owner about this payment
--   failure" was `wasNewFailure` (StripeService.recordPaymentFailure) --
--   true exactly once, at the instant billing_lifecycle_state flips
--   healthy -> grace_period, and never again for that episode. Nothing
--   distinguished "the episode started" from "the notification was
--   actually delivered" -- so any failure in the notification path after
--   that one instant (a process crash, a transient DB error resolving the
--   org owner, Resend being down, a template load failure) silently and
--   permanently lost the notification, with no retry, no requeue, and no
--   operator-visible signal. See StripeController.handleInvoicePaymentFailed
--   and StripeService.sendPaymentFailedEmail/markPaymentFailedNotificationSent
--   for the fix built on this column.
--
--   Classified administrative (this directory, not database/migrations/)
--   for the same reason as every other ALTER TABLE organizations migration
--   before it (202608270610, 202608312100, 202608312300): `organizations`
--   is `postgres`-owned in production, while the ordinary migration runner
--   connects as `devcontrol`, which cannot ALTER a table it does not own
--   (PostgreSQL 42501). No new ownership audit was needed: `organizations`'
--   ownership hasn't changed since the last migration against this table
--   re-confirmed it.
--
--   Design notes:
--   - Nullable, cleared (not merely left alone) at exactly two points:
--     the start of a brand-new failure episode (StripeService.
--     recordPaymentFailure's primary UPDATE, defensively resetting it even
--     though it should already be NULL from the prior episode's recovery,
--     in case that clearing was ever missed) and recovery (StripeService.
--     recordPaymentRecovery, both overloads) -- so a later, genuinely new
--     failure episode is always eligible for its own notification rather
--     than permanently inheriting a stale "already notified" state from a
--     resolved episode.
--   - Set (to NOW()) only by StripeService.markPaymentFailedNotificationSent,
--     called only after emailService.sendPaymentFailedEmail (via
--     StripeService.sendPaymentFailedEmail, now returning the real
--     Promise<boolean> outcome instead of discarding it) has actually
--     confirmed successful delivery -- never merely "attempted".
--   - Deliberately NOT combined with billing_lifecycle_state/payment_failed_at/
--     grace_period_ends_at into one compound write: the DB-state transition
--     (does this organization still have paid access) and the notification
--     outcome (did anyone find out about it) are two independently-failing
--     concerns, and this column's entire purpose is to stop conflating
--     them. Entitlement correctness (grace_period transition) must
--     continue to succeed independently of Resend's availability -- this
--     column is only ever read/written as a second, separate step.
--   - No index added, for the same reason as the two most recent
--     ordering-mark columns on this table: only ever read/written via a
--     primary-key `WHERE id = $1` lookup as part of a single-row CAS
--     UPDATE, never scanned by value across organizations.
--   - Explicitly out of scope for this column/migration (see the
--     accompanying investigation report): an outbox, a queue, a scheduled
--     retry worker, claim-before-send locking against the narrow
--     concurrent-duplicate-send race, and any change to Stripe's own
--     dunning/retry configuration.
-- Date: 2026-09-01

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS payment_failed_notification_sent_at TIMESTAMPTZ;

COMMENT ON COLUMN organizations.payment_failed_notification_sent_at IS
  'Set only once Resend has actually confirmed delivery of the payment-failure notification for the CURRENT unresolved failure episode (see StripeService.markPaymentFailedNotificationSent) -- never merely "attempted". NULL means either no failure episode has occurred, or one has but no confirmed-successful notification has gone out for it yet (i.e. still eligible/pending retry via the next invoice.payment_failed delivery). Cleared on both a new failure episode starting and on recovery (StripeService.recordPaymentFailure/recordPaymentRecovery) so a later, distinct episode is never blocked by a prior one''s notification history.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202609010800 completed successfully!';
  RAISE NOTICE 'organizations.payment_failed_notification_sent_at added';
END $$;
