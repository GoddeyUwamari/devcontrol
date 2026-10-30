/**
 * The middleware chains of a few route families in the real app, read from
 * its router stack in registration order (helpers/route-walker.ts):
 *  - /api/soc2/customer-evidence runs authenticate exactly once, from its own
 *    router, then requireEnterprise, then the route's own gate; /api/soc2 runs
 *    authenticate exactly once;
 *  - the Prometheus query, query_range, targets and config routes run
 *    requirePlatformStaff after authenticate and before the handler;
 *  - GET /api/aws-resources/tagging-compliance is not served.
 *
 * The same hermetic setup as route-auth-inventory.test.ts: no server, no
 * environment file, no SQL.
 */
import './helpers/route-test-setup';
import { walkApp, Walk, WalkedRoute } from './helpers/route-walker';
import app from '../server';
import { authenticate } from '../middleware/auth.middleware';
import { requireEnterprise } from '../middleware/subscription.middleware';
import { requireMember } from '../middleware/rbac.middleware';
import { requirePlatformStaff } from '../middleware/platformAuth.middleware';

jest.mock('../config/load-env', () => ({ loadEnv: jest.fn(), LOCAL_STACK_ENV_FILE: '/nonexistent' }));
jest.mock('../config/validateEnv', () => ({ validateEnv: jest.fn() }));
// Constructed at route import; it would create its table on the app pool.
jest.mock('../services/nl-query-analytics.service', () => ({
  NLQueryAnalyticsService: jest.fn().mockImplementation(() => ({ initializeTable: jest.fn(async () => undefined) })),
}));

let walk: Walk;

beforeAll(() => {
  walk = walkApp(app);
});

function routesUnder(prefix: string): WalkedRoute[] {
  return walk.routes.filter((route) => route.path === prefix || route.path.startsWith(`${prefix}/`));
}

function count(route: WalkedRoute, fn: unknown): number {
  return route.chain.filter((f) => f === fn).length;
}

describe('/api/soc2/customer-evidence', () => {
  it('serves its seven routes', () => {
    expect(routesUnder('/api/soc2/customer-evidence').map((r) => `${r.method} ${r.path}`).sort()).toEqual([
      'GET /api/soc2/customer-evidence',
      'GET /api/soc2/customer-evidence/:evidenceId',
      'PATCH /api/soc2/customer-evidence/:evidenceId',
      'POST /api/soc2/customer-evidence',
      'POST /api/soc2/customer-evidence/:evidenceId/expire',
      'POST /api/soc2/customer-evidence/:evidenceId/review',
      'POST /api/soc2/customer-evidence/:evidenceId/supersede',
    ]);
  });

  it.each(['GET', 'POST', 'PATCH'])('every %s route runs authenticate once, then requireEnterprise, then its own gate', (method) => {
    for (const route of routesUnder('/api/soc2/customer-evidence').filter((r) => r.method === method)) {
      expect({ route: route.path, authenticate: count(route, authenticate) }).toEqual({ route: route.path, authenticate: 1 });
      const auth = route.chain.indexOf(authenticate);
      const plan = route.chain.indexOf(requireEnterprise);
      const gate = Math.max(route.chain.indexOf(requireMember), route.chain.indexOf(requirePlatformStaff));
      expect(auth).toBeGreaterThanOrEqual(0);
      expect(plan).toBeGreaterThan(auth);
      expect(gate).toBeGreaterThan(plan);
    }
  });
});

describe('/api/soc2', () => {
  it('readiness and evidence routes run authenticate once', () => {
    const soc2 = routesUnder('/api/soc2').filter((r) => !r.path.startsWith('/api/soc2/customer-evidence'));
    expect(soc2.map((r) => r.path).sort()).toEqual([
      '/api/soc2/evidence',
      '/api/soc2/readiness',
      '/api/soc2/readiness/:criterionId',
    ]);
    for (const route of soc2) expect(count(route, authenticate)).toBe(1);
  });
});

describe('Prometheus proxy routes', () => {
  it.each(['/api/prometheus/query', '/api/prometheus/query_range', '/api/prometheus/targets', '/api/prometheus/config'])(
    'GET %s runs requirePlatformStaff after authenticate',
    (path) => {
      const route = walk.routes.find((r) => r.method === 'GET' && r.path === path)!;
      expect(route).toBeDefined();
      const auth = route.chain.indexOf(authenticate);
      const staff = route.chain.indexOf(requirePlatformStaff);
      expect(auth).toBeGreaterThanOrEqual(0);
      expect(staff).toBeGreaterThan(auth);
    }
  );

  it('GET /api/prometheus/health is not staff-gated', () => {
    const route = walk.routes.find((r) => r.method === 'GET' && r.path === '/api/prometheus/health')!;
    expect(route.chain).not.toContain(requirePlatformStaff);
  });
});

describe('/api/aws-resources', () => {
  it('serves no tagging-compliance route', () => {
    expect(routesUnder('/api/aws-resources').map((r) => r.path)).not.toContain('/api/aws-resources/tagging-compliance');
  });
});
