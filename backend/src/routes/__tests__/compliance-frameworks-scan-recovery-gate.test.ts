/**
 * Stale-run recovery happens inside a scan start, so it sits behind the same
 * plan and role gates as the start itself: a refused caller (below
 * Enterprise, or a viewer) never reaches it, and an orphaned "running" run
 * stays as it is. Real routes, real authentication (role-gate-harness.ts)
 * and the real scan service.
 */
import complianceFrameworksRoutes from '../compliance-frameworks.routes';
import { SCAN_INTERRUPTED_MESSAGE } from '../../services/custom-compliance.service';
import { createRoleGateHarness, MEMBER_REFUSAL, RoleGateOrg } from './role-gate-harness';

const harness = createRoleGateHarness('scan-recovery-gate');
const { pool, sendAs } = harness;

let org: RoleGateOrg;
let frameworkId: string;
let orphanId: string;

beforeAll(async () => {
  org = await harness.buildOrg();
  const { rows } = await pool.query(
    `INSERT INTO compliance_frameworks (organization_id, name, framework_type) VALUES ($1, 'Recovery gate', 'custom') RETURNING id`,
    [org.orgId]
  );
  frameworkId = rows[0].id;
  const orphan = await pool.query(
    `INSERT INTO compliance_scans (organization_id, framework_id, scan_type, status, started_at)
     VALUES ($1, $2, 'manual', 'running', NOW()) RETURNING id`,
    [org.orgId, frameworkId]
  );
  orphanId = orphan.rows[0].id;
  await harness.listen((app) => {
    app.use('/api/compliance-frameworks', complianceFrameworksRoutes);
  });
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await harness.close();
});

const setTier = (tier: string) =>
  pool.query('UPDATE organizations SET subscription_tier = $1 WHERE id = $2', [tier, org.orgId]);

async function orphan() {
  const { rows } = await pool.query('SELECT status, error_message FROM compliance_scans WHERE id = $1', [orphanId]);
  return rows[0];
}

const route = () => `/compliance-frameworks/${frameworkId}/scan`;

describe('POST /api/compliance-frameworks/:id/scan -- recovery stays behind the gates', () => {
  it('below Enterprise: 402, and the orphaned run is untouched', async () => {
    await setTier('pro');
    const response = await sendAs(org.orgId, org.owner, 'POST', route(), {});
    expect(response.status).toBe(402);
    expect(await orphan()).toEqual({ status: 'running', error_message: null });
  });

  it('a viewer on Enterprise: 403, and the orphaned run is untouched', async () => {
    await setTier('enterprise');
    const response = await sendAs(org.orgId, org.viewer, 'POST', route(), {});
    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject(MEMBER_REFUSAL);
    expect(await orphan()).toEqual({ status: 'running', error_message: null });
  });

  it('a member on Enterprise starts the scan, and the orphaned run is recovered as interrupted (control)', async () => {
    await setTier('enterprise');
    const response = await sendAs(org.orgId, org.member, 'POST', route(), {});
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data.scanId).not.toBe(orphanId);
    expect(await orphan()).toEqual({ status: 'failed', error_message: SCAN_INTERRUPTED_MESSAGE });

    // The new run has no rules and fails on its own; let it settle before teardown.
    const deadline = Date.now() + 5000;
    for (;;) {
      const { rows } = await pool.query('SELECT status FROM compliance_scans WHERE id = $1', [data.scanId]);
      if (rows[0].status === 'completed' || rows[0].status === 'failed') break;
      if (Date.now() > deadline) throw new Error('the new run did not settle');
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  });
});
