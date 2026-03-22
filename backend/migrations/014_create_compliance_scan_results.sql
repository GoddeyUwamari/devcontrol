-- Migration 014: Create compliance scan results table for SOC 2 / HIPAA named-control engine

CREATE TABLE IF NOT EXISTS compliance_scan_results (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  framework VARCHAR(10) NOT NULL CHECK (framework IN ('soc2', 'hipaa')),
  overall_score NUMERIC(5,2) NOT NULL DEFAULT 0,
  controls_passed INTEGER NOT NULL DEFAULT 0,
  controls_failed INTEGER NOT NULL DEFAULT 0,
  controls_total INTEGER NOT NULL DEFAULT 0,
  control_results JSONB NOT NULL DEFAULT '[]',
  scanned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_compliance_scan_results_org_framework
  ON compliance_scan_results (organization_id, framework, scanned_at DESC);

CREATE INDEX IF NOT EXISTS idx_compliance_scan_results_org
  ON compliance_scan_results (organization_id, scanned_at DESC);
