/**
 * C3a: the unused CloudWatch log group detector (config/cloudwatch-logs-unused-rule.ts,
 * cloudwatch-logs-unused-evaluation.ts) against fake DescribeLogGroups,
 * DescribeLogStreams and GetMetricData answers. No network. Every name is an
 * invented placeholder (the repo is public): no real account IDs, ARNs,
 * log group names or emails.
 *
 * Covers: an unused group; the floor (floor - 1, floor, floor + 1 bytes) and the
 * below-floor summary counts; Delivery class; missing storedBytes / creation
 * time; age (inside the window, at its start); names over 255 characters
 * (ruling D10); the metric (activity, zeros, empty, failed / partial / throttled
 * / denied, whole-call failure, activity winning on a failed read); the newest
 * stream (ruling D5: recent event, recent ingestion, missing time, no streams,
 * denied, throttled); listing failures and paging; no dollar figure, fixed Low
 * (rulings D3/D4); the description and evidence; no "$" in any C3 string;
 * attribution and home-region wiring; the run's counts.
 */
import costOptimizationService from '../cost-optimization.service';
import { AWSClientFactory } from '../aws-client-factory.service';
import { OptimizationRuleConfigService } from '../optimization-rule-config.service';
import { logGroupUnusedDescription, logGroupUnusedWindow } from '../cloudwatch-logs-unused-evaluation';
import { CLOUDWATCH_LOGS_UNUSED_RULE } from '../../config/cloudwatch-logs-unused-rule';
import { BYTES_PER_GB, CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES } from '../../config/cloudwatch-logs-size';
import { ISSUE_CLOUDWATCH_LOG_GROUP_UNUSED, OPTIMIZATION_RULES } from '../../config/optimization-rules';
import { classifySavingsBasis } from '../estimated-savings';
import { summarizeDetectors } from '../cost-analysis-outcome';
import { fakeClient, accessDenied } from './helpers/low-activity-aws';

const service = costOptimizationService as any;
const DAY = 24 * 3_600_000;
const NOW = new Date('2026-11-26T12:00:00.000Z');
const WINDOW = logGroupUnusedWindow(NOW);
const OLD = WINDOW.start.getTime() - 30 * DAY;
const BEFORE = WINDOW.start.getTime() - 5 * DAY;
const FLOOR = CLOUDWATCH_LOGS_UNUSED_FLOOR_BYTES;
const BIG = 100 * BYTES_PER_GB;

function throttled(): Error {
  const error = new Error('slow down');
  error.name = 'ThrottlingException';
  return error;
}

function group(name: string, overrides: Record<string, unknown> = {}) {
  return { logGroupName: name, creationTime: OLD, storedBytes: BIG, logGroupClass: 'STANDARD', retentionInDays: 30, ...overrides };
}

type StreamAnswer = Array<{ lastEventTimestamp?: number; lastIngestionTime?: number }> | Error;
type GroupsAnswer = unknown[] | Error | 'incomplete' | { pages: unknown[][] };

function fakeLogs(groups: GroupsAnswer, streams: Record<string, StreamAnswer> = {}) {
  return fakeClient((command: any) => {
    const name = command.constructor.name;
    if (name === 'DescribeLogGroupsCommand') {
      expect(command.input.logGroupNamePattern).toBeUndefined();
      expect(command.input.logGroupNamePrefix).toBeUndefined();
      if (groups instanceof Error) throw groups;
      if (groups === 'incomplete') return { logGroups: [], nextToken: 'always-more' };
      if (!Array.isArray(groups)) {
        const index = command.input.nextToken ? Number(command.input.nextToken) : 0;
        return { logGroups: groups.pages[index], ...(index + 1 < groups.pages.length ? { nextToken: String(index + 1) } : {}) };
      }
      return { logGroups: groups };
    }
    if (name === 'DescribeLogStreamsCommand') {
      expect(command.input).toMatchObject({ orderBy: 'LastEventTime', descending: true, limit: 1 });
      const answer = streams[command.input.logGroupName] ?? [{ lastEventTimestamp: BEFORE, lastIngestionTime: BEFORE }];
      if (answer instanceof Error) throw answer;
      return { logStreams: answer };
    }
    throw new Error(`unexpected ${name}`);
  });
}

interface FakeIncoming {
  /** Daily values (null: no datapoint); default: no datapoints at all (an empty series). */
  daily?: (day: number) => number | null;
  status?: 'Complete' | 'PartialData' | 'Forbidden' | 'InternalError';
}

function fakeCloudWatch(byGroup: Record<string, FakeIncoming> | Error) {
  return fakeClient((command: any) => {
    if (byGroup instanceof Error) throw byGroup;
    for (const q of command.input.MetricDataQueries as any[]) {
      expect(q.MetricStat).toMatchObject({ Metric: { Namespace: 'AWS/Logs', MetricName: 'IncomingBytes' }, Period: 86400, Stat: 'Sum' });
      expect(q.MetricStat.Metric.Dimensions).toHaveLength(1);
      expect(q.MetricStat.Metric.Dimensions[0].Name).toBe('LogGroupName');
    }
    expect(command.input.StartTime).toEqual(WINDOW.start);
    expect(command.input.EndTime).toEqual(WINDOW.end);
    const results = (command.input.MetricDataQueries as any[]).map((q) => {
      const name = q.MetricStat.Metric.Dimensions[0].Value as string;
      const spec = byGroup[name] ?? {};
      const Timestamps: Date[] = [];
      const Values: number[] = [];
      if (spec.daily) {
        for (let d = 0; d < CLOUDWATCH_LOGS_UNUSED_RULE.window.days; d++) {
          const v = spec.daily(d);
          if (v === null) continue;
          Timestamps.push(new Date(WINDOW.start.getTime() + d * DAY));
          Values.push(v);
        }
      }
      return { Id: q.Id, Timestamps, Values, StatusCode: spec.status ?? 'Complete' };
    });
    return { MetricDataResults: results };
  });
}

async function detect(groups: GroupsAnswer, options: { metrics?: Record<string, FakeIncoming> | Error; streams?: Record<string, StreamAnswer>; region?: string } = {}) {
  const cloudWatchLogs = fakeLogs(groups, options.streams ?? {});
  const cloudWatch = fakeCloudWatch(options.metrics ?? {});
  const result = await service.detectUnusedLogGroups({ cloudWatchLogs, cloudWatch }, options.region ?? 'us-east-1', NOW);
  return { result, cloudWatchLogs, cloudWatch };
}

const names = (result: any) => result.issues.map((i: any) => i.resourceId);
const sumCounts = (c: any) =>
  c.flagged + c.below_floor.count +
  [c.not_flagged, c.couldnt_check, c.excluded, c.skipped].reduce((sum: number, bucket: Record<string, number>) => sum + Object.values(bucket).reduce((a, b) => a + b, 0), 0);

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('unused log group: the finding', () => {
  it('flags a big, old group with no ingestion in the metric and an old newest stream; no dollar figure, fixed Low', async () => {
    const { result, cloudWatchLogs, cloudWatch } = await detect([group('/placeholder/app-unused')]);
    expect(result.success).toBe(true);
    expect(names(result)).toEqual(['/placeholder/app-unused']);
    const [issue] = result.issues;
    expect(issue).toMatchObject({
      resourceId: '/placeholder/app-unused',
      resourceName: '/placeholder/app-unused',
      resourceType: 'CloudWatch',
      issue: ISSUE_CLOUDWATCH_LOG_GROUP_UNUSED,
      potentialSavings: 0,
      severity: 'LOW',
      awsRegion: 'us-east-1',
    });
    expect(issue.metadata.savings_basis).toBeUndefined();
    expect(classifySavingsBasis(issue.metadata.savings_basis)).toBeNull();
    expect(issue.metadata).toMatchObject({ savings_note: 'stored_size_billing_basis_unconfirmed', severity_basis: 'fixed_low_unknown_price', rule_version: 1 });
    expect(issue.metadata.rule).toEqual(JSON.parse(JSON.stringify(CLOUDWATCH_LOGS_UNUSED_RULE)));
    expect(issue.metadata.cloudwatch_logs_unused).toEqual({
      evaluated_at: NOW.toISOString(),
      window_start: WINDOW.start.toISOString(),
      window_end: WINDOW.end.toISOString(),
      creation_time: new Date(OLD).toISOString(),
      stored_bytes: BIG,
      stored_gb: '100.0',
      stored_bytes_source: 'DescribeLogGroups.storedBytes',
      floor_bytes: FLOOR,
      incoming_bytes: { namespace: 'AWS/Logs', metric: 'IncomingBytes', stat: 'Sum', period_seconds: 86400, days: 90, observed: 'empty' },
      newest_stream: { last_event_time: new Date(BEFORE).toISOString(), last_ingestion_time: new Date(BEFORE).toISOString() },
      retention_in_days: 30,
      never_expire: false,
      deletion_protection: null,
      log_group_class: 'STANDARD',
    });
    expect(issue.description).toBe(
      'No new log events reached this log group in the last 90 days, and its newest log stream was last written before then. ' +
      'AWS reports that it still stores 100.0 GB. Check that nothing writes to it only rarely, such as a yearly job or a recovery runbook. ' +
      'If you might need its contents, export them to Amazon S3 before deleting it.'
    );
    expect(cloudWatchLogs.count('DescribeLogGroupsCommand')).toBe(1);
    expect(cloudWatchLogs.count('DescribeLogStreamsCommand')).toBe(1);
    expect(cloudWatch.count('GetMetricDataCommand')).toBe(1);
  });

  it('adds the never-expire and deletion-protection sentences when they apply', async () => {
    const { result } = await detect([group('/placeholder/forever', { retentionInDays: undefined, deletionProtectionEnabled: true })]);
    expect(result.issues[0].description).toMatch(/before deleting it\. It is set to keep logs forever\. Deletion protection is on: turn it off before deleting\.$/);
    expect(result.issues[0].metadata.cloudwatch_logs_unused).toMatchObject({ retention_in_days: null, never_expire: true, deletion_protection: true });
  });

  it('only zeros in the metric are no ingestion too (the stream still decides)', async () => {
    const { result } = await detect([group('/placeholder/zeros')], { metrics: { '/placeholder/zeros': { daily: () => 0 } } });
    expect(names(result)).toEqual(['/placeholder/zeros']);
    expect(result.issues[0].metadata.cloudwatch_logs_unused.incoming_bytes.observed).toBe('zeros');
  });
});

describe('unused log group: the floor (ruling D9) and the below-floor summary', () => {
  it.each([
    [FLOOR - 1, false],
    [FLOOR, true],
    [FLOOR + 1, true],
  ])('storedBytes %s -> listed: %s', async (bytes, listed) => {
    const { result, cloudWatch, cloudWatchLogs } = await detect([group('/placeholder/edge', { storedBytes: bytes })]);
    expect(names(result)).toEqual(listed ? ['/placeholder/edge'] : []);
    expect(result.cloudwatchLogsUnused.below_floor.count).toBe(listed ? 0 : 1);
    if (!listed) {
      // Below the floor: never evaluated for use, never couldn't-check.
      expect(cloudWatch.count('GetMetricDataCommand')).toBe(0);
      expect(cloudWatchLogs.count('DescribeLogStreamsCommand')).toBe(0);
      expect(result.unknownResourceIds).toEqual([]);
    }
  });

  it('a small account (about 17 MB in all) produces no finding, only the below-floor counts', async () => {
    const groups = [group('/placeholder/a', { storedBytes: 17_000_000 }), group('/placeholder/b', { storedBytes: 1_680 }), group('/placeholder/c', { storedBytes: 0 })];
    const { result, cloudWatch } = await detect(groups);
    expect(result.issues).toEqual([]);
    expect(result.cloudwatchLogsUnused.below_floor).toEqual({ count: 3, stored_bytes: 17_001_680, floor_bytes: FLOOR, floor_gb: '35.7' });
    expect(cloudWatch.count('GetMetricDataCommand')).toBe(0);
  });
});

describe('unused log group: scope', () => {
  it('excludes Delivery-class groups and groups created inside the window; evaluates any other class', async () => {
    const { result } = await detect([
      group('/placeholder/delivery', { logGroupClass: 'DELIVERY' }),
      group('/placeholder/young', { creationTime: WINDOW.start.getTime() + 1 }),
      group('/placeholder/at-start', { creationTime: WINDOW.start.getTime() }),
      group('/placeholder/essentials', { logGroupClass: 'ESSENTIALS' }),
      group('/placeholder/ia', { logGroupClass: 'INFREQUENT_ACCESS' }),
    ]);
    expect(names(result).sort()).toEqual(['/placeholder/at-start', '/placeholder/essentials', '/placeholder/ia']);
    expect(result.cloudwatchLogsUnused.excluded).toEqual({ delivery_class: 1, too_new: 1 });
  });

  it('missing storedBytes or creation time: couldn\'t check, never unused', async () => {
    const { result, cloudWatch } = await detect([
      group('/placeholder/no-size', { storedBytes: undefined }),
      group('/placeholder/bad-size', { storedBytes: -5 }),
      group('/placeholder/no-created', { creationTime: undefined }),
    ]);
    expect(result.issues).toEqual([]);
    expect(result.cloudwatchLogsUnused.couldnt_check).toMatchObject({ no_stored_bytes: 2, no_creation_time: 1 });
    expect(result.unknownResourceIds.sort()).toEqual(['/placeholder/bad-size', '/placeholder/no-created', '/placeholder/no-size']);
    expect(cloudWatch.count('GetMetricDataCommand')).toBe(0);
  });

  it('a name over 255 characters is skipped and counted (ruling D10), and counts as not checked in the run', async () => {
    const long = `/placeholder/${'x'.repeat(243)}`; // 256 characters
    const exact = `/placeholder/${'y'.repeat(242)}`; // 255 characters
    expect(long).toHaveLength(256);
    expect(exact).toHaveLength(255);
    const { result, cloudWatch } = await detect([group(long), group(exact)]);
    expect(names(result)).toEqual([exact]);
    expect(result.cloudwatchLogsUnused.skipped).toEqual({ name_too_long: 1 });
    expect(result.unknownResourceIds).toEqual([long]);
    const queried = (cloudWatch.send.mock.calls[0][0] as any).input.MetricDataQueries.map((q: any) => q.MetricStat.Metric.Dimensions[0].Value);
    expect(queried).toEqual([exact]);
    const check = summarizeDetectors([{ issue: ISSUE_CLOUDWATCH_LOG_GROUP_UNUSED, success: true, recommendations: [], unknownResourceIds: result.unknownResourceIds, cloudwatchLogsUnused: result.cloudwatchLogsUnused }], true, []).checks[0];
    expect(check).toMatchObject({ rule_id: 'cloudwatch_unused_logs', outcome: 'complete', unknown: 1 });
    expect(check.cloudwatch_logs_unused!.skipped.name_too_long).toBe(1);
    expect(JSON.stringify(check)).not.toContain('placeholder');
  });

  it('a group with no name is ignored entirely', async () => {
    const { result } = await detect([{ storedBytes: BIG, creationTime: OLD }, group('/placeholder/ok')]);
    expect(result.cloudwatchLogsUnused.evaluated).toBe(1);
  });
});

describe('unused log group: the IncomingBytes metric', () => {
  it('any datapoint above 0 in the window: not unused, and the stream is not read', async () => {
    const { result, cloudWatchLogs } = await detect([group('/placeholder/busy')], { metrics: { '/placeholder/busy': { daily: (d) => (d === 89 ? 12 : null) } } });
    expect(result.issues).toEqual([]);
    expect(result.cloudwatchLogsUnused.not_flagged.ingested_metric).toBe(1);
    expect(cloudWatchLogs.count('DescribeLogStreamsCommand')).toBe(0);
  });

  it('activity wins even on a partial read', async () => {
    const { result } = await detect([group('/placeholder/busy-partial')], { metrics: { '/placeholder/busy-partial': { daily: () => 5, status: 'PartialData' } } });
    expect(result.cloudwatchLogsUnused.not_flagged.ingested_metric).toBe(1);
    expect(result.unknownResourceIds).toEqual([]);
  });

  it.each(['PartialData', 'Forbidden', 'InternalError'] as const)('a %s read with no activity: couldn\'t check, never unused', async (status) => {
    const { result, cloudWatchLogs } = await detect([group('/placeholder/gap')], { metrics: { '/placeholder/gap': { daily: () => 0, status } } });
    expect(result.issues).toEqual([]);
    expect(result.cloudwatchLogsUnused.couldnt_check.cloudwatch_failed).toBe(1);
    expect(result.unknownResourceIds).toEqual(['/placeholder/gap']);
    expect(cloudWatchLogs.count('DescribeLogStreamsCommand')).toBe(0);
  });

  it.each([['AccessDenied', accessDenied], ['throttling', throttled]] as const)('%s on GetMetricData: every candidate couldn\'t check', async (_label, makeError) => {
    const { result } = await detect([group('/placeholder/a'), group('/placeholder/b')], { metrics: makeError() });
    expect(result.success).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.cloudwatchLogsUnused.couldnt_check.cloudwatch_failed).toBe(2);
    expect(result.unknownResourceIds.sort()).toEqual(['/placeholder/a', '/placeholder/b']);
  });
});

describe('unused log group: the newest stream (ruling D5, required)', () => {
  it('empty metric but a recent event: not unused', async () => {
    const { result } = await detect([group('/placeholder/recent')], { streams: { '/placeholder/recent': [{ lastEventTimestamp: WINDOW.start.getTime() + DAY, lastIngestionTime: BEFORE }] } });
    expect(result.issues).toEqual([]);
    expect(result.cloudwatchLogsUnused.not_flagged.ingested_stream).toBe(1);
  });

  it('empty metric but a recent ingestion (an old event ingested late): not unused', async () => {
    const { result } = await detect([group('/placeholder/late')], { streams: { '/placeholder/late': [{ lastEventTimestamp: BEFORE, lastIngestionTime: WINDOW.start.getTime() }] } });
    expect(result.issues).toEqual([]);
    expect(result.cloudwatchLogsUnused.not_flagged.ingested_stream).toBe(1);
  });

  it('no streams: couldn\'t check', async () => {
    const { result } = await detect([group('/placeholder/no-streams')], { streams: { '/placeholder/no-streams': [] } });
    expect(result.issues).toEqual([]);
    expect(result.cloudwatchLogsUnused.couldnt_check.no_streams).toBe(1);
    expect(result.unknownResourceIds).toEqual(['/placeholder/no-streams']);
  });

  it.each([
    [{ lastEventTimestamp: BEFORE }],
    [{ lastIngestionTime: BEFORE }],
    [{}],
  ])('a stream without both times (%o): couldn\'t check', async (stream) => {
    const { result } = await detect([group('/placeholder/partial-stream')], { streams: { '/placeholder/partial-stream': [stream] } });
    expect(result.issues).toEqual([]);
    expect(result.cloudwatchLogsUnused.couldnt_check.stream_incomplete).toBe(1);
  });

  it.each([['AccessDenied', accessDenied], ['throttling', throttled]] as const)('%s on DescribeLogStreams: couldn\'t check, others unaffected', async (_label, makeError) => {
    const { result } = await detect([group('/placeholder/denied'), group('/placeholder/fine')], { streams: { '/placeholder/denied': makeError() } });
    expect(names(result)).toEqual(['/placeholder/fine']);
    expect(result.cloudwatchLogsUnused.couldnt_check.stream_failed).toBe(1);
    expect(result.unknownResourceIds).toEqual(['/placeholder/denied']);
  });
});

describe('unused log group: listing', () => {
  it.each([['AccessDenied', accessDenied, 'permissions'], ['throttling', throttled, 'rate_limited']] as const)('%s on DescribeLogGroups: the check fails with its class, nothing is concluded', async (_label, makeError, reason) => {
    const { result, cloudWatch } = await detect(makeError());
    expect(result).toEqual({ success: false, issues: [], failureReason: reason });
    expect(cloudWatch.count('GetMetricDataCommand')).toBe(0);
  });

  it('an incomplete listing (page cap) fails the check as too many resources', async () => {
    const { result, cloudWatchLogs } = await detect('incomplete');
    expect(result).toEqual({ success: false, issues: [], failureReason: 'too_many_resources' });
    expect(cloudWatchLogs.count('DescribeLogGroupsCommand')).toBe(200);
  });

  it('reads every page, 50 a page', async () => {
    const { result, cloudWatchLogs } = await detect({ pages: [[group('/placeholder/p1')], [group('/placeholder/p2')]] });
    expect(names(result).sort()).toEqual(['/placeholder/p1', '/placeholder/p2']);
    expect(cloudWatchLogs.count('DescribeLogGroupsCommand')).toBe(2);
    expect((cloudWatchLogs.send.mock.calls[0][0] as any).input.limit).toBe(50);
  });

  it('no CloudWatch Logs client: the check fails, never "nothing found"', async () => {
    const result = await service.detectUnusedLogGroups({ cloudWatch: fakeCloudWatch({}) }, 'us-east-1', NOW);
    expect(result).toEqual({ success: false, issues: [], failureReason: 'error' });
  });

  it('an empty region: a complete check with nothing found', async () => {
    const { result } = await detect([]);
    expect(result).toMatchObject({ success: true, issues: [], unknownResourceIds: [], endActiveForUnknown: true });
  });
});

describe('unused log group: the run\'s counts', () => {
  it('counts every named group exactly once, with no names', async () => {
    const { result } = await detect([
      group('/placeholder/unused'),
      group('/placeholder/small', { storedBytes: 10 }),
      group('/placeholder/busy'),
      group('/placeholder/recent'),
      group('/placeholder/delivery', { logGroupClass: 'DELIVERY' }),
      group('/placeholder/no-streams'),
      group(`/placeholder/${'z'.repeat(250)}`),
    ], {
      metrics: { '/placeholder/busy': { daily: () => 1 } },
      streams: { '/placeholder/recent': [{ lastEventTimestamp: NOW.getTime() - DAY, lastIngestionTime: NOW.getTime() - DAY }], '/placeholder/no-streams': [] },
    });
    const counts = result.cloudwatchLogsUnused;
    expect(counts).toEqual({
      evaluated: 7,
      flagged: 1,
      below_floor: { count: 1, stored_bytes: 10, floor_bytes: FLOOR, floor_gb: '35.7' },
      not_flagged: { ingested_metric: 1, ingested_stream: 1 },
      couldnt_check: { no_stored_bytes: 0, no_creation_time: 0, cloudwatch_failed: 0, no_streams: 1, stream_incomplete: 0, stream_failed: 0 },
      excluded: { delivery_class: 1, too_new: 0 },
      skipped: { name_too_long: 1 },
    });
    expect(sumCounts(counts)).toBe(counts.evaluated);
    expect(JSON.stringify(counts)).not.toContain('placeholder');
  });
});

describe('C3 customer-facing strings: no dollar amount (binding condition 1)', () => {
  it('no "$" or dollar figure in the description variants, the catalog name or detail', () => {
    const strings = [
      logGroupUnusedDescription({ storedBytes: FLOOR, neverExpire: false, deletionProtection: false }),
      logGroupUnusedDescription({ storedBytes: 5000 * BYTES_PER_GB, neverExpire: true, deletionProtection: true }),
      ...OPTIMIZATION_RULES.filter((r) => r.service === 'CloudWatch').flatMap((r) => [r.name, r.detail]),
      ISSUE_CLOUDWATCH_LOG_GROUP_UNUSED,
    ];
    for (const s of strings) {
      expect({ s, ok: !/\$|\bUSD\b|dollar(?! estimate)|per month|\/mo\b/i.test(s) }).toEqual({ s, ok: true });
    }
  });
});

describe('C3a wiring in analyzeAllResources', () => {
  const OTHER_DETECTORS = [
    'detectLowActivityEC2Instances', 'detectUnusedElasticIPs', 'detectUnattachedEBSVolumes', 'detectGp2ToGp3Migrations',
    'detectS3LifecycleOptimization', 'detectLowUsageLambdaFunctions', 'detectDynamoDBCapacityOptimization',
    'detectDynamoDBOnDemandVsProvisionedOptimization', 'detectReservedInstanceOpportunities', 'detectIdleRDSInstances', 'detectOldEBSSnapshots',
    'detectIdleNatGateways',
  ];
  function stubOthers() {
    const clients = { enabled: true, region: 'eu-west-1', ec2: {}, rds: {}, s3: {}, lambda: {}, cloudWatch: {}, cloudWatchLogs: {}, backup: {} };
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue(clients as any);
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockResolvedValue({ ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default' } as any);
    for (const detector of OTHER_DETECTORS) jest.spyOn(service, detector).mockResolvedValue({ success: true, issues: [] });
  }

  it('runs on the home-region clients; its observation carries endActiveForUnknown and the counts', async () => {
    stubOthers();
    const counts = { evaluated: 1, flagged: 0 };
    const spy = jest.spyOn(service, 'detectUnusedLogGroups').mockResolvedValue({ success: true, issues: [], unknownResourceIds: ['/placeholder/x'], endActiveForUnknown: true, cloudwatchLogsUnused: counts });
    const analysis = await costOptimizationService.analyzeAllResources('org-c3a-wiring');
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0][1]).toBe('eu-west-1');
    expect((spy.mock.calls[0][0] as any).region).toBe('eu-west-1');
    expect(analysis.observations.find((o) => o.issue === ISSUE_CLOUDWATCH_LOG_GROUP_UNUSED)).toEqual({
      issue: ISSUE_CLOUDWATCH_LOG_GROUP_UNUSED, success: true, recommendations: [], unknownResourceIds: ['/placeholder/x'], endActiveForUnknown: true, cloudwatchLogsUnused: counts,
    });
  });

  it('a finding reaches reconciliation with no dollar figure and Low severity; the run records its counts', async () => {
    stubOthers();
    const real = service.detectUnusedLogGroups.bind(service);
    jest.spyOn(service, 'detectUnusedLogGroups').mockImplementation((_clients: any, region: any) =>
      real({ cloudWatchLogs: fakeLogs([group('/placeholder/app-unused')]), cloudWatch: fakeCloudWatch({}) }, region, NOW));
    const analysis = await costOptimizationService.analyzeAllResources('org-c3a-wiring');
    const observation = analysis.observations.find((o) => o.issue === ISSUE_CLOUDWATCH_LOG_GROUP_UNUSED)!;
    expect(observation.recommendations).toHaveLength(1);
    expect(observation.recommendations[0]).toMatchObject({
      resource_id: '/placeholder/app-unused', resource_type: 'CloudWatch', issue: ISSUE_CLOUDWATCH_LOG_GROUP_UNUSED, aws_region: 'eu-west-1', potential_savings: 0, severity: 'LOW',
    });
    const check = summarizeDetectors(analysis.observations, true, []).checks.find((c) => c.issue === ISSUE_CLOUDWATCH_LOG_GROUP_UNUSED)!;
    expect(check).toMatchObject({ rule_id: 'cloudwatch_unused_logs', outcome: 'complete', detected: 1, unknown: 0 });
    expect(check.cloudwatch_logs_unused).toMatchObject({ evaluated: 1, flagged: 1 });
  });

  it('a failed listing carries its failure class to the run record, never counts', async () => {
    stubOthers();
    const real = service.detectUnusedLogGroups.bind(service);
    jest.spyOn(service, 'detectUnusedLogGroups').mockImplementation((_clients: any, region: any) =>
      real({ cloudWatchLogs: fakeLogs(accessDenied()), cloudWatch: fakeCloudWatch({}) }, region, NOW));
    const analysis = await costOptimizationService.analyzeAllResources('org-c3a-wiring');
    const check = summarizeDetectors(analysis.observations, true, []).checks.find((c) => c.issue === ISSUE_CLOUDWATCH_LOG_GROUP_UNUSED)!;
    expect(check).toMatchObject({ rule_id: 'cloudwatch_unused_logs', outcome: 'failed', failure_reason: 'permissions' });
    expect(check).not.toHaveProperty('cloudwatch_logs_unused');
  });
});
