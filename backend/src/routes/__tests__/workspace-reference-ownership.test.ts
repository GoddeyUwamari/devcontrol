/**
 * A new service can only reference a team, and a new infrastructure resource
 * a service, of the caller's own organization.
 *
 * Policy under test:
 *   - POST /api/services creates the service only when `team_id` names a team
 *     of the caller's organization.
 *   - POST /api/infrastructure creates the resource only when `service_id`
 *     names a service of the caller's organization.
 *   - An id that belongs to another organization is answered exactly like an
 *     id that exists nowhere: the same status and the same body, so the
 *     response never reveals that the id exists elsewhere.
 *   - A refused request writes nothing, in either organization, and leaves
 *     the referenced row untouched.
 *   - The organization is the caller's own, whatever the body says.
 *
 * Real routes over an in-process HTTP server against live Postgres. The test
 * role is not subject to RLS (see the precondition test), so every assertion
 * passes only because of the organization predicate in the statement itself.
 * Only authService.verifyToken (to choose the caller) is stubbed.
 */
import { randomUUID } from 'crypto';
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import servicesRoutes from '../services.routes';
import infrastructureRoutes from '../infrastructure.routes';
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

async function member(orgId: string, role: string): Promise<string> {
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Reference Ownership User') RETURNING id`,
    [`reference-ownership-${role}-${uniqueSuffix()}@example.com`]
  );
  createdUserIds.push(user.rows[0].id);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, user.rows[0].id, role]
  );
  return user.rows[0].id as string;
}

async function buildOrg() {
  const suffix = uniqueSuffix();
  const org = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
    [`Reference Ownership ${suffix}`, `reference-ownership-${suffix}`]
  );
  const orgId = org.rows[0].id as string;
  createdOrgIds.push(orgId);
  const team = await pool.query(
    `INSERT INTO teams (name, owner, organization_id) VALUES ($1, 'owner@example.com', $2) RETURNING id`,
    [`reference-ownership-team-${suffix}`, orgId]
  );
  const service = await pool.query(
    `INSERT INTO services (name, template, owner, status, team_id, organization_id)
     VALUES ($1, 'api', 'owner@example.com', 'active', $2, $3) RETURNING id`,
    [`reference-ownership-svc-${suffix}`, team.rows[0].id, orgId]
  );
  return {
    orgId,
    teamId: team.rows[0].id as string,
    serviceId: service.rows[0].id as string,
    admin: await member(orgId, 'admin'),
    member: await member(orgId, 'member'),
  };
}

type Org = Awaited<ReturnType<typeof buildOrg>>;

async function row(table: 'teams' | 'services', id: string) {
  const { rows } = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

/** Every row of `table` that either organization owns or that points at `referenceId`. */
async function rowsTouching(table: 'services' | 'infrastructure_resources', column: string, referenceId: string) {
  const { rows } = await pool.query(
    `SELECT id FROM ${table} WHERE organization_id = ANY($1) OR ${column} = $2 ORDER BY id`,
    [createdOrgIds, referenceId]
  );
  return rows.map((r) => r.id as string);
}

let server: http.Server;
let baseUrl: string;
let orgA: Org;
let orgB: Org;

beforeAll(async () => {
  orgA = await buildOrg();
  orgB = await buildOrg();

  const app = express();
  app.use(express.json());
  app.use('/api/services', servicesRoutes);
  app.use('/api/infrastructure', infrastructureRoutes);
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
  await pool.query('DELETE FROM infrastructure_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM teams WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
  await appPool.end();
});

function post(org: Org, userId: string, path: string, body: Record<string, unknown>) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'reference-ownership-caller@example.com',
    organizationId: org.orgId,
    role: 'owner',
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
}

/** As org A's admin: service creation is owner/admin only. */
function createService(body: Record<string, unknown>) {
  return post(orgA, orgA.admin, '/services', {
    name: `reference-ownership-new-${uniqueSuffix()}`,
    template: 'api',
    owner: 'owner@example.com',
    ...body,
  });
}

/** As org A's member. */
function createInfrastructure(body: Record<string, unknown>) {
  return post(orgA, orgA.member, '/infrastructure', {
    resource_type: 'ec2',
    aws_id: `i-${uniqueSuffix()}`,
    aws_region: 'us-east-1',
    status: 'running',
    cost_per_month: 4,
    ...body,
  });
}

describe('precondition: RLS cannot be what makes these tests pass', () => {
  it('the connecting role is not subject to row-level security', async () => {
    const { rows } = await pool.query(
      'SELECT rolsuper OR rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user'
    );
    expect(rows[0].bypasses).toBe(true);
  });
});

describe('POST /api/services checks that the team is the caller\'s own', () => {
  it('creates the service for a team of the caller\'s organization', async () => {
    const res = await createService({ team_id: orgA.teamId });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message).toBe('Service created successfully');
    expect(body.data).toMatchObject({ team_id: orgA.teamId, organization_id: orgA.orgId, status: 'active' });
    expect(await row('services', body.data.id)).toMatchObject({ team_id: orgA.teamId, organization_id: orgA.orgId });
  });

  it('answers another organization\'s team exactly like a team that exists nowhere, and writes nothing', async () => {
    const teamBefore = await row('teams', orgB.teamId);
    const servicesBefore = await rowsTouching('services', 'team_id', orgB.teamId);

    const foreign = await createService({ team_id: orgB.teamId });
    const unknown = await createService({ team_id: randomUUID() });

    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(foreign.status);
    const foreignBody = await foreign.json();
    expect(foreignBody).toEqual({ success: false, error: 'Team not found', code: 'NOT_FOUND' });
    expect(await unknown.json()).toEqual(foreignBody);
    // No service anywhere, and the other organization's team is as it was.
    expect(await rowsTouching('services', 'team_id', orgB.teamId)).toEqual(servicesBefore);
    expect(await row('teams', orgB.teamId)).toEqual(teamBefore);
  });

  it('takes the organization from the caller, never from the body', async () => {
    const servicesBefore = await rowsTouching('services', 'team_id', orgB.teamId);

    // Naming the other organization does not make its team acceptable...
    const foreign = await createService({ team_id: orgB.teamId, organization_id: orgB.orgId });
    // ...and does not move a valid request out of the caller's organization.
    const own = await createService({ team_id: orgA.teamId, organization_id: orgB.orgId });

    expect(foreign.status).toBe(404);
    expect(own.status).toBe(201);
    const created = (await own.json()).data;
    expect(created).toMatchObject({ team_id: orgA.teamId, organization_id: orgA.orgId });
    expect(await rowsTouching('services', 'team_id', orgB.teamId)).toEqual([...servicesBefore, created.id].sort());
  });

  it('still requires a team', async () => {
    const res = await createService({});

    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ success: false, error: 'Validation failed' });
  });
});

describe('POST /api/infrastructure checks that the service is the caller\'s own', () => {
  it('creates the resource for a service of the caller\'s organization', async () => {
    const res = await createInfrastructure({ service_id: orgA.serviceId, metadata: { note: 'kept' } });

    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.message).toBe('Infrastructure resource created successfully');
    expect(body.data).toMatchObject({
      service_id: orgA.serviceId,
      organization_id: orgA.orgId,
      resource_type: 'ec2',
      aws_region: 'us-east-1',
      status: 'running',
      cost_per_month: '4.00',
      metadata: { note: 'kept' },
    });
  });

  it('answers another organization\'s service exactly like a service that exists nowhere, and writes nothing', async () => {
    const serviceBefore = await row('services', orgB.serviceId);
    const resourcesBefore = await rowsTouching('infrastructure_resources', 'service_id', orgB.serviceId);

    const foreign = await createInfrastructure({ service_id: orgB.serviceId });
    const unknown = await createInfrastructure({ service_id: randomUUID() });

    expect(foreign.status).toBe(404);
    expect(unknown.status).toBe(foreign.status);
    const foreignBody = await foreign.json();
    expect(foreignBody).toEqual({ success: false, error: 'Service not found' });
    expect(await unknown.json()).toEqual(foreignBody);
    // No resource anywhere, and the other organization's service is as it was.
    expect(await rowsTouching('infrastructure_resources', 'service_id', orgB.serviceId)).toEqual(resourcesBefore);
    expect(await row('services', orgB.serviceId)).toEqual(serviceBefore);
  });

  it('takes the organization from the caller, never from the body', async () => {
    const resourcesBefore = await rowsTouching('infrastructure_resources', 'service_id', orgB.serviceId);

    const foreign = await createInfrastructure({ service_id: orgB.serviceId, organization_id: orgB.orgId });
    const own = await createInfrastructure({ service_id: orgA.serviceId, organization_id: orgB.orgId });

    expect(foreign.status).toBe(404);
    expect(own.status).toBe(201);
    const created = (await own.json()).data;
    expect(created).toMatchObject({ service_id: orgA.serviceId, organization_id: orgA.orgId });
    expect(await rowsTouching('infrastructure_resources', 'service_id', orgB.serviceId)).toEqual(
      [...resourcesBefore, created.id].sort()
    );
  });

  it('still requires a service', async () => {
    const res = await createInfrastructure({});

    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Missing required fields: service_id, resource_type, aws_id, aws_region, status, cost_per_month',
    });
  });
});
