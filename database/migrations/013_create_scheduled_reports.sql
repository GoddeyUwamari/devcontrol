-- Migration: Create scheduled_reports and scheduled_report_executions tables
-- Description: Enterprise-tier automated report scheduling with email and Slack delivery
-- Created: 2026-01-26

-- =====================================================
-- scheduled_reports table
-- =====================================================
CREATE TABLE scheduled_reports (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Report configuration
  name VARCHAR(255) NOT NULL,
  description TEXT,
  report_type VARCHAR(50) NOT NULL CHECK (report_type IN ('cost_summary', 'security_audit', 'compliance_status')),

  -- Schedule configuration
  schedule_type VARCHAR(20) NOT NULL CHECK (schedule_type IN ('daily', 'weekly', 'monthly')),
  schedule_time TIME NOT NULL, -- Time of day in organization's timezone (HH:MM:SS)
  schedule_day_of_week INTEGER CHECK (schedule_day_of_week BETWEEN 0 AND 6), -- For weekly: 0=Sunday, 6=Saturday
  schedule_day_of_month INTEGER CHECK (schedule_day_of_month BETWEEN 1 AND 31), -- For monthly: day of month
  timezone VARCHAR(50) NOT NULL DEFAULT 'UTC', -- IANA timezone identifier (e.g., 'America/New_York')

  -- Delivery configuration
  delivery_email BOOLEAN DEFAULT false,
  delivery_slack BOOLEAN DEFAULT false,
  email_recipients TEXT[] DEFAULT ARRAY[]::TEXT[], -- Array of email addresses
  slack_channels TEXT[] DEFAULT ARRAY[]::TEXT[], -- Array of Slack channels (e.g., ['#alerts', '#reports'])

  -- Report format and filters
  format VARCHAR(10) NOT NULL DEFAULT 'pdf' CHECK (format IN ('pdf', 'csv', 'both')),
  filters JSONB DEFAULT '{}'::jsonb, -- ResourceFilters for filtering report data
  columns JSONB DEFAULT '[]'::jsonb, -- Array of column names for CSV/PDF export

  -- State management
  enabled BOOLEAN DEFAULT true,
  last_run_at TIMESTAMP, -- Last successful or failed execution time
  last_run_status VARCHAR(20) CHECK (last_run_status IN ('success', 'failed', 'partial')),
  last_run_error TEXT, -- Error message from last failed run
  next_run_at TIMESTAMP, -- Next scheduled execution time (in UTC)
  run_count INTEGER DEFAULT 0, -- Total number of executions

  -- Metadata
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),

  -- Constraints
  CONSTRAINT unique_org_report_name UNIQUE (organization_id, name),
  CONSTRAINT at_least_one_delivery_method CHECK (delivery_email = true OR delivery_slack = true)
);

-- =====================================================
-- scheduled_report_executions table
-- =====================================================
CREATE TABLE scheduled_report_executions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  scheduled_report_id UUID NOT NULL REFERENCES scheduled_reports(id) ON DELETE CASCADE,

  -- Execution info
  executed_at TIMESTAMP NOT NULL DEFAULT NOW(),
  status VARCHAR(20) NOT NULL CHECK (status IN ('success', 'failed', 'partial')),

  -- Execution metrics
  records_processed INTEGER DEFAULT 0, -- Number of resources in report
  file_size_bytes INTEGER, -- Size of generated PDF/CSV
  execution_time_ms INTEGER, -- Time taken to generate report

  -- Delivery tracking
  email_sent BOOLEAN DEFAULT false,
  email_recipients TEXT[], -- Actual recipients for this execution
  slack_sent BOOLEAN DEFAULT false,
  slack_channels TEXT[], -- Actual Slack channels for this execution

  -- Error tracking
  error_message TEXT, -- User-friendly error message
  error_stack TEXT, -- Full stack trace for debugging

  -- Metadata
  created_at TIMESTAMP DEFAULT NOW()
);

-- =====================================================
-- Indexes for performance
-- =====================================================

-- Query schedules by organization
CREATE INDEX idx_scheduled_reports_org ON scheduled_reports(organization_id);

-- Find enabled schedules for cron job
CREATE INDEX idx_scheduled_reports_enabled ON scheduled_reports(enabled) WHERE enabled = true;

-- Find due reports (critical for cron job performance)
CREATE INDEX idx_scheduled_reports_next_run ON scheduled_reports(next_run_at) WHERE enabled = true;

-- Filter by report type
CREATE INDEX idx_scheduled_reports_type ON scheduled_reports(report_type);

-- Query execution history for a schedule
CREATE INDEX idx_scheduled_report_executions_report ON scheduled_report_executions(scheduled_report_id, executed_at DESC);

-- Query failed executions for monitoring
CREATE INDEX idx_scheduled_report_executions_status ON scheduled_report_executions(status, executed_at DESC);

-- =====================================================
-- Triggers
-- =====================================================

-- Auto-update updated_at on scheduled_reports
CREATE OR REPLACE FUNCTION update_scheduled_reports_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER scheduled_reports_updated_at
  BEFORE UPDATE ON scheduled_reports
  FOR EACH ROW
  EXECUTE FUNCTION update_scheduled_reports_updated_at();

-- =====================================================
-- Comments for documentation
-- =====================================================

COMMENT ON TABLE scheduled_reports IS 'Enterprise-tier scheduled report configurations with automated delivery';
COMMENT ON TABLE scheduled_report_executions IS 'Historical log of report executions for monitoring and debugging';

COMMENT ON COLUMN scheduled_reports.schedule_time IS 'Time of day to run report in the specified timezone (converted to UTC for execution)';
COMMENT ON COLUMN scheduled_reports.schedule_day_of_week IS 'For weekly schedules: 0=Sunday, 1=Monday, ..., 6=Saturday';
COMMENT ON COLUMN scheduled_reports.schedule_day_of_month IS 'For monthly schedules: 1-31 (execution skipped if month does not have that day)';
COMMENT ON COLUMN scheduled_reports.timezone IS 'IANA timezone identifier (e.g., America/New_York, Europe/London, UTC) for schedule_time interpretation';
COMMENT ON COLUMN scheduled_reports.filters IS 'JSON object containing ResourceFilters for filtering report data (resource_type, region, status, etc.)';
COMMENT ON COLUMN scheduled_reports.columns IS 'JSON array of column names to include in CSV/PDF export';
COMMENT ON COLUMN scheduled_reports.next_run_at IS 'Next scheduled execution time in UTC (calculated after each run or when schedule is updated)';
COMMENT ON COLUMN scheduled_report_executions.status IS 'success = all delivery methods succeeded, failed = report generation failed, partial = report generated but some deliveries failed';
