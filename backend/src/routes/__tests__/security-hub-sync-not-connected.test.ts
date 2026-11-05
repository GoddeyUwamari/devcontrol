/**
 * AWS connect PR C (C-a): POST /api/security-hub/sync for an organization with
 * no eligible AWS connection answers 409 NOT_CONNECTED with the approved text
 * (nothing ran, nothing was written); a sync that ran keeps its 200 answer.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { AWS_NOT_CONNECTED_CODE, AWS_NOT_CONNECTED_MESSAGE } from '../../services/aws-connection-messages';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = 'org-test-1';
    next();
  },
}));
jest.mock('../../middleware/rbac.middleware', () => ({
  requireAdmin: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../middleware/subscription.middleware', () => ({
  requireEnterprise: (_req: any, _res: any, next: any) => next(),
}));
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

  it('no eligible connection: 409 NOT_CONNECTED with the approved text', async () => {
    mockSync.mockResolvedValueOnce({ notConnected: true, syncStatus: 'FAILED', error: 'NOT_CONNECTED', pagesProcessed: 0, findingsCount: 0, capability: {} });
    const res = await fetch(`${baseUrl}/api/security-hub/sync`, { method: 'POST' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ success: false, code: AWS_NOT_CONNECTED_CODE, error: AWS_NOT_CONNECTED_MESSAGE });
  });

  it('a sync that ran: 200 with its outcome, as before', async () => {
    const outcome = { syncStatus: 'COMPLETED', error: null, pagesProcessed: 1, findingsCount: 3, capability: { status: 'ENABLED' } };
    mockSync.mockResolvedValueOnce(outcome);
    const res = await fetch(`${baseUrl}/api/security-hub/sync`, { method: 'POST' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, message: 'Security Hub sync completed', outcome });
  });
});
