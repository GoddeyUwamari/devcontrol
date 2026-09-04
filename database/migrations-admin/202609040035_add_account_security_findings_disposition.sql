-- Migration: 202609040035_add_account_security_findings_disposition.sql
-- Description: Security PR2 -- adds user-disposition lifecycle (acknowledged/
--   dismissed/accepted_risk) and structured evidence to account_security_findings,
--   on top of the existing system-owned active/resolved observation lifecycle.
--   Disposition is a separate axis from `status`: `status` stays system-owned
--   (only a scan flips it), while `disposition` records what a human decided to
--   do about an ACTIVE finding. See AccountSecurityFindingsRepository for the
--   read-time derived_status projection (never stored) and the reconciliation
--   rules that preserve disposition across an active rescan but reset it to
--   NULL when a previously-resolved finding recurs.
-- Date: 2026-09-04
--
-- PLACEMENT NOTE: classified into database/migrations-admin/ from the start,
-- not after a failed ordinary-path attempt. account_security_findings was
-- already confirmed postgres-owned in production by the batch ownership audit
-- documented in database/migrations-admin/README.md (it's one of the eleven
-- files in that batch, including 023_create_account_security_findings.sql
-- itself), so any ALTER TABLE against it is known in advance to fail under
-- devcontrol's ordinary-path grants with 42501: must be owner of table
-- account_security_findings -- the same reasoning already applied without a
-- fresh failed attempt to 202609010800_add_payment_failed_notification_tracking.sql.

ALTER TABLE account_security_findings
  ADD COLUMN disposition VARCHAR(20)
    CHECK (disposition IN ('acknowledged', 'dismissed', 'accepted_risk')),
  ADD COLUMN disposition_actor_id UUID REFERENCES users(id),
  ADD COLUMN disposition_at TIMESTAMPTZ,
  ADD COLUMN disposition_note TEXT,
  ADD COLUMN evidence JSONB;

COMMENT ON COLUMN account_security_findings.disposition IS
  'User-owned decision about an ACTIVE finding (acknowledged/dismissed/accepted_risk). NULL means no decision yet. Distinct from status, which stays system-owned (only a scan sets it). A resolved finding cannot be dispositioned; a finding that recurs after being resolved has this reset to NULL so the user must decide again.';
COMMENT ON COLUMN account_security_findings.disposition_actor_id IS
  'The authenticated user who made the disposition decision. Server-set from the request''s auth context, never client-supplied.';
COMMENT ON COLUMN account_security_findings.disposition_at IS
  'Server-generated timestamp of the disposition decision.';
COMMENT ON COLUMN account_security_findings.disposition_note IS
  'Required free-text justification for dismiss/accept-risk; optional for acknowledge.';
COMMENT ON COLUMN account_security_findings.evidence IS
  'Narrow, versioned (schema_version) structured evidence for the finding -- e.g. for a security-group finding: security_group_id, vpc_id, region, direction, protocol, from_port, to_port, ip_version, cidr, detected_at. Intentionally not a generic evidence framework.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202609040035 completed successfully!';
  RAISE NOTICE 'account_security_findings: added disposition, disposition_actor_id, disposition_at, disposition_note, evidence';
END $$;
