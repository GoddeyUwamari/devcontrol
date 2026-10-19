/**
 * An organization with more than one eligible AWS account (AWS_ACCOUNT_AMBIGUOUS,
 * aws-accounts.repository.ts) gets HTTP 409 and one fixed message from every
 * route that would act in "the" account: remediation execute and rollback,
 * POST /api/services/discover, POST /api/cost-recommendations/analyze and
 * GET /api/platform/costs/trend. The body names no organization, account or
 * ARN.
 *
 * Remediation resolves the account before a workflow's status changes, so an
 * ambiguous or missing account refuses with the workflow left as it was and
 * no STS call.
 *
 * aws_accounts_org_id_key (UNIQUE org_id) keeps a second row out of the
 * table, so the ambiguity is produced by stubbing the lookup each route
 * reaches. Real routes over an in-process HTTP server against live Postgres;
 * authService.verifyToken chooses the caller. Placeholders only.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import servicesRoutes from '../services.routes';
import platformRoutes from '../platform.routes';
import costRecommendationsRoutes from '../cost-recommendations.routes';
import { createRemediationRoutes } from '../remediation.routes';
import { authService } from '../../services/auth.service';
import { AWSClientFactory } from '../../services/aws-client-factory.service';
import { AWSCostService } from '../../services/aws-cost.service';
import * as platformSts from '../../services/platform-sts';
import * as accountsRepository from '../../repositories/aws-accounts.repository';
import { AwsAccountAmbiguousError, AWS_ACCOUNT_AMBIGUOUS_MESSAGE } from '../../repositories/aws-accounts.repository';
import { pool as appPool } from '../../config/database';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

// Listeners issue their own fire-and-forget queries; irrelevant here.
jest.mock('../../services/onboardingEvents', () => ({ emitOnboardingEvent: jest.fn() }));

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];
const ORIGINAL_ENV = { ...process.env };

type Caller = { orgId: string; userId: string };

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function buildOrg(): Promise<Caller> {
  const suffix = uniqueSuffix();
  const org = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
    [`Ambiguous Account ${suffix}`, `ambiguous-account-${suffix}`]
  );
  const orgId = org.rows[0].id as string;
  createdOrgIds.push(orgId);
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Ambiguous Account User') RETURNING id`,
    [`ambiguous-account-${suffix}@example.com`]
  );
  const userId = user.rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, 'owner', NOW(), true)`,
    [orgId, userId]
  );
  return { orgId, userId };
}

function send(caller: Caller, method: string, path: string) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: caller.userId,
    email: 'ambiguous-account-caller@example.com',
    organizationId: caller.orgId,
    role: 'owner',
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
  });
}

/** 409 with exactly the fixed message, naming nothing internal. */
async function expectAmbiguous(response: Response, caller: Caller) {
  expect(response.status).toBe(409);
  const body = await response.json();
  expect(body).toEqual({ success: false, error: AWS_ACCOUNT_AMBIGUOUS_MESSAGE });
  const text = JSON.stringify(body);
  expect(text).not.toContain(caller.orgId);
  expect(text).not.toMatch(/AWS_ACCOUNT_AMBIGUOUS|arn:aws:|\b\d{12}\b/);
}

async function workflow(orgId: string, status: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO remediation_workflows
       (organization_id, resource_id, resource_type, action_type, action_params, risk_level, status, rollback_available)
     VALUES ($1, 'i-1234567890abcdef0', 'EC2', 'stop_instance', $2, 'low', $3, true) RETURNING id`,
    [orgId, JSON.stringify({ resource_id: 'i-1234567890abcdef0', region: 'us-east-1' }), status]
  );
  return rows[0].id as string;
}

async function workflowState(id: string) {
  const { rows } = await pool.query(
    `SELECT w.status, w.executed_at, w.execution_log,
            (SELECT COUNT(*)::int FROM remediation_audit_log al WHERE al.workflow_id = w.id) AS audit_rows
       FROM remediation_workflows w WHERE w.id = $1`,
    [id]
  );
  return rows[0];
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await ensureSharedFixtureTable(pool, 'remediation_workflows');
  await ensureSharedFixtureTable(pool, 'remediation_audit_log');

  const app = express();
  app.use(express.json());
  app.use('/api/services', servicesRoutes);
  app.use('/api/platform', platformRoutes);
  app.use('/api/cost-recommendations', costRecommendationsRoutes);
  app.use('/api/remediation', createRemediationRoutes(appPool));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
  delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
  delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM remediation_workflows WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM resource_discovery_jobs WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM cost_analysis_runs WHERE organization_id = ANY($1)', [createdOrgIds]);
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

describe('AWS_ACCOUNT_AMBIGUOUS answers 409 with the fixed message', () => {
  it('POST /api/services/discover', async () => {
    const caller = await buildOrg();
    jest.spyOn(AWSClientFactory, 'createClients').mockRejectedValue(new AwsAccountAmbiguousError(caller.orgId, 2));

    await expectAmbiguous(await send(caller, 'POST', '/services/discover'), caller);
  });

  it('POST /api/cost-recommendations/analyze', async () => {
    const caller = await buildOrg();
    jest.spyOn(AWSClientFactory, 'createClients').mockRejectedValue(new AwsAccountAmbiguousError(caller.orgId, 2));

    await expectAmbiguous(await send(caller, 'POST', '/cost-recommendations/analyze'), caller);
  });

  it('GET /api/platform/costs/trend', async () => {
    const caller = await buildOrg();
    jest.spyOn(AWSCostService, 'createForOrg').mockRejectedValue(new AwsAccountAmbiguousError(caller.orgId, 2));

    await expectAmbiguous(await send(caller, 'GET', '/platform/costs/trend?range=30d'), caller);
  });

  it.each([
    ['execute', 'approved'],
    ['rollback', 'completed'],
  ] as const)('POST /api/remediation/:id/%s: refused before any status change or STS call', async (action, status) => {
    const caller = await buildOrg();
    const id = await workflow(caller.orgId, status);
    const before = await workflowState(id);
    jest.spyOn(accountsRepository, 'findEligibleAwsAccount').mockRejectedValue(new AwsAccountAmbiguousError(caller.orgId, 2));
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform');

    await expectAmbiguous(await send(caller, 'POST', `/remediation/${id}/${action}`), caller);

    expect(assumeRole).not.toHaveBeenCalled();
    expect(await workflowState(id)).toEqual(before);
  });
});

describe('remediation execute with no eligible account', () => {
  it('is refused with the workflow still approved: no executing status, no audit row, no STS call', async () => {
    const caller = await buildOrg();
    const id = await workflow(caller.orgId, 'approved');
    const before = await workflowState(id);
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform');

    const response = await send(caller, 'POST', `/remediation/${id}/execute`);

    expect(response.status).not.toBe(200);
    expect(assumeRole).not.toHaveBeenCalled();
    expect(await workflowState(id)).toEqual(before);
    expect(before).toMatchObject({ status: 'approved', audit_rows: 0 });
  });
});
