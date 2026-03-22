-- Migration: Create tenants table
-- Date: 2026-03-22
-- Description: Tenant accounts managed by the platform organization

CREATE TABLE IF NOT EXISTS tenants (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  name             VARCHAR(255) NOT NULL,
  email            VARCHAR(255) NOT NULL,
  status           VARCHAR(50)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  plan             VARCHAR(50)  NOT NULL DEFAULT 'free'   CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
  aws_resource_count INTEGER DEFAULT 0,
  monthly_cost     NUMERIC(12, 2) DEFAULT 0.00,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_tenants_organization_id ON tenants(organization_id);
CREATE INDEX IF NOT EXISTS idx_tenants_status          ON tenants(status);
