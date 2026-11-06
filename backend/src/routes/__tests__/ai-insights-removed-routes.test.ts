/**
 * GET /api/ai-insights/test-email-config was removed. A logged-in member now
 * gets the app's ordinary 404, and no weekly-summary job is constructed.
 *
 * POST /analyze-cost, GET /cache-stats and POST /clear-cache were retired in
 * AI truth PR 1 (no product caller; /analyze-cost sent client-supplied cost
 * numbers to the model): they get the same 404, and no model call is made.
 *
 * Auth is stubbed (the caller's role/org come from test headers), as in
 * weekly-summary-trigger-route.test.ts.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticate: (req: any, _res: any, next: any) => {
    req.user = {
      userId: 'user-1',
      email: 'caller@example.test',
      organizationId: req.headers['x-test-org'],
      role: req.headers['x-test-role'],
    };
    next();
  },
}));


jest.mock('../../jobs/weekly-ai-summary.job', () => ({
  WeeklyAISummaryJob: jest.fn().mockImplementation(() => ({})),
}));

import { WeeklyAISummaryJob } from '../../jobs/weekly-ai-summary.job';
import { setModelClientForTests } from '../../services/ai/model-client';
import aiInsightsRoutes from '../ai-insights.routes';
import { notFoundHandler } from '../../middleware/error-handler';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/ai-insights', aiInsightsRoutes);
  app.use(notFoundHandler);
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

describe('GET /api/ai-insights/test-email-config', () => {
  it('returns 404 for a logged-in member', async () => {
    const res = await fetch(`${baseUrl}/api/ai-insights/test-email-config`, {
      headers: { 'x-test-org': 'org-1', 'x-test-role': 'member' },
    });
    const body = (await res.json()) as any;

    expect(res.status).toBe(404);
    expect(body).toEqual({
      success: false,
      error: 'Route GET /api/ai-insights/test-email-config not found',
      code: 'NOT_FOUND',
    });
    expect(WeeklyAISummaryJob).not.toHaveBeenCalled();
  });
});

describe('retired AI insights routes', () => {
  const modelCall = jest.fn();
  beforeAll(() => setModelClientForTests({ messages: { create: modelCall, stream: modelCall } } as never));
  afterAll(() => setModelClientForTests(undefined));

  it.each([
    ['POST', '/api/ai-insights/analyze-cost', { previousCost: 100, currentCost: 150, percentageIncrease: 50, timeRange: '30d' }],
    ['GET', '/api/ai-insights/cache-stats', undefined],
    ['POST', '/api/ai-insights/clear-cache', {}],
  ] as const)('%s %s returns the ordinary 404 for a logged-in owner, with no model call', async (method, path, body) => {
    const res = await fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'x-test-org': 'org-1', 'x-test-role': 'owner', 'content-type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = (await res.json()) as any;

    expect(res.status).toBe(404);
    expect(json).toEqual({ success: false, error: `Route ${method} ${path} not found`, code: 'NOT_FOUND' });
    expect(modelCall).not.toHaveBeenCalled();
  });
});
