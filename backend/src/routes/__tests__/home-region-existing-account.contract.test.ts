/**
 * Home region HR-1 contract (T7): an EXISTING account (home region us-east-1, as
 * every account connected before HR-1; never given a proposal) behaves byte for
 * byte as it did before HR-1.
 *
 * The snapshot was recorded against the code as it was before HR-1 (origin/main
 * 0c8643a7), in a temporary worktree, and is never re-recorded by HR-1: any
 * difference fails it. Covered:
 *   - cost reconciliation over a fixture of every decision shape that region-aware
 *     suppression (D.2.3) reads: open and ended RESOLVED / DISMISSED rows in
 *     us-east-1 and with no region, several issues, detected, absent and unknown
 *     resources: the rows left, the counts, the hidden-finding observations;
 *   - the Reserved Instance replacement in the same organization;
 *   - the savings totals and counts the Dashboard and the weekly email read
 *     (getStats);
 *   - GET /api/aws/accounts for the owner (ids and times normalized). HR-1 adds
 *     keys (home_region_proposal, previous_home_region, home_region_changed_at)
 *     which for such an account must be null; with them removed the response is
 *     the recorded one.
 *
 * Real routes and repositories against live Postgres; only authService.verifyToken
 * is stubbed (role-gate harness). Placeholders only.
 */
import awsRoutes from '../aws.routes';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import {
  ISSUE_EBS_UNATTACHED_VOLUME,
  ISSUE_EC2_IDLE_INSTANCE,
  ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY,
  ISSUE_LAMBDA_LOW_USAGE,
  ISSUE_S3_LIFECYCLE_OPTIMIZATION,
} from '../../config/optimization-rules';
import { TestLeases } from '../../services/__tests__/helpers/scan-source';
import { createRoleGateHarness, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const harness = createRoleGateHarness('home-region-contract');
const { pool } = harness;
const leases = new TestLeases(pool);
const repository = new CostRecommendationsRepository();
const HOME = 'us-east-1';

const rec = (resourceId: string, issue: string, region: string | null, savings = 10) => ({
  resource_id: resourceId, resource_name: resourceId, resource_type: 'EC2', issue, description: 'placeholder',
  potential_savings: savings, severity: 'LOW' as const, aws_region: region as string, metadata: {},
});

async function decision(orgId: string, resourceId: string, issue: string, status: 'RESOLVED' | 'DISMISSED', region: string | null, updatedAt: string, ended = false) {
  await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, description, potential_savings, severity, status, aws_region, updated_at, occurrence_ended_at)
     VALUES ($1, $2, $2, 'EC2', $3, 'placeholder', 7, 'LOW', $4, $5, $6, $7)`,
    [orgId, resourceId, issue, status, region, updatedAt, ended ? updatedAt : null]
  );
}

async function active(orgId: string, resourceId: string, issue: string, region: string | null, savings = 4) {
  await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, description, potential_savings, severity, aws_region, metadata)
     VALUES ($1, $2, $2, 'EC2', $3, 'placeholder', $4, 'LOW', $5, '{}')`,
    [orgId, resourceId, issue, savings, region]
  );
}

/** The organization's cost state, without ids and times. */
async function costState(orgId: string) {
  const rows = (await pool.query(
    `SELECT resource_id, issue, aws_region, status, potential_savings::text AS savings, occurrence_ended_at IS NOT NULL AS ended
       FROM cost_recommendations WHERE organization_id = $1
      ORDER BY issue, resource_id, status, aws_region NULLS FIRST, savings`, [orgId])).rows;
  const detections = (await pool.query(
    `SELECT resource_id, issue, outcome, aws_region, potential_savings::text AS savings FROM cost_finding_detections WHERE organization_id = $1 ORDER BY issue, resource_id`,
    [orgId])).rows;
  return { rows, detections };
}

let org: RoleGateOrg;

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await harness.listen((app) => app.use('/api/aws', awsRoutes));
  org = await harness.buildOrg();
  await leases.hold(org.orgId);
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await harness.close(async (orgIds) => {
    await pool.query('DELETE FROM cost_finding_detections WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM aws_connection_checks WHERE organization_id = ANY($1)', [orgIds]);
    await leases.cleanup();
  });
});

describe('an existing us-east-1 account is unchanged by HR-1 (T7)', () => {
  it('cost reconciliation, Reserved Instance replacement and the savings totals: the recorded result', async () => {
    const orgId = org.orgId;
    // Decisions of every shape region-aware suppression reads.
    await decision(orgId, 'i-hr-a1', ISSUE_EC2_IDLE_INSTANCE, 'DISMISSED', HOME, '2026-11-01T10:00:00Z');
    await decision(orgId, 'i-hr-a2', ISSUE_EC2_IDLE_INSTANCE, 'RESOLVED', null, '2026-11-02T10:00:00Z');
    await decision(orgId, 'i-hr-a3', ISSUE_EC2_IDLE_INSTANCE, 'RESOLVED', HOME, '2026-10-01T10:00:00Z');
    await decision(orgId, 'i-hr-a3', ISSUE_EC2_IDLE_INSTANCE, 'DISMISSED', HOME, '2026-11-03T10:00:00Z');
    await decision(orgId, 'i-hr-a4', ISSUE_EC2_IDLE_INSTANCE, 'DISMISSED', HOME, '2026-09-01T10:00:00Z', true);
    await decision(orgId, 'i-hr-a5', ISSUE_EC2_IDLE_INSTANCE, 'RESOLVED', HOME, '2026-11-04T10:00:00Z');
    await decision(orgId, 'placeholder-fn', ISSUE_LAMBDA_LOW_USAGE, 'DISMISSED', HOME, '2026-11-05T10:00:00Z');
    await decision(orgId, 'placeholder-unknown-fn', ISSUE_LAMBDA_LOW_USAGE, 'RESOLVED', null, '2026-11-05T10:00:00Z');
    // ACTIVE rows the scans left.
    await active(orgId, 'i-hr-a6', ISSUE_EC2_IDLE_INSTANCE, HOME);
    await active(orgId, 'i-hr-a7', ISSUE_EC2_IDLE_INSTANCE, null);
    await active(orgId, 'vol-hr-a1', ISSUE_EBS_UNATTACHED_VOLUME, HOME, 12);
    await active(orgId, 'placeholder-bucket', ISSUE_S3_LIFECYCLE_OPTIMIZATION, HOME, 3);
    await active(orgId, 'ri-opportunity-t3.large', ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY, HOME, 20);

    const reconciled = await repository.reconcileActiveRecommendations(orgId, [
      {
        issue: ISSUE_EC2_IDLE_INSTANCE,
        success: true,
        recommendations: [
          rec('i-hr-a1', ISSUE_EC2_IDLE_INSTANCE, HOME),
          rec('i-hr-a2', ISSUE_EC2_IDLE_INSTANCE, HOME),
          rec('i-hr-a3', ISSUE_EC2_IDLE_INSTANCE, HOME),
          rec('i-hr-a4', ISSUE_EC2_IDLE_INSTANCE, HOME),
          rec('i-hr-a6', ISSUE_EC2_IDLE_INSTANCE, HOME, 11),
          rec('i-hr-a8', ISSUE_EC2_IDLE_INSTANCE, HOME, 9),
        ],
      },
      {
        issue: ISSUE_LAMBDA_LOW_USAGE,
        success: true,
        recommendations: [rec('placeholder-fn', ISSUE_LAMBDA_LOW_USAGE, HOME)],
        unknownResourceIds: ['placeholder-unknown-fn'],
      },
      { issue: ISSUE_EBS_UNATTACHED_VOLUME, success: false, recommendations: [] },
    ], { homeRegion: HOME }, leases.of(orgId));

    const replaced = await repository.replaceReservedInstanceRecommendations(orgId, { homeRegion: HOME },
      [rec('ri-opportunity-m5.large', ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY, HOME, 30)], leases.of(orgId));

    const stats = await repository.getStats(orgId);
    expect({ reconciled, replaced, state: await costState(orgId), stats }).toMatchSnapshot();
  });

  it('GET /api/aws/accounts for the owner: home_region_proposal is null (or absent before HR-1); without it, the recorded response', async () => {
    const res = await harness.sendAs(org.orgId, org.owner, 'GET', '/aws/accounts');
    expect(res.status).toBe(200);
    const body = await res.json();
    // HR-1's added keys: null for an account that never had a proposal or a home region change.
    for (const added of ['home_region_proposal', 'previous_home_region', 'home_region_changed_at']) {
      expect(body[added] ?? null).toBeNull();
      delete body[added];
    }
    for (const account of body.data) {
      for (const volatile of ['id', 'org_id', 'account_id', 'connected_at']) {
        if (account[volatile] !== null && account[volatile] !== undefined) account[volatile] = `<${volatile}>`;
      }
    }
    expect(body).toMatchSnapshot();
  });
});
