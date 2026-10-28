/**
 * CloudWatch alarms for the Observability page (cloudwatch-alarms.service.ts).
 *
 * pool.query (the aws_accounts read), AWSClientFactory.createClients and
 * assumedRoleSourceOf are mocked; each account gets a fake CloudWatch client
 * that only answers DescribeAlarms, paging its fixture alarms. No database,
 * AWS or network.
 */
import { DescribeAlarmsCommand, type CompositeAlarm, type MetricAlarm } from '@aws-sdk/client-cloudwatch';

jest.mock('../../config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../aws-client-factory.service', () => ({
  AWSClientFactory: { createClients: jest.fn() },
  assumedRoleSourceOf: jest.fn(),
}));

import { pool } from '../../config/database';
import { AWSClientFactory, assumedRoleSourceOf } from '../aws-client-factory.service';
import { AwsAccountNotConnectedError, type AwsAccountRow } from '../../repositories/aws-accounts.repository';
import { DEFAULT_AWS_CALL_POLICY, type AwsCallPolicy } from '../../utils/awsCallPolicy';
import {
  ALARMS_CACHE_TTL_MS,
  CONFIGURED_MAX_PAGES,
  IN_ALARM_MAX_PAGES,
  CloudWatchAlarmsService,
  alarmResource,
  type AlarmsResult,
} from '../cloudwatch-alarms.service';
import { projectMetricAlarm } from '../aws-response-projections';

const ORG_A = '00000000-0000-4000-8000-00000000000a';
const ORG_B = '00000000-0000-4000-8000-00000000000b';
const ACCOUNT_A = '111122223333';
const ACCOUNT_B = '444455556666';
const ACCOUNT_C = '123456789012';
const T0 = Date.parse('2026-10-28T12:00:00.000Z');
const TRANSITIONED = new Date('2026-10-27T08:00:00.000Z');
const UPDATED = new Date('2026-10-28T09:30:00.000Z');

const query = pool.query as unknown as jest.Mock;
const createClients = AWSClientFactory.createClients as unknown as jest.Mock;
const sourceOf = assumedRoleSourceOf as unknown as jest.Mock;

// ── Fixtures ─────────────────────────────

const accountRow = (id: string, orgId: string, accountId: string | null, region: string | null = 'us-east-1'): AwsAccountRow => ({
  id,
  org_id: orgId,
  account_id: accountId,
  role_arn: `arn:aws:iam::${accountId ?? ACCOUNT_C}:role/devcontrol`,
  external_id: 'external-id',
  region,
  nickname: null,
  status: 'active',
  connected_at: null,
});

const metric = (name: string, overrides: Partial<MetricAlarm> = {}): MetricAlarm => ({
  AlarmName: name,
  AlarmArn: `arn:aws:cloudwatch:us-east-1:${ACCOUNT_C}:alarm:${name}`,
  AlarmDescription: 'description not kept',
  AlarmActions: [`arn:aws:sns:us-east-1:${ACCOUNT_C}:ops`],
  OKActions: [`arn:aws:sns:us-east-1:${ACCOUNT_C}:ops`],
  ActionsEnabled: true,
  StateValue: 'ALARM',
  StateReason: 'reason not kept',
  StateUpdatedTimestamp: UPDATED,
  StateTransitionedTimestamp: TRANSITIONED,
  Namespace: 'AWS/EC2',
  MetricName: 'CPUUtilization',
  Dimensions: [{ Name: 'InstanceId', Value: 'i-1234567890abcdef0' }],
  ComparisonOperator: 'GreaterThanThreshold',
  Threshold: 80,
  ...overrides,
});

const composite = (name: string, overrides: Partial<CompositeAlarm> = {}): CompositeAlarm => ({
  AlarmName: name,
  AlarmArn: `arn:aws:cloudwatch:us-east-1:${ACCOUNT_C}:alarm:${name}`,
  AlarmDescription: 'description not kept',
  AlarmRule: 'ALARM("rule not kept")',
  AlarmActions: [`arn:aws:sns:us-east-1:${ACCOUNT_C}:ops`],
  StateValue: 'ALARM',
  StateUpdatedTimestamp: UPDATED,
  StateTransitionedTimestamp: TRANSITIONED,
  ...overrides,
});

interface FakeAlarms {
  metric?: MetricAlarm[];
  composite?: CompositeAlarm[];
  /** Alarms per page (DescribeAlarms' own page size is up to 100). */
  perPage?: number;
  /** Throw this on the given call (1-based), or on every call. */
  failOn?: { call?: number; error: Error };
  /** Answer every page with this NextToken. */
  repeatToken?: string;
  /** Never answer. */
  hang?: boolean;
}

function fakeCloudWatch(fake: FakeAlarms) {
  let calls = 0;
  const send = jest.fn(async (command: unknown) => {
    calls++;
    if (!(command instanceof DescribeAlarmsCommand)) throw new Error('only DescribeAlarms is expected');
    if (fake.hang) return new Promise(() => {});
    if (fake.failOn && (fake.failOn.call === undefined || fake.failOn.call === calls)) throw fake.failOn.error;
    const input = command.input;
    const all = [
      ...(fake.metric ?? []).map((a) => ({ kind: 'metric' as const, a })),
      ...(fake.composite ?? []).map((a) => ({ kind: 'composite' as const, a })),
    ].filter(({ kind }) => (input.AlarmTypes ?? ['MetricAlarm']).includes(kind === 'metric' ? 'MetricAlarm' : 'CompositeAlarm'));
    const filtered = input.StateValue ? all.filter(({ a }) => a.StateValue === input.StateValue) : all;
    const perPage = fake.perPage ?? 100;
    const start = input.NextToken ? Number(input.NextToken) : 0;
    const slice = filtered.slice(start, start + perPage);
    const next = start + perPage < filtered.length ? String(start + perPage) : undefined;
    return {
      MetricAlarms: slice.filter((x) => x.kind === 'metric').map((x) => x.a),
      CompositeAlarms: slice.filter((x) => x.kind === 'composite').map((x) => x.a),
      NextToken: fake.repeatToken ?? next,
    };
  });
  return { send };
}

/** The organization's aws_accounts rows, and the fake CloudWatch of each row. */
let rows: Record<string, AwsAccountRow[] | Error>;
let clouds: Record<string, ReturnType<typeof fakeCloudWatch>>;
let now: number;

const FAST_POLICY: AwsCallPolicy = { ...DEFAULT_AWS_CALL_POLICY, sleep: async () => {}, timeoutMs: 1_000 };
const service = (policy: AwsCallPolicy = FAST_POLICY) => new CloudWatchAlarmsService(policy, () => now);

function useAccount(orgId: string, row: AwsAccountRow, fake: FakeAlarms) {
  rows[orgId] = [row];
  clouds[row.id] = fakeCloudWatch(fake);
  return clouds[row.id];
}

beforeEach(() => {
  rows = {};
  clouds = {};
  now = T0;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  query.mockReset().mockImplementation(async (sql: string, params: unknown[]) => {
    if (!sql.includes('FROM aws_accounts')) throw new Error(`unexpected query: ${sql}`);
    const answer = rows[params[0] as string];
    if (answer instanceof Error) throw answer;
    return { rows: answer ?? [] };
  });
  const sources = new WeakMap<object, unknown>();
  createClients.mockReset().mockImplementation(async (orgId: string) => {
    const answer = rows[orgId];
    if (!answer || answer instanceof Error || answer.length === 0) throw new AwsAccountNotConnectedError(orgId);
    const row = answer[0];
    const clients = { enabled: true, region: row.region ?? 'us-east-1', cloudWatch: clouds[row.id] };
    sources.set(clients, { organizationId: orgId, account: row, region: row.region ?? 'us-east-1' });
    return clients;
  });
  sourceOf.mockReset().mockImplementation((clients: object) => sources.get(clients));
});

afterEach(() => jest.restoreAllMocks());

const expectError = (result: AlarmsResult, reason: string) => {
  expect(result).toMatchObject({
    status: 'error',
    reason,
    in_alarm: null,
    in_alarm_complete: null,
    configured_count: null,
    configured_count_complete: null,
    truncated: null,
  });
};

// ── Tests ────────────────────────────────

describe('CloudWatchAlarmsService', () => {
  it('(1) each organization sees only its own account\'s alarms, and the cache never crosses organizations', async () => {
    const cloudA = useAccount(ORG_A, accountRow('row-a', ORG_A, ACCOUNT_A), { metric: [metric('a-alarm')] });
    const cloudB = useAccount(ORG_B, accountRow('row-b', ORG_B, ACCOUNT_B), { metric: [metric('b-alarm'), metric('b-other')] });
    const svc = service();

    const a = await svc.getAlarms(ORG_A);
    const b = await svc.getAlarms(ORG_B);
    expect(a.status === 'ok' && a.in_alarm.map((i) => i.name)).toEqual(['a-alarm']);
    expect(b.status === 'ok' && b.in_alarm.map((i) => i.name)).toEqual(['b-alarm', 'b-other']);
    expect(createClients.mock.calls).toEqual([[ORG_A], [ORG_B]]);
    expect(cloudA.send).toHaveBeenCalledTimes(2);
    expect(cloudB.send).toHaveBeenCalledTimes(2);

    // Both cached now: each organization still gets only its own.
    expect(await svc.getAlarms(ORG_B)).toBe(b);
    expect(await svc.getAlarms(ORG_A)).toBe(a);
    expect(createClients).toHaveBeenCalledTimes(2);
  });

  it('(2) the cache key includes the account and the region', async () => {
    const svc = service();
    useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A, 'us-east-1'), { metric: [metric('x-alarm')] });
    const x = await svc.getAlarms(ORG_A);
    expect(x.status === 'ok' && x.in_alarm.map((i) => i.name)).toEqual(['x-alarm']);

    // Reconnected to another account: never answered from account X's entry.
    useAccount(ORG_A, accountRow('row-y', ORG_A, ACCOUNT_B, 'us-east-1'), { metric: [metric('y-alarm')] });
    const y = await svc.getAlarms(ORG_A);
    expect(y.status === 'ok' && y.in_alarm.map((i) => i.name)).toEqual(['y-alarm']);

    // Same account row, another home region.
    useAccount(ORG_A, accountRow('row-y', ORG_A, ACCOUNT_B, 'eu-west-1'), { metric: [metric('y-eu-alarm')] });
    const yEu = await svc.getAlarms(ORG_A);
    expect(yEu.status === 'ok' && yEu.in_alarm.map((i) => i.name)).toEqual(['y-eu-alarm']);
    expect(yEu.region).toBe('eu-west-1');

    // Same account and region, another AWS account ID recorded on the row.
    useAccount(ORG_A, accountRow('row-y', ORG_A, ACCOUNT_C, 'eu-west-1'), { metric: [metric('c-alarm')] });
    const c = await svc.getAlarms(ORG_A);
    expect(c.status === 'ok' && c.in_alarm.map((i) => i.name)).toEqual(['c-alarm']);
    expect(createClients).toHaveBeenCalledTimes(4);
  });

  it('(3) when the role assumed is not the account read for the request, the result fails and is not cached', async () => {
    useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), { metric: [metric('x-alarm')] });
    const other = fakeCloudWatch({ metric: [metric('other-account-alarm')] });
    createClients.mockImplementation(async () => ({ region: 'us-east-1', cloudWatch: other }));
    sourceOf.mockReturnValue({ organizationId: ORG_A, account: accountRow('row-other', ORG_A, ACCOUNT_B), region: 'us-east-1' });
    const svc = service();

    const result = await svc.getAlarms(ORG_A);
    expectError(result, 'failed');
    expect(other.send).not.toHaveBeenCalled();
    await svc.getAlarms(ORG_A);
    expect(createClients).toHaveBeenCalledTimes(2);
  });

  it('(4) an organization with no connected account is not_connected, with no counts and no AWS call', async () => {
    const result = await service().getAlarms(ORG_A);
    expectError(result, 'not_connected');
    expect(result.region).toBeNull();
    expect(createClients).not.toHaveBeenCalled();
  });

  it('(5) more than one eligible account is multiple_accounts', async () => {
    rows[ORG_A] = [accountRow('row-1', ORG_A, ACCOUNT_A), accountRow('row-2', ORG_A, ACCOUNT_B)];
    const result = await service().getAlarms(ORG_A);
    expectError(result, 'multiple_accounts');
    expect(createClients).not.toHaveBeenCalled();
  });

  it('(6) a failed role assumption for a connected organization is failed, never not_connected', async () => {
    useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A, 'eu-west-1'), {});
    createClients.mockRejectedValue(new Error(`AWS_NOT_CONNECTED: org ${ORG_A} has not connected an AWS account`));
    const result = await service().getAlarms(ORG_A);
    expectError(result, 'failed');
    expect(result.region).toBe('eu-west-1');
  });

  it('(6b) the account lookup failing is failed', async () => {
    rows[ORG_A] = new Error('connection terminated');
    expectError(await service().getAlarms(ORG_A), 'failed');
  });

  it.each([
    ['the in-ALARM pass', 1],
    ['the count pass', 2],
  ])('(7) access denied on %s is access_denied, never 0 alarms', async (_label, call) => {
    useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), {
      metric: [metric('a')],
      failOn: { call, error: Object.assign(new Error('not authorized to perform cloudwatch:DescribeAlarms'), { name: 'AccessDenied' }) },
    });
    expectError(await service().getAlarms(ORG_A), 'access_denied');
  });

  it('(8) throttling that outlasts the retries is throttled, never 0 alarms', async () => {
    const cloud = useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), {
      failOn: { error: Object.assign(new Error('Rate exceeded'), { name: 'Throttling' }) },
    });
    expectError(await service().getAlarms(ORG_A), 'throttled');
    expect(cloud.send).toHaveBeenCalledTimes(FAST_POLICY.maxAttempts);
  });

  it('(9) a failure on a later page fails the whole result: no partial list', async () => {
    useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), {
      metric: [metric('a'), metric('b'), metric('c')],
      perPage: 1,
      failOn: { call: 2, error: new Error('InternalFailure') },
    });
    expectError(await service().getAlarms(ORG_A), 'failed');
  });

  it('(10) a call that runs past the time limit is failed', async () => {
    useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), { hang: true });
    expectError(await service({ ...FAST_POLICY, timeoutMs: 5 }).getAlarms(ORG_A), 'failed');
  });

  it('(11) pagination: each pass stops at its cap and says so; a repeated NextToken fails', async () => {
    const total = CONFIGURED_MAX_PAGES + 2;
    const alarms = Array.from({ length: total }, (_, i) => metric(`alarm-${i}`, { StateValue: i < 2 ? 'ALARM' : 'OK' }));
    useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), { metric: alarms, perPage: 1 });
    const capped = await service().getAlarms(ORG_A);
    expect(capped).toMatchObject({
      status: 'ok',
      in_alarm_complete: true,
      configured_count: CONFIGURED_MAX_PAGES,
      configured_count_complete: false,
      truncated: true,
    });
    expect(capped.status === 'ok' && capped.in_alarm).toHaveLength(2);

    const firing = Array.from({ length: IN_ALARM_MAX_PAGES + 1 }, (_, i) => metric(`firing-${i}`));
    useAccount(ORG_B, accountRow('row-b', ORG_B, ACCOUNT_B), { metric: firing, perPage: 1 });
    const inAlarmCapped = await service().getAlarms(ORG_B);
    expect(inAlarmCapped).toMatchObject({ status: 'ok', in_alarm_complete: false, configured_count: IN_ALARM_MAX_PAGES + 1, configured_count_complete: true, truncated: true });
    expect(inAlarmCapped.status === 'ok' && inAlarmCapped.in_alarm).toHaveLength(IN_ALARM_MAX_PAGES);

    useAccount(ORG_A, accountRow('row-loop', ORG_A, ACCOUNT_C), { metric: [metric('a')], repeatToken: 'same' });
    expectError(await service().getAlarms(ORG_A), 'failed');
  });

  it('(12) composite alarms are requested explicitly, counted, and listed by name only', async () => {
    const cloud = useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), {
      metric: [metric('cpu-high'), metric('cpu-ok', { StateValue: 'OK' })],
      composite: [composite('orders-degraded'), composite('orders-fine', { StateValue: 'OK' })],
    });
    const result = await service().getAlarms(ORG_A);
    expect(result).toMatchObject({ status: 'ok', configured_count: 4, configured_count_complete: true, in_alarm_complete: true, truncated: false });
    expect(result.status === 'ok' && result.in_alarm.find((i) => i.type === 'composite')).toEqual({
      name: 'orders-degraded', type: 'composite', namespace: null, metric: null, comparison: null, threshold: null,
      state_since: TRANSITIONED.toISOString(), resource: null,
    });
    const inputs = cloud.send.mock.calls.map(([command]) => (command as DescribeAlarmsCommand).input);
    expect(inputs).toEqual([
      { AlarmTypes: ['MetricAlarm', 'CompositeAlarm'], StateValue: 'ALARM', MaxRecords: 100, NextToken: undefined },
      { AlarmTypes: ['MetricAlarm', 'CompositeAlarm'], StateValue: undefined, MaxRecords: 100, NextToken: undefined },
    ]);
  });

  it('(12b) an alarm not in ALARM is never listed, even if AWS returns it to the ALARM pass', async () => {
    const cloud = useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), {});
    cloud.send.mockResolvedValue({ MetricAlarms: [metric('firing'), metric('quiet', { StateValue: 'OK' })], CompositeAlarms: [] });
    const result = await service().getAlarms(ORG_A);
    expect(result.status === 'ok' && result.in_alarm.map((i) => i.name)).toEqual(['firing']);
  });

  it('(13) an account with no alarms is ok with 0 and an empty list, complete', async () => {
    useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), {});
    expect(await service().getAlarms(ORG_A)).toEqual({
      status: 'ok',
      reason: null,
      checked_at: new Date(T0).toISOString(),
      region: 'us-east-1',
      in_alarm: [],
      in_alarm_complete: true,
      configured_count: 0,
      configured_count_complete: true,
      truncated: false,
    });
  });

  it('(14) metric-math and anomaly-band alarms have no metric or threshold', async () => {
    useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), {
      metric: [
        metric('math', { Namespace: undefined, MetricName: undefined, Dimensions: undefined, Threshold: 90, Metrics: [{ Id: 'e1', Expression: 'm1+m2' }] }),
        metric('band', { Threshold: undefined, ThresholdMetricId: 'ad1', ComparisonOperator: 'LessThanLowerOrGreaterThanUpperThreshold' }),
      ],
    });
    const result = await service().getAlarms(ORG_A);
    const [math, band] = result.status === 'ok' ? result.in_alarm : [];
    expect(math).toMatchObject({ name: 'math', namespace: null, metric: null, threshold: 90, resource: null });
    expect(band).toMatchObject({ name: 'band', namespace: 'AWS/EC2', metric: 'CPUUtilization', threshold: null, comparison: 'LessThanLowerOrGreaterThanUpperThreshold' });
  });

  it('(15) the resource comes only from the namespace\'s one resource dimension', () => {
    const resource = (overrides: Partial<MetricAlarm>) => alarmResource(projectMetricAlarm(metric('r', overrides)));
    expect(resource({})).toEqual({ type: 'ec2', id: 'i-1234567890abcdef0' });
    expect(resource({ Namespace: 'AWS/RDS', Dimensions: [{ Name: 'DBInstanceIdentifier', Value: 'orders-db' }] })).toEqual({ type: 'rds', id: 'orders-db' });
    expect(resource({ Namespace: 'AWS/RDS', Dimensions: [{ Name: 'DBClusterIdentifier', Value: 'orders' }, { Name: 'Role', Value: 'WRITER' }] })).toEqual({ type: 'aurora', id: 'orders' });
    expect(resource({ Namespace: 'AWS/Lambda', Dimensions: [{ Name: 'FunctionName', Value: 'fn' }, { Name: 'Resource', Value: 'fn:live' }] })).toEqual({ type: 'lambda', id: 'fn' });
    expect(resource({ Namespace: 'AWS/ApplicationELB', Dimensions: [{ Name: 'LoadBalancer', Value: 'app/web/0123' }] })).toEqual({ type: 'load-balancer', id: 'app/web/0123' });
    expect(resource({ Namespace: 'AWS/DynamoDB', Dimensions: [{ Name: 'TableName', Value: 'orders' }] })).toEqual({ type: 'dynamodb', id: 'orders' });
    expect(resource({ Namespace: 'AWS/EBS', Dimensions: [{ Name: 'VolumeId', Value: 'vol-1' }] })).toEqual({ type: 'ebs', id: 'vol-1' });
    expect(resource({ Namespace: 'AWS/CloudFront', Dimensions: [{ Name: 'Region', Value: 'Global' }, { Name: 'DistributionId', Value: 'E1' }] })).toEqual({ type: 'cloudfront', id: 'E1' });
    // No resource: a duplicated key, a custom namespace, an ASG alarm, a decoy first dimension, metric math, empty value.
    expect(resource({ Dimensions: [{ Name: 'InstanceId', Value: 'i-1' }, { Name: 'InstanceId', Value: 'i-2' }] })).toBeNull();
    expect(resource({ Namespace: 'Custom/App', Dimensions: [{ Name: 'InstanceId', Value: 'i-1' }] })).toBeNull();
    expect(resource({ Dimensions: [{ Name: 'AutoScalingGroupName', Value: 'web-asg' }] })).toBeNull();
    expect(resource({ Namespace: 'AWS/Lambda', Dimensions: [{ Name: 'Resource', Value: 'decoy' }] })).toBeNull();
    expect(resource({ Metrics: [{ Id: 'e1', Expression: 'm1' }] })).toBeNull();
    expect(resource({ Dimensions: [{ Name: 'InstanceId', Value: '' }] })).toBeNull();
  });

  it('(16) "in ALARM since" is when the state last changed, not the last state update', async () => {
    useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), {
      metric: [metric('with'), metric('without', { StateTransitionedTimestamp: undefined })],
    });
    const result = await service().getAlarms(ORG_A);
    const [withTime, withoutTime] = result.status === 'ok' ? result.in_alarm : [];
    expect(withTime.state_since).toBe(TRANSITIONED.toISOString());
    expect(withoutTime.state_since).toBeNull();
    expect(JSON.stringify(result)).not.toContain(UPDATED.toISOString());
  });

  it('(17) only successes are cached, for 60 seconds, and a hit keeps the time it was checked', async () => {
    const cloud = useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), {
      metric: [metric('a')],
      failOn: { call: 1, error: Object.assign(new Error('Rate exceeded'), { name: 'Throttling' }) },
    });
    const svc = service({ ...FAST_POLICY, maxAttempts: 1 });
    expectError(await svc.getAlarms(ORG_A), 'throttled');

    now = T0 + 1_000;
    const fresh = await svc.getAlarms(ORG_A);
    expect(fresh).toMatchObject({ status: 'ok', checked_at: new Date(T0 + 1_000).toISOString() });
    const callsAfterFresh = cloud.send.mock.calls.length;

    now = T0 + 1_000 + ALARMS_CACHE_TTL_MS - 1;
    expect(await svc.getAlarms(ORG_A)).toBe(fresh);
    expect(cloud.send).toHaveBeenCalledTimes(callsAfterFresh);

    now = T0 + 1_000 + ALARMS_CACHE_TTL_MS;
    const refetched = await svc.getAlarms(ORG_A);
    expect(refetched).not.toBe(fresh);
    expect(refetched.checked_at).toBe(new Date(now).toISOString());
  });

  it('a disconnected organization is never answered from its cached result', async () => {
    useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), { metric: [metric('a')] });
    const svc = service();
    expect((await svc.getAlarms(ORG_A)).status).toBe('ok');
    rows[ORG_A] = [];
    expectError(await svc.getAlarms(ORG_A), 'not_connected');
  });

  it('concurrent requests for the same organization share one read', async () => {
    const cloud = useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), { metric: [metric('a')] });
    const svc = service();
    const [one, two] = await Promise.all([svc.getAlarms(ORG_A), svc.getAlarms(ORG_A)]);
    expect(one).toBe(two);
    expect(createClients).toHaveBeenCalledTimes(1);
    expect(cloud.send).toHaveBeenCalledTimes(2);
  });

  it('nothing from the response beyond the item fields is returned or logged', async () => {
    useAccount(ORG_A, accountRow('row-x', ORG_A, ACCOUNT_A), { metric: [metric('a')], composite: [composite('c')] });
    const result = await service().getAlarms(ORG_A);
    const out = JSON.stringify(result) + JSON.stringify((console.error as jest.Mock).mock.calls);
    for (const leaked of ['description not kept', 'reason not kept', 'rule not kept', 'arn:aws:', ACCOUNT_A]) {
      expect(out).not.toContain(leaked);
    }
  });
});
