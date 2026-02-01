-- Migration: Create cost optimizations table
-- Description: Automated cost optimization recommendations
-- Created: 2026-01-31

-- =====================================================
-- cost_optimizations table
-- =====================================================
CREATE TABLE IF NOT EXISTS cost_optimizations (
  id UUID PRIMARY KEY,
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Resource identification
  type VARCHAR(50) NOT NULL CHECK (type IN (
    'idle_resource',
    'oversized_instance',
    'unattached_volume',
    'old_snapshot',
    'reserved_instance',
    'lambda_memory',
    'unused_elastic_ip',
    'idle_load_balancer'
  )),
  resource_id VARCHAR(255) NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_name VARCHAR(255),
  region VARCHAR(50),

  -- Cost analysis
  current_cost DECIMAL(10, 2) NOT NULL,
  optimized_cost DECIMAL(10, 2) NOT NULL,
  monthly_savings DECIMAL(10, 2) NOT NULL,
  annual_savings DECIMAL(10, 2) NOT NULL,

  -- Metadata
  risk VARCHAR(20) NOT NULL CHECK (risk IN ('safe', 'caution', 'risky')),
  effort VARCHAR(20) NOT NULL CHECK (effort IN ('low', 'medium', 'high')),
  confidence INTEGER NOT NULL CHECK (confidence >= 0 AND confidence <= 100),
  priority INTEGER NOT NULL CHECK (priority >= 1 AND priority <= 10),

  -- Details
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  reasoning TEXT NOT NULL,
  action TEXT NOT NULL,
  action_command TEXT,

  -- State
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'applied', 'dismissed')),
  detected_at TIMESTAMP NOT NULL DEFAULT NOW(),
  applied_at TIMESTAMP,
  dismissed_at TIMESTAMP,

  -- Metrics
  utilization_metrics JSONB,

  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  UNIQUE(organization_id, resource_id, type)
);

-- =====================================================
-- Indexes for performance
-- =====================================================

-- Query by organization
CREATE INDEX idx_cost_optimizations_org ON cost_optimizations(organization_id);

-- Query by status (filter pending/approved/applied)
CREATE INDEX idx_cost_optimizations_status ON cost_optimizations(status);

-- Sort by priority
CREATE INDEX idx_cost_optimizations_priority ON cost_optimizations(priority DESC);

-- Sort by savings
CREATE INDEX idx_cost_optimizations_savings ON cost_optimizations(monthly_savings DESC);

-- Composite index for common queries (org + status + priority)
CREATE INDEX idx_cost_optimizations_org_status_priority
  ON cost_optimizations(organization_id, status, priority DESC);

-- Find old dismissed recommendations for cleanup
CREATE INDEX idx_cost_optimizations_dismissed_cleanup
  ON cost_optimizations(organization_id, status, dismissed_at)
  WHERE status = 'dismissed';

-- =====================================================
-- Comments for documentation
-- =====================================================

COMMENT ON TABLE cost_optimizations IS 'AI-powered cost optimization recommendations';
COMMENT ON COLUMN cost_optimizations.priority IS 'AI-generated priority score (1-10), higher is more important';
COMMENT ON COLUMN cost_optimizations.confidence IS 'Confidence level (0-100) in the recommendation accuracy';
COMMENT ON COLUMN cost_optimizations.risk IS 'Risk level: safe (no impact), caution (verify first), risky (high impact)';
COMMENT ON COLUMN cost_optimizations.effort IS 'Implementation effort: low (< 1 hour), medium (1-4 hours), high (> 4 hours)';
COMMENT ON COLUMN cost_optimizations.utilization_metrics IS 'JSONB containing CPU, memory, network utilization metrics';
COMMENT ON COLUMN cost_optimizations.action_command IS 'AWS CLI command to execute the optimization (optional)';

-- =====================================================
-- Sample data for development/testing
-- =====================================================

-- Note: Uncomment below for local development testing
-- INSERT INTO cost_optimizations (
--   id, organization_id, type, resource_id, resource_type, resource_name, region,
--   current_cost, optimized_cost, monthly_savings, annual_savings,
--   risk, effort, confidence, priority,
--   title, description, reasoning, action, action_command,
--   status, detected_at
-- )
-- SELECT
--   gen_random_uuid(),
--   id,
--   'idle_resource',
--   'i-1234567890abcdef0',
--   'EC2',
--   'test-instance',
--   'us-east-1',
--   150.00,
--   0.00,
--   150.00,
--   1800.00,
--   'caution',
--   'low',
--   95,
--   8,
--   'Idle EC2 instance: test-instance',
--   'This instance has averaged 2.1% CPU over 7 days',
--   'Extremely low CPU usage suggests this instance is not being used',
--   'Stop instance (can be restarted if needed) or terminate if confirmed unused',
--   'aws ec2 stop-instances --instance-ids i-1234567890abcdef0 --region us-east-1',
--   'pending',
--   NOW()
-- FROM organizations
-- LIMIT 1;

-- =====================================================
-- Triggers
-- =====================================================

-- Auto-update dismissed_at timestamp
CREATE OR REPLACE FUNCTION update_dismissed_at()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.status = 'dismissed' AND OLD.status != 'dismissed' THEN
    NEW.dismissed_at = NOW();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_dismissed_at
  BEFORE UPDATE ON cost_optimizations
  FOR EACH ROW
  EXECUTE FUNCTION update_dismissed_at();

-- =====================================================
-- Grant permissions (adjust as needed)
-- =====================================================

-- GRANT SELECT, INSERT, UPDATE, DELETE ON cost_optimizations TO platform_portal_app;
