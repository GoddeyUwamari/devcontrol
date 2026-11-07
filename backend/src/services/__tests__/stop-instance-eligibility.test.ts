/**
 * FP PR 2a: "stop instance" is refused unless the workflow is backed by its
 * organization's ACTIVE EC2 Idle Instance finding for the same instance,
 * carrying the allow-listed marker metadata.rule_version === 2. Missing,
 * unknown or older markers, missing findings and workflows with no finding
 * are refused. Checked at create, approve, execute (before the kill-switch)
 * and again in the dispatcher immediately before the AWS call, each time from
 * a fresh read. A refusal is audited with the actor, and the request is
 * refused even if the audit write fails.
 *
 * Mock-only: a fake Pool and spied SDK clients, no network. The routes and
 * live Postgres are covered in routes/__tests__/stop-instance-*.test.ts.
 */
import { EC2Client, StopInstancesCommand, CreateSnapshotCommand } from '@aws-sdk/client-ec2';
import {
  STOP_ELIGIBLE_IDLE_RULE_VERSIONS,
  STOP_NOT_ELIGIBLE_PREFIX,
  STOP_NOT_ELIGIBLE_PUBLIC_MESSAGE,
  judgeStopEligibility,
  judgeStopMarker,
  isStopRefusal,
  type StopFindingRow,
} from '../stop-instance-eligibility';
import { RemediationService } from '../remediation.service';
import { publicRemediationMessage } from '../remediation-public-message';
import costOptimizationService from '../cost-optimization.service';
import { eligibleStopFindingRow, isStopFindingRead } from '../../routes/__tests__/eligible-stop-finding';
import { lowActivityMetadata } from './helpers/low-activity-fixture';
import { fakeAutoScaling, fakeClassicElb, fakeCloudWatch, fakeEc2, fakeElb } from './helpers/low-activity-aws';

const ORG = '00000000-0000-4000-8000-0000000000a1';
const REC = '00000000-0000-4000-8000-0000000000a2';
const WF = '00000000-0000-4000-8000-0000000000a3';
const USER = '00000000-0000-4000-8000-0000000000a4';
const INSTANCE = 'i-1234567890abcdef0';

function finding(overrides: Partial<StopFindingRow> = {}): StopFindingRow {
  return { ...eligibleStopFindingRow(REC, INSTANCE), ...overrides } as StopFindingRow;
}

const judge = (f: StopFindingRow | null, recommendationId: string | null | undefined = REC, resourceId = INSTANCE) =>
  judgeStopEligibility({ resourceId, recommendationId, finding: f });

describe('the rule', () => {
  it('permits only the allow-listed marker, and the allow-list is exactly [2]', () => {
    expect(STOP_ELIGIBLE_IDLE_RULE_VERSIONS).toEqual([2]);
    expect(judge(finding())).toEqual({ eligible: true });
  });

  it.each([undefined, null, ''])('(d) refuses a stop with no finding attached (%p)', (recommendationId) => {
    const direct = (f: StopFindingRow | null) =>
      judgeStopEligibility({ resourceId: INSTANCE, recommendationId: recommendationId as any, finding: f });
    expect(direct(null)).toEqual({ eligible: false, reason: 'no_finding' });
    // ...even if a finding row were somehow supplied.
    expect(direct(finding())).toEqual({ eligible: false, reason: 'no_finding' });
  });

  it('refuses a finding that was not found, or is a different row', () => {
    expect(judge(null)).toEqual({ eligible: false, reason: 'finding_not_found' });
    expect(judge(finding({ id: '00000000-0000-4000-8000-0000000000ff' }))).toEqual({ eligible: false, reason: 'finding_not_found' });
  });

  it('(c) refuses a finding for a different instance', () => {
    expect(judge(finding({ resource_id: 'i-0123456789abcdef0' }))).toEqual({ eligible: false, reason: 'finding_mismatch' });
  });

  it.each([
    ['another issue', { issue: 'Unattached EBS Volume' }],
    ['another resource type', { resource_type: 'RDS' }],
    ['the resource type in another case', { resource_type: 'ec2' }],
  ])('refuses a marked finding with %s', (_label, change) => {
    expect(judge(finding(change))).toEqual({ eligible: false, reason: 'finding_mismatch' });
  });

  it.each(['RESOLVED', 'DISMISSED', 'active', ''])('(b) refuses a marked finding whose status is %p', (status) => {
    expect(judge(finding({ status }))).toEqual({ eligible: false, reason: 'finding_not_active' });
  });

  it.each([
    ['no metadata', null, 'marker_missing'],
    ['metadata as a string', '{"rule_version":2}', 'marker_missing'],
    ['metadata as an array', [{ rule_version: 2 }], 'marker_missing'],
    ['no marker (today\'s CPU-only finding)', { average_cpu: 1.2, days_analyzed: 7 }, 'marker_missing'],
    ['a null marker', { rule_version: null }, 'marker_missing'],
    ['the marker as a string', { rule_version: '2' }, 'marker_not_allowed'],
    ['the marker as a boolean', { rule_version: true }, 'marker_not_allowed'],
    ['an older marker', { rule_version: 1 }, 'marker_not_allowed'],
    ['an unknown newer marker', { rule_version: 3 }, 'marker_not_allowed'],
    ['a fractional marker', { rule_version: 2.5 }, 'marker_not_allowed'],
    ['the marker nested elsewhere', { cpu_evidence: { rule_version: 2 } }, 'marker_missing'],
    ['the marker wrapped in an object', { rule_version: { v: 2 } }, 'marker_not_allowed'],
  ])('(a) refuses a finding with %s', (_label, metadata, reason) => {
    expect(judge(finding({ metadata }))).toEqual({ eligible: false, reason });
    expect(judgeStopMarker(metadata)).toEqual({ eligible: false, reason });
  });

  it('refuses the 37 historical RESOLVED Idle rows whatever their metadata', () => {
    for (const metadata of [{}, { average_cpu: 3.4 }, { rule_version: 2 }]) {
      expect(judge(finding({ status: 'RESOLVED', metadata })).eligible).toBe(false);
    }
  });
});

describe('FP PR 2b: the low-activity detector sets the marker only on its own findings', () => {
  // PR 2a pinned "today's idle detector never sets the marker"; PR 2b changes it on purpose.
  const NOW = new Date('2026-11-07T15:00:00Z');
  const run = async (metrics: Record<string, any> = {}, launch = new Date('2026-09-01T00:00:00Z')) => {
    const clients = {
      ec2: fakeEc2([{ InstanceId: INSTANCE, InstanceType: 't3.micro', LaunchTime: launch }]),
      cloudWatch: fakeCloudWatch(NOW, metrics), elb: fakeElb({}), elbClassic: fakeClassicElb({}), autoScaling: fakeAutoScaling({}),
    };
    return (costOptimizationService as any).detectLowActivityEC2Instances(clients, 'us-east-1', NOW);
  };
  const asFinding = (metadata: unknown): StopFindingRow => ({ id: REC, resource_id: INSTANCE, resource_type: 'EC2', issue: 'Idle Instance', status: 'ACTIVE', metadata });

  it('a low-activity finding carries rule_version 2 and is eligible while its evidence is fresh', async () => {
    const result = await run();
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].metadata.rule_version).toBe(2);
    expect(judgeStopEligibility({ resourceId: INSTANCE, recommendationId: REC, finding: asFinding(result.issues[0].metadata), now: NOW })).toEqual({ eligible: true });
  });

  it('a not-low-activity or couldn\'t-check instance produces nothing to stop', async () => {
    expect((await run({ [INSTANCE]: { cpu: () => 40 } })).issues).toEqual([]);
    expect((await run({}, new Date('2026-11-01T00:00:00Z'))).issues).toEqual([]);
  });
});

describe('FP PR 2b condition 7: the low-activity evidence must be recent (FP2b-Q13)', () => {
  const NOW = new Date('2026-11-07T15:00:00Z');
  const at = (hoursAgo: number) => new Date(NOW.getTime() - hoursAgo * 3_600_000);
  const marked = (evaluatedAt: Date) => finding({ metadata: lowActivityMetadata({ evaluatedAt }) });

  it.each([0, 1, 12.9, 13])('evaluated %p h ago: eligible', (hours) => {
    expect(judgeStopEligibility({ resourceId: INSTANCE, recommendationId: REC, finding: marked(at(hours)), now: NOW })).toEqual({ eligible: true });
  });

  it.each([13.01, 24, 24 * 30])('evaluated %p h ago: refused as stale', (hours) => {
    expect(judgeStopEligibility({ resourceId: INSTANCE, recommendationId: REC, finding: marked(at(hours)), now: NOW })).toEqual({ eligible: false, reason: 'evidence_stale' });
  });

  it('an evaluation time well in the future is refused; a few minutes of clock skew is not', () => {
    expect(judgeStopEligibility({ resourceId: INSTANCE, recommendationId: REC, finding: marked(at(-1)), now: NOW })).toEqual({ eligible: false, reason: 'evidence_stale' });
    expect(judgeStopEligibility({ resourceId: INSTANCE, recommendationId: REC, finding: marked(at(-0.05)), now: NOW })).toEqual({ eligible: true });
  });

  it.each([
    ['no evidence at all (marker only)', { rule_version: 2 }],
    ['no evaluation time', { rule_version: 2, low_activity: {} }],
    ['an unparseable evaluation time', { rule_version: 2, low_activity: { evaluated_at: 'yesterday' } }],
    ['a numeric evaluation time', { rule_version: 2, low_activity: { evaluated_at: Date.now() } }],
    ['evidence as an array', { rule_version: 2, low_activity: [{ evaluated_at: NOW.toISOString() }] }],
  ])('%s: refused as stale', (_label, metadata) => {
    expect(judgeStopEligibility({ resourceId: INSTANCE, recommendationId: REC, finding: finding({ metadata }), now: NOW })).toEqual({ eligible: false, reason: 'evidence_stale' });
  });

  it('the marker is still checked first: fresh evidence never rescues an older marker', () => {
    const metadata = { ...lowActivityMetadata({ evaluatedAt: NOW }), rule_version: 1 };
    expect(judgeStopEligibility({ resourceId: INSTANCE, recommendationId: REC, finding: finding({ metadata }), now: NOW })).toEqual({ eligible: false, reason: 'marker_not_allowed' });
  });

  it('judges against the current time when none is passed', () => {
    expect(judgeStopEligibility({ resourceId: INSTANCE, recommendationId: REC, finding: finding({ metadata: lowActivityMetadata({ evaluatedAt: new Date(Date.now() - 14 * 3_600_000) }) }) }))
      .toEqual({ eligible: false, reason: 'evidence_stale' });
    expect(judgeStopEligibility({ resourceId: INSTANCE, recommendationId: REC, finding: finding() })).toEqual({ eligible: true });
  });
});

describe('what the caller sees', () => {
  it('is exactly the approved sentence, never the reason', () => {
    for (const reason of ['no_finding', 'finding_not_found', 'finding_mismatch', 'finding_not_active', 'marker_missing', 'marker_not_allowed', 'no stop context']) {
      const err = new Error(`${STOP_NOT_ELIGIBLE_PREFIX} ${reason}`);
      expect(isStopRefusal(err.message)).toBe(true);
      expect(publicRemediationMessage(err, 'fallback')).toBe(
        "DevControl can't stop this instance. Stopping is only offered for low-activity findings confirmed by DevControl's current checks, and this one isn't. No change was made in AWS."
      );
      expect(STOP_NOT_ELIGIBLE_PUBLIC_MESSAGE).not.toContain(reason);
    }
  });
});

// ─── RemediationService with a fake Pool ─────────────────────────────────────

const APPROVED_STOP = {
  id: WF,
  organization_id: ORG,
  recommendation_id: REC,
  resource_id: INSTANCE,
  resource_type: 'EC2',
  action_type: 'stop_instance',
  action_params: { resource_id: INSTANCE, region: 'us-east-1' },
  estimated_savings: 5,
  risk_level: 'low',
  status: 'approved',
  rollback_available: false,
  execution_log: null,
};

/**
 * A Pool answering the workflow read with `workflow`, and each finding read
 * with the next entry of `findings` (the last one repeats). Every other query
 * answers with the workflow row.
 */
function fakePool(workflow: Record<string, unknown>, findings: Array<StopFindingRow | null>) {
  let reads = 0;
  const query = jest.fn(async (sql: string) => {
    if (isStopFindingRead(sql)) {
      const row = findings[Math.min(reads, findings.length - 1)];
      reads += 1;
      return { rows: row ? [row] : [] };
    }
    if (/FROM aws_resources/.test(sql)) return { rows: [{ region: 'us-east-1' }] };
    if (/FROM aws_accounts/.test(sql)) {
      return { rows: [{ role_arn: 'arn:aws:iam::111122223333:role/devcontrol-remediation', account_id: '111122223333', external_id: 'external-id-1', status: 'active' }] };
    }
    if (/SELECT resource_id, aws_region FROM cost_recommendations/.test(sql)) return { rows: [{ resource_id: INSTANCE, aws_region: null }] };
    if (/INSERT INTO remediation_workflows/.test(sql)) return { rows: [{ ...workflow, id: WF, status: 'pending_approval' }] };
    return { rows: [workflow], rowCount: 1 };
  });
  return { query, findingReads: () => reads } as any;
}

const writes = (pool: { query: jest.Mock }) =>
  pool.query.mock.calls.filter(([sql]: [string]) => /^\s*(INSERT|UPDATE|DELETE)/.test(sql));

const ENV_BEFORE = { ...process.env };
let ec2Send: jest.SpyInstance;

beforeEach(() => {
  process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
  delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
  delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  ec2Send = jest.spyOn(EC2Client.prototype, 'send').mockImplementation(async () => ({}) as any);
});

afterEach(() => {
  process.env = { ...ENV_BEFORE };
  jest.restoreAllMocks();
});

describe('each stage refuses an ineligible stop before writing or calling AWS', () => {
  const unmarked = finding({ metadata: { average_cpu: 1 } });

  it('create: no workflow row, one audit record with the actor', async () => {
    const pool = fakePool(APPROVED_STOP, [unmarked]);
    const audit = { record: jest.fn(async (_event: any) => undefined) };
    const service = new RemediationService(pool, audit);

    await expect(
      service.createWorkflow(ORG, {
        recommendationId: REC, resourceId: INSTANCE, resourceType: 'EC2', actionType: 'stop_instance',
        actionParams: {}, estimatedSavings: 5, riskLevel: 'low',
      }, USER, { path: 'remediation_workflow', request: { ipAddress: '203.0.113.7', userAgent: 'test-agent' } })
    ).rejects.toThrow(`${STOP_NOT_ELIGIBLE_PREFIX} marker_missing`);

    expect(writes(pool)).toEqual([]);
    expect(audit.record).toHaveBeenCalledTimes(1);
    expect(audit.record).toHaveBeenCalledWith({
      organizationId: ORG,
      actorId: USER,
      action: 'remediation.stop_refused',
      resourceType: 'cost_recommendation',
      resourceId: REC,
      metadata: {
        stage: 'create',
        path: 'remediation_workflow',
        reason: 'marker_missing',
        workflow_id: null,
        recommendation_id: REC,
        instance_id: INSTANCE,
        rule_version_seen: 'missing',
      },
      request: { ipAddress: '203.0.113.7', userAgent: 'test-agent' },
    });
  });

  it('create with no finding attached: refused, audited with no resource id', async () => {
    const pool = fakePool(APPROVED_STOP, [finding()]);
    const audit = { record: jest.fn(async (_event: any) => undefined) };

    await expect(
      new RemediationService(pool, audit).createWorkflow(ORG, {
        resourceId: INSTANCE, resourceType: 'EC2', actionType: 'stop_instance', actionParams: {}, estimatedSavings: 0, riskLevel: 'low',
      }, USER)
    ).rejects.toThrow(`${STOP_NOT_ELIGIBLE_PREFIX} no_finding`);

    expect(pool.findingReads()).toBe(0);
    expect(writes(pool)).toEqual([]);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      resourceType: 'remediation_workflow',
      resourceId: null,
      metadata: { stage: 'create', reason: 'no_finding', recommendation_id: null, rule_version_seen: 'no_finding' },
    });
  });

  it('approve: status unchanged, audited against the workflow', async () => {
    const pool = fakePool({ ...APPROVED_STOP, status: 'pending_approval' }, [finding({ status: 'RESOLVED' })]);
    const audit = { record: jest.fn(async (_event: any) => undefined) };

    await expect(new RemediationService(pool, audit).approve(WF, ORG, USER, '203.0.113.7')).rejects.toThrow(
      `${STOP_NOT_ELIGIBLE_PREFIX} finding_not_active`
    );

    expect(writes(pool)).toEqual([]);
    expect(audit.record.mock.calls[0][0]).toMatchObject({
      actorId: USER,
      resourceType: 'remediation_workflow',
      resourceId: WF,
      metadata: { stage: 'approve', reason: 'finding_not_active', workflow_id: WF, rule_version_seen: 'number:2' },
      request: { ipAddress: '203.0.113.7', userAgent: null },
    });
  });

  it.each([undefined, 'true'])('execute (kill-switch %p): refused before the kill-switch, status unchanged, no AWS', async (flag) => {
    if (flag === undefined) delete process.env.ENABLE_AUTOMATED_REMEDIATION;
    const pool = fakePool(APPROVED_STOP, [finding({ metadata: { rule_version: 1 } })]);
    const audit = { record: jest.fn(async (_event: any) => undefined) };
    const service = new RemediationService(pool, audit);
    const getCreds = jest.spyOn(service as any, 'getAWSCredentials');

    const attempt = service.execute(WF, ORG, USER);
    await expect(attempt).rejects.toThrow(`${STOP_NOT_ELIGIBLE_PREFIX} marker_not_allowed`);
    await attempt.catch((err) => expect(err.message).not.toMatch(/DRY_RUN_MODE/));

    expect(writes(pool)).toEqual([]);
    expect(getCreds).not.toHaveBeenCalled();
    expect(ec2Send).not.toHaveBeenCalled();
    expect(audit.record.mock.calls[0][0].metadata).toMatchObject({ stage: 'execute', reason: 'marker_not_allowed', rule_version_seen: 'number:1' });
  });

  it('execute: a workflow with no finding attached is refused (stored before PR 2a)', async () => {
    const pool = fakePool({ ...APPROVED_STOP, recommendation_id: null }, [finding()]);

    await expect(new RemediationService(pool, { record: jest.fn() }).execute(WF, ORG, USER)).rejects.toThrow(
      `${STOP_NOT_ELIGIBLE_PREFIX} no_finding`
    );
    expect(writes(pool)).toEqual([]);
  });

  it('execute: a finding deleted since approval (rescan) is refused', async () => {
    const pool = fakePool(APPROVED_STOP, [null]);

    await expect(new RemediationService(pool, { record: jest.fn() }).execute(WF, ORG, USER)).rejects.toThrow(
      `${STOP_NOT_ELIGIBLE_PREFIX} finding_not_found`
    );
    expect(writes(pool)).toEqual([]);
  });
});

describe('the audit write never decides the refusal', () => {
  it.each([
    ['rejects', () => Promise.reject(new Error('audit_logs unavailable'))],
    ['throws synchronously', () => { throw new Error('audit_logs unavailable'); }],
  ])('a writer that %s: still refused with the same error, nothing written, no AWS', async (_label, record) => {
    const pool = fakePool(APPROVED_STOP, [finding({ metadata: {} })]);
    const service = new RemediationService(pool, { record: jest.fn(record as any) });

    await expect(service.execute(WF, ORG, USER)).rejects.toThrow(`${STOP_NOT_ELIGIBLE_PREFIX} marker_missing`);
    expect(writes(pool)).toEqual([]);
    expect(ec2Send).not.toHaveBeenCalled();
  });

  it('the default writer, on a pool it cannot connect to, still refuses', async () => {
    const pool = fakePool(APPROVED_STOP, [finding({ metadata: {} })]);
    pool.connect = jest.fn(async () => { throw new Error('connection refused'); });

    await expect(new RemediationService(pool).execute(WF, ORG, USER)).rejects.toThrow(`${STOP_NOT_ELIGIBLE_PREFIX} marker_missing`);
    expect(pool.connect).toHaveBeenCalled();
    expect(ec2Send).not.toHaveBeenCalled();
  });
});

describe('immediately before the AWS call the finding is read again', () => {
  function stubAws(service: RemediationService) {
    jest.spyOn(service as any, 'getAWSCredentials').mockResolvedValue({ accessKeyId: 'x', secretAccessKey: 'y', sessionToken: 'z' });
    jest.spyOn(service as any, 'assertNotDevControlInfrastructureByTag').mockResolvedValue(undefined);
  }

  it('eligible at execute, resolved by the time of the call: no snapshot, no stop, recorded as not executed', async () => {
    // Read 1 (execute stage) eligible; read 2 (dispatch) resolved.
    const pool = fakePool(APPROVED_STOP, [finding(), finding({ status: 'RESOLVED' })]);
    const audit = { record: jest.fn(async (_event: any) => undefined) };
    const service = new RemediationService(pool, audit);
    stubAws(service);
    const stop = jest.spyOn(service as any, 'stopInstance');

    await expect(service.execute(WF, ORG, USER)).rejects.toThrow(`${STOP_NOT_ELIGIBLE_PREFIX} finding_not_active`);

    expect(pool.findingReads()).toBe(2);
    expect(stop).not.toHaveBeenCalled();
    expect(ec2Send.mock.calls.map(([c]) => c).filter((c) => c instanceof StopInstancesCommand || c instanceof CreateSnapshotCommand)).toEqual([]);
    expect(audit.record.mock.calls.map(([e]: any[]) => e.metadata.stage)).toEqual(['dispatch']);
    // The record shows the public sentence, never the internal reason.
    const failed = pool.query.mock.calls.find(([sql, values]: [string, any[]]) => /UPDATE remediation_workflows/.test(sql) && values[0] === 'failed');
    expect(failed[1].join(' ')).toContain(`Not executed: ${STOP_NOT_ELIGIBLE_PUBLIC_MESSAGE}`);
    expect(failed[1].join(' ')).not.toMatch(/finding_not_active|STOP_NOT_ELIGIBLE/);
  });

  it('eligible at both reads: the stop handler runs once', async () => {
    const pool = fakePool(APPROVED_STOP, [finding()]);
    const service = new RemediationService(pool, { record: jest.fn() });
    stubAws(service);
    const stop = jest.spyOn(service as any, 'stopInstance').mockResolvedValue({ log: 'stopped' });

    await service.execute(WF, ORG, USER);

    expect(pool.findingReads()).toBe(2);
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('the dispatcher refuses a stop it is given no context for', async () => {
    const service = new RemediationService(fakePool(APPROVED_STOP, [finding()]), { record: jest.fn() });
    const stop = jest.spyOn(service as any, 'stopInstance');

    await expect(
      (service as any).dispatchAction('stop_instance', { accessKeyId: 'x', secretAccessKey: 'y', sessionToken: 'z' }, APPROVED_STOP.action_params, '', WF)
    ).rejects.toThrow(STOP_NOT_ELIGIBLE_PREFIX);
    expect(stop).not.toHaveBeenCalled();
  });
});

describe('unaffected', () => {
  it('rollback of a completed stop needs no finding: it restarts the instance', async () => {
    const pool = fakePool({ ...APPROVED_STOP, status: 'completed', rollback_available: true, recommendation_id: null }, [null]);
    const service = new RemediationService(pool, { record: jest.fn() });
    jest.spyOn(service as any, 'getAWSCredentials').mockResolvedValue({ accessKeyId: 'x', secretAccessKey: 'y', sessionToken: 'z' });

    await service.rollback(WF, ORG, USER);

    expect(pool.findingReads()).toBe(0);
    expect(ec2Send.mock.calls.some(([c]) => c.constructor.name === 'StartInstancesCommand')).toBe(true);
  });

  it.each(['delete_snapshot', 'enable_s3_lifecycle', 'delete_unused_elasticip', 'delete_unattached_volume'])(
    '%s is created with no finding and never reads one',
    async (actionType) => {
      const pool = fakePool({ ...APPROVED_STOP, action_type: actionType, recommendation_id: null }, [null]);

      await new RemediationService(pool, { record: jest.fn() }).createWorkflow(ORG, {
        resourceId: INSTANCE, resourceType: 'EC2', actionType: actionType as any, actionParams: {}, estimatedSavings: 0, riskLevel: 'low',
      });

      expect(pool.findingReads()).toBe(0);
      expect(pool.query.mock.calls.some(([sql]: [string]) => /INSERT INTO remediation_workflows/.test(sql))).toBe(true);
    }
  );
});
