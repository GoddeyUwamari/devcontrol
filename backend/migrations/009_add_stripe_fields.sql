-- Migration: Add Stripe fields to organizations table
-- Date: 2026-01-01
-- Description: Adds Stripe customer ID, subscription information, and billing fields to organizations

-- Add Stripe-related columns to organizations table
ALTER TABLE organizations
ADD COLUMN IF NOT EXISTS stripe_customer_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS stripe_subscription_id VARCHAR(255),
ADD COLUMN IF NOT EXISTS subscription_status VARCHAR(50) DEFAULT 'free',
ADD COLUMN IF NOT EXISTS subscription_tier VARCHAR(50) DEFAULT 'free',
ADD COLUMN IF NOT EXISTS trial_ends_at TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS subscription_current_period_start TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS subscription_current_period_end TIMESTAMPTZ,
ADD COLUMN IF NOT EXISTS subscription_cancel_at_period_end BOOLEAN DEFAULT false;

-- Create indexes for Stripe fields for faster lookups
CREATE INDEX IF NOT EXISTS idx_organizations_stripe_customer_id
ON organizations(stripe_customer_id);

CREATE INDEX IF NOT EXISTS idx_organizations_stripe_subscription_id
ON organizations(stripe_subscription_id);

CREATE INDEX IF NOT EXISTS idx_organizations_subscription_status
ON organizations(subscription_status);

CREATE INDEX IF NOT EXISTS idx_organizations_subscription_tier
ON organizations(subscription_tier);

-- Add unique constraint to ensure one Stripe customer per organization
CREATE UNIQUE INDEX IF NOT EXISTS idx_organizations_stripe_customer_unique
ON organizations(stripe_customer_id) WHERE stripe_customer_id IS NOT NULL;

-- Add comments for documentation
COMMENT ON COLUMN organizations.stripe_customer_id IS 'Stripe customer ID (cus_xxx)';
COMMENT ON COLUMN organizations.stripe_subscription_id IS 'Stripe subscription ID (sub_xxx)';
COMMENT ON COLUMN organizations.subscription_status IS 'Subscription status: free, trialing, active, past_due, canceled, unpaid';
COMMENT ON COLUMN organizations.subscription_tier IS 'Subscription tier: free, starter, pro, enterprise';
COMMENT ON COLUMN organizations.trial_ends_at IS 'When the trial period ends';
COMMENT ON COLUMN organizations.subscription_current_period_start IS 'Current billing period start';
COMMENT ON COLUMN organizations.subscription_current_period_end IS 'Current billing period end';
COMMENT ON COLUMN organizations.subscription_cancel_at_period_end IS 'Whether subscription will cancel at period end';

-- Update existing organizations to have 'free' tier if not set
UPDATE organizations
SET subscription_tier = 'free',
    subscription_status = 'free'
WHERE subscription_tier IS NULL OR subscription_status IS NULL;
