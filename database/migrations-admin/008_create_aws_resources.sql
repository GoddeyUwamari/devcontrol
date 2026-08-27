-- Migration: 008_create_aws_resources.sql
-- Description: AWS Resource Inventory System - Auto-Discovery & Compliance
-- Date: 2025-12-29
-- Author: DevControl Team

-- =====================================================
-- AWS_RESOURCES TABLE
-- =====================================================
-- Stores discovered AWS resources with compliance and cost tracking
-- Supports EC2, RDS, S3, Lambda, ECS, and Load Balancers

CREATE TABLE IF NOT EXISTS aws_resources (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- AWS Resource Identification
  resource_arn VARCHAR(255) NOT NULL,
  resource_id VARCHAR(255) NOT NULL,
  resource_name VARCHAR(255),
  resource_type VARCHAR(50) NOT NULL, -- 'ec2', 'rds', 's3', 'lambda', 'ecs', 'elb'
  region VARCHAR(50) NOT NULL,

  -- Resource Details
  tags JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}', -- Resource-specific attributes (instance type, engine, etc.)
  status VARCHAR(50), -- 'running', 'stopped', 'available', 'active', etc.

  -- Cost Attribution
  estimated_monthly_cost DECIMAL(10,2) DEFAULT 0.00,
  actual_monthly_cost DECIMAL(10,2) DEFAULT 0.00,

  -- Compliance & Security
  is_encrypted BOOLEAN DEFAULT false,
  is_public BOOLEAN DEFAULT false,
  has_backup BOOLEAN DEFAULT false,
  compliance_issues JSONB DEFAULT '[]', -- Array of compliance issue objects

  -- Tracking
  last_synced_at TIMESTAMP WITH TIME ZONE,
  first_discovered_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),

  -- Constraints
  UNIQUE(organization_id, resource_arn)
);

-- =====================================================
-- RESOURCE_DISCOVERY_JOBS TABLE
-- =====================================================
-- Tracks resource discovery scan jobs (manual and scheduled)

CREATE TABLE IF NOT EXISTS resource_discovery_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Job Status
  status VARCHAR(50) NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'running', 'completed', 'failed')),

  -- Scan Results
  resources_discovered INTEGER DEFAULT 0,
  resources_updated INTEGER DEFAULT 0,
  resources_deleted INTEGER DEFAULT 0,

  -- Scan Scope
  regions VARCHAR(255)[], -- Regions scanned (e.g., ['us-east-1', 'us-west-2'])
  resource_types VARCHAR(50)[], -- Types scanned (e.g., ['ec2', 'rds', 's3'])

  -- Error Handling
  error_message TEXT,

  -- Timing
  started_at TIMESTAMP WITH TIME ZONE,
  completed_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
);

-- =====================================================
-- INDEXES FOR PERFORMANCE
-- =====================================================

-- AWS Resources Indexes
CREATE INDEX IF NOT EXISTS idx_aws_resources_org
  ON aws_resources(organization_id);

CREATE INDEX IF NOT EXISTS idx_aws_resources_type
  ON aws_resources(resource_type);

CREATE INDEX IF NOT EXISTS idx_aws_resources_region
  ON aws_resources(region);

CREATE INDEX IF NOT EXISTS idx_aws_resources_status
  ON aws_resources(status);

-- GIN index for fast JSON queries on tags
CREATE INDEX IF NOT EXISTS idx_aws_resources_tags
  ON aws_resources USING GIN(tags);

-- Composite index for organization + type queries
CREATE INDEX IF NOT EXISTS idx_aws_resources_org_type
  ON aws_resources(organization_id, resource_type);

-- Index for compliance filtering
CREATE INDEX IF NOT EXISTS idx_aws_resources_compliance
  ON aws_resources(is_encrypted, is_public, has_backup);

-- Discovery Jobs Indexes
CREATE INDEX IF NOT EXISTS idx_discovery_jobs_org
  ON resource_discovery_jobs(organization_id);

CREATE INDEX IF NOT EXISTS idx_discovery_jobs_status
  ON resource_discovery_jobs(status);

CREATE INDEX IF NOT EXISTS idx_discovery_jobs_created
  ON resource_discovery_jobs(created_at DESC);

-- =====================================================
-- ROW-LEVEL SECURITY (RLS)
-- =====================================================

-- Enable RLS on aws_resources table
ALTER TABLE aws_resources ENABLE ROW LEVEL SECURITY;

-- Policy 1: Isolation Policy (SELECT, UPDATE, DELETE)
-- Users can only access resources in their organization
CREATE POLICY aws_resources_isolation_policy ON aws_resources
  FOR ALL
  USING (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- Policy 2: Insert Policy
-- Users can only insert resources into their organization
CREATE POLICY aws_resources_insert_policy ON aws_resources
  FOR INSERT
  WITH CHECK (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- Enable RLS on resource_discovery_jobs table
ALTER TABLE resource_discovery_jobs ENABLE ROW LEVEL SECURITY;

-- Policy 1: Isolation Policy for discovery jobs
CREATE POLICY discovery_jobs_isolation_policy ON resource_discovery_jobs
  FOR ALL
  USING (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- Policy 2: Insert Policy for discovery jobs
CREATE POLICY discovery_jobs_insert_policy ON resource_discovery_jobs
  FOR INSERT
  WITH CHECK (
    organization_id::text = current_setting('app.current_organization_id', true)
  );

-- =====================================================
-- TRIGGER: AUTO-UPDATE updated_at COLUMN
-- =====================================================

CREATE TRIGGER update_aws_resources_updated_at
  BEFORE UPDATE ON aws_resources
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

-- =====================================================
-- COMMENTS FOR DOCUMENTATION
-- =====================================================

COMMENT ON TABLE aws_resources IS
  'Stores discovered AWS resources with compliance tracking, cost attribution, and security scanning';

COMMENT ON COLUMN aws_resources.resource_arn IS
  'AWS Resource ARN (Amazon Resource Name) - unique identifier across AWS';

COMMENT ON COLUMN aws_resources.resource_type IS
  'Type of AWS resource: ec2, rds, s3, lambda, ecs, elb';

COMMENT ON COLUMN aws_resources.tags IS
  'AWS resource tags (JSONB) for filtering and cost allocation';

COMMENT ON COLUMN aws_resources.metadata IS
  'Resource-specific metadata (instance type, engine version, storage size, etc.)';

COMMENT ON COLUMN aws_resources.compliance_issues IS
  'Array of compliance issues detected during scanning (severity, issue, recommendation)';

COMMENT ON COLUMN aws_resources.is_encrypted IS
  'Whether the resource has encryption enabled (EBS, RDS, S3)';

COMMENT ON COLUMN aws_resources.is_public IS
  'Whether the resource is publicly accessible (security risk flag)';

COMMENT ON COLUMN aws_resources.has_backup IS
  'Whether the resource has backup/snapshot enabled';

COMMENT ON TABLE resource_discovery_jobs IS
  'Tracks AWS resource discovery scan jobs (manual and scheduled)';

COMMENT ON COLUMN resource_discovery_jobs.status IS
  'Job status: pending, running, completed, failed';

COMMENT ON COLUMN resource_discovery_jobs.regions IS
  'Array of AWS regions scanned in this job';

COMMENT ON COLUMN resource_discovery_jobs.resource_types IS
  'Array of resource types scanned (ec2, rds, s3, etc.)';

-- =====================================================
-- SUCCESS MESSAGE
-- =====================================================

DO $$
BEGIN
  RAISE NOTICE 'Migration 008 completed successfully!';
  RAISE NOTICE 'Created table: aws_resources (resource inventory with compliance tracking)';
  RAISE NOTICE 'Created table: resource_discovery_jobs (job tracking)';
  RAISE NOTICE 'Created 11 indexes for performance';
  RAISE NOTICE 'Enabled Row-Level Security (RLS) with 4 policies';
  RAISE NOTICE 'Added trigger for auto-updating updated_at column';
  RAISE NOTICE 'Ready for AWS resource discovery and compliance scanning!';
END $$;
