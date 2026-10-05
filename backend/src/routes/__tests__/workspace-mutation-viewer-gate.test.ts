/**
 * Viewers cannot change teams, deployments or infrastructure, or start
 * discovery.
 *
 * Policy under test:
 *   - POST and DELETE on /api/teams, /api/deployments and /api/infrastructure,
 *     POST /api/infrastructure/sync-aws and POST /api/services/discover refuse
 *     a viewer with 403 and do nothing.
 *   - Owners, admins and members are answered exactly as before.
 *   - The role is the caller's current membership, not the claim in the token.
 *   - POST /api/services/discover draws on the same per-organization discovery
 *     budget as POST /api/aws-resources/discover. A refused viewer spends none
 *     of it.
 *   - POST /api/infrastructure/sync-aws has its own per-organization budget.
 *   - The GitHub webhook carries no user and is not subject to any of this.
 *
 * Real routes over an in-process HTTP server against live Postgres. Stubbed:
 * authService.verifyToken (to choose the caller), and the two calls that
 * would otherwise reach AWS -- discovery itself and the Cost Explorer fetch.
 */
import crypto, { randomUUID } from 'crypto';
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import teamsRoutes from '../teams.routes';
import deploymentsRoutes from '../deployments.routes';
import infrastructureRoutes from '../infrastructure.routes';
import servicesRoutes from '../services.routes';
import awsResourcesRoutes from '../awsResources.routes';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { AWSResourceDiscoveryService } from '../../services/awsResourceDiscovery';
import awsCostService from '../../services/aws-cost.service';
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

const WEBHOOK_SECRET = 'workspace-viewer-gate-test-secret';
// The webhook reads its organization once, at module load.
const WEBHOOK_ORG_ID = randomUUID();
// syncAWS only checks that these are set; the Cost Explorer fetch is stubbed.
const AWS_ENV = ['AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY', 'AWS_REGION'] as const;
const DISCOVERY_BUDGET = 10;
const COST_SYNC_BUDGET = 10;

const VIEWER_REFUSAL = {
  success: false,
  error: 'Insufficient permissions',
  required: ['owner', 'admin', 'member'],
  current: 'viewer',
};

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];
const savedEnv: Record<string, string | undefined> = {};

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(id?: string): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (id, name, slug, display_name, subscription_tier, subscription_status)
     VALUES (COALESCE($1::uuid, gen_random_uuid()), $2, $3, $4, 'enterprise', 'active') RETURNING id`,
    [id ?? null, `Viewer Gate ${suffix}`, `viewer-gate-${suffix}`, `Viewer Gate ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function member(orgId: string, role: string): Promise<string> {
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Viewer Gate User') RETURNING id`,
    [`viewer-gate-${role}-${uniqueSuffix()}@example.com`]
  );
  createdUserIds.push(user.rows[0].id);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, user.rows[0].id, role]
  );
  return user.rows[0].id as string;
}

async function insertTeam(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO teams (name, owner, organization_id) VALUES ($1, 'owner@example.com', $2) RETURNING id`,
    [`viewer-gate-team-${uniqueSuffix()}`, orgId]
  );
  return rows[0].id as string;
}

async function insertService(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO services (name, template, owner, status, organization_id)
     VALUES ($1, 'api', 'owner@example.com', 'active', $2) RETURNING id`,
    [`viewer-gate-svc-${uniqueSuffix()}`, orgId]
  );
  return rows[0].id as string;
}

async function insertDeployment(orgId: string, serviceId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, organization_id)
     VALUES ($1, 'production', 'us-east-1', 'running', 'viewer-gate', $2) RETURNING id`,
    [serviceId, orgId]
  );
  return rows[0].id as string;
}

async function insertInfrastructure(orgId: string, serviceId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO infrastructure_resources (service_id, resource_type, aws_id, aws_region, status, cost_per_month, organization_id)
     VALUES ($1, 'ec2', $2, 'us-east-1', 'running', 1, $3) RETURNING id`,
    [serviceId, `i-${uniqueSuffix()}`, orgId]
  );
  return rows[0].id as string;
}

async function buildOrg(id?: string) {
  const orgId = await insertOrg(id);
  return {
    orgId,
    serviceId: await insertService(orgId),
    owner: await member(orgId, 'owner'),
    admin: await member(orgId, 'admin'),
    member: await member(orgId, 'member'),
    viewer: await member(orgId, 'viewer'),
  };
}

type Org = Awaited<ReturnType<typeof buildOrg>>;
type Role = 'owner' | 'admin' | 'member' | 'viewer';

async function count(table: string, orgId: string): Promise<number> {
  const { rows } = await pool.query(`SELECT COUNT(*)::int AS n FROM ${table} WHERE organization_id = $1`, [orgId]);
  return rows[0].n;
}

async function exists(table: string, id: string): Promise<boolean> {
  const { rows } = await pool.query(`SELECT 1 FROM ${table} WHERE id = $1`, [id]);
  return rows.length === 1;
}

let server: http.Server;
let baseUrl: string;
let org: Org;
let webhookOrg: Org;
/** What a sync answers once past the gate: this schema may refuse the cost row it writes. */
let syncStatus: number;
let discoverSpy: jest.SpyInstance;
let costSpy: jest.SpyInstance;

beforeAll(async () => {
  process.env.GITHUB_WEBHOOK_ORG_ID = WEBHOOK_ORG_ID;
  process.env.GITHUB_WEBHOOK_SECRET = WEBHOOK_SECRET;
  for (const key of AWS_ENV) {
    savedEnv[key] = process.env[key];
    process.env[key] = key === 'AWS_REGION' ? 'us-east-1' : 'not-a-credential';
  }
  // Loaded after the environment is set: the router captures its
  // organization when the module is first evaluated.
  const githubWebhookRoutes = require('../github-webhook.routes').default;

  const nullable = await pool.query(
    `SELECT is_nullable FROM information_schema.columns
      WHERE table_schema = current_schema() AND table_name = 'infrastructure_resources' AND column_name = 'service_id'`
  );
  // syncAWS writes its cost row with no service; where the column is NOT NULL
  // that insert fails and the route has always answered 500.
  syncStatus = nullable.rows[0].is_nullable === 'YES' ? 200 : 500;

  org = await buildOrg();
  webhookOrg = await buildOrg(WEBHOOK_ORG_ID);

  const app = express();
  // Same as server.ts: the webhook verifies its signature over the raw body.
  app.use('/api/webhooks/github', express.raw({ type: 'application/json' }));
  app.use('/api/webhooks/github', githubWebhookRoutes);
  app.use(express.json());
  app.use('/api/teams', teamsRoutes);
  app.use('/api/deployments', deploymentsRoutes);
  app.use('/api/infrastructure', infrastructureRoutes);
  app.use('/api/services', servicesRoutes);
  app.use('/api/aws-resources', awsResourcesRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  discoverSpy = jest
    .spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources')
    .mockResolvedValue({ job_id: 'stubbed', resources_discovered: 0, resources_updated: 0, errors: [] } as never);
  costSpy = jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockResolvedValue({
    total: 12.5,
    byService: [],
    period: { start: '2026-10-01', end: '2026-10-05' },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  for (const key of AWS_ENV) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  await pool.query('DELETE FROM infrastructure_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM deployments WHERE organization_id = ANY($1)', [createdOrgIds]);
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

/**
 * A request authenticated as the `role` member of `target`. The token's role
 * CLAIM defaults to 'owner', so every refusal below is proven to come from
 * the caller's current membership rather than the claim.
 */
function send(target: Org, role: Role, method: string, path: string, body?: unknown, jwtRole = 'owner') {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: target[role],
    email: 'viewer-gate-caller@example.com',
    organizationId: target.orgId,
    role: jwtRole,
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface Mutation {
  name: string;
  /** Anything the request needs to exist first; its result is handed to the other steps. */
  prepare: () => Promise<string>;
  request: (role: Role, prepared: string) => Promise<Response>;
  /** Status for owner, admin and member: unchanged by the gate. */
  allowed: () => number;
  /** True when the mutation happened. */
  happened: (prepared: string) => Promise<boolean>;
}

const mutations: Mutation[] = [
  {
    name: 'POST /api/teams',
    prepare: async () => `viewer-gate-new-team-${uniqueSuffix()}`,
    request: (role, name) => send(org, role, 'POST', '/teams', { name, owner: 'owner@example.com' }),
    allowed: () => 201,
    happened: async (name) => (await pool.query('SELECT 1 FROM teams WHERE name = $1', [name])).rows.length === 1,
  },
  {
    name: 'DELETE /api/teams/:id',
    prepare: () => insertTeam(org.orgId),
    request: (role, id) => send(org, role, 'DELETE', `/teams/${id}`),
    allowed: () => 200,
    happened: async (id) => !(await exists('teams', id)),
  },
  {
    name: 'POST /api/deployments',
    prepare: async () => String(await count('deployments', org.orgId)),
    request: (role) => send(org, role, 'POST', '/deployments', { service_id: org.serviceId, environment: 'production' }),
    allowed: () => 201,
    happened: async (before) => (await count('deployments', org.orgId)) === Number(before) + 1,
  },
  {
    name: 'DELETE /api/deployments/:id',
    prepare: () => insertDeployment(org.orgId, org.serviceId),
    request: (role, id) => send(org, role, 'DELETE', `/deployments/${id}`),
    allowed: () => 200,
    happened: async (id) => !(await exists('deployments', id)),
  },
  {
    name: 'POST /api/infrastructure',
    prepare: async () => `i-new-${uniqueSuffix()}`,
    request: (role, awsId) =>
      send(org, role, 'POST', '/infrastructure', {
        service_id: org.serviceId,
        resource_type: 'ec2',
        aws_id: awsId,
        aws_region: 'us-east-1',
        status: 'running',
        cost_per_month: 3,
      }),
    allowed: () => 201,
    happened: async (awsId) =>
      (await pool.query('SELECT 1 FROM infrastructure_resources WHERE aws_id = $1', [awsId])).rows.length === 1,
  },
  {
    name: 'DELETE /api/infrastructure/:id',
    prepare: () => insertInfrastructure(org.orgId, org.serviceId),
    request: (role, id) => send(org, role, 'DELETE', `/infrastructure/${id}`),
    allowed: () => 200,
    happened: async (id) => !(await exists('infrastructure_resources', id)),
  },
  {
    name: 'POST /api/infrastructure/sync-aws',
    prepare: async () => '',
    request: (role) => send(org, role, 'POST', '/infrastructure/sync-aws'),
    allowed: () => syncStatus,
    happened: async () => costSpy.mock.calls.length === 1,
  },
  {
    name: 'POST /api/services/discover',
    prepare: async () => '',
    request: (role) => send(org, role, 'POST', '/services/discover'),
    allowed: () => 200,
    happened: async () => discoverSpy.mock.calls.length === 1,
  },
];

describe.each(mutations)('$name', ({ prepare, request, allowed, happened }) => {
  it('refuses a viewer with 403 and does nothing', async () => {
    const prepared = await prepare();

    const res = await request('viewer', prepared);

    expect(res.status).toBe(403);
    expect(await res.json()).toEqual(VIEWER_REFUSAL);
    expect(await happened(prepared)).toBe(false);
    expect(discoverSpy).not.toHaveBeenCalled();
    expect(costSpy).not.toHaveBeenCalled();
  });

  it.each(['owner', 'admin', 'member'] as const)('answers a %s as before', async (role) => {
    const prepared = await prepare();

    const res = await request(role, prepared);

    expect(res.status).toBe(allowed());
    expect(await happened(prepared)).toBe(true);
  });
});

describe('the decision follows the current membership, not the token', () => {
  it('a member whose token claims viewer is allowed, and a viewer whose token claims owner is refused', async () => {
    const name = `viewer-gate-claim-${uniqueSuffix()}`;

    const asViewer = await send(org, 'viewer', 'POST', '/teams', { name, owner: 'owner@example.com' }, 'owner');
    const asMember = await send(org, 'member', 'POST', '/teams', { name, owner: 'owner@example.com' }, 'viewer');

    expect(asViewer.status).toBe(403);
    expect(asMember.status).toBe(201);
  });

  it('without a token every gated mutation is 401', async () => {
    for (const [method, path] of [
      ['POST', '/teams'],
      ['DELETE', `/teams/${randomUUID()}`],
      ['POST', '/deployments'],
      ['DELETE', `/deployments/${randomUUID()}`],
      ['POST', '/infrastructure'],
      ['DELETE', `/infrastructure/${randomUUID()}`],
      ['POST', '/infrastructure/sync-aws'],
      ['POST', '/services/discover'],
    ]) {
      const res = await fetch(`${baseUrl}${path}`, { method });
      expect([method, path, res.status]).toEqual([method, path, 401]);
    }
  });
});

describe('discovery budget', () => {
  const discover = (target: Org, role: Role) => send(target, role, 'POST', '/services/discover');
  const adminDiscover = (target: Org, role: Role) => send(target, role, 'POST', '/aws-resources/discover');

  it('is one budget per organization across both discover endpoints, and a refused viewer spends none of it', async () => {
    const limited = await buildOrg();
    const other = await buildOrg();

    for (let i = 0; i < 3; i++) expect((await discover(limited, 'viewer')).status).toBe(403);

    // Alternating endpoints: together they get the budget once, not once each.
    for (let i = 0; i < DISCOVERY_BUDGET; i++) {
      const res = i % 2 === 0 ? await discover(limited, 'member') : await adminDiscover(limited, 'admin');
      expect([i, res.status]).toEqual([i, 200]);
    }
    expect(discoverSpy).toHaveBeenCalledTimes(DISCOVERY_BUDGET);

    const overServices = await discover(limited, 'owner');
    const overAwsResources = await adminDiscover(limited, 'owner');

    expect(overServices.status).toBe(429);
    expect(await overServices.json()).toMatchObject({ success: false, retry_after: 3600 });
    expect(overAwsResources.status).toBe(429);
    expect(discoverSpy).toHaveBeenCalledTimes(DISCOVERY_BUDGET);

    // Another organization is unaffected.
    expect((await discover(other, 'member')).status).toBe(200);
    expect(discoverSpy).toHaveBeenLastCalledWith(other.orgId);
  });
});

describe('cost sync budget', () => {
  const sync = (target: Org, role: Role) => send(target, role, 'POST', '/infrastructure/sync-aws');

  it('is its own budget per organization, apart from discovery', async () => {
    const limited = await buildOrg();
    const other = await buildOrg();

    for (let i = 0; i < 3; i++) expect((await sync(limited, 'viewer')).status).toBe(403);
    for (let i = 0; i < COST_SYNC_BUDGET; i++) {
      expect([i, (await sync(limited, 'member')).status]).toEqual([i, syncStatus]);
    }

    const over = await sync(limited, 'owner');

    expect(over.status).toBe(429);
    expect(await over.json()).toMatchObject({ success: false, retry_after: 3600 });
    expect(costSpy).toHaveBeenCalledTimes(COST_SYNC_BUDGET);
    // Neither the other organization nor this one's discovery budget is touched.
    expect((await sync(other, 'member')).status).toBe(syncStatus);
    expect((await send(limited, 'member', 'POST', '/services/discover')).status).toBe(200);
  });
});

describe('automation that carries no user is unaffected', () => {
  it('a signed GitHub delivery still records a deployment', async () => {
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
      repository: { name: `viewer-gate-repo-${uniqueSuffix()}` },
      sender: { login: 'viewer-gate' },
    });
    const sign = (secret: string) => 'sha256=' + crypto.createHmac('sha256', secret).update(body).digest('hex');
    const deliver = (signature: string) =>
      fetch(`${baseUrl}/webhooks/github`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-GitHub-Event': 'workflow_job', 'X-Hub-Signature-256': signature },
        body,
      });

    const unsigned = await deliver(sign('wrong-secret'));
    const signed = await deliver(sign(WEBHOOK_SECRET));

    expect(unsigned.status).toBe(401);
    expect(signed.status).toBe(201);
    expect((await signed.json()).data).toMatchObject({ organization_id: webhookOrg.orgId, status: 'success' });
  });
});
