/**
 * DORA benchmarks and the cost forecast act on the authenticated caller's
 * organization and on no other. A request that reaches a handler without an
 * organization is refused: no organization is substituted for it.
 *
 * Authentication always supplies an organization, so that state cannot be
 * produced through it. The middleware is replaced here with one that admits a
 * chosen caller, which is the only stub besides the data layer.
 */
import fs from 'fs';
import path from 'path';
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import { createDoraBenchmarksRoutes } from '../dora-benchmarks.routes';
import { createForecastRoutes } from '../forecast.routes';
import { CostForecastService } from '../../services/cost-forecast.service';
import { ForecastAIService } from '../../services/forecast-ai.service';
import { ScenarioPlanningService } from '../../services/scenario-planning.service';

const mockCaller: { user?: Record<string, unknown>; organizationId?: string } = {};

jest.mock('../../middleware/auth.middleware', () => {
  const authenticate = (req: any, _res: any, next: () => void) => {
    req.user = mockCaller.user;
    req.organizationId = mockCaller.organizationId;
    next();
  };
  return { authenticate, authenticateToken: authenticate };
});

/** The organization the removed fallback used to select. */
const FORMER_FALLBACK = 'a8ea4c8f-5f93-4073-b627-160c61aa064f';
const ORG = '11111111-1111-4111-8111-111111111111';
const USER = '22222222-2222-4222-8222-222222222222';

const query = jest.fn();
const pool = { query } as unknown as Pool;

let server: http.Server;
let baseUrl: string;
let forecastSpy: jest.SpyInstance;
let scenarioSpy: jest.SpyInstance;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  // The same factories, mounted at the same paths, as server.ts.
  app.use('/api/dora', createDoraBenchmarksRoutes(pool));
  app.use('/api/forecast', createForecastRoutes(pool));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  baseUrl = `http://127.0.0.1:${typeof address === 'object' && address ? address.port : 0}/api`;
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  query.mockReset().mockResolvedValue({ rows: [{ metric_name: 'lead_time' }], rowCount: 1 });
  forecastSpy = jest.spyOn(CostForecastService.prototype, 'generateForecast').mockResolvedValue({} as never);
  jest.spyOn(ForecastAIService.prototype, 'analyzeForecast').mockResolvedValue({} as never);
  scenarioSpy = jest.spyOn(ScenarioPlanningService.prototype, 'generateScenario').mockResolvedValue({} as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

function send(method: string, route: string, body?: unknown) {
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

// Every row has all four cells: jest reads a missing last cell as a `done` callback.
const requests: Array<[string, string, string, unknown]> = [
  ['GET /api/dora/benchmarks', 'GET', '/dora/benchmarks', undefined],
  ['POST /api/dora/benchmarks', 'POST', '/dora/benchmarks', { metric_name: 'lead_time', target_value: 4 }],
  ['DELETE /api/dora/benchmarks/:metric', 'DELETE', '/dora/benchmarks/lead_time', undefined],
  ['GET /api/forecast', 'GET', '/forecast', undefined],
  ['POST /api/forecast/scenario', 'POST', '/forecast/scenario', { type: 'growth' }],
];

describe.each(requests)('%s', (_name, method, route, body) => {
  it.each([
    ['is absent', undefined],
    ['is empty', ''],
  ])('is refused with 401, and touches no organization, when the organization %s', async (_label, organizationId) => {
    // An owner, so the only thing missing is the organization.
    mockCaller.user = { userId: USER, email: 'caller@example.com', role: 'owner', organizationId };
    mockCaller.organizationId = organizationId;

    const response = await send(method, route, body);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: 'Unauthorized' });
    expect(query).not.toHaveBeenCalled();
    expect(forecastSpy).not.toHaveBeenCalled();
    expect(scenarioSpy).not.toHaveBeenCalled();
  });

  it('acts on the authenticated organization, and only on it', async () => {
    mockCaller.user = { userId: USER, email: 'caller@example.com', role: 'owner', organizationId: ORG };
    mockCaller.organizationId = ORG;

    const response = await send(method, route, body);

    expect(response.status).toBe(200);
    const organizations = [
      ...query.mock.calls.map((call) => call[1][0]),
      ...forecastSpy.mock.calls.map((call) => call[0]),
      ...scenarioSpy.mock.calls.map((call) => call[0]),
    ];
    expect(organizations).toEqual([ORG]);
  });
});

describe('an unauthenticated request', () => {
  it.each(requests)('%s is refused before any work', async (_name, method, route, body) => {
    mockCaller.user = undefined;
    mockCaller.organizationId = undefined;

    const response = await send(method, route, body);

    expect(response.status).toBe(401);
    expect(query).not.toHaveBeenCalled();
    expect(forecastSpy).not.toHaveBeenCalled();
    expect(scenarioSpy).not.toHaveBeenCalled();
  });
});

describe('no organization is hard-coded', () => {
  const UUID = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

  it.each(['routes/dora-benchmarks.routes.ts', 'controllers/forecast.controller.ts'])('%s names no organization id', (file) => {
    const source = fs.readFileSync(path.join(__dirname, '..', '..', file), 'utf-8');

    expect(source).not.toContain(FORMER_FALLBACK);
    expect(source).not.toMatch(UUID);
  });
});
