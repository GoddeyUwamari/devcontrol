/**
 * Home region HR-1 item 5 (D.2.3, T3): a Resolve/Dismiss decision hides a finding
 * only in its own region. resource_id is not region-unique (FD-1: a Lambda
 * function name, a DynamoDB table name, an RI instance type), so after the home
 * region moves, a decision taken on "api" in the old region must not hide "api"
 * in the new one. Decisions with no region (written before regions were
 * recorded) still hide every region, and a same-region decision behaves exactly
 * as before. The suppression INSERT and the decision lookup (counts and the
 * hidden-finding observations) agree.
 *
 * Live database, real reconcile under a real scan lease. Placeholders only.
 */
import { Pool } from 'pg';
import { CostRecommendationsRepository, decisionRegionMatches } from '../cost-recommendations.repository';
import { ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY, ISSUE_LAMBDA_LOW_USAGE } from '../../config/optimization-rules';
import type { DetectorObservation } from '../../services/cost-optimization.service';
import type { CreateRecommendationRequest } from '../../types';
import { TestLeases } from '../../services/__tests__/helpers/scan-source';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const repository = new CostRecommendationsRepository();
const leases = new TestLeases(pool);
const createdOrgIds: string[] = [];
const ISSUE = ISSUE_LAMBDA_LOW_USAGE;
const NEW_HOME = 'us-west-2';

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Region Suppression ${suffix}`, `region-suppression-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await leases.hold(rows[0].id);
  return rows[0].id;
}

const finding = (resourceId: string, region: string | null = NEW_HOME, issue = ISSUE): CreateRecommendationRequest => ({
  resource_id: resourceId, resource_name: resourceId, resource_type: 'Lambda', issue, description: 'placeholder',
  potential_savings: 3, severity: 'LOW', aws_region: region as string, metadata: {},
});

async function decide(orgId: string, resourceId: string, status: 'RESOLVED' | 'DISMISSED', region: string | null, updatedAt: string): Promise<void> {
  await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, potential_savings, severity, status, aws_region, updated_at)
     VALUES ($1, $2, 'Lambda', $3, 1, 'LOW', $4, $5, $6)`,
    [orgId, resourceId, ISSUE, status, region, updatedAt]
  );
}

const reconcile = (orgId: string, observations: DetectorObservation[], home = NEW_HOME) =>
  repository.reconcileActiveRecommendations(orgId, observations, { homeRegion: home }, leases.of(orgId));

const rows = async (orgId: string) => (await pool.query(
  `SELECT resource_id, aws_region, status, occurrence_ended_at IS NOT NULL AS ended FROM cost_recommendations
    WHERE organization_id = $1 ORDER BY resource_id, status, aws_region NULLS FIRST`, [orgId])).rows;
const observed = async (orgId: string) => (await pool.query(
  `SELECT resource_id, outcome FROM cost_finding_detections WHERE organization_id = $1 ORDER BY resource_id`, [orgId])).rows;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  await leases.cleanup();
  if (createdOrgIds.length > 0) await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.end();
});

describe('decisionRegionMatches', () => {
  it.each([
    ['us-east-1', 'us-east-1', true],
    ['us-east-1', 'us-west-2', false],
    [null, 'us-west-2', true],
    ['us-east-1', null, true],
    [null, null, true],
  ] as const)('decision %s, finding %s: %s', (decision, findingRegion, expected) => {
    expect(decisionRegionMatches(decision, findingRegion)).toBe(expected);
  });
});

describe('reconcileActiveRecommendations: a decision hides a finding only in its own region (T3)', () => {
  it('a DISMISSED "api" in us-east-1 does not hide "api" detected in us-west-2: it is inserted, counted new, and the old decision stays open', async () => {
    const orgId = await insertOrg();
    await decide(orgId, 'api', 'DISMISSED', 'us-east-1', '2026-11-01T10:00:00Z');
    const { counts, insertedCount } = await reconcile(orgId, [{ issue: ISSUE, success: true, recommendations: [finding('api')] }]);
    expect(insertedCount).toBe(1);
    expect(counts).toMatchObject({ detected: 1, new: 1, persisted: 1, suppressedDismissed: 0, suppressedResolved: 0 });
    expect(await rows(orgId)).toEqual([
      { resource_id: 'api', aws_region: 'us-west-2', status: 'ACTIVE', ended: false },
      { resource_id: 'api', aws_region: 'us-east-1', status: 'DISMISSED', ended: false },
    ]);
    expect(await observed(orgId)).toEqual([]);
  });

  it('a decision in the same region still hides it, exactly as before (counted, observed, not inserted)', async () => {
    const orgId = await insertOrg();
    await decide(orgId, 'api', 'DISMISSED', NEW_HOME, '2026-11-01T10:00:00Z');
    const { counts, insertedCount } = await reconcile(orgId, [{ issue: ISSUE, success: true, recommendations: [finding('api')] }]);
    expect(insertedCount).toBe(0);
    expect(counts).toMatchObject({ detected: 1, persisted: 0, suppressedDismissed: 1 });
    expect(await rows(orgId)).toEqual([{ resource_id: 'api', aws_region: NEW_HOME, status: 'DISMISSED', ended: false }]);
    expect(await observed(orgId)).toEqual([{ resource_id: 'api', outcome: 'detected' }]);
  });

  it('a decision with no region (written before regions were recorded) still hides every region', async () => {
    const orgId = await insertOrg();
    await decide(orgId, 'api', 'RESOLVED', null, '2026-11-01T10:00:00Z');
    const { counts, insertedCount } = await reconcile(orgId, [{ issue: ISSUE, success: true, recommendations: [finding('api')] }]);
    expect(insertedCount).toBe(0);
    expect(counts).toMatchObject({ suppressedResolved: 1, persisted: 0 });
  });

  it('the newest decision OF THE SAME REGION is the one in force, not the newest overall', async () => {
    const orgId = await insertOrg();
    await decide(orgId, 'api', 'RESOLVED', NEW_HOME, '2026-10-01T10:00:00Z');
    await decide(orgId, 'api', 'DISMISSED', 'us-east-1', '2026-11-01T10:00:00Z');
    const { counts } = await reconcile(orgId, [{ issue: ISSUE, success: true, recommendations: [finding('api')] }]);
    expect(counts).toMatchObject({ suppressedResolved: 1, suppressedDismissed: 0, persisted: 0 });
  });

  it('a resource listed but not evaluated is observed as hidden only when a decision of its region (or none) hides it', async () => {
    const orgId = await insertOrg();
    await decide(orgId, 'api', 'DISMISSED', 'us-east-1', '2026-11-01T10:00:00Z');
    await decide(orgId, 'worker', 'DISMISSED', NEW_HOME, '2026-11-01T10:00:00Z');
    await reconcile(orgId, [{ issue: ISSUE, success: true, recommendations: [], unknownResourceIds: ['api', 'worker'] }]);
    expect(await observed(orgId)).toEqual([{ resource_id: 'worker', outcome: 'unknown' }]);
  });

  it('the same id in two regions with no decision: the new home region\'s finding is inserted once the old region\'s ACTIVE row is gone', async () => {
    const orgId = await insertOrg();
    // The old home region's ACTIVE row, as the old home region's last scan left it.
    await reconcile(orgId, [{ issue: ISSUE, success: true, recommendations: [finding('api', 'us-east-1')] }], 'us-east-1');
    // Without the change step (D.2): the same id in us-west-2 collides with the ACTIVE row and is dropped.
    const blocked = await reconcile(orgId, [{ issue: ISSUE, success: true, recommendations: [finding('api')] }]);
    expect(blocked.counts).toMatchObject({ detected: 1, persisted: 0, duplicate: 1 });
    // After the change step removed it, the us-west-2 finding is inserted.
    await pool.query(`DELETE FROM cost_recommendations WHERE organization_id = $1 AND status = 'ACTIVE' AND aws_region = 'us-east-1'`, [orgId]);
    const after = await reconcile(orgId, [{ issue: ISSUE, success: true, recommendations: [finding('api')] }]);
    expect(after.counts).toMatchObject({ detected: 1, persisted: 1, new: 1 });
    expect(await rows(orgId)).toEqual([{ resource_id: 'api', aws_region: NEW_HOME, status: 'ACTIVE', ended: false }]);
  });

  it('Reserved Instance rows (delete and recreate): the new home region\'s row needs the old one gone; never hidden by a decision', async () => {
    const orgId = await insertOrg();
    const ri = (region: string) => ({ ...finding('ri-opportunity-t3.large', region, ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY), resource_type: 'EC2' });
    await repository.replaceReservedInstanceRecommendations(orgId, { homeRegion: 'us-east-1' }, [ri('us-east-1')], leases.of(orgId));
    const blocked = await repository.replaceReservedInstanceRecommendations(orgId, { homeRegion: NEW_HOME }, [ri(NEW_HOME)], leases.of(orgId));
    expect(blocked.insertedCount).toBe(0);
    await pool.query(`DELETE FROM cost_recommendations WHERE organization_id = $1 AND status = 'ACTIVE' AND aws_region = 'us-east-1'`, [orgId]);
    const after = await repository.replaceReservedInstanceRecommendations(orgId, { homeRegion: NEW_HOME }, [ri(NEW_HOME)], leases.of(orgId));
    expect(after.insertedCount).toBe(1);
  });
});
