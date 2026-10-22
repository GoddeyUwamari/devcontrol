/**
 * POST /api/organizations/:id/aws-credentials is retired: every role in the
 * organization gets 410, nothing is stored, and no connection event is
 * recorded. A caller outside the organization still gets the org check's 404.
 * GET reports whether legacy credentials are stored without decrypting them;
 * DELETE still clears them.
 *
 * Real route, real authenticate middleware and real DB -- only the JWT
 * verification boundary (authService.verifyToken) is stubbed.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import organizationsRoutes from '../organizations.routes';
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

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Legacy AWS Org ${suffix}`, `legacy-aws-org-${suffix}`, `Legacy AWS Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertMember(orgId: string, role: Role): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Legacy AWS User') RETURNING id`,
    [`legacy-aws-${suffix}@example.com`]
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

/** Authenticates the next requests as `userId` in `orgId`; the role comes from the membership row. */
function stubAuth(userId: string, orgId: string): void {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'legacy-aws@example.com',
    organizationId: orgId,
    role: 'owner',
    type: 'access',
  } as any);
}

async function orgRow(orgId: string) {
  const { rows } = await pool.query(
    `SELECT aws_credentials_encrypted, aws_region_default, updated_at FROM organizations WHERE id = $1`,
    [orgId]
  );
  return rows[0] as { aws_credentials_encrypted: string | null; aws_region_default: string | null; updated_at: Date };
}

async function connectionEvents(orgId: string) {
  const { rows } = await pool.query(
    `SELECT id FROM analytics_events WHERE organization_id = $1 AND event_name = 'aws_connection_completed'`,
    [orgId]
  );
  return rows;
}

async function onboardingAwsConnectedAt(orgId: string) {
  const { rows } = await pool.query(
    `SELECT aws_connected_at FROM onboarding_progress WHERE organization_id = $1`,
    [orgId]
  );
  return rows[0]?.aws_connected_at ?? null;
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/organizations', organizationsRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/organizations`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const submitted = {
  accessKeyId: 'AKIARETIREDTESTKEY01',
  secretAccessKey: 'retired-endpoint-secret-sentinel',
  region: 'eu-west-1',
};

function postCredentials(orgId: string, body: string | undefined = JSON.stringify(submitted), auth = true) {
  return fetch(`${baseUrl}/${orgId}/aws-credentials`, {
    method: 'POST',
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(auth ? { Authorization: 'Bearer test-token' } : {}),
    },
    body,
  });
}

/** A stored value that is not valid ciphertext: reading it must never try to decrypt it. */
const UNDECRYPTABLE = 'legacy-fixture-not-ciphertext';

async function storeLegacyValue(orgId: string): Promise<void> {
  await pool.query(
    `UPDATE organizations SET aws_credentials_encrypted = $1, aws_region_default = 'ap-south-1' WHERE id = $2`,
    [UNDECRYPTABLE, orgId]
  );
}

describe('POST /api/organizations/:id/aws-credentials -- retired', () => {
  it('owner: 410, nothing stored, the submitted keys are not echoed', async () => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, 'owner'), orgId);
    const before = await orgRow(orgId);

    const response = await postCredentials(orgId);
    const text = await response.text();

    expect(response.status).toBe(410);
    expect(JSON.parse(text)).toMatchObject({ success: false });
    expect(text).not.toContain(submitted.accessKeyId);
    expect(text).not.toContain(submitted.secretAccessKey);
    expect(await orgRow(orgId)).toEqual(before);
    expect(before.aws_credentials_encrypted).toBeNull();
  });

  it('an existing stored value is left exactly as it was', async () => {
    const orgId = await insertOrg();
    await storeLegacyValue(orgId);
    stubAuth(await insertMember(orgId, 'owner'), orgId);
    const before = await orgRow(orgId);

    const response = await postCredentials(orgId);

    expect(response.status).toBe(410);
    expect(await orgRow(orgId)).toEqual(before);
    expect(before.aws_credentials_encrypted).toBe(UNDECRYPTABLE);
  });

  it('records no connection event and does not mark the onboarding step', async () => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, 'owner'), orgId);

    expect((await postCredentials(orgId)).status).toBe(410);
    // Give any fire-and-forget listener time to land before asserting absence.
    await new Promise((resolve) => setTimeout(resolve, 200));

    expect(await connectionEvents(orgId)).toHaveLength(0);
    expect(await onboardingAwsConnectedAt(orgId)).toBeNull();
  });

  it.each(['admin', 'member', 'viewer'] as const)('%s: 410 and nothing stored', async (role) => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, role), orgId);
    const before = await orgRow(orgId);

    const response = await postCredentials(orgId);

    expect(response.status).toBe(410);
    expect(await orgRow(orgId)).toEqual(before);
  });

  it('a caller from another organization gets 404, and neither organization changes', async () => {
    const callerOrg = await insertOrg();
    const targetOrg = await insertOrg();
    stubAuth(await insertMember(callerOrg, 'owner'), callerOrg);
    const callerBefore = await orgRow(callerOrg);
    const targetBefore = await orgRow(targetOrg);

    const response = await postCredentials(targetOrg);

    expect(response.status).toBe(404);
    expect(await orgRow(callerOrg)).toEqual(callerBefore);
    expect(await orgRow(targetOrg)).toEqual(targetBefore);
  });

  it('unauthenticated: 401', async () => {
    const orgId = await insertOrg();
    expect((await postCredentials(orgId, JSON.stringify(submitted), false)).status).toBe(401);
  });

  it('no body: still 410', async () => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, 'owner'), orgId);
    expect((await postCredentials(orgId, undefined)).status).toBe(410);
  });
});

describe('GET /api/organizations/:id/aws-credentials -- presence only', () => {
  it('reports a stored value without decrypting it', async () => {
    const orgId = await insertOrg();
    await storeLegacyValue(orgId);
    stubAuth(await insertMember(orgId, 'admin'), orgId);

    const response = await fetch(`${baseUrl}/${orgId}/aws-credentials`, {
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      success: true,
      data: { hasCredentials: true, region: 'ap-south-1' },
    });
  });

  it('reports none when nothing is stored', async () => {
    const orgId = await insertOrg();
    stubAuth(await insertMember(orgId, 'admin'), orgId);

    const response = await fetch(`${baseUrl}/${orgId}/aws-credentials`, {
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ success: true, data: { hasCredentials: false, region: null } });
  });
});

describe('DELETE /api/organizations/:id/aws-credentials -- still available', () => {
  it('the owner can clear a stored value', async () => {
    const orgId = await insertOrg();
    await storeLegacyValue(orgId);
    stubAuth(await insertMember(orgId, 'owner'), orgId);

    const response = await fetch(`${baseUrl}/${orgId}/aws-credentials`, {
      method: 'DELETE',
      headers: { Authorization: 'Bearer test-token' },
    });

    expect(response.status).toBe(200);
    expect((await orgRow(orgId)).aws_credentials_encrypted).toBeNull();
  });
});
