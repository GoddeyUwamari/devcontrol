/**
 * GET /api/aws/accounts returns external_id to the organization's owner only,
 * decided on the server from the caller's CURRENT membership (the same check
 * requireCurrentOwner uses). For every other role the field is absent, not
 * null, and its value appears nowhere in the response. A caller from another
 * organization never sees this organization's account.
 *
 * Real route over an in-process HTTP server against live Postgres. Only
 * authService.verifyToken (to choose the caller and JWT claims) is stubbed.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import awsRoutes from '../aws.routes';
import { authService } from '../../services/auth.service';

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

type Role = 'owner' | 'admin' | 'member' | 'viewer';

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function uniqueAccountId(): string {
  return String(100000000000 + Math.floor(Math.random() * 899999999999));
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`ExtId Org ${suffix}`, `extid-org-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function member(orgId: string, role: Role): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'ExtId User') RETURNING id`,
    [`extid-${role}-${uniqueSuffix()}@example.com`]
  );
  const userId = rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, userId, role]
  );
  return userId;
}

/** A connected organization with one user per role and a stored external ID. */
async function connectedOrg() {
  const orgId = await insertOrg();
  const accountId = uniqueAccountId();
  const externalId = `ext-owner-only-${uniqueSuffix()}`;
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, nickname, external_id, region, connected_at, status)
     VALUES ($1, $2, $3, 'prod', $4, 'us-east-1', NOW(), 'active')`,
    [orgId, `arn:aws:iam::${accountId}:role/DevControlRole`, accountId, externalId]
  );
  return {
    orgId,
    accountId,
    externalId,
    owner: await member(orgId, 'owner'),
    admin: await member(orgId, 'admin'),
    member: await member(orgId, 'member'),
    viewer: await member(orgId, 'viewer'),
  };
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  const app = express();
  app.use(express.json());
  app.use('/api/aws', awsRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
});

/**
 * Lists accounts as `userId` in `orgId`. The JWT role claim defaults to
 * 'owner' so every test proves the decision comes from current membership.
 */
async function listAs(userId: string, orgId: string, jwtRole = 'owner') {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'extid-caller@example.com',
    organizationId: orgId,
    role: jwtRole,
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  const res = await fetch(`${baseUrl}/aws/accounts`, { headers: { Authorization: 'Bearer test-token' } });
  const text = await res.text();
  return { status: res.status, text, body: JSON.parse(text) as { success: boolean; data: Record<string, unknown>[] } };
}

describe('GET /api/aws/accounts -- external_id for the owner only', () => {
  it('the owner gets the stored external_id', async () => {
    const org = await connectedOrg();

    const { status, body } = await listAs(org.owner, org.orgId);

    expect(status).toBe(200);
    expect(body.data).toHaveLength(1);
    expect(body.data[0]).toMatchObject({ account_id: org.accountId, external_id: org.externalId });
  });

  it.each(['admin', 'member', 'viewer'] as const)(
    '%s: the account is listed, external_id is absent and its value appears nowhere',
    async (role) => {
      const org = await connectedOrg();

      const { status, text, body } = await listAs(org[role], org.orgId);

      expect(status).toBe(200);
      expect(body.data).toHaveLength(1);
      expect(body.data[0]).toMatchObject({ account_id: org.accountId, status: 'active' });
      expect(body.data[0]).not.toHaveProperty('external_id');
      expect(text).not.toContain(org.externalId);
    }
  );

  it('a token claiming owner while the membership is member: field absent', async () => {
    const org = await connectedOrg();

    const { text, body } = await listAs(org.member, org.orgId, 'owner');

    expect(body.data[0]).not.toHaveProperty('external_id');
    expect(text).not.toContain(org.externalId);
  });

  it("the owner of another organization never sees this organization's account", async () => {
    const org = await connectedOrg();
    const otherOrg = await insertOrg();
    const otherOwner = await member(otherOrg, 'owner');

    const own = await listAs(otherOwner, otherOrg);
    expect(own.status).toBe(200);
    expect(own.body.data).toEqual([]);
    expect(own.text).not.toContain(org.externalId);

    // Claiming this organization in the token without a membership in it.
    const claimed = await listAs(otherOwner, org.orgId);
    expect(claimed.status).toBe(401);
    expect(claimed.text).not.toContain(org.externalId);
    expect(claimed.text).not.toContain(org.accountId);
  });
});
