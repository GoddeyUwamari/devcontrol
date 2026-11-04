/**
 * POST /api/cost-recommendations/:id/execute-remediation: every failure
 * answers with fixed text (or a known fixed refusal), never the error's own
 * text. Database errors (row update, audit write, workflow bookkeeping) can
 * quote SQL and row values, and AWS SDK errors can quote ARNs; both go to the
 * server log through safeErrorFields only.
 *
 * Paths (cost-optimization pr4-step1.md, section c):
 *   P1   the stop succeeded, the workflow's 'completed' write failed
 *   P1b  as P1, and the 'failed' write failed too
 *   P2   execute() finished, its workflow read-back failed
 *   P3   execute() succeeded, marking the recommendation resolved failed
 *   P6   a self-protection refusal quoting the raw AWS lookup error
 *   P7   a real AWS execution failure quoting an ARN
 *
 * The controller runs for real; its repository and remediation service are
 * stubbed on their prototypes, so nothing reaches Postgres or AWS.
 */
import { Request, Response } from 'express';
import {
  CostRecommendationsController,
  EXECUTE_REMEDIATION_FAILED,
  EXECUTE_REMEDIATION_RESOLVE_FAILED,
} from '../cost-recommendations.controller';
import { CostRecommendationsRepository } from '../../repositories/cost-recommendations.repository';
import {
  RemediationService,
  SELF_PROTECTION_PUBLIC_MESSAGE,
  SELF_PROTECTION_UNVERIFIED_PREFIX,
  REGION_MISMATCH_PREFIX,
} from '../../services/remediation.service';

const ORG_ID = '00000000-0000-4000-8000-000000000001';
const USER_ID = '00000000-0000-4000-8000-000000000002';
const REC_ID = '00000000-0000-4000-8000-000000000003';
const WORKFLOW_ID = '00000000-0000-4000-8000-000000000004';
const INSTANCE_ID = 'i-1234567890abcdef0';
const ARN = 'arn:aws:sts::123456789012:assumed-role/placeholder-role/session';

/** A pg-shaped error: message plus detail/where/query text that must never reach a response. */
function databaseError(message: string): Error {
  return Object.assign(new Error(message), {
    code: '23514',
    detail: 'Failing row contains (00000000-0000-4000-8000-000000000003, RESOLVED, ...).',
    where: 'SQL statement "INSERT INTO cost_recommendation_audit_events (organization_id) VALUES ($1)"',
    table: 'cost_recommendation_audit_events',
  });
}

const FORBIDDEN = [
  'violates', 'relation', 'INSERT INTO', 'UPDATE ', 'SELECT ', 'Failing row', 'cost_recommendation_audit_events',
  'remediation_workflows', 'arn:aws', '123456789012', 'AccessDenied', 'not authorized', 'Execution failed:',
];

function expectSafe(body: unknown) {
  const text = JSON.stringify(body);
  for (const fragment of FORBIDDEN) expect(text).not.toContain(fragment);
  // Nothing from the error object rides along in a nested field.
  const record = body as Record<string, unknown>;
  expect(Object.keys(record).sort()).toEqual(['data', 'error', 'success'].filter((k) => k in record).sort());
  if (record.data !== undefined) expect(record.data).toEqual({ workflowId: WORKFLOW_ID });
}

function mockResponse() {
  const res: Partial<Response> & { statusCode: number; body: unknown } = { statusCode: 200, body: undefined };
  res.status = jest.fn((code: number) => { res.statusCode = code; return res as Response; });
  res.json = jest.fn((body: unknown) => { res.body = body; return res as Response; });
  return res;
}

function request(): Request {
  return {
    params: { id: REC_ID },
    ip: '127.0.0.1',
    headers: {},
    get: () => undefined,
    user: { organizationId: ORG_ID, userId: USER_ID },
  } as unknown as Request;
}

const controller = new CostRecommendationsController();
let errorLog: jest.SpyInstance;
let execute: jest.SpyInstance;
let updateStatus: jest.SpyInstance;
let closeUnexecuted: jest.SpyInstance;
let createWorkflow: jest.SpyInstance;

beforeEach(() => {
  errorLog = jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(CostRecommendationsRepository.prototype, 'findById').mockResolvedValue({
    id: REC_ID, organization_id: ORG_ID, resource_id: INSTANCE_ID, resource_type: 'EC2', issue: 'Idle Instance',
    status: 'ACTIVE', aws_region: 'us-east-1', potential_savings: 50, severity: 'LOW', metadata: {},
  } as any);
  updateStatus = jest.spyOn(CostRecommendationsRepository.prototype, 'updateStatus').mockResolvedValue({ id: REC_ID, status: 'RESOLVED' } as any);
  createWorkflow = jest.spyOn(RemediationService.prototype, 'createWorkflow').mockResolvedValue({ id: WORKFLOW_ID } as any);
  jest.spyOn(RemediationService.prototype, 'approve').mockResolvedValue({ id: WORKFLOW_ID } as any);
  execute = jest.spyOn(RemediationService.prototype, 'execute').mockResolvedValue({ id: WORKFLOW_ID, status: 'completed' } as any);
  closeUnexecuted = jest.spyOn(RemediationService.prototype, 'closeUnexecuted').mockResolvedValue(undefined as any);
});

afterEach(() => jest.restoreAllMocks());

async function run() {
  const res = mockResponse();
  await controller.executeRemediation(request(), res as Response);
  return res;
}

/** Every server-side log line is the safe fields only: never the error object, its detail or an ARN. */
function expectSafeLogs() {
  for (const call of errorLog.mock.calls) {
    for (const arg of call) expect(arg).not.toBeInstanceOf(Error);
    const text = JSON.stringify(call);
    expect(text).not.toContain('Failing row');
    expect(text).not.toContain('arn:aws');
  }
}

describe('execute-remediation failure responses are fixed text', () => {
  it('success is unchanged', async () => {
    const res = await run();
    expect(res.statusCode).toBe(200);
    expect(res.body).toEqual({
      success: true,
      data: { recommendation: { id: REC_ID, status: 'RESOLVED' }, workflow: { id: WORKFLOW_ID, status: 'completed' } },
      message: `Instance ${INSTANCE_ID} stopped successfully.`,
    });
  });

  it('P3: the resolve after a successful stop fails -> M1, never the database text', async () => {
    updateStatus.mockRejectedValueOnce(databaseError('new row for relation "cost_recommendation_audit_events" violates check constraint'));
    const res = await run();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: EXECUTE_REMEDIATION_RESOLVE_FAILED, data: { workflowId: WORKFLOW_ID } });
    expect(EXECUTE_REMEDIATION_RESOLVE_FAILED).toBe(
      "The instance was stopped, but this recommendation couldn't be marked resolved. Refresh to check its status."
    );
    expectSafe(res.body);
    expectSafeLogs();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it('P3: a non-Error rejection from the resolve is handled the same way', async () => {
    updateStatus.mockRejectedValueOnce('UPDATE cost_recommendations SET status = $1 failed');
    const res = await run();
    expect(res.body).toEqual({ success: false, error: EXECUTE_REMEDIATION_RESOLVE_FAILED, data: { workflowId: WORKFLOW_ID } });
    expectSafe(res.body);
  });

  it.each([
    ['P1 (completed write failed)', databaseError('update "remediation_workflows" failed: deadlock detected')],
    ['P1b (completed and failed writes both failed)', databaseError('could not write remediation_workflows: SELECT 1 FROM remediation_workflows')],
    ['P2 (workflow read-back failed)', databaseError('terminating connection; SELECT * FROM remediation_workflows WHERE id = $1')],
    ['P7 (AWS execution failure quoting an ARN)', Object.assign(new Error(`User: ${ARN} is not authorized to perform: ec2:StopInstances`), { name: 'UnauthorizedOperation' })],
  ])('%s -> the fixed execution message', async (_label, err) => {
    execute.mockRejectedValueOnce(err);
    const res = await run();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: EXECUTE_REMEDIATION_FAILED, data: { workflowId: WORKFLOW_ID } });
    expectSafe(res.body);
    expectSafeLogs();
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('P6: a self-protection refusal quoting the raw AWS lookup error -> the public refusal', async () => {
    execute.mockRejectedValueOnce(new Error(
      `${SELF_PROTECTION_UNVERIFIED_PREFIX} ${INSTANCE_ID} is not DevControl operational infrastructure (tag lookup failed: User: ${ARN} is not authorized)`
    ));
    const res = await run();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: SELF_PROTECTION_PUBLIC_MESSAGE, data: { workflowId: WORKFLOW_ID } });
    expectSafe(res.body);
    expectSafeLogs();
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('an unrecognised REMEDIATION_BLOCKED text is never echoed', async () => {
    execute.mockRejectedValueOnce(new Error(`REMEDIATION_BLOCKED: something new (${ARN})`));
    const res = await run();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: SELF_PROTECTION_PUBLIC_MESSAGE, data: { workflowId: WORKFLOW_ID } });
    expectSafe(res.body);
  });

  it('a known fixed refusal is still shown as written', async () => {
    const fixed = 'REMEDIATION_BLOCKED: Workflow action target does not match its resource_id. No AWS action was taken.';
    execute.mockRejectedValueOnce(new Error(fixed));
    const res = await run();
    expect(res.statusCode).toBe(403);
    expect(res.body).toEqual({ success: false, error: fixed, data: { workflowId: WORKFLOW_ID } });
  });

  it('DRY_RUN_MODE keeps its fixed text and closes the workflow', async () => {
    const dryRun = 'DRY_RUN_MODE: Automated remediation is disabled. No AWS action was taken.';
    execute.mockRejectedValueOnce(new Error(dryRun));
    const res = await run();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: dryRun, data: { workflowId: WORKFLOW_ID } });
    expect(closeUnexecuted).toHaveBeenCalledTimes(1);
    expect(updateStatus).not.toHaveBeenCalled();
  });

  it('closing a dry-run workflow fails -> the outer fixed message', async () => {
    execute.mockRejectedValueOnce(new Error('DRY_RUN_MODE: Automated remediation is disabled. No AWS action was taken.'));
    closeUnexecuted.mockRejectedValueOnce(databaseError('UPDATE remediation_workflows failed'));
    const res = await run();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: EXECUTE_REMEDIATION_FAILED, data: { workflowId: WORKFLOW_ID } });
    expectSafe(res.body);
  });

  it('a failure before the workflow exists -> the outer fixed message with no data', async () => {
    createWorkflow.mockRejectedValueOnce(databaseError('INSERT INTO remediation_workflows failed'));
    const res = await run();
    expect(res.statusCode).toBe(500);
    expect(res.body).toEqual({ success: false, error: EXECUTE_REMEDIATION_FAILED, data: undefined });
    expectSafe(res.body);
  });

  it('a region mismatch keeps its fixed sentence, and an unrecognised one is not echoed', async () => {
    const fixed = `${REGION_MISMATCH_PREFIX} actionParams.region must be an AWS region`;
    createWorkflow.mockRejectedValueOnce(new Error(fixed));
    let res = await run();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: fixed });

    createWorkflow.mockRejectedValueOnce(new Error(`${REGION_MISMATCH_PREFIX} SELECT region FROM aws_resources (${ARN})`));
    res = await run();
    expect(res.statusCode).toBe(400);
    expect(res.body).toEqual({ success: false, error: EXECUTE_REMEDIATION_FAILED });
  });
});
