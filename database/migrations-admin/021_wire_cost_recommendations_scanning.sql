-- Migration: 021_wire_cost_recommendations_scanning.sql
-- Description: Track whether a discovery job actually ran cost-optimization analysis,
--   mirroring 020's compliance_scan_completed. Needed because computeCostScore()
--   previously derived readiness from cost_optimization_scans, a table that never
--   existed in this schema -- cost.ready could never become true.
-- Date: 2026-07-05

-- Tracks whether a discovery job ran CostOptimizationService.analyzeAllResources()
-- to completion (vs. only resource discovery / compliance / orphaned detection).
-- This is the signal system-intelligence.service.ts::computeCostScore() reads for
-- readiness, since cost_recommendations row-count alone can't distinguish
-- "never analyzed" from "analyzed, found zero opportunities".
ALTER TABLE resource_discovery_jobs
  ADD COLUMN IF NOT EXISTS cost_analysis_completed BOOLEAN NOT NULL DEFAULT false;

COMMENT ON COLUMN resource_discovery_jobs.cost_analysis_completed IS
  'True only if CostOptimizationService.analyzeAllResources() completed without error during this job';

DO $$
BEGIN
  RAISE NOTICE 'Migration 021 completed successfully!';
  RAISE NOTICE 'Added resource_discovery_jobs.cost_analysis_completed';
END $$;
