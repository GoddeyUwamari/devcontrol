/**
 * Focused coverage for the aws_connection_completed funnel event added to
 * POST /api/organizations/:id/aws-credentials (the legacy access-key AWS
 * connection path).
 *
 * IMPORTANT: this endpoint never calls AWS to validate the supplied
 * credentials -- organizationService.setAWSCredentials() only encrypts and
 * persists them (organization.service.ts:663-677). So everything below is
 * phrased as "credential persistence" / "connection setup", never as
 * "AWS validation" -- the event fires on successful storage, not on a
 * verified AWS connection. That gap is a separate, already-flagged
 * correctness issue, not something this instrumentation change addresses.
 *
 * Exercises the real route (real authenticate middleware, real requireOwnOrg
 * /requireOwner, real encryption, real DB persistence, real onboardingEvents
 * listener) over an actual in-process HTTP server -- only the JWT
 * verification boundary (authService.verifyToken) is stubbed, matching the
 * pattern in aws-connection-funnel-event.test.ts for the primary STS flow.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import organizationsRoutes from '../../routes/organizations.routes';
import { authService } from '../../services/auth.service';
import { organizationService } from '../../services/organization.service';

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

async function insertUser(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Legacy AWS User') RETURNING id`,
    [`legacy-aws-${suffix}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function fetchConnectionCompletedEvents(orgId: string) {
  const { rows } = await pool.query(
    `SELECT * FROM analytics_events WHERE organization_id = $1 AND event_name = 'aws_connection_completed'`,
    [orgId]
  );
  return rows;
}

async function fetchOnboardingRow(orgId: string) {
  const { rows } = await pool.query(
    `SELECT aws_connected_at FROM onboarding_progress WHERE organization_id = $1`,
    [orgId]
  );
  return rows[0] as { aws_connected_at: Date | null } | undefined;
}

/**
 * onboardingEvents.emit('aws:connected', ...) is fire-and-forget (a plain
 * EventEmitter, not awaited by the controller) -- its listener's DB write
 * can land after the HTTP response is already sent. Poll instead of
 * asserting immediately after the request resolves.
 */
async function waitFor<T>(check: () => Promise<T | undefined | null>, timeoutMs = 2000): Promise<T> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const result = await check();
    if (result) return result;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('waitFor timed out');
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
    // analytics_events.organization_id is ON DELETE SET NULL, not CASCADE --
    // clean it up explicitly so it doesn't leak into unrelated test runs.
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

function stubAuth(userId: string, orgId: string) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'legacy-aws@example.com',
    organizationId: orgId,
    role: 'owner',
    type: 'access',
  } as any);
}

function postCredentials(orgId: string) {
  return fetch(`${baseUrl}/${orgId}/aws-credentials`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: 'Bearer test-token' },
    body: JSON.stringify({
      accessKeyId: `AKIA${uniqueSuffix().toUpperCase().replace(/[^A-Z0-9]/g, '').padEnd(16, 'X')}`,
      secretAccessKey: `secret-${uniqueSuffix()}`,
      region: 'us-east-1',
    }),
  });
}

describe('POST /api/organizations/:id/aws-credentials -- aws_connection_completed funnel event', () => {
  it('emits aws_connection_completed exactly once after credentials are successfully persisted', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    stubAuth(userId, orgId);

    const response = await postCredentials(orgId);

    expect(response.status).toBe(200);
    const rows = await fetchConnectionCompletedEvents(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].user_id).toBe(userId);
    expect(rows[0].event_category).toBe('funnel');
    expect(rows[0].properties).toEqual({ source: 'legacy_access_key' });
  });

  it('does NOT emit aws_connection_completed when credential persistence fails', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    stubAuth(userId, orgId);
    jest.spyOn(organizationService, 'setAWSCredentials').mockRejectedValueOnce(new Error('simulated DB failure'));

    const response = await postCredentials(orgId);

    expect(response.status).toBe(400);
    const rows = await fetchConnectionCompletedEvents(orgId);
    expect(rows).toHaveLength(0);
  });

  it('a second call for the same organization does not create a duplicate aws_connection_completed event', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    stubAuth(userId, orgId);

    const first = await postCredentials(orgId);
    expect(first.status).toBe(200);

    // The legacy endpoint has no constraint preventing repeat calls -- a
    // second save for the same org succeeds and overwrites the stored
    // credentials (pre-existing behavior, untouched by this change).
    const second = await postCredentials(orgId);
    expect(second.status).toBe(200);

    const rows = await fetchConnectionCompletedEvents(orgId);
    expect(rows).toHaveLength(1);
  });

  it('existing aws:connected onboarding behavior remains intact, and onboarding_progress.aws_connected_at is populated on first connection', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();
    stubAuth(userId, orgId);

    const response = await postCredentials(orgId);
    expect(response.status).toBe(200);

    const row = await waitFor(async () => {
      const r = await fetchOnboardingRow(orgId);
      return r?.aws_connected_at ? r : undefined;
    });
    expect(row.aws_connected_at).not.toBeNull();
  });
});
