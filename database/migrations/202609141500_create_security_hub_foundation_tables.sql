-- Migration: 202609141500_create_security_hub_foundation_tables.sql
-- Description: Creates the two new tables backing the Security & Compliance
--   Readiness foundation (AWS Security Hub -> normalized evidence -> CIS framework
--   evaluation). Phase D, CIS-only scope. See backend/src/services/security-hub-*.ts,
--   backend/src/config/securityHubCisMapping.ts, backend/src/routes/security-hub.routes.ts.
--
--   ARCHITECTURAL GATE (answered before writing this migration, per the explicit
--   instruction not to assume Security Hub findings belong in account_security_findings):
--   account_security_findings is intentionally left completely untouched by this
--   migration. Its identity (finding_key, a content-hash DevControl computes from
--   resource_identifier|category|title), its category CHECK (networking/iam only --
--   TypeScript-enforced too, via AccountFindingCategory), and its resolution model
--   (reconcileScan marks anything not re-seen in THIS scan as resolved, scoped to
--   completeCategories) are all specific to DevControl's own scanner
--   (complianceScanner.ts) having no native AWS resolution signal of its own. Security
--   Hub findings are the opposite: each finding already carries AWS's own authoritative
--   identity (Id/ProductArn) and its own resolution signal (RecordState ACTIVE/ARCHIVED,
--   Workflow.Status) that must never be reinterpreted through DevControl's
--   absence-implies-resolved heuristic. Forcing Security Hub findings through
--   account_security_findings would require either mislabeling every finding's category
--   as 'networking'/'iam' (false, and category widening is explicitly out of scope) or
--   widening that CHECK/type (explicitly disallowed), AND would conflate two independent
--   reconciliation authorities on one status column. Answer: NO, the two domains do not
--   share lifecycle semantics -- hence the dedicated tables below, not an ALTER.
--
--   security_hub_findings uses pure upsert-only ingestion (see
--   security-hub-sync.service.ts): a finding's own RecordState/Compliance.Status is
--   trusted whenever a fresh copy of it is fetched; nothing is ever locally
--   marked-resolved based on absence from a (possibly partial) sync. A finding's
--   last_seen_at is the freshness signal control evaluation uses to decide whether
--   stored evidence is current enough to support PASS/FAIL, or must fall back to
--   UNKNOWN -- see security-hub-compliance.service.ts's freshness gate. This is what
--   makes partial-pagination-failure-safety (Section 13/Step 6 of the spec) correct
--   without any resolve-on-absence logic at all.
--
--   organization_security_hub_state is a single small per-org row consolidating: (a)
--   ACTUAL CAPABILITY (capability_status/capability_checked_at/capability_error -- what
--   DevControl has actually proven via a real Security Hub API call, per
--   SecurityHubCapabilityStatus), (b) enabled_standards (raw discovery result, avoiding
--   a separate standards table per the "avoid unnecessary tables" instruction), and (c)
--   sync bookkeeping (manual-sync v1 -- no scheduler). DESIRED and ROLLOUT (the other
--   two facts of the three-fact model) are not persisted in this phase: v1 has no
--   per-org customization of "which framework do we expect this org to have" or a
--   human/process rollout-communication workflow -- CIS is simply evaluated for every
--   Enterprise org with a connected AWS account. Introducing those two columns/tables
--   now, with no consumer, would be exactly the "unnecessary table" this phase is meant
--   to avoid; add them in the phase that actually needs per-org DESIRED/ROLLOUT
--   customization.
--
--   Both tables are created here (not database/migrations-admin/) because they are
--   brand-new tables created by this migration's own run -- devcontrol (the role that
--   runs database/migrate.js) owns whatever it creates, unlike account_security_findings
--   and other postgres-owned legacy tables that predate the devcontrol/postgres split.
--   RLS is therefore enabled in the same migration, matching every other new org-scoped
--   table's convention (e.g. slo_definitions, custom_anomaly_rules) -- not deferred to
--   an admin migration.
-- Date: 2026-09-14

CREATE TABLE organization_security_hub_state (
  organization_id UUID PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,

  capability_status VARCHAR(20) NOT NULL CHECK (capability_status IN ('NOT_GRANTED', 'NOT_AVAILABLE', 'ENABLED', 'ERROR')),
  capability_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  capability_error TEXT,

  -- Raw discovery result from GetEnabledStandards + DescribeStandards, e.g.:
  -- [{"standardsArn": "...", "standardsSubscriptionArn": "...", "name": "CIS AWS Foundations Benchmark v5.0.0", "enabled": true}]
  enabled_standards JSONB NOT NULL DEFAULT '[]'::jsonb,

  last_sync_status VARCHAR(20) NOT NULL DEFAULT 'NEVER_RUN' CHECK (last_sync_status IN ('NEVER_RUN', 'RUNNING', 'COMPLETED', 'PARTIAL', 'FAILED')),
  last_sync_started_at TIMESTAMPTZ,
  last_sync_completed_at TIMESTAMPTZ,
  last_sync_error TEXT,
  last_sync_pages_processed INTEGER,
  last_sync_findings_count INTEGER,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE organization_security_hub_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY organization_security_hub_state_isolation_policy ON organization_security_hub_state
  FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));

CREATE POLICY organization_security_hub_state_insert_policy ON organization_security_hub_state
  FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

GRANT ALL ON TABLE organization_security_hub_state TO devcontrol;


CREATE TABLE security_hub_findings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- AWS Security Hub's own globally-stable identity -- NOT a DevControl-computed hash.
  finding_id TEXT NOT NULL,
  product_arn TEXT NOT NULL,

  title TEXT NOT NULL,
  severity VARCHAR(15) NOT NULL CHECK (severity IN ('critical', 'high', 'medium', 'low', 'informational')),
  compliance_status VARCHAR(20) CHECK (compliance_status IN ('PASSED', 'WARNING', 'FAILED', 'NOT_AVAILABLE')),
  -- AWS's own resolution signal -- authoritative. This table never derives resolution
  -- from a finding's absence in a sync; see migration header.
  record_state VARCHAR(10) NOT NULL DEFAULT 'ACTIVE' CHECK (record_state IN ('ACTIVE', 'ARCHIVED')),
  workflow_status VARCHAR(20) CHECK (workflow_status IN ('NEW', 'NOTIFIED', 'RESOLVED', 'SUPPRESSED')),

  security_control_id VARCHAR(64),
  associated_standard_ids JSONB NOT NULL DEFAULT '[]'::jsonb,

  region VARCHAR(32),
  resource_type TEXT,
  resource_id TEXT,

  security_hub_created_at TIMESTAMPTZ NOT NULL,
  security_hub_updated_at TIMESTAMPTZ NOT NULL,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT security_hub_findings_org_finding_key UNIQUE (organization_id, finding_id)
);

CREATE INDEX idx_security_hub_findings_org_control ON security_hub_findings(organization_id, security_control_id);
CREATE INDEX idx_security_hub_findings_org_last_seen ON security_hub_findings(organization_id, last_seen_at);

ALTER TABLE security_hub_findings ENABLE ROW LEVEL SECURITY;

CREATE POLICY security_hub_findings_isolation_policy ON security_hub_findings
  FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));

CREATE POLICY security_hub_findings_insert_policy ON security_hub_findings
  FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

GRANT ALL ON TABLE security_hub_findings TO devcontrol;

COMMENT ON TABLE organization_security_hub_state IS
  'Per-org Security Hub capability (ACTUAL CAPABILITY fact) + enabled-standards discovery + manual-sync bookkeeping. See backend/src/services/security-hub-sync.service.ts. DESIRED/ROLLOUT facts are not yet persisted -- no v1 consumer; see migration header.';
COMMENT ON TABLE security_hub_findings IS
  'Normalized Security Hub evidence (SecurityHubFindingEvidence), NOT raw AwsSecurityFinding payloads -- no Resources[].Details, ProductFields, or raw remediation text is stored. Pure upsert-only ingestion; a finding is never locally marked resolved based on absence from a sync (see migration header) -- record_state/workflow_status/last_seen_at are the only resolution/freshness signals.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202609141500 completed successfully!';
  RAISE NOTICE 'organization_security_hub_state and security_hub_findings created with RLS enabled and both policies';
END $$;
