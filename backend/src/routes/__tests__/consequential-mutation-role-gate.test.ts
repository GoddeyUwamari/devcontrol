/**
 * Only owners and admins may start AWS analysis, change outbound integrations,
 * or start a checkout.
 *
 * Policy under test (viewer and member refused with 403, admin and owner
 * answered exactly as before):
 *   - POST /api/cost-recommendations/analyze
 *   - POST /api/security-hub/sync
 *   - POST /api/anomalies/scan
 *   - POST, PUT, DELETE /api/scheduled-reports, PATCH /:id/toggle, POST /:id/test
 *   - POST, DELETE /api/webhooks
 *   - PUT /api/alert-config/config, POST /api/alert-config/test
 *   - POST /api/stripe/create-checkout-session
 *
 * A refused caller starts nothing: no AWS work, no analysis run, no
 * recommendation rewrite, no schedule or configuration change, no outbound
 * delivery, no Stripe call. The role is the caller's current membership in
 * the token's organization, never the claim in the token; an inactive or
 * still-pending membership is refused by authentication before any role gate.
 *
 * Real routes over an in-process HTTP server against live Postgres, in an
 * Enterprise organization so every plan gate passes. Stubbed:
 * authService.verifyToken (to choose the caller) and each call that would
 * otherwise reach AWS, an outbound channel or Stripe.
 */
import fs from 'fs';
import path from 'path';
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import costRecommendationsRoutes from '../cost-recommendations.routes';
import securityHubRoutes from '../security-hub.routes';
import scheduledReportsRoutes from '../scheduled-reports.routes';
import webhooksRoutes from '../webhooks.routes';
import alertConfigRoutes from '../alert-config.routes';
import stripeRoutes from '../stripe.routes';
import { createAnomaliesRoutes } from '../anomalies.routes';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import costOptimizationService from '../../services/cost-optimization.service';
import stripeService from '../../services/stripe.service';
import { AWSClientFactory } from '../../services/aws-client-factory.service';
import { SecurityHubSyncService } from '../../services/security-hub-sync.service';
import { ScheduledReportsService } from '../../services/scheduled-reports.service';
import { AlertNotificationService } from '../../services/alert-notification.service';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import { AnomalyRepository } from '../../repositories/anomaly.repository';
import { AnomalyDetectionService } from '../../services/anomaly-detection.service';
import { AnomalyAIService } from '../../services/anomaly-ai.service';
import { alertConfigs } from '../../controllers/alert-config.controller';
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

const REFUSAL = { success: false, error: 'Insufficient permissions', required: ['owner', 'admin'] };
const BILLING_REFUSAL = { success: false, error: 'Only organization owners and admins can manage billing.' };
const SCHEDULE_ID = '00000000-0000-4000-8000-000000000001';
const SCHEDULE_BODY = {
  name: 'Role gate schedule',
  report_type: 'cost_summary',
  schedule_type: 'daily',
  schedule_time: '09:00',
  timezone: 'UTC',
  delivery_email: true,
  delivery_slack: false,
  email_recipients: ['someone@example.com'],
};

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
    [`Role Gate ${suffix}`, `role-gate-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(label: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Role Gate User') RETURNING id`,
    [`role-gate-${label}-${uniqueSuffix()}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function addMembership(
  orgId: string,
  userId: string,
  role: string,
  state: { isActive?: boolean; invitationToken?: string | null } = {}
): Promise<void> {
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active, invitation_token)
     VALUES ($1, $2, $3, NOW(), $4, $5)`,
    [orgId, userId, role, state.isActive ?? true, state.invitationToken ?? null]
  );
}

async function member(orgId: string, role: string): Promise<string> {
  const userId = await insertUser(role);
  await addMembership(orgId, userId, role);
  return userId;
}

async function buildOrg() {
  const orgId = await insertOrg();
  return {
    orgId,
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

let server: http.Server;
let baseUrl: string;
let org: Org;
/**
 * webhook_endpoints is not part of every schema. Where it is missing the
 * handler has always answered 500 after logging its failed statement, and that
 * log line is then the evidence that the handler ran.
 */
let hasWebhookTable: boolean;
const webhookHandlerRan = (tag: string) => errorSpy.mock.calls.some((call) => call[0] === tag);

let errorSpy: jest.SpyInstance;
let factorySpy: jest.SpyInstance;
let analyzeSpy: jest.SpyInstance;
let reconcileSpy: jest.SpyInstance;
let deleteByIssueSpy: jest.SpyInstance;
let createBulkSpy: jest.SpyInstance;
let syncSpy: jest.SpyInstance;
let anomalyScanSpy: jest.SpyInstance;
let anomalyExplainSpy: jest.SpyInstance;
let anomalySaveSpy: jest.SpyInstance;
let scheduleSpies: Record<'create' | 'update' | 'delete' | 'toggle' | 'test', jest.SpyInstance>;
let sendAlertSpy: jest.SpyInstance;
let stripeCustomerSpy: jest.SpyInstance;
let stripeSessionSpy: jest.SpyInstance;

beforeAll(async () => {
  hasWebhookTable = (await pool.query(`SELECT to_regclass('webhook_endpoints') AS t`)).rows[0].t !== null;
  org = await buildOrg();

  const app = express();
  app.use(express.json());
  app.use('/api/cost-recommendations', costRecommendationsRoutes);
  app.use('/api/security-hub', securityHubRoutes);
  app.use('/api/scheduled-reports', scheduledReportsRoutes);
  app.use('/api/webhooks', webhooksRoutes);
  app.use('/api/alert-config', alertConfigRoutes);
  app.use('/api/stripe', stripeRoutes);
  // The same factory, mounted at the same path, as server.ts.
  app.use('/api/anomalies', createAnomaliesRoutes(appPool));
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

beforeEach(() => {
  errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});

  factorySpy = jest.spyOn(AWSClientFactory, 'createClients').mockRejectedValue(new Error('AWS must not be reached'));
  analyzeSpy = jest
    .spyOn(costOptimizationService, 'analyzeAllResources')
    .mockResolvedValue({ observations: [], riRecommendations: [] } as never);
  reconcileSpy = jest
    .spyOn(CostRecommendationsRepository.prototype, 'reconcileActiveRecommendations')
    .mockResolvedValue({ insertedCount: 0 } as never);
  deleteByIssueSpy = jest.spyOn(CostRecommendationsRepository.prototype, 'deleteActiveByIssue').mockResolvedValue(0 as never);
  createBulkSpy = jest.spyOn(CostRecommendationsRepository.prototype, 'createBulk').mockResolvedValue(0 as never);
  syncSpy = jest.spyOn(SecurityHubSyncService.prototype, 'sync').mockResolvedValue({ status: 'stubbed' } as never);
  // One finding, so an allowed scan goes on to the AI explainer and the write.
  const finding = [{ id: 'role-gate-anomaly' }];
  anomalyScanSpy = jest.spyOn(AnomalyDetectionService.prototype, 'scanForAnomalies').mockResolvedValue(finding as never);
  anomalyExplainSpy = jest.spyOn(AnomalyAIService.prototype, 'explainAnomalies').mockResolvedValue(finding as never);
  anomalySaveSpy = jest.spyOn(AnomalyRepository.prototype, 'saveAnomalies').mockResolvedValue(undefined as never);
  scheduleSpies = {
    create: jest.spyOn(ScheduledReportsService.prototype, 'create').mockResolvedValue({ id: SCHEDULE_ID } as never),
    update: jest.spyOn(ScheduledReportsService.prototype, 'update').mockResolvedValue({ id: SCHEDULE_ID } as never),
    delete: jest.spyOn(ScheduledReportsService.prototype, 'delete').mockResolvedValue(true as never),
    toggle: jest.spyOn(ScheduledReportsService.prototype, 'toggle').mockResolvedValue({ id: SCHEDULE_ID } as never),
    test: jest.spyOn(ScheduledReportsService.prototype, 'test').mockResolvedValue(undefined as never),
  };
  sendAlertSpy = jest.spyOn(AlertNotificationService.prototype, 'sendAlert').mockResolvedValue(undefined);
  jest.spyOn(stripeService, 'getPriceIdForPlan').mockReturnValue('price_role_gate');
  stripeCustomerSpy = jest.spyOn(stripeService, 'createCustomer').mockResolvedValue({ id: 'cus_role_gate' } as never);
  stripeSessionSpy = jest
    .spyOn(stripeService, 'createCheckoutSession')
    .mockResolvedValue({ id: 'cs_role_gate', url: 'https://checkout.example/role-gate' } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
  for (const id of createdOrgIds) alertConfigs.delete(id);
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (hasWebhookTable) {
    await pool.query('DELETE FROM webhook_endpoints WHERE organization_id = ANY($1)', [createdOrgIds]);
  }
  await pool.query('DELETE FROM cost_analysis_runs WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [createdOrgIds]);
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
 * A request authenticated as `userId` in `orgId`. The token's role CLAIM
 * defaults to 'owner', so every refusal below is proven to come from the
 * caller's current membership rather than the claim.
 */
function sendAs(orgId: string, userId: string, method: string, route: string, body?: unknown, jwtRole = 'owner') {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'role-gate-caller@example.com',
    organizationId: orgId,
    role: jwtRole,
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

interface Mutation {
  name: string;
  method: string;
  route: (id: string) => string;
  body?: unknown;
  /** State the request acts on; returns an id for the route and for `happened`. */
  prepare: (orgId: string) => Promise<string>;
  /** What an owner or admin is answered: unchanged by the role gate. */
  allowed: () => number;
  refusal?: Record<string, unknown>;
  /** Whether the consequential work the route exists for was started. */
  happened: (orgId: string, id: string) => Promise<boolean>;
}

async function insertWebhook(orgId: string): Promise<string> {
  if (!hasWebhookTable) return SCHEDULE_ID;
  const { rows } = await pool.query(
    `INSERT INTO webhook_endpoints (url, events, status, secret, organization_id)
     VALUES ('https://example.com/role-gate', ARRAY['alert.triggered'], 'active', 'whsec_role_gate', $1) RETURNING id`,
    [orgId]
  );
  return rows[0].id as string;
}

const mutations: Mutation[] = [
  {
    name: 'POST /api/cost-recommendations/analyze',
    method: 'POST',
    route: () => '/cost-recommendations/analyze',
    prepare: async (orgId) => String(await count('cost_analysis_runs', orgId)),
    allowed: () => 200,
    happened: async (orgId, runsBefore) =>
      analyzeSpy.mock.calls.length +
        reconcileSpy.mock.calls.length +
        deleteByIssueSpy.mock.calls.length +
        createBulkSpy.mock.calls.length >
        0 || (await count('cost_analysis_runs', orgId)) !== Number(runsBefore),
  },
  {
    name: 'POST /api/security-hub/sync',
    method: 'POST',
    route: () => '/security-hub/sync',
    prepare: async () => '',
    allowed: () => 200,
    happened: async () => syncSpy.mock.calls.length > 0,
  },
  {
    name: 'POST /api/anomalies/scan',
    method: 'POST',
    route: () => '/anomalies/scan',
    prepare: async () => '',
    allowed: () => 200,
    happened: async () =>
      anomalyScanSpy.mock.calls.length + anomalyExplainSpy.mock.calls.length + anomalySaveSpy.mock.calls.length > 0,
  },
  {
    name: 'POST /api/scheduled-reports',
    method: 'POST',
    route: () => '/scheduled-reports',
    body: SCHEDULE_BODY,
    prepare: async () => '',
    allowed: () => 201,
    happened: async () => scheduleSpies.create.mock.calls.length > 0,
  },
  {
    name: 'PUT /api/scheduled-reports/:id',
    method: 'PUT',
    route: () => `/scheduled-reports/${SCHEDULE_ID}`,
    body: { email_recipients: ['elsewhere@example.com'] },
    prepare: async () => '',
    allowed: () => 200,
    happened: async () => scheduleSpies.update.mock.calls.length > 0,
  },
  {
    name: 'DELETE /api/scheduled-reports/:id',
    method: 'DELETE',
    route: () => `/scheduled-reports/${SCHEDULE_ID}`,
    prepare: async () => '',
    allowed: () => 200,
    happened: async () => scheduleSpies.delete.mock.calls.length > 0,
  },
  {
    name: 'PATCH /api/scheduled-reports/:id/toggle',
    method: 'PATCH',
    route: () => `/scheduled-reports/${SCHEDULE_ID}/toggle`,
    body: { enabled: false },
    prepare: async () => '',
    allowed: () => 200,
    happened: async () => scheduleSpies.toggle.mock.calls.length > 0,
  },
  {
    name: 'POST /api/scheduled-reports/:id/test',
    method: 'POST',
    route: () => `/scheduled-reports/${SCHEDULE_ID}/test`,
    prepare: async () => '',
    allowed: () => 200,
    happened: async () => scheduleSpies.test.mock.calls.length > 0,
  },
  {
    name: 'POST /api/webhooks',
    method: 'POST',
    route: () => '/webhooks',
    body: { url: 'https://example.com/role-gate-new' },
    prepare: async (orgId) => (hasWebhookTable ? String(await count('webhook_endpoints', orgId)) : ''),
    allowed: () => (hasWebhookTable ? 201 : 500),
    happened: async (orgId, before) =>
      hasWebhookTable ? (await count('webhook_endpoints', orgId)) !== Number(before) : webhookHandlerRan('[webhooks POST]'),
  },
  {
    name: 'DELETE /api/webhooks/:id',
    method: 'DELETE',
    route: (id) => `/webhooks/${id}`,
    prepare: insertWebhook,
    allowed: () => (hasWebhookTable ? 200 : 500),
    happened: async (_orgId, id) =>
      hasWebhookTable
        ? (await pool.query('SELECT 1 FROM webhook_endpoints WHERE id = $1', [id])).rows.length === 0
        : webhookHandlerRan('[webhooks DELETE]'),
  },
  {
    name: 'PUT /api/alert-config/config',
    method: 'PUT',
    route: () => '/alert-config/config',
    body: { slack: { enabled: true, webhookUrl: 'https://hooks.example/role-gate' } },
    prepare: async () => '',
    allowed: () => 200,
    happened: async (orgId) => alertConfigs.has(orgId),
  },
  {
    name: 'POST /api/alert-config/test',
    method: 'POST',
    route: () => '/alert-config/test',
    body: { type: 'slack' },
    prepare: async (orgId) => {
      alertConfigs.set(orgId, { slack: { enabled: true, webhookUrl: 'https://hooks.example/role-gate' } });
      return '';
    },
    allowed: () => 200,
    happened: async () => sendAlertSpy.mock.calls.length > 0,
  },
  {
    name: 'POST /api/stripe/create-checkout-session',
    method: 'POST',
    route: () => '/stripe/create-checkout-session',
    body: { tier: 'pro', billingInterval: 'monthly' },
    prepare: async () => '',
    allowed: () => 200,
    refusal: BILLING_REFUSAL,
    happened: async () => stripeCustomerSpy.mock.calls.length + stripeSessionSpy.mock.calls.length > 0,
  },
];

describe.each(mutations)('$name', ({ method, route, body, prepare, allowed, refusal, happened }) => {
  it.each(['viewer', 'member'] as const)('refuses a %s with 403 and starts nothing', async (role) => {
    const id = await prepare(org.orgId);

    const response = await sendAs(org.orgId, org[role], method, route(id), body);

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject(refusal ?? { ...REFUSAL, current: role });
    expect(await happened(org.orgId, id)).toBe(false);
    expect(factorySpy).not.toHaveBeenCalled();
  });

  it.each(['admin', 'owner'] as const)('answers an %s as before', async (role) => {
    const id = await prepare(org.orgId);

    // The token claims the lowest role: the membership is what counts.
    const response = await sendAs(org.orgId, org[role], method, route(id), body, 'viewer');

    expect(response.status).toBe(allowed());
    expect(await happened(org.orgId, id)).toBe(true);
  });

  it('refuses an inactive or still-pending membership before any role gate', async () => {
    const inactive = await insertUser('inactive');
    await addMembership(org.orgId, inactive, 'owner', { isActive: false });
    const pending = await insertUser('pending');
    await addMembership(org.orgId, pending, 'admin', { isActive: true, invitationToken: `role-gate-${uniqueSuffix()}` });

    for (const userId of [inactive, pending]) {
      const id = await prepare(org.orgId);

      const response = await sendAs(org.orgId, userId, method, route(id), body);

      expect(response.status).toBe(401);
      expect(await response.json()).toMatchObject({ success: false, code: 'MEMBERSHIP_REVOKED' });
      expect(await happened(org.orgId, id)).toBe(false);
    }
  });

  it('takes the role from the organization being acted on, not from another one the caller owns', async () => {
    const home = await buildOrg();
    // Owner at home, viewer here.
    await addMembership(org.orgId, home.owner, 'viewer');
    const id = await prepare(org.orgId);

    const response = await sendAs(org.orgId, home.owner, method, route(id), body);

    expect(response.status).toBe(403);
    expect(await happened(org.orgId, id)).toBe(false);
  });
});

describe('POST /api/anomalies/scan is the route server.ts serves', () => {
  // server.ts starts the server when loaded, so it is read, not imported: the
  // router exercised over HTTP above must be the one it mounts.
  const source = fs.readFileSync(path.join(__dirname, '..', '..', 'server.ts'), 'utf-8');

  it('server.ts mounts this router, once, and no other anomaly router', () => {
    expect(source).toMatch(/import \{ createAnomaliesRoutes \} from '\.\/routes\/anomalies\.routes';/);
    expect(source.match(/app\.use\('\/api\/anomalies'/g)).toHaveLength(1);
    expect(source).toMatch(/app\.use\('\/api\/anomalies', createAnomaliesRoutes\(pool\)\);/);
    expect(source).not.toMatch(/anomaly\.routes/);
    expect(source).not.toMatch(/anomalyRouter/);
  });

  it('an allowed scan runs detection, then the AI explainer, then the write', async () => {
    const response = await sendAs(org.orgId, org.admin, 'POST', '/anomalies/scan');

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, count: 1 });
    expect(anomalyScanSpy).toHaveBeenCalledWith(org.orgId);
    expect(anomalyExplainSpy).toHaveBeenCalledTimes(1);
    expect(anomalySaveSpy).toHaveBeenCalledTimes(1);
  });
});

describe('routes this change leaves alone', () => {
  it.each(['viewer', 'member'] as const)('a %s can still read scheduled reports, webhooks, alert configuration and anomalies', async (role) => {
    jest.spyOn(ScheduledReportsService.prototype, 'list').mockResolvedValue({ schedules: [], total: 0 } as never);
    jest.spyOn(AnomalyRepository.prototype, 'getActiveAnomalies').mockResolvedValue([] as never);
    jest.spyOn(AnomalyRepository.prototype, 'getStats').mockResolvedValue({} as never);

    expect((await sendAs(org.orgId, org[role], 'GET', '/scheduled-reports')).status).toBe(200);
    expect((await sendAs(org.orgId, org[role], 'GET', '/alert-config/config')).status).toBe(200);
    expect((await sendAs(org.orgId, org[role], 'GET', '/webhooks')).status).toBe(hasWebhookTable ? 200 : 500);
    expect((await sendAs(org.orgId, org[role], 'GET', '/anomalies')).status).toBe(200);
    expect((await sendAs(org.orgId, org[role], 'GET', '/anomalies/stats')).status).toBe(200);
  });
});
