-- Migration: 202608221112_create_custom_anomaly_rules.sql
-- Description: Creates custom_anomaly_rules, the backing table for the
--   Enterprise-tier custom anomaly-detection rules feature
--   (backend/src/services/custom-anomaly-rules.service.ts, routed at
--   /api/anomaly-rules in server.ts, consumed by
--   app/(app)/anomalies/rules/page.tsx). This table was never created by
--   any prior migration -- the feature is fully wired end-to-end (frontend
--   page, API client, Express routes, service layer) but every GET/POST/
--   PATCH/DELETE against it has always failed in production with
--   "relation \"custom_anomaly_rules\" does not exist", caught by a generic
--   try/catch and surfaced only as an opaque 500. This migration closes
--   that gap. Genuinely post-baseline: this table (and this file) did not
--   exist at 089cef41054d8d950886924e9a8501dca1f93aab.
--
--   Columns/types/constraints are derived directly from the service's own
--   query text (getRules/createRule/updateRule/deleteRule/evaluateRules in
--   custom-anomaly-rules.service.ts) and the shared CustomAnomalyRule
--   contract duplicated in lib/services/custom-anomaly-rules.service.ts
--   (frontend) and backend/src/types/anomaly.types.ts's AnomalySeverity:
--     - condition and severity are genuine closed sets (TypeScript union
--       types on both sides of the API) -- CHECK-constrained, matching
--       023_create_account_security_findings.sql's convention.
--     - metric and time_window are NOT constrained: evaluateSingleRule's
--       metric->AnomalyType lookup has an explicit `?? 'cost_spike'`
--       fallback for unmapped values, and time_window is only ever read
--       back for display (the actual evaluation window is a hardcoded
--       30-day lookback in evaluateSingleRule, independent of this field)
--       -- the app itself treats both as open strings, not enums, so this
--       migration doesn't invent a constraint the application contradicts.
--     - organization_id is UUID with a REFERENCES/ON DELETE CASCADE FK and
--       full RLS (isolation + insert policy pair), matching every other
--       org-scoped table's convention (004_add_multi_tenancy.sql onward,
--       most directly 023's version of the same pair). Note: a same-named
--       table already exists in the *local* dev database only, created out
--       of band with organization_id as a bare, unconstrained
--       VARCHAR(255) and RLS disabled -- that local table is itself
--       drifted from house convention (no committed migration produced
--       it), not a template to copy. This migration intentionally follows
--       the house convention instead, since production has zero rows and
--       there is no existing data to reconcile.
--     - threshold NUMERIC(12,4) and time_window/severity default values
--       match the local out-of-band table's already-battle-tested choices
--       (safe to reuse: precision/defaults, not the org_id typing/RLS gap
--       above).
-- Date: 2026-08-22

CREATE TABLE custom_anomaly_rules (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  name VARCHAR(255) NOT NULL,
  description TEXT,
  metric VARCHAR(100) NOT NULL,
  condition VARCHAR(20) NOT NULL CHECK (condition IN ('greater_than', 'less_than', 'percent_change_up', 'percent_change_down')),
  threshold NUMERIC(12,4) NOT NULL,
  time_window VARCHAR(20) NOT NULL DEFAULT '1h',
  severity VARCHAR(20) NOT NULL DEFAULT 'warning' CHECK (severity IN ('info', 'warning', 'critical')),
  enabled BOOLEAN NOT NULL DEFAULT true,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Partial index: evaluateRules() (the rule-engine sweep) only ever reads
-- enabled rules per org; getRules() (the CRUD list endpoint) reads all
-- rows per org regardless of enabled state and is low-volume/admin-facing,
-- so it doesn't need its own index.
CREATE INDEX idx_custom_anomaly_rules_org_enabled ON custom_anomaly_rules(organization_id) WHERE enabled = true;

ALTER TABLE custom_anomaly_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY custom_anomaly_rules_isolation_policy ON custom_anomaly_rules
  FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));

CREATE POLICY custom_anomaly_rules_insert_policy ON custom_anomaly_rules
  FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

GRANT ALL ON TABLE custom_anomaly_rules TO devcontrol;

COMMENT ON TABLE custom_anomaly_rules IS
  'Enterprise-tier user-defined anomaly detection rules (backend/src/services/custom-anomaly-rules.service.ts), evaluated alongside the statistical anomaly detectors. Table was missing from every prior migration; this is the fix.';
COMMENT ON COLUMN custom_anomaly_rules.metric IS
  'Free-form key into aws_resources.tags, not a closed enum -- evaluateSingleRule falls back to cost_spike for unmapped values.';
COMMENT ON COLUMN custom_anomaly_rules.time_window IS
  'Display-only label echoed back to the client; evaluateSingleRule''s actual historical lookback is a fixed 30 days, independent of this value.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202608221112 completed successfully!';
  RAISE NOTICE 'custom_anomaly_rules created with organization_id (UUID, FK, NOT NULL), RLS enabled, and both policies';
END $$;
