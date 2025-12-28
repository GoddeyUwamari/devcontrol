-- Migration: 002_create_cost_recommendations.sql
-- Description: Cost Optimization Recommendations Table
-- Date: 2025-12-27

-- =====================================================
-- COST_RECOMMENDATIONS TABLE
-- =====================================================
CREATE TABLE IF NOT EXISTS cost_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  resource_id VARCHAR(255) NOT NULL,
  resource_name VARCHAR(255),
  resource_type VARCHAR(50) NOT NULL,
  issue VARCHAR(255) NOT NULL,
  description TEXT,
  potential_savings DECIMAL(10,2) NOT NULL DEFAULT 0.00,
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('LOW', 'MEDIUM', 'HIGH')),
  status VARCHAR(20) NOT NULL DEFAULT 'ACTIVE' CHECK (status IN ('ACTIVE', 'RESOLVED', 'DISMISSED')),
  aws_region VARCHAR(50),
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
  resolved_at TIMESTAMP WITH TIME ZONE
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_cost_recommendations_status ON cost_recommendations(status);
CREATE INDEX IF NOT EXISTS idx_cost_recommendations_severity ON cost_recommendations(severity);
CREATE INDEX IF NOT EXISTS idx_cost_recommendations_resource_type ON cost_recommendations(resource_type);
CREATE INDEX IF NOT EXISTS idx_cost_recommendations_created_at ON cost_recommendations(created_at DESC);

-- Comments for documentation
COMMENT ON TABLE cost_recommendations IS 'Stores AWS cost optimization recommendations';
COMMENT ON COLUMN cost_recommendations.severity IS 'HIGH: >$100/month, MEDIUM: $50-100/month, LOW: <$50/month';
COMMENT ON COLUMN cost_recommendations.status IS 'ACTIVE: needs attention, RESOLVED: fixed, DISMISSED: user chose to ignore';
