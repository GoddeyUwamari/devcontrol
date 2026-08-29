-- Migration: 009_create_onboarding_progress.sql
-- Description: Create onboarding progress tracking for organizations
-- Date: 2026-01-03

-- =====================================================
-- ONBOARDING PROGRESS TABLE
-- =====================================================
-- Tracks onboarding completion status per organization
-- Status is computed from real data (services, deployments, AWS credentials)
-- Supports multi-user organizations where any member can complete steps

CREATE TABLE IF NOT EXISTS onboarding_progress (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE SET NULL, -- Who initiated onboarding

  -- Current stage tracking
  current_stage VARCHAR(50) NOT NULL DEFAULT 'welcome',
  completed_stages JSONB NOT NULL DEFAULT '[]', -- Array of completed stage IDs

  -- Stage completion timestamps (for analytics and display)
  welcome_completed_at TIMESTAMPTZ,
  first_service_created_at TIMESTAMPTZ,
  first_deployment_created_at TIMESTAMPTZ,
  aws_connected_at TIMESTAMPTZ,
  resources_discovered_at TIMESTAMPTZ,

  -- Onboarding lifecycle
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ, -- When all required stages are done
  dismissed_at TIMESTAMPTZ, -- User can dismiss/skip onboarding

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Constraints
  UNIQUE(organization_id), -- One onboarding record per organization

  -- Validation: current_stage must be valid
  CONSTRAINT valid_current_stage CHECK (
    current_stage IN (
      'welcome',
      'create_service',
      'log_deployment',
      'connect_aws',
      'discover_resources',
      'completed'
    )
  )
);

-- =====================================================
-- INDEXES
-- =====================================================

CREATE INDEX idx_onboarding_organization ON onboarding_progress(organization_id);
CREATE INDEX idx_onboarding_current_stage ON onboarding_progress(current_stage);
CREATE INDEX idx_onboarding_completed ON onboarding_progress(completed_at) WHERE completed_at IS NOT NULL;
CREATE INDEX idx_onboarding_dismissed ON onboarding_progress(dismissed_at) WHERE dismissed_at IS NOT NULL;

-- GIN index for JSONB completed_stages array
CREATE INDEX idx_onboarding_completed_stages ON onboarding_progress USING GIN(completed_stages);

-- =====================================================
-- ROW-LEVEL SECURITY (RLS)
-- =====================================================

ALTER TABLE onboarding_progress ENABLE ROW LEVEL SECURITY;

-- Policy: Users can only see/modify onboarding for their current organization
CREATE POLICY onboarding_org_isolation ON onboarding_progress
  FOR ALL
  USING (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- Policy: Allow insert for new organizations
CREATE POLICY onboarding_insert ON onboarding_progress
  FOR INSERT
  WITH CHECK (organization_id = current_setting('app.current_organization_id', true)::uuid);

-- =====================================================
-- TRIGGER: Auto-update updated_at timestamp
-- =====================================================

CREATE OR REPLACE FUNCTION update_onboarding_progress_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_onboarding_progress_updated_at
  BEFORE UPDATE ON onboarding_progress
  FOR EACH ROW
  EXECUTE FUNCTION update_onboarding_progress_updated_at();

-- =====================================================
-- HELPER FUNCTION: Auto-initialize onboarding for new orgs
-- =====================================================

CREATE OR REPLACE FUNCTION initialize_onboarding_for_organization()
RETURNS TRIGGER AS $$
BEGIN
  -- When a new organization is created, initialize onboarding
  INSERT INTO onboarding_progress (
    organization_id,
    user_id,
    current_stage,
    started_at
  )
  VALUES (
    NEW.id,
    NULL, -- Will be set when first user accesses
    'welcome',
    NOW()
  )
  ON CONFLICT (organization_id) DO NOTHING;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Attach trigger to organizations table
CREATE TRIGGER trigger_initialize_onboarding
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION initialize_onboarding_for_organization();

-- =====================================================
-- INITIAL DATA: Create onboarding records for existing orgs
-- =====================================================

-- Initialize onboarding for all existing organizations
INSERT INTO onboarding_progress (
  organization_id,
  current_stage,
  started_at
)
SELECT
  id,
  'welcome',
  created_at
FROM organizations
ON CONFLICT (organization_id) DO NOTHING;

-- Auto-complete steps for organizations with existing data
-- (They've already done these steps, so mark them complete)

-- 1. Mark welcome as completed for all orgs (existing users already saw the platform)
UPDATE onboarding_progress
SET welcome_completed_at = NOW()
WHERE organization_id IN (SELECT DISTINCT organization_id FROM services LIMIT 1);

-- 2. Mark first_service_created_at for orgs with services
UPDATE onboarding_progress op
SET first_service_created_at = s.created_at
FROM (
  SELECT organization_id, MIN(created_at) as created_at
  FROM services
  GROUP BY organization_id
) s
WHERE op.organization_id = s.organization_id
  AND op.first_service_created_at IS NULL;

-- 3. Mark first_deployment_created_at for orgs with deployments
UPDATE onboarding_progress op
SET first_deployment_created_at = d.created_at
FROM (
  SELECT organization_id, MIN(created_at) as created_at
  FROM deployments
  GROUP BY organization_id
) d
WHERE op.organization_id = d.organization_id
  AND op.first_deployment_created_at IS NULL;

-- 4. Mark aws_connected_at for orgs with AWS credentials
UPDATE onboarding_progress op
SET aws_connected_at = o.updated_at
FROM organizations o
WHERE op.organization_id = o.id
  AND o.aws_credentials_encrypted IS NOT NULL
  AND o.aws_credentials_encrypted != ''
  AND op.aws_connected_at IS NULL;

-- 5. Update completed_stages JSONB array based on completed timestamps
UPDATE onboarding_progress op
SET completed_stages = COALESCE(
  (
    SELECT jsonb_agg(stage)
    FROM (
      SELECT 'welcome' as stage WHERE op.welcome_completed_at IS NOT NULL
      UNION ALL
      SELECT 'create_service' WHERE op.first_service_created_at IS NOT NULL
      UNION ALL
      SELECT 'log_deployment' WHERE op.first_deployment_created_at IS NOT NULL
      UNION ALL
      SELECT 'connect_aws' WHERE op.aws_connected_at IS NOT NULL
      UNION ALL
      SELECT 'discover_resources' WHERE op.resources_discovered_at IS NOT NULL
    ) stages
  ),
  '[]'::jsonb
);

-- 6. Update current_stage based on progress
UPDATE onboarding_progress
SET current_stage = CASE
  WHEN dismissed_at IS NOT NULL THEN 'completed'
  WHEN welcome_completed_at IS NULL THEN 'welcome'
  WHEN first_service_created_at IS NULL THEN 'create_service'
  WHEN first_deployment_created_at IS NULL THEN 'log_deployment'
  WHEN aws_connected_at IS NULL THEN 'connect_aws'
  WHEN resources_discovered_at IS NULL THEN 'discover_resources'
  ELSE 'completed'
END;

-- 7. Mark as completed if all stages are done
UPDATE onboarding_progress
SET completed_at = GREATEST(
  welcome_completed_at,
  first_service_created_at,
  first_deployment_created_at,
  aws_connected_at,
  COALESCE(resources_discovered_at, NOW())
)
WHERE welcome_completed_at IS NOT NULL
  AND first_service_created_at IS NOT NULL
  AND first_deployment_created_at IS NOT NULL
  AND aws_connected_at IS NOT NULL
  AND completed_at IS NULL;

-- =====================================================
-- COMMENTS (Documentation)
-- =====================================================

COMMENT ON TABLE onboarding_progress IS 'Tracks onboarding completion status per organization. Status is computed from real data (services, deployments, AWS credentials).';
COMMENT ON COLUMN onboarding_progress.organization_id IS 'The organization this onboarding record belongs to (one per org)';
COMMENT ON COLUMN onboarding_progress.user_id IS 'The user who initiated onboarding (nullable, can be completed by multiple users)';
COMMENT ON COLUMN onboarding_progress.current_stage IS 'Current onboarding stage: welcome, create_service, log_deployment, connect_aws, discover_resources, completed';
COMMENT ON COLUMN onboarding_progress.completed_stages IS 'JSONB array of completed stage IDs for fast querying';
COMMENT ON COLUMN onboarding_progress.welcome_completed_at IS 'When user dismissed the welcome modal';
COMMENT ON COLUMN onboarding_progress.first_service_created_at IS 'When first service was created (auto-detected from services table)';
COMMENT ON COLUMN onboarding_progress.first_deployment_created_at IS 'When first deployment was logged (auto-detected from deployments table)';
COMMENT ON COLUMN onboarding_progress.aws_connected_at IS 'When AWS credentials were first connected (auto-detected)';
COMMENT ON COLUMN onboarding_progress.resources_discovered_at IS 'When user triggered first resource discovery scan';
COMMENT ON COLUMN onboarding_progress.dismissed_at IS 'When user clicked "Dismiss" to skip onboarding';
COMMENT ON COLUMN onboarding_progress.completed_at IS 'When all required onboarding steps were completed';

-- =====================================================
-- VERIFICATION QUERIES
-- =====================================================

-- Check onboarding status for all organizations
-- SELECT
--   o.name as organization,
--   op.current_stage,
--   op.completed_stages,
--   op.welcome_completed_at IS NOT NULL as welcome_done,
--   op.first_service_created_at IS NOT NULL as service_done,
--   op.first_deployment_created_at IS NOT NULL as deployment_done,
--   op.aws_connected_at IS NOT NULL as aws_done,
--   op.completed_at IS NOT NULL as fully_completed
-- FROM onboarding_progress op
-- JOIN organizations o ON o.id = op.organization_id
-- ORDER BY op.created_at DESC;

-- =====================================================
-- ROLLBACK (if needed)
-- =====================================================

-- DROP TRIGGER IF EXISTS trigger_onboarding_progress_updated_at ON onboarding_progress;
-- DROP TRIGGER IF EXISTS trigger_initialize_onboarding ON organizations;
-- DROP FUNCTION IF EXISTS update_onboarding_progress_updated_at();
-- DROP FUNCTION IF EXISTS initialize_onboarding_for_organization();
-- DROP TABLE IF EXISTS onboarding_progress CASCADE;
