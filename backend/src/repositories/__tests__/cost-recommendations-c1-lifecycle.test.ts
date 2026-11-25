/**
 * C1: the idle RDS and old EBS snapshot findings go through the existing
 * occurrence lifecycle unchanged -- one ACTIVE row per (org, resource, issue)
 * however many scans find it (dedup), a Resolve/Dismiss decision hides the
 * finding and records "still detected" evidence, a resource the detector could
 * not check keeps (snapshots) or drops (idle RDS, endActiveForUnknown) its ACTIVE
 * row while its decision stays open, both issues are reconciled in the home
 * region only, and one organization's scan never touches another's rows. The
 * run record stores both checks' counts by reason (C1 review S-1).
 *
 * Live database, real reconcile under a real scan lease. Placeholders only.
 */
import { Pool } from 'pg';
import { CostRecommendationsRepository, HOME_REGION_SCOPED_ISSUE_LIST } from '../cost-recommendations.repository';
import { ISSUE_EBS_OLD_SNAPSHOT, ISSUE_RDS_IDLE_INSTANCE } from '../../config/optimization-rules';
import type { DetectorObservation } from '../../services/cost-optimization.service';
import type { CreateRecommendationRequest } from '../../types';
import { TestLeases } from '../../services/__tests__/helpers/scan-source';
import { fakeClient, accessDenied } from '../../services/__tests__/helpers/low-activity-aws';
import costOptimizationService from '../../services/cost-optimization.service';
import { summarizeDetectors } from '../../services/cost-analysis-outcome';

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
    [`C1 Lifecycle ${suffix}`, `c1-lifecycle-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  await leases.hold(rows[0].id);
  return rows[0].id;
}

const snapshotFinding = (id: string, region = HOME): CreateRecommendationRequest => ({
  resource_id: id, resource_name: id, resource_type: 'EBS Snapshot', issue: ISSUE_EBS_OLD_SNAPSHOT, description: 'placeholder',
  potential_savings: 5, severity: 'LOW', aws_region: region,
  metadata: { rule_version: 1, savings_basis: 'ceiling: placeholder upper bound' },
});
const rdsFinding = (id: string, region = HOME): CreateRecommendationRequest => ({
  resource_id: id, resource_name: id, resource_type: 'RDS', issue: ISSUE_RDS_IDLE_INSTANCE, description: 'placeholder',
  potential_savings: 0, severity: 'LOW', aws_region: region, metadata: { rule_version: 1, savings_note: 'no_price_source' },
});

const snapshotObservation = (recs: CreateRecommendationRequest[], unknown: string[] = []): DetectorObservation =>
  ({ issue: ISSUE_EBS_OLD_SNAPSHOT, success: true, recommendations: recs, unknownResourceIds: unknown });
const rdsObservation = (recs: CreateRecommendationRequest[], unknown: string[] = []): DetectorObservation =>
  ({ issue: ISSUE_RDS_IDLE_INSTANCE, success: true, recommendations: recs, unknownResourceIds: unknown, endActiveForUnknown: true });

const reconcile = (orgId: string, observations: DetectorObservation[]) =>
  repository.reconcileActiveRecommendations(orgId, observations, { homeRegion: HOME }, leases.of(orgId), null);

const rows = async (orgId: string) => (await pool.query(
  `SELECT resource_id, issue, resource_type, aws_region, status, occurrence_ended_at IS NOT NULL AS ended FROM cost_recommendations
    WHERE organization_id = $1 ORDER BY issue, resource_id, status`, [orgId])).rows;
const detections = async (orgId: string) => (await pool.query(
  `SELECT resource_id, issue, outcome FROM cost_finding_detections WHERE organization_id = $1 ORDER BY issue, resource_id`, [orgId])).rows;
const decide = (orgId: string, resourceId: string, issue: string, status: 'RESOLVED' | 'DISMISSED') =>
  pool.query(`UPDATE cost_recommendations SET status = $4, updated_at = NOW() WHERE organization_id = $1 AND resource_id = $2 AND issue = $3 AND status = 'ACTIVE'`, [orgId, resourceId, issue, status]);

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

describe('C1 findings in the occurrence lifecycle', () => {
  it('both issues are home-region scoped (and so moved with a home region change)', () => {
    expect(HOME_REGION_SCOPED_ISSUE_LIST).toEqual(expect.arrayContaining([ISSUE_RDS_IDLE_INSTANCE, ISSUE_EBS_OLD_SNAPSHOT]));
  });

  it('dedup: the same findings on three scans leave one ACTIVE row each', async () => {
    const org = await insertOrg();
    const observations = [snapshotObservation([snapshotFinding('snap-0000000000000001')]), rdsObservation([rdsFinding('placeholder-db-1')])];
    const first = await reconcile(org, observations);
    expect(first.counts).toMatchObject({ detected: 2, new: 2, persisted: 2 });
    await reconcile(org, observations);
    const third = await reconcile(org, observations);
    expect(third.counts).toMatchObject({ detected: 2, new: 0, refreshed: 2, persisted: 2 });
    expect(await rows(org)).toEqual([
      { resource_id: 'snap-0000000000000001', issue: ISSUE_EBS_OLD_SNAPSHOT, resource_type: 'EBS Snapshot', aws_region: HOME, status: 'ACTIVE', ended: false },
      { resource_id: 'placeholder-db-1', issue: ISSUE_RDS_IDLE_INSTANCE, resource_type: 'RDS', aws_region: HOME, status: 'ACTIVE', ended: false },
    ].sort((a, b) => a.issue.localeCompare(b.issue)));
  });

  it('a decision hides the finding on the next scan and records it as still detected', async () => {
    const org = await insertOrg();
    const observations = [snapshotObservation([snapshotFinding('snap-0000000000000001')]), rdsObservation([rdsFinding('placeholder-db-1')])];
    await reconcile(org, observations);
    await decide(org, 'snap-0000000000000001', ISSUE_EBS_OLD_SNAPSHOT, 'RESOLVED');
    await decide(org, 'placeholder-db-1', ISSUE_RDS_IDLE_INSTANCE, 'DISMISSED');

    const again = await reconcile(org, observations);
    expect(again.counts).toMatchObject({ detected: 2, persisted: 0, suppressedResolved: 1, suppressedDismissed: 1 });
    expect((await rows(org)).map((r) => [r.resource_id, r.status, r.ended])).toEqual(expect.arrayContaining([
      ['snap-0000000000000001', 'RESOLVED', false],
      ['placeholder-db-1', 'DISMISSED', false],
    ]));
    expect((await rows(org)).filter((r) => r.status === 'ACTIVE')).toEqual([]);
    expect(await detections(org)).toEqual(expect.arrayContaining([
      { resource_id: 'snap-0000000000000001', issue: ISSUE_EBS_OLD_SNAPSHOT, outcome: 'detected' },
      { resource_id: 'placeholder-db-1', issue: ISSUE_RDS_IDLE_INSTANCE, outcome: 'detected' },
    ]));

    // Gone from a successful scan: the occurrence ends, so a later return is a new ACTIVE row.
    await reconcile(org, [snapshotObservation([]), rdsObservation([])]);
    expect((await rows(org)).every((r) => r.ended)).toBe(true);
  });

  it('couldn\'t check: a snapshot keeps its ACTIVE row; an idle RDS row is removed; decisions stay open either way', async () => {
    const org = await insertOrg();
    await reconcile(org, [
      snapshotObservation([snapshotFinding('snap-0000000000000001'), snapshotFinding('snap-0000000000000002')]),
      rdsObservation([rdsFinding('placeholder-db-1'), rdsFinding('placeholder-db-2')]),
    ]);
    await decide(org, 'snap-0000000000000002', ISSUE_EBS_OLD_SNAPSHOT, 'RESOLVED');
    await decide(org, 'placeholder-db-2', ISSUE_RDS_IDLE_INSTANCE, 'RESOLVED');

    await reconcile(org, [
      snapshotObservation([], ['snap-0000000000000001', 'snap-0000000000000002']),
      rdsObservation([], ['placeholder-db-1', 'placeholder-db-2']),
    ]);
    const after = (await rows(org)).map((r) => [r.resource_id, r.status, r.ended]);
    expect(after).toEqual(expect.arrayContaining([
      ['snap-0000000000000001', 'ACTIVE', false],
      ['snap-0000000000000002', 'RESOLVED', false],
      ['placeholder-db-2', 'RESOLVED', false],
    ]));
    expect(after).not.toContainEqual(['placeholder-db-1', 'ACTIVE', false]);
    expect(await detections(org)).toEqual(expect.arrayContaining([
      { resource_id: 'snap-0000000000000002', issue: ISSUE_EBS_OLD_SNAPSHOT, outcome: 'unknown' },
      { resource_id: 'placeholder-db-2', issue: ISSUE_RDS_IDLE_INSTANCE, outcome: 'unknown' },
    ]));
  });

  it('home region only: a row in another region is not this scan\'s to delete or end', async () => {
    const org = await insertOrg();
    await pool.query(
      `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, potential_savings, severity, status, aws_region)
       VALUES ($1, 'snap-00000000000000aa', 'EBS Snapshot', $2, 1, 'LOW', 'ACTIVE', 'eu-west-1'),
              ($1, 'placeholder-db-eu', 'RDS', $3, 0, 'LOW', 'DISMISSED', 'eu-west-1')`,
      [org, ISSUE_EBS_OLD_SNAPSHOT, ISSUE_RDS_IDLE_INSTANCE]
    );
    await reconcile(org, [snapshotObservation([]), rdsObservation([])]);
    expect((await rows(org)).map((r) => [r.resource_id, r.status, r.ended])).toEqual(expect.arrayContaining([
      ['snap-00000000000000aa', 'ACTIVE', false],
      ['placeholder-db-eu', 'DISMISSED', false],
    ]));
  });

  it('tenant isolation: one organization\'s scan never touches another\'s rows', async () => {
    const mine = await insertOrg();
    const theirs = await insertOrg();
    await reconcile(theirs, [snapshotObservation([snapshotFinding('snap-0000000000000001')]), rdsObservation([rdsFinding('placeholder-db-1')])]);
    await reconcile(mine, [snapshotObservation([]), rdsObservation([])]);
    expect((await rows(theirs)).map((r) => [r.resource_id, r.status])).toEqual(expect.arrayContaining([
      ['snap-0000000000000001', 'ACTIVE'],
      ['placeholder-db-1', 'ACTIVE'],
    ]));
    expect(await rows(mine)).toEqual([]);
  });
});

describe('C1 counts on the run record (C1 review S-1)', () => {
  let leaseOffset = 0;
  async function insertRun(orgId: string, checks: unknown[]): Promise<string> {
    leaseOffset += 1;
    const { rows: inserted } = await pool.query(
      `INSERT INTO cost_analysis_runs (organization_id, status, source, checks, lease_acquired_at, created_at, completed_at)
       VALUES ($1, 'completed', 'discovery', $2::jsonb, NOW() + make_interval(secs => $3::int), NOW(), NOW()) RETURNING id`,
      [orgId, JSON.stringify(checks), leaseOffset]
    );
    return inserted[0].id;
  }

  it('the run stores evaluated / flagged / not flagged / couldn\'t check / excluded by reason for both checks, with no resource IDs', async () => {
    const org = await insertOrg();
    const now = new Date();
    const daysAgo = (days: number) => new Date(now.getTime() - days * 86_400_000);
    const service = costOptimizationService as any;

    // Idle RDS: one Aurora (excluded), one stopped (excluded), two available whose metrics can't be read.
    const rds = fakeClient(() => ({ DBInstances: [
      { DBInstanceIdentifier: 'placeholder-db-aurora', Engine: 'aurora-postgresql', DBInstanceStatus: 'available' },
      { DBInstanceIdentifier: 'placeholder-db-stopped', Engine: 'postgres', DBInstanceStatus: 'stopped' },
      { DBInstanceIdentifier: 'placeholder-db-1', Engine: 'postgres', DBInstanceStatus: 'available', InstanceCreateTime: daysAgo(400) },
      { DBInstanceIdentifier: 'placeholder-db-2', Engine: 'mysql', DBInstanceStatus: 'available', InstanceCreateTime: daysAgo(400) },
    ] }));
    const cloudWatch = fakeClient(() => { throw accessDenied(); });
    const idleRDS = await service.detectIdleRDSInstances({ rds, cloudWatch }, HOME, now);

    // Old snapshots: one flagged, one locked, one too recent.
    const ec2 = fakeClient((command: any) => {
      switch (command.constructor.name) {
        case 'DescribeSnapshotsCommand':
          return { Snapshots: [
            { SnapshotId: 'snap-0000000000000001', State: 'completed', StorageTier: 'standard', StartTime: daysAgo(400), VolumeId: 'vol-0deleted000000001', VolumeSize: 10 },
            { SnapshotId: 'snap-0000000000000002', State: 'completed', StorageTier: 'standard', StartTime: daysAgo(400), VolumeId: 'vol-0deleted000000001', VolumeSize: 10 },
            { SnapshotId: 'snap-0000000000000003', State: 'completed', StorageTier: 'standard', StartTime: daysAgo(3), VolumeId: 'vol-0deleted000000001', VolumeSize: 10 },
          ] };
        case 'DescribeLockedSnapshotsCommand':
          return { Snapshots: [{ SnapshotId: 'snap-0000000000000002', LockState: 'governance' }] };
        case 'DescribeImagesCommand':
          return { Images: [] };
        default:
          return { Volumes: [] };
      }
    });
    const backup = fakeClient((command: any) => (command.constructor.name === 'ListBackupVaultsCommand' ? { BackupVaultList: [] } : { RecoveryPoints: [] }));
    const oldSnapshots = await service.detectOldEBSSnapshots({ ec2, backup }, HOME, now);

    const toRequest = (issue: any): CreateRecommendationRequest => ({
      resource_id: issue.resourceId, resource_name: issue.resourceName, resource_type: issue.resourceType, issue: issue.issue,
      description: issue.description, potential_savings: issue.potentialSavings, severity: issue.severity, aws_region: issue.awsRegion, metadata: issue.metadata,
    });
    const observations: DetectorObservation[] = [
      { issue: ISSUE_RDS_IDLE_INSTANCE, success: idleRDS.success, recommendations: idleRDS.issues.map(toRequest), unknownResourceIds: idleRDS.unknownResourceIds, endActiveForUnknown: idleRDS.endActiveForUnknown, rdsIdle: idleRDS.rdsIdle },
      { issue: ISSUE_EBS_OLD_SNAPSHOT, success: oldSnapshots.success, recommendations: oldSnapshots.issues.map(toRequest), unknownResourceIds: oldSnapshots.unknownResourceIds, oldSnapshots: oldSnapshots.oldSnapshots },
    ];
    const runId = await insertRun(org, summarizeDetectors(observations, true, []).checks);
    await repository.reconcileActiveRecommendations(org, observations, { homeRegion: HOME }, leases.of(org), runId);

    const { rows: stored } = await pool.query('SELECT checks FROM cost_analysis_runs WHERE id = $1', [runId]);
    const rdsCheck = stored[0].checks.find((c: any) => c.issue === ISSUE_RDS_IDLE_INSTANCE);
    const snapshotCheck = stored[0].checks.find((c: any) => c.issue === ISSUE_EBS_OLD_SNAPSHOT);
    expect(rdsCheck).toMatchObject({ rule_id: 'rds_idle', outcome: 'complete', detected: 0, unknown: 2 });
    expect(rdsCheck.rds_idle).toEqual({
      evaluated: 4, flagged: 0,
      not_flagged: { connections: 0, cpu_peak: 0, read_iops: 0, write_iops: 0 },
      couldnt_check: { not_available: 0, too_new: 0, cloudwatch_failed: 2, cloudwatch_incomplete: 0 },
      excluded: { aurora: 1, db_cluster_member: 0, read_replica: 0, read_replica_source: 0, rds_custom: 0, stopped: 1 },
      // C1b: nothing flagged, so nothing priced or unpriced.
      priced: 0,
      no_price: {
        missing_engine_or_class: 0, missing_license_model: 0, missing_deployment: 0, unknown_placement: 0, outposts: 0,
        local_zone: 0, unsupported_engine_or_license: 0, no_price_for_region: 0, no_price_for_configuration: 0,
      },
    });
    expect(snapshotCheck).toMatchObject({ rule_id: 'ebs_old_snapshots', outcome: 'complete', detected: 1, unknown: 0 });
    expect(snapshotCheck.old_snapshots).toEqual({
      evaluated: 3, flagged: 1,
      not_flagged: { not_completed: 0, archive_tier: 0, too_recent: 1 },
      couldnt_check: { ami_unreadable: 0, aws_backup_unreadable: 0, locks_unreadable: 0, volumes_unreadable: 0 },
      excluded: { ami: 0, aws_backup: 0, dlm: 0, locked: 1 },
    });
    expect(JSON.stringify(stored[0].checks)).not.toMatch(/snap-|placeholder-db|vol-/);
  });
});
