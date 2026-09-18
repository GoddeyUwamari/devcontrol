-- Migration: 202609180900_create_soc2_evidence_tables.sql
-- Description: SOC 2 Readiness Evidence Layer -- Phase 1 (evidence plumbing only).
--   Creates the two new tables backing SOC 2 Readiness evidence:
--   soc2_evidence_observations (technical + future self-attested evidence, current-state
--   upsert) and soc2_control_evaluations (a recomputable read-through rollup, not a
--   second source of truth).
--
--   ARCHITECTURAL GATE (answered before writing this migration, matching the discipline
--   already established in 202609141500_create_security_hub_foundation_tables.sql for
--   the equivalent Security Hub question):
--
--   Why not reuse aws_resources.compliance_issues / account_security_findings /
--   security_hub_findings? All three have lifecycle semantics specific to their own
--   domain that don't fit SOC 2 evidence:
--     - compliance_issues is a JSONB array wholesale-overwritten every discovery scan,
--       with no stable per-issue identity across scans -- unusable for "as observed on
--       [date]" claims that must survive the next scan.
--     - account_security_findings' identity/resolution model (finding_key content-hash,
--       reconcileScan's absence-implies-resolved heuristic scoped to completeCategories)
--       is specific to DevControl's own scanner having no native AWS resolution signal.
--       Critically, ComplianceIssue.provenance (added for compliance_issues) is DROPPED
--       when a finding is converted to NewAccountFinding on its way into this table --
--       confirmed by inspecting NewAccountFinding's fields, which have no provenance
--       column. A SOC 2 evidence table cannot inherit provenance from a system that
--       doesn't preserve it, so it owns provenance directly instead.
--     - security_hub_findings' identity is AWS's own (Id/ProductArn) with AWS's own
--       resolution signal (RecordState/Workflow.Status) -- not applicable to
--       DevControl's own direct-AWS-API evidence (IAM/EC2/S3/RDS/Backup) used here,
--       and SOC 2 is explicitly not implemented as a Security Hub framework in this
--       product (see backend/src/config/securityHubCisMapping.ts's own docblock).
--   Answer: NO, none of the three domains share SOC 2's lifecycle semantics -- hence
--   the dedicated tables below, not an ALTER of any existing table. Phase 1 code reads
--   aws_resources / account_security_findings as source material; it never writes to
--   them, and never writes to compliance_issues or security_hub_findings at all.
--
--   RLS SYNTAX NOTE: this migration follows the actual, consistently-used convention
--   across every existing DevControl migration (verified against
--   migrations-admin/008_create_aws_resources.sql through this repo's newest migration,
--   202609141500) -- organization_id::text = current_setting('app.current_organization_id', true)
--   -- not a current_setting(...)::uuid cast, which does not appear anywhere in this
--   repository's actual migration history.
--
--   RESOURCE IDENTITY NOTE: resource_arn is nullable (per the evidence-layer design) to
--   support a genuine org-level aggregate observation (resource_type = 'organization',
--   resource_arn NULL) for criteria whose source data has no persisted full resource
--   roster to attach a per-resource SUPPORTS claim to (see soc2-evidence.service.ts's
--   own docblock for CC6.2/CC6.3/CC7.1's specific reasoning). Because PostgreSQL never
--   considers two NULLs equal for UNIQUE-constraint purposes, a plain
--   UNIQUE(organization_id, criterion_id, resource_arn, resource_type) would silently
--   allow duplicate org-level aggregate rows for the same criterion. Identity is
--   therefore enforced via a UNIQUE INDEX on an expression that coalesces resource_arn
--   to an empty string, so two NULL-resource_arn rows for the same
--   (organization_id, criterion_id, resource_type) do collide as intended.
-- Date: 2026-09-18

CREATE TABLE soc2_evidence_observations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Plain string, not an FK to a criteria table -- criteria are versioned in code
  -- (backend/src/config/soc2CriteriaConfig.ts), the same choice already made for
  -- Security Hub's CIS/PCI/NIST control mappings (securityHubCisMapping.ts etc.).
  criterion_id TEXT NOT NULL,

  -- NULL only for the org-level aggregate case described above. Every per-resource
  -- observation must populate this (a real AWS ARN, or -- for IAM access keys, which
  -- have no AWS-assigned ARN of their own -- a stable synthetic identifier of the form
  -- '<iam user arn>#access-key#<access key id>').
  resource_arn TEXT,
  resource_type TEXT NOT NULL,

  provenance TEXT NOT NULL CHECK (provenance IN ('OBSERVED', 'DERIVED', 'SELF_ATTESTED')),
  result TEXT NOT NULL CHECK (result IN ('SUPPORTS', 'CONTRADICTS', 'UNKNOWN')),

  -- When the underlying AWS fact was true, if knowable -- Phase 1 always sets this
  -- equal to collected_at (every v1 source is a point-in-time check, not a historical
  -- record with its own distinct observed-vs-collected timestamps).
  observed_at TIMESTAMPTZ,
  -- The authoritative freshness signal -- when DevControl's discovery/scan actually
  -- produced the underlying fact this observation reads. now() - collected_at is how
  -- any future API/UI must compute freshness; no separate expires_at/freshness_status
  -- column exists by design (see soc2-evidence.service.ts's docblock).
  collected_at TIMESTAMPTZ NOT NULL,

  -- Narrow and typed per-criterion in application code (a discriminated union), not a
  -- schema-less blob -- mirrors FindingEvidence's existing narrow-versioned-evidence
  -- precedent (SecurityGroupEvidence/IamMfaEvidence/IamAccessKeyEvidence). Must never
  -- contain credentials, secrets, tokens, policy documents, or full raw AWS API
  -- responses -- only enough to say which check/field produced this fact.
  source JSONB NOT NULL,

  explanation TEXT NOT NULL,

  schema_version SMALLINT NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- See "RESOURCE IDENTITY NOTE" above -- COALESCE makes NULL resource_arn collide
-- correctly instead of PostgreSQL's default NULL-is-distinct-from-NULL behavior.
CREATE UNIQUE INDEX soc2_evidence_observations_identity_idx
  ON soc2_evidence_observations (organization_id, criterion_id, resource_type, COALESCE(resource_arn, ''));

CREATE INDEX idx_soc2_evidence_observations_org_criterion
  ON soc2_evidence_observations (organization_id, criterion_id);

ALTER TABLE soc2_evidence_observations ENABLE ROW LEVEL SECURITY;

CREATE POLICY soc2_evidence_observations_isolation_policy ON soc2_evidence_observations
  FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));

CREATE POLICY soc2_evidence_observations_insert_policy ON soc2_evidence_observations
  FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

GRANT ALL ON TABLE soc2_evidence_observations TO devcontrol;

COMMENT ON TABLE soc2_evidence_observations IS
  'SOC 2 Readiness evidence, current-state upsert (not append-only history). Read-only source material for soc2_control_evaluations. Never written to by, or read as an input by, aws_resources.compliance_issues, account_security_findings, security_hub_findings, or Risk Score calculation.';
COMMENT ON COLUMN soc2_evidence_observations.provenance IS
  'Owned directly by this table -- never inherited from ComplianceIssue.provenance, which is dropped when a finding is converted into account_security_findings.';
COMMENT ON COLUMN soc2_evidence_observations.result IS
  'Evidence-for-a-claim, not a framework pass/fail evaluation (that is soc2_control_evaluations). Deliberately not PASS/FAIL/COMPLIANT/NON_COMPLIANT/NOT_EVALUATED/NOT_ESTABLISHABLE -- those belong to Security Hub''s FoundationControlStatus vocabulary, a different axis (see security-hub-foundation.types.ts).';
COMMENT ON COLUMN soc2_evidence_observations.resource_arn IS
  'NULL only for the per-criterion org-level aggregate row used when no persisted full resource roster exists to support a per-resource SUPPORTS claim.';


CREATE TABLE soc2_control_evaluations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  criterion_id TEXT NOT NULL,

  -- Copied from soc2CriteriaConfig.ts at compute time, not looked up live, so a row
  -- reflects the disposition that was actually in effect when it was computed.
  disposition_class TEXT NOT NULL CHECK (disposition_class IN (
    'A_OBSERVABLE', 'B_DERIVABLE', 'C_SELF_ATTESTED', 'D_ADDITIONAL_EVIDENCE', 'E_NOT_ESTABLISHABLE'
  )),

  -- Compact counts only -- {"supports": n, "contradicts": n, "unknown": n} -- never a
  -- percentage, score, or pass/fail rollup. See soc2-evidence.service.ts.
  evidence_summary JSONB NOT NULL,

  -- Always '{}' in Phase 1 -- customer_evidence does not exist yet.
  customer_evidence_ids UUID[] NOT NULL DEFAULT '{}',

  computed_at TIMESTAMPTZ NOT NULL,

  UNIQUE (organization_id, criterion_id)
);

CREATE INDEX idx_soc2_control_evaluations_org
  ON soc2_control_evaluations (organization_id);

ALTER TABLE soc2_control_evaluations ENABLE ROW LEVEL SECURITY;

CREATE POLICY soc2_control_evaluations_isolation_policy ON soc2_control_evaluations
  FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));

CREATE POLICY soc2_control_evaluations_insert_policy ON soc2_control_evaluations
  FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

GRANT ALL ON TABLE soc2_control_evaluations TO devcontrol;

COMMENT ON TABLE soc2_control_evaluations IS
  'Recomputable read-through cache of soc2_evidence_observations, one row per (organization, criterion). NOT a second source of truth -- safe to truncate and recompute at any time. Never stores a percentage, score, or pass/fail certification status.';
COMMENT ON COLUMN soc2_control_evaluations.customer_evidence_ids IS
  'Always empty in Phase 1 -- customer_evidence does not exist yet. Reserved for a later phase.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202609180900 completed successfully!';
  RAISE NOTICE 'Created table: soc2_evidence_observations (RLS enabled, 2 policies)';
  RAISE NOTICE 'Created table: soc2_control_evaluations (RLS enabled, 2 policies)';
END $$;
