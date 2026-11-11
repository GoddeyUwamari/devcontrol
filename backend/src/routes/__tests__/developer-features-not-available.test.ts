/**
 * /api/keys and /api/webhooks answer 501 FEATURE_NOT_AVAILABLE while their
 * table is missing (both are absent in production), instead of a 500 from the
 * failing query. The guard runs after authentication and after the role gate,
 * so 401 and 403 are unchanged; once the table exists the handlers run as
 * before. No database: the pool is a mock that answers the to_regclass probe.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('../../config/database', () => ({ pool: { query: jest.fn() } }));

// Authentication stand-in: the caller's role travels in a header; none means 401.
// (The real middleware's 401 is covered by authenticate-route-sweep.test.ts.)
jest.mock('../../middleware/auth.middleware', () => {
  const authenticate = (req: import('express').Request, res: import('express').Response, next: import('express').NextFunction) => {
    const role = req.headers['x-test-role'] as string | undefined;
    if (!role) {
      res.status(401).json({ success: false, message: 'Authentication required' });
      return;
    }
    (req as unknown as { user: Record<string, string> }).user = { userId: `user-${role}`, organizationId: 'org-1', role, email: 'dev@example.com' };
    next();
  };
  return { authenticate, authenticateToken: authenticate };
});

// The api-keys role gate reads the CURRENT membership; here the role is in the user id.
jest.mock('../../services/organization-authorization', () => {
  const actual = jest.requireActual('../../services/organization-authorization');
  return {
    ...actual,
    requireCurrentRole: jest.fn(async (_pool: unknown, _org: string, userId: string, roles: string[]) => {
      const role = userId.replace('user-', '');
      if (!roles.includes(role)) throw new actual.OrganizationAccessError('Forbidden', 403);
    }),
  };
});

// No DNS in this test: the destination check is not what it is about.
jest.mock('../../utils/safe-outbound', () => ({
  ...jest.requireActual('../../utils/safe-outbound'),
  assertDestination: jest.fn(async () => undefined),
}));

jest.mock('../../services/auditEvents.service', () => ({
  auditEvents: new Proxy({}, { get: () => jest.fn(async () => undefined) }),
  auditRequestContext: jest.fn(() => ({})),
}));

import { pool } from '../../config/database';
import apiKeysRoutes from '../api-keys.routes';
import webhooksRoutes from '../webhooks.routes';
import { resetFeatureTableCache, RECHECK_MS } from '../../middleware/require-feature-table';

const query = pool.query as unknown as jest.Mock;
let tables: Record<string, boolean>;
let server: http.Server;
let baseUrl: string;

const probes = () => query.mock.calls.filter(([sql]) => String(sql).includes('to_regclass'));
const writes = () => query.mock.calls.filter(([sql]) => /\b(INSERT|UPDATE|DELETE)\b/i.test(String(sql)));
const tableReads = () => query.mock.calls.filter(([sql]) => /FROM (api_keys|webhook_endpoints)/.test(String(sql)));

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/keys', apiKeysRoutes);
  app.use('/api/webhooks', webhooksRoutes);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

beforeEach(() => {
  resetFeatureTableCache();
  tables = { 'public.api_keys': false, 'public.webhook_endpoints': false };
  query.mockReset();
  query.mockImplementation(async (sql: string, params?: unknown[]) => {
    if (sql.includes('to_regclass')) return { rows: [{ t: tables[String(params?.[0])] ? String(params?.[0]) : null }] };
    return { rows: [], rowCount: 0 };
  });
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => jest.restoreAllMocks());

function send(method: string, route: string, role?: string, body?: unknown) {
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json', ...(role ? { 'x-test-role': role } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const ROUTES: { name: string; table: string; method: string; route: string; body?: unknown; message: string }[] = [
  { name: 'GET /api/keys', table: 'public.api_keys', method: 'GET', route: '/keys', message: 'API keys are coming soon.' },
  { name: 'POST /api/keys', table: 'public.api_keys', method: 'POST', route: '/keys', body: { name: 'ci' }, message: 'API keys are coming soon.' },
  { name: 'DELETE /api/keys/:id', table: 'public.api_keys', method: 'DELETE', route: '/keys/00000000-0000-0000-0000-000000000000', message: 'API keys are coming soon.' },
  { name: 'GET /api/webhooks', table: 'public.webhook_endpoints', method: 'GET', route: '/webhooks', message: 'Webhooks are coming soon.' },
  { name: 'POST /api/webhooks', table: 'public.webhook_endpoints', method: 'POST', route: '/webhooks', body: { url: 'https://example.com/hook' }, message: 'Webhooks are coming soon.' },
  { name: 'DELETE /api/webhooks/:id', table: 'public.webhook_endpoints', method: 'DELETE', route: '/webhooks/00000000-0000-0000-0000-000000000000', message: 'Webhooks are coming soon.' },
];

describe.each(ROUTES)('$name', ({ table, method, route, body, message }) => {
  it('answers 501 FEATURE_NOT_AVAILABLE while the table is missing, and touches no table', async () => {
    const response = await send(method, route, 'owner', body);

    expect(response.status).toBe(501);
    expect(await response.json()).toEqual({ success: false, code: 'FEATURE_NOT_AVAILABLE', message });
    expect(probes()).toHaveLength(1);
    expect(probes()[0][1]).toEqual([table]);
    expect(writes()).toHaveLength(0);
    expect(tableReads()).toHaveLength(0);
  });

  it('still answers 401 to an unauthenticated caller, before any probe', async () => {
    const response = await send(method, route, undefined, body);

    expect(response.status).toBe(401);
    expect(probes()).toHaveLength(0);
  });

  it('runs the handler once the table exists', async () => {
    tables[table] = true;

    const response = await send(method, route, 'owner', body);

    expect(response.status).not.toBe(501);
    expect(probes()).toHaveLength(1);
    // The handler's own statement against the feature table ran.
    expect(query.mock.calls.some(([sql]) => String(sql).includes(table.replace('public.', '')) && !String(sql).includes('to_regclass'))).toBe(true);
  });
});

describe.each(ROUTES.filter((r) => r.method !== 'GET'))('$name role gate comes first', ({ method, route, body }) => {
  it.each(['member', 'viewer'])('refuses a %s with 403 even while the table is missing', async (role) => {
    const response = await send(method, route, role, body);

    expect(response.status).toBe(403);
    expect(probes()).toHaveLength(0);
  });
});

describe('probe caching', () => {
  it('remembers a table that exists: one probe for many requests', async () => {
    tables['public.api_keys'] = true;
    for (let i = 0; i < 3; i += 1) expect((await send('GET', '/keys', 'member')).status).toBe(200);
    expect(probes()).toHaveLength(1);
  });

  it('probes a missing table again only after the recheck interval', async () => {
    const now = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
    expect((await send('GET', '/webhooks', 'member')).status).toBe(501);
    expect((await send('GET', '/webhooks', 'member')).status).toBe(501);
    expect(probes()).toHaveLength(1);

    tables['public.webhook_endpoints'] = true;
    now.mockReturnValue(1_000_000 + RECHECK_MS);
    expect((await send('GET', '/webhooks', 'member')).status).toBe(200);
    expect(probes()).toHaveLength(2);
  });

  it('lets the request through to its handler when the probe itself fails', async () => {
    query.mockImplementation(async (sql: string) => {
      if (sql.includes('to_regclass')) throw new Error('database unavailable');
      throw new Error('relation does not exist');
    });
    const response = await send('GET', '/keys', 'member');
    // The handler's own failure, as before the guard existed.
    expect(response.status).toBe(500);
  });
});
