-- Migration: 202609181200_create_customer_evidence.sql
-- Description: SOC 2 Readiness Evidence Layer -- Phase 3 (customer-provided evidence).
--   Creates one new table, customer_evidence, holding organizational/process evidence
--   that cannot honestly be derived from AWS telemetry alone (policies, procedures,
--   training records, attestations, etc.), referenced by external link/metadata only.
--
--   ARCHITECTURAL BOUNDARY (per the Phase 3 audit): this table is a deliberately
--   separate source of truth from soc2_evidence_observations / soc2_control_evaluations
--   (202609180900_create_soc2_evidence_tables.sql). It is never written to by, and never
--   writes to, either of those tables, aws_resources.compliance_issues,
--   account_security_findings, security_hub_findings, or Risk Score. The reserved
--   soc2_control_evaluations.customer_evidence_ids column remains unused and empty --
--   wiring it up is a future combined-evaluation phase's job, not this one's.
--
--   PROVENANCE: every row is SELF_ATTESTED, enforced by a CHECK constraint pinning it
--   to exactly that one value (not the full OBSERVED/DERIVED/SELF_ATTESTED union that
--   soc2_evidence_observations.provenance permits) -- defense in depth alongside the
--   application-layer enforcement in soc2-customer-evidence.service.ts, matching this
--   repository's general "never rely on a single layer" discipline (see
--   soc2-evidence.repository.ts's own docblock).
--
--   IDENTITY: unlike soc2_evidence_observations, there is no uniqueness constraint on
--   (organization_id, criterion_id) or any other column combination -- a single
--   criterion may legitimately be supported by multiple independent evidence records
--   (a policy document, a signed procedure, a training log), and superseding evidence
--   creates a new row rather than overwriting the old one (see STATUS below).
--
--   STATUS / LIFECYCLE: SUBMITTED -> REVIEWED -> EXPIRED, and SUBMITTED/REVIEWED ->
--   SUPERSEDED. Deliberately not ACCEPTED -- see soc2-evidence.types.ts's
--   Soc2CustomerEvidenceStatus docblock for why. No hard delete in v1: expiring and
--   superseding are both status transitions, never a DELETE, so historical evidence
--   remains queryable. review_date is informational only -- nothing in this migration
--   or the application code automatically transitions status based on it.
--
--   RLS SYNTAX: follows the exact, consistently-used convention from
--   202609180900_create_soc2_evidence_tables.sql --
--   organization_id::text = current_setting('app.current_organization_id', true).
-- Date: 2026-09-18

CREATE TABLE customer_evidence (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,

  -- Plain string, not an FK -- criteria stay code-versioned in
  -- backend/src/config/soc2CriteriaConfig.ts, the same choice Phase 1 already made for
  -- soc2_evidence_observations.criterion_id.
  criterion_id TEXT NOT NULL,

  -- Small, bounded vocabulary enforced in application code
  -- (Soc2CustomerEvidenceType/SOC2_CUSTOMER_EVIDENCE_TYPES), not a DB CHECK -- kept
  -- extensible without a migration, matching criterion_id's own precedent.
  evidence_type TEXT NOT NULL,

  title TEXT NOT NULL,
  -- Free text, fully customer-controlled -- the highest privacy-risk column here. No
  -- secrets-scanning exists anywhere in this codebase (confirmed by the Phase 3 audit);
  -- length-bounded at the application layer only. Never included in audit_logs metadata.
  description TEXT,

  -- The customer's pointer to their own externally-hosted evidence. DevControl stores
  -- this string only -- it is NEVER fetched, resolved, or otherwise retrieved by any
  -- code path. See soc2-customer-evidence.service.ts's own docblock for the same
  -- guarantee stated at the application layer.
  external_reference TEXT,

  -- Pinned to exactly one value -- customer evidence can never be OBSERVED or DERIVED,
  -- which would misrepresent AWS-derived facts as self-attested (or vice versa).
  provenance TEXT NOT NULL DEFAULT 'SELF_ATTESTED' CHECK (provenance = 'SELF_ATTESTED'),

  status TEXT NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'REVIEWED', 'EXPIRED', 'SUPERSEDED')),

  -- SET NULL (not CASCADE) on user deletion, matching audit_logs.user_id's own FK
  -- behavior -- the evidence record itself must survive its submitter's account being
  -- removed; only the attribution is lost.
  submitted_by UUID REFERENCES users(id) ON DELETE SET NULL,
  submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Informational only -- no job or trigger in this codebase reads this column to
  -- automatically change status. See soc2-customer-evidence.service.ts's docblock.
  review_date TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_customer_evidence_org ON customer_evidence (organization_id);
CREATE INDEX idx_customer_evidence_org_criterion ON customer_evidence (organization_id, criterion_id);
CREATE INDEX idx_customer_evidence_org_status ON customer_evidence (organization_id, status);

ALTER TABLE customer_evidence ENABLE ROW LEVEL SECURITY;

CREATE POLICY customer_evidence_isolation_policy ON customer_evidence
  FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true));

CREATE POLICY customer_evidence_insert_policy ON customer_evidence
  FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true));

GRANT ALL ON TABLE customer_evidence TO devcontrol;

COMMENT ON TABLE customer_evidence IS
  'SOC 2 Readiness Phase 3: customer-provided (SELF_ATTESTED) supplementary evidence. A separate source of truth from soc2_evidence_observations/soc2_control_evaluations -- never written to by, or read as an input by, Phase 1/2 evidence computation, aws_resources.compliance_issues, account_security_findings, security_hub_findings, or Risk Score. No hard delete: superseding/expiring are status transitions, so historical rows remain queryable.';
COMMENT ON COLUMN customer_evidence.provenance IS
  'Always SELF_ATTESTED -- pinned by CHECK constraint. Never OBSERVED/DERIVED; those describe AWS-derived facts, not customer attestations.';
COMMENT ON COLUMN customer_evidence.status IS
  'SUBMITTED -> REVIEWED -> EXPIRED, and SUBMITTED/REVIEWED -> SUPERSEDED. Deliberately not ACCEPTED -- REVIEWED means only that an authorized DevControl platform-staff reviewer reviewed the record, never SOC 2 compliance/certification/auditor approval/operating effectiveness.';
COMMENT ON COLUMN customer_evidence.review_date IS
  'Informational only. No automated job or trigger transitions status based on this value.';
COMMENT ON COLUMN customer_evidence.external_reference IS
  'Customer-supplied pointer to externally-hosted evidence (metadata only). DevControl never fetches, resolves, or stores the referenced content.';
