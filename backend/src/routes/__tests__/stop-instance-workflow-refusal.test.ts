/**
 * FP PR 2a, the /api/remediation workflow path: a stop_instance workflow is
 * refused at create, approve and execute (and immediately before the AWS
 * call) unless it is backed by its organization's ACTIVE EC2 Idle Instance
 * finding for the same instance carrying metadata.rule_version === 2.
 *
 *   - Refusals answer 403 with exactly the approved sentence, leave the
 *     workflow's status as it was, reach no AWS, and write one audit_logs row
 *     (remediation.stop_refused) naming the actor, the stage and the reason.
 *   - The finding is read again at every stage: approved while eligible, then
 *     resolved, re-marked or deleted, and the execute is refused.
 *   - The allow-listed fixture is permitted; rollback and other actions are
 *     unaffected.
 *
 * Real routes and authentication (role-gate-harness.ts) against live
 * Postgres. Stubbed: the STS and EC2 clients -- no test reaches AWS.
 *
 * POST /:id/execute is limited to 10 requests an hour per caller address:
 * this file sends 9.
 */
import { STSClient } from '@aws-sdk/client-sts';
import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  CreateSnapshotCommand,
} from '@aws-sdk/client-ec2';
import { createRemediationRoutes } from '../remediation.routes';
import { pool as appPool } from '../../config/database';
import { RoleGateOrg, createRoleGateHarness } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import { insertEligibleStopFinding } from './eligible-stop-finding';

const harness = createRoleGateHarness('stop-instance-workflow-refusal');
const { pool, sendAs } = harness;
const ORIGINAL_ENV = { ...process.env };

const REFUSAL = {
  success: false,
  error:
    "DevControl can't stop this instance. Stopping is only offered for low-activity findings confirmed by DevControl's current checks, and this one isn't. No change was made in AWS.",
};
const REASON_TEXT = /STOP_NOT_ELIGIBLE|no_finding|finding_not_found|finding_mismatch|finding_not_active|marker_missing|marker_not_allowed/;

let org: RoleGateOrg;
let stsSend: jest.SpyInstance;
let ec2Send: jest.SpyInstance;

function instanceId(): string {
  return `i-${Math.random().toString(16).slice(2, 12).padEnd(10, '0')}`;
}

async function insertFinding(
  resourceId: string,
  options: { status?: string; metadata?: unknown; issue?: string; resourceType?: string } = {}
): Promise<string> {
  if (options.issue || options.resourceType) {
    const { rows } = await pool.query(
      `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, severity, aws_region, status, metadata)
       VALUES ($1, $2, $3, $4, 'LOW', 'us-east-1', $5, $6) RETURNING id`,
      [org.orgId, resourceId, options.resourceType ?? 'EC2', options.issue ?? 'Idle Instance', options.status ?? 'ACTIVE',
        JSON.stringify(options.metadata ?? { rule_version: 2 })]
    );
    return rows[0].id as string;
  }
  return insertEligibleStopFinding(pool, org.orgId, resourceId, { awsRegion: 'us-east-1', ...options });
}

/** A stored stop workflow, written directly as it could exist before PR 2a. */
async function insertWorkflow(status: string, recommendationId: string | null, resourceId = instanceId(), rollbackAvailable = false) {
  const { rows } = await pool.query(
    `INSERT INTO remediation_workflows
       (organization_id, recommendation_id, resource_id, resource_type, action_type, action_params, risk_level, status, rollback_available)
     VALUES ($1, $2, $3, 'EC2', 'stop_instance', $4, 'low', $5, $6) RETURNING id`,
    [org.orgId, recommendationId, resourceId, JSON.stringify({ resource_id: resourceId, region: 'us-east-1' }), status, rollbackAvailable]
  );
  return { id: rows[0].id as string, resourceId };
}

async function workflowRow(id: string) {
  const { rows } = await pool.query('SELECT * FROM remediation_workflows WHERE id = $1', [id]);
  if (rows.length !== 1) throw new Error(`expected one workflow ${id}`);
  return rows[0];
}

async function counts() {
  const { rows } = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM remediation_workflows WHERE organization_id = $1) AS workflows,
            (SELECT COUNT(*)::int FROM remediation_audit_log al JOIN remediation_workflows w ON w.id = al.workflow_id
              WHERE w.organization_id = $1) AS transitions`,
    [org.orgId]
  );
  return rows[0];
}

/** stop_refused audit rows written since `since`. */
async function refusalsSince(since: Date) {
  const { rows } = await pool.query(
    `SELECT user_id, action, resource_type, resource_id, ip_address, metadata
       FROM audit_logs
      WHERE organization_id = $1 AND action = 'remediation.stop_refused' AND created_at >= $2
      ORDER BY created_at, id`,
    [org.orgId, since]
  );
  return rows;
}

async function dbNow(): Promise<Date> {
  return (await pool.query('SELECT clock_timestamp() AS now')).rows[0].now;
}

const create = (body: Record<string, unknown>, role: 'member' | 'admin' | 'owner' = 'member') =>
  sendAs(org.orgId, org[role], 'POST', '/remediation', {
    resourceType: 'EC2', actionType: 'stop_instance', riskLevel: 'low', estimatedSavings: 9, ...body,
  });
const act = (id: string, action: 'approve' | 'execute' | 'rollback', role: 'admin' | 'owner' = 'admin') =>
  sendAs(org.orgId, org[role], 'POST', `/remediation/${id}/${action}`, {});

const awsCommands = <T>(type: new (...args: any[]) => T): T[] =>
  ec2Send.mock.calls.map(([command]) => command).filter((command) => command instanceof type);

function expectNoAwsCall() {
  expect(stsSend).not.toHaveBeenCalled();
  expect(ec2Send).not.toHaveBeenCalled();
}

async function expectRefused(response: Response) {
  expect(response.status).toBe(403);
  const text = await response.text();
  expect(JSON.parse(text)).toEqual(REFUSAL);
  expect(text).not.toMatch(REASON_TEXT);
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await ensureSharedFixtureTable(pool, 'remediation_workflows');
  await ensureSharedFixtureTable(pool, 'remediation_audit_log');
  org = await harness.buildOrg();
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, status)
     VALUES ($1, 'arn:aws:iam::000000000000:role/stop-instance-workflow-refusal', $2, 'stop-refusal-external-id', 'active')`,
    [org.orgId, `${Date.now()}`.slice(-12)]
  );
  await harness.listen((app) => {
    app.use('/api/remediation', createRemediationRoutes(appPool));
  });
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
  delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
  delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;

  stsSend = jest.spyOn(STSClient.prototype, 'send').mockImplementation(async () => ({
    Credentials: { AccessKeyId: 'stub-key', SecretAccessKey: 'stub-secret', SessionToken: 'stub-token' },
  }));
  ec2Send = jest.spyOn(EC2Client.prototype, 'send').mockImplementation(async (command: unknown) =>
    command instanceof DescribeInstancesCommand ? { Reservations: [{ Instances: [{ Tags: [] }] }] } : {}
  );
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.restoreAllMocks();
});

afterAll(async () => {
  await harness.close(async (orgIds) => {
    await pool.query('DELETE FROM remediation_workflows WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
});

describe('create refuses a stop that is not backed by an eligible finding', () => {
  it.each([undefined, null])('(d) no finding attached (%p): 403, nothing written, audited with the member', async (recommendationId) => {
    const since = await dbNow();
    const before = await counts();

    await expectRefused(await create({ resourceId: instanceId(), recommendationId }));

    expect(await counts()).toEqual(before);
    const audits = await refusalsSince(since);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      user_id: org.member,
      action: 'remediation.stop_refused',
      resource_type: 'remediation_workflow',
      resource_id: null,
      metadata: { stage: 'create', path: 'remediation_workflow', reason: 'no_finding', recommendation_id: null, workflow_id: null },
    });
    expect(audits[0].ip_address).toBeTruthy();
    expectNoAwsCall();
  });

  it.each([
    ['(a) today\'s CPU-only finding (no marker)', { metadata: { average_cpu: 1.2 } }, 'marker_missing'],
    ['(a) the marker as a string', { metadata: { rule_version: '2' } }, 'marker_not_allowed'],
    ['(a) an older marker', { metadata: { rule_version: 1 } }, 'marker_not_allowed'],
    ['(a) an unknown newer marker', { metadata: { rule_version: 3 } }, 'marker_not_allowed'],
    ['(b) a RESOLVED decision row, even with the marker', { status: 'RESOLVED' }, 'finding_not_active'],
    ['(b) a DISMISSED decision row', { status: 'DISMISSED' }, 'finding_not_active'],
    ['a marked finding for another issue on the same instance', { issue: 'Old-Generation Instance' }, 'finding_mismatch'],
  ])('%s: 403, nothing written, audited with the reason', async (_label, options, reason) => {
    const resourceId = instanceId();
    const recommendationId = await insertFinding(resourceId, options as any);
    const since = await dbNow();
    const before = await counts();

    await expectRefused(await create({ resourceId, recommendationId }));

    expect(await counts()).toEqual(before);
    const audits = await refusalsSince(since);
    expect(audits).toHaveLength(1);
    expect(audits[0]).toMatchObject({
      user_id: org.member,
      resource_type: 'cost_recommendation',
      resource_id: recommendationId,
      metadata: { stage: 'create', reason, recommendation_id: recommendationId, instance_id: resourceId },
    });
    expectNoAwsCall();
  });

  it('the allow-listed fixture is permitted: 201, no refusal recorded', async () => {
    const resourceId = instanceId();
    const recommendationId = await insertFinding(resourceId);
    const since = await dbNow();

    const response = await create({ resourceId, recommendationId });

    expect(response.status).toBe(201);
    expect((await response.json()).data).toMatchObject({ recommendation_id: recommendationId, status: 'pending_approval' });
    expect(await refusalsSince(since)).toEqual([]);
  });
});

describe('approve and execute refuse stored workflows that are not eligible', () => {
  it('approve: a pending stop with no finding (stored before PR 2a) stays pending, audited with the admin', async () => {
    const { id } = await insertWorkflow('pending_approval', null);
    const before = await workflowRow(id);
    const since = await dbNow();

    await expectRefused(await act(id, 'approve'));

    expect(await workflowRow(id)).toEqual(before);
    expect(await refusalsSince(since)).toEqual([
      expect.objectContaining({
        user_id: org.admin,
        resource_type: 'remediation_workflow',
        resource_id: id,
        metadata: expect.objectContaining({ stage: 'approve', reason: 'no_finding', workflow_id: id }),
      }),
    ]);
    expectNoAwsCall();
  });

  it.each([undefined, 'true'])(
    'execute (kill-switch %p): an approved stop on an unmarked finding is refused, not dry-run; status unchanged, no AWS',
    async (flag) => {
      if (flag === undefined) delete process.env.ENABLE_AUTOMATED_REMEDIATION;
      const resourceId = instanceId();
      const { id } = await insertWorkflow('approved', await insertFinding(resourceId, { metadata: {} }), resourceId);
      const before = await workflowRow(id);
      const since = await dbNow();

      await expectRefused(await act(id, 'execute'));

      expect(await workflowRow(id)).toEqual(before);
      expect((await refusalsSince(since)).map((row) => [row.user_id, row.metadata.stage, row.metadata.reason])).toEqual([
        [org.admin, 'execute', 'marker_missing'],
      ]);
      expectNoAwsCall();
    }
  );
});

describe('a stored workflow whose finding is for another instance', () => {
  it('(c) execute is refused: the finding must be for the instance the workflow would stop', async () => {
    const findingFor = instanceId();
    const { id } = await insertWorkflow('approved', await insertFinding(findingFor), instanceId());
    const before = await workflowRow(id);
    const since = await dbNow();

    await expectRefused(await act(id, 'execute'));

    expect(await workflowRow(id)).toEqual(before);
    expect((await refusalsSince(since)).map((row) => [row.metadata.stage, row.metadata.reason])).toEqual([['execute', 'finding_mismatch']]);
    expectNoAwsCall();
  });
});

describe('the finding is re-read at execution: approved while eligible, changed, then executed', () => {
  async function approvedEligible() {
    const resourceId = instanceId();
    const recommendationId = await insertFinding(resourceId);
    const created = await create({ resourceId, recommendationId });
    expect(created.status).toBe(201);
    const { id } = (await created.json()).data;
    expect((await act(id, 'approve')).status).toBe(200);
    return { id, resourceId, recommendationId };
  }

  it.each([
    ['resolved', `UPDATE cost_recommendations SET status = 'RESOLVED', resolved_at = NOW() WHERE id = $1`, 'finding_not_active'],
    ['re-marked with an older rule version', `UPDATE cost_recommendations SET metadata = '{"rule_version": 1}' WHERE id = $1`, 'marker_not_allowed'],
    ['deleted by a rescan', 'DELETE FROM cost_recommendations WHERE id = $1', 'finding_not_found'],
  ])('finding %s after approval: execute refused, still approved, no AWS', async (_label, change, reason) => {
    const { id, recommendationId } = await approvedEligible();
    await pool.query(change, [recommendationId]);
    const before = await workflowRow(id);
    const since = await dbNow();

    await expectRefused(await act(id, 'execute'));

    expect(await workflowRow(id)).toEqual(before);
    expect(before.status).toBe('approved');
    expect((await refusalsSince(since)).map((row) => [row.metadata.stage, row.metadata.reason])).toEqual([['execute', reason]]);
    expectNoAwsCall();
  });

  it('(e) the finding is resolved while credentials are fetched: refused immediately before the AWS call', async () => {
    const { id, recommendationId } = await approvedEligible();
    stsSend.mockImplementation(async () => {
      await pool.query(`UPDATE cost_recommendations SET status = 'RESOLVED', resolved_at = NOW() WHERE id = $1`, [recommendationId]);
      return { Credentials: { AccessKeyId: 'stub-key', SecretAccessKey: 'stub-secret', SessionToken: 'stub-token' } };
    });
    const since = await dbNow();

    await expectRefused(await act(id, 'execute'));

    expect(awsCommands(StopInstancesCommand)).toHaveLength(0);
    expect(awsCommands(CreateSnapshotCommand)).toHaveLength(0);
    const row = await workflowRow(id);
    // The attempt had started (executing), so it ends as an attempt that did not complete.
    expect(row.status).toBe('failed');
    expect(row.execution_log).toContain(`Not executed: ${REFUSAL.error}`);
    expect(row.execution_log).not.toMatch(REASON_TEXT);
    expect((await refusalsSince(since)).map((r) => [r.user_id, r.metadata.stage, r.metadata.reason])).toEqual([
      [org.admin, 'dispatch', 'finding_not_active'],
    ]);
  });

  it('the allow-listed fixture is permitted end to end: the instance is stopped once', async () => {
    const { id, resourceId } = await approvedEligible();
    const since = await dbNow();

    const response = await act(id, 'execute', 'owner');

    expect(response.status).toBe(200);
    const stops = awsCommands(StopInstancesCommand);
    expect(stops).toHaveLength(1);
    expect(stops[0].input.InstanceIds).toEqual([resourceId]);
    expect((await workflowRow(id)).status).toBe('completed');
    expect(await refusalsSince(since)).toEqual([]);
  });
});

describe('unaffected', () => {
  it('rollback of a completed stop with no finding attached still restarts the instance', async () => {
    const { id, resourceId } = await insertWorkflow('completed', null, instanceId(), true);

    const response = await act(id, 'rollback');

    expect(response.status).toBe(200);
    const starts = awsCommands(StartInstancesCommand);
    expect(starts).toHaveLength(1);
    expect(starts[0].input.InstanceIds).toEqual([resourceId]);
    expect((await workflowRow(id)).status).toBe('rolled_back');
  });

  it('another action is created and approved with no finding, and execute still answers the kill-switch', async () => {
    delete process.env.ENABLE_AUTOMATED_REMEDIATION;
    const since = await dbNow();
    const created = await create({ resourceId: 'snap-0123456789abcdef0', resourceType: 'EBS', actionType: 'delete_snapshot' });
    expect(created.status).toBe(201);
    const { id } = (await created.json()).data;
    expect((await act(id, 'approve')).status).toBe(200);

    const response = await act(id, 'execute');

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/^DRY_RUN_MODE:/);
    expect(await refusalsSince(since)).toEqual([]);
    expectNoAwsCall();
  });
});
