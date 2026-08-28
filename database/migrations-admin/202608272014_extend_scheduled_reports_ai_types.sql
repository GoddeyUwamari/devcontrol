-- Migration: 202608272014_extend_scheduled_reports_ai_types.sql
-- Description: Extend scheduled_reports.report_type check constraint to
--   support AI report types. Split out of the former
--   016_create_ai_generated_reports.sql -- see
--   database/migrations-admin/README.md for why: scheduled_reports is
--   postgres-owned in production and this ALTER TABLE requires ownership
--   the ordinary devcontrol-connected runner does not have. The original
--   file also wrapped this in a DO $$ ... EXCEPTION WHEN OTHERS ... block
--   that swallowed any error (including an ownership failure); that
--   wrapper is deliberately removed here so a real failure aborts and
--   rolls back loudly instead of being silently recorded as applied.

-- Note: Migration 013 already created scheduled_reports with report_type check
-- We'll add AI report types by dropping and recreating the constraint

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
