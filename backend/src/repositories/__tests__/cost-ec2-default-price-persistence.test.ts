/**
 * Cost Optimization PR 4, live Postgres: the idle EC2 $50 default keeps its
 * provenance and its fixed LOW severity through persistence, refresh (the
 * next scan's re-insert), the per-finding detection, the hidden list, reopen
 * and /stats -- and a genuine $50 list price is never labelled the default.
 *
 * The detector runs for real over mocked AWS clients; its output goes
 * through the same request mapping the service uses into the real
 * reconciliation.
 */
import { Pool } from 'pg';
import { EC2Client } from '@aws-sdk/client-ec2';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CostDecisionActor, CostRecommendationsRepository } from '../cost-recommendations.repository';
import costOptimizationService, { EC2_MONTHLY_LIST_PRICES } from '../../services/cost-optimization.service';
import type { DetectorObservation } from '../../services/cost-optimization.service';
import { EC2_PRICE_SOURCE_DEFAULT, EC2_PRICE_SOURCE_LIST_TABLE, SEVERITY_BASIS_FIXED_LOW_UNKNOWN_PRICE } from '../../services/estimated-savings';
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
const createdUserIds: string[] = [];

const IDLE = 'Idle Instance';
const INSTANCE = 'i-1234567890abcdef0';
const GENUINE_FIFTY = 'x9.placeholder-fifty';
const LONG_RUNNING = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
let actor: CostDecisionActor;
let leaseOffset = 0;

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function insertOrg(): Promise<string> {
  const s = suffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Default Price Org ${s}`, `default-price-org-${s}`]
  );
  createdOrgIds.push(rows[0].id);
  await leases.hold(rows[0].id);
  return rows[0].id;
}

async function insertRun(orgId: string): Promise<string> {
  leaseOffset += 1;
  const { rows } = await pool.query(
    `INSERT INTO cost_analysis_runs (organization_id, status, source, checks, lease_acquired_at, created_at, completed_at)
     VALUES ($1, 'completed', 'discovery', $2::jsonb, NOW() + make_interval(secs => $3::int), NOW(), NOW()) RETURNING id`,
    [orgId, JSON.stringify([{ rule_id: null, issue: IDLE, outcome: 'complete', detected: 0, unknown: 0 }]), leaseOffset]
  );
  return rows[0].id;
}

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

/** One real detector pass over an idle instance of `instanceType`, mapped as the service maps it. */
async function idleObservation(instanceType: string): Promise<DetectorObservation> {
  const ec2 = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({
    Reservations: [{ Instances: [{ InstanceId: INSTANCE, InstanceType: instanceType, LaunchTime: LONG_RUNNING, Placement: { AvailabilityZone: 'us-east-1a' } }] }],
  }));
  const cw = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({
    Datapoints: Array.from({ length: 168 }, () => ({ Average: 1 })),
  }));
  const result = await (costOptimizationService as any).detectIdleEC2Instances(ec2, cw, { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 5, source: 'default' });
  const recommendations: CreateRecommendationRequest[] = result.issues.map((issue: any) => ({
    resource_id: issue.resourceId,
    resource_name: issue.resourceName,
    resource_type: issue.resourceType,
    issue: issue.issue,
    description: issue.description,
    potential_savings: issue.potentialSavings,
    severity: issue.severity,
    aws_region: issue.awsRegion,
    metadata: issue.metadata,
  }));
  return { issue: IDLE, success: true, recommendations, unknownResourceIds: result.unknownResourceIds };
}

async function scan(orgId: string, instanceType: string) {
  const runId = await insertRun(orgId);
  await repository.reconcileActiveRecommendations(orgId, [await idleObservation(instanceType)], { homeRegion: 'us-east-1' }, await leases.hold(orgId), runId);
}

const activeRow = async (orgId: string) =>
  (await pool.query(`SELECT id, severity, potential_savings, metadata FROM cost_recommendations WHERE organization_id = $1 AND status = 'ACTIVE'`, [orgId])).rows;

const detection = async (orgId: string) =>
  (await pool.query(`SELECT severity, metadata FROM cost_finding_detections WHERE organization_id = $1 AND resource_id = $2`, [orgId, INSTANCE])).rows[0];

beforeAll(async () => {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Pat Placeholder') RETURNING id`,
    [`default-price-${suffix()}@example.com`]
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

beforeEach(() => jest.spyOn(console, 'error').mockImplementation(() => {}));
afterEach(() => {
  jest.restoreAllMocks();
  delete EC2_MONTHLY_LIST_PRICES[GENUINE_FIFTY];
});

describe('the $50 default through persistence, refresh and aggregation', () => {
  it('stays LOW and marked as the default: insert, refresh, /stats, detection, hidden list and reopen', async () => {
    const orgId = await insertOrg();

    // Persisted ACTIVE row.
    await scan(orgId, 'z9.unlisted');
    let rows = await activeRow(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('LOW');
    expect(Number(rows[0].potential_savings)).toBe(50);
    expect(rows[0].metadata).toMatchObject({ price_source: EC2_PRICE_SOURCE_DEFAULT, severity_basis: SEVERITY_BASIS_FIXED_LOW_UNKNOWN_PRICE });

    // Refresh: the next scan deletes and re-inserts the ACTIVE row.
    await scan(orgId, 'z9.unlisted');
    rows = await activeRow(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('LOW');
    expect(rows[0].metadata.price_source).toBe(EC2_PRICE_SOURCE_DEFAULT);

    // Aggregation: counted LOW, never MEDIUM; the $50 stays in the estimate total.
    let stats = await repository.getStats(orgId);
    expect(stats.by_severity).toEqual({ high: 0, medium: 0, low: 1 });
    expect(stats.total_potential_savings).toBe(50);
    const listed = await repository.findAll(orgId, { status: 'ACTIVE' });
    expect(listed[0].metadata).toMatchObject({ price_source: EC2_PRICE_SOURCE_DEFAULT });

    // Resolve, then a scan still detects it: the detection and the hidden list keep both.
    await repository.updateStatus(rows[0].id, 'RESOLVED', orgId, actor);
    await scan(orgId, 'z9.unlisted');
    expect(await activeRow(orgId)).toHaveLength(0);
    const det = await detection(orgId);
    expect(det.severity).toBe('LOW');
    expect(det.metadata.price_source).toBe(EC2_PRICE_SOURCE_DEFAULT);
    const hidden = await repository.getHiddenFindings(orgId);
    const item = hidden.items.find((i) => i.resourceId === INSTANCE)!;
    expect(item.detection.state).toBe('still_detected');
    expect(item.detection.priceSource).toBe(EC2_PRICE_SOURCE_DEFAULT);
    expect(item.detection.severity).toBe('LOW');
    expect(hidden.summary.stillDetected.estimatedMonthlySavings).toBe(50);

    // Reopen copies the detection: still LOW, still marked.
    const reopened = await repository.reopen(item.id, orgId, actor);
    expect(reopened).toMatchObject({ outcome: 'reopened', activeNow: true });
    rows = await activeRow(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].severity).toBe('LOW');
    expect(rows[0].metadata).toMatchObject({ price_source: EC2_PRICE_SOURCE_DEFAULT, severity_basis: SEVERITY_BASIS_FIXED_LOW_UNKNOWN_PRICE });
    stats = await repository.getStats(orgId);
    expect(stats.by_severity).toEqual({ high: 0, medium: 0, low: 1 });
  });

  it('a genuine $50 list price is persisted as list_table and MEDIUM, and the hidden list says list_table', async () => {
    EC2_MONTHLY_LIST_PRICES[GENUINE_FIFTY] = 50;
    const orgId = await insertOrg();
    await scan(orgId, GENUINE_FIFTY);
    const rows = await activeRow(orgId);
    expect(rows[0].severity).toBe('MEDIUM');
    expect(Number(rows[0].potential_savings)).toBe(50);
    expect(rows[0].metadata.price_source).toBe(EC2_PRICE_SOURCE_LIST_TABLE);
    expect(rows[0].metadata).not.toHaveProperty('severity_basis');
    expect((await repository.getStats(orgId)).by_severity).toEqual({ high: 0, medium: 1, low: 0 });

    await repository.updateStatus(rows[0].id, 'RESOLVED', orgId, actor);
    await scan(orgId, GENUINE_FIFTY);
    const item = (await repository.getHiddenFindings(orgId)).items.find((i) => i.resourceId === INSTANCE)!;
    expect(item.detection.priceSource).toBe(EC2_PRICE_SOURCE_LIST_TABLE);
    expect(item.detection.severity).toBe('MEDIUM');
  });

  it('a detection with no price_source (written before PR 4) reads priceSource null', async () => {
    const orgId = await insertOrg();
    await scan(orgId, 't3.micro');
    const rows = await activeRow(orgId);
    await repository.updateStatus(rows[0].id, 'RESOLVED', orgId, actor);
    await scan(orgId, 't3.micro');
    await pool.query(`UPDATE cost_finding_detections SET metadata = metadata - 'price_source' WHERE organization_id = $1`, [orgId]);
    const item = (await repository.getHiddenFindings(orgId)).items.find((i) => i.resourceId === INSTANCE)!;
    expect(item.detection.priceSource).toBeNull();
  });
});
