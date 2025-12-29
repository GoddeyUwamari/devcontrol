-- Migration: 006_create_service_dependencies.sql
-- Description: Service Dependency Graphs - Manual Entry (Phase 1)
-- Date: 2025-12-28
-- Author: DevControl Team

-- =====================================================
-- SERVICE_DEPENDENCIES TABLE
-- =====================================================
-- Stores directed dependencies between services
-- Example: API Gateway (source) depends on Auth Service (target)
-- Supports dependency visualization, impact analysis, and circular dependency detection

CREATE TABLE IF NOT EXISTS service_dependencies (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Dependency Definition (Directed Graph)
  source_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  target_service_id UUID NOT NULL REFERENCES services(id) ON DELETE CASCADE,

  -- Dependency Type Classification
  dependency_type VARCHAR(50) NOT NULL DEFAULT 'runtime'
    CHECK (dependency_type IN ('runtime', 'data', 'deployment', 'shared-lib')),

  -- Metadata
  description TEXT,
  is_critical BOOLEAN DEFAULT false, -- Critical path dependency flag
  metadata JSONB DEFAULT '{}', -- Extensible metadata (ports, protocols, SLAs, etc.)

  -- Audit Fields
  created_by VARCHAR(255), -- User email who created this dependency
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  UNIQUE(organization_id, source_service_id, target_service_id, dependency_type),
  CHECK (source_service_id != target_service_id) -- Prevent self-dependencies
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- Multi-tenancy index (REQUIRED for RLS performance)
CREATE INDEX IF NOT EXISTS idx_service_dependencies_org
  ON service_dependencies(organization_id);

-- Foreign key indexes for fast lookups
CREATE INDEX IF NOT EXISTS idx_service_dependencies_source
  ON service_dependencies(source_service_id);

CREATE INDEX IF NOT EXISTS idx_service_dependencies_target
  ON service_dependencies(target_service_id);

-- Type and critical flag indexes for filtering
CREATE INDEX IF NOT EXISTS idx_service_dependencies_type
  ON service_dependencies(dependency_type);

CREATE INDEX IF NOT EXISTS idx_service_dependencies_critical
  ON service_dependencies(is_critical) WHERE is_critical = true;

-- Composite index for graph queries (source → target lookups)
CREATE INDEX IF NOT EXISTS idx_service_dependencies_source_target
  ON service_dependencies(source_service_id, target_service_id);

-- Composite index for organization + status queries
CREATE INDEX IF NOT EXISTS idx_service_dependencies_org_critical
  ON service_dependencies(organization_id, is_critical);

-- =====================================================
-- ROW-LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on the table
ALTER TABLE service_dependencies ENABLE ROW LEVEL SECURITY;

-- Policy 1: Isolation Policy (SELECT, UPDATE, DELETE)
-- Users can only access dependencies in their organization
CREATE POLICY service_dependencies_isolation_policy ON service_dependencies
  FOR ALL
  USING (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- Policy 2: Insert Policy
-- Users can only insert dependencies into their organization
CREATE POLICY service_dependencies_insert_policy ON service_dependencies
  FOR INSERT
  WITH CHECK (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- =====================================================
-- TRIGGER: AUTO-UPDATE updated_at COLUMN
-- =====================================================

CREATE TRIGGER update_service_dependencies_updated_at
  BEFORE UPDATE ON service_dependencies
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE service_dependencies IS
  'Stores directed dependencies between services for dependency graph visualization, impact analysis, and circular dependency detection';

COMMENT ON COLUMN service_dependencies.source_service_id IS
  'Service that has the dependency (depends on target)';

COMMENT ON COLUMN service_dependencies.target_service_id IS
  'Service that is depended upon (needed by source)';

COMMENT ON COLUMN service_dependencies.dependency_type IS
  'Type of dependency: runtime (API calls), data (database), deployment (deploy order), shared-lib (shared code)';

COMMENT ON COLUMN service_dependencies.is_critical IS
  'If true, this is a critical path dependency that must be monitored closely';

COMMENT ON COLUMN service_dependencies.metadata IS
  'Extensible JSONB field for storing additional information like ports, protocols, health check endpoints, SLAs, etc.';

COMMENT ON COLUMN service_dependencies.created_by IS
  'Email of the user who manually created this dependency';

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 006 completed successfully!';
  RAISE NOTICE 'Created table: service_dependencies';
  RAISE NOTICE 'Created 7 indexes for performance';
  RAISE NOTICE 'Enabled Row-Level Security (RLS) with 2 policies';
  RAISE NOTICE 'Added trigger for auto-updating updated_at column';
END $$;
