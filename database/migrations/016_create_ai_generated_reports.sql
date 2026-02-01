-- Migration: Create AI-generated reports table
-- Description: Stores AI-powered executive summaries and insights
-- Created: 2026-01-31

-- =====================================================
-- generated_reports table
-- =====================================================
CREATE TABLE IF NOT EXISTS generated_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  scheduled_report_id UUID REFERENCES scheduled_reports(id) ON DELETE SET NULL,

  -- Report metadata
  report_type VARCHAR(50) NOT NULL CHECK (report_type IN (
    'executive_summary',
    'cost_analysis',
    'security_insights',
    'weekly_summary',
    'monthly_summary'
  )),
  date_range_from DATE NOT NULL,
  date_range_to DATE NOT NULL,

  -- AI-generated content
  report_data JSONB NOT NULL, -- Full GeneratedReport structure from AI service

  -- Delivery tracking
  sent_to JSONB, -- Array of email addresses or delivery channels
  sent_at TIMESTAMP WITH TIME ZONE,
  delivery_status VARCHAR(20) CHECK (delivery_status IN ('pending', 'sent', 'failed')),
  delivery_error TEXT,

  -- AI metadata
  ai_model VARCHAR(100) DEFAULT 'claude-sonnet-4-20250514',
  generation_time_ms INTEGER, -- Time taken to generate report
  token_usage INTEGER, -- Approximate tokens used
  was_fallback BOOLEAN DEFAULT false, -- True if fallback report was used

  -- Audit trail
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_by UUID REFERENCES users(id)
);

-- =====================================================
-- Indexes for performance
-- =====================================================

-- Query reports by organization
CREATE INDEX idx_generated_reports_org ON generated_reports(organization_id);

-- Query reports by date range (for history and trends)
CREATE INDEX idx_generated_reports_date ON generated_reports(date_range_to DESC);

-- Query reports by type
CREATE INDEX idx_generated_reports_type ON generated_reports(report_type);

-- Find reports linked to scheduled reports
CREATE INDEX idx_generated_reports_scheduled ON generated_reports(scheduled_report_id) WHERE scheduled_report_id IS NOT NULL;

-- Query by creation date for recent reports
CREATE INDEX idx_generated_reports_created ON generated_reports(organization_id, created_at DESC);

-- =====================================================
-- Extend scheduled_reports to support AI report types
-- =====================================================

-- Note: Migration 013 already created scheduled_reports with report_type check
-- We'll add AI report types by dropping and recreating the constraint

DO $$
BEGIN
  -- Drop existing constraint
  ALTER TABLE scheduled_reports DROP CONSTRAINT IF EXISTS scheduled_reports_report_type_check;

  -- Add new constraint with AI report types
  ALTER TABLE scheduled_reports
    ADD CONSTRAINT scheduled_reports_report_type_check
    CHECK (report_type IN (
      'cost_summary',
      'security_audit',
      'compliance_status',
      'ai_executive_summary',
      'ai_cost_analysis',
      'ai_security_insights'
    ));
EXCEPTION
  WHEN OTHERS THEN
    RAISE NOTICE 'Could not modify scheduled_reports constraint: %', SQLERRM;
END $$;

-- =====================================================
-- Comments for documentation
-- =====================================================

COMMENT ON TABLE generated_reports IS 'AI-generated reports with executive summaries, insights, and recommendations';

COMMENT ON COLUMN generated_reports.report_data IS 'JSONB containing full report structure: executive_summary, key_metrics, cost_insights, security_findings, deployment_activity, infrastructure_changes, recommendations, alerts_summary';

COMMENT ON COLUMN generated_reports.scheduled_report_id IS 'Reference to scheduled report that triggered generation (NULL for on-demand reports)';

COMMENT ON COLUMN generated_reports.was_fallback IS 'True if AI was unavailable and fallback report generator was used';

COMMENT ON COLUMN generated_reports.token_usage IS 'Approximate number of tokens used by Claude API for generation';

-- =====================================================
-- Sample data for development/testing
-- =====================================================

-- Note: Uncomment below for local development testing
-- INSERT INTO generated_reports (organization_id, report_type, date_range_from, date_range_to, report_data)
-- SELECT
--   id,
--   'weekly_summary',
--   CURRENT_DATE - INTERVAL '7 days',
--   CURRENT_DATE,
--   '{
--     "executive_summary": "Sample AI-generated weekly summary",
--     "key_metrics": {},
--     "cost_insights": [],
--     "security_findings": [],
--     "recommendations": []
--   }'::jsonb
-- FROM organizations
-- LIMIT 1;
