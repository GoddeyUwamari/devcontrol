/**
 * Routes when the platform's own AWS identity is unavailable, and what any
 * AWS failure is allowed to put in a response body.
 *
 * Policy under test:
 *   - GET /api/slos/:id/evaluate, GET /api/slos/evaluate and
 *     POST /api/services/discover answer 503 with the fixed "DevControl cannot
 *     reach AWS" message when AWSClientFactory.createClients rejects with
 *     PlatformAwsCredentialsUnavailableError -- through the real SLO
 *     evaluation and discovery code, never a "not connected" answer.
 *   - A 500 from POST /api/services/discover or GET /api/aws/costs/monthly
 *     carries a fixed message: no ARN, no account ID, no raw AWS message. The
 *     real error goes to the server log.
 *   - POST /api/services/discover still answers an organization that is not
 *     connected with its 409, and a discovery run that fails stores only a
 *     fixed error_message (the user reads it on GET /discovery/jobs).
 *
 * Real routes over an in-process HTTP server against live Postgres. Stubbed:
 * authService.verifyToken (to choose the caller), AWSClientFactory.createClients
 * and the Cost Explorer fetch (the two calls that would reach AWS), and the
 * SLO definition lookup.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import servicesRoutes from '../services.routes';
import awsRoutes from '../aws.routes';
import { createSloRoutes } from '../slo.routes';
import { authService } from '../../services/auth.service';
import { AWSClientFactory } from '../../services/aws-client-factory.service';
import awsCostService from '../../services/aws-cost.service';
import { SloService, SloDefinition } from '../../services/slo.service';
import { PlatformAwsCredentialsUnavailableError, PLATFORM_AWS_UNAVAILABLE_MESSAGE } from '../../services/platform-sts';
import { DISCOVERY_FAILED_MESSAGE } from '../../services/awsResourceDiscovery';
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

// Placeholder principals only.
const CALLER = 'arn:aws:sts::111122223333:assumed-role/DevControlInstanceRole/i-0123456789abcdef0';
const ROLE = 'arn:aws:iam::123456789012:role/DevControlRole';
const RAW_AWS_MESSAGE = `User: ${CALLER} is not authorized to perform: sts:AssumeRole on resource: ${ROLE}`;

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function buildOrg(): Promise<{ orgId: string; userId: string }> {
  const suffix = uniqueSuffix();
  const org = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'enterprise', 'active') RETURNING id`,
    [`Platform AWS ${suffix}`, `platform-aws-${suffix}`, `Platform AWS ${suffix}`]
  );
  const orgId = org.rows[0].id as string;
  createdOrgIds.push(orgId);
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Platform AWS User') RETURNING id`,
    [`platform-aws-${suffix}@example.com`]
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

function send(caller: { orgId: string; userId: string }, method: string, path: string) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: caller.userId,
    email: 'platform-aws-caller@example.com',
    organizationId: caller.orgId,
    role: 'owner',
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
  });
}

function definition(orgId: string): SloDefinition {
  return {
    id: '00000000-0000-4000-8000-000000000001',
    organizationId: orgId,
    name: 'checkout availability',
    resourceType: 'ec2',
    resourceId: 'i-0123456789abcdef0',
    sli: 'ec2_availability',
    targetValue: 99.9,
    evaluationWindow: '24h',
    enabled: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

function platformUnavailable(): PlatformAwsCredentialsUnavailableError {
  return new PlatformAwsCredentialsUnavailableError(
    Object.assign(new Error('Could not load credentials from any providers'), { name: 'CredentialsProviderError' })
  );
}

/** A response body that names no ARN, no 12-digit account ID, and none of the raw AWS message. */
function expectNothingInternal(body: unknown) {
  const text = JSON.stringify(body);
  expect(text).not.toMatch(/arn:aws:/);
  expect(text).not.toMatch(/\b\d{12}\b/);
  expect(text).not.toContain('is not authorized to perform');
  expect(text).not.toContain('i-0123456789abcdef0');
}

let server: http.Server;
let baseUrl: string;
let createClients: jest.SpyInstance;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/services', servicesRoutes);
  app.use('/api/aws', awsRoutes);
  app.use('/api/slos', createSloRoutes(appPool));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  createClients = jest.spyOn(AWSClientFactory, 'createClients');
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM resource_discovery_jobs WHERE organization_id = ANY($1)', [createdOrgIds]);
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

describe('the platform identity unavailable: 503, not "not connected"', () => {
  it('GET /api/slos/:id/evaluate', async () => {
    const caller = await buildOrg();
    jest.spyOn(SloService.prototype, 'getSlo').mockResolvedValue(definition(caller.orgId));
    createClients.mockRejectedValue(platformUnavailable());

    const res = await send(caller, 'GET', `/slos/${definition(caller.orgId).id}/evaluate`);

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, message: PLATFORM_AWS_UNAVAILABLE_MESSAGE });
    // Reached through the real SLO evaluation, not short-circuited.
    expect(createClients).toHaveBeenCalledWith(caller.orgId);
  });

  it('GET /api/slos/evaluate', async () => {
    const caller = await buildOrg();
    jest.spyOn(SloService.prototype, 'listSlos').mockResolvedValue([definition(caller.orgId)]);
    createClients.mockRejectedValue(platformUnavailable());

    const res = await send(caller, 'GET', '/slos/evaluate');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, message: PLATFORM_AWS_UNAVAILABLE_MESSAGE });
    expect(createClients).toHaveBeenCalledWith(caller.orgId);
  });

  it('control: an organization AssumeRole failure still evaluates as not connected, not 503', async () => {
    const caller = await buildOrg();
    jest.spyOn(SloService.prototype, 'listSlos').mockResolvedValue([definition(caller.orgId)]);
    createClients.mockRejectedValue(new Error(`AWS_NOT_CONNECTED: org ${caller.orgId} has not connected an AWS account`));

    const res = await send(caller, 'GET', '/slos/evaluate');

    expect(res.status).toBe(200);
    expect((await res.json()).success).toBe(true);
  });

  it('POST /api/services/discover, through the real discovery run', async () => {
    const caller = await buildOrg();
    createClients.mockRejectedValue(platformUnavailable());

    const res = await send(caller, 'POST', '/services/discover');

    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ success: false, error: PLATFORM_AWS_UNAVAILABLE_MESSAGE });
    expect(createClients).toHaveBeenCalledWith(caller.orgId);
    // The run itself was recorded as failed, with the fixed message, not the internal tag.
    const { rows } = await pool.query('SELECT status, error_message FROM resource_discovery_jobs WHERE organization_id = $1', [caller.orgId]);
    expect(rows).toEqual([{ status: 'failed', error_message: PLATFORM_AWS_UNAVAILABLE_MESSAGE }]);
  });
});

describe('POST /api/services/discover for an organization that is not connected: unchanged', () => {
  it('409 aws_not_connected, and the failed run stores the fixed message', async () => {
    const caller = await buildOrg();
    createClients.mockRejectedValue(new Error(`AWS_NOT_CONNECTED: org ${caller.orgId} has not connected an AWS account`));

    const res = await send(caller, 'POST', '/services/discover');

    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: 'aws_not_connected', message: 'Please connect your AWS account in Settings to run audits.' });
    const { rows } = await pool.query('SELECT status, error_message FROM resource_discovery_jobs WHERE organization_id = $1', [caller.orgId]);
    expect(rows).toEqual([{ status: 'failed', error_message: DISCOVERY_FAILED_MESSAGE }]);
  });
});

describe('a 500 carries a fixed message, never the AWS error', () => {
  it('POST /api/services/discover', async () => {
    const caller = await buildOrg();
    createClients.mockRejectedValue(Object.assign(new Error(RAW_AWS_MESSAGE), { name: 'Throttling' }));

    const res = await send(caller, 'POST', '/services/discover');

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({ success: false, error: 'Discovery failed. Please try again later.' });
    expectNothingInternal(body);
    const { rows } = await pool.query('SELECT error_message FROM resource_discovery_jobs WHERE organization_id = $1', [caller.orgId]);
    expect(rows).toEqual([{ error_message: DISCOVERY_FAILED_MESSAGE }]);
    expectNothingInternal(rows[0].error_message);
  });

  it('GET /api/aws/costs/monthly', async () => {
    const caller = await buildOrg();
    const raw = Object.assign(new Error(RAW_AWS_MESSAGE), { name: 'AccessDenied' });
    jest.spyOn(awsCostService, 'fetchMonthlyCosts').mockRejectedValue(raw);
    const logged = jest.spyOn(console, 'error').mockImplementation(() => {});

    const res = await send(caller, 'GET', '/aws/costs/monthly');

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: 'Failed to fetch monthly costs',
      message: 'Monthly cost data is unavailable right now. Please try again later.',
    });
    expectNothingInternal(body);
    // The real error is in the server log.
    expect(logged).toHaveBeenCalledWith('Error fetching monthly costs:', raw);
  });
});
