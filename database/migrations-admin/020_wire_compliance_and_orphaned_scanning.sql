-- Migration: 020_wire_compliance_and_orphaned_scanning.sql
-- Description: Persist real ComplianceScannerService + OrphanedResourceDetectorService
--   results so getStats() can report a genuine scan instead of the P0 stub.
-- Date: 2026-07-04

-- Orphaned-resource detection results, set by OrphanedResourceDetectorService during
-- discovery (backend/src/services/awsResourceDiscovery.ts::discoverAllResources).
ALTER TABLE aws_resources
  ADD COLUMN IF NOT EXISTS is_orphaned BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS orphaned_monthly_savings DECIMAL(10,2) DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_aws_resources_orphaned
  ON aws_resources(organization_id, is_orphaned);

COMMENT ON COLUMN aws_resources.is_orphaned IS
  'Set by OrphanedResourceDetectorService during discovery — true if the resource is stopped/unused and safe to reclaim';
COMMENT ON COLUMN aws_resources.orphaned_monthly_savings IS
  'Estimated monthly savings if this orphaned resource were removed';

-- Tracks whether a discovery job actually ran compliance + orphaned scanning to
-- completion (vs. only resource discovery). This is the signal
-- awsResources.repository.ts::getStats() reads for scan_completed, which flips
-- RiskScore.isPreliminary to false once a genuine scan has run.
ALTER TABLE resource_discovery_jobs
  ADD COLUMN IF NOT EXISTS compliance_scan_completed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN resource_discovery_jobs.compliance_scan_completed IS
  'True only if ComplianceScannerService + OrphanedResourceDetectorService both completed without error during this job';

DO $$
BEGIN
  RAISE NOTICE 'Migration 020 completed successfully!';
  RAISE NOTICE 'Added aws_resources.is_orphaned, aws_resources.orphaned_monthly_savings';
  RAISE NOTICE 'Added resource_discovery_jobs.compliance_scan_completed';
END $$;
