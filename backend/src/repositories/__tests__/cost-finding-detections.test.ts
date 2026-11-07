/**
 * PR 3a, live Postgres: per-finding detection recorded by reconciliation,
 * "still detected" judged per finding, the hidden list, reopen, and audit
 * events written in the same transaction as each decision.
 *
 * Real transactions, advisory locks and the partial unique index: a mock
 * cannot exercise them.
 */
import { Pool } from 'pg';
import { CostDecisionActor, CostRecommendationsRepository } from '../cost-recommendations.repository';
import type { DetectorObservation } from '../../services/cost-optimization.service';
import type { CostAnalysisCheck } from '../../services/cost-analysis-outcome';
import type { CreateRecommendationRequest } from '../../types';
import { TestLeases } from '../../services/__tests__/helpers/scan-source';
import { ISSUE_RDS_OVERSIZED_INSTANCE } from '../../config/optimization-rules';
import { lowActivityMetadata } from '../../services/__tests__/helpers/low-activity-fixture';

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
const createdUserIds: string[] = [];

const IDLE = 'Idle Instance';
const S3 = 'S3 Lifecycle Optimization';
const RI = 'Reserved Instance Opportunity';
const DECIDED_AT = '2026-09-03T18:54:05Z';

let actor: CostDecisionActor;
let leaseOffset = 0;

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function insertOrg(): Promise<string> {
  const s = suffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Finding Detections Org ${s}`, `finding-detections-org-${s}`]
  );
  createdOrgIds.push(rows[0].id);
  await leases.hold(rows[0].id);
  return rows[0].id;
}

async function insertUser(name = 'Decision Actor'): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', $2) RETURNING id`,
    [`finding-detections-${suffix()}@example.com`, name]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id;
}

beforeAll(async () => {
  actor = { userId: await insertUser('Pat Placeholder'), request: { ipAddress: '127.0.0.1', userAgent: 'jest' }, source: 'button' };
});

afterAll(async () => {
  await leases.cleanup();
  if (createdOrgIds.length > 0) await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  if (createdUserIds.length > 0) await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// An Idle finding as the low-activity rule writes it (FP PR 2b): only a detection
// carrying that rule's identity reads still detected for this issue (FP2b-Q14).
const IDLE_METADATA = { ...lowActivityMetadata(), savings_basis: 'estimated: list price' };

function finding(resourceId: string, overrides: Partial<CreateRecommendationRequest> = {}): CreateRecommendationRequest {
  return {
    resource_id: resourceId,
    resource_name: `${resourceId}-name`,
    resource_type: 'EC2',
    issue: IDLE,
    description: 'Average CPU below the threshold for 7 days',
    potential_savings: 12.5,
    severity: 'LOW',
    aws_region: 'us-east-1',
    metadata: IDLE_METADATA,
    ...overrides,
  };
}

const s3Finding = (bucket: string) =>
  finding(bucket, { issue: S3, resource_type: 'S3', potential_savings: 4, metadata: { savings_basis: 'ceiling: all to Standard-IA' } });

const observation = (issue: string, recommendations: CreateRecommendationRequest[], overrides: Partial<DetectorObservation> = {}): DetectorObservation => ({
  issue, success: true, recommendations, ...overrides,
});

const check = (issue: string, outcome: 'complete' | 'failed' = 'complete'): CostAnalysisCheck => ({ rule_id: null, issue, outcome, detected: 0, unknown: 0 });

/** A run that took the lease after every earlier one (or at `leaseAt`), with the given state and checks. */
async function insertRun(orgId: string, options: {
  status?: 'running' | 'completed' | 'partial' | 'failed' | 'interrupted';
  checks?: CostAnalysisCheck[] | null;
  leaseAt?: string;
  createdAt?: string;
  source?: 'manual' | 'discovery';
} = {}): Promise<string> {
  leaseOffset += 1;
  const { rows } = await pool.query(
    `INSERT INTO cost_analysis_runs (organization_id, status, source, checks, lease_acquired_at, created_at, completed_at)
     VALUES ($1, $2::varchar, $3, $4::jsonb, COALESCE($5::timestamptz, NOW() + make_interval(secs => $7::int)), COALESCE($6::timestamptz, NOW()),
             CASE WHEN $2::varchar = 'running' THEN NULL ELSE NOW() END)
     RETURNING id`,
    [
      orgId, options.status ?? 'completed', options.source ?? 'discovery',
      options.checks === null ? null : JSON.stringify(options.checks ?? [check(IDLE), check(S3)]),
      options.leaseAt ?? null, options.createdAt ?? null, leaseOffset,
    ]
  );
  return rows[0].id;
}

async function reconcile(orgId: string, observations: DetectorObservation[], runId: string | null) {
  return repository.reconcileActiveRecommendations(orgId, observations, { homeRegion: 'us-east-1' }, await leases.hold(orgId), runId);
}

/** An open (or ended) decision row, as production's history holds. */
async function insertDecision(orgId: string, resourceId: string, status: 'RESOLVED' | 'DISMISSED', updatedAt = DECIDED_AT, issue = IDLE): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO cost_recommendations
       (organization_id, resource_id, resource_name, resource_type, issue, potential_savings, severity, status, aws_region, created_at, updated_at, resolved_at)
     VALUES ($1, $2, $3, $4, $5, 1, 'LOW', $6::varchar, 'us-east-1', $7::timestamptz, $7::timestamptz, CASE WHEN $6::varchar = 'RESOLVED' THEN $7::timestamptz END)
     RETURNING id`,
    [orgId, resourceId, `${resourceId}-name`, issue === S3 ? 'S3' : 'EC2', issue, status, updatedAt]
  );
  return rows[0].id;
}

async function insertActive(orgId: string, resourceId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, potential_savings, severity, aws_region, metadata)
     VALUES ($1, $2, 'EC2', $3, 12.5, 'LOW', 'us-east-1', '{"savings_basis":"estimated: list price"}') RETURNING id`,
    [orgId, resourceId, IDLE]
  );
  return rows[0].id;
}

const rowsOf = async (orgId: string, resourceId: string, issue = IDLE) =>
  (await pool.query(
    `SELECT id, status, occurrence_ended_at FROM cost_recommendations WHERE organization_id = $1 AND resource_id = $2 AND issue = $3 ORDER BY created_at`,
    [orgId, resourceId, issue]
  )).rows;

const activeRows = async (orgId: string, resourceId: string, issue = IDLE) =>
  (await rowsOf(orgId, resourceId, issue)).filter((row) => row.status === 'ACTIVE');

const detectionOf = async (orgId: string, resourceId: string, issue = IDLE) =>
  (await pool.query(`SELECT * FROM cost_finding_detections WHERE organization_id = $1 AND resource_id = $2 AND issue = $3`, [orgId, resourceId, issue])).rows[0] ?? null;

const auditOf = async (orgId: string) =>
  (await pool.query(
    `SELECT user_id, action, resource_type, resource_id, changes, metadata, ip_address, user_agent FROM audit_logs
     WHERE organization_id = $1 ORDER BY created_at, id`,
    [orgId]
  )).rows;

const itemFor = async (orgId: string, resourceId: string, issue = IDLE) =>
  (await repository.getHiddenFindings(orgId)).items.find((item) => item.resourceId === resourceId && item.issue === issue);

/** The production shape: Idle with 36 RESOLVED + 1 DISMISSED open (RESOLVED latest), S3 with 1 RESOLVED. */
async function productionShape(orgId: string): Promise<void> {
  for (let i = 0; i < 36; i += 1) {
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED', new Date(Date.parse('2026-07-26T12:00:00Z') + i * 3600_000).toISOString());
  }
  await insertDecision(orgId, 'i-1234567890abcdef0', 'DISMISSED', '2026-07-01T00:00:00Z');
  await insertDecision(orgId, 'placeholder-bucket', 'RESOLVED', '2026-10-04T15:48:25Z', S3);
}

describe('reconciliation records each hidden finding\'s own observation', () => {
  it('1. a fresh suppressed RESOLVED finding: detection under this run, still detected, no ACTIVE row, totals unchanged', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    const runId = await insertRun(orgId);

    const { counts } = await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], runId);

    expect(counts?.suppressedResolved).toBe(1);
    const detection = await detectionOf(orgId, 'i-1234567890abcdef0');
    expect(detection).toMatchObject({ run_id: runId, outcome: 'detected', severity: 'LOW', potential_savings: '12.50' });
    expect(await activeRows(orgId, 'i-1234567890abcdef0')).toEqual([]);

    const hidden = await repository.getHiddenFindings(orgId);
    expect(hidden.items).toHaveLength(1);
    expect(hidden.items[0].detection).toMatchObject({ state: 'still_detected', reason: null, potentialSavings: 12.5, savingsBasis: 'estimated: list price' });
    expect(hidden.summary).toEqual({
      resolved: 1, dismissed: 0, notConfirmed: 0,
      stillDetected: { count: 1, estimatedMonthlySavings: 12.5, ceilingMonthlySavings: 0, ceilingByResourceType: {} },
    });
    const stats = await repository.getStats(orgId);
    expect(stats.active_recommendations).toBe(0);
    expect(stats.total_potential_savings).toBe(0);
  });

  it('2. the next run\'s check fails: check failed, the earlier detection untouched, occurrence still open', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    const first = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], first);

    const second = await insertRun(orgId, { status: 'partial', checks: [check(IDLE, 'failed'), check(S3)] });
    await reconcile(orgId, [observation(IDLE, [], { success: false })], second);

    expect((await detectionOf(orgId, 'i-1234567890abcdef0')).run_id).toBe(first);
    expect((await itemFor(orgId, 'i-1234567890abcdef0'))!.detection).toMatchObject({ state: 'not_confirmed', reason: 'check_failed' });
    expect((await rowsOf(orgId, 'i-1234567890abcdef0'))[0].occurrence_ended_at).toBeNull();
  });

  it('3. its own resource unknown in the latest run: not fully checked, the last detection\'s evidence kept', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    const first = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], first);
    const second = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [], { unknownResourceIds: ['i-1234567890abcdef0'] })], second);

    const detection = await detectionOf(orgId, 'i-1234567890abcdef0');
    expect(detection).toMatchObject({ run_id: second, outcome: 'unknown', potential_savings: '12.50' });
    const item = (await itemFor(orgId, 'i-1234567890abcdef0'))!;
    expect(item.detection).toMatchObject({ state: 'not_confirmed', reason: 'not_fully_checked', potentialSavings: 12.5 });
    expect(item.detection.lastDetectedAt).not.toBeNull();
  });

  it('3b. founder case: another bucket unknown in the same check (detected 1, unknown 1) leaves this bucket still detected', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'placeholder-bucket', 'RESOLVED', '2026-10-04T15:48:25Z', S3);
    await insertDecision(orgId, 'placeholder-bucket-2', 'RESOLVED', '2026-10-04T15:48:25Z', S3);
    const runId = await insertRun(orgId, { checks: [check(IDLE), { rule_id: null, issue: S3, outcome: 'complete', detected: 1, unknown: 2 }] });

    await reconcile(orgId, [observation(S3, [s3Finding('placeholder-bucket')], { unknownResourceIds: ['placeholder-bucket-2', 'placeholder-bucket-3'] })], runId);

    expect((await itemFor(orgId, 'placeholder-bucket', S3))!.detection).toMatchObject({ state: 'still_detected', reason: null });
    expect((await itemFor(orgId, 'placeholder-bucket-2', S3))!.detection).toMatchObject({ state: 'not_confirmed', reason: 'not_fully_checked' });
    // An unknown resource nothing hides gets no detection row.
    expect(await detectionOf(orgId, 'placeholder-bucket-3', S3)).toBeNull();
  });

  it.each(['running', 'interrupted', 'failed'] as const)('4. a %s latest run confirms nothing', async (status) => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    const first = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], first);
    await insertRun(orgId, { status, checks: status === 'failed' ? [check(IDLE, 'failed'), check(S3, 'failed')] : null });

    expect((await itemFor(orgId, 'i-1234567890abcdef0'))!.detection).toMatchObject({ state: 'not_confirmed', reason: 'analysis_incomplete' });
  });

  it('4b. a running row whose worker is gone (no live lease) reads interrupted, and confirms nothing', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    const first = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], first);
    await pool.query(`UPDATE aws_scan_leases SET released_at = NOW() WHERE organization_id = $1`, [orgId]);
    await insertRun(orgId, { status: 'running', checks: null });
    const hidden = await repository.getHiddenFindings(orgId);
    expect(hidden.latestRun?.runState).toBe('interrupted');
    expect(hidden.items[0].detection.reason).toBe('analysis_incomplete');
  });

  it('5. 36 historical rows and no detection: one item, not checked since', async () => {
    const orgId = await insertOrg();
    for (let i = 0; i < 36; i += 1) await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED', `2026-08-0${(i % 9) + 1}T0${i % 10}:00:00Z`);
    await insertRun(orgId);
    const hidden = await repository.getHiddenFindings(orgId);
    expect(hidden.items).toHaveLength(1);
    expect(hidden.items[0]).toMatchObject({ decisionCount: 36, decision: 'RESOLVED' });
    expect(hidden.items[0].detection).toMatchObject({ state: 'not_confirmed', reason: 'not_checked_since', lastDetectedAt: null, potentialSavings: null });
    expect(hidden.summary.notConfirmed).toBe(1);
    expect(hidden.summary.stillDetected.count).toBe(0);
  });

  it('6. a completed check that no longer finds it ends every occurrence: the item leaves the list', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    await insertDecision(orgId, 'i-1234567890abcdef0', 'DISMISSED', '2026-09-02T00:00:00Z');
    const first = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], first);
    const second = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [])], second);

    expect((await rowsOf(orgId, 'i-1234567890abcdef0')).every((row) => row.occurrence_ended_at !== null)).toBe(true);
    expect((await repository.getHiddenFindings(orgId)).items).toEqual([]);
  });

  it('7. a partial run: the completed issue is confirmed, the failed one is not', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    await insertDecision(orgId, 'placeholder-bucket', 'RESOLVED', DECIDED_AT, S3);
    const first = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')]), observation(S3, [s3Finding('placeholder-bucket')])], first);
    const second = await insertRun(orgId, { status: 'partial', checks: [check(IDLE), check(S3, 'failed')] });
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')]), observation(S3, [], { success: false })], second);

    expect((await itemFor(orgId, 'i-1234567890abcdef0'))!.detection.state).toBe('still_detected');
    expect((await itemFor(orgId, 'placeholder-bucket', S3))!.detection).toMatchObject({ state: 'not_confirmed', reason: 'check_failed' });
  });

  it('8. a manual run queued behind a scan is the latest by lease, though its row is older', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    const manual = await insertRun(orgId, { source: 'manual', createdAt: '2026-11-03T12:00:00Z', leaseAt: '2026-11-03T12:00:10Z' });
    await insertRun(orgId, { source: 'discovery', createdAt: '2026-11-03T12:00:05Z', leaseAt: '2026-11-03T12:00:05Z' });
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], manual);

    const hidden = await repository.getHiddenFindings(orgId);
    expect(hidden.latestRun?.id).toBe(manual);
    expect(hidden.items[0].detection.state).toBe('still_detected');
  });

  it('9. a run with no run record: the scan succeeds, its detection never confirms', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    await insertRun(orgId);
    const { counts } = await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], null);
    expect(counts?.suppressedResolved).toBe(1);
    expect((await detectionOf(orgId, 'i-1234567890abcdef0')).run_id).toBeNull();
    expect((await itemFor(orgId, 'i-1234567890abcdef0'))!.detection).toMatchObject({ state: 'not_confirmed', reason: 'not_checked_since' });
  });

  it('10. a failed detection write never fails the scan: everything else commits, the finding reads not confirmed', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    const runId = await insertRun(orgId);
    // A severity the detections table refuses: the suppressed INSERT writes nothing, the detection upsert fails.
    const bad = finding('i-1234567890abcdef0', { severity: 'CRITICAL' as never });

    const { insertedCount, counts } = await reconcile(orgId, [observation(IDLE, [bad, finding('i-0123456789abcdef0')])], runId);

    expect(insertedCount).toBe(1);
    expect(counts).toMatchObject({ detected: 2, new: 1, suppressedResolved: 1 });
    expect(await activeRows(orgId, 'i-0123456789abcdef0')).toHaveLength(1);
    expect(await detectionOf(orgId, 'i-1234567890abcdef0')).toBeNull();
    expect((await itemFor(orgId, 'i-1234567890abcdef0'))!.detection.state).toBe('not_confirmed');
  });

  it('ACTIVE findings get no detection row: only hidden ones are recorded', async () => {
    const orgId = await insertOrg();
    const runId = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [finding('i-0123456789abcdef0')], { unknownResourceIds: ['i-1234567890abcdef0'] })], runId);
    expect((await pool.query('SELECT count(*)::int AS n FROM cost_finding_detections WHERE organization_id = $1', [orgId])).rows[0].n).toBe(0);
  });

  it('a scan never grows rows for a hidden finding: one decision row, one detection row, however many scans', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    for (let i = 0; i < 4; i += 1) {
      await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], await insertRun(orgId));
    }
    expect(await rowsOf(orgId, 'i-1234567890abcdef0')).toHaveLength(1);
    expect((await pool.query('SELECT count(*)::int AS n FROM cost_finding_detections WHERE organization_id = $1', [orgId])).rows[0].n).toBe(1);
  });
});

describe('the hidden list: one item per finding, latest decision', () => {
  it('11. the production shape: Idle is one item of 37 rows under RESOLVED, S3 one of 1; split resolved/dismissed', async () => {
    const orgId = await insertOrg();
    await productionShape(orgId);
    const runId = await insertRun(orgId);
    const { counts } = await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')]), observation(S3, [s3Finding('placeholder-bucket')])], runId);
    expect(counts).toMatchObject({ detected: 2, suppressedResolved: 2, suppressedDismissed: 0, persisted: 0 });

    const hidden = await repository.getHiddenFindings(orgId);
    expect(hidden.items).toHaveLength(2);
    expect(await itemFor(orgId, 'i-1234567890abcdef0')).toMatchObject({ decision: 'RESOLVED', decisionCount: 37 });
    expect(await itemFor(orgId, 'placeholder-bucket', S3)).toMatchObject({ decision: 'RESOLVED', decisionCount: 1 });
    // Idle's estimate counts; S3 lifecycle is a ceiling, kept apart (the /stats rules).
    expect(hidden.summary).toEqual({
      resolved: 2, dismissed: 0, notConfirmed: 0,
      stillDetected: { count: 2, estimatedMonthlySavings: 12.5, ceilingMonthlySavings: 4, ceilingByResourceType: { S3: 4 } },
    });
  });

  it('11b. a newer Dismissed decision wins over older Resolved rows', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED', '2026-09-01T00:00:00Z');
    await insertDecision(orgId, 'i-1234567890abcdef0', 'DISMISSED', '2026-09-02T00:00:00Z');
    expect(await itemFor(orgId, 'i-1234567890abcdef0')).toMatchObject({ decision: 'DISMISSED', decisionCount: 2 });
  });

  it('12. a still-detected Dismissed finding is counted as dismissed, never in the still-detected group or ACTIVE', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'DISMISSED');
    const runId = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], runId);

    const hidden = await repository.getHiddenFindings(orgId);
    expect(hidden.items[0]).toMatchObject({ decision: 'DISMISSED', detection: { state: 'still_detected' } });
    expect(hidden.summary).toMatchObject({ resolved: 0, dismissed: 1, notConfirmed: 0, stillDetected: { count: 0, estimatedMonthlySavings: 0 } });
    expect((await repository.getStats(orgId)).active_recommendations).toBe(0);
  });

  it('Reserved Instance and retired RDS rows are never listed as hidden', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'ri-opportunity-t3.micro', 'RESOLVED', DECIDED_AT, RI);
    await insertDecision(orgId, 'placeholder-db', 'RESOLVED', DECIDED_AT, ISSUE_RDS_OVERSIZED_INSTANCE);
    expect((await repository.getHiddenFindings(orgId)).items).toEqual([]);
  });

  it('the latest decision\'s actor is shown by name; a decision with no audit event shows none', async () => {
    const orgId = await insertOrg();
    const recorded = await insertActive(orgId, 'i-1234567890abcdef0');
    await repository.updateStatus(recorded, 'RESOLVED', orgId, actor);
    await insertDecision(orgId, 'i-0123456789abcdef0', 'RESOLVED');
    expect((await itemFor(orgId, 'i-1234567890abcdef0'))!.decidedBy).toBe('Pat Placeholder');
    expect((await itemFor(orgId, 'i-0123456789abcdef0'))!.decidedBy).toBeNull();
  });

  it('only the caller\'s organization is listed', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    await insertDecision(orgB, 'i-1234567890abcdef0', 'RESOLVED');
    const runB = await insertRun(orgB);
    await reconcile(orgB, [observation(IDLE, [finding('i-1234567890abcdef0')])], runB);
    const hiddenA = await repository.getHiddenFindings(orgA);
    expect(hiddenA.items).toEqual([]);
    expect(hiddenA.latestRun).toBeNull();
  });
});

describe('reopen', () => {
  it('13. still detected: every open row ended, one ACTIVE row from the detection, counted once; the next scan keeps exactly one', async () => {
    const orgId = await insertOrg();
    await productionShape(orgId);
    const runId = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')]), observation(S3, [s3Finding('placeholder-bucket')])], runId);
    const anyRow = (await rowsOf(orgId, 'i-1234567890abcdef0'))[5].id;

    const result = await repository.reopen(anyRow, orgId, actor);

    expect(result).toMatchObject({ outcome: 'reopened', rowsEnded: 37, activeNow: true });
    // Judged and recorded under the latest decision (RESOLVED), not the oldest (DISMISSED).
    expect((await auditOf(orgId)).find((event) => event.action === 'cost_recommendation.reopened')).toMatchObject({
      changes: { from: 'RESOLVED', to: 'ACTIVE' },
      metadata: { rows_ended: 37, decision_count: 37, detection_state: 'still_detected' },
    });
    const rows = await rowsOf(orgId, 'i-1234567890abcdef0');
    expect(rows.filter((row) => row.status !== 'ACTIVE').every((row) => row.occurrence_ended_at !== null)).toBe(true);
    expect(await activeRows(orgId, 'i-1234567890abcdef0')).toHaveLength(1);
    const stats = await repository.getStats(orgId);
    expect(stats.active_recommendations).toBe(1);
    expect(stats.total_potential_savings).toBe(12.5);
    expect(await repository.getActiveCount(orgId)).toBe(1);
    expect((await repository.findAll(orgId, { status: 'ACTIVE' })).map((row) => row.resource_id)).toEqual(['i-1234567890abcdef0']);
    // S3 stays hidden; Idle left the list.
    expect((await repository.getHiddenFindings(orgId)).items.map((item) => item.issue)).toEqual([S3]);

    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')]), observation(S3, [s3Finding('placeholder-bucket')])], await insertRun(orgId));
    expect(await activeRows(orgId, 'i-1234567890abcdef0')).toHaveLength(1);
    expect((await repository.getStats(orgId)).active_recommendations).toBe(1);
  });

  it('14. not confirmed: rows ended, no ACTIVE row now; the next detecting scan inserts exactly one', async () => {
    const orgId = await insertOrg();
    const id = await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    await insertRun(orgId);

    const result = await repository.reopen(id, orgId, actor);

    expect(result).toEqual({ outcome: 'reopened', rowsEnded: 1, activeNow: false, recommendation: null });
    expect(await activeRows(orgId, 'i-1234567890abcdef0')).toEqual([]);
    expect((await repository.getStats(orgId)).active_recommendations).toBe(0);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], await insertRun(orgId));
    expect(await activeRows(orgId, 'i-1234567890abcdef0')).toHaveLength(1);
  });

  it('15. two reopens at once: one reopens, the other changes nothing; one audit event, one ACTIVE row', async () => {
    const orgId = await insertOrg();
    await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    const second = await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED', '2026-09-04T00:00:00Z');
    const runId = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], runId);

    const results = await Promise.all([repository.reopen(second, orgId, actor), repository.reopen(second, orgId, actor)]);

    expect(results.map((r) => r.outcome).sort()).toEqual(['already_open', 'reopened']);
    expect(await activeRows(orgId, 'i-1234567890abcdef0')).toHaveLength(1);
    expect((await auditOf(orgId)).filter((event) => event.action === 'cost_recommendation.reopened')).toHaveLength(1);
    // And again, later: still nothing.
    expect(await repository.reopen(second, orgId, actor)).toEqual({ outcome: 'already_open' });
    expect((await auditOf(orgId)).filter((event) => event.action === 'cost_recommendation.reopened')).toHaveLength(1);
  });

  it('16. reopen waits for a reconciliation holding the organization\'s lock, then judges what it committed', async () => {
    const orgId = await insertOrg();
    const id = await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    const runId = await insertRun(orgId);

    const holder = await pool.connect();
    try {
      // The reconciliation lock, as reconcileActiveRecommendations() takes it.
      await holder.query('SELECT pg_advisory_lock(hashtextextended($1, 1))', [orgId]);
      let settled = false;
      const pending = repository.reopen(id, orgId, actor).then((result) => { settled = true; return result; });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);
      // While reopen waits, the "scan" records its detection, then releases.
      await holder.query(
        `INSERT INTO cost_finding_detections (organization_id, resource_id, issue, run_id, outcome, observed_at, detected_at, resource_type, potential_savings, severity, metadata)
         VALUES ($1, 'i-1234567890abcdef0', $2, $3, 'detected', NOW(), NOW(), 'EC2', 12.5, 'LOW', $4::jsonb)`,
        [orgId, IDLE, runId, JSON.stringify(IDLE_METADATA)]
      );
      await holder.query('SELECT pg_advisory_unlock(hashtextextended($1, 1))', [orgId]);
      expect(await pending).toMatchObject({ outcome: 'reopened', rowsEnded: 1, activeNow: true });
    } finally {
      holder.release();
    }
    expect(await activeRows(orgId, 'i-1234567890abcdef0')).toHaveLength(1);
  });

  it('16b. reopen racing a real reconciliation leaves exactly one ACTIVE row and one open-free history', async () => {
    const orgId = await insertOrg();
    const id = await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    const runId = await insertRun(orgId);
    await Promise.all([
      reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], runId),
      repository.reopen(id, orgId, actor),
    ]);
    // Whichever went first, the finding ends up ACTIVE at most once, never hidden and active together.
    const rows = await rowsOf(orgId, 'i-1234567890abcdef0');
    expect(rows.filter((row) => row.status === 'ACTIVE').length).toBeLessThanOrEqual(1);
    expect(rows.filter((row) => row.status !== 'ACTIVE' && row.occurrence_ended_at === null)).toEqual([]);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], await insertRun(orgId));
    expect(await activeRows(orgId, 'i-1234567890abcdef0')).toHaveLength(1);
  });

  it('a stale finding with an earlier detection (latest check failed) gets no ACTIVE row', async () => {
    const orgId = await insertOrg();
    const id = await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], await insertRun(orgId));
    await insertRun(orgId, { status: 'partial', checks: [check(IDLE, 'failed'), check(S3)] });

    expect(await repository.reopen(id, orgId, actor)).toMatchObject({ outcome: 'reopened', rowsEnded: 1, activeNow: false, recommendation: null });
    expect(await activeRows(orgId, 'i-1234567890abcdef0')).toEqual([]);
    expect((await auditOf(orgId))[0]).toMatchObject({ changes: { from: 'RESOLVED', to: 'reopened_pending' }, metadata: { detection_state: 'not_confirmed' } });
  });

  it('an earlier, already ended occurrence is left as it was; only open rows are ended and counted', async () => {
    const orgId = await insertOrg();
    const old = await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED', '2026-08-01T00:00:00Z');
    await pool.query(`UPDATE cost_recommendations SET occurrence_ended_at = '2026-08-02T00:00:00Z' WHERE id = $1`, [old]);
    const open = await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');

    expect(await repository.reopen(open, orgId, actor)).toMatchObject({ outcome: 'reopened', rowsEnded: 1 });
    const ended = (await pool.query('SELECT occurrence_ended_at FROM cost_recommendations WHERE id = $1', [old])).rows[0].occurrence_ended_at;
    expect(ended.toISOString()).toBe('2026-08-02T00:00:00.000Z');
  });

  it('an ACTIVE row already present (legacy shape): no duplicate, no error, that row is returned', async () => {
    const orgId = await insertOrg();
    const id = await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], await insertRun(orgId));
    const existing = await insertActive(orgId, 'i-1234567890abcdef0');

    const result = await repository.reopen(id, orgId, actor);

    expect(result).toMatchObject({ outcome: 'reopened', activeNow: true, recommendation: { id: existing } });
    expect(await activeRows(orgId, 'i-1234567890abcdef0')).toHaveLength(1);
  });

  it('18. another organization\'s row: not found, nothing changed, nothing recorded', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const foreign = await insertDecision(orgB, 'i-1234567890abcdef0', 'RESOLVED');
    expect(await repository.reopen(foreign, orgA, actor)).toEqual({ outcome: 'not_found' });
    expect((await rowsOf(orgB, 'i-1234567890abcdef0'))[0].occurrence_ended_at).toBeNull();
    expect(await auditOf(orgA)).toEqual([]);
    expect(await auditOf(orgB)).toEqual([]);
  });

  it('a Reserved Instance row is not applicable: nothing changed', async () => {
    const orgId = await insertOrg();
    const id = await insertDecision(orgId, 'ri-opportunity-t3.micro', 'RESOLVED', DECIDED_AT, RI);
    expect(await repository.reopen(id, orgId, actor)).toEqual({ outcome: 'not_applicable' });
    expect((await rowsOf(orgId, 'ri-opportunity-t3.micro', RI))[0].occurrence_ended_at).toBeNull();
    expect(await auditOf(orgId)).toEqual([]);
  });

  it('resolved again after a reopen: the earlier detection does not make it still detected', async () => {
    const orgId = await insertOrg();
    const id = await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    const runId = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], runId);
    const reopened = await repository.reopen(id, orgId, actor);
    expect(reopened.outcome).toBe('reopened');
    const active = (await activeRows(orgId, 'i-1234567890abcdef0'))[0].id;
    await repository.updateStatus(active, 'RESOLVED', orgId, actor);
    expect((await itemFor(orgId, 'i-1234567890abcdef0'))!.detection).toMatchObject({ state: 'not_confirmed', reason: 'not_checked_since' });
  });
});

describe('decisions serialize with reconciliation', () => {
  it.each([
    ['resolve', (id: string, orgId: string) => repository.updateStatus(id, 'RESOLVED', orgId, actor)],
    ['delete', (id: string, orgId: string) => repository.delete(id, orgId, actor)],
  ] as const)('%s waits while a reconciliation holds the organization\'s lock', async (_name, decide) => {
    const orgId = await insertOrg();
    const id = await insertActive(orgId, 'i-1234567890abcdef0');
    const holder = await pool.connect();
    try {
      await holder.query('SELECT pg_advisory_lock(hashtextextended($1, 1))', [orgId]);
      let settled = false;
      const pending = Promise.resolve(decide(id, orgId)).then((value) => { settled = true; return value; });
      await new Promise((resolve) => setTimeout(resolve, 400));
      expect(settled).toBe(false);
      await holder.query('SELECT pg_advisory_unlock(hashtextextended($1, 1))', [orgId]);
      expect(await pending).toBeTruthy();
    } finally {
      holder.release();
    }
  });
});

describe('audit events, in the same transaction as the decision', () => {
  const metadataKeys = (event: { metadata: Record<string, unknown> }) => Object.keys(event.metadata).sort();

  it('20. resolve, dismiss, reopen and delete each record actor, action, change and safe metadata only', async () => {
    const orgId = await insertOrg();
    const first = await insertActive(orgId, 'i-1234567890abcdef0');
    await repository.updateStatus(first, 'RESOLVED', orgId, actor);
    await repository.updateStatus(first, 'DISMISSED', orgId, actor);
    const runId = await insertRun(orgId);
    await reconcile(orgId, [observation(IDLE, [finding('i-1234567890abcdef0')])], runId);
    await repository.reopen(first, orgId, actor);
    const active = (await activeRows(orgId, 'i-1234567890abcdef0'))[0].id;
    expect(await repository.delete(active, orgId, actor)).toBe(true);

    const events = await auditOf(orgId);
    expect(events.map((event) => event.action)).toEqual([
      'cost_recommendation.resolved',
      'cost_recommendation.dismissed',
      'cost_recommendation.reopened',
      'cost_recommendation.deleted',
    ]);
    for (const event of events) {
      expect(event).toMatchObject({ user_id: actor.userId, resource_type: 'cost_recommendation', ip_address: '127.0.0.1', user_agent: 'jest' });
      const serialized = JSON.stringify(event.metadata) + JSON.stringify(event.changes);
      expect(serialized).not.toMatch(/i-1234567890abcdef0|name|Average CPU|12\.5|errorMessage/);
    }
    expect(events[0]).toMatchObject({ resource_id: first, changes: { from: 'ACTIVE', to: 'RESOLVED' }, metadata: { issue: IDLE, resource_type: 'EC2', source: 'button' } });
    expect(metadataKeys(events[0])).toEqual(['issue', 'resource_type', 'source']);
    expect(events[1]).toMatchObject({ changes: { from: 'RESOLVED', to: 'DISMISSED' } });
    expect(events[2]).toMatchObject({
      resource_id: first,
      changes: { from: 'DISMISSED', to: 'ACTIVE' },
      metadata: { rows_ended: 1, decision_count: 1, detection_state: 'still_detected' },
    });
    expect(metadataKeys(events[2])).toEqual(['decision_count', 'detection_state', 'issue', 'resource_type', 'rows_ended', 'source']);
    expect(events[3]).toMatchObject({ resource_id: active, changes: { from: 'ACTIVE', to: 'deleted' }, metadata: { occurrence_open: false } });
    expect(metadataKeys(events[3])).toEqual(['issue', 'occurrence_open', 'resource_type', 'source']);
  });

  it('deleting an open decision row records that it was hiding a finding', async () => {
    const orgId = await insertOrg();
    const id = await insertDecision(orgId, 'i-1234567890abcdef0', 'RESOLVED');
    expect(await repository.delete(id, orgId, actor)).toBe(true);
    expect((await auditOf(orgId))[0]).toMatchObject({ action: 'cost_recommendation.deleted', changes: { from: 'RESOLVED', to: 'deleted' }, metadata: { occurrence_open: true } });
  });

  it('execute-remediation\'s resolve is recorded with its source', async () => {
    const orgId = await insertOrg();
    const id = await insertActive(orgId, 'i-1234567890abcdef0');
    await repository.updateStatus(id, 'RESOLVED', orgId, { ...actor, source: 'execute_remediation' });
    expect((await auditOf(orgId))[0]).toMatchObject({ action: 'cost_recommendation.resolved', metadata: { source: 'execute_remediation' } });
  });

  it('nothing is recorded for a row that is not the organization\'s', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const foreign = await insertActive(orgB, 'i-1234567890abcdef0');
    expect(await repository.updateStatus(foreign, 'RESOLVED', orgA, actor)).toBeNull();
    expect(await repository.delete(foreign, orgA, actor)).toBe(false);
    expect(await auditOf(orgA)).toEqual([]);
    expect(await auditOf(orgB)).toEqual([]);
    expect((await rowsOf(orgB, 'i-1234567890abcdef0'))[0].status).toBe('ACTIVE');
  });

  it('21. an audit failure fails the decision: nothing changes', async () => {
    const orgId = await insertOrg();
    const id = await insertActive(orgId, 'i-1234567890abcdef0');
    // audit_logs.user_id references users: an unknown actor makes the audit insert fail.
    const ghost: CostDecisionActor = { ...actor, userId: '00000000-0000-0000-0000-000000000000' };

    await expect(repository.updateStatus(id, 'RESOLVED', orgId, ghost)).rejects.toThrow();
    expect((await rowsOf(orgId, 'i-1234567890abcdef0'))[0].status).toBe('ACTIVE');

    await expect(repository.delete(id, orgId, ghost)).rejects.toThrow();
    expect(await rowsOf(orgId, 'i-1234567890abcdef0')).toHaveLength(1);

    await pool.query(`UPDATE cost_recommendations SET status = 'RESOLVED' WHERE id = $1`, [id]);
    await expect(repository.reopen(id, orgId, ghost)).rejects.toThrow();
    expect((await rowsOf(orgId, 'i-1234567890abcdef0'))[0].occurrence_ended_at).toBeNull();
    expect(await auditOf(orgId)).toEqual([]);
  });
});
