-- Migration: 202608311500_create_refunds.sql
-- Description: Creates `refunds`, the persistence layer for real Stripe
--   refund issuance and tracking (backend/src/controllers/stripe.controller.ts
--   issueRefund/listRefunds/getRefundStats, routed at /api/refunds). Closes
--   the gap behind the pre-existing, fully-built-but-unwired refunds UI
--   (app/(app)/refunds/page.tsx, components/refunds/*,
--   components/payments/issue-refund-dialog.tsx, lib/services/
--   payments.service.ts's refundsService) -- there was never a backend
--   table, route, or Stripe Refund API call behind any of it.
--
--   Design notes:
--   - organization_id is UUID with a REFERENCES/ON DELETE CASCADE FK and
--     full RLS (isolation + insert policy pair), matching every other
--     org-scoped table's convention (004_add_multi_tenancy.sql onward,
--     most directly 202608221112_create_custom_anomaly_rules.sql's
--     version of the same pair). This is a brand-new table created (and
--     owned) by devcontrol itself, so -- unlike organizations/cost_
--     recommendations/alert_history -- it belongs in the ordinary
--     database/migrations/ path, not database/migrations-admin/: there is
--     no pre-existing postgres-owned table here for devcontrol to run
--     ENABLE ROW LEVEL SECURITY against.
--   - stripe_refund_id is globally unique (Stripe refund ids -- re_xxx --
--     are never reused across customers/accounts) and is the idempotency
--     key both for our own issueRefund() insert and for the charge.refunded/
--     refund.updated webhook handlers' ON CONFLICT (stripe_refund_id) DO
--     UPDATE upsert -- so redelivering the same webhook event (Stripe's own
--     at-least-once delivery guarantee) can only update an existing row's
--     status, never create a duplicate.
--   - stripe_payment_intent_id is NOT NULL: every refund this app creates
--     is issued against a resolved PaymentIntent (see stripe.controller.ts's
--     issueRefund -- it resolves invoice -> InvoicePayment -> payment_intent
--     server-side and never accepts one from the client). stripe_charge_id
--     and stripe_invoice_id are nullable metadata for reconciliation/display
--     only.
--   - status is constrained to Stripe's own Refund.status enum (pending,
--     requires_action, succeeded, failed, canceled) -- see
--     node_modules/stripe/types/Refunds.d.ts -- so a webhook payload can
--     never write a value the column doesn't expect.
--   - reason is nullable and constrained to Stripe's own user-settable
--     Refund.Reason enum (duplicate, fraudulent, requested_by_customer) --
--     it is NULL whenever the admin's selected UI reason doesn't map to one
--     of those three (e.g. "service_not_provided", "product_defective", or
--     a free-text "other" reason), since Stripe's API rejects any other
--     value for this field. The admin-facing label/detail is preserved
--     verbatim in reason_detail instead, which is never sent to Stripe.
--   - initiated_by is nullable (not every future writer of this table is
--     necessarily an interactive admin request, e.g. a reconciliation job)
--     but is always populated by issueRefund() with req.user.userId.
-- Date: 2026-08-31

CREATE TABLE refunds (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  stripe_refund_id VARCHAR(255) NOT NULL,
  stripe_payment_intent_id VARCHAR(255) NOT NULL,
  stripe_charge_id VARCHAR(255),
  stripe_invoice_id VARCHAR(255),

  amount INTEGER NOT NULL CHECK (amount > 0),
  currency VARCHAR(10) NOT NULL,
  status VARCHAR(20) NOT NULL CHECK (status IN ('pending', 'requires_action', 'succeeded', 'failed', 'canceled')),
  reason VARCHAR(50) CHECK (reason IS NULL OR reason IN ('duplicate', 'fraudulent', 'requested_by_customer')),
  reason_detail TEXT,

  initiated_by UUID REFERENCES users(id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Idempotency key for both issueRefund()'s own insert and the webhook
-- upserts -- see migration description above.
CREATE UNIQUE INDEX idx_refunds_stripe_refund_id ON refunds(stripe_refund_id);

-- Primary listing path: GET /api/refunds returns an org's refunds newest
-- first.
CREATE INDEX idx_refunds_org_created ON refunds(organization_id, created_at DESC);

-- Reconciliation path: computing how much of a given PaymentIntent has
-- already been refunded across possibly-multiple refund rows.
CREATE INDEX idx_refunds_payment_intent ON refunds(stripe_payment_intent_id);

ALTER TABLE refunds ENABLE ROW LEVEL SECURITY;

CREATE POLICY refunds_isolation_policy ON refunds
  FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));

CREATE POLICY refunds_insert_policy ON refunds
  FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

GRANT ALL ON TABLE refunds TO devcontrol;

CREATE OR REPLACE FUNCTION update_refunds_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER refunds_updated_at
  BEFORE UPDATE ON refunds
  FOR EACH ROW
  EXECUTE FUNCTION update_refunds_updated_at();

COMMENT ON TABLE refunds IS
  'Real Stripe refunds issued via POST /api/refunds (owner/admin only, see StripeController.requireBillingAdmin) and kept in sync by the charge.refunded/refund.updated webhook handlers. Backing store for the pre-existing refunds UI (app/(app)/refunds, components/refunds/*).';
COMMENT ON COLUMN refunds.stripe_refund_id IS
  'Stripe Refund id (re_xxx). Globally unique; the idempotency key for both direct issuance and webhook upserts.';
COMMENT ON COLUMN refunds.reason IS
  'Only ever one of Stripe''s own three user-settable Refund.Reason values, or NULL -- never a raw client-supplied string. See reason_detail for the admin-facing label/detail, which is not restricted to Stripe''s enum.';
COMMENT ON COLUMN refunds.reason_detail IS
  'Free-text admin-facing reason/detail (e.g. the UI''s "service_not_provided", "product_defective", or a custom "other" explanation). Never sent to Stripe -- Stripe''s refund.reason only accepts duplicate/fraudulent/requested_by_customer.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202608311500 completed successfully!';
  RAISE NOTICE 'refunds created with organization_id (UUID, FK, NOT NULL), RLS enabled, and both policies';
END $$;
