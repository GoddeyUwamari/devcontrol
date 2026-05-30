-- Migration: Add org_id to aws_accounts (idempotent) and create aws_connect_sessions
-- Date: 2026-05-29
-- Description: Adds org_id if missing (no-op on production where it already exists),
--              and creates the session table used by the connect-init flow.

-- Add org_id to aws_accounts if the column is not already present.
-- Production already has this column; the IF NOT EXISTS guard makes this safe to re-run.
ALTER TABLE aws_accounts ADD COLUMN IF NOT EXISTS org_id UUID;

-- Add unique constraint on org_id if not already present.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'aws_accounts_org_id_key'
      AND conrelid = 'aws_accounts'::regclass
  ) THEN
    ALTER TABLE aws_accounts ADD CONSTRAINT aws_accounts_org_id_key UNIQUE (org_id);
  END IF;
END $$;

-- Stores a pending external_id per org during the connect flow.
-- Keyed by org_id so a page refresh simply replaces the entry.
-- Rows expire after 1 hour; cleaned up on successful connect.
CREATE TABLE IF NOT EXISTS aws_connect_sessions (
  org_id      UUID        PRIMARY KEY,
  external_id VARCHAR(64) NOT NULL,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour'
);

-- ROLLBACK
-- DROP TABLE IF EXISTS aws_connect_sessions;
-- (org_id column and constraint are left in place — removing them on production
--  would be destructive and is handled separately if ever needed.)
