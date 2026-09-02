/**
 * Focused coverage for the aws_connection_completed funnel event added to
 * POST /api/aws/accounts. Exercises the real route (real authenticate
 * middleware, real RLS-context wiring, real aws_accounts INSERT) over an
 * actual in-process HTTP server -- only the JWT verification boundary
 * (authService.verifyToken) and the AWS-external boundaries (STS, the
 * background resource-discovery kickoff) are stubbed.
 *
 * aws_accounts and aws_connect_sessions are both defined only in
 * backend/migrations/ (019/020), a directory this project's own forensic
 * audit (database/migrations/README.md) established as non-canonical --
 * .github/scripts/ci-bootstrap-schema.js deliberately sources only
 * database/migrations/ and database/migrations-admin/, and ci.yml
 * separately refuses any deploy artifact containing backend/migrations/ at
 * all. Local dev databases typically already have both tables (applied
 * out-of-band at some point, per that same README), but a from-scratch CI
 * database does not. ensureFixtureSchema() below creates only whichever of
 * the two is actually missing, reconstructed solely from what the route
 * itself reads/writes (aws.routes.ts) plus the exact DDL in 020's own
 * migration file for aws_connect_sessions -- and drops only what it
 * created, so a local run that already has these tables is untouched.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import awsRoutes from '../aws.routes';
import { authService } from '../../services/auth.service';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';

jest.mock('@aws-sdk/client-sts', () => ({
  STSClient: jest.fn().mockImplementation(() => ({
    send: jest.fn().mockResolvedValue({}),
  })),
  AssumeRoleCommand: jest.fn().mockImplementation((input: unknown) => input),
}));

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

/** aws_accounts.account_id has its own UNIQUE constraint -- every test/call needs a fresh one. */
function uniqueAccountId(): string {
  return String(100000000000 + Math.floor(Math.random() * 899999999999));
}

// Tracks exactly which fixture tables this test created, so teardown only
// drops what it added -- never a table a local dev database already had.
const fixtureTablesCreated: string[] = [];

async function tableExists(tableName: string): Promise<boolean> {
  const { rows } = await pool.query('SELECT to_regclass($1) AS reg', [`public.${tableName}`]);
  return rows[0].reg !== null;
}

async function ensureFixtureSchema(): Promise<void> {
  if (!(await tableExists('aws_accounts'))) {
    // Reconstructed from what aws.routes.ts itself reads/writes: the INSERT
    // (org_id, role_arn, account_id, nickname, external_id, region,
    // connected_at, status) and RETURNING/SELECT column lists, plus the two
    // canonically-documented column additions (019: external_id VARCHAR(64),
    // region VARCHAR(32) DEFAULT 'us-east-1') and the org_id UNIQUE
    // constraint 020 adds under the exact name aws_accounts_org_id_key. The
    // account_id UNIQUE constraint is included under its real observed name
    // (aws_accounts_account_id_key) -- hit empirically as a live Postgres
    // constraint violation against a real local aws_accounts table while
    // building this suite. No FK to organizations is declared here: none of
    // the available evidence (019, 020, or the route's own queries) shows
    // one, so none is invented.
    await pool.query(`
      CREATE TABLE aws_accounts (
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
      )
    `);
    fixtureTablesCreated.push('aws_accounts');
  }

  if (!(await tableExists('aws_connect_sessions'))) {
    // Verbatim from backend/migrations/020_add_org_id_and_connect_sessions.sql.
    await pool.query(`
      CREATE TABLE aws_connect_sessions (
        org_id      UUID        PRIMARY KEY,
        external_id VARCHAR(64) NOT NULL,
        created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        expires_at  TIMESTAMPTZ NOT NULL DEFAULT NOW() + INTERVAL '1 hour'
      )
    `);
    fixtureTablesCreated.push('aws_connect_sessions');
  }
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`AWS Funnel Org ${suffix}`, `aws-funnel-org-${suffix}`, `AWS Funnel Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'AWS Funnel User') RETURNING id`,
    [`aws-funnel-${suffix}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertConnectSession(orgId: string): Promise<void> {
  await pool.query(
    `INSERT INTO aws_connect_sessions (org_id, external_id, created_at, expires_at)
     VALUES ($1, $2, NOW(), NOW() + interval '1 hour')
     ON CONFLICT (org_id) DO UPDATE SET external_id = EXCLUDED.external_id, expires_at = EXCLUDED.expires_at`,
    [orgId, `ext-${uniqueSuffix()}`]
  );
}

async function fetchConnectedEvents(orgId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM analytics_events WHERE organization_id = $1 AND event_name = 'aws_connection_completed'`,
    [orgId]
  );
  return rows;
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  await ensureFixtureSchema();

  const app = express();
  app.use(express.json());
  app.use('/api/aws', awsRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/aws`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
  // Only drop what this suite itself created -- never a table a local dev
  // database already had before this test ran.
  for (const table of fixtureTablesCreated) {
    await pool.query(`DROP TABLE IF EXISTS ${table}`);
  }
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function stubAuth(userId: string, orgId: string) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'aws-funnel@example.com',
    organizationId: orgId,
    role: 'owner',
    type: 'access',
  } as any);
}

describe('POST /api/aws/accounts -- aws_connection_completed funnel event', () => {
  it('emits aws_connection_completed exactly once on the real STS-verified connect flow', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    stubAuth(userId, orgId);
    jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources').mockResolvedValue({
      job_id: 'stub-job',
      resources_discovered: 0,
      resources_updated: 0,
      resources_deleted: 0,
      errors: [],
    } as any);
    await insertConnectSession(orgId);

    const response = await fetch(`${baseUrl}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ roleArn: `arn:aws:iam::${uniqueAccountId()}:role/DevControlRole-${uniqueSuffix()}` }),
    });

    expect(response.status).toBe(201);
    const rows = await fetchConnectedEvents(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(userId);
    expect(rows[0].event_category).toBe('funnel');
  });

  it('a second connect attempt for an already-connected org gets 409 and does NOT emit a second event', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    stubAuth(userId, orgId);
    jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources').mockResolvedValue({
      job_id: 'stub-job',
      resources_discovered: 0,
      resources_updated: 0,
      resources_deleted: 0,
      errors: [],
    } as any);

    await insertConnectSession(orgId);
    const first = await fetch(`${baseUrl}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ roleArn: `arn:aws:iam::${uniqueAccountId()}:role/DevControlRole-${uniqueSuffix()}` }),
    });
    expect(first.status).toBe(201);

    // A fresh connect session for the same org -- the account is already
    // connected (org_id is UNIQUE on aws_accounts), so this must be
    // rejected by the ON CONFLICT DO NOTHING branch, not the missing-session
    // check, to actually exercise the dedup path under test.
    await insertConnectSession(orgId);
    const second = await fetch(`${baseUrl}/accounts`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
      body: JSON.stringify({ roleArn: `arn:aws:iam::${uniqueAccountId()}:role/DevControlRole-${uniqueSuffix()}` }),
    });
    expect(second.status).toBe(409);

    const rows = await fetchConnectedEvents(orgId);
    expect(rows).toHaveLength(1);
  });
});
