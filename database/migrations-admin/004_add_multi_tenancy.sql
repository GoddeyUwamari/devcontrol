-- Migration: 004_add_multi_tenancy.sql
-- Description: Add multi-tenancy support with organizations, users, and row-level security
-- Date: 2025-12-28
-- Purpose: Enable multiple organizations to use DevControl with complete data isolation

-- =====================================================
-- PART 1: CORE MULTI-TENANCY TABLES
-- =====================================================

-- =====================================================
-- ORGANIZATIONS TABLE
-- =====================================================
-- Represents a workspace/tenant (e.g., a company, team, or client)
CREATE TABLE IF NOT EXISTS organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(255) NOT NULL UNIQUE,
  slug VARCHAR(255) NOT NULL UNIQUE, -- URL-safe identifier (e.g., 'acme-corp')
  display_name VARCHAR(255) NOT NULL,
  description TEXT,
  logo_url TEXT,

  -- Subscription & Limits
  subscription_tier VARCHAR(50) NOT NULL DEFAULT 'free', -- 'free', 'pro', 'enterprise'
  max_services INTEGER DEFAULT 10,
  max_users INTEGER DEFAULT 5,
  max_deployments_per_month INTEGER DEFAULT 50,

  -- AWS Integration (encrypted per organization)
  aws_credentials_encrypted TEXT, -- AES-256 encrypted AWS access keys
  aws_region_default VARCHAR(50) DEFAULT 'us-east-1',

  -- Organization Settings
  settings JSONB DEFAULT '{}', -- Custom settings (e.g., DORA goals, alert preferences)

  -- Status & Metadata
  is_active BOOLEAN DEFAULT true,
  suspended_at TIMESTAMP WITH TIME ZONE,
  suspended_reason TEXT,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE -- Soft delete
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_organizations_slug ON organizations(slug) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_active ON organizations(is_active) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_organizations_tier ON organizations(subscription_tier);

-- =====================================================
-- USERS TABLE
-- =====================================================
-- Represents individual users who can belong to multiple organizations
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) NOT NULL UNIQUE,
  password_hash TEXT NOT NULL, -- bcrypt hashed password
  full_name VARCHAR(255) NOT NULL,
  avatar_url TEXT,

  -- Account Status
  is_active BOOLEAN DEFAULT true,
  is_email_verified BOOLEAN DEFAULT false,
  email_verification_token TEXT,
  email_verification_expires_at TIMESTAMP WITH TIME ZONE,

  -- Password Reset
  password_reset_token TEXT,
  password_reset_expires_at TIMESTAMP WITH TIME ZONE,

  -- Session Management
  last_login_at TIMESTAMP WITH TIME ZONE,
  last_login_ip VARCHAR(45), -- IPv6 compatible
  failed_login_attempts INTEGER DEFAULT 0,
  locked_until TIMESTAMP WITH TIME ZONE,

  -- User Preferences
  preferences JSONB DEFAULT '{}', -- UI preferences, notifications, etc.
  timezone VARCHAR(50) DEFAULT 'UTC',

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  deleted_at TIMESTAMP WITH TIME ZONE -- Soft delete
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_users_email_verification ON users(email_verification_token) WHERE email_verification_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_password_reset ON users(password_reset_token) WHERE password_reset_token IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_users_active ON users(is_active) WHERE deleted_at IS NULL;

-- =====================================================
-- ORGANIZATION_MEMBERSHIPS TABLE
-- =====================================================
-- Links users to organizations with roles (many-to-many)
CREATE TABLE IF NOT EXISTS organization_memberships (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,

  -- Role-Based Access Control
  role VARCHAR(50) NOT NULL DEFAULT 'member', -- 'owner', 'admin', 'member', 'viewer'

  -- Invitation Flow
  invited_by UUID REFERENCES users(id),
  invited_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  invitation_token TEXT,
  invitation_expires_at TIMESTAMP WITH TIME ZONE,
  joined_at TIMESTAMP WITH TIME ZONE,

  -- Status
  is_active BOOLEAN DEFAULT true,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraint: One user can only have one membership per organization
  UNIQUE(organization_id, user_id)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_org_memberships_org ON organization_memberships(organization_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_user ON organization_memberships(user_id);
CREATE INDEX IF NOT EXISTS idx_org_memberships_role ON organization_memberships(role);
CREATE INDEX IF NOT EXISTS idx_org_memberships_invitation ON organization_memberships(invitation_token) WHERE invitation_token IS NOT NULL;

-- =====================================================
-- PART 2: ADD ORGANIZATION_ID TO EXISTING TABLES
-- =====================================================

-- Add organization_id column to all existing tables
-- Initially nullable to support migration of existing data
-- Will be made NOT NULL after data migration

ALTER TABLE teams
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE services
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE deployments
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE infrastructure_resources
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE cost_recommendations
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

ALTER TABLE alert_history
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE;

-- Create indexes for organization-based queries
CREATE INDEX IF NOT EXISTS idx_teams_org ON teams(organization_id);
CREATE INDEX IF NOT EXISTS idx_services_org ON services(organization_id);
CREATE INDEX IF NOT EXISTS idx_deployments_org ON deployments(organization_id);
CREATE INDEX IF NOT EXISTS idx_infrastructure_org ON infrastructure_resources(organization_id);
CREATE INDEX IF NOT EXISTS idx_cost_recommendations_org ON cost_recommendations(organization_id);
CREATE INDEX IF NOT EXISTS idx_alert_history_org ON alert_history(organization_id);

-- =====================================================
-- PART 3: ROW-LEVEL SECURITY (RLS) SETUP
-- =====================================================

-- Enable Row-Level Security on all tenant-specific tables
ALTER TABLE teams ENABLE ROW LEVEL SECURITY;
ALTER TABLE services ENABLE ROW LEVEL SECURITY;
ALTER TABLE deployments ENABLE ROW LEVEL SECURITY;
ALTER TABLE infrastructure_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE cost_recommendations ENABLE ROW LEVEL SECURITY;
ALTER TABLE alert_history ENABLE ROW LEVEL SECURITY;

-- =====================================================
-- RLS POLICIES: TEAMS TABLE
-- =====================================================

-- Policy: Users can only see teams in their organization
CREATE POLICY teams_isolation_policy ON teams
  FOR ALL
  USING (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- Policy: Users can only insert teams into their organization
CREATE POLICY teams_insert_policy ON teams
  FOR INSERT
  WITH CHECK (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- =====================================================
-- RLS POLICIES: SERVICES TABLE
-- =====================================================

CREATE POLICY services_isolation_policy ON services
  FOR ALL
  USING (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

CREATE POLICY services_insert_policy ON services
  FOR INSERT
  WITH CHECK (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- =====================================================
-- RLS POLICIES: DEPLOYMENTS TABLE
-- =====================================================

CREATE POLICY deployments_isolation_policy ON deployments
  FOR ALL
  USING (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

CREATE POLICY deployments_insert_policy ON deployments
  FOR INSERT
  WITH CHECK (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- =====================================================
-- RLS POLICIES: INFRASTRUCTURE_RESOURCES TABLE
-- =====================================================

CREATE POLICY infrastructure_isolation_policy ON infrastructure_resources
  FOR ALL
  USING (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

CREATE POLICY infrastructure_insert_policy ON infrastructure_resources
  FOR INSERT
  WITH CHECK (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- =====================================================
-- RLS POLICIES: COST_RECOMMENDATIONS TABLE
-- =====================================================

CREATE POLICY cost_recommendations_isolation_policy ON cost_recommendations
  FOR ALL
  USING (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

CREATE POLICY cost_recommendations_insert_policy ON cost_recommendations
  FOR INSERT
  WITH CHECK (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- =====================================================
-- RLS POLICIES: ALERT_HISTORY TABLE
-- =====================================================

CREATE POLICY alert_history_isolation_policy ON alert_history
  FOR ALL
  USING (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

CREATE POLICY alert_history_insert_policy ON alert_history
  FOR INSERT
  WITH CHECK (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- =====================================================
-- PART 4: HELPER FUNCTIONS
-- =====================================================

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Apply update_updated_at trigger to new tables
DROP TRIGGER IF EXISTS update_organizations_updated_at ON organizations;
CREATE TRIGGER update_organizations_updated_at
  BEFORE UPDATE ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_users_updated_at ON users;
CREATE TRIGGER update_users_updated_at
  BEFORE UPDATE ON users
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_org_memberships_updated_at ON organization_memberships;
CREATE TRIGGER update_org_memberships_updated_at
  BEFORE UPDATE ON organization_memberships
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- PART 5: AUDIT LOG TABLE (OPTIONAL BUT RECOMMENDED)
-- =====================================================

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL,

  -- Action Details
  action VARCHAR(50) NOT NULL, -- 'create', 'update', 'delete', 'login', 'invite', etc.
  resource_type VARCHAR(50) NOT NULL, -- 'service', 'deployment', 'user', 'team', etc.
  resource_id UUID,

  -- Context
  ip_address VARCHAR(45),
  user_agent TEXT,
  changes JSONB, -- Store before/after values
  metadata JSONB DEFAULT '{}',

  -- Timestamp
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for audit log queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_org ON audit_logs(organization_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_resource ON audit_logs(resource_type, resource_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at);

-- Enable RLS on audit logs
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY audit_logs_isolation_policy ON audit_logs
  FOR ALL
  USING (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

CREATE POLICY audit_logs_insert_policy ON audit_logs
  FOR INSERT
  WITH CHECK (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- =====================================================
-- PART 6: SESSION MANAGEMENT TABLE
-- =====================================================

CREATE TABLE IF NOT EXISTS sessions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Token Management
  access_token_hash TEXT NOT NULL, -- SHA-256 hash of JWT for blacklisting
  refresh_token_hash TEXT NOT NULL,

  -- Session Details
  ip_address VARCHAR(45),
  user_agent TEXT,

  -- Expiry
  access_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  refresh_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,

  -- Status
  is_active BOOLEAN DEFAULT true,
  revoked_at TIMESTAMP WITH TIME ZONE,

  -- Timestamps
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  last_used_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- Indexes for session queries
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_sessions_access_token ON sessions(access_token_hash) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sessions_refresh_token ON sessions(refresh_token_hash) WHERE is_active = true;
CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(access_token_expires_at) WHERE is_active = true;

-- =====================================================
-- PART 7: ROLE PERMISSIONS TABLE (RBAC)
-- =====================================================

CREATE TABLE IF NOT EXISTS role_permissions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role VARCHAR(50) NOT NULL, -- 'owner', 'admin', 'member', 'viewer'
  resource VARCHAR(50) NOT NULL, -- 'services', 'deployments', 'teams', etc.
  action VARCHAR(50) NOT NULL, -- 'create', 'read', 'update', 'delete'
  allowed BOOLEAN DEFAULT true,

  UNIQUE(role, resource, action)
);

-- Seed default role permissions
INSERT INTO role_permissions (role, resource, action, allowed) VALUES
  -- Owner permissions (full access)
  ('owner', 'services', 'create', true),
  ('owner', 'services', 'read', true),
  ('owner', 'services', 'update', true),
  ('owner', 'services', 'delete', true),
  ('owner', 'deployments', 'create', true),
  ('owner', 'deployments', 'read', true),
  ('owner', 'deployments', 'update', true),
  ('owner', 'deployments', 'delete', true),
  ('owner', 'teams', 'create', true),
  ('owner', 'teams', 'read', true),
  ('owner', 'teams', 'update', true),
  ('owner', 'teams', 'delete', true),
  ('owner', 'users', 'invite', true),
  ('owner', 'users', 'remove', true),
  ('owner', 'users', 'update_role', true),
  ('owner', 'organization', 'update', true),
  ('owner', 'organization', 'delete', true),

  -- Admin permissions (almost full access, cannot delete org)
  ('admin', 'services', 'create', true),
  ('admin', 'services', 'read', true),
  ('admin', 'services', 'update', true),
  ('admin', 'services', 'delete', true),
  ('admin', 'deployments', 'create', true),
  ('admin', 'deployments', 'read', true),
  ('admin', 'deployments', 'update', true),
  ('admin', 'deployments', 'delete', true),
  ('admin', 'teams', 'create', true),
  ('admin', 'teams', 'read', true),
  ('admin', 'teams', 'update', true),
  ('admin', 'teams', 'delete', true),
  ('admin', 'users', 'invite', true),
  ('admin', 'users', 'remove', true),
  ('admin', 'organization', 'update', true),

  -- Member permissions (can create and manage own resources)
  ('member', 'services', 'create', true),
  ('member', 'services', 'read', true),
  ('member', 'services', 'update', true),
  ('member', 'deployments', 'create', true),
  ('member', 'deployments', 'read', true),
  ('member', 'deployments', 'update', true),
  ('member', 'teams', 'read', true),

  -- Viewer permissions (read-only)
  ('viewer', 'services', 'read', true),
  ('viewer', 'deployments', 'read', true),
  ('viewer', 'teams', 'read', true)
ON CONFLICT (role, resource, action) DO NOTHING;

-- =====================================================
-- PART 8: COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE organizations IS 'Workspaces/tenants that isolate data between different companies or teams';
COMMENT ON TABLE users IS 'Individual user accounts that can belong to multiple organizations';
COMMENT ON TABLE organization_memberships IS 'Links users to organizations with role-based permissions';
COMMENT ON TABLE audit_logs IS 'Audit trail of all actions performed in the system';
COMMENT ON TABLE sessions IS 'Active user sessions with JWT token management';
COMMENT ON TABLE role_permissions IS 'Defines what actions each role can perform on resources';

COMMENT ON COLUMN organizations.slug IS 'URL-safe identifier used in routes (e.g., /org/acme-corp)';
COMMENT ON COLUMN organizations.aws_credentials_encrypted IS 'AES-256 encrypted AWS access keys, unique per organization';
COMMENT ON COLUMN organizations.subscription_tier IS 'Subscription level: free, pro, or enterprise';
COMMENT ON COLUMN users.password_hash IS 'bcrypt hashed password (10 rounds minimum)';
COMMENT ON COLUMN users.failed_login_attempts IS 'Counter for rate limiting; resets on successful login';
COMMENT ON COLUMN organization_memberships.role IS 'User role: owner, admin, member, or viewer';

-- =====================================================
-- MIGRATION COMPLETE
-- =====================================================
-- Next Steps:
-- 1. Run data migration to assign existing records to a default organization
-- 2. Create backend authentication service
-- 3. Create backend organization service
-- 4. Implement middleware for organization context
-- 5. Build frontend authentication pages
-- 6. Build frontend organization management UI
-- =====================================================
