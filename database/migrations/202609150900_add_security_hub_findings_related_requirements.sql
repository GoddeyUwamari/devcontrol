-- Migration: 202609150900_add_security_hub_findings_related_requirements.sql
-- Description: Additive-only column for the PCI DSS v4.0.1 Compliance Readiness
--   implementation (backend/src/config/securityHubPciMapping.ts,
--   backend/src/services/security-hub-compliance.service.ts's evaluatePci()).
--
--   security_hub_findings did not previously capture AWS Security Hub's
--   Compliance.RelatedRequirements field (e.g. "PCI DSS v4.0.1/1.3.1",
--   "NIST.800-53.r5 SC-7"). This column preserves that raw AWS-provided string array
--   verbatim, for exactly one purpose: supporting provenance/drift-detection evidence
--   that a human reviewer (or a future automated check) can compare against the static,
--   version-pinned mapping configs (securityHubCisMapping.ts, securityHubPciMapping.ts)
--   to notice if AWS's own documented control-to-requirement relationships have
--   changed. It is explicitly NOT the source of truth for framework mapping -- the
--   static TS config files remain authoritative and are never parsed from this column
--   at evaluation time (see PCI readiness audit and securityHubPciMapping.ts's own
--   docblock for why: AWS's free-text requirement strings are a presentation value, not
--   a contractually stable API contract, so building live control-flow logic against
--   their exact text would be fragile).
--
--   Additive only: NOT NULL with a DEFAULT, so every existing row (all currently
--   CIS-sourced, ingested before this column existed) becomes '[]'::jsonb with zero
--   backfill needed -- their evaluation behavior is completely unchanged. This table is
--   devcontrol-owned (created by 202609141500_create_security_hub_foundation_tables.sql
--   in the standard, non-admin migration path), so this ALTER also belongs in
--   database/migrations/, not database/migrations-admin/ -- consistent with that
--   migration's own ownership reasoning.
--
--   Not tenant-editable: this column is only ever written by
--   SecurityHubFindingsRepository.upsertFindings() during a sync, from normalized AWS
--   finding data -- no API route accepts or writes to it directly. RLS on
--   security_hub_findings (isolation + insert policy pair, already enabled by the prior
--   migration) is untouched by this ALTER and continues to apply to this column like
--   every other column on the table.
--
--   account_security_findings is not referenced by, and is not affected by, this
--   migration in any way.
-- Date: 2026-09-15

ALTER TABLE security_hub_findings
  ADD COLUMN related_requirements JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN security_hub_findings.related_requirements IS
  'Raw AWS Security Hub Compliance.RelatedRequirements strings (e.g. "PCI DSS v4.0.1/1.3.1"), verbatim. Supporting provenance/drift-detection evidence only -- the static, version-pinned mapping configs (securityHubCisMapping.ts, securityHubPciMapping.ts) remain authoritative for framework mapping. Never written except by SecurityHubFindingsRepository.upsertFindings() during a sync.';

DO $$
BEGIN
  RAISE NOTICE 'Migration 202609150900 completed successfully!';
  RAISE NOTICE 'security_hub_findings.related_requirements added (JSONB NOT NULL DEFAULT [])';
END $$;
