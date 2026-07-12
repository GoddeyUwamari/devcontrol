-- Migration: 024_drop_security_scores.sql
-- Description: Drop the orphaned security_scores table. Confirmed dead this session:
--   0 rows, no INSERT anywhere in the codebase, and computeSecurityScore() has been
--   repointed to risk_score_history, which is the real source of truth for security
--   scoring going forward.
-- Date: 2026-07-12

DROP TABLE IF EXISTS security_scores;

DO $$
BEGIN
  RAISE NOTICE 'Migration 024 completed successfully!';
  RAISE NOTICE 'security_scores table dropped (or was already absent)';
END $$;
