/**
 * Tier 0 observability readiness: EC2/RDS alert coverage measured only from
 * the org's current discovered inventory, gated on the latest finished
 * discovery run.
 *
 * Previously "Alert Coverage" was tautological (its denominator was built from
 * the alarms themselves, so any two alarms read as 100%), Critical Coverage
 * fell back to Monitoring, Monitoring/Freshness came from a dimensionless
 * namespace aggregate, and Response Setup read a table no migration creates.
 *
 * pool.query and AWSClientFactory.createClients are mocked; CloudWatch is a
 * fake client that only answers DescribeAlarms. No database, AWS, or network.
 */
import { DescribeAlarmsCommand, type MetricAlarm } from '@aws-sdk/client-cloudwatch';

jest.mock('../../config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../aws-client-factory.service', () => ({ AWSClientFactory: { createClients: jest.fn() } }));

import { pool } from '../../config/database';
import { AWSClientFactory } from '../aws-client-factory.service';
import {
  ObservabilityReadinessService,
  evaluateDiscoveryGate,
  describeAllMetricAlarms,
  type GatedDiscoveryRun,
  type ReadinessResult,
} from '../observability-readiness.service';

const ORG = '5b3f0c9e-2d4a-4e8b-9f1c-7a6d2e4b8c10';
const ACCOUNT = '111122223333';
const REGION = 'us-east-1';
const RUN_STARTED = '2026-09-30T10:00:00.000Z';
const RUN_COMPLETED = '2026-09-30T10:04:12.000Z';
const BEFORE_RUN = '2026-09-29T08:00:00.000Z';
const DURING_RUN = '2026-09-30T10:01:30.000Z';

const CURRENT_EC2 = 'i-0a1b2c3d4e5f60718';
const REPLACED_EC2 = 'i-0f9e8d7c6b5a40312';
const SECOND_EC2 = 'i-07c6d5e4f3a2b1908';
const RDS_ID = 'orders-prod-db';
const SNS = `arn:aws:sns:${REGION}:${ACCOUNT}:ops-alerts`;

const query = pool.query as unknown as jest.Mock;
const createClients = AWSClientFactory.createClients as unknown as jest.Mock;

// ── Fixtures ─────────────────────────────

interface RunRow {
  id: string;
  status: 'completed' | 'failed';
  started_at: string;
  completed_at: string;
  resource_types: string[] | null;
  error_message: string | null;
}

function runRow(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: '9d2e7f10-4c3b-4a1e-8f5d-2b6c9a0e1f34',
    status: 'completed',
    started_at: RUN_STARTED,
    completed_at: RUN_COMPLETED,
    resource_types: ['ec2', 'ebs', 'rds', 's3', 'lambda', 'load-balancer'],
    error_message: null,
    ...overrides,
  };
}

function resourceRow(
  resource_id: string,
  opts: { type?: 'ec2' | 'rds'; region?: string | null; status?: string; synced?: string | null } = {}
) {
  return {
    resource_id,
    resource_type: opts.type ?? 'ec2',
    region: opts.region === undefined ? REGION : opts.region,
    status: opts.status ?? 'running',
    last_synced_at: opts.synced === undefined ? DURING_RUN : opts.synced,
  };
}

function alarm(
  name: string,
  opts: {
    namespace?: string;
    dimensions?: Array<{ Name: string; Value: string }>;
    state?: 'OK' | 'ALARM' | 'INSUFFICIENT_DATA';
    actionsEnabled?: boolean;
    actions?: string[];
    treatMissingData?: string;
    metrics?: MetricAlarm['Metrics'];
  } = {}
): MetricAlarm {
  return {
    AlarmName: name,
    AlarmArn: `arn:aws:cloudwatch:${REGION}:${ACCOUNT}:alarm:${name}`,
    Namespace: opts.namespace ?? 'AWS/EC2',
    MetricName: 'CPUUtilization',
    Dimensions: opts.dimensions ?? [{ Name: 'InstanceId', Value: CURRENT_EC2 }],
    StateValue: opts.state ?? 'OK',
    ActionsEnabled: opts.actionsEnabled ?? true,
    AlarmActions: opts.actions ?? [SNS],
    TreatMissingData: opts.treatMissingData ?? 'missing',
    Metrics: opts.metrics,
  };
}

function ec2Alarm(name: string, instanceId: string, opts: Parameters<typeof alarm>[1] = {}): MetricAlarm {
  return alarm(name, { dimensions: [{ Name: 'InstanceId', Value: instanceId }], ...opts });
}

function rdsAlarm(name: string, dbId: string, opts: Parameters<typeof alarm>[1] = {}): MetricAlarm {
  return alarm(name, { namespace: 'AWS/RDS', dimensions: [{ Name: 'DBInstanceIdentifier', Value: dbId }], ...opts });
}

interface Setup {
  account?: { account_id: string | null } | null | Error;
  run?: RunRow | null | Error;
  inventory?: ReturnType<typeof resourceRow>[] | Error;
  /** Pages of alarms returned in order, or an Error thrown on DescribeAlarms. */
  alarmPages?: MetricAlarm[][] | Error;
  clients?: Error | { enabled: boolean };
}

function setup(opts: Setup = {}) {
  const sqls: string[] = [];
  query.mockImplementation(async (sql: string, params: unknown[]) => {
    sqls.push(sql);
    expect(params).toEqual([ORG]);
    const answer = (value: unknown) => {
      if (value instanceof Error) throw value;
      return { rows: value === null || value === undefined ? [] : Array.isArray(value) ? value : [value] };
    };
    if (sql.includes('FROM aws_accounts')) return answer(opts.account === undefined ? { account_id: ACCOUNT } : opts.account);
    if (sql.includes('FROM resource_discovery_jobs')) return answer(opts.run === undefined ? runRow() : opts.run);
    if (sql.includes('FROM aws_resources')) return answer(opts.inventory ?? []);
    throw new Error(`unexpected query: ${sql}`);
  });

  const pages = opts.alarmPages ?? [[]];
  const commands: unknown[] = [];
  const send = jest.fn(async (command: unknown) => {
    commands.push(command);
    if (!(command instanceof DescribeAlarmsCommand)) throw new Error('only DescribeAlarms is expected');
    if (pages instanceof Error) throw pages;
    const token = command.input.NextToken;
    const index = token ? Number(token.replace('page-', '')) : 0;
    return {
      MetricAlarms: pages[index],
      NextToken: index + 1 < pages.length ? `page-${index + 1}` : undefined,
    };
  });

  if (opts.clients instanceof Error) createClients.mockRejectedValue(opts.clients);
  else createClients.mockResolvedValue({ enabled: opts.clients?.enabled ?? true, region: REGION, cloudWatch: { send } });

  return { sqls, send, commands };
}

async function readiness(opts: Setup = {}) {
  const env = setup(opts);
  const result = await new ObservabilityReadinessService().getReadiness(ORG);
  return { result: result as ReadinessResult, ...env };
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
  query.mockReset();
  createClients.mockReset();
});

// ── Discovery gate ───────────────────────

function gatedRun(overrides: Partial<GatedDiscoveryRun> = {}): GatedDiscoveryRun {
  return {
    id: '9d2e7f10-4c3b-4a1e-8f5d-2b6c9a0e1f34',
    status: 'completed',
    startedAt: new Date(RUN_STARTED),
    completedAt: new Date(RUN_COMPLETED),
    resourceTypes: ['ec2', 'rds'],
    errorMessage: null,
    ...overrides,
  };
}

describe('evaluateDiscoveryGate', () => {
  it('a completed run is usable for every type it scanned', () => {
    expect(evaluateDiscoveryGate(gatedRun(), 'ec2').kind).toBe('usable');
    expect(evaluateDiscoveryGate(gatedRun(), 'rds').kind).toBe('usable');
  });

  it('a failed run whose segments all carry other known prefixes stays usable for EC2 and RDS', () => {
    const run = gatedRun({
      status: 'failed',
      errorMessage: 'Lambda: AccessDeniedException: not authorized to perform lambda:ListFunctions; IAM security scan: AccessDenied',
    });
    expect(evaluateDiscoveryGate(run, 'ec2').kind).toBe('usable');
    expect(evaluateDiscoveryGate(run, 'rds').kind).toBe('usable');
  });

  it('an EC2: segment makes EC2 an error but leaves RDS usable', () => {
    const run = gatedRun({ status: 'failed', errorMessage: 'S3: Access Denied; EC2: UnauthorizedOperation: You are not authorized to perform this operation.' });
    expect(evaluateDiscoveryGate(run, 'ec2')).toEqual({ kind: 'error', reason: 'EC2 discovery failed in the latest discovery run' });
    expect(evaluateDiscoveryGate(run, 'rds').kind).toBe('usable');
  });

  it('an RDS: segment makes RDS an error but leaves EC2 usable', () => {
    const run = gatedRun({ status: 'failed', errorMessage: 'RDS: AccessDenied: rds:DescribeDBInstances' });
    expect(evaluateDiscoveryGate(run, 'rds').kind).toBe('error');
    expect(evaluateDiscoveryGate(run, 'ec2').kind).toBe('usable');
  });

  it('an unknown or fatal (unprefixed) message fails closed for both types', () => {
    const run = gatedRun({ status: 'failed', errorMessage: 'AWS credentials not configured for this organization' });
    expect(evaluateDiscoveryGate(run, 'ec2')).toEqual({ kind: 'error', reason: 'the latest discovery run failed with an unrecognized error' });
    expect(evaluateDiscoveryGate(run, 'rds').kind).toBe('error');
  });

  it('a "; " inside one sub-step message leaves an unprefixed segment, which fails closed', () => {
    const run = gatedRun({ status: 'failed', errorMessage: 'Lambda: throttled; retry later' });
    expect(evaluateDiscoveryGate(run, 'ec2').kind).toBe('error');
    expect(evaluateDiscoveryGate(run, 'rds').kind).toBe('error');
  });

  it('a failed run with an empty or null message fails closed', () => {
    expect(evaluateDiscoveryGate(gatedRun({ status: 'failed', errorMessage: null }), 'ec2').kind).toBe('error');
    expect(evaluateDiscoveryGate(gatedRun({ status: 'failed', errorMessage: '   ' }), 'rds').kind).toBe('error');
  });

  it('a type missing from resource_types is tier-excluded, not an error', () => {
    expect(evaluateDiscoveryGate(gatedRun({ resourceTypes: ['ec2', 's3'] }), 'rds').kind).toBe('tier_excluded');
  });

  it('an unrecorded resource_types list fails closed', () => {
    expect(evaluateDiscoveryGate(gatedRun({ resourceTypes: null }), 'ec2').kind).toBe('error');
  });

  it('no finished run is unavailable', () => {
    expect(evaluateDiscoveryGate(null, 'ec2')).toEqual({ kind: 'unavailable', reason: 'no discovery run has finished for this account' });
  });

  it('the gated-run query only ever reads a finished run (a running job is never selected), newest first, with no fallback', async () => {
    const { sqls } = await readiness({ inventory: [resourceRow(CURRENT_EC2)] });
    const sql = sqls.find(s => s.includes('FROM resource_discovery_jobs'))!;
    expect(sql).toMatch(/status IN \('completed', 'failed'\)/);
    expect(sql).toMatch(/completed_at IS NOT NULL/);
    expect(sql).toMatch(/ORDER BY started_at DESC\s+LIMIT 1/);
  });

  it('when the only jobs are running (no finished row), the result is unavailable with a null score', async () => {
    const { result, send } = await readiness({ run: null, inventory: [resourceRow(CURRENT_EC2)] });
    expect(result.state).toBe('unavailable');
    expect(result.readiness_score).toBeNull();
    expect(result.components.alert_coverage.ec2.state).toBe('unavailable');
    expect(result.discovery_run).toBeNull();
    // Nothing is gated usable, so alarms are not even read.
    expect(send).not.toHaveBeenCalled();
    expect(result.alarms.state).toBe('unavailable');
  });

  it('a type-specific discovery failure makes the whole readiness score null with state error -- never 0', async () => {
    const { result } = await readiness({
      run: runRow({ status: 'failed', error_message: 'RDS: AccessDenied: rds:DescribeDBInstances' }),
      inventory: [resourceRow(CURRENT_EC2)],
      alarmPages: [[ec2Alarm('web-cpu-high', CURRENT_EC2)]],
    });
    expect(result.components.alert_coverage.ec2.state).toBe('available');
    expect(result.components.alert_coverage.rds.state).toBe('error');
    expect(result.state).toBe('error');
    expect(result.readiness_score).toBeNull();
    expect(result.status).toBeNull();
  });
});

// ── In-scope resources ───────────────────

describe('in-scope resources (denominator)', () => {
  it('counts only rows in the client region re-seen by the gated run; stale and other-region rows are excluded and reported', async () => {
    const { result } = await readiness({
      inventory: [
        resourceRow(CURRENT_EC2),
        resourceRow(SECOND_EC2, { synced: BEFORE_RUN }),
        resourceRow('i-0123456789abcdef0', { region: 'eu-west-1' }),
      ],
      alarmPages: [[ec2Alarm('web-cpu-high', CURRENT_EC2)]],
    });
    const ec2 = result.components.alert_coverage.ec2;
    expect(ec2.data!.inScope).toBe(1);
    expect(ec2.data!.excluded).toEqual({ notSeenByGatedRun: 1, otherRegion: 1 });
    expect(ec2.completeness).toEqual({ unit: 'resource', expected: 1, received: 1, missing: [] });
    expect(ec2.asOf).toBe(RUN_COMPLETED);
    expect(ec2.scope).toEqual({ kind: 'resource_inventory', connectedAccountId: ACCOUNT, discoveryRegion: REGION });
  });

  it('a row with no last_synced_at is not re-seen', async () => {
    const { result } = await readiness({ inventory: [resourceRow(CURRENT_EC2, { synced: null })] });
    expect(result.components.alert_coverage.ec2.data!.excluded.notSeenByGatedRun).toBe(1);
    expect(result.readiness_score).toBeNull();
  });

  it('non-running statuses stay in the denominator and are counted separately', async () => {
    const { result } = await readiness({
      inventory: [resourceRow(CURRENT_EC2), resourceRow(SECOND_EC2, { status: 'stopped' })],
      alarmPages: [[ec2Alarm('web-cpu-high', CURRENT_EC2)]],
    });
    const ec2 = result.components.alert_coverage.ec2;
    expect(ec2.data!.statusCounts).toEqual({ running: 1, stopped: 1 });
    expect(ec2.data!.inScope).toBe(2);
    expect(ec2.coverage).toContain('including 1 not in a running/available state');
    expect(result.readiness_score).toBe(50);
  });

  it('the inventory query is org-scoped, EC2/RDS only, and excludes terminated rows', async () => {
    const { sqls } = await readiness({ inventory: [resourceRow(CURRENT_EC2)] });
    const sql = sqls.find(s => s.includes('FROM aws_resources'))!;
    expect(sql).toMatch(/organization_id = \$1/);
    expect(sql).toMatch(/resource_type IN \('ec2', 'rds'\)/);
    expect(sql).toMatch(/status != 'terminated'/);
  });

  it('zero in-scope resources under a usable gate: available, expected 0, not applicable, score null (never 100 or 0)', async () => {
    const { result } = await readiness({
      inventory: [],
      alarmPages: [[ec2Alarm('web-cpu-high', REPLACED_EC2), rdsAlarm('db-cpu-high', RDS_ID)]],
    });
    const ec2 = result.components.alert_coverage.ec2;
    expect(ec2.state).toBe('available');
    expect(ec2.completeness).toEqual({ unit: 'resource', expected: 0, received: 0, missing: [] });
    expect(ec2.data!.applicable).toBe(false);
    expect(ec2.data!.coveragePercent).toBeNull();
    expect(result.state).toBe('unavailable');
    expect(result.reason).toBe('no EC2 or RDS resources are in scope, so alert coverage is not applicable');
    expect(result.readiness_score).toBeNull();
    expect(result.status).toBeNull();
  });
});

// ── Coverage ─────────────────────────────

describe('coverage (numerator)', () => {
  it('matches the exact dimension even when it is not the first dimension', async () => {
    const { result } = await readiness({
      inventory: [resourceRow(CURRENT_EC2)],
      alarmPages: [[alarm('web-disk-high', {
        namespace: 'AWS/EC2',
        dimensions: [{ Name: 'ImageId', Value: 'ami-0abcdef1234567890' }, { Name: 'InstanceId', Value: CURRENT_EC2 }],
      })]],
    });
    expect(result.components.alert_coverage.ec2.data!.covered).toBe(1);
    expect(result.readiness_score).toBe(100);
  });

  it('never matches by alarm name or by Dimensions[0] of another key', async () => {
    const { result } = await readiness({
      inventory: [resourceRow(CURRENT_EC2)],
      alarmPages: [[alarm(`cpu-${CURRENT_EC2}`, {
        namespace: 'AWS/EC2',
        dimensions: [{ Name: 'AutoScalingGroupName', Value: CURRENT_EC2 }],
      })]],
    });
    expect(result.components.alert_coverage.ec2.data!.covered).toBe(0);
    expect(result.readiness_score).toBe(0);
    expect(result.alarms.data!.unsupported).toEqual([{ alarmName: `cpu-${CURRENT_EC2}`, reason: 'unmapped' }]);
  });

  it('an INSUFFICIENT_DATA alarm is not coverage and is reported', async () => {
    const { result } = await readiness({
      inventory: [resourceRow(CURRENT_EC2)],
      alarmPages: [[ec2Alarm('web-cpu-high', CURRENT_EC2, { state: 'INSUFFICIENT_DATA' })]],
    });
    const ec2 = result.components.alert_coverage.ec2.data!;
    expect(ec2.covered).toBe(0);
    expect(ec2.nonQualifyingAlarms.insufficient_data).toBe(1);
    expect(ec2.resources[0].alarms[0].disqualifiedBy).toEqual(['insufficient_data']);
  });

  it.each(['notBreaching', 'ignore'])('an OK alarm with TreatMissingData=%s is "data unverified", not coverage', async (treatMissingData) => {
    const { result } = await readiness({
      inventory: [resourceRow(CURRENT_EC2)],
      alarmPages: [[ec2Alarm('web-cpu-high', CURRENT_EC2, { treatMissingData })]],
    });
    const ec2 = result.components.alert_coverage.ec2.data!;
    expect(ec2.covered).toBe(0);
    expect(ec2.nonQualifyingAlarms.data_unverified).toBe(1);
    expect(result.readiness_score).toBe(0);
  });

  it('TreatMissingData=breaching or missing still counts', async () => {
    const { result } = await readiness({
      inventory: [resourceRow(CURRENT_EC2), resourceRow(SECOND_EC2)],
      alarmPages: [[
        ec2Alarm('a', CURRENT_EC2, { treatMissingData: 'breaching' }),
        ec2Alarm('b', SECOND_EC2, { treatMissingData: 'missing', state: 'ALARM' }),
      ]],
    });
    expect(result.readiness_score).toBe(100);
  });

  it('an alarm with actions disabled, or with no AlarmActions, is not coverage', async () => {
    const { result } = await readiness({
      inventory: [resourceRow(CURRENT_EC2), resourceRow(SECOND_EC2)],
      alarmPages: [[
        ec2Alarm('disabled', CURRENT_EC2, { actionsEnabled: false }),
        ec2Alarm('no-targets', SECOND_EC2, { actions: [] }),
      ]],
    });
    const ec2 = result.components.alert_coverage.ec2.data!;
    expect(ec2.covered).toBe(0);
    expect(ec2.nonQualifyingAlarms.no_actions).toBe(2);
  });

  it('metric-math and dimensionless alarms are unsupported, never coverage', async () => {
    const { result } = await readiness({
      inventory: [resourceRow(CURRENT_EC2)],
      alarmPages: [[
        alarm('fleet-cpu-math', {
          dimensions: [],
          metrics: [{ Id: 'e1', Expression: 'AVG(METRICS())', ReturnData: true }],
        }),
        alarm('fleet-cpu-aggregate', { dimensions: [] }),
      ]],
    });
    expect(result.components.alert_coverage.ec2.data!.covered).toBe(0);
    expect(result.alarms.data!.unsupported).toEqual([
      { alarmName: 'fleet-cpu-math', reason: 'metric_math' },
      { alarmName: 'fleet-cpu-aggregate', reason: 'dimensionless' },
    ]);
  });

  it('a replaced instance: the current instance is uncovered and the old instance\'s alarms are reported as orphaned', async () => {
    const { result } = await readiness({
      inventory: [resourceRow(CURRENT_EC2)],
      alarmPages: [[
        ec2Alarm('web-cpu-high', REPLACED_EC2),
        ec2Alarm('web-status-check', REPLACED_EC2, { state: 'INSUFFICIENT_DATA' }),
      ]],
    });
    expect(result.components.alert_coverage.ec2.data!.covered).toBe(0);
    expect(result.readiness_score).toBe(0);
    expect(result.alarms.data!.matched).toBe(0);
    expect(result.alarms.data!.orphaned.map(o => o.alarmName)).toEqual(['web-cpu-high', 'web-status-check']);
    expect(result.top_gaps.map(g => g.type)).toEqual(['alert_coverage_ec2', 'orphaned_alarms']);
    expect(result.top_gaps[1].message).toBe('2 EC2/RDS alarms match no resource seen by the latest discovery run');
  });
});

// ── DescribeAlarms ───────────────────────

describe('DescribeAlarms', () => {
  it('paginates metric alarms with NextToken and evaluates every page', async () => {
    const { result, commands } = await readiness({
      inventory: [resourceRow(CURRENT_EC2), resourceRow(SECOND_EC2)],
      alarmPages: [[ec2Alarm('page-1', REPLACED_EC2)], [ec2Alarm('page-2', SECOND_EC2)]],
    });
    expect(commands).toHaveLength(2);
    expect((commands[0] as DescribeAlarmsCommand).input).toEqual({ AlarmTypes: ['MetricAlarm'], MaxRecords: 100, NextToken: undefined });
    expect((commands[1] as DescribeAlarmsCommand).input.NextToken).toBe('page-1');
    expect(result.alarms.data!.total).toBe(2);
    expect(result.readiness_score).toBe(50);
  });

  it('a repeated NextToken throws instead of looping', async () => {
    const send = jest.fn().mockResolvedValue({ MetricAlarms: [], NextToken: 'same' });
    await expect(describeAllMetricAlarms({ send } as any)).rejects.toThrow('repeated NextToken');
  });

  it('a DescribeAlarms failure is error with a null score -- never 0', async () => {
    const { result } = await readiness({
      inventory: [resourceRow(CURRENT_EC2)],
      alarmPages: new Error('AccessDeniedException: not authorized to perform cloudwatch:DescribeAlarms'),
    });
    expect(result.components.alert_coverage.ec2.state).toBe('error');
    expect(result.components.alert_coverage.ec2.reason).toBe('CloudWatch alarms could not be read');
    expect(result.alarms.state).toBe('error');
    expect(result.state).toBe('error');
    expect(result.readiness_score).toBeNull();
    expect(JSON.stringify(result)).not.toContain('AccessDeniedException');
  });

  it('a failure on a later page is still a failure (no partial alarm list is scored)', async () => {
    const send = jest.fn()
      .mockResolvedValueOnce({ MetricAlarms: [ec2Alarm('page-1', CURRENT_EC2)], NextToken: 'page-1' })
      .mockRejectedValueOnce(new Error('ThrottlingException'));
    setup({ inventory: [resourceRow(CURRENT_EC2)] });
    createClients.mockResolvedValue({ enabled: true, region: REGION, cloudWatch: { send } });
    const result = (await new ObservabilityReadinessService().getReadiness(ORG))!;
    expect(result.state).toBe('error');
    expect(result.readiness_score).toBeNull();
  });

  it('only DescribeAlarms is sent to CloudWatch (no GetMetricStatistics aggregate), and alert_configurations is never queried', async () => {
    const { commands, sqls } = await readiness({ inventory: [resourceRow(CURRENT_EC2)] });
    expect(commands.every(c => c instanceof DescribeAlarmsCommand)).toBe(true);
    expect(sqls.some(s => s.includes('alert_configurations'))).toBe(false);
  });
});

// ── Connection and credential failures ───

describe('connection states', () => {
  it('no AWS account row returns null (the route reports connected:false)', async () => {
    const { result } = await readiness({ account: null });
    expect(result).toBeNull();
    expect(createClients).not.toHaveBeenCalled();
  });

  it('an STS AssumeRole failure is error with connected:true -- distinct from "no account connected"', async () => {
    const { result } = await readiness({
      clients: new Error('AWS_NOT_CONNECTED: org has not connected an AWS account'),
      inventory: [resourceRow(CURRENT_EC2)],
    });
    expect(result).not.toBeNull();
    expect(result.connected).toBe(true);
    expect(result.state).toBe('error');
    expect(result.reason).toBe('the connected AWS role could not be assumed');
    expect(result.readiness_score).toBeNull();
    expect(result.components.alert_coverage.ec2.state).toBe('error');
    expect(result.alarms.state).toBe('error');
  });

  it('disabled clients are the same credential error', async () => {
    const { result } = await readiness({ clients: { enabled: false } });
    expect(result.state).toBe('error');
    expect(result.connected).toBe(true);
  });

  it('a failed account lookup is error with connected:null', async () => {
    const { result } = await readiness({ account: new Error('connection terminated') });
    expect(result.connected).toBeNull();
    expect(result.state).toBe('error');
    expect(result.readiness_score).toBeNull();
  });

  it('a failed inventory read is error, never a zero-resource result', async () => {
    const { result } = await readiness({ inventory: new Error('relation "aws_resources" does not exist') });
    expect(result.state).toBe('error');
    expect(result.reason).toBe('the DevControl resource inventory could not be read');
    expect(result.readiness_score).toBeNull();
  });
});

// ── Components ───────────────────────────

describe('components', () => {
  it('only EC2/RDS alert coverage is measured; every other component is not_supported with no score, and there is no Critical Coverage component', async () => {
    const { result } = await readiness({ inventory: [resourceRow(CURRENT_EC2)], alarmPages: [[ec2Alarm('a', CURRENT_EC2)]] });
    const c = result.components;
    expect(Object.keys(c).sort()).toEqual(['alert_coverage', 'monitoring_coverage', 'response_config', 'signal_freshness']);
    expect(Object.keys(c.alert_coverage).sort()).toEqual(['alb', 'ec2', 'lambda', 'rds']);
    for (const section of [c.alert_coverage.alb, c.alert_coverage.lambda, c.monitoring_coverage, c.signal_freshness, c.response_config]) {
      expect(section.state).toBe('not_supported');
      expect(section.data).toBeNull();
    }
    expect(c.alert_coverage.alb.reason).toBe('discovery failures for this type are not recorded');
    expect(c.alert_coverage.lambda.reason).toBe('discovery failures for this type are not recorded');
    expect(JSON.stringify(result)).not.toMatch(/critical_coverage/i);
  });

  it('RDS excluded from the discovery plan is not_supported and the score comes from EC2 alone', async () => {
    const { result } = await readiness({
      run: runRow({ resource_types: ['ec2', 's3'] }),
      inventory: [resourceRow(CURRENT_EC2)],
      alarmPages: [[ec2Alarm('a', CURRENT_EC2), rdsAlarm('db-cpu', RDS_ID)]],
    });
    expect(result.components.alert_coverage.rds.state).toBe('not_supported');
    expect(result.readiness_score).toBe(100);
    expect(result.reason).toMatch(/^Measures EC2 alert coverage only \(1 of 1 in-scope resources covered\)/);
    // RDS alarms cannot be judged orphaned without RDS inventory.
    expect(result.alarms.state).toBe('partial');
    expect(result.alarms.data!.unevaluated).toBe(1);
    expect(result.alarms.data!.orphaned).toEqual([]);
  });

  it('EC2 and RDS are combined by resource count, not averaged by type', async () => {
    const { result } = await readiness({
      inventory: [
        resourceRow(CURRENT_EC2), resourceRow(SECOND_EC2), resourceRow('i-0dd1a2b3c4e5f6071'),
        resourceRow(RDS_ID, { type: 'rds', status: 'available' }),
      ],
      alarmPages: [[rdsAlarm('db-cpu', RDS_ID)]],
    });
    // 1 of 4 covered = 25% (a per-type average would be 50%).
    expect(result.readiness_score).toBe(25);
    expect(result.state).toBe('partial');
    expect(result.status).toBe('At Risk');
    expect(result.reason).toMatch(/^Measures EC2 and RDS alert coverage only \(1 of 4 in-scope resources covered\); monitoring coverage, signal freshness, response setup, and ALB\/Lambda alert coverage are not supported yet\.$/);
  });
});

// ── Hard rule ────────────────────────────

describe('no component can earn credit without an inventory-matched current resource', () => {
  const qualifyingOnPhantoms = [
    ec2Alarm('phantom-1', REPLACED_EC2),
    ec2Alarm('phantom-2', 'i-0bbbbbbbbbbbbbbbb'),
    rdsAlarm('phantom-db', 'retired-db'),
    alarm('phantom-2dim', { dimensions: [{ Name: 'InstanceType', Value: 't3.micro' }, { Name: 'InstanceId', Value: 'i-0ccccccccccccccccc' }] }),
  ];

  it('any number of qualifying alarms on non-inventory targets never raises the score', async () => {
    const inventory = [resourceRow(CURRENT_EC2), resourceRow(SECOND_EC2)];
    const base = (await readiness({ inventory, alarmPages: [[ec2Alarm('real', CURRENT_EC2)]] })).result;
    const withPhantoms = (await readiness({ inventory, alarmPages: [[ec2Alarm('real', CURRENT_EC2), ...qualifyingOnPhantoms]] })).result;
    expect(base.readiness_score).toBe(50);
    expect(withPhantoms.readiness_score).toBe(50);
    expect(withPhantoms.alarms.data!.orphaned).toHaveLength(qualifyingOnPhantoms.length);
  });

  it('with no in-scope inventory, qualifying alarms yield a null score -- not 100', async () => {
    const { result } = await readiness({ inventory: [], alarmPages: [qualifyingOnPhantoms] });
    expect(result.readiness_score).toBeNull();
  });

  it('alarms on stale (not re-seen) or other-region rows earn nothing', async () => {
    const { result } = await readiness({
      inventory: [
        resourceRow(CURRENT_EC2),
        resourceRow(SECOND_EC2, { synced: BEFORE_RUN }),
        resourceRow(REPLACED_EC2, { region: 'us-west-2' }),
      ],
      alarmPages: [[ec2Alarm('stale', SECOND_EC2), ec2Alarm('elsewhere', REPLACED_EC2)]],
    });
    expect(result.readiness_score).toBe(0);
  });
});

// ── Production-shaped scenario ───────────

describe('production-shaped evidence', () => {
  it('one current EC2, all EC2 alarms on a replaced instance, no RDS inventory: EC2 0%, RDS not applicable, alarms orphaned', async () => {
    const replacedAlarms = Array.from({ length: 9 }, (_, i) => ec2Alarm(`web-${i}`, REPLACED_EC2));
    const rdsAlarms = [rdsAlarm('db-cpu-high', RDS_ID), rdsAlarm('db-storage-low', RDS_ID)];
    const { result } = await readiness({
      inventory: [resourceRow(CURRENT_EC2)],
      alarmPages: [[...replacedAlarms, ...rdsAlarms]],
    });
    expect(result.connected).toBe(true);
    expect(result.state).toBe('partial');
    expect(result.readiness_score).toBe(0);
    expect(result.status).toBe('At Risk');
    expect(result.components.alert_coverage.ec2.data).toMatchObject({ inScope: 1, covered: 0, coveragePercent: 0 });
    expect(result.components.alert_coverage.rds.state).toBe('available');
    expect(result.components.alert_coverage.rds.data).toMatchObject({ applicable: false, inScope: 0, coveragePercent: null });
    expect(result.alarms.data!.orphaned).toHaveLength(11);
    expect(result.discovery_run).toEqual({
      id: '9d2e7f10-4c3b-4a1e-8f5d-2b6c9a0e1f34', status: 'completed', startedAt: RUN_STARTED, completedAt: RUN_COMPLETED,
    });
  });
});
