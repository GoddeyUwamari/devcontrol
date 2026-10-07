import { Pool } from 'pg';

/**
 * Tables the backend suites need that the canonical migrations CI bootstraps
 * do not create, and that more than one suite uses.
 *
 * Suites run in parallel workers against one database, so a table shared
 * between suites cannot belong to any one of them: a suite that dropped the
 * table on its way out would take it from another suite still running. Each
 * suite therefore calls ensureSharedFixtureTable() for what it needs, and no
 * suite drops these tables. Suites still delete their own rows.
 */
const SHARED_FIXTURE_TABLES = {
  // The columns api-keys.routes.ts reads and writes, plus 026's organization_id.
  api_keys: `
    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      key_hash TEXT NOT NULL,
      prefix VARCHAR(20) NOT NULL,
      scopes TEXT[] NOT NULL DEFAULT '{}',
      status VARCHAR(20) NOT NULL DEFAULT 'active',
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE
    )`,
  sso_configurations: `
    CREATE TABLE IF NOT EXISTS sso_configurations (
      id                UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id   UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      provider_name     VARCHAR(100) NOT NULL DEFAULT 'SAML IdP',
      idp_entity_id     TEXT NOT NULL,
      idp_sso_url       TEXT NOT NULL,
      idp_certificate   TEXT NOT NULL,
      sp_entity_id      TEXT NOT NULL,
      attribute_mapping JSONB NOT NULL DEFAULT '{"email":"email","name":"displayName"}',
      allowed_domains   JSONB NOT NULL DEFAULT '[]',
      is_active         BOOLEAN NOT NULL DEFAULT false,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at        TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (organization_id)
    )`,
  // Defined only in backend/migrations/ (019/020), which CI does not bootstrap.
  // Reconstructed from what aws.routes.ts reads and writes, plus 019's
  // external_id/region columns and 020's aws_accounts_org_id_key. The
  // account_id UNIQUE constraint carries the name observed on a real local
  // table. No FK to organizations: none of 019, 020, or the route shows one.
  aws_accounts: `
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
    )`,
  // Verbatim from backend/migrations/020_add_org_id_and_connect_sessions.sql.
  aws_connect_sessions: `
    CREATE TABLE IF NOT EXISTS aws_connect_sessions (
      org_id      UUID        PRIMARY KEY,
      external_id VARCHAR(64) NOT NULL,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour'
    )`,
  // Verbatim from backend/migrations/013_create_remediation_tables.sql, which
  // CI does not bootstrap. Create remediation_workflows before its audit log.
  remediation_workflows: `
    CREATE TABLE IF NOT EXISTS remediation_workflows (
      id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id       UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      recommendation_id     UUID,
      resource_id           VARCHAR(255) NOT NULL,
      resource_type         VARCHAR(50)  NOT NULL,
      action_type           VARCHAR(50)  NOT NULL CHECK (action_type IN (
                              'stop_instance',
                              'rightsize_instance',
                              'delete_snapshot',
                              'delete_unattached_volume',
                              'enable_s3_lifecycle',
                              'downgrade_rds_instance',
                              'delete_unused_elasticip'
                            )),
      action_params         JSONB        NOT NULL DEFAULT '{}',
      estimated_savings     NUMERIC(10,2) NOT NULL DEFAULT 0,
      risk_level            VARCHAR(10)  NOT NULL CHECK (risk_level IN ('low','medium','high')),
      status                VARCHAR(20)  NOT NULL DEFAULT 'pending_approval'
                              CHECK (status IN (
                                'pending_approval','approved','rejected',
                                'executing','completed','failed','rolled_back'
                              )),
      approved_by           UUID REFERENCES users(id),
      approved_at           TIMESTAMPTZ,
      rejected_at           TIMESTAMPTZ,
      rejection_reason      TEXT,
      executed_by           UUID REFERENCES users(id),
      executed_at           TIMESTAMPTZ,
      completed_at          TIMESTAMPTZ,
      execution_log         TEXT,
      rollback_available    BOOLEAN NOT NULL DEFAULT false,
      rollback_snapshot_id  VARCHAR(255),
      created_at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at            TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
  remediation_audit_log: `
    CREATE TABLE IF NOT EXISTS remediation_audit_log (
      id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      workflow_id  UUID NOT NULL REFERENCES remediation_workflows(id) ON DELETE CASCADE,
      old_status   VARCHAR(20),
      new_status   VARCHAR(20) NOT NULL,
      changed_by   UUID REFERENCES users(id),
      changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      ip_address   VARCHAR(45),
      note         TEXT
    )`,
  // Verbatim from backend/migrations/015_create_tenants.sql, which CI does not
  // bootstrap (indexes omitted).
  tenants: `
    CREATE TABLE IF NOT EXISTS tenants (
      id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id  UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      name             VARCHAR(255) NOT NULL,
      email            VARCHAR(255) NOT NULL,
      status           VARCHAR(50)  NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
      plan             VARCHAR(50)  NOT NULL DEFAULT 'free'   CHECK (plan IN ('free', 'starter', 'pro', 'enterprise')),
      aws_resource_count INTEGER DEFAULT 0,
      monthly_cost     NUMERIC(12, 2) DEFAULT 0.00,
      created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`,
} as const;

export type SharedFixtureTable = keyof typeof SHARED_FIXTURE_TABLES;

/**
 * Creates the table if it is missing. Safe to call from several suites at
 * once: the advisory lock makes concurrent callers take turns, since
 * CREATE TABLE IF NOT EXISTS alone can still fail when two sessions race.
 */
export async function ensureSharedFixtureTable(pool: Pool, table: SharedFixtureTable): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`shared-fixture-table:${table}`]);
    await client.query(SHARED_FIXTURE_TABLES[table]);
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
