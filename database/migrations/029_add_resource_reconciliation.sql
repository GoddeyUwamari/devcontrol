-- Migration: 029_add_resource_reconciliation.sql
-- Description: Phase 2B — conservative reconciliation for AWS Resource Explorer-based discovery.
-- Date: 2026-08-08

-- Tracks consecutive confirmed-absent discovery scans per resource. A resource is only marked
-- terminated after MISSING_SCAN_THRESHOLD (2, see resourceReconciliation.service.ts) consecutive
-- scans where Resource Explorer's Search call succeeded and genuinely did not return the
-- resource's ARN. A failed/errored Search (timeout, throttling, permission error, exception of
-- any kind) never touches this counter — only a successful scan that confirms absence advances
-- it, and any successful scan that finds the resource again resets it to 0.
ALTER TABLE aws_resources
  ADD COLUMN IF NOT EXISTS missing_scan_count INTEGER NOT NULL DEFAULT 0;

COMMENT ON COLUMN aws_resources.missing_scan_count IS
  'Consecutive discovery scans where AWS Resource Explorer successfully ran and did not find this resource. Reset to 0 on any scan that finds it again. Never incremented by a failed/errored scan. Resource is marked status=terminated once this reaches the conservative threshold (2).';

DO $$
BEGIN
  RAISE NOTICE 'Migration 029 completed successfully!';
  RAISE NOTICE 'Added aws_resources.missing_scan_count for conservative termination reconciliation';
END $$;
