/**
 * POST /api/cost-recommendations/:id/execute-remediation when the
 * ENABLE_AUTOMATED_REMEDIATION kill-switch stops execution (DRY_RUN_MODE).
 *
 * Nothing runs, so the request must not succeed: it answers 400, the
 * recommendation stays ACTIVE, and the workflow it created and approved is
 * closed as 'failed' rather than left approved and executable. With the
 * kill-switch on, the instance is stopped and the recommendation resolved,
 * as before.
 *
 * Real routes and real authentication (see role-gate-harness.ts) against
 * live Postgres. Stubbed: the STS and EC2 clients -- no test reaches AWS.
 *
 * Both execute endpoints are limited to 10 requests an hour per caller
 * address, and every request here comes from one address: this file sends
 * at most 4 to each.
 */
import { STSClient } from '@aws-sdk/client-sts';
import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  CreateSnapshotCommand,
} from '@aws-sdk/client-ec2';
import costRecommendationsRoutes from '../cost-recommendations.routes';
import { createRemediationRoutes } from '../remediation.routes';
import { RemediationService } from '../../services/remediation.service';
import { pool as appPool } from '../../config/database';
import { RoleGateOrg, createRoleGateHarness } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const harness = createRoleGateHarness('execute-remediation-dry-run');
const { pool, sendAs } = harness;
const ORIGINAL_ENV = { ...process.env };

let org: RoleGateOrg;
let stsSend: jest.SpyInstance;
let ec2Send: jest.SpyInstance;

function instanceId(): string {
  return `i-${Math.random().toString(16).slice(2, 12).padEnd(10, '0')}`;
}

async function insertRecommendation(): Promise<{ id: string; resourceId: string }> {
  const resourceId = instanceId();
  const { rows } = await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, severity, aws_region)
     VALUES ($1, $2, 'EC2', 'Idle Instance', 'LOW', 'us-east-1') RETURNING id`,
    [org.orgId, resourceId]
  );
  return { id: rows[0].id as string, resourceId };
}

async function recommendationRow(id: string) {
  const { rows } = await pool.query('SELECT status, resolved_at FROM cost_recommendations WHERE id = $1', [id]);
  return rows[0];
}

async function workflowsFor(recommendationId: string) {
  const { rows } = await pool.query(
    `SELECT id, status, executed_at, execution_log FROM remediation_workflows
      WHERE recommendation_id = $1 ORDER BY created_at`,
    [recommendationId]
  );
  return rows;
}

async function auditTrail(workflowId: string) {
  const { rows } = await pool.query(
    `SELECT old_status, new_status, note FROM remediation_audit_log WHERE workflow_id = $1 ORDER BY changed_at, id`,
    [workflowId]
  );
  return rows;
}

/** A stored workflow, written directly so it can be in any state. */
async function insertWorkflow(status: string): Promise<string> {
  const resourceId = instanceId();
  const { rows } = await pool.query(
    `INSERT INTO remediation_workflows
       (organization_id, resource_id, resource_type, action_type, action_params, risk_level, status)
     VALUES ($1, $2, 'EC2', 'stop_instance', $3, 'low', $4) RETURNING id`,
    [org.orgId, resourceId, JSON.stringify({ resource_id: resourceId, region: 'us-east-1' }), status]
  );
  return rows[0].id as string;
}

/** The stored workflow row. Throws unless there is exactly one, so a comparison can never be undefined to undefined. */
async function workflowRow(id: string) {
  const { rows } = await pool.query('SELECT * FROM remediation_workflows WHERE id = $1', [id]);
  if (rows.length !== 1) throw new Error(`expected one remediation_workflows row for ${id}, found ${rows.length}`);
  return rows[0];
}

const executeRemediation = (recommendationId: string) =>
  sendAs(org.orgId, org.owner, 'POST', `/cost-recommendations/${recommendationId}/execute-remediation`);

const awsCommands = <T>(type: new (...args: any[]) => T): T[] =>
  ec2Send.mock.calls.map(([command]) => command).filter((command) => command instanceof type);

function expectNoAwsCall() {
  expect(stsSend).not.toHaveBeenCalled();
  expect(ec2Send).not.toHaveBeenCalled();
  expect(awsCommands(StopInstancesCommand)).toHaveLength(0);
  expect(awsCommands(StartInstancesCommand)).toHaveLength(0);
  expect(awsCommands(CreateSnapshotCommand)).toHaveLength(0);
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await ensureSharedFixtureTable(pool, 'remediation_workflows');
  await ensureSharedFixtureTable(pool, 'remediation_audit_log');
  org = await harness.buildOrg();
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, status)
     VALUES ($1, 'arn:aws:iam::000000000000:role/execute-remediation-dry-run', $2, 'dry-run-external-id', 'active')`,
    [org.orgId, `${Date.now()}`.slice(-12)]
  );
  await harness.listen((app) => {
    app.use('/api/cost-recommendations', costRecommendationsRoutes);
    // The same factory, mounted at the same path, as server.ts.
    app.use('/api/remediation', createRemediationRoutes(appPool));
  });
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});

  delete process.env.ENABLE_AUTOMATED_REMEDIATION;
  delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
  delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;
  process.env.AWS_ACCESS_KEY_ID = 'dummy-access-key';
  process.env.AWS_SECRET_ACCESS_KEY = 'dummy-secret-key';

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

describe('kill-switch off (DRY_RUN_MODE): nothing is executed and nothing claims it was', () => {
  it.each([
    ['unset', undefined],
    ["'false'", 'false'],
  ])('ENABLE_AUTOMATED_REMEDIATION %s: 400, recommendation ACTIVE, workflow closed as failed, no AWS call', async (_label, flag) => {
    if (flag !== undefined) process.env.ENABLE_AUTOMATED_REMEDIATION = flag;
    const recommendation = await insertRecommendation();

    const response = await executeRemediation(recommendation.id);

    expect(response.status).toBe(400);
    const body = await response.json();
    expect(body.success).toBe(false);
    expect(body.error).toMatch(/^DRY_RUN_MODE:.*No AWS action was taken/);
    expect(body.message).toBeUndefined();

    expect(await recommendationRow(recommendation.id)).toEqual({ status: 'ACTIVE', resolved_at: null });

    const workflows = await workflowsFor(recommendation.id);
    expect(workflows).toHaveLength(1);
    expect(body.data).toEqual({ workflowId: workflows[0].id });
    expect(workflows[0].status).toBe('failed');
    expect(workflows[0].executed_at).toBeNull();
    expect(workflows[0].execution_log).toMatch(/Not executed: DRY_RUN_MODE:.*No AWS action was taken/);
    expect((await auditTrail(workflows[0].id)).map((row) => [row.old_status, row.new_status])).toEqual([
      [null, 'pending_approval'],
      ['pending_approval', 'approved'],
      ['approved', 'failed'],
    ]);

    expectNoAwsCall();
  });
});

describe('a repeated attempt after a prevented execution', () => {
  it('cannot make the remediation look completed, and the closed workflow cannot be executed later', async () => {
    const recommendation = await insertRecommendation();

    expect((await executeRemediation(recommendation.id)).status).toBe(400);
    // The recommendation is still ACTIVE, so a retry is allowed -- and is
    // refused the same way.
    expect((await executeRemediation(recommendation.id)).status).toBe(400);

    expect(await recommendationRow(recommendation.id)).toEqual({ status: 'ACTIVE', resolved_at: null });
    const workflows = await workflowsFor(recommendation.id);
    expect(workflows.map((workflow) => workflow.status)).toEqual(['failed', 'failed']);

    // Even once the kill-switch is turned on, neither closed workflow can be
    // run from the Remediation page's execute endpoint.
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    for (const workflow of workflows) {
      const response = await sendAs(org.orgId, org.owner, 'POST', `/remediation/${workflow.id}/execute`);
      expect(response.status).toBe(400);
      expect((await response.json()).error).toBe('Workflow must be approved before executing. Current status: failed');
    }

    expect((await workflowsFor(recommendation.id)).map((workflow) => workflow.status)).toEqual(['failed', 'failed']);
    expect(await recommendationRow(recommendation.id)).toEqual({ status: 'ACTIVE', resolved_at: null });
    expectNoAwsCall();
  });
});

describe('kill-switch on: execution still stops the instance and resolves the recommendation', () => {
  it('answers 200, stops exactly the recommended instance, workflow completed, recommendation RESOLVED', async () => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    const recommendation = await insertRecommendation();

    const response = await executeRemediation(recommendation.id);

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.message).toBe(`Instance ${recommendation.resourceId} stopped successfully.`);
    expect(body.data.recommendation.status).toBe('RESOLVED');
    expect(body.data.workflow.status).toBe('completed');

    const stops = awsCommands(StopInstancesCommand);
    expect(stops).toHaveLength(1);
    expect(stops[0].input.InstanceIds).toEqual([recommendation.resourceId]);

    const recommendationAfter = await recommendationRow(recommendation.id);
    expect(recommendationAfter.status).toBe('RESOLVED');
    expect(recommendationAfter.resolved_at).not.toBeNull();
    const workflows = await workflowsFor(recommendation.id);
    expect(workflows).toHaveLength(1);
    expect(workflows[0].status).toBe('completed');
    expect(workflows[0].executed_at).not.toBeNull();
  });
});

describe('closeUnexecuted closes a workflow only while it is still approved', () => {
  const service = new RemediationService(appPool);
  const REASON = 'DRY_RUN_MODE: Automated remediation is disabled. No AWS action was taken.';

  it('a repeated close changes nothing and writes no second audit row', async () => {
    const id = await insertWorkflow('approved');

    expect((await service.closeUnexecuted(id, org.orgId, org.owner, REASON)).status).toBe('failed');
    const closed = await workflowRow(id);
    expect((await service.closeUnexecuted(id, org.orgId, org.owner, REASON)).status).toBe('failed');

    expect(await workflowRow(id)).toEqual(closed);
    expect((await auditTrail(id)).map((row) => [row.old_status, row.new_status])).toEqual([['approved', 'failed']]);
  });

  it.each(['pending_approval', 'executing', 'completed', 'rejected', 'rolled_back'])(
    'leaves a %s workflow exactly as it is, unaudited',
    async (status) => {
      const id = await insertWorkflow(status);
      const before = await workflowRow(id);

      expect((await service.closeUnexecuted(id, org.orgId, org.owner, REASON)).status).toBe(status);

      expect(await workflowRow(id)).toEqual(before);
      expect(await auditTrail(id)).toEqual([]);
    }
  );

  it('answers another organization’s workflow as not found, changing nothing', async () => {
    const id = await insertWorkflow('approved');

    await expect(
      service.closeUnexecuted(id, '00000000-0000-4000-8000-0000000000aa', org.owner, REASON)
    ).rejects.toThrow('Workflow not found');

    expect((await workflowRow(id)).status).toBe('approved');
    expect(await auditTrail(id)).toEqual([]);
  });
});
