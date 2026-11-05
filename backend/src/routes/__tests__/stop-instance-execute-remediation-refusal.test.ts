/**
 * FP PR 2a, POST /api/cost-recommendations/:id/execute-remediation, and the
 * history it must never touch.
 *
 *   - An Idle Instance finding without the allow-listed marker
 *     (metadata.rule_version === 2) is refused with 403 and the approved
 *     sentence before any workflow is created; the recommendation is left as
 *     it is, nothing reaches AWS, and one audit_logs row names the actor.
 *   - A finding that stops being eligible while credentials are fetched is
 *     refused immediately before the AWS call.
 *   - The allow-listed fixture is still stopped and resolved.
 *   - An instance with 37 historical RESOLVED Idle Instance decision rows (the
 *     founder's case), their resolve audit rows and its detection row are
 *     byte-identical after every stop attempt on both paths.
 *
 * Real routes and authentication (role-gate-harness.ts) against live
 * Postgres. Stubbed: the STS and EC2 clients -- no test reaches AWS.
 *
 * Both execute endpoints share one limit of 10 requests an hour per caller
 * address: this file sends 8.
 */
import { STSClient } from '@aws-sdk/client-sts';
import {
  EC2Client,
  DescribeInstancesCommand,
  StopInstancesCommand,
  CreateSnapshotCommand,
} from '@aws-sdk/client-ec2';
import costRecommendationsRoutes from '../cost-recommendations.routes';
import { createRemediationRoutes } from '../remediation.routes';
import { pool as appPool } from '../../config/database';
import { RoleGateOrg, createRoleGateHarness } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';
import { insertEligibleStopFinding } from './eligible-stop-finding';

const harness = createRoleGateHarness('stop-instance-execute-remediation');
const { pool, sendAs } = harness;
const ORIGINAL_ENV = { ...process.env };

const REFUSAL_TEXT =
  "DevControl can't stop this instance. Stopping is only offered for low-activity findings confirmed by DevControl's current checks, and this one isn't. No change was made in AWS.";
const REASON_TEXT = /STOP_NOT_ELIGIBLE|no_finding|finding_not_found|finding_mismatch|finding_not_active|marker_missing|marker_not_allowed/;
const HISTORY_ROWS = 37;
/** Today's CPU-only detector metadata shape: no marker. */
const CPU_ONLY_METADATA = { instance_type: 't2.micro', average_cpu: 3.4, days_analyzed: 7, price_source: 'list_price' };

let org: RoleGateOrg;
let stsSend: jest.SpyInstance;
let ec2Send: jest.SpyInstance;
let historyInstance: string;
let historyIds: string[];
/** An ACTIVE CPU-only finding for the same instance (as a Reopen could create). */
let historyActiveId: string;
/** The history as inserted, before any request in this file. */
let historyBaseline: Awaited<ReturnType<typeof historySnapshot>>;

function instanceId(): string {
  return `i-${Math.random().toString(16).slice(2, 12).padEnd(10, '0')}`;
}

async function insertUnmarked(resourceId: string, metadata: unknown = CPU_ONLY_METADATA): Promise<string> {
  return insertEligibleStopFinding(pool, org.orgId, resourceId, { awsRegion: 'us-east-1', metadata });
}

async function recommendation(id: string) {
  const { rows } = await pool.query('SELECT * FROM cost_recommendations WHERE id = $1', [id]);
  return rows[0];
}

async function workflowsFor(recommendationId: string) {
  const { rows } = await pool.query(
    'SELECT id, status, execution_log FROM remediation_workflows WHERE recommendation_id = $1 ORDER BY created_at',
    [recommendationId]
  );
  return rows;
}

async function refusalsSince(since: Date) {
  const { rows } = await pool.query(
    `SELECT user_id, resource_type, resource_id, metadata FROM audit_logs
      WHERE organization_id = $1 AND action = 'remediation.stop_refused' AND created_at >= $2 ORDER BY created_at, id`,
    [org.orgId, since]
  );
  return rows;
}

const dbNow = async (): Promise<Date> => (await pool.query('SELECT clock_timestamp() AS now')).rows[0].now;

/** Every stored row of the history: the decisions, their resolve audit rows, the detection. */
async function historySnapshot() {
  const decisions = await pool.query(
    `SELECT * FROM cost_recommendations WHERE organization_id = $1 AND id = ANY($2) ORDER BY id`,
    [org.orgId, historyIds]
  );
  const audits = await pool.query(
    `SELECT * FROM audit_logs WHERE organization_id = $1 AND resource_id = ANY($2::uuid[]) AND action <> 'remediation.stop_refused' ORDER BY id`,
    [org.orgId, historyIds]
  );
  const detections = await pool.query(
    `SELECT * FROM cost_finding_detections WHERE organization_id = $1 AND resource_id = $2`,
    [org.orgId, historyInstance]
  );
  return { decisions: decisions.rows, audits: audits.rows, detections: detections.rows };
}

const executeRemediation = (id: string) =>
  sendAs(org.orgId, org.owner, 'POST', `/cost-recommendations/${id}/execute-remediation`);

const awsCommands = <T>(type: new (...args: any[]) => T): T[] =>
  ec2Send.mock.calls.map(([command]) => command).filter((command) => command instanceof type);

function expectNoAwsCall() {
  expect(stsSend).not.toHaveBeenCalled();
  expect(ec2Send).not.toHaveBeenCalled();
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await ensureSharedFixtureTable(pool, 'remediation_workflows');
  await ensureSharedFixtureTable(pool, 'remediation_audit_log');
  org = await harness.buildOrg();
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, status)
     VALUES ($1, 'arn:aws:iam::000000000000:role/stop-instance-execute-remediation', $2, 'stop-refusal-external-id', 'active')`,
    [org.orgId, `${Date.now()}`.slice(-12)]
  );

  // The founder's case: one instance, 37 open RESOLVED decisions from the
  // CPU-only rule, each with its resolve audit row, and the latest detection.
  historyInstance = instanceId();
  historyIds = [];
  for (let i = 0; i < HISTORY_ROWS; i += 1) {
    const { rows } = await pool.query(
      `INSERT INTO cost_recommendations
         (organization_id, resource_id, resource_name, resource_type, issue, description, potential_savings, severity,
          aws_region, metadata, status, resolved_at, created_at, updated_at)
       VALUES ($1, $2, 'api-server', 'EC2', 'Idle Instance', 'averaged 3.4% CPU', 8.5, 'LOW', 'us-east-1', $3, 'RESOLVED',
               NOW() - make_interval(days => $4), NOW() - make_interval(days => $4 + 1), NOW() - make_interval(days => $4))
       RETURNING id`,
      [org.orgId, historyInstance, JSON.stringify(CPU_ONLY_METADATA), HISTORY_ROWS - i]
    );
    historyIds.push(rows[0].id);
    await pool.query(
      `INSERT INTO audit_logs (organization_id, user_id, action, resource_type, resource_id, changes, metadata)
       VALUES ($1, $2, 'cost_recommendation.resolved', 'cost_recommendation', $3, $4, $5)`,
      [org.orgId, org.owner, rows[0].id, JSON.stringify({ from: 'ACTIVE', to: 'RESOLVED' }),
        JSON.stringify({ issue: 'Idle Instance', resource_type: 'EC2', source: 'resolve' })]
    );
  }
  await pool.query(
    `INSERT INTO cost_finding_detections
       (organization_id, resource_id, issue, outcome, detected_at, resource_name, resource_type, aws_region, description,
        potential_savings, severity, metadata)
     VALUES ($1, $2, 'Idle Instance', 'detected', NOW(), 'api-server', 'EC2', 'us-east-1', 'averaged 3.4% CPU', 8.5, 'LOW', $3)`,
    [org.orgId, historyInstance, JSON.stringify(CPU_ONLY_METADATA)]
  );
  historyActiveId = await insertUnmarked(historyInstance);
  historyBaseline = await historySnapshot();

  await harness.listen((app) => {
    app.use('/api/cost-recommendations', costRecommendationsRoutes);
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
    await pool.query('DELETE FROM cost_finding_detections WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [orgIds]);
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
});

describe('execute-remediation refuses a finding without the allow-listed marker', () => {
  it.each([
    ['kill-switch on', 'true'],
    ['kill-switch off', undefined],
  ])('%s: the CPU-only ACTIVE finding on the history instance is refused, not dry-run; nothing created, no AWS', async (_label, flag) => {
    if (flag === undefined) delete process.env.ENABLE_AUTOMATED_REMEDIATION;
    const before = await recommendation(historyActiveId);
    const since = await dbNow();

    const response = await executeRemediation(historyActiveId);

    expect(response.status).toBe(403);
    const text = await response.text();
    expect(JSON.parse(text)).toEqual({ success: false, error: REFUSAL_TEXT });
    expect(text).not.toMatch(REASON_TEXT);
    expect(await recommendation(historyActiveId)).toEqual(before);
    expect(await workflowsFor(historyActiveId)).toEqual([]);
    expect(await refusalsSince(since)).toEqual([
      expect.objectContaining({
        user_id: org.owner,
        resource_type: 'cost_recommendation',
        resource_id: historyActiveId,
        metadata: expect.objectContaining({
          stage: 'create', path: 'execute_remediation', reason: 'marker_missing', instance_id: historyInstance, rule_version_seen: 'missing',
        }),
      }),
    ]);
    expectNoAwsCall();
  });

  it('an older marker is refused the same way', async () => {
    const id = await insertUnmarked(instanceId(), { rule_version: 1 });

    const response = await executeRemediation(id);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, error: REFUSAL_TEXT });
    expect(await workflowsFor(id)).toEqual([]);
    expectNoAwsCall();
  });

  it('a historical RESOLVED row keeps its existing refusal (it is not ACTIVE)', async () => {
    const response = await executeRemediation(historyIds[0]);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ success: false, error: 'Cannot execute — recommendation is already RESOLVED.' });
    expectNoAwsCall();
  });
});

describe('the workflow path refuses every stop referencing the history', () => {
  it('create with each of the 37 RESOLVED rows: 37 refusals, nothing created', async () => {
    const since = await dbNow();

    for (const recommendationId of historyIds) {
      const response = await sendAs(org.orgId, org.member, 'POST', '/remediation', {
        recommendationId, resourceId: historyInstance, resourceType: 'EC2', actionType: 'stop_instance', riskLevel: 'low',
      });
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual({ success: false, error: REFUSAL_TEXT });
    }

    const refusals = await refusalsSince(since);
    expect(refusals).toHaveLength(HISTORY_ROWS);
    expect(new Set(refusals.map((r) => r.metadata.reason))).toEqual(new Set(['finding_not_active']));
    const { rows } = await pool.query(
      'SELECT COUNT(*)::int AS n FROM remediation_workflows WHERE organization_id = $1 AND resource_id = $2',
      [org.orgId, historyInstance]
    );
    expect(rows[0].n).toBe(0);
    expectNoAwsCall();
  });

  it('a stored approved stop pointing at a RESOLVED row is refused at execute', async () => {
    const { rows } = await pool.query(
      `INSERT INTO remediation_workflows
         (organization_id, recommendation_id, resource_id, resource_type, action_type, action_params, risk_level, status)
       VALUES ($1, $2, $3, 'EC2', 'stop_instance', $4, 'low', 'approved') RETURNING id`,
      [org.orgId, historyIds[HISTORY_ROWS - 1], historyInstance, JSON.stringify({ resource_id: historyInstance, region: 'us-east-1' })]
    );

    const response = await sendAs(org.orgId, org.admin, 'POST', `/remediation/${rows[0].id}/execute`);

    expect(response.status).toBe(403);
    expect(await response.json()).toEqual({ success: false, error: REFUSAL_TEXT });
    const after = await pool.query('SELECT status FROM remediation_workflows WHERE id = $1', [rows[0].id]);
    expect(after.rows[0].status).toBe('approved');
    expectNoAwsCall();
  });
});

describe('immediately before the AWS call', () => {
  it('(e) the finding is resolved while credentials are fetched: 403, no snapshot, no stop', async () => {
    const id = await insertEligibleStopFinding(pool, org.orgId, instanceId(), { awsRegion: 'us-east-1' });
    stsSend.mockImplementation(async () => {
      await pool.query(`UPDATE cost_recommendations SET status = 'DISMISSED' WHERE id = $1`, [id]);
      return { Credentials: { AccessKeyId: 'stub-key', SecretAccessKey: 'stub-secret', SessionToken: 'stub-token' } };
    });
    const since = await dbNow();

    const response = await executeRemediation(id);

    expect(response.status).toBe(403);
    const workflows = await workflowsFor(id);
    expect(workflows).toHaveLength(1);
    expect(await response.json()).toEqual({ success: false, error: REFUSAL_TEXT, data: { workflowId: workflows[0].id } });
    expect(awsCommands(StopInstancesCommand)).toHaveLength(0);
    expect(awsCommands(CreateSnapshotCommand)).toHaveLength(0);
    // Not marked resolved by this request: only the concurrent change applies.
    expect((await recommendation(id)).status).toBe('DISMISSED');
    expect(workflows[0].status).toBe('failed');
    expect(workflows[0].execution_log).not.toMatch(REASON_TEXT);
    expect((await refusalsSince(since)).map((r) => [r.metadata.stage, r.metadata.path, r.metadata.reason])).toEqual([
      ['dispatch', 'execute_remediation', 'finding_not_active'],
    ]);
  });
});

describe('the allow-listed fixture', () => {
  it('is stopped and resolved as before', async () => {
    const resourceId = instanceId();
    const id = await insertEligibleStopFinding(pool, org.orgId, resourceId, { awsRegion: 'us-east-1' });
    const since = await dbNow();

    const response = await executeRemediation(id);

    expect(response.status).toBe(200);
    expect((await response.json()).message).toBe(`Instance ${resourceId} stopped successfully.`);
    const stops = awsCommands(StopInstancesCommand);
    expect(stops).toHaveLength(1);
    expect(stops[0].input.InstanceIds).toEqual([resourceId]);
    expect((await recommendation(id)).status).toBe('RESOLVED');
    expect(await refusalsSince(since)).toEqual([]);
  });
});

// Runs last (file order): every attempt above, on both paths and at every
// stage, has been made by then.
describe('history', () => {
  it('as inserted: exactly the 37 decisions, their audit rows and one detection', () => {
    expect(historyBaseline.decisions).toHaveLength(HISTORY_ROWS);
    expect(historyBaseline.audits).toHaveLength(HISTORY_ROWS);
    expect(historyBaseline.detections).toHaveLength(1);
    for (const row of historyBaseline.decisions) {
      expect(row).toMatchObject({ status: 'RESOLVED', occurrence_ended_at: null, metadata: CPU_ONLY_METADATA });
    }
  });

  it('is byte-identical after every stop attempt in this file, plus these', async () => {
    const pending = await pool.query(
      `INSERT INTO remediation_workflows
         (organization_id, recommendation_id, resource_id, resource_type, action_type, action_params, risk_level, status)
       VALUES ($1, $2, $3, 'EC2', 'stop_instance', $4, 'low', 'pending_approval') RETURNING id`,
      [org.orgId, historyIds[0], historyInstance, JSON.stringify({ resource_id: historyInstance, region: 'us-east-1' })]
    );

    expect((await executeRemediation(historyActiveId)).status).toBe(403);
    for (const recommendationId of [historyIds[5], historyIds[20], historyActiveId]) {
      const response = await sendAs(org.orgId, org.member, 'POST', '/remediation', {
        recommendationId, resourceId: historyInstance, resourceType: 'EC2', actionType: 'stop_instance', riskLevel: 'low',
      });
      expect(response.status).toBe(403);
    }
    expect((await sendAs(org.orgId, org.admin, 'POST', `/remediation/${pending.rows[0].id}/approve`)).status).toBe(403);

    expect(await historySnapshot()).toEqual(historyBaseline);
    expectNoAwsCall();
  });
});
