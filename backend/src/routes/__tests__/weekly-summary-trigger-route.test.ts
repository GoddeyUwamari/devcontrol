/**
 * POST /api/ai-insights/trigger-weekly-summary authorization and rate control (Q),
 * and GET /api/ai-insights/preview-weekly-summary authorization (WE-1, P3).
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

/** The held, org-tagged connection the preview reads through (WE-3a); one object per withOrganizationClient call. */
const mockHeldClients: Array<{ organizationId: string; client: object }> = [];
const mockRepo = {
  withOrganizationClient: jest.fn(),
  getRecipients: jest.fn(),
  gatherWeeklyEvidence: jest.fn(),
  getOrganizationName: jest.fn(),
  getPlanName: jest.fn(),
};
const mockRepoConstructed = jest.fn();
jest.mock('../../repositories/weekly-summary.repository', () => ({
  ...jest.requireActual('../../repositories/weekly-summary.repository'),
  WeeklySummaryRepository: jest.fn().mockImplementation(() => {
    mockRepoConstructed();
    return mockRepo;
  }),
}));

import aiInsightsRoutes from '../ai-insights.routes';
import { notSupported, notConnected } from '../../services/ai-context-contract';
import { weeklySummaryPeriod } from '../../repositories/weekly-summary.repository';

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

describe('POST /api/ai-insights/trigger-weekly-summary errors (WE-1)', () => {
  it('a thrown failure answers a generic error -- never the raw message', async () => {
    mockTriggerManual.mockRejectedValue(new Error('synthetic raw failure detail'));
    const res = await trigger('org-throw-1', 'owner');
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ success: false, error: 'Weekly summary could not be sent.' });
    expect(text).not.toContain('synthetic raw failure detail');
  });
});

describe('GET /api/ai-insights/preview-weekly-summary (WE-1, P3)', () => {
  const missing = (source: string) => notSupported({ source }, 'not evaluated in this test');
  const evidence = () => ({
    period: weeklySummaryPeriod(new Date('2026-11-16T09:00:00.000Z')),
    awsConnection: 'not_connected',
    currentWeekSpend: notConnected({ source: 'AWS Cost Explorer daily trend' }, 'no AWS account is connected'),
    previousWeekSpend: notConnected({ source: 'AWS Cost Explorer daily trend' }, 'no AWS account is connected'),
    weekOverWeek: missing('DevControl week-over-week comparison'),
    inventoryEstimate: null,
    alerts: missing('DevControl alert history'),
    delivery: missing('DevControl deployment records'),
    security: notConnected({ source: 'DevControl security posture score and configuration checks' }, 'no AWS account is connected'),
    recommendations: notConnected({ source: 'DevControl cost recommendations' }, 'no AWS account is connected'),
  });

  function preview(org: string, role: string) {
    return fetch(`${baseUrl}/api/ai-insights/preview-weekly-summary`, { headers: { 'x-test-org': org, 'x-test-role': role } });
  }

  beforeEach(() => {
    mockRepoConstructed.mockReset();
    mockHeldClients.length = 0;
    mockRepo.withOrganizationClient.mockReset().mockImplementation(async (organizationId: string, work: (c: object) => unknown) => {
      const client = { heldFor: organizationId };
      mockHeldClients.push({ organizationId, client });
      return work(client);
    });
    mockRepo.getRecipients.mockReset().mockResolvedValue([
      { userId: 'u', email: 'owner@example.test', fullName: 'Pat Owner' },
      { userId: 'v', email: 'second-owner@example.test', fullName: 'Sam Owner' },
    ]);
    mockRepo.gatherWeeklyEvidence.mockReset().mockImplementation(async () => evidence());
    mockRepo.getOrganizationName.mockReset().mockResolvedValue('Example Org (synthetic)');
    mockRepo.getPlanName.mockReset().mockResolvedValue('Visibility');
  });

  it.each(['member', 'admin', 'viewer'])('a %s cannot preview (403; no evidence gathered, no owner details returned)', async role => {
    const res = await preview('org-preview-1', role);
    const text = await res.text();
    expect(res.status).toBe(403);
    expect(mockRepoConstructed).not.toHaveBeenCalled();
    expect(mockRepo.gatherWeeklyEvidence).not.toHaveBeenCalled();
    expect(text).not.toContain('owner@example.test');
  });

  it("an owner previews their own org's email content: five sections, composed from what the repository returned", async () => {
    const res = await preview('org-preview-2', 'owner');
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(mockRepo.gatherWeeklyEvidence).toHaveBeenCalledWith('org-preview-2', expect.any(Date), mockHeldClients[0].client);
    expect(body.content.sections.map((s: any) => s.title)).toEqual(['COSTS', 'SECURITY', 'ESTIMATED SAVINGS', 'ALERTS', 'DELIVERY']);
    expect(body.content.organizationName).toBe('Example Org (synthetic)');
    expect(body.content.header).toMatch(/^Example Org \(synthetic\) · Visibility plan · .+ \(UTC\)$/);
    expect(body.content.subject).toMatch(/^Your DevControl weekly summary · /);
    expect(body.message).not.toMatch(/\bAI\b/);
  });

  // WE-1 review L-3: the org comes from the session only, as on the trigger route.
  it("an owner previews only their own org -- a client-supplied organizationId is ignored", async () => {
    const res = await fetch(`${baseUrl}/api/ai-insights/preview-weekly-summary?organizationId=someone-elses-org`, {
      headers: { 'x-test-org': 'org-preview-4', 'x-test-role': 'owner' },
    });
    const body = (await res.json()) as any;
    expect(res.status).toBe(200);
    expect(body.organizationId).toBe('org-preview-4');
    for (const read of [mockRepo.withOrganizationClient, mockRepo.getRecipients, mockRepo.gatherWeeklyEvidence, mockRepo.getOrganizationName, mockRepo.getPlanName]) {
      expect(read).toHaveBeenCalledTimes(1);
      expect(read.mock.calls[0][0]).toBe('org-preview-4');
    }
    expect(JSON.stringify(body)).not.toContain('someone-elses-org');
  });

  // WE-3a (audit P3): no bare-pool read -- every read runs on one connection
  // tagged for the caller's org, the way the scheduled send reads.
  it("every preview read runs on one connection held and tagged for the caller's org", async () => {
    const res = await preview('org-preview-5', 'owner');
    expect(res.status).toBe(200);
    expect(mockRepo.withOrganizationClient).toHaveBeenCalledTimes(1);
    expect(mockHeldClients).toHaveLength(1);
    expect(mockHeldClients[0].organizationId).toBe('org-preview-5');
    const held = mockHeldClients[0].client;
    expect(mockRepo.getRecipients).toHaveBeenCalledWith('org-preview-5', held);
    expect(mockRepo.gatherWeeklyEvidence).toHaveBeenCalledWith('org-preview-5', expect.any(Date), held);
    expect(mockRepo.getOrganizationName).toHaveBeenCalledWith('org-preview-5', held);
    expect(mockRepo.getPlanName).toHaveBeenCalledWith('org-preview-5', held);
  });

  it('WE-D7: the preview lists every owner the email would go to', async () => {
    const body = (await (await preview('org-preview-6', 'owner')).json()) as Record<string, unknown>;
    expect(body.recipients).toEqual([
      { email: 'owner@example.test', fullName: 'Pat Owner' },
      { email: 'second-owner@example.test', fullName: 'Sam Owner' },
    ]);
    expect(body).not.toHaveProperty('userInfo');
  });

  it('a failure answers a generic error -- never the raw message', async () => {
    mockRepo.gatherWeeklyEvidence.mockRejectedValue(new Error('synthetic raw failure detail'));
    const res = await preview('org-preview-3', 'owner');
    const text = await res.text();
    expect(res.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ success: false, error: 'Weekly summary preview could not be generated.' });
    expect(text).not.toContain('synthetic raw failure detail');
  });
});
