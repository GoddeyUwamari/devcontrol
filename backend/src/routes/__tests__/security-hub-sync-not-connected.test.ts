/**
 * AWS connect PR C (C-a): POST /api/security-hub/sync for an organization with
 * no eligible AWS connection answers 409 NOT_CONNECTED with the approved text
 * (nothing ran, nothing was written); a sync that ran keeps its 200 answer.
 *
 * Pricing PR 1A: the sync is on the plan in PLAN_ENTITLEMENTS.securityHubSync
 * (Pro and above), checked before the admin role. The real plan middleware and
 * table run here; only the organization row it reads is stubbed. Below the plan
 * the 402 comes first: the role is not checked, the sync never runs, and so no
 * 409 is reached.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { AWS_NOT_CONNECTED_CODE, AWS_NOT_CONNECTED_MESSAGE } from '../../services/aws-connection-messages';
import { PLAN_ENTITLEMENTS } from '../../config/plan-entitlements';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = 'org-test-1';
    req.user = { userId: 'user-test-1', email: 'admin@example.com', organizationId: 'org-test-1', role: 'admin' };
    next();
  },
}));
const mockRequireAdmin = jest.fn((_req: any, _res: any, next: any) => next());
jest.mock('../../middleware/rbac.middleware', () => ({
  requireAdmin: (req: any, res: any, next: any) => mockRequireAdmin(req, res, next),
}));
// The organization row the plan middleware reads (getOrganizationTier).
const mockPlanQuery = jest.fn();
jest.mock('../../config/database', () => ({ pool: { query: (...args: unknown[]) => mockPlanQuery(...args) } }));
const planRow = (subscription_tier: string) => ({ rows: [{ subscription_tier, billing_lifecycle_state: 'healthy', grace_period_ends_at: null }] });
jest.mock('../../middleware/rateLimiter', () => ({
  standardRateLimiter: (_req: any, _res: any, next: any) => next(),
}));
const mockSync = jest.fn();
jest.mock('../../services/security-hub-sync.service', () => ({
  SecurityHubSyncService: jest.fn().mockImplementation(() => ({ sync: mockSync })),
}));
jest.mock('../../services/security-hub-compliance.service', () => ({
  SecurityHubComplianceService: jest.fn().mockImplementation(() => ({})),
}));
jest.mock('../../repositories/security-hub-state.repository', () => ({
  SecurityHubStateRepository: jest.fn().mockImplementation(() => ({ get: jest.fn().mockResolvedValue(null) })),
}));

import securityHubRoutes from '../security-hub.routes';

describe('POST /api/security-hub/sync', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use('/api/security-hub', securityHubRoutes);
    server = app.listen(0, () => {
      baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
      done();
    });
  });
  afterAll((done) => {
    server.close(done);
  });
  let consoleError: jest.SpyInstance;
  beforeEach(() => {
    mockSync.mockReset();
    mockRequireAdmin.mockClear();
    mockPlanQuery.mockReset();
    consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    consoleError.mockRestore();
  });

  it('the sync is on Pro and above in the central table', () => {
    expect(PLAN_ENTITLEMENTS.securityHubSync).toBe('pro');
  });

  it.each(['pro', 'enterprise'])('on %s, no eligible connection: 409 NOT_CONNECTED with the approved text', async (tier) => {
    mockPlanQuery.mockResolvedValue(planRow(tier));
    mockSync.mockResolvedValueOnce({ notConnected: true, syncStatus: 'FAILED', error: 'NOT_CONNECTED', pagesProcessed: 0, findingsCount: 0, capability: {} });
    const res = await fetch(`${baseUrl}/api/security-hub/sync`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, code: AWS_NOT_CONNECTED_CODE, error: AWS_NOT_CONNECTED_MESSAGE });
    // The plan was read for this organization, then the role, then the sync ran once.
    expect(mockPlanQuery).toHaveBeenCalledTimes(1);
    expect(mockPlanQuery.mock.calls[0][1]).toEqual(['org-test-1']);
    expect(mockRequireAdmin).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledTimes(1);
    expect(mockSync).toHaveBeenCalledWith('org-test-1');
  });

  it('on pro, a sync that ran: 200 with its outcome, as before', async () => {
    mockPlanQuery.mockResolvedValue(planRow('pro'));
    const outcome = { syncStatus: 'COMPLETED', error: null, pagesProcessed: 1, findingsCount: 3, capability: { status: 'ENABLED' } };
    mockSync.mockResolvedValueOnce(outcome);
    const res = await fetch(`${baseUrl}/api/security-hub/sync`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Security Hub sync completed', outcome });
  });

  it.each(['free', 'starter'])('on %s: the 402 plan response comes first; no role check, no sync, so no 409', async (tier) => {
    mockPlanQuery.mockResolvedValue(planRow(tier));
    // Would answer 409 if it were reached.
    mockSync.mockResolvedValue({ notConnected: true, syncStatus: 'FAILED', error: 'NOT_CONNECTED', pagesProcessed: 0, findingsCount: 0, capability: {} });
    const res = await fetch(`${baseUrl}/api/security-hub/sync`, { method: 'POST' });
    expect(res.status).toBe(402);
    expect(await res.json()).toEqual({
      success: false,
      error: 'Subscription tier insufficient',
      code: 'TIER_REQUIRED',
      details: { currentTier: tier, requiredTier: 'pro', message: 'This feature requires a pro subscription or higher.' },
      upgrade: { cta: expect.any(String), url: '/settings/billing?upgrade=pro', nextTier: expect.anything() },
    });
    expect(mockRequireAdmin).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });

  it('if the plan cannot be read, nothing runs (500, fail closed)', async () => {
    mockPlanQuery.mockRejectedValue(new Error('forced plan lookup failure'));
    const res = await fetch(`${baseUrl}/api/security-hub/sync`, { method: 'POST' });
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to verify subscription tier' });
    expect(mockRequireAdmin).not.toHaveBeenCalled();
    expect(mockSync).not.toHaveBeenCalled();
  });
});
