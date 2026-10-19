/**
 * GET /api/services/registered lists the organization's rows of the services
 * table -- what POST /api/services creates and what dependencies and
 * deployments reference -- and nothing of another organization's.
 *
 *   - Response: { success, services: [{ id, name, owner, team_id, team_name,
 *     github_url, created_at }], total }, newest first.
 *   - A team is named only when it belongs to the same organization.
 *   - Any active member may read it; a service created through POST
 *     /api/services appears in it.
 *   - "registered" is not taken as a service id by GET /:id.
 *
 * Real routes over an in-process HTTP server against live Postgres, as a role
 * RLS cannot filter, so only the route's own organization predicate keeps
 * another organization's rows out. Only authService.verifyToken (to choose
 * the caller) is stubbed.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import servicesRoutes from '../services.routes';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { pool as appPool } from '../../config/database';

// Listeners issue their own fire-and-forget queries; irrelevant here.
jest.mock('../../services/onboardingEvents', () => ({ emitOnboardingEvent: jest.fn() }));

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
     VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
    [`Registered Services ${suffix}`, `registered-services-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function member(orgId: string, role: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Registered Services User') RETURNING id`,
    [`registered-services-${role}-${uniqueSuffix()}@example.com`]
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

async function insertTeam(orgId: string, name: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO teams (name, owner, organization_id) VALUES ($1, 'owner@example.com', $2) RETURNING id`,
    [name, orgId]
  );
  return rows[0].id as string;
}

async function insertService(
  orgId: string,
  name: string,
  opts: { teamId?: string | null; githubUrl?: string | null; createdAt?: string } = {}
): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id, team_id, github_url, created_at)
     VALUES ($1, 'api', 'owner@example.com', 'active', $2, $3, $4, COALESCE($5::timestamptz, NOW()))
     RETURNING id`,
    [name, orgId, opts.teamId ?? null, opts.githubUrl ?? null, opts.createdAt ?? null]
  );
  return rows[0].id as string;
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/services', servicesRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM teams WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
  await appPool.end();
});

function asCaller(userId: string, orgId: string, role: string) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'registered-services-caller@example.com',
    organizationId: orgId,
    role,
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
}

async function request(userId: string, orgId: string, role: string, method: string, path: string, body?: unknown) {
  asCaller(userId, orgId, role);
  const res = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as any };
}

describe('GET /api/services/registered', () => {
  it('lists only the organization\'s own services, newest first, with their team when it is the organization\'s', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const viewer = await member(orgA, 'viewer');
    const teamA = await insertTeam(orgA, `team-a-${uniqueSuffix()}`);
    const teamB = await insertTeam(orgB, `team-b-${uniqueSuffix()}`);
    const older = await insertService(orgA, 'reg-older', { teamId: teamA, githubUrl: 'https://github.com/example/reg-older', createdAt: '2026-01-01T00:00:00Z' });
    const newer = await insertService(orgA, 'reg-newer', { createdAt: '2026-02-01T00:00:00Z' });
    // Org A's service carrying org B's team id: the team is not named.
    const pointsAway = await insertService(orgA, 'reg-points-away', { teamId: teamB, createdAt: '2025-12-01T00:00:00Z' });
    const foreign = await insertService(orgB, 'reg-foreign', { teamId: teamB });

    const { status, body } = await request(viewer, orgA, 'viewer', 'GET', '/services/registered');

    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(body.total).toBe(3);
    expect(body.services.map((s: any) => s.id)).toEqual([newer, older, pointsAway]);
    expect(body.services[1]).toEqual({
      id: older,
      name: 'reg-older',
      owner: 'owner@example.com',
      team_id: teamA,
      team_name: expect.stringMatching(/^team-a-/),
      github_url: 'https://github.com/example/reg-older',
      created_at: '2026-01-01T00:00:00.000Z',
    });
    expect(body.services[0]).toEqual(expect.objectContaining({ team_id: null, team_name: null, github_url: null }));
    expect(body.services[2]).toEqual(expect.objectContaining({ team_id: teamB, team_name: null }));
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain(foreign);
    expect(serialized).not.toContain('reg-foreign');
    expect(serialized).not.toContain('team-b-');
  });

  it('an organization with no registered services gets an empty list, not another organization\'s', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const viewer = await member(orgA, 'viewer');
    await insertService(orgB, 'reg-only-b');

    const { status, body } = await request(viewer, orgA, 'viewer', 'GET', '/services/registered');

    expect(status).toBe(200);
    expect(body).toEqual({ success: true, services: [], total: 0 });
  });

  it('a service created through POST /api/services appears in the list', async () => {
    const orgA = await insertOrg();
    const admin = await member(orgA, 'admin');
    const team = await insertTeam(orgA, `team-create-${uniqueSuffix()}`);

    const created = await request(admin, orgA, 'admin', 'POST', '/services', {
      name: 'reg-created',
      template: 'api',
      owner: 'owner@example.com',
      team_id: team,
      github_url: 'https://github.com/example/reg-created',
      description: 'created in this test',
    });
    expect(created.status).toBe(201);
    expect(created.body.data).toEqual(expect.objectContaining({ name: 'reg-created', organization_id: orgA, team_id: team }));

    const { body } = await request(admin, orgA, 'admin', 'GET', '/services/registered');
    expect(body.services).toEqual([
      expect.objectContaining({
        id: created.body.data.id,
        name: 'reg-created',
        team_id: team,
        team_name: expect.stringMatching(/^team-create-/),
        github_url: 'https://github.com/example/reg-created',
      }),
    ]);
  });

  it('is not routed to GET /:id', async () => {
    const orgA = await insertOrg();
    const viewer = await member(orgA, 'viewer');
    const { status, body } = await request(viewer, orgA, 'viewer', 'GET', '/services/registered');
    expect(status).toBe(200);
    expect(body).not.toHaveProperty('service');
    expect(Array.isArray(body.services)).toBe(true);
  });
});
