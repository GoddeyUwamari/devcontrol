/**
 * Authorization and tenant scope for the services table.
 *
 * Policy under test:
 *   - POST /api/services, PUT /api/services/:id and DELETE /api/services/:id
 *     are owner/admin only, checked against the caller's CURRENT membership
 *     via requireCurrentRole -- never the role claim in the JWT. The role is
 *     checked before the service is looked up, so other roles get the same
 *     403 for every service id.
 *   - Every service read, update, delete, and name match is confined to one
 *     organization. A service of another organization, or one with no
 *     organization, is never returned or matched.
 *   - A service with no organization: where services.organization_id is
 *     NOT NULL the database refuses the row, and that is what is asserted;
 *     where an older schema still allows it, such a row is created and shown
 *     never to be returned or matched. Which applies is read from
 *     information_schema at setup.
 *   - POST /api/deployments and the GitHub webhook resolve a service name
 *     only within their own organization, and create it there when absent.
 *
 * Real routes over an in-process HTTP server against live Postgres. The test
 * role is not subject to RLS (see the precondition test), so every isolation
 * assertion passes only because of the organization predicate in the
 * statement itself. Only authService.verifyToken (to choose the caller and
 * JWT claims) is stubbed.
 */
import crypto, { randomUUID } from 'crypto';
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import servicesRoutes from '../services.routes';
import deploymentsRoutes from '../deployments.routes';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { ServicesRepository } from '../../repositories/services.repository';
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

const WEBHOOK_SECRET = 'services-authorization-test-secret';
// The webhook reads its organization once, at module load.
const WEBHOOK_ORG_ID = randomUUID();

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];
const orphanServiceIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(id?: string): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (id, name, slug, display_name, subscription_tier, subscription_status)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, 'enterprise', 'active') RETURNING id`,
    [id ?? null, `Services Authz ${suffix}`, `services-authz-${suffix}`, `Services Authz ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(label: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Services Authz User') RETURNING id`,
    [`services-authz-${label}-${uniqueSuffix()}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function member(orgId: string, role: string): Promise<string> {
  const userId = await insertUser(role);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, userId, role]
  );
  return userId;
}

async function setRole(orgId: string, userId: string, role: string): Promise<void> {
  await pool.query(
    'UPDATE organization_memberships SET role = $3 WHERE organization_id = $1 AND user_id = $2',
    [orgId, userId, role]
  );
}

async function insertTeam(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO teams (name, owner, organization_id) VALUES ($1, 'owner@example.com', $2) RETURNING id`,
    [`services-authz-team-${uniqueSuffix()}`, orgId]
  );
  return rows[0].id as string;
}

async function buildOrg(id?: string) {
  const orgId = await insertOrg(id);
  return {
    orgId,
    teamId: await insertTeam(orgId),
    owner: await member(orgId, 'owner'),
    admin: await member(orgId, 'admin'),
    member: await member(orgId, 'member'),
    viewer: await member(orgId, 'viewer'),
  };
}

/** Whether this schema allows a services row with no organization. Set in beforeAll. */
let organizationNullable: boolean;

async function readOrganizationNullable(): Promise<boolean> {
  const { rows } = await pool.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'services' AND column_name = 'organization_id'`
  );
  if (rows.length !== 1) throw new Error('services.organization_id not found');
  return rows[0].is_nullable === 'YES';
}

/** On a schema where the column is NOT NULL: the row cannot be created at all. */
async function expectNoOrganizationRejected(name = `services-authz-svc-${uniqueSuffix()}`): Promise<void> {
  await expect(insertService(null, name)).rejects.toMatchObject({ code: '23502', column: 'organization_id' });
  expect(await servicesNamed(name)).toEqual([]);
}

/** A services row; `orgId` null makes one that belongs to no organization. */
async function insertService(orgId: string | null, name = `services-authz-svc-${uniqueSuffix()}`): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id)
     VALUES ($1, 'api', 'owner@example.com', 'active', $2) RETURNING id`,
    [name, orgId]
  );
  if (orgId === null) orphanServiceIds.push(rows[0].id);
  return rows[0].id as string;
}

async function serviceRow(id: string) {
  const { rows } = await pool.query(
    'SELECT id, name, description, status, organization_id FROM services WHERE id = $1',
    [id]
  );
  return rows[0] ?? null;
}

async function servicesNamed(name: string) {
  const { rows } = await pool.query(
    'SELECT id, organization_id FROM services WHERE LOWER(name) = LOWER($1) ORDER BY created_at',
    [name]
  );
  return rows as { id: string; organization_id: string | null }[];
}

let server: http.Server;
let baseUrl: string;
let orgA: Awaited<ReturnType<typeof buildOrg>>;
let orgB: Awaited<ReturnType<typeof buildOrg>>;
let webhookOrg: Awaited<ReturnType<typeof buildOrg>>;
let errorSpy: jest.SpyInstance;

beforeAll(async () => {
  process.env.GITHUB_WEBHOOK_ORG_ID = WEBHOOK_ORG_ID;
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  // Loaded after the environment is set: the router captures its
  // organization when the module is first evaluated.
  const githubWebhookRoutes = require('../github-webhook.routes').default;

  organizationNullable = await readOrganizationNullable();

  orgA = await buildOrg();
  orgB = await buildOrg();
  webhookOrg = await buildOrg(WEBHOOK_ORG_ID);

  const app = express();
  // Same as server.ts: the webhook verifies its signature over the raw body.
  app.use('/api/webhooks/github', express.raw({ type: 'application/json' }));
  app.use('/api/webhooks/github', githubWebhookRoutes);
  app.use(express.json());
  app.use('/api/services', servicesRoutes);
  app.use('/api/deployments', deploymentsRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM services WHERE id = ANY($1)', [orphanServiceIds]);
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

/**
 * Requests authenticated as `userId` in `orgId`. `jwtRole` is only the role
 * CLAIM in the token -- it defaults to 'owner' so every test proves the
 * decision comes from the caller's current membership, not the claim.
 */
function as(userId: string, orgId: string, jwtRole = 'owner') {
  const send = (method: string, path: string, body?: unknown) => {
    jest.spyOn(authService, 'verifyToken').mockReturnValue({
      userId,
      email: 'services-authz-caller@example.com',
      organizationId: orgId,
      role: jwtRole,
      type: 'access',
    } as unknown as ReturnType<typeof authService.verifyToken>);
    return fetch(`${baseUrl}${path}`, {
      method,
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  };
  return {
    create: (teamId: string, name = `services-authz-new-${uniqueSuffix()}`) =>
      send('POST', '/services', { name, template: 'api', owner: 'owner@example.com', team_id: teamId }),
    get: (id: string) => send('GET', `/services/${id}`),
    update: (id: string, body: Record<string, unknown> = { description: 'changed' }) =>
      send('PUT', `/services/${id}`, body),
    remove: (id: string) => send('DELETE', `/services/${id}`),
    deploy: (body: Record<string, unknown>) => send('POST', '/deployments', { environment: 'production', ...body }),
  };
}

function webhookDelivery(repoName: string) {
  const body = JSON.stringify({
    action: 'completed',
    workflow_job: {
      id: Math.floor(Math.random() * 1e12),
      run_id: Math.floor(Math.random() * 1e12),
      name: 'deploy-backend',
      conclusion: 'success',
      completed_at: new Date().toISOString(),
      head_sha: 'abc123',
      html_url: 'https://example.com/run',
    },
    repository: { name: repoName },
    sender: { login: 'services-authz' },
  });
  const signature = 'sha256=' + crypto.createHmac('sha256', WEBHOOK_SECRET).update(body).digest('hex');
  return fetch(`${baseUrl}/webhooks/github`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-GitHub-Event': 'workflow_job',
      'X-Hub-Signature-256': signature,
    },
    body,
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

describe('service mutations are limited to owners and admins', () => {
  it.each(['member', 'viewer'] as const)('%s: create, update, and delete are all 403 and nothing changes', async (role) => {
    const serviceId = await insertService(orgA.orgId);
    const before = await serviceRow(serviceId);
    const name = `services-authz-denied-${uniqueSuffix()}`;
    const caller = as(orgA[role], orgA.orgId);

    expect((await caller.create(orgA.teamId, name)).status).toBe(403);
    expect((await caller.update(serviceId)).status).toBe(403);
    expect((await caller.remove(serviceId)).status).toBe(403);

    expect(await servicesNamed(name)).toEqual([]);
    expect(await serviceRow(serviceId)).toEqual(before);
  });

  it.each(['owner', 'admin'] as const)('%s: create, update, and delete succeed', async (role) => {
    const caller = as(orgA[role], orgA.orgId, 'viewer');

    const created = await caller.create(orgA.teamId);
    expect(created.status).toBe(201);
    const { data } = (await created.json()) as { data: { id: string; organization_id: string } };
    expect(data.organization_id).toBe(orgA.orgId);

    const updated = await caller.update(data.id, { description: 'updated by test' });
    expect(updated.status).toBe(200);
    expect((await serviceRow(data.id)).description).toBe('updated by test');

    expect((await caller.remove(data.id)).status).toBe(200);
    expect(await serviceRow(data.id)).toBeNull();
  });

  it('the role is checked before the service is looked up: the same 403 for an own, a foreign, an unknown, and a malformed id', async () => {
    const own = await insertService(orgA.orgId);
    const foreign = await insertService(orgB.orgId);
    const caller = as(orgA.member, orgA.orgId);

    for (const id of [own, foreign, randomUUID(), 'not-a-uuid']) {
      const update = await caller.update(id);
      const remove = await caller.remove(id);
      expect(update.status).toBe(403);
      expect(remove.status).toBe(403);
      expect(await update.json()).toEqual(await remove.json());
    }
    expect(await serviceRow(foreign)).not.toBeNull();
  });

  it('without a token every mutation is 401', async () => {
    const id = await insertService(orgA.orgId);
    for (const [method, path] of [['POST', '/services'], ['PUT', `/services/${id}`], ['DELETE', `/services/${id}`]]) {
      const res = await fetch(`${baseUrl}${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' });
      expect(res.status).toBe(401);
    }
    expect(await serviceRow(id)).not.toBeNull();
  });
});

describe('the decision follows the current membership, not the token', () => {
  it('a token carrying an admin claim is refused once the membership is changed to member, and allowed again when restored', async () => {
    const org = await buildOrg();
    const serviceId = await insertService(org.orgId);
    const caller = as(org.admin, org.orgId, 'admin');

    expect((await caller.update(serviceId, { description: 'while admin' })).status).toBe(200);

    await setRole(org.orgId, org.admin, 'member');
    expect((await caller.create(org.teamId)).status).toBe(403);
    expect((await caller.update(serviceId, { description: 'after demotion' })).status).toBe(403);
    expect((await caller.remove(serviceId)).status).toBe(403);
    expect((await serviceRow(serviceId)).description).toBe('while admin');

    await setRole(org.orgId, org.admin, 'admin');
    expect((await caller.remove(serviceId)).status).toBe(200);
  });

  it('a member whose token claims owner is still refused', async () => {
    const serviceId = await insertService(orgA.orgId);
    expect((await as(orgA.member, orgA.orgId, 'owner').remove(serviceId)).status).toBe(403);
    expect(await serviceRow(serviceId)).not.toBeNull();
  });
});

describe('a service of another organization behaves as if it does not exist', () => {
  it('read, update, and delete are 404, identical to an id that exists nowhere, and the service is unchanged', async () => {
    const foreign = await insertService(orgB.orgId);
    const before = await serviceRow(foreign);
    const caller = as(orgA.owner, orgA.orgId);
    const nowhere = randomUUID();

    const [read, missingRead] = [await caller.get(foreign), await caller.get(nowhere)];
    const [update, missingUpdate] = [await caller.update(foreign), await caller.update(nowhere)];
    const [remove, missingRemove] = [await caller.remove(foreign), await caller.remove(nowhere)];

    for (const [res, missing] of [[read, missingRead], [update, missingUpdate], [remove, missingRemove]]) {
      expect(res.status).toBe(404);
      expect(missing.status).toBe(404);
      expect(await res.json()).toEqual(await missing.json());
    }
    expect(await serviceRow(foreign)).toEqual(before);
  });

  it('the owning organization can still read, update, and delete it', async () => {
    const own = await insertService(orgB.orgId);
    const caller = as(orgB.owner, orgB.orgId);
    expect((await caller.get(own)).status).toBe(200);
    expect((await caller.update(own)).status).toBe(200);
    expect((await caller.remove(own)).status).toBe(200);
  });

  it('a created service always lands in the caller\'s organization, whatever the body says', async () => {
    const name = `services-authz-body-org-${uniqueSuffix()}`;
    jest.spyOn(authService, 'verifyToken').mockReturnValue({
      userId: orgA.owner, email: 'x@example.com', organizationId: orgA.orgId, role: 'owner', type: 'access',
    } as unknown as ReturnType<typeof authService.verifyToken>);
    const res = await fetch(`${baseUrl}/services`, {
      method: 'POST',
      headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name, template: 'api', owner: 'owner@example.com', team_id: orgA.teamId,
        organization_id: orgB.orgId, organizationId: orgB.orgId,
      }),
    });
    expect(res.status).toBe(201);
    expect((await servicesNamed(name)).map((s) => s.organization_id)).toEqual([orgA.orgId]);
  });
});

describe('a service with no organization is never returned or matched', () => {
  it('the schema\'s nullability is known, so exactly one of the two behaviours below is asserted', () => {
    expect(typeof organizationNullable).toBe('boolean');
  });

  it('by id: the row is refused by the database, or read, update, and delete are 404 and the row is unchanged', async () => {
    if (!organizationNullable) {
      await expectNoOrganizationRejected();
      return;
    }
    const orphan = await insertService(null);
    const before = await serviceRow(orphan);
    const caller = as(orgA.owner, orgA.orgId);

    expect((await caller.get(orphan)).status).toBe(404);
    expect((await caller.update(orphan)).status).toBe(404);
    expect((await caller.remove(orphan)).status).toBe(404);
    expect(await serviceRow(orphan)).toEqual(before);
  });
});

describe('ServicesRepository reads are confined to the given organization', () => {
  const repository = new ServicesRepository();

  it('findAll returns and counts only that organization\'s services', async () => {
    const org = await buildOrg();
    const own = [await insertService(org.orgId), await insertService(org.orgId)];
    const foreign = await insertService(orgB.orgId);
    const orphan = organizationNullable ? await insertService(null) : null;

    const { services, total } = await repository.findAll(org.orgId, {});
    const ids = services.map((s) => s.id);

    expect(ids.sort()).toEqual([...own].sort());
    expect(total).toBe(2);
    expect(ids).not.toContain(foreign);
    if (orphan) expect(ids).not.toContain(orphan);
  });

  it('findAll filters stay inside the organization', async () => {
    const org = await buildOrg();
    await insertService(org.orgId);
    await insertService(orgB.orgId);

    const { services } = await repository.findAll(org.orgId, { status: 'active', limit: 50 });
    expect(services.length).toBe(1);
    expect(services.every((s) => (s as unknown as { organization_id: string }).organization_id === org.orgId)).toBe(true);
  });

  it('findById, update, and delete do not reach a foreign service', async () => {
    const foreign = await insertService(orgB.orgId);

    expect(await repository.findById(foreign, orgA.orgId)).toBeNull();
    expect(await repository.update(foreign, { description: 'x' }, orgA.orgId)).toBeNull();
    expect(await repository.delete(foreign, orgA.orgId)).toBe(false);
    expect((await serviceRow(foreign)).description).toBeNull();
  });

  it('a service with no organization: refused by the database, or not reached by findById, update, or delete', async () => {
    if (!organizationNullable) {
      await expectNoOrganizationRejected();
      return;
    }
    const orphan = await insertService(null);

    expect(await repository.findById(orphan, orgA.orgId)).toBeNull();
    expect(await repository.update(orphan, { description: 'x' }, orgA.orgId)).toBeNull();
    expect(await repository.delete(orphan, orgA.orgId)).toBe(false);
    expect((await serviceRow(orphan)).description).toBeNull();
  });
});

describe('POST /api/deployments resolves a service name only within the caller\'s organization', () => {
  it('matches the organization\'s own service by name, case-insensitively, and creates no second row', async () => {
    const name = `Services-Authz-Deploy-${uniqueSuffix()}`;
    const own = await insertService(orgA.orgId, name);

    const res = await as(orgA.admin, orgA.orgId).deploy({ serviceName: name.toUpperCase() });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { service_id: string; organization_id: string } };

    expect(data.service_id).toBe(own);
    expect(data.organization_id).toBe(orgA.orgId);
    expect((await servicesNamed(name)).length).toBe(1);
  });

  it('another organization\'s service of the same name is not matched: a new one is created in the caller\'s organization', async () => {
    const name = `services-authz-deploy-${uniqueSuffix()}`;
    const foreign = await insertService(orgB.orgId, name);

    const res = await as(orgA.admin, orgA.orgId).deploy({ serviceName: name });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { service_id: string; organization_id: string } };

    expect(data.service_id).not.toBe(foreign);
    expect((await serviceRow(data.service_id)).organization_id).toBe(orgA.orgId);
    expect(data.organization_id).toBe(orgA.orgId);
  });

  it('a service with no organization of the same name: refused by the database, or not matched', async () => {
    const name = `services-authz-deploy-${uniqueSuffix()}`;
    if (!organizationNullable) {
      await expectNoOrganizationRejected(name);
      return;
    }
    const orphan = await insertService(null, name);

    const res = await as(orgA.admin, orgA.orgId).deploy({ serviceName: name });
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { service_id: string } };

    expect(data.service_id).not.toBe(orphan);
    expect((await serviceRow(data.service_id)).organization_id).toBe(orgA.orgId);
    expect((await serviceRow(orphan)).organization_id).toBeNull();
  });

  it('an unknown name creates the service in the caller\'s organization', async () => {
    const name = `services-authz-deploy-${uniqueSuffix()}`;
    const res = await as(orgA.admin, orgA.orgId).deploy({ serviceName: name });
    expect(res.status).toBe(201);
    expect((await servicesNamed(name)).map((s) => s.organization_id)).toEqual([orgA.orgId]);
  });

  it('who may post a deployment is unchanged: a member still can', async () => {
    const name = `services-authz-deploy-${uniqueSuffix()}`;
    await insertService(orgA.orgId, name);
    expect((await as(orgA.member, orgA.orgId).deploy({ serviceName: name })).status).toBe(201);
  });
});

describe('the GitHub webhook resolves a repository name only within its own organization', () => {
  it('matches the webhook organization\'s own service', async () => {
    const name = `services-authz-repo-${uniqueSuffix()}`;
    const own = await insertService(webhookOrg.orgId, name);

    const res = await webhookDelivery(name);
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { service_id: string; organization_id: string } };

    expect(data.service_id).toBe(own);
    expect(data.organization_id).toBe(webhookOrg.orgId);
    expect((await servicesNamed(name)).length).toBe(1);
  });

  it('another organization\'s service of the same name is not matched', async () => {
    const name = `services-authz-repo-${uniqueSuffix()}`;
    const foreign = await insertService(orgB.orgId, name);

    const res = await webhookDelivery(name);
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { service_id: string } };

    expect(data.service_id).not.toBe(foreign);
    expect((await serviceRow(data.service_id)).organization_id).toBe(webhookOrg.orgId);
  });

  it('a service with no organization of the same name: refused by the database, or not matched', async () => {
    const name = `services-authz-repo-${uniqueSuffix()}`;
    if (!organizationNullable) {
      await expectNoOrganizationRejected(name);
      return;
    }
    const orphan = await insertService(null, name);

    const res = await webhookDelivery(name);
    expect(res.status).toBe(201);
    const { data } = (await res.json()) as { data: { service_id: string } };

    expect(data.service_id).not.toBe(orphan);
    expect((await serviceRow(data.service_id)).organization_id).toBe(webhookOrg.orgId);
  });

  it('an unknown repository creates the service in the webhook organization, once', async () => {
    const name = `services-authz-repo-${uniqueSuffix()}`;

    expect((await webhookDelivery(name)).status).toBe(201);
    expect((await webhookDelivery(name)).status).toBe(201);

    expect((await servicesNamed(name)).map((s) => s.organization_id)).toEqual([webhookOrg.orgId]);
  });
});
