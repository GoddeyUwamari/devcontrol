/**
 * GET /api/services pages over the whole inventory, and /api/services/stats
 * reads it once.
 *
 *   - The list is paged by ?page and ?limit (default 50, at most 100). Its
 *     total and counts are computed over the full filtered set for the
 *     caller's organization, never over the page: an organization with more
 *     than 500 resources gets its true total and every row, once.
 *   - ?needs_attention=true lists the resources that need attention, from the
 *     whole set: one past row 500 is not lost to a cut-off. Its total, the
 *     list's counts and /stats come from the same predicate and agree.
 *   - Rows with equal names are ordered by id, so they never move between pages.
 *   - /stats keeps every number it reported before, from one read of the inventory.
 *   - Nothing crosses organizations: rows, totals, counts, filters and /stats.
 *
 * Real routes over an in-process HTTP server against live Postgres. Only
 * authService.verifyToken (to choose the caller) is stubbed. Statements are
 * counted by a pass-through recorder on pg's Client.prototype.query, installed
 * before any connection exists: config/database.ts wraps each pooled client's
 * query once, keeping whatever method it found then.
 */
import express from 'express';
import http from 'http';
import { Client, Pool } from 'pg';
import servicesRoutes from '../services.routes';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { pool as appPool } from '../../config/database';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

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

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
    [`Services Pagination ${suffix}`, `services-pagination-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function member(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Services Pagination User') RETURNING id`,
    [`services-pagination-${uniqueSuffix()}@example.com`]
  );
  const userId = rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
     VALUES ($1, $2, 'viewer', NOW(), true)`,
    [orgId, userId]
  );
  return userId;
}

async function insertResource(
  orgId: string,
  name: string,
  opts: { type?: string; status?: string; complianceIssues?: unknown[] } = {}
): Promise<void> {
  const type = opts.type ?? 'ec2';
  await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata, compliance_issues)
     VALUES ($1, $2, $3, $4, $5, 'us-east-1', $6, '{}', '{}', $7)`,
    [
      orgId,
      `arn:aws:${type}:us-east-1:123456789012:resource/${name}-${uniqueSuffix()}`,
      `${name}-${uniqueSuffix()}`,
      name,
      type,
      opts.status ?? 'running',
      JSON.stringify(opts.complianceIssues ?? []),
    ]
  );
}

/** `count` running EC2 instances named `${prefix}0001`, `${prefix}0002`, ... in one statement. */
async function insertMany(orgId: string, prefix: string, count: number): Promise<void> {
  await pool.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, tags, metadata)
     SELECT $1,
            'arn:aws:ec2:us-east-1:123456789012:instance/' || $2 || lpad(g::text, 4, '0') || '-' || $4,
            $2 || lpad(g::text, 4, '0') || '-' || $4,
            $2 || lpad(g::text, 4, '0'),
            'ec2', 'us-east-1', 'running', '{}', '{}'
       FROM generate_series(1, $3::int) g`,
    [orgId, prefix, count, uniqueSuffix()]
  );
}

async function insertCostRecommendation(orgId: string, resourceName: string, severity: string, status = 'ACTIVE'): Promise<void> {
  const { rows } = await pool.query(
    'SELECT resource_id FROM aws_resources WHERE organization_id = $1 AND resource_name = $2',
    [orgId, resourceName]
  );
  await pool.query(
    `INSERT INTO cost_recommendations (
       organization_id, resource_id, resource_name, resource_type, issue, description,
       potential_savings, severity, aws_region, metadata, status
     ) VALUES ($1, $2, $3, 'EC2', 'Idle Instance', 'Idle.', 40, $4, 'us-east-1', '{}', $5)`,
    [orgId, rows[0].resource_id, resourceName, severity, status]
  );
}

let server: http.Server;
let baseUrl: string;

const originalClientQuery = Client.prototype.query;
const statementTexts: string[] = [];

beforeAll(async () => {
  Client.prototype.query = function (this: Client, ...args: unknown[]) {
    const arg = args[0];
    statementTexts.push(typeof arg === 'string' ? arg : (arg as { text?: string } | null)?.text ?? '');
    return (originalClientQuery as (...a: unknown[]) => unknown).apply(this, args);
  } as typeof Client.prototype.query;
  // /stats reads it; CI's bootstrap does not create it.
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  const app = express();
  app.use(express.json());
  app.use('/api/services', servicesRoutes);
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api`;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
  await appPool.end();
  Client.prototype.query = originalClientQuery;
});

async function get(userId: string, orgId: string, path: string) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'services-pagination-caller@example.com',
    organizationId: orgId,
    role: 'viewer',
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  const res = await fetch(`${baseUrl}${path}`, { headers: { Authorization: 'Bearer test-token' } });
  return { status: res.status, body: (await res.json()) as any };
}

/** How many statements that read aws_resources run during `fn`. */
async function inventoryStatementsDuring(fn: () => Promise<unknown>): Promise<number> {
  const start = statementTexts.length;
  await fn();
  return statementTexts.slice(start).filter((text) => /\baws_resources\b/.test(text)).length;
}

const names = (body: any): string[] => body.services.map((s: { name: string }) => s.name);

// More than the old 500-row cut-off. Names sort 'pg-0001' ... 'pg-0505', then
// three rows all named 'pg-same', then the one at-risk resource, last.
const BULK = 505;
const TOTAL = BULK + 3 + 1;

describe('GET /api/services -- pages over more than 500 resources', () => {
  let orgId: string;
  let viewer: string;
  let otherOrgId: string;
  let otherViewer: string;

  beforeAll(async () => {
    orgId = await insertOrg();
    viewer = await member(orgId);
    await insertMany(orgId, 'pg-', BULK);
    for (let i = 0; i < 3; i++) await insertResource(orgId, 'pg-same');
    // A stopped instance needs attention; its name sorts after every other row.
    await insertResource(orgId, 'zzz-at-risk', { status: 'stopped' });

    // Another organization, whose names match the searches below and which has
    // resources that need attention of its own.
    otherOrgId = await insertOrg();
    otherViewer = await member(otherOrgId);
    await insertMany(otherOrgId, 'pg-foreign-', 20);
    await insertResource(otherOrgId, 'zzz-foreign-at-risk', { status: 'stopped' });
    await insertResource(otherOrgId, 'pg-foreign-failed', { type: 'ebs', status: 'error' });
  });

  it('the total is the full set, not a page, and page 1 holds one page', async () => {
    const { status, body } = await get(viewer, orgId, '/services?limit=100');
    expect(status).toBe(200);
    expect(body.services).toHaveLength(100);
    expect(body.pagination).toEqual({ page: 1, limit: 100, total: TOTAL, total_pages: 6, has_more: true });
    expect(body.total).toBe(TOTAL);
    expect(body.counts).toEqual({ needs_attention: 1, no_flagged_issues: TOTAL - 1 });
  });

  it('pages 50 rows by default and never more than 100', async () => {
    const byDefault = await get(viewer, orgId, '/services');
    expect(byDefault.body.services).toHaveLength(50);
    expect(byDefault.body.pagination).toMatchObject({ page: 1, limit: 50, total: TOTAL, total_pages: 11, has_more: true });

    const tooMany = await get(viewer, orgId, '/services?limit=1000');
    expect(tooMany.status).toBe(200);
    expect(tooMany.body.services).toHaveLength(100);
    expect(tooMany.body.pagination).toMatchObject({ limit: 100, total: TOTAL });
  });

  it.each([
    ['page=0'], ['page=-1'], ['page=abc'], ['page=1.5'], ['limit=0'], ['limit=x'], ['needs_attention=yes'],
  ])('refuses ?%s with 400', async (query) => {
    const { status, body } = await get(viewer, orgId, `/services?${query}`);
    expect(status).toBe(400);
    expect(body.success).toBe(false);
  });

  it('walking every page returns every resource exactly once, in the same order each time, with the same counts', async () => {
    async function walk(): Promise<string[]> {
      const ids: string[] = [];
      for (let page = 1; ; page++) {
        const { body } = await get(viewer, orgId, `/services?limit=100&page=${page}`);
        expect(body.pagination.total).toBe(TOTAL);
        expect(body.counts).toEqual({ needs_attention: 1, no_flagged_issues: TOTAL - 1 });
        ids.push(...body.services.map((s: { id: string }) => s.id));
        if (!body.pagination.has_more) break;
      }
      return ids;
    }
    const first = await walk();
    expect(first).toHaveLength(TOTAL);
    expect(new Set(first).size).toBe(TOTAL);
    expect(await walk()).toEqual(first);
  });

  it('rows with equal names are ordered by id', async () => {
    const { body } = await get(viewer, orgId, `/services?limit=100&page=6`);
    const same = body.services.filter((s: { name: string }) => s.name === 'pg-same').map((s: { id: string }) => s.id);
    expect(same).toHaveLength(3);
    expect(same).toEqual([...same].sort());
  });

  it('?needs_attention=true returns the at-risk resource past row 500, and its count agrees with /stats', async () => {
    const { status, body } = await get(viewer, orgId, '/services?needs_attention=true');
    expect(status).toBe(200);
    expect(names(body)).toEqual(['zzz-at-risk']);
    expect(body.services[0].needs_attention).toBe(true);
    expect(body.pagination).toEqual({ page: 1, limit: 50, total: 1, total_pages: 1, has_more: false });
    expect(body.counts.needs_attention).toBe(1);

    const stats = await get(viewer, orgId, '/services/stats');
    expect(stats.body.stats).toMatchObject({ total: TOTAL, needs_attention: 1, healthy: TOTAL - 1 });
  });

  it('?needs_attention=true and =false split the set between them', async () => {
    const needs = await get(viewer, orgId, '/services?needs_attention=true');
    const others = await get(viewer, orgId, '/services?needs_attention=false&limit=100');
    expect(needs.body.pagination.total + others.body.pagination.total).toBe(TOTAL);
    expect(others.body.services.every((s: { needs_attention: boolean }) => !s.needs_attention)).toBe(true);
    expect(others.body.counts).toEqual(needs.body.counts);
  });

  it('a page past the end has no rows but still the true total', async () => {
    const { status, body } = await get(viewer, orgId, '/services?limit=100&page=99');
    expect(status).toBe(200);
    expect(body.services).toEqual([]);
    expect(body.pagination).toEqual({ page: 99, limit: 100, total: TOTAL, total_pages: 6, has_more: false });
  });

  it('the list, its counts and the needs-attention filter are confined to the caller\'s organization', async () => {
    // A search that matches only the other organization's names.
    const foreign = await get(viewer, orgId, '/services?search=foreign');
    expect(foreign.body.services).toEqual([]);
    expect(foreign.body.pagination.total).toBe(0);
    expect(foreign.body.counts).toEqual({ needs_attention: 0, no_flagged_issues: 0 });

    const needs = await get(viewer, orgId, '/services?needs_attention=true&search=at-risk');
    expect(names(needs.body)).toEqual(['zzz-at-risk']);

    const typed = await get(viewer, orgId, '/services?type=ebs');
    expect(typed.body.pagination.total).toBe(0);

    // And the other way round: the other organization sees only its own.
    const theirs = await get(otherViewer, otherOrgId, '/services?limit=100');
    expect(theirs.body.pagination.total).toBe(22);
    expect(theirs.body.counts).toEqual({ needs_attention: 2, no_flagged_issues: 20 });
    expect(names(theirs.body).every((n) => n.startsWith('pg-foreign-') || n === 'zzz-foreign-at-risk')).toBe(true);
    const theirNeeds = await get(otherViewer, otherOrgId, '/services?needs_attention=true');
    expect(names(theirNeeds.body)).toEqual(['pg-foreign-failed', 'zzz-foreign-at-risk']);
  });

  it('/stats counts only the caller\'s organization', async () => {
    const mine = await get(viewer, orgId, '/services/stats');
    expect(mine.body.stats).toMatchObject({ total: TOTAL, needs_attention: 1 });
    const theirs = await get(otherViewer, otherOrgId, '/services/stats');
    expect(theirs.body.stats).toMatchObject({
      total: 22, needs_attention: 2, healthy: 20,
      attention_reasons: { with_finding: 0, with_cost_recommendation: 0, stopped_or_degraded: 1, failed: 1 },
    });
  });

  it('the list reads the inventory in one statement, so its rows, total and counts share a snapshot', async () => {
    expect(await inventoryStatementsDuring(() => get(viewer, orgId, '/services?needs_attention=true'))).toBe(1);
  });
});

// The needs-attention fixtures (services.routes.needs-attention.test.ts) as stored rows.
const failedHipaa = { severity: 'critical', category: 'backups', issue: 'HIPAA: EBS storing PHI must have automated backups', recommendation: 'r', findingKey: 'hipaa.automated_backups', framework: 'HIPAA', applicability: 'enabled', evaluation_state: 'failed' };
const keptUnavailable = { ...failedHipaa, verification: 'unverified', applicability: 'unavailable', evaluation_state: 'not_evaluated' };
const baselineHigh = { severity: 'high', category: 'public_access', issue: 'EC2 instance has a public IP address', recommendation: 'r', provenance: 'OBSERVED' };
const baselineLow = { severity: 'low', category: 'tagging', issue: 'Resource is missing required tags: Owner', recommendation: 'r', provenance: 'SELF_ATTESTED' };

describe('GET /api/services/stats -- one read of the inventory, the same numbers', () => {
  let orgId: string;
  let viewer: string;

  beforeAll(async () => {
    orgId = await insertOrg();
    viewer = await member(orgId);
    await insertResource(orgId, 'pa-failed-hipaa', { complianceIssues: [failedHipaa] });                // critical finding
    await insertResource(orgId, 'pa-kept-unavailable', { complianceIssues: [keptUnavailable] });       // not current: nothing
    await insertResource(orgId, 'pa-baseline-high', { complianceIssues: [baselineHigh] });             // high finding
    await insertResource(orgId, 'pa-baseline-low', { complianceIssues: [baselineLow] });               // low: below the floor
    await insertResource(orgId, 'pa-stopped', { status: 'stopped' });                                  // stopped
    await insertResource(orgId, 'pa-ebs-error', { type: 'ebs', status: 'error' });                     // failed
    await insertResource(orgId, 'pa-cost-high');                                                       // HIGH cost recommendation
    await insertResource(orgId, 'pa-cost-high-low-finding', { complianceIssues: [baselineLow] });      // compliance wins: low
    await insertResource(orgId, 'pa-cost-dismissed');                                                  // not ACTIVE: nothing
    await insertResource(orgId, 'pa-stopped-high', { status: 'stopped', complianceIssues: [baselineHigh] }); // finding and stopped
    await insertResource(orgId, 'pa-terminated', { status: 'terminated', complianceIssues: [failedHipaa] }); // not listed at all
    await insertCostRecommendation(orgId, 'pa-cost-high', 'HIGH');
    await insertCostRecommendation(orgId, 'pa-cost-high-low-finding', 'HIGH');
    await insertCostRecommendation(orgId, 'pa-cost-dismissed', 'HIGH', 'DISMISSED');
  });

  it('reports the numbers it always has', async () => {
    const { status, body } = await get(viewer, orgId, '/services/stats');
    expect(status).toBe(200);
    expect(body.stats).toEqual({
      total: 10,
      healthy: 4,
      needs_attention: 6,
      avg_uptime: null,
      findings_by_severity: { critical: 1, high: 2, medium: 0, low: 2 },
      attention_reasons: { with_finding: 3, with_cost_recommendation: 1, stopped_or_degraded: 2, failed: 1 },
      aws_accounts_connected: 0,
    });
  });

  it('agrees with the list: its counts, and the rows ?needs_attention=true returns, by severity then name', async () => {
    const all = await get(viewer, orgId, '/services');
    expect(all.body.pagination.total).toBe(10);
    expect(all.body.counts).toEqual({ needs_attention: 6, no_flagged_issues: 4 });

    const needs = await get(viewer, orgId, '/services?needs_attention=true');
    expect(names(needs.body)).toEqual([
      'pa-ebs-error', 'pa-failed-hipaa',                    // critical
      'pa-baseline-high', 'pa-cost-high', 'pa-stopped-high', // high
      'pa-stopped',                                          // medium
    ]);
  });

  it('reads the inventory once', async () => {
    expect(await inventoryStatementsDuring(() => get(viewer, orgId, '/services/stats'))).toBe(1);
  });
});
