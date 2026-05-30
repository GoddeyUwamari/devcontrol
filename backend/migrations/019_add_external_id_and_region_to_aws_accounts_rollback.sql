-- Rollback: Remove external_id and region from aws_accounts table
-- Paired with: 019_add_external_id_and_region_to_aws_accounts.sql

-- DOWN
ALTER TABLE aws_accounts
  DROP COLUMN IF EXISTS external_id,
  DROP COLUMN IF EXISTS region;
