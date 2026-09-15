/**
 * Coverage for the parameterized GET /api/security-hub/frameworks/:framework route
 * (refactored from two copy-pasted /frameworks/cis and /frameworks/pci handlers into one
 * dispatch table, added as part of NIST SP 800-53 Rev. 5 support). Confirms CIS and PCI
 * behavior is unchanged by the refactor, NIST is now served the same way, and an unknown
 * framework value is rejected safely (400, not 404/500) rather than falling through to
 * an unintended handler.
 *
 * Auth middleware and the compliance/sync services are stubbed -- the property under
 * test is this route's own dispatch behavior, not the auth stack or evaluator internals
 * (both covered elsewhere: security-hub-compliance.service.test.ts, auth middleware
 * tests).
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = 'org-test-1';
    next();
  },
}));

jest.mock('../../middleware/subscription.middleware', () => ({
  requireEnterprise: (_req: any, _res: any, next: any) => next(),
}));

jest.mock('../../middleware/rateLimiter', () => ({
  standardRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

const mockEvaluateCis = jest.fn().mockResolvedValue({ framework: 'cis', frameworkVersion: '5.0.0' });
const mockEvaluatePci = jest.fn().mockResolvedValue({ framework: 'pci', frameworkVersion: '4.0.1' });
const mockEvaluateNist = jest.fn().mockResolvedValue({ framework: 'nist', frameworkVersion: '5.0.0' });

jest.mock('../../services/security-hub-compliance.service', () => ({
  SecurityHubComplianceService: jest.fn().mockImplementation(() => ({
    evaluateCis: mockEvaluateCis,
    evaluatePci: mockEvaluatePci,
    evaluateNist: mockEvaluateNist,
  })),
}));

jest.mock('../../services/security-hub-sync.service', () => ({
  SecurityHubSyncService: jest.fn().mockImplementation(() => ({
    sync: jest.fn(),
  })),
}));

jest.mock('../../repositories/security-hub-state.repository', () => ({
  SecurityHubStateRepository: jest.fn().mockImplementation(() => ({
    get: jest.fn().mockResolvedValue(null),
  })),
}));

import securityHubRoutes from '../security-hub.routes';

describe('GET /api/security-hub/frameworks/:framework', () => {
  let server: http.Server;
  let baseUrl: string;

  beforeAll((done) => {
    const app = express();
    app.use(express.json());
    app.use('/api/security-hub', securityHubRoutes);
    server = app.listen(0, () => {
      const { port } = server.address() as AddressInfo;
      baseUrl = `http://localhost:${port}`;
      done();
    });
  });

  afterAll((done) => {
    server.close(done);
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('GET /frameworks/cis dispatches to evaluateCis and returns its result unchanged', async () => {
    const res = await fetch(`${baseUrl}/api/security-hub/frameworks/cis`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; result: { framework: string } };
    expect(body.success).toBe(true);
    expect(body.result.framework).toBe('cis');
    expect(mockEvaluateCis).toHaveBeenCalledWith('org-test-1');
    expect(mockEvaluatePci).not.toHaveBeenCalled();
    expect(mockEvaluateNist).not.toHaveBeenCalled();
  });

  it('GET /frameworks/pci dispatches to evaluatePci and returns its result unchanged', async () => {
    const res = await fetch(`${baseUrl}/api/security-hub/frameworks/pci`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; result: { framework: string } };
    expect(body.success).toBe(true);
    expect(body.result.framework).toBe('pci');
    expect(mockEvaluatePci).toHaveBeenCalledWith('org-test-1');
    expect(mockEvaluateCis).not.toHaveBeenCalled();
  });

  it('GET /frameworks/nist dispatches to evaluateNist and returns its result', async () => {
    const res = await fetch(`${baseUrl}/api/security-hub/frameworks/nist`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { success: boolean; result: { framework: string } };
    expect(body.success).toBe(true);
    expect(body.result.framework).toBe('nist');
    expect(mockEvaluateNist).toHaveBeenCalledWith('org-test-1');
  });

  it('an unknown framework value returns 400, not 404 or 500, and calls no evaluator', async () => {
    const res = await fetch(`${baseUrl}/api/security-hub/frameworks/soc2`);
    expect(res.status).toBe(400);
    const body = (await res.json()) as { success: boolean; error: string };
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/Unknown framework/);
    expect(mockEvaluateCis).not.toHaveBeenCalled();
    expect(mockEvaluatePci).not.toHaveBeenCalled();
    expect(mockEvaluateNist).not.toHaveBeenCalled();
  });

  it('GET /capability and POST /sync are unaffected by the /frameworks/:framework parameterization', async () => {
    const capabilityRes = await fetch(`${baseUrl}/api/security-hub/capability`);
    expect(capabilityRes.status).toBe(200);
    const capabilityBody = (await capabilityRes.json()) as { success: boolean; syncStatus: string };
    expect(capabilityBody.success).toBe(true);
    expect(capabilityBody.syncStatus).toBe('NEVER_RUN');
  });
});
