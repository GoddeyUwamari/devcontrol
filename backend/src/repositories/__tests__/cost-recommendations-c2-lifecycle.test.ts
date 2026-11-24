/**
 * C2: idle NAT gateway findings go through the existing occurrence lifecycle
 * unchanged -- one ACTIVE row per (org, gateway, issue) however many scans find
 * it (dedup), a Resolve/Dismiss decision hides the finding and records "still
 * detected", a gateway the detector could not check loses its ACTIVE row
 * (endActiveForUnknown: traffic can resume) while its decision stays open, the
 * issue is reconciled in the home region only, and one organization's scan
 * never touches another's rows. The run record stores the check's counts by
 * reason, with no gateway IDs.
 *
 * Live database, real reconcile under a real scan lease. Placeholders only.
 */
import { Pool } from 'pg';
import { CostRecommendationsRepository, HOME_REGION_SCOPED_ISSUE_LIST } from '../cost-recommendations.repository';
import { ISSUE_NAT_GATEWAY_IDLE } from '../../config/optimization-rules';
import type { DetectorObservation } from '../../services/cost-optimization.service';
import type { CreateRecommendationRequest } from '../../types';
import { TestLeases } from '../../services/__tests__/helpers/scan-source';
import { fakeClient } from '../../services/__tests__/helpers/low-activity-aws';
import costOptimizationService from '../../services/cost-optimization.service';
import { summarizeDetectors } from '../../services/cost-analysis-outcome';
import { natIdleWindow } from '../../services/nat-gateway-idle-evaluation';

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
const HOME = 'us-east-1';

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`C2 Lifecycle ${suffix}`, `c2-lifecycle-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await leases.hold(rows[0].id);
  return rows[0].id;
}

const natFinding = (id: string, region = HOME): CreateRecommendationRequest => ({
  resource_id: id, resource_name: id, resource_type: 'NAT Gateway', issue: ISSUE_NAT_GATEWAY_IDLE, description: 'placeholder',
  potential_savings: 32.85, severity: 'LOW', aws_region: region,
  metadata: { rule_version: 1, savings_basis: 'estimated: placeholder hourly list price' },
});
const natObservation = (recs: CreateRecommendationRequest[], unknown: string[] = []): DetectorObservation =>
  ({ issue: ISSUE_NAT_GATEWAY_IDLE, success: true, recommendations: recs, unknownResourceIds: unknown, endActiveForUnknown: true });

const reconcile = (orgId: string, observations: DetectorObservation[]) =>
  repository.reconcileActiveRecommendations(orgId, observations, { homeRegion: HOME }, leases.of(orgId), null);

const rows = async (orgId: string) => (await pool.query(
  `SELECT resource_id, issue, resource_type, aws_region, status, occurrence_ended_at IS NOT NULL AS ended FROM cost_recommendations
    WHERE organization_id = $1 ORDER BY resource_id, status`, [orgId])).rows;
const detections = async (orgId: string) => (await pool.query(
  `SELECT resource_id, issue, outcome FROM cost_finding_detections WHERE organization_id = $1 ORDER BY resource_id`, [orgId])).rows;
const decide = (orgId: string, resourceId: string, status: 'RESOLVED' | 'DISMISSED') =>
  pool.query(`UPDATE cost_recommendations SET status = $3, updated_at = NOW() WHERE organization_id = $1 AND resource_id = $2 AND issue = $4 AND status = 'ACTIVE'`, [orgId, resourceId, status, ISSUE_NAT_GATEWAY_IDLE]);

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

describe('C2 findings in the occurrence lifecycle', () => {
  it('the issue is home-region scoped (and so moved with a home region change)', () => {
    expect(HOME_REGION_SCOPED_ISSUE_LIST).toContain(ISSUE_NAT_GATEWAY_IDLE);
  });

  it('dedup: the same finding on three scans leaves one ACTIVE row; gone from a successful scan, its occurrence ends', async () => {
    const org = await insertOrg();
    const observations = [natObservation([natFinding('nat-placeholder-1')])];
    const first = await reconcile(org, observations);
    expect(first.counts).toMatchObject({ detected: 1, new: 1, persisted: 1 });
    await reconcile(org, observations);
    const third = await reconcile(org, observations);
    expect(third.counts).toMatchObject({ detected: 1, new: 0, refreshed: 1, persisted: 1 });
    expect(await rows(org)).toEqual([
      { resource_id: 'nat-placeholder-1', issue: ISSUE_NAT_GATEWAY_IDLE, resource_type: 'NAT Gateway', aws_region: HOME, status: 'ACTIVE', ended: false },
    ]);
    await reconcile(org, [natObservation([])]);
    expect((await rows(org)).every((r) => r.ended)).toBe(true);
  });

  it('a decision hides the finding on the next scan and records it as still detected', async () => {
    const org = await insertOrg();
    await reconcile(org, [natObservation([natFinding('nat-placeholder-1'), natFinding('nat-placeholder-2')])]);
    await decide(org, 'nat-placeholder-1', 'RESOLVED');
    await decide(org, 'nat-placeholder-2', 'DISMISSED');
    const again = await reconcile(org, [natObservation([natFinding('nat-placeholder-1'), natFinding('nat-placeholder-2')])]);
    expect(again.counts).toMatchObject({ detected: 2, persisted: 0, suppressedResolved: 1, suppressedDismissed: 1 });
    expect((await rows(org)).filter((r) => r.status === 'ACTIVE')).toEqual([]);
    expect(await detections(org)).toEqual(expect.arrayContaining([
      { resource_id: 'nat-placeholder-1', issue: ISSUE_NAT_GATEWAY_IDLE, outcome: 'detected' },
      { resource_id: 'nat-placeholder-2', issue: ISSUE_NAT_GATEWAY_IDLE, outcome: 'detected' },
    ]));
  });

  it('couldn\'t check: the ACTIVE row is removed (a finding never outlives its evidence); a decision stays open', async () => {
    const org = await insertOrg();
    await reconcile(org, [natObservation([natFinding('nat-placeholder-1'), natFinding('nat-placeholder-2')])]);
    await decide(org, 'nat-placeholder-2', 'RESOLVED');
    await reconcile(org, [natObservation([], ['nat-placeholder-1', 'nat-placeholder-2'])]);
    const after = (await rows(org)).map((r) => [r.resource_id, r.status, r.ended]);
    expect(after).not.toContainEqual(['nat-placeholder-1', 'ACTIVE', false]);
    expect(after).toContainEqual(['nat-placeholder-2', 'RESOLVED', false]);
    expect(await detections(org)).toEqual(expect.arrayContaining([
      { resource_id: 'nat-placeholder-2', issue: ISSUE_NAT_GATEWAY_IDLE, outcome: 'unknown' },
    ]));
  });

  it('home region only: a row in another region is not this scan\'s to delete or end', async () => {
    const org = await insertOrg();
    await pool.query(
      `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, potential_savings, severity, status, aws_region)
       VALUES ($1, 'nat-placeholder-eu', 'NAT Gateway', $2, 35.04, 'LOW', 'ACTIVE', 'eu-west-1')`,
      [org, ISSUE_NAT_GATEWAY_IDLE]
    );
    await reconcile(org, [natObservation([])]);
    expect((await rows(org)).map((r) => [r.resource_id, r.status, r.ended])).toEqual([['nat-placeholder-eu', 'ACTIVE', false]]);
  });

  it('tenant isolation: one organization\'s scan never touches another\'s rows', async () => {
    const mine = await insertOrg();
    const theirs = await insertOrg();
    await reconcile(theirs, [natObservation([natFinding('nat-placeholder-1')])]);
    await reconcile(mine, [natObservation([], ['nat-placeholder-1'])]);
    expect((await rows(theirs)).map((r) => [r.resource_id, r.status, r.ended])).toEqual([['nat-placeholder-1', 'ACTIVE', false]]);
    expect(await rows(mine)).toEqual([]);
  });
});

describe('C2 counts on the run record', () => {
  it('the run stores evaluated / flagged / not flagged / couldn\'t check / excluded by reason, with no gateway IDs', async () => {
    const org = await insertOrg();
    const now = new Date();
    const window = natIdleWindow(now);
    const old = new Date(window.start.getTime() - 30 * 86_400_000);
    const service = costOptimizationService as any;

    const ec2 = fakeClient((command: any) => (command.constructor.name === 'DescribeNatGatewaysCommand'
      ? { NatGateways: [
        { NatGatewayId: 'nat-placeholder-idle', State: 'available', ConnectivityType: 'public', CreateTime: old, NatGatewayAddresses: [{ AllocationId: 'eipalloc-placeholder-1', PublicIp: '192.0.2.10' }] },
        { NatGatewayId: 'nat-placeholder-busy', State: 'available', ConnectivityType: 'public', CreateTime: old },
        { NatGatewayId: 'nat-placeholder-gap', State: 'available', ConnectivityType: 'private', CreateTime: old },
        { NatGatewayId: 'nat-placeholder-regional', State: 'available', AvailabilityMode: 'regional', CreateTime: old },
        { NatGatewayId: 'nat-placeholder-deleting', State: 'deleting', CreateTime: old },
      ] }
      : { RouteTables: [{ RouteTableId: 'rtb-placeholder-1', Routes: [{ DestinationCidrBlock: '0.0.0.0/0', NatGatewayId: 'nat-placeholder-idle', State: 'active' }], Associations: [{ SubnetId: 'subnet-placeholder-1', AssociationState: { State: 'associated' } }] }] }));
    const cloudWatch = fakeClient((command: any) => ({
      MetricDataResults: (command.input.MetricDataQueries as any[]).map((q) => {
        const id = q.MetricStat.Metric.Dimensions[0].Value as string;
        const Timestamps: Date[] = [];
        const Values: number[] = [];
        for (let t = window.start.getTime(); t < window.end.getTime(); t += 3_600_000) {
          if (id === 'nat-placeholder-gap' && t === window.start.getTime()) continue;
          Timestamps.push(new Date(t));
          Values.push(id === 'nat-placeholder-busy' ? 5 : 0);
        }
        return { Id: q.Id, Timestamps, Values, StatusCode: 'Complete' };
      }),
    }));
    const idleNat = await service.detectIdleNatGateways({ ec2, cloudWatch }, HOME, now);

    const toRequest = (issue: any): CreateRecommendationRequest => ({
      resource_id: issue.resourceId, resource_name: issue.resourceName, resource_type: issue.resourceType, issue: issue.issue,
      description: issue.description, potential_savings: issue.potentialSavings, severity: issue.severity, aws_region: issue.awsRegion, metadata: issue.metadata,
    });
    const observations: DetectorObservation[] = [
      { issue: ISSUE_NAT_GATEWAY_IDLE, success: idleNat.success, recommendations: idleNat.issues.map(toRequest), unknownResourceIds: idleNat.unknownResourceIds, endActiveForUnknown: idleNat.endActiveForUnknown, natIdle: idleNat.natIdle },
    ];
    const { rows: inserted } = await pool.query(
      `INSERT INTO cost_analysis_runs (organization_id, status, source, checks, lease_acquired_at, created_at, completed_at)
       VALUES ($1, 'completed', 'discovery', $2::jsonb, NOW(), NOW(), NOW()) RETURNING id`,
      [org, JSON.stringify(summarizeDetectors(observations, true, []).checks)]
    );
    const runId = inserted[0].id;
    await repository.reconcileActiveRecommendations(org, observations, { homeRegion: HOME }, leases.of(org), runId);

    const { rows: stored } = await pool.query('SELECT checks FROM cost_analysis_runs WHERE id = $1', [runId]);
    const natCheck = stored[0].checks.find((c: any) => c.issue === ISSUE_NAT_GATEWAY_IDLE);
    expect(natCheck).toMatchObject({ rule_id: 'nat_gateway_idle', outcome: 'complete', detected: 1, unknown: 1 });
    expect(natCheck.nat_idle).toEqual({
      evaluated: 5, flagged: 1,
      not_flagged: { active_connections: 1, packets_from_source: 0, packets_from_destination: 0, bytes_from_source: 0, bytes_from_destination: 0 },
      couldnt_check: { pending: 0, unrecognised: 0, too_new: 0, cloudwatch_failed: 0, cloudwatch_incomplete: 1, routes_unreadable: 0 },
      excluded: { regional: 1, deleting: 1, deleted: 0, failed: 0 },
    });
    expect(JSON.stringify(stored[0].checks)).not.toMatch(/nat-placeholder|rtb-|subnet-|eipalloc-/);

    // The stored finding names its route table and carries the estimate.
    const { rows: recs } = await pool.query(`SELECT resource_id, resource_type, aws_region, potential_savings, metadata FROM cost_recommendations WHERE organization_id = $1`, [org]);
    expect(recs).toHaveLength(1);
    expect(recs[0]).toMatchObject({ resource_id: 'nat-placeholder-idle', resource_type: 'NAT Gateway', aws_region: HOME });
    expect(Number(recs[0].potential_savings)).toBe(32.85);
    expect(recs[0].metadata.nat_gateway_idle.routes.route_tables.map((t: any) => t.id)).toEqual(['rtb-placeholder-1']);
  });
});
