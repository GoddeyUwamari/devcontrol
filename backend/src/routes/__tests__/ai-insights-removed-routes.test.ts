/**
 * GET /api/ai-insights/test-email-config was removed. A logged-in member now
 * gets the app's ordinary 404, and no weekly-summary job is constructed.
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

// Constructed at route import; its cache-cleanup interval would keep Jest alive.
jest.mock('../../services/ai-insights.service', () => ({
  AIInsightsService: jest.fn().mockImplementation(() => ({})),
}));

jest.mock('../../jobs/weekly-ai-summary.job', () => ({
  WeeklyAISummaryJob: jest.fn().mockImplementation(() => ({})),
}));

import { WeeklyAISummaryJob } from '../../jobs/weekly-ai-summary.job';
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
