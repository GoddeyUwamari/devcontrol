-- Migration: Create risk_score_history table
-- Description: Track daily risk score snapshots for trend analysis and security posture monitoring
-- Created: 2026-01-25

-- Main risk score history table for time-series tracking
CREATE TABLE risk_score_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  snapshot_date DATE NOT NULL,

  -- Overall risk score (0-100, where 100 = perfect security)
  overall_score INTEGER NOT NULL CHECK (overall_score >= 0 AND overall_score <= 100),
  grade VARCHAR(1) NOT NULL CHECK (grade IN ('A', 'B', 'C', 'D', 'F')),

  -- Factor breakdown scores (0-100 each)
  encryption_score INTEGER NOT NULL CHECK (encryption_score >= 0 AND encryption_score <= 100),
  public_access_score INTEGER NOT NULL CHECK (public_access_score >= 0 AND public_access_score <= 100),
  backup_score INTEGER NOT NULL CHECK (backup_score >= 0 AND backup_score <= 100),
  compliance_score INTEGER NOT NULL CHECK (compliance_score >= 0 AND compliance_score <= 100),
  resource_management_score INTEGER NOT NULL CHECK (resource_management_score >= 0 AND resource_management_score <= 100),

  -- Raw counts for context and analysis
  total_resources INTEGER NOT NULL DEFAULT 0,
  unencrypted_count INTEGER NOT NULL DEFAULT 0,
  public_count INTEGER NOT NULL DEFAULT 0,
  missing_backup_count INTEGER NOT NULL DEFAULT 0,
  compliance_issues JSONB DEFAULT '{"critical": 0, "high": 0, "medium": 0, "low": 0}'::jsonb,
  orphaned_count INTEGER NOT NULL DEFAULT 0,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),

  -- Ensure one snapshot per organization per day
  CONSTRAINT unique_org_date UNIQUE (organization_id, snapshot_date)
);

-- Indexes for efficient trend queries
CREATE INDEX idx_risk_score_history_org_date ON risk_score_history(organization_id, snapshot_date DESC);
CREATE INDEX idx_risk_score_history_snapshot_date ON risk_score_history(snapshot_date DESC);
CREATE INDEX idx_risk_score_history_org_score ON risk_score_history(organization_id, overall_score);

-- Composite index for date range queries (most common operation)
CREATE INDEX idx_risk_score_history_org_date_range ON risk_score_history(organization_id, snapshot_date DESC, overall_score);

-- Comments for documentation
COMMENT ON TABLE risk_score_history IS 'Daily snapshots of organization security risk scores for trend analysis';
COMMENT ON COLUMN risk_score_history.overall_score IS 'Weighted overall risk score (0-100, higher is better)';
COMMENT ON COLUMN risk_score_history.grade IS 'Letter grade: A (90+), B (80-89), C (70-79), D (60-69), F (<60)';
COMMENT ON COLUMN risk_score_history.snapshot_date IS 'Date of snapshot (UTC), one per organization per day';
COMMENT ON COLUMN risk_score_history.compliance_issues IS 'Count by severity: {"critical": N, "high": N, "medium": N, "low": N}';
COMMENT ON COLUMN risk_score_history.encryption_score IS 'Encryption factor score (25% weight in overall)';
COMMENT ON COLUMN risk_score_history.public_access_score IS 'Public access factor score (30% weight - most critical)';
COMMENT ON COLUMN risk_score_history.backup_score IS 'Backup factor score (15% weight)';
COMMENT ON COLUMN risk_score_history.compliance_score IS 'Compliance factor score (25% weight)';
COMMENT ON COLUMN risk_score_history.resource_management_score IS 'Resource management factor score (5% weight)';
