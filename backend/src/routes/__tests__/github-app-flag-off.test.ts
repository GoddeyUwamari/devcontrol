/**
 * D8a-1 fix round (review S-1): with GITHUB_APP_ENABLED unset, every GitHub
 * App route answers "not configured" before any database access, and never
 * a 500. The D8a tables may not exist yet (the admin migration is applied
 * separately), so a single query here would be a 500 in production.
 *
 * Every pg Pool's connect() and query() is recorded (and rejects) from before
 * the routers are imported (helpers/route-test-setup.ts). authenticate is
 * replaced by a stub that sets an owner, because its own membership lookup
 * runs first on every authenticated route by contract (route-auth-runtime:
 * a request without a token gets authenticate's 401). What this file proves
 * is that nothing after authentication -- role gate, demo check, handler --
 * touches the database while the feature is off.
 */
import { dbConnect, dbQuery } from '../../__tests__/helpers/route-test-setup';
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import githubAppConnectionRoutes from '../github-app-connection.routes';
import githubAppWebhookRoutes from '../github-app-webhook.routes';
import { applyBodyParsing, GITHUB_APP_WEBHOOK_PATH } from '../../middleware/body-parsing';
import { errorHandler } from '../../middleware/error-handler';

jest.mock('../../middleware/auth.middleware', () => {
  const stub = (req: any, _res: any, next: () => void) => {
    req.user = { userId: '00000000-0000-4000-8000-0000000000a1', email: 'owner@example.com', organizationId: '00000000-0000-4000-8000-0000000000b1', role: 'owner' };
    req.organizationId = '00000000-0000-4000-8000-0000000000b1';
    next();
  };
  return { authenticate: stub, authenticateToken: stub };
});

const REPO = '00000000-0000-4000-8000-0000000000c1';
const SERVICE = '00000000-0000-4000-8000-0000000000d1';
const STATE = 'A'.repeat(43);
const GITHUB_APP_ENV = Object.keys(process.env).filter((k) => k.startsWith('GITHUB_APP_'));

let server: http.Server;
let baseUrl = '';

beforeAll(async () => {
  for (const k of GITHUB_APP_ENV) delete process.env[k];
  const app = express();
  applyBodyParsing(app);
  app.use(GITHUB_APP_WEBHOOK_PATH, githubAppWebhookRoutes);
  app.use('/api/integrations/github', githubAppConnectionRoutes);
  app.use(errorHandler);
  server = http.createServer(app).listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve));
});

afterEach(() => {
  dbConnect.mockClear();
  dbQuery.mockClear();
});

it('GITHUB_APP_ENABLED is unset in this file', () => {
  expect(process.env.GITHUB_APP_ENABLED).toBeUndefined();
  expect(dbConnect).not.toHaveBeenCalled();
  expect(dbQuery).not.toHaveBeenCalled();
});

const NOT_CONFIGURED = { success: false, error: 'github_app_not_configured' };

describe.each([
  ['GET', '/api/integrations/github', undefined, 200, { success: true, data: { configured: false } }],
  ['GET', '/api/integrations/github/repositories', undefined, 503, NOT_CONFIGURED],
  ['PUT', `/api/integrations/github/repositories/${REPO}/service`, { service_id: SERVICE }, 503, NOT_CONFIGURED],
  ['PUT', `/api/integrations/github/repositories/${REPO}/deploy-rule`, { mode: 'none' }, 503, NOT_CONFIGURED],
  ['GET', `/api/integrations/github/repositories/${REPO}/jobs-seen`, undefined, 503, NOT_CONFIGURED],
  ['POST', '/api/integrations/github/install', {}, 503, NOT_CONFIGURED],
  ['POST', '/api/integrations/github/claim', { state: STATE, code: 'abc', installation_id: '42' }, 503, NOT_CONFIGURED],
  ['POST', '/api/integrations/github/claim/retry', { state: STATE }, 503, NOT_CONFIGURED],
  ['DELETE', '/api/integrations/github/installations/42', undefined, 503, NOT_CONFIGURED],
  ['POST', GITHUB_APP_WEBHOOK_PATH, { action: 'created' }, 503, { received: false, error: 'github_app_not_configured' }],
  ['POST', `${GITHUB_APP_WEBHOOK_PATH}/`, { action: 'created' }, 503, { received: false, error: 'github_app_not_configured' }],
] as const)('%s %s with the feature off', (method, path, body, status, expected) => {
  it(`answers ${status} "not configured" with zero database calls`, async () => {
    const res = await fetch(baseUrl + path, {
      method,
      headers: body === undefined ? {} : { 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    expect(res.status).toBe(status);
    expect(await res.json()).toEqual(expected);
    expect(dbConnect).not.toHaveBeenCalled();
    expect(dbQuery).not.toHaveBeenCalled();
  });
});
