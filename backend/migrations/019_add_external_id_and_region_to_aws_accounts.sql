-- Migration: Add external_id and region to aws_accounts table
-- Date: 2026-05-29
-- Description: Adds STS AssumeRole support columns. Both nullable for now;
--              existing rows carry no value and will be backfilled via app logic.

-- UP
ALTER TABLE aws_accounts
  ADD COLUMN IF NOT EXISTS external_id VARCHAR(64),
  ADD COLUMN IF NOT EXISTS region     VARCHAR(32) DEFAULT 'us-east-1';

-- org_id already has a UNIQUE constraint (which creates a btree index).
-- No additional index needed.
