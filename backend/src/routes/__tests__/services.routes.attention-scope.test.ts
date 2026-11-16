/**
 * Multi-region PR 3a, G1: GET /api/services/stats `attention_scope { regions, global }`,
 * where the needs-attention resources are, for the Services page's "in {n} regions".
 *
 *   - Same rows and same predicate as `needs_attention` (attentionOf over the
 *     inventoryWhere rows of the one /stats statement), so the scope can never
 *     disagree with the count (parity with the ?needs_attention=true list).
 *   - regions: distinct regions holding at least one needs-attention resource;
 *     'global' (CloudFront) is never a region and is counted apart in `global`.
 *   - A healthy resource, a finding below the floor, a terminated resource and
 *     another organization's resources never count.
 *   - Row-level security alone (the non-superuser devcontrol role, every explicit
 *     organization predicate stripped) gives the same rows.
 *
 * Not here (no HR-1 on main): the old home region's cost-only attention leaving both
 * numbers after a home-region change. That test belongs to PR 3c.
 *
 * Real routes over an in-process HTTP server against live Postgres; only
 * authService.verifyToken is stubbed (role-gate harness). Placeholders only.
 */
import fs from 'fs';
import path from 'path';
import { Client } from 'pg';
import servicesRoutes, { serviceStatsFrom } from '../services.routes';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const harness = createRoleGateHarness('services-attention-scope');
const { pool } = harness;

const HIGH_FINDING = { severity: 'high', category: 'public_access', issue: 'EC2 instance has a public IP address', recommendation: 'r', provenance: 'OBSERVED' };
const LOW_FINDING = { ...HIGH_FINDING, severity: 'low' };

let seq = 0;
async function resource(orgId: string, name: string, type: string, region: string, status: string, issues: unknown[] = []): Promise<void> {
  seq += 1;
  const id = `${name}-${seq}`;
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata, compliance_issues)
     VALUES ($1, $2, $3, $4, $5, $6, $7, '{}', '{}', $8::jsonb)`,
    [orgId, `arn:aws:${type}:${region}:123456789012:resource/${id}`, id, name, type, region, status, JSON.stringify(issues)]
  );
}

interface Recorded { text: string; values: unknown[] }
const recorded: Recorded[] = [];
const originalClientQuery = Client.prototype.query;

async function statementsDuring(fn: () => Promise<unknown>, pattern: RegExp): Promise<Recorded[]> {
  const start = recorded.length;
  await fn();
  return recorded.slice(start).filter((r) => pattern.test(r.text));
}

async function getJson(org: RoleGateOrg, path: string): Promise<any> {
  const res = await harness.sendAs(org.orgId, org.viewer, 'GET', path);
  expect(res.status).toBe(200);
  return res.json();
}

let orgA: RoleGateOrg;
let orgB: RoleGateOrg;
let orgEmpty: RoleGateOrg;

beforeAll(async () => {
  Client.prototype.query = function (this: Client, ...args: unknown[]) {
    const arg = args[0] as string | { text?: string; values?: unknown[] } | null;
    recorded.push({
      text: typeof arg === 'string' ? arg : arg?.text ?? '',
      values: (typeof arg === 'string' ? (Array.isArray(args[1]) ? args[1] : []) : arg?.values ?? []) as unknown[],
    });
    return (originalClientQuery as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof Client.prototype.query;
  // /stats reads it; CI's bootstrap does not create it.
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => app.use('/api/services', servicesRoutes));
  orgA = await harness.buildOrg();
  orgB = await harness.buildOrg();
  orgEmpty = await harness.buildOrg();

  // Org A: attention in us-east-1 (two), eu-west-1 (a high finding on a healthy row), and global (CloudFront).
  await resource(orgA.orgId, 'a-web-stopped', 'ec2', 'us-east-1', 'stopped');
  await resource(orgA.orgId, 'a-api-stopped', 'ec2', 'us-east-1', 'stopped');
  await resource(orgA.orgId, 'a-db-public', 'rds', 'eu-west-1', 'available', [HIGH_FINDING]);
  await resource(orgA.orgId, 'a-cdn-disabled', 'cloudfront', 'global', 'disabled');
  // Not attention: healthy, a finding below the floor, a healthy global row, a terminated row.
  await resource(orgA.orgId, 'a-web-ok', 'ec2', 'ap-south-1', 'running');
  await resource(orgA.orgId, 'a-low-finding', 'ec2', 'sa-east-1', 'running', [LOW_FINDING]);
  await resource(orgA.orgId, 'a-cdn-ok', 'cloudfront', 'global', 'active');
  await resource(orgA.orgId, 'a-gone', 'ec2', 'me-central-1', 'terminated');
  // Org B: attention in regions org A never uses.
  await resource(orgB.orgId, 'b-web-stopped', 'ec2', 'us-west-2', 'stopped');
  await resource(orgB.orgId, 'b-db-stopped', 'rds', 'ca-central-1', 'stopped');
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  Client.prototype.query = originalClientQuery;
  await harness.close(async (orgIds) => {
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [orgIds]);
  });
});

describe('serviceStatsFrom: attention_scope (pure)', () => {
  const row = (type: string, raw_status: string | null, region: string | null, issues: unknown[] = []) =>
    ({ type, raw_status, region, compliance_issues: issues as never, cost_recommendations: null });

  it('counts distinct regions of needs-attention rows; global apart; healthy rows and null regions never', () => {
    const stats = serviceStatsFrom([
      row('ec2', 'stopped', 'us-east-1'),
      row('ec2', 'stopped', 'us-east-1'),
      row('ec2', 'running', 'eu-west-1'),
      row('rds', 'available', 'eu-west-1', [HIGH_FINDING]),
      row('cloudfront', 'disabled', 'global'),
      row('cloudfront', 'disabled', 'global'),
      row('cloudfront', 'active', 'global'),
      row('ec2', 'stopped', null),
      row('ec2', 'running', 'ap-south-1', [LOW_FINDING]),
    ]);
    expect(stats.needs_attention).toBe(6);
    expect(stats.attention_scope).toEqual({ regions: 2, global: 2 });
  });

  it('no attention: zero regions, zero global', () => {
    expect(serviceStatsFrom([row('ec2', 'running', 'us-east-1')]).attention_scope).toEqual({ regions: 0, global: 0 });
    expect(serviceStatsFrom([]).attention_scope).toEqual({ regions: 0, global: 0 });
  });

  it('a row without a region field (an older caller) is in neither number', () => {
    const stats = serviceStatsFrom([{ type: 'ec2', raw_status: 'stopped', compliance_issues: null as never, cost_recommendations: null }]);
    expect(stats.needs_attention).toBe(1);
    expect(stats.attention_scope).toEqual({ regions: 0, global: 0 });
  });
});

describe('GET /api/services/stats attention_scope', () => {
  it('org A: 2 regions (us-east-1, eu-west-1) and 1 global, beside needs_attention 4', async () => {
    const { stats } = await getJson(orgA, '/services/stats');
    expect(stats.needs_attention).toBe(4);
    expect(stats.attention_scope).toEqual({ regions: 2, global: 1 });
  });

  it('docs §15.3: the example-stats block is org A\'s real answer', async () => {
    const doc = fs.readFileSync(path.join(__dirname, '..', '..', '..', '..', 'docs', 'SERVICES_COVERAGE_MULTI_REGION.md'), 'utf8');
    const match = /<!-- example-stats: attention_scope -->\s*```json\n([\s\S]*?)\n```/.exec(doc);
    expect(match).not.toBeNull();
    const { stats } = await getJson(orgA, '/services/stats');
    expect({ needs_attention: stats.needs_attention, attention_scope: stats.attention_scope }).toEqual(JSON.parse(match![1]));
  });

  it('parity: the same numbers as the ?needs_attention=true list (same rows, same predicate)', async () => {
    for (const org of [orgA, orgB, orgEmpty]) {
      const { stats } = await getJson(org, '/services/stats');
      const list = await getJson(org, '/services?needs_attention=true&limit=100');
      const rows: Array<{ aws_region: string | null }> = list.services;
      expect(rows).toHaveLength(stats.needs_attention);
      const regions = new Set(rows.map((r) => r.aws_region).filter((r) => r !== null && r !== 'global'));
      expect(stats.attention_scope).toEqual({ regions: regions.size, global: rows.filter((r) => r.aws_region === 'global').length });
    }
  });

  it('tenancy: org B sees only its own two regions; an empty org reads zeros', async () => {
    expect((await getJson(orgB, '/services/stats')).stats.attention_scope).toEqual({ regions: 2, global: 0 });
    const empty = (await getJson(orgEmpty, '/services/stats')).stats;
    expect(empty.needs_attention).toBe(0);
    expect(empty.attention_scope).toEqual({ regions: 0, global: 0 });
  });

  it('row-level security alone (devcontrol, explicit predicate stripped) returns the tagged organization\'s rows and regions', async () => {
    const [statement] = await statementsDuring(() => getJson(orgA, '/services/stats'), /WITH inv AS/);
    expect(statement).toBeDefined();
    const stripped = statement.text.split('r.organization_id = $1').join('$1::uuid IS NOT NULL').split('s.organization_id = $1').join('$1::uuid IS NOT NULL');
    expect(stripped).not.toMatch(/organization_id = \$1/);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('GRANT SELECT ON aws_resources, services, cost_recommendations TO devcontrol');
      await client.query('SET LOCAL ROLE devcontrol');
      const role = await client.query('SELECT current_user AS name, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user');
      expect(role.rows[0]).toEqual({ name: 'devcontrol', rolsuper: false, rolbypassrls: false });
      // Tagged for A, asking for B: A's rows only, so A's scope.
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [orgA.orgId]);
      const rowsA = (await client.query(stripped, [orgB.orgId, ...statement.values.slice(1)])).rows.filter((r) => r.id !== null);
      expect(serviceStatsFrom(rowsA).attention_scope).toEqual({ regions: 2, global: 1 });
      // Tagged for B, asking for A.
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [orgB.orgId]);
      const rowsB = (await client.query(stripped, [orgA.orgId, ...statement.values.slice(1)])).rows.filter((r) => r.id !== null);
      expect(serviceStatsFrom(rowsB).attention_scope).toEqual({ regions: 2, global: 0 });
      expect(new Set(rowsB.map((r) => r.region))).toEqual(new Set(['us-west-2', 'ca-central-1']));
      // No tag: nothing.
      await client.query("SELECT set_config('app.current_organization_id', '', true)");
      expect((await client.query(stripped, [orgA.orgId, ...statement.values.slice(1)])).rows.filter((r) => r.id !== null)).toEqual([]);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
