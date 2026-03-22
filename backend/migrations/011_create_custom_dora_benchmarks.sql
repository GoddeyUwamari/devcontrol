-- Migration: Create custom_dora_benchmarks table
-- Date: 2026-03-21
-- Description: Allows enterprise organizations to override DORA performance thresholds
--              with targets specific to their team and processes.

CREATE TABLE IF NOT EXISTS custom_dora_benchmarks (
  id                UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   UUID        NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  metric_name       VARCHAR(50) NOT NULL CHECK (metric_name IN (
    'deployment_frequency',
    'lead_time',
    'change_failure_rate',
    'recovery_time'
  )),
  target_value      NUMERIC     NOT NULL CHECK (target_value > 0),
  target_unit       VARCHAR(50) NOT NULL CHECK (target_unit IN (
    'per_day',
    'hours',
    'percentage',
    'minutes'
  )),
  performance_label VARCHAR(100) NOT NULL DEFAULT 'Elite',
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- One row per metric per organization
  UNIQUE (organization_id, metric_name)
);

CREATE INDEX IF NOT EXISTS idx_custom_dora_benchmarks_org_id
  ON custom_dora_benchmarks(organization_id);

COMMENT ON TABLE custom_dora_benchmarks IS
  'Custom DORA performance thresholds per organization (Enterprise tier only). '
  'When a row exists for a metric, it overrides the industry-standard threshold '
  'used to classify performance as Elite / High / Medium / Low.';

COMMENT ON COLUMN custom_dora_benchmarks.metric_name IS
  'DORA metric identifier: deployment_frequency | lead_time | change_failure_rate | recovery_time';

COMMENT ON COLUMN custom_dora_benchmarks.target_value IS
  'Elite-tier threshold value in the given unit. '
  'For frequency metrics, higher is better; for time/rate metrics, lower is better.';

COMMENT ON COLUMN custom_dora_benchmarks.target_unit IS
  'Unit matching the metric: per_day (deployment_frequency), '
  'hours (lead_time), percentage (change_failure_rate), minutes (recovery_time)';

COMMENT ON COLUMN custom_dora_benchmarks.performance_label IS
  'Custom label for the top performance tier (default: Elite). '
  'Organizations can rename this to match internal terminology.';
