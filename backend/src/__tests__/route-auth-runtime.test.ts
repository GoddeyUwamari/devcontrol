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
 * no external service is called.
 */
import './helpers/record-mount-paths';
import http from 'http';
import { AddressInfo } from 'net';
import { Pool } from 'pg';
import { walkApp, isProtected, WalkedRoute } from './helpers/route-walker';
import app from '../server';
import { authenticate } from '../middleware/auth.middleware';

jest.mock('../config/load-env', () => ({ loadEnv: jest.fn(), LOCAL_STACK_ENV_FILE: '/nonexistent' }));
jest.mock('../config/validateEnv', () => ({ validateEnv: jest.fn() }));
// Constructed at route import; its cache-cleanup interval would keep Jest alive.
jest.mock('../services/ai-insights.service', () => ({
  AIInsightsService: jest.fn().mockImplementation(() => ({})),
}));


const NO_TOKEN = { success: false, error: 'No authentication token provided' };
const PARAM_VALUE = '00000000-0000-4000-8000-000000000000';

let server: http.Server;
let baseUrl: string;
let connectSpy: jest.SpyInstance;
let querySpy: jest.SpyInstance;

beforeAll(async () => {
  // Every pg pool, including the app's (config/database.ts wraps it in a Proxy).
  connectSpy = jest.spyOn(Pool.prototype, 'connect').mockImplementation(() => { throw new Error('the database was touched'); });
  querySpy = jest.spyOn(Pool.prototype, 'query').mockImplementation(() => { throw new Error('the database was touched'); });
  server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
  jest.restoreAllMocks();
});

afterEach(() => {
  expect(connectSpy).not.toHaveBeenCalled();
  expect(querySpy).not.toHaveBeenCalled();
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
