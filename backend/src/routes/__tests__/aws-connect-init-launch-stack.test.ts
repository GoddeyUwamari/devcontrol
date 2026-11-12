/**
 * connect-init and the CloudFormation Launch stack link (AWS connect PR D2).
 *
 * R1: with no D2 configuration, the connect-init response is exactly what it
 * was before D2. The fixture was captured from the unchanged route (HEAD
 * 841a6b63) by this harness; the org's External ID is replaced by the
 * placeholder {{ORG_EXTERNAL_ID}} and the platform account is the documentation
 * example. Real route, real authenticate middleware, real database; no AWS.
 */
import fs from 'fs';
import path from 'path';
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import awsRoutes from '../aws.routes';
import { authService } from '../../services/auth.service';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const PLATFORM_ACCOUNT_ID = '123456789012';
const R1_BASELINE = path.join(__dirname, '__fixtures__', 'connect-init-r1-baseline.json');
const D2_ENV = ['CONNECT_LAUNCH_STACK_ENABLED', 'CONNECT_TEMPLATE_URL', 'CONNECT_TEMPLATE_VERSION', 'CONNECT_LAUNCH_STACK_REGION'] as const;

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
const savedEnv: Record<string, string | undefined> = {};

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOwner(role: 'owner' | 'member' = 'owner'): Promise<{ orgId: string; userId: string }> {
  const suffix = uniqueSuffix();
  const org = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Launch Stack ${suffix}`, `launch-stack-${suffix}`]
  );
  const orgId = org.rows[0].id as string;
  createdOrgIds.push(orgId);
  const user = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Launch Stack') RETURNING id`,
    [`launch-stack-${suffix}@example.com`]
  );
  const userId = user.rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, $3, NOW(), true)`,
    [orgId, userId, role]
  );
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId, email: 'launch-stack@example.com', organizationId: orgId, role, type: 'access',
  } as any);
  return { orgId, userId };
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  savedEnv.AWS_ACCOUNT_ID = process.env.AWS_ACCOUNT_ID;
  for (const key of D2_ENV) savedEnv[key] = process.env[key];
  process.env.AWS_ACCOUNT_ID = PLATFORM_ACCOUNT_ID;
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await ensureSharedFixtureTable(pool, 'aws_connect_sessions');
  const app = express();
  app.use(express.json());
  app.use('/api/aws', awsRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api/aws`;
});

afterAll(async () => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM aws_connect_sessions WHERE org_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)', [createdOrgIds, createdUserIds]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
});

beforeEach(() => {
  for (const key of D2_ENV) delete process.env[key];
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

const auth = { Authorization: 'Bearer test-token' };
async function connectInit() {
  const res = await fetch(`${baseUrl}/accounts/connect-init`, { headers: auth });
  return { status: res.status, body: await res.json() as any, cacheControl: res.headers.get('cache-control') };
}

/** The response with the org's own External ID replaced by the fixture's placeholder. */
function normalized(response: { status: number; body: unknown; cacheControl: string | null }, externalId: string): unknown {
  return JSON.parse(JSON.stringify({ status: response.status, cacheControl: response.cacheControl, body: response.body }).split(externalId).join('{{ORG_EXTERNAL_ID}}'));
}

describe('R1: connect-init without D2 configuration is unchanged', () => {
  it('deep-equals the baseline captured before D2', async () => {
    await insertOwner();
    const response = await connectInit();
    const externalId = response.body.data.externalId;
    expect(externalId).toMatch(/^[A-Za-z0-9_-]{32}$/);
    const baseline = JSON.parse(fs.readFileSync(R1_BASELINE, 'utf8'));
    expect(normalized(response, externalId)).toStrictEqual(baseline);
    expect('launchStack' in response.body.data).toBe(false);
  });
});

const TEMPLATE_URL = 'https://template-bucket.s3.us-east-1.amazonaws.com/cloudformation/devcontrol-role/v1/devcontrol-role.v1.json';
function enableLaunchStack(): void {
  process.env.CONNECT_LAUNCH_STACK_ENABLED = 'true';
  process.env.CONNECT_TEMPLATE_URL = TEMPLATE_URL;
  process.env.CONNECT_TEMPLATE_VERSION = '1';
}

describe('R2: with the switch on and a valid template, each org gets its own link', () => {
  it('adds launchStack with the org\'s own External ID and leaves every other field as in R1', async () => {
    enableLaunchStack();
    await insertOwner();
    const response = await connectInit();
    const externalId = response.body.data.externalId;
    const { launchStack, ...rest } = response.body.data;
    expect(launchStack).toEqual({
      url: expect.stringMatching(/^https:\/\/us-east-1\.console\.aws\.amazon\.com\/cloudformation\/home\?region=us-east-1#\/stacks\/create\/review\?/),
      templateVersion: '1',
      templateUrl: TEMPLATE_URL,
    });
    const params = new URLSearchParams(launchStack.url.slice(launchStack.url.indexOf('#') + 1).split('?')[1]);
    expect(params.get('param_ExternalId')).toBe(externalId);
    expect(params.get('templateURL')).toBe(TEMPLATE_URL);
    const baseline = JSON.parse(fs.readFileSync(R1_BASELINE, 'utf8'));
    expect(normalized({ ...response, body: { ...response.body, data: rest } }, externalId)).toStrictEqual(baseline);
  });

  it('two organizations get two different links', async () => {
    enableLaunchStack();
    await insertOwner();
    const first = (await connectInit()).body.data;
    await insertOwner();
    const second = (await connectInit()).body.data;
    expect(first.externalId).not.toBe(second.externalId);
    expect(first.launchStack.url).toContain(`param_ExternalId=${encodeURIComponent(first.externalId)}`);
    expect(second.launchStack.url).toContain(`param_ExternalId=${encodeURIComponent(second.externalId)}`);
    expect(first.launchStack.url).not.toBe(second.launchStack.url);
  });

  it('an invalid template configuration leaves the response exactly as in R1', async () => {
    enableLaunchStack();
    process.env.CONNECT_TEMPLATE_URL = `${TEMPLATE_URL}?X-Amz-Signature=x`;
    await insertOwner();
    const response = await connectInit();
    const baseline = JSON.parse(fs.readFileSync(R1_BASELINE, 'utf8'));
    expect(normalized(response, response.body.data.externalId)).toStrictEqual(baseline);
  });
});

describe('R3: access and caching are unchanged', () => {
  it('stays private, no-store with the link', async () => {
    enableLaunchStack();
    await insertOwner();
    const response = await connectInit();
    expect(response.status).toBe(200);
    expect(response.cacheControl).toBe('private, no-store');
  });

  it('a member is refused before any link is built', async () => {
    enableLaunchStack();
    await insertOwner('member');
    const response = await connectInit();
    expect(response.status).toBe(403);
    expect(JSON.stringify(response.body)).not.toContain('launchStack');
    expect(JSON.stringify(response.body)).not.toContain('console.aws.amazon.com');
  });
});
