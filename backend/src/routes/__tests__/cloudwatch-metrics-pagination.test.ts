/**
 * CloudWatch Scalability Phase 2D: route-layer coverage for GET /api/cloudwatch/metrics'
 * new `?cursor=`/`?pageSize=` pagination, layered on top of the existing Phase 2A cache.
 *
 * `CloudWatchService.prototype['computeMetrics']` (private -- the actual AWS/CloudWatch
 * sweep) is spied on directly, matching this codebase's own established convention for
 * testing an orchestration/route layer independently of the thing it orchestrates (see
 * cloudwatch.service.cache.test.ts's own doc comment, and
 * optimization-rule-configuration.controller.test.ts's use of
 * jest.spyOn(...Service.prototype, ...)). This lets this file prove two things Phase 2D
 * specifically requires without re-deriving AWS/DB mocking already covered elsewhere:
 *
 * 1. The route's cursor/pageSize handling (first page, cursor continuation, clamping,
 *    malformed-cursor -> 400) against a large synthetic fleet.
 * 2. That pagination never causes a redundant AWS evaluation: multiple requests for the
 *    same organization+range, varying only cursor/pageSize, hit computeMetrics() at most
 *    once (Phase 2A's cache, unmodified), while `?refresh=true` still forces a fresh call.
 *
 * Auth is real (authService.verifyToken stubbed to a fixed payload, matching
 * activation-funnel-endpoint.test.ts's own convention) so RLS/organization-context flow
 * through auth.middleware.ts's real runWithOrgClient path -- this proves cursor content
 * can never override which organization's data is returned, since organizationId always
 * comes from the authenticated token, never from any query parameter including `cursor`.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import cloudwatchRoutes from '../cloudwatch.routes';
import { authService } from '../../services/auth.service';
import { CloudWatchService, CloudWatchServiceHealth, CloudWatchMetrics } from '../../services/cloudwatch.service';

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

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(label: string): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $2, $3) RETURNING id`,
    [`CW Pagination ${label} ${suffix}`, `cw-pagination-${label}-${suffix}`, `CW Pagination ${label} ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

function stubAuth(orgId: string) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId: 'user-1',
    email: 'cw-pagination-test@example.com',
    organizationId: orgId,
    role: 'owner',
    type: 'access',
  } as any);
}

function fx(type: CloudWatchServiceHealth['resourceType'], index: number, orgTag: string): CloudWatchServiceHealth {
  return {
    resourceId: `${orgTag}-ec2-${index}`,
    resourceDbId: `${orgTag}-db-id-${String(index).padStart(4, '0')}`,
    resourceSortName: `${orgTag}-ec2-${String(index).padStart(4, '0')}`,
    name: `${orgTag}-ec2-${index}`,
    description: '',
    resourceType: type,
    status: 'healthy',
    uptime: 100,
    responseTimeMs: null,
    errorRate: null,
    critical: false,
    monitored: true,
  };
}

function fleetFixture(orgTag: string, count: number): CloudWatchMetrics {
  const services = Array.from({ length: count }, (_, i) => fx('ec2', i, orgTag));
  return {
    accountId: `acct-${orgTag}`,
    nickname: null,
    region: 'us-east-1',
    uptime: 100,
    avgResponseTimeMs: null,
    requestsPerMinute: null,
    errorRate: null,
    monthlyCost: null,
    trendPercent: null,
    responseTimeHistory: [],
    coverage: { ec2: true, loadBalancer: false, rds: false, dynamodb: false, ecs: false, eks: false },
    resourceCounts: {
      ec2: { shown: count, total: count },
      loadBalancer: { shown: 0, total: 0 },
      rds: { shown: 0, total: 0 },
      lambda: { shown: 0, total: 0 },
      dynamodb: { shown: 0, total: 0 },
      ecs: { shown: 0, total: 0 },
      eks: { shown: 0, total: 0 },
    },
    healthSummary: { total: count, healthy: count, degraded: 0, critical: 0, down: 0, monitored: count },
    systemStatus: 'healthy',
    services,
    capturedAt: new Date().toISOString(),
  };
}

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/cloudwatch', cloudwatchRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/cloudwatch`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

function getMetrics(query = ''): Promise<Response> {
  return fetch(`${baseUrl}/metrics${query}`, { headers: { Authorization: 'Bearer test-token' } });
}

describe('GET /api/cloudwatch/metrics — Phase 2D pagination', () => {
  it('(1) first page: default page size, hasMore true, non-null cursor, healthSummary/systemStatus present and complete-fleet-derived', async () => {
    const orgId = await insertOrg('first-page');
    stubAuth(orgId);
    jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(fleetFixture('a', 60));

    const res = await getMetrics();
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.services).toHaveLength(25); // DEFAULT_PAGE_SIZE
    expect(body.data.pagination).toEqual({ shown: 25, total: 60, hasMore: true, cursor: expect.any(String) });
    expect(body.data.healthSummary).toEqual({ total: 60, healthy: 60, degraded: 0, critical: 0, down: 0, monitored: 60 });
    expect(body.data.systemStatus).toBe('healthy');
  });

  it('(2) cursor continuation walks the full fleet with no gaps or duplicates', async () => {
    const orgId = await insertOrg('cursor-walk');
    stubAuth(orgId);
    jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(fleetFixture('b', 55));

    const seen: string[] = [];
    let cursor: string | null = null;
    let hasMore = true;
    let guard = 0;
    while (hasMore && guard < 10) {
      guard++;
      const res = await getMetrics(cursor ? `?pageSize=20&cursor=${encodeURIComponent(cursor)}` : '?pageSize=20');
      const body: any = await res.json();
      seen.push(...body.data.services.map((s: any) => s.resourceDbId));
      hasMore = body.data.pagination.hasMore;
      cursor = body.data.pagination.cursor;
    }

    expect(seen).toHaveLength(55);
    expect(new Set(seen).size).toBe(55); // no duplicates
  });

  it('(3) final page: hasMore false and cursor null once every resource has been walked', async () => {
    const orgId = await insertOrg('final-page');
    stubAuth(orgId);
    jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(fleetFixture('c', 10));

    const res = await getMetrics('?pageSize=10');
    const body: any = await res.json();

    expect(body.data.services).toHaveLength(10);
    expect(body.data.pagination).toEqual({ shown: 10, total: 10, hasMore: false, cursor: null });
  });

  it('(4) empty fleet: shown/total 0, hasMore false, no services rendered', async () => {
    const orgId = await insertOrg('empty-fleet');
    stubAuth(orgId);
    jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(fleetFixture('d', 0));

    const res = await getMetrics();
    const body: any = await res.json();

    expect(body.data.services).toEqual([]);
    expect(body.data.pagination).toEqual({ shown: 0, total: 0, hasMore: false, cursor: null });
    expect(body.data.healthSummary.total).toBe(0);
  });

  it('(5) oversized client pageSize is clamped server-side to MAX_PAGE_SIZE (100), never trusted as-is', async () => {
    const orgId = await insertOrg('oversized-page');
    stubAuth(orgId);
    jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(fleetFixture('e', 500));

    const res = await getMetrics('?pageSize=100000');
    const body: any = await res.json();

    expect(body.data.services).toHaveLength(100);
  });

  it('(6) an invalid/malformed cursor produces a clean 400, never a 500', async () => {
    const orgId = await insertOrg('bad-cursor');
    stubAuth(orgId);
    jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(fleetFixture('f', 5));

    const res = await getMetrics('?cursor=not-valid-base64-json!!!');
    expect(res.status).toBe(400);
    const body: any = await res.json();
    expect(body.success).toBe(false);
  });

  it('(7) cache behavior: same organization + same range with different cursor/pageSize reuses the same cached complete-fleet computation -- computeMetrics is called only once', async () => {
    const orgId = await insertOrg('cache-reuse');
    stubAuth(orgId);
    const computeSpy = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(fleetFixture('g', 40));

    const first = await getMetrics('?pageSize=10');
    const firstBody: any = await first.json();
    await getMetrics(`?pageSize=15&cursor=${encodeURIComponent(firstBody.data.pagination.cursor)}`);
    await getMetrics('?pageSize=30'); // different page size, no cursor -- still same org+range

    expect(computeSpy).toHaveBeenCalledTimes(1);
  });

  it('(8) manual refresh (?refresh=true) still bypasses the cache exactly as Phase 2A established, regardless of pagination params', async () => {
    const orgId = await insertOrg('manual-refresh');
    stubAuth(orgId);
    const computeSpy = jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockResolvedValue(fleetFixture('h', 20));

    await getMetrics('?pageSize=10');
    await getMetrics('?pageSize=10'); // cache hit, still 1 call
    await getMetrics('?pageSize=10&refresh=true'); // forces a second call

    expect(computeSpy).toHaveBeenCalledTimes(2);
  });

  it('(9) organization isolation: a cursor issued for one organization, replayed against a different organization, can never surface the first organization\'s resources -- organizationId always comes from the authenticated token, never the cursor', async () => {
    const orgA = await insertOrg('org-a');
    const orgB = await insertOrg('org-b');

    jest.spyOn(CloudWatchService.prototype as any, 'computeMetrics').mockImplementation((async (organizationId: string) => {
      return organizationId === orgA ? fleetFixture('org-a-tag', 30) : fleetFixture('org-b-tag', 5);
    }) as any);

    stubAuth(orgA);
    const firstPageA = await getMetrics('?pageSize=10');
    const bodyA: any = await firstPageA.json();
    const cursorFromOrgA = bodyA.data.pagination.cursor;
    expect(bodyA.data.services.every((s: any) => s.resourceId.startsWith('org-a-tag'))).toBe(true);

    // Replay org A's cursor, but authenticated as org B.
    stubAuth(orgB);
    const crossOrgRes = await getMetrics(`?pageSize=10&cursor=${encodeURIComponent(cursorFromOrgA)}`);
    const crossOrgBody: any = await crossOrgRes.json();

    // org B's own (small, 5-resource) fleet is returned -- never org A's -- and since org
    // A's cursor key doesn't match anything in org B's much smaller fleet, this resolves
    // to an empty page rather than crashing or leaking org A's data.
    expect(crossOrgRes.status).toBe(200);
    expect(crossOrgBody.data.services.every((s: any) => s.resourceId.startsWith('org-b-tag'))).toBe(true);
    expect(crossOrgBody.data.services.some((s: any) => s.resourceId.startsWith('org-a-tag'))).toBe(false);
  });
});
