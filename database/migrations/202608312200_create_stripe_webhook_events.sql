-- Migration: 202608312200_create_stripe_webhook_events.sql
-- Description: Creates `stripe_webhook_events`, a standalone, generic
--   idempotency ledger for the inbound Stripe webhook dispatcher
--   (backend/src/controllers/stripe.controller.ts handleWebhook). Closes the
--   P1 billing backlog item: today, event.id is read once for a console.log
--   (stripe.controller.ts, webhook received log) and never persisted
--   anywhere -- every handler's tolerance for redelivery is incidental
--   (absolute-value UPDATEs, the invoice ordering high-water mark, the
--   refunds ON CONFLICT upsert), not tracked, and invisible to an operator.
--
--   Design notes:
--   - This is a brand-new table created (and owned) by devcontrol itself,
--     so -- unlike organizations, which is postgres-owned -- it belongs in
--     the ordinary database/migrations/ path, not database/migrations-admin/.
--     Same reasoning already applied to 202608311500_create_refunds.sql.
--   - Deliberately NOT org-scoped and carries no organization_id column or
--     RLS policy. Every RLS-bearing table in this repo (refunds,
--     webhook_endpoints, ...) is scoped by an organization_id set via
--     app.current_organization_id, but a webhook event's organization is
--     sometimes unresolvable before its handler even runs (e.g.
--     checkout.session.completed with missing metadata), and the webhook
--     route never runs inside runWithOrgClient/authenticateToken in the
--     first place -- there is no org context to scope this table by. This
--     table is platform operational infrastructure, the same category as
--     schema_migrations/migration_tracking_baseline (database/migrate.js),
--     not tenant data -- and, like those two tables, intentionally has no
--     RLS.
--   - stripe_event_id is the idempotency key (Stripe evt_xxx, globally
--     unique) and carries the load-bearing UNIQUE constraint the
--     dispatcher's INSERT ... ON CONFLICT claim depends on.
--   - status is intentionally a 3-state machine (processing, processed,
--     failed) with no fourth "ignored"/"skipped" state: an event for which
--     this application has no handler (falls through the dispatch switch's
--     `default:` case) still completes its dispatch call without throwing,
--     so it reaches 'processed' through the exact same success path as a
--     handled event. See handleWebhook's own comment for why this is
--     correct and not merely convenient -- an unhandled event must reach a
--     terminal state so it doesn't sit at 'processing' forever and become a
--     permanent operational false positive.
--   - No stale-processing timeout/TTL column, and no time-based reclaim
--     logic anywhere in this design. The dispatcher instead guards
--     concurrent/duplicate claims with a session-level Postgres advisory
--     lock keyed on the same stripe_event_id (see
--     backend/src/services/stripe-webhook-ledger.service.ts). That lock is
--     held only by a connection actually alive and working on this event;
--     Postgres releases it the moment that connection dies (crash, restart)
--     -- there is no risk of reclaiming a 'processing' row out from under a
--     handler that is merely slow, because a slow-but-alive handler still
--     holds the lock. A wall-clock timeout was deliberately rejected: it
--     cannot distinguish "the process died" from "the process is still
--     working," and picking any fixed duration either reclaims a live
--     handler too early or leaves a genuinely dead one stuck too long.
--   - attempts + last_attempted_at exist together deliberately: attempts
--     alone doesn't tell an operator whether a stuck event was retried
--     recently or hours ago, and last_attempted_at alone doesn't show
--     whether it's being retried at all vs. abandoned by Stripe. Both
--     answer "can an operator safely retry it" from the ledger alone.
--   - last_error stores only the most recent failure's message (overwritten,
--     not appended) -- this is a diagnostic pointer for an operator, not an
--     audit trail; nothing in this design reads or depends on prior error
--     history. Never populated from a raw exception object, only from its
--     .message string (see the ledger service) -- avoids ever persisting
--     anything that could carry request/response internals.
--   - Deliberately excluded: the raw event payload (Stripe's own dashboard/
--     API already serves this on demand -- storing it here duplicates
--     Stripe and opens a retention/PII question with no demonstrated need),
--     organization_id (see above), api_version/livemode (no current
--     consumer). Retention/archival policy is an explicit separate backlog
--     item, not addressed by this migration.
-- Date: 2026-08-31

CREATE TABLE stripe_webhook_events (
  id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),

  stripe_event_id    VARCHAR(255) NOT NULL,
  event_type         VARCHAR(255) NOT NULL,

  status             VARCHAR(20) NOT NULL DEFAULT 'processing'
                        CHECK (status IN ('processing', 'processed', 'failed')),
  attempts           INTEGER NOT NULL DEFAULT 1 CHECK (attempts > 0),

  received_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_attempted_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at       TIMESTAMPTZ,
  last_error         TEXT
);

-- The idempotency key itself -- the dispatcher's claim statement is an
-- INSERT ... ON CONFLICT (stripe_event_id) DO UPDATE, so this constraint is
-- not merely descriptive, it's what the whole claim mechanism is built on.
CREATE UNIQUE INDEX idx_stripe_webhook_events_event_id ON stripe_webhook_events(stripe_event_id);

-- Serves the operator "what needs attention" query (non-terminal/failed
-- events) without scanning the whole table. Stays small in steady state
-- since 'processed' -- the overwhelming majority of rows -- is excluded,
-- same partial-index shape already used for
-- idx_organizations_grace_period_ends_at
-- (202608312100_add_billing_lifecycle_state.sql).
CREATE INDEX idx_stripe_webhook_events_unresolved ON stripe_webhook_events(status, last_attempted_at)
  WHERE status != 'processed';

GRANT ALL ON TABLE stripe_webhook_events TO devcontrol;

COMMENT ON TABLE stripe_webhook_events IS
  'Idempotency ledger for inbound Stripe webhook deliveries (backend/src/controllers/stripe.controller.ts handleWebhook). Records every verified webhook event exactly once per stripe_event_id, independent of how many times Stripe redelivers it. Intentionally NOT org-scoped/RLS -- see migration header. Does NOT solve object-level event ordering (see organizations.latest_processed_invoice_created_at, unchanged by this migration) -- event-ID idempotency and ordering are separate concerns.';
COMMENT ON COLUMN stripe_webhook_events.stripe_event_id IS
  'Stripe Event id (evt_xxx). Globally unique; the idempotency key the dispatcher''s INSERT ... ON CONFLICT claim depends on.';
COMMENT ON COLUMN stripe_webhook_events.status IS
  'processing = claimed, handler in flight (or a previous attempt died before reaching a terminal state); processed = handler completed without throwing, including an intentionally-unhandled event type; failed = handler threw, event remains retryable via Stripe''s own redelivery.';
COMMENT ON COLUMN stripe_webhook_events.attempts IS
  'How many times this event has been claimed for processing (redeliveries + reclaimed-after-crash attempts). Pairs with last_attempted_at for operator triage of a stuck event.';
COMMENT ON COLUMN stripe_webhook_events.last_attempted_at IS
  'When the most recent claim happened. Not used for any time-based staleness/reclaim decision -- see migration header for why reclaim is lock-based, not timeout-based.';
COMMENT ON COLUMN stripe_webhook_events.processed_at IS
  'Set only on success. NULL for a row still processing or failed. Distinct from received_at for latency observability.';
COMMENT ON COLUMN stripe_webhook_events.last_error IS
  'Most recent failure''s error message only (overwritten each attempt, not appended). Always a message string, never a raw exception object.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202608312200 completed successfully!';
  RAISE NOTICE 'stripe_webhook_events created with UNIQUE(stripe_event_id), no RLS';
END $$;
