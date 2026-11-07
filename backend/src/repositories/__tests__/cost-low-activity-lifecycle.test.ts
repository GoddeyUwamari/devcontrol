/**
 * FP PR 2b, live Postgres: what the low-activity rule does to rows that
 * already exist, through the normal scan path only (the real detector over
 * mocked AWS clients, then the real fenced reconciliation).
 *
 *   L1  the founder's shape: 37 open RESOLVED CPU-only rows. A scan that finds
 *       the instance not low-activity ends all 37 occurrences
 *       (occurrence_ended_at, once) and changes nothing else; audit history
 *       and the old detection are untouched; it leaves Hidden findings (FP2b-Q11).
 *   L2  the same history, instance couldn't be checked: nothing changes, and it
 *       reads "couldn't fully check", never "still detected".
 *   L3  an ACTIVE row of an instance that couldn't be checked is removed;
 *       decisions are never touched; other categories keep theirs (Q12).
 *   L4  before any new-rule scan, a CPU-only detection never reads "still
 *       detected" and Reopen never copies it (Q14).
 *   L5  a low-activity finding: identity and evidence stored, still detected,
 *       labelled "Low-activity instance", reopened with its evidence, stoppable.
 *   L6  tenant isolation: another organization's identical rows are untouched.
 */
import { Pool } from 'pg';
import { CostDecisionActor, CostRecommendationsRepository } from '../cost-recommendations.repository';
import costOptimizationService, { type DetectorObservation } from '../../services/cost-optimization.service';
import { summarizeDetectors } from '../../services/cost-analysis-outcome';
import { TestLeases } from '../../services/__tests__/helpers/scan-source';
import {
  fakeAutoScaling,
  fakeClassicElb,
  fakeCloudWatch,
  fakeEc2,
  fakeElb,
  type FakeMetrics,
  type FakeTopology,
} from '../../services/__tests__/helpers/low-activity-aws';
import { hasLowActivityRuleIdentity } from '../../config/low-activity-rule';
import { judgeStopEligibility } from '../../services/stop-instance-eligibility';
import type { CreateRecommendationRequest } from '../../types';

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
const HOME = 'us-east-1';
const FOUNDER = 'i-1234567890abcdef0';
const OTHER = 'i-0123456789abcdef0';
const LONG_RUNNING = new Date(Date.now() - 90 * 86_400_000);
const CPU_ONLY_METADATA = {
  instance_type: 't2.micro', price_source: 'list_table', average_cpu: 3.4, days_analyzed: 7,
  cpu_evidence: { source: 'CloudWatch AWS/EC2 CPUUtilization (Average)', period_seconds: 3600, datapoints_observed: 168, datapoints_expected: 168, datapoints_required: 134 },
  savings_basis: "estimated: compute cost from DevControl's list-price table (a default estimate for unlisted instance types); not billed cost or guaranteed savings",
  savings_claim: { kind: 'full_resource_cost', resource_ids: [FOUNDER] },
  configuration: { parameter: 'cpu_threshold_percent', value: 5, source: 'default' },
};
const CPU_ONLY_DESCRIPTION = 'This EC2 instance averaged 3.40% CPU utilization over the past 7 days (168 of 168 hourly CloudWatch datapoints). It is an idle candidate: review whether it is still needed. Average CPU alone does not show peak load or memory use, so this is not a rightsizing recommendation.';

let actor: CostDecisionActor;
let leaseOffset = 0;
const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function insertOrg(): Promise<string> {
  const s = suffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Low Activity Lifecycle Org ${s}`, `low-activity-lifecycle-org-${s}`]
  );
  createdOrgIds.push(rows[0].id);
  await leases.hold(rows[0].id);
  return rows[0].id;
}

beforeAll(async () => {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Pat Placeholder') RETURNING id`,
    [`low-activity-lifecycle-${suffix()}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  actor = { userId: rows[0].id, request: { ipAddress: '127.0.0.1', userAgent: 'jest' }, source: 'button' };
});

afterAll(async () => {
  await leases.cleanup();
  if (createdOrgIds.length > 0) await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  if (createdUserIds.length > 0) await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** The production history: `count` open RESOLVED CPU-only rows, each with its resolve audit event, and the CPU-only detection. */
async function seedCpuOnlyHistory(orgId: string, resourceId: string, count: number, runId: string): Promise<void> {
  for (let i = 0; i < count; i++) {
    const at = new Date(Date.parse('2026-08-01T00:00:00Z') + i * 3_600_000).toISOString();
    const { rows } = await pool.query(
      `INSERT INTO cost_recommendations
         (organization_id, resource_id, resource_name, resource_type, issue, description, potential_savings, severity, status, aws_region, metadata, created_at, updated_at, resolved_at)
       VALUES ($1, $2, 'api-server', 'EC2', $3, $4, 8.5, 'LOW', 'RESOLVED', $5, $6, $7, $7, $7) RETURNING id`,
      [orgId, resourceId, IDLE, CPU_ONLY_DESCRIPTION, HOME, JSON.stringify(CPU_ONLY_METADATA), at]
    );
    await pool.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, changes, metadata, created_at)
       VALUES ($1, $2, 'cost_recommendation.resolved', 'cost_recommendation', $3, '{"from":"ACTIVE","to":"RESOLVED"}', '{"issue":"Idle Instance"}', $4)`,
      [orgId, actor.userId, rows[0].id, at]
    );
  }
  await pool.query(
    `INSERT INTO cost_finding_detections (organization_id, resource_id, issue, run_id, outcome, observed_at, detected_at,
       resource_name, resource_type, aws_region, description, potential_savings, severity, metadata)
     VALUES ($1, $2, $3, $4, 'detected', '2026-11-01T00:00:00Z', '2026-11-01T00:00:00Z', 'api-server', 'EC2', $5, $6, 8.5, 'LOW', $7)`,
    [orgId, resourceId, IDLE, runId, HOME, CPU_ONLY_DESCRIPTION, JSON.stringify(CPU_ONLY_METADATA)]
  );
}

async function insertRun(orgId: string, checks: unknown[] = [{ rule_id: 'ec2_idle', issue: IDLE, outcome: 'complete', detected: 0, unknown: 0 }]): Promise<string> {
  leaseOffset += 1;
  const { rows } = await pool.query(
    `INSERT INTO cost_analysis_runs (organization_id, status, source, checks, lease_acquired_at, created_at, completed_at)
     VALUES ($1, 'completed', 'discovery', $2::jsonb, NOW() + make_interval(secs => $3::int), NOW(), NOW()) RETURNING id`,
    [orgId, JSON.stringify(checks), leaseOffset]
  );
  return rows[0].id;
}

/** One scan: the real low-activity detector over fake AWS, then the real reconciliation under a fresh run. */
async function scan(orgId: string, options: { instances?: Array<{ id: string; launch?: Date }>; metrics?: Record<string, FakeMetrics>; topology?: FakeTopology; extra?: DetectorObservation[] } = {}) {
  const now = new Date();
  const instances = (options.instances ?? [{ id: FOUNDER }]).map((i) => ({ InstanceId: i.id, InstanceType: 't2.micro', LaunchTime: i.launch ?? LONG_RUNNING }));
  const clients = {
    ec2: fakeEc2(instances), cloudWatch: fakeCloudWatch(now, options.metrics ?? {}),
    elb: fakeElb(options.topology ?? {}), elbClassic: fakeClassicElb(options.topology ?? {}), autoScaling: fakeAutoScaling(options.topology ?? {}),
  };
  const result = await (costOptimizationService as any).detectLowActivityEC2Instances(clients, HOME, now);
  const observation: DetectorObservation = {
    issue: IDLE,
    success: result.success,
    recommendations: result.issues.map((issue: any): CreateRecommendationRequest => ({
      resource_id: issue.resourceId, resource_name: issue.resourceName, resource_type: issue.resourceType, issue: issue.issue,
      description: issue.description, potential_savings: issue.potentialSavings, severity: issue.severity, aws_region: issue.awsRegion, metadata: issue.metadata,
    })),
    unknownResourceIds: result.unknownResourceIds,
    endActiveForUnknown: result.endActiveForUnknown,
    lowActivity: result.lowActivity,
  };
  const observations = [observation, ...(options.extra ?? [])];
  const runId = await insertRun(orgId, summarizeDetectors(observations, true, []).checks);
  await repository.reconcileActiveRecommendations(orgId, observations, { homeRegion: HOME }, await leases.hold(orgId), runId);
  return { result, runId };
}

const allRows = async (orgId: string) =>
  (await pool.query(`SELECT * FROM cost_recommendations WHERE organization_id = $1 ORDER BY created_at, id`, [orgId])).rows;
const auditRows = async (orgId: string) =>
  (await pool.query(`SELECT * FROM audit_logs WHERE organization_id = $1 ORDER BY created_at, id`, [orgId])).rows;
const detectionRow = async (orgId: string, resourceId = FOUNDER) =>
  (await pool.query(`SELECT * FROM cost_finding_detections WHERE organization_id = $1 AND resource_id = $2`, [orgId, resourceId])).rows[0];
const withoutEnded = (rows: any[]) => rows.map(({ occurrence_ended_at: _ended, ...rest }) => rest);

// The founder's server: CPU peaked at 62.4% in one hour; the quietest day moved ~21.6 MB.
const FOUNDER_METRICS: FakeMetrics = { cpu: (h) => (h === 200 ? 62.4 : 3), networkIn: () => 450_000, networkOut: () => 450_000 };

describe('L1: the 37 CPU-only rows, instance not low-activity (FP2b-Q11)', () => {
  it('ends all 37 occurrences once and changes nothing else', async () => {
    const orgId = await insertOrg();
    await seedCpuOnlyHistory(orgId, FOUNDER, 37, await insertRun(orgId));
    const rowsBefore = await allRows(orgId);
    const auditBefore = await auditRows(orgId);
    const detectionBefore = await detectionRow(orgId);
    expect((await repository.getHiddenFindings(orgId)).items).toHaveLength(1);

    const { result } = await scan(orgId, { metrics: { [FOUNDER]: FOUNDER_METRICS } });
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([]);
    expect(result.lowActivity.not_low_activity.cpu_peak).toBe(1);

    const rowsAfter = await allRows(orgId);
    expect(rowsAfter).toHaveLength(37);
    expect(rowsAfter.filter((r) => r.status === 'ACTIVE')).toEqual([]);
    expect(rowsAfter.every((r) => r.occurrence_ended_at !== null)).toBe(true);
    // Status, resolved_at, updated_at, description, metadata... byte-identical.
    expect(withoutEnded(rowsAfter)).toEqual(withoutEnded(rowsBefore));
    expect(await auditRows(orgId)).toEqual(auditBefore);
    expect(await detectionRow(orgId)).toEqual(detectionBefore);
    expect((await repository.getHiddenFindings(orgId)).items).toEqual([]);

    // A second scan ends nothing again: occurrence_ended_at is set once.
    const endedAt = rowsAfter.map((r) => r.occurrence_ended_at.toISOString());
    await scan(orgId, { metrics: { [FOUNDER]: FOUNDER_METRICS } });
    expect((await allRows(orgId)).map((r) => r.occurrence_ended_at.toISOString())).toEqual(endedAt);
  });

  it('busy network alone (every day over 5 MB) ends them too', async () => {
    const orgId = await insertOrg();
    await seedCpuOnlyHistory(orgId, FOUNDER, 3, await insertRun(orgId));
    await scan(orgId, { metrics: { [FOUNDER]: { networkIn: () => 450_000, networkOut: () => 450_000 } } });
    expect((await allRows(orgId)).every((r) => r.occurrence_ended_at !== null)).toBe(true);
  });

  it('behind a load balancer ends them too (an exclusion is an evaluated answer)', async () => {
    const orgId = await insertOrg();
    await seedCpuOnlyHistory(orgId, FOUNDER, 3, await insertRun(orgId));
    await scan(orgId, { topology: { targetGroups: [{ arn: 'arn:aws:elasticloadbalancing:us-east-1:123456789012:targetgroup/placeholder/0', type: 'instance', targets: [FOUNDER] }] } });
    expect((await allRows(orgId)).every((r) => r.occurrence_ended_at !== null)).toBe(true);
  });
});

describe('L2: the same history, instance couldn\'t be checked', () => {
  it.each([
    ['restarted inside the window', { instances: [{ id: FOUNDER, launch: new Date(Date.now() - 5 * 86_400_000) }] }],
    ['a missing hour of CloudWatch data', { metrics: { [FOUNDER]: { networkOut: (h: number) => (h === 3 ? null : 100_000) } } }],
    ['the load balancer read denied', { topology: undefined, elbDenied: true }],
  ])('%s: every row unchanged, "couldn\'t fully check", never still detected', async (_label, options: any) => {
    const orgId = await insertOrg();
    await seedCpuOnlyHistory(orgId, FOUNDER, 37, await insertRun(orgId));
    const rowsBefore = await allRows(orgId);
    const auditBefore = await auditRows(orgId);

    if (options.elbDenied) {
      const now = new Date();
      const denied = new Error('denied'); denied.name = 'AccessDeniedException';
      const clients = { ec2: fakeEc2([{ InstanceId: FOUNDER, InstanceType: 't2.micro', LaunchTime: LONG_RUNNING }]), cloudWatch: fakeCloudWatch(now, {}), elb: fakeElb(denied), elbClassic: fakeClassicElb({}), autoScaling: fakeAutoScaling({}) };
      const result = await (costOptimizationService as any).detectLowActivityEC2Instances(clients, HOME, now);
      expect(result.unknownResourceIds).toEqual([FOUNDER]);
      const runId = await insertRun(orgId);
      await repository.reconcileActiveRecommendations(orgId, [{ issue: IDLE, success: true, recommendations: [], unknownResourceIds: result.unknownResourceIds, endActiveForUnknown: true }], { homeRegion: HOME }, await leases.hold(orgId), runId);
    } else {
      const { result } = await scan(orgId, options);
      expect(result.unknownResourceIds).toEqual([FOUNDER]);
    }

    expect(await allRows(orgId)).toEqual(rowsBefore);
    expect(await auditRows(orgId)).toEqual(auditBefore);
    const detection = await detectionRow(orgId);
    expect(detection.outcome).toBe('unknown');
    expect(detection.metadata).toEqual(CPU_ONLY_METADATA); // the last detection's evidence is kept, as before
    const hidden = await repository.getHiddenFindings(orgId);
    expect(hidden.items).toHaveLength(1);
    expect(hidden.items[0]).toMatchObject({ issue: IDLE, issueLabel: IDLE, decisionCount: 37, detection: { state: 'not_confirmed', reason: 'not_fully_checked' } });
    expect(hidden.summary.stillDetected.count).toBe(0);
  });
});

describe('L3: an ACTIVE row of an instance that couldn\'t be checked (FP2b-Q12)', () => {
  it('is removed; a decision of another unknown instance stays open; another category keeps its unknown ACTIVE row', async () => {
    const orgId = await insertOrg();
    const insertRow = async (resourceId: string, issue: string, status: string, metadata: unknown) => (await pool.query(
      `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, description, potential_savings, severity, status, aws_region, metadata, updated_at)
       VALUES ($1, $2, $3, $4, 'placeholder', 8.5, 'LOW', $5, $6, $7, '2026-09-03T18:54:05Z') RETURNING *`,
      [orgId, resourceId, issue === S3 ? 'S3' : 'EC2', issue, status, HOME, JSON.stringify(metadata)]
    )).rows[0];
    await insertRow(FOUNDER, IDLE, 'ACTIVE', CPU_ONLY_METADATA);
    const dismissed = await insertRow(OTHER, IDLE, 'DISMISSED', CPU_ONLY_METADATA);
    const bucket = await insertRow('placeholder-bucket', S3, 'ACTIVE', { savings_basis: 'ceiling: placeholder' });

    await scan(orgId, {
      instances: [{ id: FOUNDER, launch: new Date(Date.now() - 86_400_000) }, { id: OTHER, launch: new Date(Date.now() - 86_400_000) }],
      extra: [{ issue: S3, success: true, recommendations: [], unknownResourceIds: ['placeholder-bucket'] }],
    });

    const rows = await allRows(orgId);
    expect(rows.find((r) => r.resource_id === FOUNDER)).toBeUndefined();
    expect(rows.find((r) => r.id === dismissed.id)).toEqual(dismissed);
    expect(rows.find((r) => r.id === bucket.id)).toEqual(bucket);
  });
});

describe('L4: before any new-rule scan (FP2b-Q14)', () => {
  it('a CPU-only detection in the latest run reads "not checked since", and Reopen puts no row back', async () => {
    const orgId = await insertOrg();
    const oldRun = await insertRun(orgId, [{ rule_id: 'ec2_idle', issue: IDLE, outcome: 'complete', detected: 1, unknown: 0 }]);
    await seedCpuOnlyHistory(orgId, FOUNDER, 2, oldRun);
    // That pre-deploy run is the latest one, and it detected the instance after the decisions.
    await pool.query(`UPDATE cost_finding_detections SET observed_at = NOW(), detected_at = NOW() WHERE organization_id = $1`, [orgId]);

    const hidden = await repository.getHiddenFindings(orgId);
    expect(hidden.items[0].detection).toMatchObject({ state: 'not_confirmed', reason: 'not_checked_since' });
    expect(hidden.summary.stillDetected.count).toBe(0);

    const reopened = await repository.reopen(hidden.items[0].id, orgId, actor);
    expect(reopened).toMatchObject({ outcome: 'reopened', rowsEnded: 2, activeNow: false });
    expect((await allRows(orgId)).filter((r) => r.status === 'ACTIVE')).toEqual([]);
  });
});

describe('L5: a low-activity finding', () => {
  it('without a decision: one ACTIVE row with the rule identity and evidence, stoppable while fresh', async () => {
    const orgId = await insertOrg();
    await scan(orgId);
    const active = (await allRows(orgId)).filter((r) => r.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(active[0].description).toMatch(/^Over the past 30 days this instance's CPU peaked at 2\.0%, its network traffic stayed under 4\.9 MB a day/);
    expect(hasLowActivityRuleIdentity(active[0].metadata)).toBe(true);
    expect(active[0].metadata.low_activity.days).toHaveLength(30);
    expect(judgeStopEligibility({ resourceId: FOUNDER, recommendationId: active[0].id, finding: active[0] })).toEqual({ eligible: true });
  });

  it('under an open decision: still detected, labelled "Low-activity instance", reopened with its evidence', async () => {
    const orgId = await insertOrg();
    await seedCpuOnlyHistory(orgId, FOUNDER, 2, await insertRun(orgId));
    await scan(orgId);

    const hidden = await repository.getHiddenFindings(orgId);
    expect(hidden.items[0]).toMatchObject({ issue: IDLE, issueLabel: 'Low-activity instance', detection: { state: 'still_detected', reason: null } });
    expect(hidden.summary.stillDetected.count).toBe(1);

    const reopened = await repository.reopen(hidden.items[0].id, orgId, actor);
    expect(reopened).toMatchObject({ outcome: 'reopened', activeNow: true });
    const active = (await allRows(orgId)).filter((r) => r.status === 'ACTIVE');
    expect(active).toHaveLength(1);
    expect(hasLowActivityRuleIdentity(active[0].metadata)).toBe(true);
  });

  it('the run records checked / couldn\'t-check counts by reason, with no resource IDs (FP2b-Q21)', async () => {
    const orgId = await insertOrg();
    const { runId } = await scan(orgId, {
      instances: [{ id: FOUNDER }, { id: OTHER, launch: new Date(Date.now() - 86_400_000) }, { id: 'i-0aaaaaaaaaaaaaaa0' }],
      metrics: { 'i-0aaaaaaaaaaaaaaa0': FOUNDER_METRICS },
    });
    const { rows } = await pool.query('SELECT checks FROM cost_analysis_runs WHERE id = $1', [runId]);
    const idle = rows[0].checks.find((c: any) => c.issue === IDLE);
    expect(idle).toMatchObject({ outcome: 'complete', detected: 1, unknown: 1 });
    expect(idle.low_activity).toEqual({
      evaluated: 3, low_activity: 1,
      not_low_activity: { cpu_peak: 1, network: 0, load_balancer: 0, auto_scaling: 0 },
      couldnt_check: { too_new_or_restarted: 1, cloudwatch_failed: 0, cloudwatch_incomplete: 0, topology_unreadable: 0 },
    });
    expect(JSON.stringify(rows[0].checks)).not.toMatch(/i-[0-9a-f]{8,}/);
  });
});

describe('L6: tenant isolation', () => {
  it('a scan of one organization never ends, removes or labels another\'s identical rows', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    await seedCpuOnlyHistory(orgB, FOUNDER, 37, await insertRun(orgB));
    await pool.query(
      `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, potential_savings, severity, status, aws_region, metadata)
       VALUES ($1, $2, 'EC2', $3, 8.5, 'LOW', 'ACTIVE', $4, $5)`,
      [orgB, OTHER, IDLE, HOME, JSON.stringify(CPU_ONLY_METADATA)]
    );
    const bBefore = await allRows(orgB);
    const bAudit = await auditRows(orgB);
    const bDetection = await detectionRow(orgB);

    await scan(orgA, { instances: [{ id: FOUNDER }, { id: OTHER, launch: new Date(Date.now() - 86_400_000) }], metrics: { [FOUNDER]: FOUNDER_METRICS } });
    await scan(orgA, { instances: [{ id: FOUNDER }] });

    expect(await allRows(orgB)).toEqual(bBefore);
    expect(await auditRows(orgB)).toEqual(bAudit);
    expect(await detectionRow(orgB)).toEqual(bDetection);
    expect((await repository.getHiddenFindings(orgB)).items[0]).toMatchObject({ issueLabel: IDLE });
  });
});
