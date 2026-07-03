-- Migration 022: Surface whether cost-optimization results came from
-- Claude AI or the canned fallback generator (missing/failed API key).
ALTER TABLE cost_optimization_scans   ADD COLUMN IF NOT EXISTS is_fallback BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE cost_optimization_results ADD COLUMN IF NOT EXISTS is_fallback BOOLEAN NOT NULL DEFAULT false;
