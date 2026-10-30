/**
 * /api/soc2/customer-evidence as routes/index.ts mounts it: authenticated
 * exactly once, by its own router, with the same plan, role and organization
 * rules as before. /api/soc2 is unaffected.
 *
 * The customer-evidence router is mounted before /soc2, so its requests are
 * answered inside it and never pass through the /soc2 router's authenticate.
 * Each request runs authenticate once, which calls authService.verifyToken
 * once; the count is what these tests check.
 *
 * Real index router over HTTP against live Postgres (role-gate-harness.ts).
 */
import { SOC2_V1_CRITERIA } from '../../config/soc2CriteriaConfig';
import { authService } from '../../services/auth.service';
import routes from '../index';
import { ROLES, RoleGateOrg, createRoleGateHarness } from './role-gate-harness';

// Constructed at route import; it would create its table on the app pool.
jest.mock('../../services/nl-query-analytics.service', () => ({
  NLQueryAnalyticsService: jest.fn().mockImplementation(() => ({ initializeTable: jest.fn(async () => undefined) })),
}));

const harness = createRoleGateHarness('soc2-mount');
const { pool, sendAs } = harness;
const CRITERION = SOC2_V1_CRITERIA[0].criterionId;

let home: RoleGateOrg;
let other: RoleGateOrg;

async function insertEvidence(orgId: string, title: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO customer_evidence (organization_id, criterion_id, evidence_type, title)
     VALUES ($1, $2, 'policy_document', $3) RETURNING id`,
    [orgId, CRITERION, title]
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  home = await harness.buildOrg();
  other = await harness.buildOrg();
  await harness.listen((app) => app.use('/api', routes));
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  await harness.close(async (orgIds) => {
    await pool.query('DELETE FROM customer_evidence WHERE organization_id = ANY($1)', [orgIds]);
  });
});

function verifyTokenCalls(): number {
  return (authService.verifyToken as jest.Mock).mock.calls.length;
}

describe('/api/soc2/customer-evidence is authenticated exactly once', () => {
  it('a member lists their organization\'s evidence: one authentication, only their rows', async () => {
    const mine = await insertEvidence(home.orgId, 'Home policy');
    const theirs = await insertEvidence(other.orgId, 'Other policy');

    const response = await sendAs(home.orgId, home.member, 'GET', '/soc2/customer-evidence');

    expect(response.status).toBe(200);
    expect(verifyTokenCalls()).toBe(1);
    const ids = ((await response.json()).customerEvidence as Array<{ evidenceId: string }>).map((row) => row.evidenceId);
    expect(ids).toContain(mine);
    expect(ids).not.toContain(theirs);
  });

  it('another organization\'s evidence is not found', async () => {
    const theirs = await insertEvidence(other.orgId, 'Other policy');

    const response = await sendAs(home.orgId, home.owner, 'GET', `/soc2/customer-evidence/${theirs}`);

    expect(response.status).toBe(404);
    expect(verifyTokenCalls()).toBe(1);
  });

  it('no token is 401 from authenticate', async () => {
    const response = await fetch(`${harness.url()}/soc2/customer-evidence`);

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({ success: false, error: 'No authentication token provided' });
  });

  it('an organization below Enterprise is refused with 402', async () => {
    await pool.query("UPDATE organizations SET subscription_tier = 'pro' WHERE id = $1", [other.orgId]);
    try {
      const response = await sendAs(other.orgId, other.owner, 'GET', '/soc2/customer-evidence');

      expect(response.status).toBe(402);
      expect((await response.json()).code).toBe('TIER_REQUIRED');
      expect(verifyTokenCalls()).toBe(1);
    } finally {
      await pool.query("UPDATE organizations SET subscription_tier = 'enterprise' WHERE id = $1", [other.orgId]);
    }
  });

  it('a viewer cannot submit evidence', async () => {
    const response = await sendAs(home.orgId, home.viewer, 'POST', '/soc2/customer-evidence', {
      criterionId: CRITERION,
      evidenceType: 'policy_document',
      title: 'Viewer attempt',
    });

    expect(response.status).toBe(403);
    expect(verifyTokenCalls()).toBe(1);
  });

  it.each(ROLES)('review is platform staff only: a %s who is not staff is refused', async (role) => {
    const id = await insertEvidence(home.orgId, 'Review target');

    const response = await sendAs(home.orgId, home[role], 'POST', `/soc2/customer-evidence/${id}/review`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, error: 'Platform staff authorization required' });
    expect(verifyTokenCalls()).toBe(1);
  });
});

describe('/api/soc2 is unchanged', () => {
  it('readiness is authenticated once', async () => {
    const response = await sendAs(home.orgId, home.viewer, 'GET', '/soc2/readiness');

    expect(response.status).toBe(200);
    expect(verifyTokenCalls()).toBe(1);
  });

  it('readiness without a token is 401', async () => {
    const response = await fetch(`${harness.url()}/soc2/readiness`);

    expect(response.status).toBe(401);
  });
});
