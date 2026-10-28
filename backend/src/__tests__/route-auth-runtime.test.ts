/**
 * Runtime companion to route-auth-inventory.test.ts: on the real app, one
 * authenticated GET route per router answers a request without a token with
 * authenticate's own 401 -- not a role or plan gate's -- before anything
 * touches the database. The routes are picked from the same walk, so a new
 * router is covered without editing this file.
 *
 * Also checks that the token- and signature-guarded public routes refuse a
 * request without their credential, again without touching the database.
 *
 * The app listens on a loopback port only; no environment file is read and
 * no external service is called. Every pg pool rejects and records
 * connect()/query() from before the app is imported
 * (helpers/route-test-setup.ts): the import and each test must make none.
 */
import { dbConnect, dbQuery } from './helpers/route-test-setup';
import http from 'http';
import { AddressInfo } from 'net';
import { walkApp, isProtected, WalkedRoute } from './helpers/route-walker';
import app from '../server';
import { authenticate } from '../middleware/auth.middleware';

jest.mock('../config/load-env', () => ({ loadEnv: jest.fn(), LOCAL_STACK_ENV_FILE: '/nonexistent' }));
jest.mock('../config/validateEnv', () => ({ validateEnv: jest.fn() }));
// Constructed at route import; its cache-cleanup interval would keep Jest alive.
jest.mock('../services/ai-insights.service', () => ({
  AIInsightsService: jest.fn().mockImplementation(() => ({})),
}));
// Constructed at route import; it would create its table on the app pool.
jest.mock('../services/nl-query-analytics.service', () => ({
  NLQueryAnalyticsService: jest.fn().mockImplementation(() => ({ initializeTable: jest.fn(async () => undefined) })),
}));


const NO_TOKEN = { success: false, error: 'No authentication token provided' };
const PARAM_VALUE = '00000000-0000-4000-8000-000000000000';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  jest.restoreAllMocks();
});

// Cleared after every test, so one database touch fails only the test that made it.
afterEach(() => {
  try {
    expect(dbConnect).not.toHaveBeenCalled();
    expect(dbQuery).not.toHaveBeenCalled();
  } finally {
    dbConnect.mockClear();
    dbQuery.mockClear();
  }
});

describe('database check', () => {
  it('importing the app ran no SQL', () => {
    expect(dbConnect).not.toHaveBeenCalled();
    expect(dbQuery).not.toHaveBeenCalled();
  });

  it('sees a query made while a module is imported', async () => {
    await import('./helpers/query-at-import');
    expect(dbQuery).toHaveBeenCalledTimes(1);
    dbQuery.mockClear();
  });
});

function onePerRouter(): WalkedRoute[] {
  const picked = new Map<string, WalkedRoute>();
  for (const route of walkApp(app).routes) {
    if (route.method !== 'GET' || !isProtected(route, new Set([authenticate]))) continue;
    if (!picked.has(route.family)) picked.set(route.family, route);
  }
  return [...picked.values()];
}

const samples = onePerRouter();
const urlFor = (path: string) => baseUrl + path.replace(/:[^/]+/g, PARAM_VALUE);

describe('authenticated routes refuse a request without a token', () => {
  it('covers every router family', () => {
    expect(samples.length).toBeGreaterThan(40);
  });

  it.each(samples.map(r => [r.path, r] as const))('GET %s -> 401 from authenticate', async (_path, route) => {
    const res = await fetch(urlFor(route.path));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual(NO_TOKEN);
  });
});

describe('guarded public routes refuse a request without their credential', () => {
  const savedEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...savedEnv };
  });

  it('GET /metrics without the metrics token -> 404', async () => {
    process.env.METRICS_TOKEN = 'runtime-check-metrics-token';
    const res = await fetch(`${baseUrl}/metrics`);
    expect(res.status).toBe(404);
  });

  it('POST /api/webhooks/github without a signature -> 401', async () => {
    process.env.GITHUB_WEBHOOK_SECRET = 'runtime-check-webhook-secret';
    const res = await fetch(`${baseUrl}/api/webhooks/github`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-github-event': 'workflow_job' },
      body: JSON.stringify({ action: 'completed' }),
    });
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ success: false, error: 'Invalid signature' });
  });

  it('POST /api/stripe/webhook without a signature -> 400', async () => {
    const res = await fetch(`${baseUrl}/api/stripe/webhook`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'invoice.paid' }),
    });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ success: false, error: 'Missing stripe-signature header' });
  });

  it('GET /api/user/preferences/unsubscribe without a token -> 400', async () => {
    const res = await fetch(`${baseUrl}/api/user/preferences/unsubscribe`);
    expect(res.status).toBe(400);
  });

  it('POST /api/user/preferences/unsubscribe without a token -> 400', async () => {
    const res = await fetch(`${baseUrl}/api/user/preferences/unsubscribe`, { method: 'POST' });
    expect(res.status).toBe(400);
  });
});
