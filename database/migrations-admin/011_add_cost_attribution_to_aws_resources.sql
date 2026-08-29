-- Migration: 011_add_cost_attribution_to_aws_resources.sql
-- Description: Add team, service, and environment associations for cost attribution
-- Date: 2026-01-04
-- Author: DevControl Team

-- =====================================================
-- ADD COST ATTRIBUTION COLUMNS TO AWS_RESOURCES
-- =====================================================

-- Add team association
ALTER TABLE aws_resources
ADD COLUMN IF NOT EXISTS team_id UUID REFERENCES teams(id) ON DELETE SET NULL;

-- Add service association
ALTER TABLE aws_resources
ADD COLUMN IF NOT EXISTS service_id UUID REFERENCES services(id) ON DELETE SET NULL;

-- Add environment tracking (prod, staging, dev, etc.)
ALTER TABLE aws_resources
ADD COLUMN IF NOT EXISTS environment VARCHAR(50);

-- Add owner email (for individual resource ownership)
ALTER TABLE aws_resources
ADD COLUMN IF NOT EXISTS owner_email VARCHAR(255);

-- =====================================================
-- CREATE INDEXES FOR COST ATTRIBUTION QUERIES
-- =====================================================

-- Index for team-based cost queries
CREATE INDEX IF NOT EXISTS idx_aws_resources_team_id
  ON aws_resources(team_id);

-- Index for service-based cost queries
CREATE INDEX IF NOT EXISTS idx_aws_resources_service_id
  ON aws_resources(service_id);

-- Index for environment-based cost queries
CREATE INDEX IF NOT EXISTS idx_aws_resources_environment
  ON aws_resources(environment);

-- Composite index for team + environment cost rollups
CREATE INDEX IF NOT EXISTS idx_aws_resources_team_env
  ON aws_resources(team_id, environment);

-- Composite index for service + environment cost rollups
CREATE INDEX IF NOT EXISTS idx_aws_resources_service_env
  ON aws_resources(service_id, environment);

-- =====================================================
-- ADD COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON COLUMN aws_resources.team_id IS
  'Team that owns this resource (for cost attribution and accountability)';

COMMENT ON COLUMN aws_resources.service_id IS
  'Service this resource belongs to (for cost attribution and tracking)';

COMMENT ON COLUMN aws_resources.environment IS
  'Environment type: production, staging, development, qa, etc.';

COMMENT ON COLUMN aws_resources.owner_email IS
  'Individual owner email (optional, for fine-grained ownership tracking)';

-- =====================================================
-- FUNCTION: AUTO-DETECT OWNERSHIP FROM AWS TAGS
-- =====================================================
-- This function attempts to populate team/service/environment from AWS tags
-- Common tag patterns: Team, Owner, Service, Environment, CostCenter, etc.

CREATE OR REPLACE FUNCTION auto_detect_resource_ownership()
RETURNS VOID AS $$
BEGIN
  -- Auto-assign environment from tags
  UPDATE aws_resources
  SET environment = COALESCE(
    tags->>'Environment',
    tags->>'environment',
    tags->>'Env',
    tags->>'env'
  )
  WHERE environment IS NULL
    AND (tags ? 'Environment' OR tags ? 'environment' OR tags ? 'Env' OR tags ? 'env');

  -- Auto-assign owner email from tags
  UPDATE aws_resources
  SET owner_email = COALESCE(
    tags->>'Owner',
    tags->>'owner',
    tags->>'OwnerEmail',
    tags->>'owner_email'
  )
  WHERE owner_email IS NULL
    AND (tags ? 'Owner' OR tags ? 'owner' OR tags ? 'OwnerEmail' OR tags ? 'owner_email');

  -- Try to match team by name from tags
  UPDATE aws_resources ar
  SET team_id = t.id
  FROM teams t
  WHERE ar.team_id IS NULL
    AND (
      LOWER(ar.tags->>'Team') = LOWER(t.name) OR
      LOWER(ar.tags->>'team') = LOWER(t.name)
    );

  -- Try to match service by name from tags
  UPDATE aws_resources ar
  SET service_id = s.id
  FROM services s
  WHERE ar.service_id IS NULL
    AND (
      LOWER(ar.tags->>'Service') = LOWER(s.name) OR
      LOWER(ar.tags->>'service') = LOWER(s.name)
    );

  RAISE NOTICE 'Auto-detection completed: environment, owner, team, and service associations updated from AWS tags';
END;
$$ LANGUAGE plpgsql;

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 011 completed successfully!';
  RAISE NOTICE 'Added columns: team_id, service_id, environment, owner_email';
  RAISE NOTICE 'Created 5 indexes for cost attribution queries';
  RAISE NOTICE 'Created function: auto_detect_resource_ownership() for tag-based mapping';
  RAISE NOTICE 'Ready for cost attribution by team, service, and environment!';
  RAISE NOTICE '';
  RAISE NOTICE 'Run auto-detection: SELECT auto_detect_resource_ownership();';
END $$;
