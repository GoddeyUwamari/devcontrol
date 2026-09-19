/**
 * Live-DB, HTTP-level coverage for the Phase 1 security foundation's API
 * boundary enforcement: a direct authenticated request -- not just the UI --
 * must be rejected for custom_script/relationship_check rule types, unsafe
 * tag_pattern regexes, framework_type: 'built_in', and reserved/branded
 * framework names, with a controlled 4xx and a stable machine-readable code,
 * never a 500. Also proves the happy path (a V1-vocabulary rule, a
 * legitimately-named custom framework) still succeeds and correctly
 * populates the new organization_id columns end to end.
 *
 * Runs the real compliance-frameworks.routes.ts against a real Pool
 * connected to local dev Postgres (already migrated by
 * 202609191430_compliance_framework_security_foundation.sql) -- auth/tier
 * middleware are stubbed (same convention as
 * security-hub-frameworks-route.test.ts / compliance-legacy-engine-
 * retirement.test.ts), the property under test is this feature's own
 * validation and repository behavior, not the auth stack.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { Pool } from 'pg';

// Node's global fetch types Response.json() as Promise<unknown> (it has no
// way to know this API's response shape) -- narrow it here once rather than
// casting at every call site.
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
    // created_by (framework creation) is a nullable UUID FK to users(id) -- deliberately
    // omitted rather than given a fabricated UUID, which would fail as a foreign-key
    // violation against a users row that doesn't exist in this test's fixture.
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
    [`CF Security Org ${suffix}`, `cf-security-org-${suffix}`, `CF Security Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertFramework(orgId: string, name: string): Promise<string> {
  const { rows } = await testPool.query(
    `INSERT INTO compliance_frameworks (organization_id, name, framework_type) VALUES ($1, $2, 'custom') RETURNING id`,
    [orgId, name]
  );
  return rows[0].id as string;
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

describe('POST /api/compliance-frameworks -- framework branding boundary', () => {
  it('rejects framework_type: "built_in" with a controlled 400 and a stable code, never a 500', async () => {
    currentOrgId = await insertOrg();
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Attempted Built-In', framework_type: 'built_in' }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.success).toBe(false);
    expect(body.code).toBe('BUILT_IN_FRAMEWORK_NOT_ALLOWED');
  });

  it.each(['SOC 2', 'soc2', 'SOC2', 'NIST 800-53', 'PCI-DSS', 'CIS AWS Foundations', 'HIPAA'])(
    'rejects the reserved name "%s" with RESERVED_FRAMEWORK_NAME, never a 500',
    async (name) => {
      currentOrgId = await insertOrg();
      const res = await fetch(baseUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
      });
      expect(res.status).toBe(400);
      const body = await jsonBody(res);
      expect(body.success).toBe(false);
      expect(body.code).toBe('RESERVED_FRAMEWORK_NAME');
    }
  );

  it('rejects a reserved standard_name even when the framework name itself is legitimate', async () => {
    currentOrgId = await insertOrg();
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'My Internal Framework', standard_name: 'PCI DSS' }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe('RESERVED_FRAMEWORK_NAME');
  });

  it('accepts a legitimate custom name and persists it as framework_type "custom" with the correct organization_id', async () => {
    currentOrgId = await insertOrg();
    const res = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'Internal Data Handling Policy' }),
    });
    expect(res.status).toBe(201);
    const body = await jsonBody(res);
    expect(body.success).toBe(true);
    expect(body.data.framework_type).toBe('custom');
    expect(body.data.organization_id).toBe(currentOrgId);
  });

  it('rejects renaming an existing framework to a reserved name via PUT', async () => {
    currentOrgId = await insertOrg();
    const fwId = await insertFramework(currentOrgId, 'Legit Name');
    const res = await fetch(`${baseUrl}/${fwId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'NIST' }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe('RESERVED_FRAMEWORK_NAME');
  });
});

describe('POST /api/compliance-frameworks/:id/rules -- rule-type and regex-safety boundary', () => {
  it.each(['custom_script', 'relationship_check'])(
    'rejects rule_type "%s" with UNSUPPORTED_RULE_TYPE, never executing anything, never a 500',
    async (ruleType) => {
      currentOrgId = await insertOrg();
      const fwId = await insertFramework(currentOrgId, 'Framework Under Test');
      const res = await fetch(`${baseUrl}/${fwId}/rules`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          rule_code: 'RULE-1',
          title: 'Test rule',
          severity: 'high',
          category: 'custom',
          rule_type: ruleType,
          conditions: ruleType === 'custom_script' ? { script: 'return resource.is_encrypted === true;' } : {},
          recommendation: 'Fix it',
        }),
      });
      expect(res.status).toBe(400);
      const body = await jsonBody(res);
      expect(body.success).toBe(false);
      expect(body.code).toBe('UNSUPPORTED_RULE_TYPE');

      // Never persisted.
      const { rows } = await testPool.query(
        `SELECT count(*)::int AS n FROM compliance_framework_rules WHERE framework_id = $1`,
        [fwId]
      );
      expect(rows[0].n).toBe(0);
    }
  );

  it('rejects a catastrophic-backtracking tag_pattern with UNSAFE_REGEX_PATTERN', async () => {
    currentOrgId = await insertOrg();
    const fwId = await insertFramework(currentOrgId, 'Framework Under Test');
    const res = await fetch(`${baseUrl}/${fwId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rule_code: 'RULE-2',
        title: 'Unsafe pattern rule',
        severity: 'medium',
        category: 'tagging',
        rule_type: 'tag_pattern',
        conditions: { tag_key: 'Environment', pattern: '(a+)+$' },
        recommendation: 'Fix it',
      }),
    });
    expect(res.status).toBe(400);
    const body = await jsonBody(res);
    expect(body.code).toBe('UNSAFE_REGEX_PATTERN');
  });

  it('accepts a safe tag_pattern rule and persists it with the correct organization_id', async () => {
    currentOrgId = await insertOrg();
    const fwId = await insertFramework(currentOrgId, 'Framework Under Test');
    const res = await fetch(`${baseUrl}/${fwId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rule_code: 'RULE-3',
        title: 'Environment tag pattern',
        severity: 'low',
        category: 'tagging',
        rule_type: 'tag_pattern',
        conditions: { tag_key: 'Environment', pattern: '^(prod|staging|dev)$' },
        recommendation: 'Fix it',
      }),
    });
    expect(res.status).toBe(201);
    const body = await jsonBody(res);
    expect(body.success).toBe(true);
    expect(body.data.organization_id).toBe(currentOrgId);
    expect(body.data.rule_type).toBe('tag_pattern');
  });

  it('rejects an update that changes an existing rule\'s pattern to an unsafe one', async () => {
    currentOrgId = await insertOrg();
    const fwId = await insertFramework(currentOrgId, 'Framework Under Test');
    const createRes = await fetch(`${baseUrl}/${fwId}/rules`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        rule_code: 'RULE-4',
        title: 'Environment tag pattern',
        severity: 'low',
        category: 'tagging',
        rule_type: 'tag_pattern',
        conditions: { tag_key: 'Environment', pattern: '^(prod|staging|dev)$' },
        recommendation: 'Fix it',
      }),
    });
    const created = (await jsonBody(createRes)).data;

    const updateRes = await fetch(`${baseUrl}/rules/${created.id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ conditions: { tag_key: 'Environment', pattern: '([a-zA-Z]+)*$' } }),
    });
    expect(updateRes.status).toBe(400);
    const body = await jsonBody(updateRes);
    expect(body.code).toBe('UNSAFE_REGEX_PATTERN');
  });
});
