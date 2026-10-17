-- LOCAL STACK ONLY -- RECONSTRUCTION, NOT A MIGRATION.
--
-- Tables the application queries that no migration in database/ creates
-- (they exist in production from before the migration history). The shapes
-- below are reconstructed from the application's queries and the test
-- fixtures in backend/src/routes/__tests__/shared-fixture-tables.ts; they are
-- not production's DDL and must never be copied into database/.
--
-- Only tables that logging in and loading an empty organization's dashboard
-- actually need are listed, each with the error that required it. Applied
-- by dev/local/bootstrap.js as postgres; idempotent.

-- aws_accounts -- required by GET /api/onboarding/status and
-- GET /api/aws/accounts on the dashboard; without it both return 500 with
-- `relation "aws_accounts" does not exist`. Same shape as the aws_accounts
-- test fixture (shared-fixture-tables.ts), reconstructed from aws.routes.ts
-- and backend/migrations/019 + 020. Stays empty: the organization has no
-- AWS connection.
CREATE TABLE IF NOT EXISTS aws_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  org_id UUID NOT NULL,
  role_arn TEXT NOT NULL,
  account_id VARCHAR(32) NOT NULL,
  nickname VARCHAR(255),
  external_id VARCHAR(64),
  region VARCHAR(32) DEFAULT 'us-east-1',
  connected_at TIMESTAMPTZ,
  status VARCHAR(32),
  CONSTRAINT aws_accounts_org_id_key UNIQUE (org_id),
  CONSTRAINT aws_accounts_account_id_key UNIQUE (account_id)
);
