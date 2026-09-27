/**
 * POST /api/ai-insights/trigger-weekly-summary authorization and rate control (Q).
 *
 * The route sends a real email, so it is owner-only and limited per
 * organization. Auth is stubbed (the caller's role/org come from test
 * headers); the real requireOwner and weeklySummaryTriggerRateLimiter run.
 * The job is mocked: nothing is gathered and no email is sent.
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

const mockTriggerManual = jest.fn();
jest.mock('../../jobs/weekly-ai-summary.job', () => ({
  WeeklyAISummaryJob: jest.fn().mockImplementation(() => ({ triggerManual: mockTriggerManual })),
}));

import aiInsightsRoutes from '../ai-insights.routes';

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/ai-insights', aiInsightsRoutes);
  server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterAll(async () => {
  await new Promise(resolve => server.close(resolve));
});

beforeEach(() => {
  mockTriggerManual.mockReset();
  mockTriggerManual.mockResolvedValue({ sent: 1, skipped: 0, errors: 0 });
});

function trigger(org: string, role: string, body: object = {}) {
  return fetch(`${baseUrl}/api/ai-insights/trigger-weekly-summary`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-test-org': org, 'x-test-role': role },
    body: JSON.stringify(body),
  });
}

describe('POST /api/ai-insights/trigger-weekly-summary', () => {
  it.each(['member', 'admin', 'viewer'])('Q: a %s cannot cause a send (403, job never invoked)', async role => {
    const res = await trigger('org-role-check', role);
    expect(res.status).toBe(403);
    expect(mockTriggerManual).not.toHaveBeenCalled();
  });

  it("Q: an owner triggers only their own org -- a client-supplied organizationId is ignored", async () => {
    const res = await trigger('org-owner-1', 'owner', { organizationId: 'someone-elses-org' });
    expect(res.status).toBe(200);
    expect(mockTriggerManual).toHaveBeenCalledTimes(1);
    expect(mockTriggerManual).toHaveBeenCalledWith('org-owner-1');
  });

  it('Q: limited to 2 manual sends per organization per 24h; other orgs are unaffected', async () => {
    expect((await trigger('org-rate-1', 'owner')).status).toBe(200);
    expect((await trigger('org-rate-1', 'owner')).status).toBe(200);
    const limited = await trigger('org-rate-1', 'owner');
    expect(limited.status).toBe(429);
    expect(mockTriggerManual).toHaveBeenCalledTimes(2);

    expect((await trigger('org-rate-2', 'owner')).status).toBe(200);
    expect(mockTriggerManual).toHaveBeenCalledTimes(3);
  });

  it('Q/R: an ineligible recipient is reported as not sent -- never as a successful send', async () => {
    mockTriggerManual.mockResolvedValue({ sent: 0, skipped: 1, errors: 0 });
    const res = await trigger('org-skip-1', 'owner');
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.message).toMatch(/^Not sent: no organization owner has weekly summaries enabled and a verified email address/);
    expect(body.result).toEqual({ sent: 0, skipped: 1, errors: 0 });
  });

  it('Q: a failed send is reported as a failure', async () => {
    mockTriggerManual.mockResolvedValue({ sent: 0, skipped: 0, errors: 1 });
    const res = await trigger('org-fail-1', 'owner');
    expect(res.status).toBe(500);
    expect(((await res.json()) as any).success).toBe(false);
  });
});
