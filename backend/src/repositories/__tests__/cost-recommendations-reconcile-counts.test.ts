/**
 * Live-DB coverage of the counts reconciliation returns: every finding of a
 * successful category ends in exactly one bucket, and
 *   detected = new + refreshed + suppressedResolved + suppressedDismissed + duplicate
 *   persisted = new + refreshed
 */
import { Pool } from 'pg';
import { CostRecommendationsRepository } from '../cost-recommendations.repository';
import { ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY } from '../../config/optimization-rules';
import type { ReconcileCounts } from '../../services/cost-analysis-outcome';
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
const ISSUE = 'Idle Instance';

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free') RETURNING id`,
    [`Reconcile Counts Org ${suffix}`, `reconcile-counts-org-${suffix}`, `Reconcile Counts Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await leases.hold(rows[0].id);
  return rows[0].id;
}

function finding(resourceId: string, overrides: Partial<CreateRecommendationRequest> = {}): CreateRecommendationRequest {
  return {
    resource_id: resourceId,
    resource_name: resourceId,
    resource_type: 'EC2',
    issue: ISSUE,
    description: 'placeholder',
    potential_savings: 1,
    severity: 'LOW',
    aws_region: 'us-east-1',
    metadata: {},
    ...overrides,
  };
}

const observation = (recommendations: CreateRecommendationRequest[], overrides: Partial<DetectorObservation> = {}): DetectorObservation => ({
  issue: ISSUE,
  success: true,
  recommendations,
  ...overrides,
});

async function reconcile(orgId: string, observations: DetectorObservation[]) {
  return repository.reconcileActiveRecommendations(orgId, observations, { homeRegion: 'us-east-1' }, await leases.hold(orgId));
}

/** A RESOLVED or DISMISSED row with an open occurrence, decided at `updatedAt`. */
async function insertDecision(orgId: string, resourceId: string, status: 'RESOLVED' | 'DISMISSED', updatedAt: string, ended = false): Promise<void> {
  await pool.query(
    `INSERT INTO cost_recommendations
       (organization_id, resource_id, resource_type, issue, potential_savings, severity, status, aws_region, updated_at, occurrence_ended_at)
     VALUES ($1, $2, 'EC2', $3, 1, 'LOW', $4, 'us-east-1', $5, $6)`,
    [orgId, resourceId, ISSUE, status, updatedAt, ended ? updatedAt : null]
  );
}

function expectReconciles(counts: ReconcileCounts): void {
  expect(counts.detected).toBe(counts.new + counts.refreshed + counts.suppressedResolved + counts.suppressedDismissed + counts.duplicate);
  expect(counts.persisted).toBe(counts.new + counts.refreshed);
}

afterAll(async () => {
  await leases.cleanup();
  if (createdOrgIds.length > 0) await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.end();
});

describe('reconcileActiveRecommendations counts', () => {
  it('a first finding is new; the same finding next scan is refreshed', async () => {
    const orgId = await insertOrg();
    const first = await reconcile(orgId, [observation([finding('i-a')])]);
    expect(first.counts).toMatchObject({ detected: 1, new: 1, refreshed: 0, persisted: 1 });
    const second = await reconcile(orgId, [observation([finding('i-a')])]);
    expect(second.counts).toMatchObject({ detected: 1, new: 0, refreshed: 1, persisted: 1 });
    expect(second.insertedCount).toBe(1);
  });

  it('every bucket at once still reconciles', async () => {
    const orgId = await insertOrg();
    await reconcile(orgId, [observation([finding('i-refreshed')])]);
    await insertDecision(orgId, 'i-resolved', 'RESOLVED', '2026-09-03T18:54:05Z');
    await insertDecision(orgId, 'i-dismissed', 'DISMISSED', '2026-09-02T11:56:31Z');

    const { counts, insertedCount } = await reconcile(orgId, [
      observation([finding('i-refreshed'), finding('i-new'), finding('i-new'), finding('i-resolved'), finding('i-dismissed')]),
    ]);

    expect(counts).toEqual({ detected: 5, new: 1, refreshed: 1, suppressedResolved: 1, suppressedDismissed: 1, duplicate: 1, persisted: 2 });
    expect(insertedCount).toBe(2);
    expectReconciles(counts!);
  });

  it('one finding with 36 RESOLVED and 1 DISMISSED open rows counts once, under the newest decision', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-many', 'DISMISSED', '2026-09-02T11:56:31Z');
    for (let day = 1; day <= 36; day += 1) {
      const when = day === 36 ? '2026-09-03T18:54:05Z' : `2026-08-${String((day % 28) + 1).padStart(2, '0')}T12:00:00Z`;
      await insertDecision(orgId, 'i-many', 'RESOLVED', when);
    }
    const { counts } = await reconcile(orgId, [observation([finding('i-many')])]);
    expect(counts).toMatchObject({ detected: 1, suppressedResolved: 1, suppressedDismissed: 0, persisted: 0 });
    expectReconciles(counts!);
  });

  it('the newest decision wins the other way round too', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-later-dismissed', 'RESOLVED', '2026-09-02T11:56:31Z');
    await insertDecision(orgId, 'i-later-dismissed', 'DISMISSED', '2026-09-03T18:54:05Z');
    const { counts } = await reconcile(orgId, [observation([finding('i-later-dismissed')])]);
    expect(counts).toMatchObject({ suppressedResolved: 0, suppressedDismissed: 1 });
  });

  it('an ended occurrence blocks nothing: the finding is new', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-ended', 'RESOLVED', '2026-09-03T18:54:05Z', true);
    const { counts } = await reconcile(orgId, [observation([finding('i-ended')])]);
    expect(counts).toMatchObject({ new: 1, suppressedResolved: 0, persisted: 1 });
  });

  it('a failed detector adds nothing', async () => {
    const orgId = await insertOrg();
    const { counts } = await reconcile(orgId, [
      observation([finding('i-ok')]),
      observation([], { issue: 'Unused Elastic IP', success: false }),
    ]);
    expect(counts!.detected).toBe(1);
  });

  it('every detector failing is all zeros, not a missing answer', async () => {
    const orgId = await insertOrg();
    const { counts } = await reconcile(orgId, [observation([], { success: false })]);
    expect(counts).toEqual({ detected: 0, new: 0, refreshed: 0, suppressedResolved: 0, suppressedDismissed: 0, duplicate: 0, persisted: 0 });
  });

  it('suppression itself is unchanged: no ACTIVE row appears', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-resolved', 'RESOLVED', '2026-09-03T18:54:05Z');
    await reconcile(orgId, [observation([finding('i-resolved')])]);
    const { rows } = await pool.query(
      `SELECT COUNT(*)::int AS count FROM cost_recommendations WHERE organization_id = $1 AND status = 'ACTIVE'`,
      [orgId]
    );
    expect(rows[0].count).toBe(0);
  });
});

describe('replaceReservedInstanceRecommendations counts', () => {
  const ri = (id: string) => finding(id, { issue: ISSUE_EC2_RESERVED_INSTANCE_OPPORTUNITY, potential_savings: 0 });
  const replace = async (orgId: string, recs: CreateRecommendationRequest[]) =>
    repository.replaceReservedInstanceRecommendations(orgId, { homeRegion: 'us-east-1' }, recs, await leases.hold(orgId));

  it('new, then refreshed, and a repeat in one batch is a duplicate', async () => {
    const orgId = await insertOrg();
    expect((await replace(orgId, [ri('ri-opportunity-t3.micro')])).counts).toMatchObject({ detected: 1, new: 1, persisted: 1 });
    const second = await replace(orgId, [ri('ri-opportunity-t3.micro'), ri('ri-opportunity-t3.micro')]);
    expect(second.counts).toMatchObject({ detected: 2, refreshed: 1, duplicate: 1, persisted: 1 });
    expectReconciles(second.counts!);
  });
});
