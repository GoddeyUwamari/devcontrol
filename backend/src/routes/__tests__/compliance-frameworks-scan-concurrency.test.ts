/**
 * Route/controller-level coverage for duplicate/concurrent scan prevention,
 * exercised through the real, unmocked HTTP path -- the exact shape a real
 * double-click, two tabs, or two independent API callers would hit.
 *
 * Confirms POST /api/compliance-frameworks/:id/scan now:
 *   - returns 200 with data.scanId on a successful start
 *   - returns 409 { success:false, error:'SCAN_IN_PROGRESS', message:'...' }
 *     when another scan is already active for the same framework, with no
 *     raw database/advisory-lock detail ever exposed
 *   - never applies this to two DIFFERENT frameworks (no global lock)
 *   - allows a fresh scan for the same framework again once the prior one
 *     has completed
 *
 * Runs the real compliance-frameworks.routes.ts against a real Pool
 * connected to local dev Postgres -- same convention as
 * compliance-frameworks-scan-lifecycle.test.ts.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { Pool } from 'pg';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const testPool = new Pool(dbConfig());

jest.mock('../../config/database', () => ({
  pool: testPool,
}));

let currentOrgId = '';
jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = currentOrgId;
    req.user = { email: 't@example.com', organizationId: currentOrgId, role: 'owner' };
    next();
  },
}));

jest.mock('../../middleware/subscription.middleware', () => ({
  requireEnterprise: (_req: any, _res: any, next: any) => next(),
}));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const complianceFrameworksRoutes = require('../compliance-frameworks.routes').default;

let server: http.Server;
let baseUrl: string;
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await testPool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'enterprise', 'active') RETURNING id`,
    [`Scan Concurrency Route Org ${suffix}`, `scan-concurrency-route-org-${suffix}`, `Scan Concurrency Route Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertFramework(orgId: string): Promise<string> {
  const { rows } = await testPool.query(
    `INSERT INTO compliance_frameworks (organization_id, name, framework_type) VALUES ($1, $2, 'custom') RETURNING id`,
    [orgId, `Framework ${uniqueSuffix()}`]
  );
  return rows[0].id as string;
}

async function insertRule(frameworkId: string, orgId: string): Promise<void> {
  await testPool.query(
    `INSERT INTO compliance_framework_rules
       (framework_id, organization_id, rule_code, title, severity, category, rule_type, conditions, recommendation)
     VALUES ($1, $2, $3, 'Encryption required', 'high', 'encryption', 'property_check',
             '{"property":"is_encrypted","operator":"equals","value":true}', 'Enable encryption')`,
    [frameworkId, orgId, `RULE-${uniqueSuffix()}`]
  );
}

async function insertResource(orgId: string): Promise<void> {
  const suffix = uniqueSuffix();
  await testPool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, is_encrypted)
     VALUES ($1, $2, $3, 's3', 'us-east-1', 'active', true)`,
    [orgId, `arn:aws:s3:::bucket-${suffix}`, `bucket-${suffix}`]
  );
}

async function postScan(frameworkId: string): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl}/${frameworkId}/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
  });
  return { status: res.status, body: await res.json() };
}

async function waitForScanCompletion(frameworkId: string, timeoutMs = 10000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await testPool.query(
      `SELECT * FROM compliance_scans WHERE framework_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [frameworkId]
    );
    if (rows[0] && (rows[0].status === 'completed' || rows[0].status === 'failed')) return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Scan for framework ${frameworkId} did not reach a terminal state within ${timeoutMs}ms`);
}

beforeAll((done) => {
  const app = express();
  app.use(express.json());
  app.use('/api/compliance-frameworks', complianceFrameworksRoutes);
  server = app.listen(0, () => {
    const { port } = server.address() as AddressInfo;
    baseUrl = `http://localhost:${port}/api/compliance-frameworks`;
    done();
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdOrgIds.length > 0) {
    await testPool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await testPool.end();
});

describe('POST /api/compliance-frameworks/:id/scan -- duplicate/concurrent prevention', () => {
  it('a successful start returns 200 with data.scanId', async () => {
    currentOrgId = await insertOrg();
    const fwId = await insertFramework(currentOrgId);
    await insertRule(fwId, currentOrgId);
    await insertResource(currentOrgId);

    const { status, body } = await postScan(fwId);
    expect(status).toBe(200);
    expect(body.success).toBe(true);
    expect(typeof body.data.scanId).toBe('string');

    await waitForScanCompletion(fwId);
  });

  it('G: two real, concurrent requests for the SAME framework -- one 200, one 409 SCAN_IN_PROGRESS, no raw DB details leaked', async () => {
    currentOrgId = await insertOrg();
    const fwId = await insertFramework(currentOrgId);
    await insertRule(fwId, currentOrgId);
    await insertResource(currentOrgId);

    const [first, second] = await Promise.all([postScan(fwId), postScan(fwId)]);

    const statuses = [first.status, second.status].sort();
    expect(statuses).toEqual([200, 409]);

    const conflict = first.status === 409 ? first : second;
    const started = first.status === 200 ? first : second;

    expect(conflict.body).toEqual({
      success: false,
      error: 'SCAN_IN_PROGRESS',
      message: 'A scan is already in progress for this framework.',
    });
    expect(typeof started.body.data.scanId).toBe('string');

    // No raw Postgres/advisory-lock detail anywhere in the conflict body.
    const serialized = JSON.stringify(conflict.body).toLowerCase();
    expect(serialized).not.toMatch(/pg_|advisory|postgres|constraint|relation/);

    await waitForScanCompletion(fwId);
  });

  it('two real, concurrent requests for DIFFERENT frameworks both start -- no global serialization', async () => {
    // Both frameworks share one organization deliberately: currentOrgId is a
    // single shared fixture variable read by the mocked auth middleware when
    // each request is actually processed, not when postScan() is called --
    // reassigning it between two genuinely concurrent fetches (two orgs)
    // would race against Express's own request handling. Cross-org
    // concurrency (different lock keys, no shared fixture) is already
    // covered at the service level in custom-compliance.concurrency.test.ts
    // (test B); this test's own job is narrower: prove two different
    // frameworks aren't serialized against each other at the HTTP layer.
    currentOrgId = await insertOrg();
    const fwA = await insertFramework(currentOrgId);
    const fwB = await insertFramework(currentOrgId);
    await insertRule(fwA, currentOrgId);
    await insertRule(fwB, currentOrgId);
    await insertResource(currentOrgId);
    await insertResource(currentOrgId);

    const [resA, resB] = await Promise.all([postScan(fwA), postScan(fwB)]);
    expect(resA.status).toBe(200);
    expect(resB.status).toBe(200);

    await waitForScanCompletion(fwA);
    await waitForScanCompletion(fwB);
  });

  it('a completed scan does not block a later legitimate scan for the same framework', async () => {
    currentOrgId = await insertOrg();
    const fwId = await insertFramework(currentOrgId);
    await insertRule(fwId, currentOrgId);
    await insertResource(currentOrgId);

    const firstPost = await postScan(fwId);
    expect(firstPost.status).toBe(200);
    await waitForScanCompletion(fwId);

    const secondPost = await postScan(fwId);
    expect(secondPost.status).toBe(200);
    expect(secondPost.body.data.scanId).not.toBe(firstPost.body.data.scanId);
  });

  it('framework-not-found remains 404 and is checked before any lock/scan attempt', async () => {
    currentOrgId = await insertOrg();
    const { status, body } = await postScan('00000000-0000-0000-0000-000000000000');
    expect(status).toBe(404);
    expect(body).toEqual({ success: false, error: 'Framework not found' });
  });
});
