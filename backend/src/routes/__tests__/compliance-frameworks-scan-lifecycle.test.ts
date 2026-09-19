/**
 * Route-level regression coverage for the Phase 2 scan connection-lifecycle
 * fix, exercised through the real, unmocked HTTP path (the exact shape the
 * original bug lived in): compliance-frameworks.controller.ts's executeScan
 * never awaits CustomComplianceService.executeScan() before responding, so
 * the scan keeps running -- and keeps issuing database queries -- after the
 * HTTP response has already completed. Before the Phase 2 fix, the scan
 * used the request-scoped AsyncLocalStorage client, released as soon as the
 * response finished; this file proves the scan now still reaches
 * 'completed' correctly afterward, using its own dedicated connection.
 *
 * Runs the real compliance-frameworks.routes.ts against a real Pool
 * connected to local dev Postgres -- same convention as
 * compliance-frameworks-security-foundation.test.ts (auth/tier middleware
 * stubbed, everything else real).
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { Pool } from 'pg';

async function jsonBody(res: Response): Promise<any> {
  return res.json();
}

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
    [`Scan Route Org ${suffix}`, `scan-route-org-${suffix}`, `Scan Route Org ${suffix}`]
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

async function waitForScanCompletion(frameworkId: string, timeoutMs = 10000): Promise<any> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const { rows } = await testPool.query(
      `SELECT * FROM compliance_scans WHERE framework_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [frameworkId]
    );
    if (rows[0] && rows[0].status === 'completed') return rows[0];
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`Scan for framework ${frameworkId} did not reach 'completed' within ${timeoutMs}ms`);
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

describe('POST /api/compliance-frameworks/:id/scan -- survives HTTP response completion', () => {
  it('the HTTP response returns immediately, and the scan still reaches "completed" afterward with correct results', async () => {
    currentOrgId = await insertOrg();
    const fwId = await insertFramework(currentOrgId);
    await insertRule(fwId, currentOrgId);
    await insertResource(currentOrgId);

    const res = await fetch(`${baseUrl}/${fwId}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = await jsonBody(res);
    expect(body.success).toBe(true);

    // The response above has already completed -- per the pre-fix design,
    // this is exactly the point at which the request-scoped RLS client
    // would have been released back to the pool while the scan (if still
    // running) kept using it. The scan is polled for afterward, on its own,
    // proving it doesn't depend on anything from the now-finished request.
    const scan = await waitForScanCompletion(fwId);
    expect(scan.organization_id).toBe(currentOrgId);
    expect(scan.compliance_score).toBe('100.00');
    expect(scan.resources_scanned).toBe(1);

    const { rows: findings } = await testPool.query(
      `SELECT organization_id, status FROM compliance_scan_findings WHERE scan_id = $1`,
      [scan.id]
    );
    expect(findings).toHaveLength(1);
    expect(findings[0].organization_id).toBe(currentOrgId);
    expect(findings[0].status).toBe('pass');
  });

  it('a second, unrelated request completing while the first scan is still running does not corrupt the scan', async () => {
    const orgA = await insertOrg();
    const fwA = await insertFramework(orgA);
    await insertRule(fwA, orgA);
    await insertResource(orgA);

    currentOrgId = orgA;
    const scanRes = await fetch(`${baseUrl}/${fwA}/scan`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(scanRes.status).toBe(200);

    // Fired immediately after the scan-triggering response completes, for a
    // *different* organization -- exercising the shared pool concurrently
    // with whatever the (now-detached) scan is still doing.
    const orgB = await insertOrg();
    currentOrgId = orgB;
    const listRes = await fetch(baseUrl, { headers: {} });
    expect(listRes.status).toBe(200);
    const listBody = await jsonBody(listRes);
    expect(listBody.data).toEqual([]); // orgB has no frameworks of its own

    const scan = await waitForScanCompletion(fwA);
    expect(scan.organization_id).toBe(orgA);
    expect(scan.status).toBe('completed');
  });
});
