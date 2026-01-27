-- Migration: Create custom compliance frameworks tables
-- Description: Enterprise-tier custom compliance framework definitions and scanning
-- Created: 2026-01-26

-- =====================================================
-- compliance_frameworks table
-- =====================================================
CREATE TABLE compliance_frameworks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Framework metadata
  name VARCHAR(255) NOT NULL,
  description TEXT,
  framework_type VARCHAR(50) NOT NULL CHECK (framework_type IN ('built_in', 'custom')),

  -- Framework status
  enabled BOOLEAN DEFAULT true,
  is_default BOOLEAN DEFAULT false, -- Apply by default to all scans

  -- Standard frameworks (SOC2, HIPAA, PCI-DSS, etc.)
  standard_name VARCHAR(100), -- e.g., 'SOC2', 'HIPAA', 'PCI-DSS', 'CIS'
  version VARCHAR(50), -- e.g., '1.0', '2.0'

  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Constraints
  CONSTRAINT unique_org_framework_name UNIQUE (organization_id, name)
);

-- =====================================================
-- compliance_framework_rules table
-- =====================================================
CREATE TABLE compliance_framework_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  framework_id UUID NOT NULL REFERENCES compliance_frameworks(id) ON DELETE CASCADE,

  -- Rule metadata
  rule_code VARCHAR(100) NOT NULL, -- e.g., 'SOC2-CC6.1', 'CUSTOM-001'
  title VARCHAR(255) NOT NULL,
  description TEXT,

  -- Rule configuration
  severity VARCHAR(20) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low')),
  category VARCHAR(50) NOT NULL CHECK (category IN ('encryption', 'backups', 'public_access', 'tagging', 'iam', 'networking', 'custom')),

  -- Rule type and conditions
  rule_type VARCHAR(50) NOT NULL CHECK (rule_type IN (
    'property_check',      -- Check resource property (e.g., is_encrypted = true)
    'tag_required',        -- Require specific tag
    'tag_pattern',         -- Tag must match pattern
    'metadata_check',      -- Check metadata JSON field
    'relationship_check',  -- Check relationships between resources
    'custom_script'        -- Custom JavaScript evaluation
  )),

  -- Rule conditions (JSON)
  conditions JSONB NOT NULL,

  -- Target resource types
  resource_types TEXT[] DEFAULT ARRAY[]::TEXT[], -- Empty array = all types

  -- Remediation
  recommendation TEXT NOT NULL,
  remediation_url TEXT, -- Link to documentation

  -- Rule state
  enabled BOOLEAN DEFAULT true,

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Constraints
  CONSTRAINT unique_framework_rule_code UNIQUE (framework_id, rule_code)
);

-- =====================================================
-- compliance_scans table
-- =====================================================
CREATE TABLE compliance_scans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  framework_id UUID NOT NULL REFERENCES compliance_frameworks(id) ON DELETE CASCADE,

  -- Scan metadata
  scan_type VARCHAR(50) NOT NULL CHECK (scan_type IN ('manual', 'scheduled', 'continuous')),
  status VARCHAR(50) NOT NULL CHECK (status IN ('pending', 'running', 'completed', 'failed')),

  -- Scan scope
  resource_filters JSONB DEFAULT '{}'::jsonb, -- Filters applied to scan

  -- Scan results
  total_resources INTEGER DEFAULT 0,
  compliant_resources INTEGER DEFAULT 0,
  non_compliant_resources INTEGER DEFAULT 0,
  resources_scanned INTEGER DEFAULT 0,

  -- Issue breakdown
  critical_issues INTEGER DEFAULT 0,
  high_issues INTEGER DEFAULT 0,
  medium_issues INTEGER DEFAULT 0,
  low_issues INTEGER DEFAULT 0,

  -- Compliance score (percentage)
  compliance_score DECIMAL(5, 2), -- 0.00 to 100.00

  -- Execution info
  started_at TIMESTAMP,
  completed_at TIMESTAMP,
  duration_seconds INTEGER,

  -- Error tracking
  error_message TEXT,

  -- Results storage
  results JSONB, -- Detailed scan results

  -- Metadata
  triggered_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- compliance_scan_findings table (detailed findings)
-- =====================================================
CREATE TABLE compliance_scan_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scan_id UUID NOT NULL REFERENCES compliance_scans(id) ON DELETE CASCADE,
  rule_id UUID NOT NULL REFERENCES compliance_framework_rules(id) ON DELETE CASCADE,

  -- Resource info
  resource_id VARCHAR(255) NOT NULL,
  resource_arn TEXT NOT NULL,
  resource_type VARCHAR(50) NOT NULL,
  resource_name VARCHAR(255),

  -- Finding details
  status VARCHAR(20) NOT NULL CHECK (status IN ('pass', 'fail', 'error', 'skip')),
  severity VARCHAR(20) NOT NULL,
  category VARCHAR(50) NOT NULL,

  -- Issue details (if failed)
  issue TEXT,
  recommendation TEXT,

  -- Remediation tracking
  remediated BOOLEAN DEFAULT false,
  remediated_at TIMESTAMP,
  remediated_by UUID REFERENCES users(id),
  remediation_notes TEXT,

  -- Metadata
  detected_at TIMESTAMP DEFAULT NOW(),

  -- Index for fast lookups
  CONSTRAINT idx_scan_resource UNIQUE (scan_id, resource_id, rule_id)
);

-- =====================================================
-- Indexes for performance
-- =====================================================

-- Frameworks
CREATE INDEX idx_compliance_frameworks_org ON compliance_frameworks(organization_id);
CREATE INDEX idx_compliance_frameworks_enabled ON compliance_frameworks(enabled) WHERE enabled = true;
CREATE INDEX idx_compliance_frameworks_default ON compliance_frameworks(is_default) WHERE is_default = true;
CREATE INDEX idx_compliance_frameworks_type ON compliance_frameworks(framework_type);

-- Rules
CREATE INDEX idx_compliance_framework_rules_framework ON compliance_framework_rules(framework_id);
CREATE INDEX idx_compliance_framework_rules_enabled ON compliance_framework_rules(enabled) WHERE enabled = true;
CREATE INDEX idx_compliance_framework_rules_type ON compliance_framework_rules(rule_type);
CREATE INDEX idx_compliance_framework_rules_category ON compliance_framework_rules(category);
CREATE INDEX idx_compliance_framework_rules_resource_types ON compliance_framework_rules USING GIN(resource_types);

-- Scans
CREATE INDEX idx_compliance_scans_org ON compliance_scans(organization_id);
CREATE INDEX idx_compliance_scans_framework ON compliance_scans(framework_id);
CREATE INDEX idx_compliance_scans_status ON compliance_scans(status);
CREATE INDEX idx_compliance_scans_created ON compliance_scans(created_at DESC);
CREATE INDEX idx_compliance_scans_org_created ON compliance_scans(organization_id, created_at DESC);

-- Findings
CREATE INDEX idx_compliance_scan_findings_scan ON compliance_scan_findings(scan_id);
CREATE INDEX idx_compliance_scan_findings_rule ON compliance_scan_findings(rule_id);
CREATE INDEX idx_compliance_scan_findings_resource ON compliance_scan_findings(resource_id);
CREATE INDEX idx_compliance_scan_findings_status ON compliance_scan_findings(status);
CREATE INDEX idx_compliance_scan_findings_severity ON compliance_scan_findings(severity);
CREATE INDEX idx_compliance_scan_findings_remediated ON compliance_scan_findings(remediated) WHERE remediated = false;

-- =====================================================
-- Triggers
-- =====================================================

-- Auto-update updated_at for frameworks
CREATE OR REPLACE FUNCTION update_compliance_frameworks_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER compliance_frameworks_updated_at
  BEFORE UPDATE ON compliance_frameworks
  FOR EACH ROW
  EXECUTE FUNCTION update_compliance_frameworks_updated_at();

-- Auto-update updated_at for rules
CREATE OR REPLACE FUNCTION update_compliance_framework_rules_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER compliance_framework_rules_updated_at
  BEFORE UPDATE ON compliance_framework_rules
  FOR EACH ROW
  EXECUTE FUNCTION update_compliance_framework_rules_updated_at();

-- =====================================================
-- Comments for documentation
-- =====================================================

COMMENT ON TABLE compliance_frameworks IS 'Custom and built-in compliance frameworks (SOC2, HIPAA, PCI-DSS, custom)';
COMMENT ON TABLE compliance_framework_rules IS 'Individual compliance rules within a framework with flexible rule engine';
COMMENT ON TABLE compliance_scans IS 'Compliance scan execution history and results';
COMMENT ON TABLE compliance_scan_findings IS 'Detailed findings per resource per rule for each scan';

COMMENT ON COLUMN compliance_framework_rules.rule_type IS 'Type of rule: property_check, tag_required, tag_pattern, metadata_check, relationship_check, custom_script';
COMMENT ON COLUMN compliance_framework_rules.conditions IS 'JSON object defining rule conditions based on rule_type';
COMMENT ON COLUMN compliance_framework_rules.resource_types IS 'Array of resource types this rule applies to (empty = all types)';
COMMENT ON COLUMN compliance_scans.compliance_score IS 'Percentage of resources that passed all applicable rules';
COMMENT ON COLUMN compliance_scan_findings.status IS 'pass = compliant, fail = non-compliant, error = rule execution error, skip = rule not applicable';

-- =====================================================
-- Sample data for built-in frameworks (optional)
-- =====================================================

-- Insert SOC2 framework example (commented out - can be loaded separately)
/*
INSERT INTO compliance_frameworks (organization_id, name, description, framework_type, standard_name, version, enabled, is_default)
VALUES (
  '<org-id>',
  'SOC 2 Type II',
  'System and Organization Controls 2 Type II compliance framework',
  'built_in',
  'SOC2',
  'Type II',
  true,
  false
);

-- Sample SOC2 rules
INSERT INTO compliance_framework_rules (framework_id, rule_code, title, description, severity, category, rule_type, conditions, resource_types, recommendation)
VALUES (
  '<framework-id>',
  'SOC2-CC6.1',
  'Data at Rest Encryption',
  'All data stored in databases and storage systems must be encrypted at rest',
  'critical',
  'encryption',
  'property_check',
  '{"property": "is_encrypted", "operator": "equals", "value": true}'::jsonb,
  ARRAY['rds', 's3', 'ebs'],
  'Enable encryption at rest for this resource using AWS KMS or service-managed encryption'
);
*/
