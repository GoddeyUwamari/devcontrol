-- Migration: 023_create_account_security_findings.sql
-- Description: P1-(b) — account-level compliance findings (security groups, IAM users)
--   aren't rows in aws_resources, so they need their own home. New table, org-scoped
--   and RLS-protected from creation (same isolation/insert policy pair as 022's
--   cost_recommendations retrofit, applied here as a first-class part of table
--   creation instead of a later patch).
-- Date: 2026-07-09

CREATE TABLE account_security_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- sha256(resource_identifier || '|' || category || '|' || title), computed by
  -- AccountSecurityFindingsRepository — stable across re-scans so upsert doesn't duplicate.
  finding_key VARCHAR(64) NOT NULL,

  category VARCHAR(20) NOT NULL CHECK (category IN ('networking', 'iam')),
  severity VARCHAR(10) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  title TEXT NOT NULL,
  recommendation TEXT NOT NULL,
  resource_identifier TEXT NOT NULL,
  region VARCHAR(32),

  status VARCHAR(10) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT account_security_findings_org_key UNIQUE (organization_id, finding_key)
);

CREATE INDEX idx_account_security_findings_org_status ON account_security_findings(organization_id, status);
CREATE INDEX idx_account_security_findings_org_severity ON account_security_findings(organization_id, severity);

ALTER TABLE account_security_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY account_security_findings_isolation_policy ON account_security_findings
  FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));

CREATE POLICY account_security_findings_insert_policy ON account_security_findings
  FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

COMMENT ON TABLE account_security_findings IS
  'Account-level compliance findings (security groups, IAM users) from ComplianceScannerService.checkSecurityGroups/checkIAMSecurity — not tied to a single aws_resources row, one scan per org per discovery run.';
COMMENT ON COLUMN account_security_findings.finding_key IS
  'Stable fingerprint for upsert-on-rescan: sha256(resource_identifier|category|title)';
COMMENT ON COLUMN account_security_findings.last_seen_at IS
  'Bumped on every scan that still detects this finding; used to detect staleness and flip status to resolved';

DO $$
BEGIN
  RAISE NOTICE 'Migration 023 completed successfully!';
  RAISE NOTICE 'account_security_findings created with organization_id (NOT NULL), RLS enabled, and both policies';
END $$;
