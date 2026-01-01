-- Week 13 Day 1: Audit Logging System
-- Migration: Create audit_logs table for comprehensive audit logging

CREATE TABLE IF NOT EXISTS audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id),
  user_id UUID REFERENCES users(id),
  action VARCHAR(100) NOT NULL,
  resource_type VARCHAR(50),
  resource_id VARCHAR(255),
  ip_address VARCHAR(45),
  user_agent TEXT,
  metadata JSONB DEFAULT '{}',
  created_at TIMESTAMP DEFAULT NOW()
);

-- Indexes for efficient querying
CREATE INDEX idx_audit_logs_org ON audit_logs(organization_id);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_action ON audit_logs(action);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);

-- Comments for documentation
COMMENT ON TABLE audit_logs IS 'Comprehensive audit log for all API actions';
COMMENT ON COLUMN audit_logs.action IS 'Action type (e.g., auth.login, resource.discovered)';
COMMENT ON COLUMN audit_logs.resource_type IS 'Type of resource affected (e.g., service, deployment)';
COMMENT ON COLUMN audit_logs.resource_id IS 'ID of the specific resource affected';
COMMENT ON COLUMN audit_logs.metadata IS 'Additional context and details about the action';
