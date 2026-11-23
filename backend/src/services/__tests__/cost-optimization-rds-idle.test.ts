/**
 * C1: the idle RDS detector (config/rds-idle-rule.ts, rds-idle-evaluation.ts)
 * against fake DescribeDBInstances and GetMetricData answers. No network.
 *
 * Covers: positive detection; one active day; the connection, CPU, read IOPS
 * and write IOPS thresholds (just under / at); missing, partial and failed
 * metrics (never a finding); the 30-day boundary (created before / inside the
 * window; window bounds); every scope exclusion; the rule id/version and
 * evidence shape; no dollar estimate; home region; listing failures.
 */
import costOptimizationService from '../cost-optimization.service';
import { AWSClientFactory } from '../aws-client-factory.service';
import { OptimizationRuleConfigService } from '../optimization-rule-config.service';
import { rdsIdleWindow, judgeRdsIdleScope } from '../rds-idle-evaluation';
import { RDS_IDLE_RULE } from '../../config/rds-idle-rule';
import { ISSUE_RDS_IDLE_INSTANCE, ISSUE_EBS_OLD_SNAPSHOT } from '../../config/optimization-rules';
import { classifySavingsBasis, countSavingsFindings } from '../estimated-savings';
import { fakeClient, accessDenied } from './helpers/low-activity-aws';

const service = costOptimizationService as any;
const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const NOW = new Date('2026-11-23T12:00:00.000Z');
const WINDOW = rdsIdleWindow(NOW);
const OLD = new Date(WINDOW.start.getTime() - 10 * DAY);

type HourValue = (hour: number) => number | null;
interface FakeDbMetrics {
  connections?: HourValue;
  cpu?: HourValue;
  readIops?: HourValue;
  writeIops?: HourValue;
  status?: 'Complete' | 'PartialData' | 'Forbidden' | 'InternalError';
}
const QUIET: Required<Omit<FakeDbMetrics, 'status'>> = { connections: () => 0, cpu: () => 3, readIops: () => 0.5, writeIops: () => 2 };
const METRIC_KEY: Record<string, keyof typeof QUIET> = { DatabaseConnections: 'connections', CPUUtilization: 'cpu', ReadIOPS: 'readIops', WriteIOPS: 'writeIops' };

function db(id: string, overrides: Record<string, unknown> = {}) {
  return {
    DBInstanceIdentifier: id,
    DBInstanceArn: `arn:aws:rds:us-east-1:111122223333:db:${id}`,
    DbiResourceId: `db-PLACEHOLDER${id.toUpperCase()}`,
    DBInstanceStatus: 'available',
    Engine: 'postgres',
    EngineVersion: '16.3',
    DBInstanceClass: 'db.t3.medium',
    MultiAZ: false,
    AllocatedStorage: 100,
    StorageType: 'gp3',
    InstanceCreateTime: OLD,
    ...overrides,
  };
}

function fakeRds(instances: unknown[] | Error) {
  return fakeClient(() => {
    if (instances instanceof Error) throw instances;
    return { DBInstances: instances };
  });
}

function fakeRdsCloudWatch(byDb: Record<string, FakeDbMetrics> | Error) {
  return fakeClient((command: any) => {
    if (byDb instanceof Error) throw byDb;
    const results = (command.input.MetricDataQueries as any[]).map((q) => {
      const dbId = q.MetricStat.Metric.Dimensions[0].Value as string;
      const metric = q.MetricStat.Metric.MetricName as string;
      const spec = byDb[dbId] ?? {};
      const fn = spec[METRIC_KEY[metric]] ?? QUIET[METRIC_KEY[metric]];
      const Timestamps: Date[] = [];
      const Values: number[] = [];
      for (let h = 0; h < 30 * 24; h++) {
        const v = fn(h);
        if (v === null) continue;
        Timestamps.push(new Date(WINDOW.start.getTime() + h * HOUR));
        Values.push(v);
      }
      return { Id: q.Id, Label: metric, Timestamps, Values, StatusCode: spec.status ?? 'Complete' };
    });
    return { MetricDataResults: results };
  });
}

async function detect(instances: unknown[] | Error, metrics: Record<string, FakeDbMetrics> | Error = {}, region = 'us-east-1') {
  const rds = fakeRds(instances);
  const cloudWatch = fakeRdsCloudWatch(metrics);
  const result = await service.detectIdleRDSInstances({ rds, cloudWatch }, region, NOW);
  return { result, rds, cloudWatch };
}

const ids = (result: any) => result.issues.map((i: any) => i.resourceId);

describe('idle RDS: positive detection, evidence and identity', () => {
  it('finds an available instance with no connections, low CPU and low IOPS on every day', async () => {
    const { result, cloudWatch } = await detect([db('quiet-db')]);
    expect(result.success).toBe(true);
    expect(result.endActiveForUnknown).toBe(true);
    expect(result.unknownResourceIds).toEqual([]);
    expect(ids(result)).toEqual(['quiet-db']);

    const [query] = cloudWatch.send.mock.calls[0];
    const sent = (query.input.MetricDataQueries as any[]).map((q) => [q.MetricStat.Metric.Namespace, q.MetricStat.Metric.MetricName, q.MetricStat.Stat, q.MetricStat.Period, q.MetricStat.Metric.Dimensions]);
    expect(sent).toEqual(['DatabaseConnections', 'CPUUtilization', 'ReadIOPS', 'WriteIOPS'].map((m) => ['AWS/RDS', m, 'Maximum', 3600, [{ Name: 'DBInstanceIdentifier', Value: 'quiet-db' }]]));
    expect(query.input.StartTime).toEqual(WINDOW.start);
    expect(query.input.EndTime).toEqual(WINDOW.end);
  });

  it('stores the rule identity, the daily evidence and no dollar estimate', async () => {
    const { result } = await detect([db('quiet-db', { TagList: [{ Key: 'Name', Value: 'Placeholder DB' }] })]);
    const [finding] = result.issues;
    expect(finding).toMatchObject({
      resourceId: 'quiet-db',
      resourceName: 'Placeholder DB',
      resourceType: 'RDS',
      issue: ISSUE_RDS_IDLE_INSTANCE,
      potentialSavings: 0,
      severity: 'LOW',
      awsRegion: 'us-east-1',
    });
    const m = finding.metadata;
    expect(m.rule_version).toBe(1);
    expect(m.rule).toEqual(JSON.parse(JSON.stringify(RDS_IDLE_RULE)));
    expect(m.rule.id).toBe('rds_idle');
    expect(m.savings_basis).toBeUndefined();
    expect(m.savings_note).toBe('no_price_source');
    expect(m.severity_basis).toBe('fixed_low_unknown_price');
    expect(m.rds_idle.days).toHaveLength(30);
    expect(m.rds_idle.days[0]).toEqual({ date: WINDOW.start.toISOString().slice(0, 10), connections_max: 0, cpu_peak_percent: 3, read_iops_peak: 0.5, write_iops_peak: 2 });
    expect(m.rds_idle).toMatchObject({
      window_start: WINDOW.start.toISOString(),
      window_end: WINDOW.end.toISOString(),
      instance_create_time: OLD.toISOString(),
      completeness: 'complete',
      worst: { cpu_peak_percent: 3, read_iops_peak: 0.5, write_iops_peak: 2 },
      scope_checks: { aurora: false, db_cluster_member: false, read_replica: false, read_replica_source: false, rds_custom: false },
    });
    expect(m).toMatchObject({ engine: 'postgres', db_instance_class: 'db.t3.medium', multi_az: false, allocated_storage_gb: 100, storage_type: 'gp3' });
    expect(finding.description).toContain('no client connections in any hourly sample');
    expect(finding.description).toContain('a very short connection between samples can be missed');
  });

  it('never counts as a dollar estimate or an upper bound', async () => {
    const { result } = await detect([db('quiet-db')]);
    const rec = { resource_type: 'RDS', potential_savings: 0, metadata: result.issues[0].metadata };
    expect(classifySavingsBasis(rec.metadata.savings_basis)).toBeNull();
    expect(countSavingsFindings([rec])).toEqual({ estimatedFindings: 0, ceilingFindings: 0, unestimatedFindings: 1 });
  });

  it('records the home region it was given', async () => {
    const { result } = await detect([db('quiet-db')], {}, 'eu-west-1');
    expect(result.issues[0].awsRegion).toBe('eu-west-1');
  });
});

describe('idle RDS: activity wins (one active day prevents detection)', () => {
  const ONE_HOUR_ON_DAY_12 = 12 * 24 + 5;
  it.each([
    ['a single connection in one hour', { connections: (h: number) => (h === ONE_HOUR_ON_DAY_12 ? 1 : 0) }],
    ['CPU at 10% in one hour', { cpu: (h: number) => (h === ONE_HOUR_ON_DAY_12 ? 10 : 3) }],
    ['read IOPS at 20 in one hour', { readIops: (h: number) => (h === ONE_HOUR_ON_DAY_12 ? 20 : 0.5) }],
    ['write IOPS at 20 in one hour', { writeIops: (h: number) => (h === ONE_HOUR_ON_DAY_12 ? 20 : 2) }],
  ])('%s: not idle', async (_label, metrics) => {
    const { result } = await detect([db('busy-db')], { 'busy-db': metrics });
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([]);
  });

  it.each([
    ['CPU just under 10%', { cpu: () => 9.99 }],
    ['read IOPS just under 20', { readIops: () => 19.99 }],
    ['write IOPS just under 20', { writeIops: () => 19.99 }],
  ])('%s on every hour: still idle', async (_label, metrics) => {
    const { result } = await detect([db('edge-db')], { 'edge-db': metrics });
    expect(ids(result)).toEqual(['edge-db']);
  });

  it('activity wins even when the rest of the data is missing', async () => {
    const { result } = await detect([db('busy-db')], { 'busy-db': { connections: (h) => (h === 3 ? 2 : null), cpu: () => null } });
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([]);
  });

  it('a connection outside the window does not count (window bounds)', () => {
    // The fake writes hour 0..719 from window start; a datapoint before start is ignored by the judge.
    const { judgeRdsIdleMetrics } = jest.requireActual('../rds-idle-evaluation');
    const series = (values: number[], start: number) => ({ timestamps: values.map((_, i) => new Date(start + i * HOUR)), values });
    const full = (v: number) => series(Array(720).fill(v), WINDOW.start.getTime());
    const withEarlyConnection = { timestamps: [new Date(WINDOW.start.getTime() - HOUR), ...full(0).timestamps], values: [5, ...full(0).values] };
    const withLateConnection = { timestamps: [...full(0).timestamps, new Date(WINDOW.end.getTime())], values: [...full(0).values, 5] };
    for (const connections of [withEarlyConnection, withLateConnection]) {
      const verdict = judgeRdsIdleMetrics(
        { connections: { outcome: 'complete', series: connections }, cpu: { outcome: 'complete', series: full(1) }, readIops: { outcome: 'complete', series: full(1) }, writeIops: { outcome: 'complete', series: full(1) } },
        OLD,
        WINDOW
      );
      expect(verdict.kind).toBe('idle');
    }
  });
});

describe('idle RDS: missing or partial metrics never produce a finding', () => {
  it.each([
    ['one hour of connections missing', { connections: (h: number) => (h === 100 ? null : 0) }],
    ['one hour of write IOPS missing', { writeIops: (h: number) => (h === 719 ? null : 2) }],
    ['a whole day of CPU missing (stopped for a day)', { cpu: (h: number) => (h >= 24 * 7 && h < 24 * 8 ? null : 3) }],
    ['no read IOPS datapoints at all', { readIops: () => null }],
    ['PartialData from CloudWatch', { status: 'PartialData' as const }],
    ['Forbidden from CloudWatch', { status: 'Forbidden' as const }],
    ['InternalError from CloudWatch', { status: 'InternalError' as const }],
  ])('%s: couldn\'t check', async (_label, metrics) => {
    const { result } = await detect([db('gappy-db')], { 'gappy-db': metrics as FakeDbMetrics });
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['gappy-db']);
  });

  it('a failed CloudWatch call makes every candidate couldn\'t check, never idle', async () => {
    const { result } = await detect([db('a'), db('b')], accessDenied());
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['a', 'b']);
    expect(result.endActiveForUnknown).toBe(true);
  });
});

describe('idle RDS: the 30-day boundary', () => {
  it('created exactly at the window start: evaluated', async () => {
    const { result } = await detect([db('edge-db', { InstanceCreateTime: WINDOW.start })]);
    expect(ids(result)).toEqual(['edge-db']);
  });

  it('created one second after the window start: couldn\'t check', async () => {
    const { result } = await detect([db('young-db', { InstanceCreateTime: new Date(WINDOW.start.getTime() + 1000) })]);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['young-db']);
  });

  it('no creation time: couldn\'t check', async () => {
    const { result } = await detect([db('mystery-db', { InstanceCreateTime: undefined })]);
    expect(result.unknownResourceIds).toEqual(['mystery-db']);
  });

  it('the window is the last 30 complete UTC days, with the 2-hour settle lag', () => {
    expect(WINDOW).toEqual({ start: new Date('2026-10-24T00:00:00.000Z'), end: new Date('2026-11-23T00:00:00.000Z') });
    expect(rdsIdleWindow(new Date('2026-11-23T01:59:00.000Z')).end).toEqual(new Date('2026-11-22T00:00:00.000Z'));
    expect(rdsIdleWindow(new Date('2026-11-23T02:00:00.000Z')).end).toEqual(new Date('2026-11-23T00:00:00.000Z'));
  });
});

describe('idle RDS: exclusions (skipped, no metric reads, never unknown)', () => {
  it.each([
    ['Aurora engine', { Engine: 'aurora-postgresql', DBClusterIdentifier: 'placeholder-cluster' }, 'aurora'],
    ['Aurora engine without a cluster id', { Engine: 'aurora-mysql' }, 'aurora'],
    ['Multi-AZ DB cluster member', { Engine: 'postgres', DBClusterIdentifier: 'placeholder-maz-cluster' }, 'db_cluster_member'],
    ['read replica of an instance', { ReadReplicaSourceDBInstanceIdentifier: 'placeholder-source' }, 'read_replica'],
    ['read replica of a cluster', { ReadReplicaSourceDBClusterIdentifier: 'placeholder-source-cluster' }, 'read_replica'],
    ['source of read replicas', { ReadReplicaDBInstanceIdentifiers: ['placeholder-replica'] }, 'read_replica_source'],
    ['source of cluster replicas', { ReadReplicaDBClusterIdentifiers: ['placeholder-replica-cluster'] }, 'read_replica_source'],
    ['RDS Custom', { Engine: 'custom-oracle-ee' }, 'rds_custom'],
    ['stopped', { DBInstanceStatus: 'stopped' }, 'stopped'],
  ])('%s', async (_label, overrides, reason) => {
    expect(judgeRdsIdleScope(db('x', overrides) as any)).toEqual({ kind: 'excluded', reason });
    const { result, cloudWatch } = await detect([db('excluded-db', overrides)]);
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual([]);
    expect(cloudWatch.send).not.toHaveBeenCalled();
  });

  it.each(['starting', 'stopping', 'modifying', 'backing-up', 'rebooting'])('status %s: couldn\'t check', async (status) => {
    const { result, cloudWatch } = await detect([db('busy-state-db', { DBInstanceStatus: status })]);
    expect(result.issues).toEqual([]);
    expect(result.unknownResourceIds).toEqual(['busy-state-db']);
    expect(cloudWatch.send).not.toHaveBeenCalled();
  });

  it('evaluates the in-scope instances among excluded ones', async () => {
    const { result } = await detect([db('aurora-db', { Engine: 'aurora-postgresql' }), db('quiet-db'), db('stopped-db', { DBInstanceStatus: 'stopped' })]);
    expect(ids(result)).toEqual(['quiet-db']);
  });
});

describe('idle RDS: listing', () => {
  it('a failed DescribeDBInstances fails the category', async () => {
    const { result } = await detect(accessDenied());
    expect(result).toEqual({ success: false, issues: [] });
  });

  it('no instances: a successful, empty observation', async () => {
    const { result, cloudWatch } = await detect([]);
    expect(result).toMatchObject({ success: true, issues: [], unknownResourceIds: [] });
    expect(cloudWatch.send).not.toHaveBeenCalled();
  });

  it('an incomplete listing (page limit reached) fails the category', async () => {
    const rds = fakeClient(() => ({ DBInstances: [db('quiet-db')], Marker: 'more' }));
    const result = await service.detectIdleRDSInstances({ rds, cloudWatch: fakeRdsCloudWatch({}) }, 'us-east-1', NOW);
    expect(result).toEqual({ success: false, issues: [] });
  });
});

describe('C1 wiring in analyzeAllResources', () => {
  afterEach(() => jest.restoreAllMocks());

  it('both new checks run on the home-region clients; idle RDS drops rows it could not check, old snapshots keep them', async () => {
    const clients = { enabled: true, region: 'eu-west-1', ec2: {}, rds: {}, s3: {}, lambda: {}, cloudWatch: {}, backup: {} };
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clients as any);
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockResolvedValue({ ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default' } as any);
    for (const detector of [
      'detectLowActivityEC2Instances', 'detectUnusedElasticIPs', 'detectUnattachedEBSVolumes', 'detectGp2ToGp3Migrations',
      'detectS3LifecycleOptimization', 'detectLowUsageLambdaFunctions', 'detectDynamoDBCapacityOptimization',
      'detectDynamoDBOnDemandVsProvisionedOptimization', 'detectReservedInstanceOpportunities',
    ]) {
      jest.spyOn(service, detector).mockResolvedValue({ success: true, issues: [] });
    }
    const rds = jest.spyOn(service, 'detectIdleRDSInstances').mockResolvedValue({ success: true, issues: [], unknownResourceIds: ['placeholder-db-1'], endActiveForUnknown: true });
    const snaps = jest.spyOn(service, 'detectOldEBSSnapshots').mockResolvedValue({ success: true, issues: [], unknownResourceIds: ['snap-0000000000000001'] });

    const analysis = await costOptimizationService.analyzeAllResources('org-c1-wiring');

    expect(analysis.homeRegion).toBe('eu-west-1');
    expect(rds.mock.calls[0][1]).toBe('eu-west-1');
    expect(snaps.mock.calls[0][1]).toBe('eu-west-1');
    expect(analysis.observations.find((o) => o.issue === ISSUE_RDS_IDLE_INSTANCE)).toEqual({
      issue: ISSUE_RDS_IDLE_INSTANCE, success: true, recommendations: [], unknownResourceIds: ['placeholder-db-1'], endActiveForUnknown: true,
    });
    expect(analysis.observations.find((o) => o.issue === ISSUE_EBS_OLD_SNAPSHOT)).toEqual({
      issue: ISSUE_EBS_OLD_SNAPSHOT, success: true, recommendations: [], unknownResourceIds: ['snap-0000000000000001'],
    });
  });
});
