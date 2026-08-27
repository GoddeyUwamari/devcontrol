-- Migration: 202608270610_add_stripe_fields.sql
-- Description: Canonicalizes the 6 Stripe subscription columns on
--   organizations that backend/migrations/009_add_stripe_fields.sql
--   (not scanned by any current runner -- see database/migrations/README.md)
--   already created in production. stripe.controller.ts / stripe.service.ts
--   have read/written these columns for some time; CI's ephemeral database
--   (built only from this directory, via .github/scripts/ci-bootstrap-schema.js)
--   never had them, which is why PR #10's stripe-webhook-entitlement-sync.test.ts
--   fails with "column ... does not exist" even though its own diff never
--   touches these columns.
--
--   Column definitions and index names/definitions below are taken from a
--   read-only production information_schema/pg_indexes verification,
--   reported as: all 6 columns nullable, with subscription_status
--   defaulting to 'free' and subscription_cancel_at_period_end defaulting
--   to false, the other 4 with no default; zero duplicate non-null
--   stripe_customer_id values; existing indexes
--   idx_organizations_stripe_customer_id,
--   idx_organizations_stripe_customer_unique, and
--   idx_organizations_stripe_subscription_id.
--
--   Deliberately excludes trial_ends_at (also added by backend/migrations/009,
--   but zero references anywhere in backend/src -- not part of the schema
--   dependency this migration exists to close) and subscription_tier
--   (already canonical via database/migrations/004_add_multi_tenancy.sql).
--   backend/migrations/009 also defines two further indexes,
--   idx_organizations_subscription_status and
--   idx_organizations_subscription_tier -- intentionally NOT included here,
--   since this migration is deliberately limited to the three Stripe
--   indexes verified as already existing in production (listed above).
--   IF NOT EXISTS throughout: this migration is a no-op wherever the target
--   database already has these objects (i.e. production), and additive
--   wherever it doesn't (i.e. a fresh CI database).

ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'free',
ADD COLUMN IF NOT EXISTS subscription_current_period_start TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end BOOLEAN DEFAULT false;

CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer_id
ON organizations(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_organizations_stripe_subscription_id
ON organizations(stripe_subscription_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_stripe_customer_unique
ON organizations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

COMMENT ON COLUMN organizations.stripe_customer_id IS 'Stripe customer ID (cus_xxx)';
COMMENT ON COLUMN organizations.stripe_subscription_id IS 'Stripe subscription ID (sub_xxx)';
COMMENT ON COLUMN organizations.subscription_status IS 'Subscription status: free, trialing, active, past_due, canceled, unpaid';
COMMENT ON COLUMN organizations.subscription_current_period_start IS 'Current billing period start';
COMMENT ON COLUMN organizations.subscription_current_period_end IS 'Current billing period end';
COMMENT ON COLUMN organizations.subscription_cancel_at_period_end IS 'Whether subscription will cancel at period end';
