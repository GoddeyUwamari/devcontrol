/**
 * Starting a compliance evaluation is Enterprise only, on the server.
 *
 * POST /api/compliance-frameworks/:id/scan answers 402 TIER_REQUIRED to an
 * organization below Enterprise, even for its owner, and starts nothing: the
 * framework is never looked up and no scan is claimed. Every other suite for
 * this router stubs requireEnterprise away; this one runs it, reading the
 * organization's tier from Postgres. Real routes and real authentication
 * (role-gate-harness.ts); the scan itself is stubbed.
 */
import complianceFrameworksRoutes from '../compliance-frameworks.routes';
import { ComplianceFrameworksRepository } from '../../repositories/compliance-frameworks.repository';
import { CustomComplianceService } from '../../services/custom-compliance.service';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';

const harness = createRoleGateHarness('scan-plan-gate');
const { pool, sendAs } = harness;

const ID = '00000000-0000-4000-8000-000000000004';
const route = `/compliance-frameworks/${ID}/scan`;

let org: RoleGateOrg;
let frameworkFind: jest.SpyInstance;
let scanStart: jest.SpyInstance;

beforeAll(async () => {
  org = await harness.buildOrg();
  await harness.listen((app) => {
    app.use('/api/compliance-frameworks', complianceFrameworksRoutes);
  });
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  frameworkFind = jest.spyOn(ComplianceFrameworksRepository.prototype, 'findFrameworkById').mockResolvedValue({ id: ID } as never);
  scanStart = jest
    .spyOn(CustomComplianceService.prototype, 'startScan')
    .mockResolvedValue({ status: 'started', scanId: ID } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await harness.close();
});

const setTier = (tier: string) =>
  pool.query('UPDATE organizations SET subscription_tier = $1 WHERE id = $2', [tier, org.orgId]);

describe('POST /api/compliance-frameworks/:id/scan below Enterprise', () => {
  it.each(['free', 'starter', 'pro'])('%s: 402 TIER_REQUIRED for the owner, and nothing starts', async (tier) => {
    await setTier(tier);
    const response = await sendAs(org.orgId, org.owner, 'POST', route, {});
    expect(response.status).toBe(402);
    expect(await response.json()).toMatchObject({
      success: false,
      code: 'TIER_REQUIRED',
      details: { currentTier: tier, requiredTier: 'enterprise' },
    });
    expect(frameworkFind).not.toHaveBeenCalled();
    expect(scanStart).not.toHaveBeenCalled();
  });

  it('the plan is checked before the role: a viewer below Enterprise gets 402 too', async () => {
    await setTier('pro');
    const response = await sendAs(org.orgId, org.viewer, 'POST', route, {});
    expect(response.status).toBe(402);
    expect(scanStart).not.toHaveBeenCalled();
  });

  it('the same owner on Enterprise starts the scan (control)', async () => {
    await setTier('enterprise');
    const response = await sendAs(org.orgId, org.owner, 'POST', route, {});
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ success: true, data: { scanId: ID } });
    expect(scanStart).toHaveBeenCalledTimes(1);
    expect(scanStart.mock.calls[0][1]).toBe(org.orgId);
  });
});
