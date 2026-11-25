/**
 * C1: the idle RDS detector (config/rds-idle-rule.ts, rds-idle-evaluation.ts)
 * against fake DescribeDBInstances and GetMetricData answers. No network.
 *
 * Covers: positive detection; one active day; the connection, CPU, read IOPS
 * and write IOPS thresholds (just under / at); missing, partial and failed
 * metrics (never a finding); the 30-day boundary (created before / inside the
 * window; window bounds); every scope exclusion; the rule id/version and
 * evidence shape; no dollar estimate without an exact price; home region;
 * listing failures; the Marker passed on to the next DescribeDBInstances page
 * (C1 review N-1); the run's counts by reason (S-1). C1b: the instance-hour
 * estimate (exact regional price x 730, NAT's severity policy), every no-price
 * reason, the priced / no_price counts and the aggregate totals.
 */
import costOptimizationService from '../cost-optimization.service';
import { AWSClientFactory } from '../aws-client-factory.service';
import { OptimizationRuleConfigService } from '../optimization-rule-config.service';
import { rdsIdleWindow, judgeRdsIdleScope } from '../rds-idle-evaluation';
import { RDS_IDLE_RULE } from '../../config/rds-idle-rule';
import { ISSUE_RDS_IDLE_INSTANCE, ISSUE_EBS_OLD_SNAPSHOT } from '../../config/optimization-rules';
import { aggregateEstimatedSavings, classifySavingsBasis, countSavingsFindings } from '../estimated-savings';
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

  it('stores the rule identity, the daily evidence and, with no licence model returned, no dollar estimate', async () => {
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
    expect(m.rule_version).toBe(2);
    expect(m.rule).toEqual(JSON.parse(JSON.stringify(RDS_IDLE_RULE)));
    expect(m.rule.id).toBe('rds_idle');
    expect(m.savings_basis).toBeUndefined();
    expect(m.savings_note).toBe('missing_license_model');
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
    // C1b: the price key's licence model and the placement, as returned (none here).
    expect(m).toMatchObject({ license_model: null, on_outposts: null, availability_zone: null, secondary_availability_zone: null });
    expect(m.price_per_hour).toBeUndefined();
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
    expect(result).toEqual({ success: false, issues: [], failureReason: 'permissions' });
  });

  it('no instances: a successful, empty observation', async () => {
    const { result, cloudWatch } = await detect([]);
    expect(result).toMatchObject({ success: true, issues: [], unknownResourceIds: [] });
    expect(cloudWatch.send).not.toHaveBeenCalled();
  });

  it('passes the Marker on to the next page', async () => {
    const rds = fakeClient((command: any) =>
      command.input.Marker === undefined ? { DBInstances: [db('quiet-db-1')], Marker: 'tok-db' }
      : command.input.Marker === 'tok-db' ? { DBInstances: [db('quiet-db-2')] }
      : { DBInstances: [], Marker: 'wrong-token' });
    const result = await service.detectIdleRDSInstances({ rds, cloudWatch: fakeRdsCloudWatch({}) }, 'us-east-1', NOW);
    expect(rds.send.mock.calls.map(([c]: any[]) => c.input.Marker)).toEqual([undefined, 'tok-db']);
    expect(ids(result)).toEqual(['quiet-db-1', 'quiet-db-2']);
  });

  it('an incomplete listing (page limit reached) fails the category', async () => {
    const rds = fakeClient(() => ({ DBInstances: [db('quiet-db')], Marker: 'more' }));
    const result = await service.detectIdleRDSInstances({ rds, cloudWatch: fakeRdsCloudWatch({}) }, 'us-east-1', NOW);
    expect(result).toEqual({ success: false, issues: [], failureReason: 'too_many_resources' });
  });
});

describe('idle RDS: the run\'s counts by reason (C1 review S-1)', () => {
  const total = (counts: any) =>
    counts.flagged + [counts.not_flagged, counts.couldnt_check, counts.excluded].reduce((sum, group) => sum + Object.values(group as Record<string, number>).reduce((a, b) => a + b, 0), 0);

  it('counts every listed instance once: flagged, not flagged, couldn\'t check and excluded by reason', async () => {
    const { result } = await detect(
      [
        db('quiet-db'),
        db('conn-db'), db('cpu-db'), db('read-db'), db('write-db'),
        db('young-db', { InstanceCreateTime: new Date(WINDOW.start.getTime() + 1000) }),
        db('gappy-db'), db('forbidden-db'),
        db('modifying-db', { DBInstanceStatus: 'modifying' }),
        db('aurora-db', { Engine: 'aurora-postgresql' }),
        db('maz-db', { DBClusterIdentifier: 'placeholder-maz-cluster' }),
        db('replica-db', { ReadReplicaSourceDBInstanceIdentifier: 'placeholder-source' }),
        db('source-db', { ReadReplicaDBInstanceIdentifiers: ['placeholder-replica'] }),
        db('custom-db', { Engine: 'custom-oracle-ee' }),
        db('stopped-db', { DBInstanceStatus: 'stopped' }),
        { ...db('x'), DBInstanceIdentifier: undefined }, // no identifier: not counted
      ],
      {
        'conn-db': { connections: (h) => (h === 5 ? 1 : 0) },
        'cpu-db': { cpu: () => 50 },
        'read-db': { readIops: () => 25 },
        'write-db': { writeIops: () => 25 },
        'gappy-db': { cpu: (h) => (h === 9 ? null : 3) },
        'forbidden-db': { status: 'Forbidden' },
      }
    );
    expect(result.rdsIdle).toEqual({
      evaluated: 15,
      flagged: 1,
      not_flagged: { connections: 1, cpu_peak: 1, read_iops: 1, write_iops: 1 },
      couldnt_check: { not_available: 1, too_new: 1, cloudwatch_failed: 1, cloudwatch_incomplete: 1 },
      excluded: { aurora: 1, db_cluster_member: 1, read_replica: 1, read_replica_source: 1, rds_custom: 1, stopped: 1 },
      priced: 0,
      no_price: {
        missing_engine_or_class: 0, missing_license_model: 1, missing_deployment: 0, unknown_placement: 0, outposts: 0,
        local_zone: 0, unsupported_engine_or_license: 0, no_price_for_region: 0, no_price_for_configuration: 0,
      },
    });
    expect(total(result.rdsIdle)).toBe(result.rdsIdle.evaluated);
    expect(result.rdsIdle.flagged).toBe(result.issues.length);
    expect(Object.values(result.rdsIdle.couldnt_check).reduce((a: number, b) => a + (b as number), 0)).toBe(result.unknownResourceIds.length);
  });

  it('a failed CloudWatch call: every candidate counted as cloudwatch_failed', async () => {
    const { result } = await detect([db('a'), db('b'), db('c', { DBInstanceStatus: 'stopped' })], accessDenied());
    expect(result.rdsIdle).toMatchObject({ evaluated: 3, flagged: 0, couldnt_check: { cloudwatch_failed: 2 }, excluded: { stopped: 1 } });
  });

  it('no instances: zero counts; a failed listing: no counts (the category failed)', async () => {
    expect((await detect([])).result.rdsIdle).toMatchObject({ evaluated: 0, flagged: 0 });
    expect((await detect(accessDenied())).result.rdsIdle).toBeUndefined();
  });
});

describe('C1b: the instance-hour estimate (exact regional price x 730)', () => {
  const SUBNETS = [{ SubnetIdentifier: 'subnet-placeholder', SubnetOutpost: {} }];
  /** A DB instance as DescribeDBInstances returns it, with everything the price key and placement checks read. */
  const pricedDb = (id: string, overrides: Record<string, unknown> = {}, region = 'us-east-1') =>
    db(id, { LicenseModel: 'postgresql-license', AvailabilityZone: `${region}a`, DBSubnetGroup: { DBSubnetGroupName: 'placeholder', Subnets: SUBNETS }, ...overrides });
  const detectOne = async (instance: unknown, region = 'us-east-1') => (await detect([instance], {}, region)).result;
  afterEach(() => jest.restoreAllMocks());

  it('PostgreSQL db.t3.medium, Single-AZ, us-east-1: $0.072 x 730 = $52.56/mo, an estimate, Medium, with its price key and source', async () => {
    const result = await detectOne(pricedDb('quiet-db'));
    const [finding] = result.issues;
    expect(finding).toMatchObject({ potentialSavings: 52.56, severity: 'MEDIUM', awsRegion: 'us-east-1' });
    const m = finding.metadata;
    expect(classifySavingsBasis(m.savings_basis)).toBe('estimate');
    expect(m.savings_basis).toBe(
      'estimated: the us-east-1 on-demand list price for db.t3.medium PostgreSQL Single-AZ instance hours ($0.072/hour, 730 hours); storage, Provisioned IOPS, backups and snapshots are not included and are still billed while the instance is stopped; no reservation or discount applied; not billed cost'
    );
    expect(m).toMatchObject({
      price_per_hour: 0.072, hours_per_month: 730, price_region: 'us-east-1', price_engine: 'postgres', price_license_model: 'postgresql-license',
      price_instance_class: 'db.t3.medium', price_deployment: 'Single-AZ', price_engine_label: 'PostgreSQL',
      price_source: 'https://pricing.us-east-1.amazonaws.com/offers/v1.0/aws/AmazonRDS/current/region_index.json',
      price_version: '20261124233028', price_published: '2026-11-24T23:30:28Z',
      savings_claim: { kind: 'full_resource_cost', resource_ids: ['quiet-db'] },
      license_model: 'postgresql-license', on_outposts: false, availability_zone: 'us-east-1a', secondary_availability_zone: null,
    });
    expect(m.savings_note).toBeUndefined();
    expect(m.severity_basis).toBeUndefined();
    // Detection itself is untouched: the same description and evidence as an unpriced finding.
    expect(finding.description).toBe((await detectOne(db('quiet-db'))).issues[0].description);
    expect(m.rds_idle.days).toHaveLength(30);
  });

  it('engine is part of the key: MySQL and PostgreSQL db.m5.large differ ($124.83 vs $129.94)', async () => {
    const mysql = (await detectOne(pricedDb('my-db', { Engine: 'mysql', LicenseModel: 'general-public-license', DBInstanceClass: 'db.m5.large' }))).issues[0];
    const postgres = (await detectOne(pricedDb('pg-db', { DBInstanceClass: 'db.m5.large' }))).issues[0];
    expect(mysql.potentialSavings).toBe(124.83);
    expect(postgres.potentialSavings).toBe(129.94);
    expect(mysql.metadata.price_engine_label).toBe('MySQL');
  });

  it('deployment is part of the key: SQL Server Web db.m5.large Multi-AZ uses AWS\'s Multi-AZ price ($404.71), not 2 x Single-AZ ($227.03)', async () => {
    const web = { Engine: 'sqlserver-web', LicenseModel: 'license-included', DBInstanceClass: 'db.m5.large' };
    const single = (await detectOne(pricedDb('web-1', web))).issues[0];
    const multi = (await detectOne(pricedDb('web-2', { ...web, MultiAZ: true, SecondaryAvailabilityZone: 'us-east-1b' }))).issues[0];
    expect(single.potentialSavings).toBe(227.03);
    expect(multi.potentialSavings).toBe(404.71);
    expect(multi.potentialSavings).not.toBe(2 * single.potentialSavings);
    expect(multi.metadata).toMatchObject({ price_deployment: 'Multi-AZ', price_per_hour: 0.5544, price_engine_label: 'SQL Server Web, licence included', secondary_availability_zone: 'us-east-1b' });
  });

  it('region is part of the key: the same database in eu-west-1 is $143.81/mo', async () => {
    const [finding] = (await detectOne(pricedDb('eu-db', { DBInstanceClass: 'db.m5.large' }, 'eu-west-1'), 'eu-west-1')).issues;
    expect(finding.potentialSavings).toBe(143.81);
    expect(finding.metadata.price_region).toBe('eu-west-1');
    expect(finding.metadata.savings_basis).toContain('the eu-west-1 on-demand list price');
  });

  it('licence model is part of the key: Oracle SE2 BYOL vs licence included', async () => {
    const byol = (await detectOne(pricedDb('o-1', { Engine: 'oracle-se2', LicenseModel: 'bring-your-own-license', DBInstanceClass: 'db.m5.large' }))).issues[0];
    const li = (await detectOne(pricedDb('o-2', { Engine: 'oracle-se2', LicenseModel: 'license-included', DBInstanceClass: 'db.m5.large' }))).issues[0];
    expect([byol.potentialSavings, li.potentialSavings]).toEqual([124.83, 319.74]);
    expect([byol.metadata.price_engine_label, li.metadata.price_engine_label]).toEqual(['Oracle SE2, BYOL', 'Oracle SE2, licence included']);
  });

  it.each([
    ['db.t3.micro', 13.14, 'LOW'],
    ['db.t3.medium', 52.56, 'MEDIUM'],
    ['db.m5.large', 129.94, 'HIGH'],
  ])('severity from the estimate, by the NAT rule\'s calculateSeverity: %s $%s/mo -> %s', async (cls, monthly, severity) => {
    const spy = jest.spyOn(service, 'calculateSeverity');
    const [finding] = (await detectOne(pricedDb('sev-db', { DBInstanceClass: cls }))).issues;
    expect(finding.potentialSavings).toBe(monthly);
    expect(finding.severity).toBe(severity);
    expect(spy).toHaveBeenCalledWith(monthly);
  });

  const OUTPOST = [{ SubnetIdentifier: 'subnet-placeholder', SubnetOutpost: { Arn: 'arn:aws:outposts:us-east-1:111122223333:outpost/op-placeholder' } }];
  // C1b fix round S-1: a subnet group mixing a regional subnet and an Outposts subnet is on an Outpost (any subnet).
  const REGIONAL_SUBNET = { SubnetIdentifier: 'subnet-placeholder-regional', SubnetOutpost: {} };
  const MIXED_REGIONAL_FIRST = [REGIONAL_SUBNET, OUTPOST[0]];
  const MIXED_OUTPOST_FIRST = [OUTPOST[0], REGIONAL_SUBNET];
  it.each([
    ['no licence model returned', 'missing_license_model', { LicenseModel: undefined }],
    ['no MultiAZ returned', 'missing_deployment', { MultiAZ: undefined }],
    ['no engine returned', 'missing_engine_or_class', { Engine: undefined }],
    ['no class returned', 'missing_engine_or_class', { DBInstanceClass: undefined }],
    ['on an Outpost', 'outposts', { DBSubnetGroup: { Subnets: OUTPOST } }],
    ['S-1: a subnet group mixing a regional and an Outposts subnet (regional listed first)', 'outposts', { DBSubnetGroup: { Subnets: MIXED_REGIONAL_FIRST } }],
    ['S-1: a subnet group mixing an Outposts and a regional subnet (Outposts listed first)', 'outposts', { DBSubnetGroup: { Subnets: MIXED_OUTPOST_FIRST } }],
    ['no subnets returned (placement unknown)', 'unknown_placement', { DBSubnetGroup: undefined }],
    ['no Availability Zone returned', 'unknown_placement', { AvailabilityZone: undefined }],
    ['in a Local Zone', 'local_zone', { AvailabilityZone: 'us-east-1-bos-1a' }],
    ['a Multi-AZ standby in a Local Zone', 'local_zone', { MultiAZ: true, SecondaryAvailabilityZone: 'us-east-1-bos-1a' }],
    ['an Availability Zone of another region', 'local_zone', { AvailabilityZone: 'us-east-2a' }],
    ['Oracle EE CDB (Q4)', 'unsupported_engine_or_license', { Engine: 'oracle-ee-cdb', LicenseModel: 'bring-your-own-license' }],
    ['SQL Server Developer (Q4)', 'unsupported_engine_or_license', { Engine: 'sqlserver-dev-ee', LicenseModel: 'bring-your-own-media' }],
    ['Db2 marketplace (Q4)', 'unsupported_engine_or_license', { Engine: 'db2-se', LicenseModel: 'marketplace-license' }],
    ['an unknown licence model for a priced engine', 'unsupported_engine_or_license', { LicenseModel: 'general-public-license' }],
    ['a class the table does not have', 'no_price_for_configuration', { DBInstanceClass: 'db.z9.huge' }],
    ['a deployment AWS does not publish (SQL Server Express Multi-AZ)', 'no_price_for_configuration', { Engine: 'sqlserver-ex', LicenseModel: 'license-included', DBInstanceClass: 'db.t3.micro', MultiAZ: true }],
  ])('%s: no dollar estimate (0, no basis), fixed Low, reason %s -- never $0 as a figure, no fallback price', async (_label, note, overrides) => {
    const spy = jest.spyOn(service, 'calculateSeverity');
    const [finding] = (await detectOne(pricedDb('nope-db', overrides))).issues;
    expect(finding.potentialSavings).toBe(0);
    expect(finding.severity).toBe('LOW');
    expect(finding.metadata.savings_basis).toBeUndefined();
    expect(finding.metadata.price_per_hour).toBeUndefined();
    expect(finding.metadata.savings_note).toBe(note);
    expect(finding.metadata.severity_basis).toBe('fixed_low_unknown_price');
    expect(classifySavingsBasis(finding.metadata.savings_basis)).toBeNull();
    expect(spy).not.toHaveBeenCalled();
  });

  it.each([
    ['regional listed first', MIXED_REGIONAL_FIRST],
    ['Outposts listed first', MIXED_OUTPOST_FIRST],
  ])('S-1: a mixed subnet group (%s) is recorded as on an Outpost: on_outposts true, reason outposts, no price fields', async (_label, subnets) => {
    const [finding] = (await detectOne(pricedDb('mixed-db', { DBSubnetGroup: { DBSubnetGroupName: 'placeholder', Subnets: subnets } }))).issues;
    expect(finding.metadata).toMatchObject({ on_outposts: true, availability_zone: 'us-east-1a', savings_note: 'outposts' });
    expect(finding.potentialSavings).toBe(0);
    expect(finding.metadata.price_region).toBeUndefined();
  });

  it.each(['us-gov-west-1', 'xx-nowhere-1'])('home region %s (not in the table): no_price_for_region, never another region\'s price', async (region) => {
    const [finding] = (await detectOne(pricedDb('far-db', {}, region), region)).issues;
    expect(finding).toMatchObject({ potentialSavings: 0, severity: 'LOW' });
    expect(finding.metadata.savings_note).toBe('no_price_for_region');
  });

  it('the run\'s counts: flagged = priced + no_price by reason; counts only, no instance IDs', async () => {
    const { result } = await detect([
      pricedDb('priced-1'),
      pricedDb('priced-2', { DBInstanceClass: 'db.m5.large', MultiAZ: true }),
      pricedDb('cdb-db', { Engine: 'oracle-ee-cdb', LicenseModel: 'bring-your-own-license' }),
      pricedDb('outpost-db', { DBSubnetGroup: { Subnets: OUTPOST } }),
      db('legacy-shape-db'), // no LicenseModel or placement in the response
      pricedDb('busy-db'),
    ], { 'busy-db': { cpu: () => 50 } });
    expect(result.rdsIdle).toMatchObject({
      evaluated: 6, flagged: 5, priced: 2,
      no_price: {
        missing_engine_or_class: 0, missing_license_model: 1, missing_deployment: 0, unknown_placement: 0, outposts: 1,
        local_zone: 0, unsupported_engine_or_license: 1, no_price_for_region: 0, no_price_for_configuration: 0,
      },
    });
    const noPrice = Object.values(result.rdsIdle.no_price as Record<string, number>).reduce((a, b) => a + b, 0);
    expect(result.rdsIdle.priced + noPrice).toBe(result.rdsIdle.flagged);
    expect(JSON.stringify(result.rdsIdle)).not.toMatch(/priced-1|priced-2|cdb-db|outpost-db|legacy-shape-db|busy-db|placeholder/);
  });

  it('aggregate totals: priced findings add to the firm estimate (never the upper bound); unpriced ones are unestimated, not $0', async () => {
    const { result } = await detect([pricedDb('priced-1'), pricedDb('priced-2', { DBInstanceClass: 'db.m5.large' }), db('legacy-shape-db')]);
    const recs = result.issues.map((i: any) => ({ resource_type: i.resourceType, potential_savings: i.potentialSavings, metadata: i.metadata }));
    expect(aggregateEstimatedSavings(recs)).toEqual({ total: 182.5, byResourceType: { RDS: 182.5 }, ceilingTotal: 0, ceilingByResourceType: {} });
    expect(countSavingsFindings(recs)).toEqual({ estimatedFindings: 2, ceilingFindings: 0, unestimatedFindings: 1 });
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
    const rdsCounts = { evaluated: 1, flagged: 0, not_flagged: {}, couldnt_check: { cloudwatch_failed: 1 }, excluded: {} };
    const snapshotCounts = { evaluated: 1, flagged: 0, not_flagged: {}, couldnt_check: { ami_unreadable: 1 }, excluded: {} };
    const rds = jest.spyOn(service, 'detectIdleRDSInstances').mockResolvedValue({ success: true, issues: [], unknownResourceIds: ['placeholder-db-1'], endActiveForUnknown: true, rdsIdle: rdsCounts });
    const snaps = jest.spyOn(service, 'detectOldEBSSnapshots').mockResolvedValue({ success: true, issues: [], unknownResourceIds: ['snap-0000000000000001'], oldSnapshots: snapshotCounts });

    const analysis = await costOptimizationService.analyzeAllResources('org-c1-wiring');

    expect(analysis.homeRegion).toBe('eu-west-1');
    expect(rds.mock.calls[0][1]).toBe('eu-west-1');
    expect(snaps.mock.calls[0][1]).toBe('eu-west-1');
    expect(analysis.observations.find((o) => o.issue === ISSUE_RDS_IDLE_INSTANCE)).toEqual({
      issue: ISSUE_RDS_IDLE_INSTANCE, success: true, recommendations: [], unknownResourceIds: ['placeholder-db-1'], endActiveForUnknown: true, rdsIdle: rdsCounts,
    });
    expect(analysis.observations.find((o) => o.issue === ISSUE_EBS_OLD_SNAPSHOT)).toEqual({
      issue: ISSUE_EBS_OLD_SNAPSHOT, success: true, recommendations: [], unknownResourceIds: ['snap-0000000000000001'], oldSnapshots: snapshotCounts,
    });
  });
});
