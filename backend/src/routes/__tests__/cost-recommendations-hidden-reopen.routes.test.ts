/**
 * PR 3a over real routes and live Postgres: GET /hidden and POST /:id/reopen
 * (registered before /:id), the member floor on reopen, and an audit event with
 * the caller as actor for resolve, dismiss, reopen and delete; none for a
 * refused or missing row.
 */
import costRecommendationsRoutes from '../cost-recommendations.routes';
import { createRoleGateHarness, MEMBER_REFUSAL, RoleGateOrg } from './role-gate-harness';
import { lowActivityMetadata } from '../../services/__tests__/helpers/low-activity-fixture';

const harness = createRoleGateHarness('hidden-reopen');
const { pool, sendAs } = harness;
const IDLE = 'Idle Instance';

let org: RoleGateOrg;
let other: RoleGateOrg;

beforeAll(async () => {
  org = await harness.buildOrg();
  other = await harness.buildOrg();
  await harness.listen((app) => app.use('/api/cost-recommendations', costRecommendationsRoutes));
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(async () => {
  jest.restoreAllMocks();
  await pool.query('DELETE FROM audit_logs WHERE organization_id = ANY($1)', [[org.orgId, other.orgId]]);
  await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [[org.orgId, other.orgId]]);
  await pool.query('DELETE FROM cost_finding_detections WHERE organization_id = ANY($1)', [[org.orgId, other.orgId]]);
  await pool.query('DELETE FROM cost_analysis_runs WHERE organization_id = ANY($1)', [[org.orgId, other.orgId]]);
});

afterAll(async () => {
  await harness.close();
});

async function insertRow(orgId: string, status: 'ACTIVE' | 'RESOLVED' | 'DISMISSED'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, potential_savings, severity, status, aws_region, updated_at)
     VALUES ($1, 'i-1234567890abcdef0', 'EC2', $2, 12.5, 'LOW', $3, 'us-east-1', '2026-09-03T18:54:05Z') RETURNING id`,
    [orgId, IDLE, status]
  );
  return rows[0].id;
}

/** The finding is still detected: a completed run after the decision detected it. */
async function detectedByLatestRun(orgId: string): Promise<void> {
  const { rows } = await pool.query(
    `INSERT INTO cost_analysis_runs (organization_id, status, source, checks, lease_acquired_at, completed_at)
     VALUES ($1, 'completed', 'discovery', $2, NOW(), NOW()) RETURNING id`,
    [orgId, JSON.stringify([{ rule_id: null, issue: IDLE, outcome: 'complete', detected: 1, unknown: 0 }])]
  );
  await pool.query(
    `INSERT INTO cost_finding_detections (organization_id, resource_id, issue, run_id, outcome, observed_at, detected_at, resource_type, potential_savings, severity, metadata)
     VALUES ($1, 'i-1234567890abcdef0', $2, $3, 'detected', NOW(), NOW(), 'EC2', 12.5, 'LOW', $4::jsonb)`,
    // What the low-activity rule writes (FP PR 2b): only such an Idle detection reads still detected.
    [orgId, IDLE, rows[0].id, JSON.stringify({ ...lowActivityMetadata(), savings_basis: 'estimated: list price' })]
  );
}

const audit = async (orgId: string) =>
  (await pool.query(`SELECT user_id, action, resource_id, user_agent FROM audit_logs WHERE organization_id = $1 ORDER BY created_at, id`, [orgId])).rows;

const statusOf = async (id: string) =>
  (await pool.query('SELECT status, occurrence_ended_at FROM cost_recommendations WHERE id = $1', [id])).rows[0];

describe('GET /api/cost-recommendations/hidden', () => {
  it('answers every role (read-only) and is not captured by /:id', async () => {
    const id = await insertRow(org.orgId, 'RESOLVED');
    for (const role of ['viewer', 'member', 'admin', 'owner'] as const) {
      const res = await sendAs(org.orgId, org[role], 'GET', '/cost-recommendations/hidden');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.data.items.map((item: { id: string }) => item.id)).toEqual([id]);
      expect(body.data.summary).toMatchObject({ resolved: 1, dismissed: 0, notConfirmed: 1, stillDetected: { count: 0 } });
    }
  });

  it('lists only the caller\'s organization', async () => {
    await insertRow(other.orgId, 'RESOLVED');
    const body = await (await sendAs(org.orgId, org.viewer, 'GET', '/cost-recommendations/hidden')).json();
    expect(body.data.items).toEqual([]);
  });
});

describe('POST /api/cost-recommendations/:id/reopen', () => {
  it('a viewer is refused: nothing changed, nothing recorded', async () => {
    const id = await insertRow(org.orgId, 'RESOLVED');
    const res = await sendAs(org.orgId, org.viewer, 'POST', `/cost-recommendations/${id}/reopen`);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject(MEMBER_REFUSAL);
    expect((await statusOf(id)).occurrence_ended_at).toBeNull();
    expect(await audit(org.orgId)).toEqual([]);
  });

  it('a member reopens a not-confirmed finding: pending, approved message, caller recorded', async () => {
    const id = await insertRow(org.orgId, 'RESOLVED');
    const res = await sendAs(org.orgId, org.member, 'POST', `/cost-recommendations/${id}/reopen`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      data: { reopened: true, rowsEnded: 1, activeNow: false, recommendation: null },
      message: "Reopened. It will appear after the next analysis if it's still detected.",
    });
    expect((await statusOf(id)).occurrence_ended_at).not.toBeNull();
    expect(await audit(org.orgId)).toEqual([{ user_id: org.member, action: 'cost_recommendation.reopened', resource_id: id, user_agent: expect.any(String) }]);
  });

  it('a still-detected finding comes back ACTIVE at once', async () => {
    const id = await insertRow(org.orgId, 'RESOLVED');
    await detectedByLatestRun(org.orgId);
    const body = await (await sendAs(org.orgId, org.admin, 'POST', `/cost-recommendations/${id}/reopen`)).json();
    expect(body).toMatchObject({ success: true, data: { reopened: true, rowsEnded: 1, activeNow: true }, message: "Reopened. It's back in your active recommendations." });
    expect(body.data.recommendation).toMatchObject({ status: 'ACTIVE', resource_id: 'i-1234567890abcdef0', issue: IDLE });
  });

  it('a second reopen changes nothing and records nothing', async () => {
    const id = await insertRow(org.orgId, 'RESOLVED');
    await sendAs(org.orgId, org.member, 'POST', `/cost-recommendations/${id}/reopen`);
    const res = await sendAs(org.orgId, org.member, 'POST', `/cost-recommendations/${id}/reopen`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, data: { reopened: false, reason: 'already_open' }, message: 'This finding was already reopened.' });
    expect(await audit(org.orgId)).toHaveLength(1);
  });

  it('another organization\'s row is not found: nothing changed, nothing recorded', async () => {
    const foreign = await insertRow(other.orgId, 'RESOLVED');
    const res = await sendAs(org.orgId, org.owner, 'POST', `/cost-recommendations/${foreign}/reopen`);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ success: false, error: 'Recommendation not found' });
    expect((await statusOf(foreign)).occurrence_ended_at).toBeNull();
    expect(await audit(org.orgId)).toEqual([]);
    expect(await audit(other.orgId)).toEqual([]);
  });

  it('a failure answers fixed text, never the database error', async () => {
    const res = await sendAs(org.orgId, org.member, 'POST', '/cost-recommendations/not-a-uuid/reopen');
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ success: false, error: 'Failed to reopen recommendation' });
  });
});

describe('resolve, dismiss and delete record the caller', () => {
  it('each writes one event with the caller as actor, in order', async () => {
    const id = await insertRow(org.orgId, 'ACTIVE');
    expect((await sendAs(org.orgId, org.member, 'PATCH', `/cost-recommendations/${id}/resolve`)).status).toBe(200);
    expect((await sendAs(org.orgId, org.admin, 'PATCH', `/cost-recommendations/${id}/dismiss`)).status).toBe(200);
    expect((await sendAs(org.orgId, org.owner, 'DELETE', `/cost-recommendations/${id}`)).status).toBe(200);
    expect((await audit(org.orgId)).map(({ user_id, action, resource_id }) => ({ user_id, action, resource_id }))).toEqual([
      { user_id: org.member, action: 'cost_recommendation.resolved', resource_id: id },
      { user_id: org.admin, action: 'cost_recommendation.dismissed', resource_id: id },
      { user_id: org.owner, action: 'cost_recommendation.deleted', resource_id: id },
    ]);
  });

  it('a refused or missing row records nothing', async () => {
    const id = await insertRow(org.orgId, 'ACTIVE');
    expect((await sendAs(org.orgId, org.viewer, 'PATCH', `/cost-recommendations/${id}/resolve`)).status).toBe(403);
    expect((await sendAs(org.orgId, org.member, 'DELETE', `/cost-recommendations/${id}`)).status).toBe(403);
    const foreign = await insertRow(other.orgId, 'ACTIVE');
    expect((await sendAs(org.orgId, org.member, 'PATCH', `/cost-recommendations/${foreign}/dismiss`)).status).toBe(404);
    expect((await sendAs(org.orgId, org.admin, 'DELETE', `/cost-recommendations/${foreign}`)).status).toBe(404);
    expect(await audit(org.orgId)).toEqual([]);
    expect(await audit(other.orgId)).toEqual([]);
    expect((await statusOf(id)).status).toBe('ACTIVE');
  });
});
