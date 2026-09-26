/**
 * rightsize_instance stops an EC2 instance, changes its type to a
 * caller-supplied target, and restarts it -- and DevControl has no validated
 * rightsizing recommendation to base that target on yet. It must be
 * unavailable at every remediation boundary: create, approve, execute (both
 * before any side effect and in the action dispatcher itself), and rollback.
 * No EC2 stop/modify/start may be reachable. Other actions are unaffected.
 *
 * Mock-only: fake Pool, no real AWS credentials, no network calls to AWS.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import {
  EC2Client,
  StopInstancesCommand,
  StartInstancesCommand,
  ModifyInstanceAttributeCommand,
} from '@aws-sdk/client-ec2';
import { RemediationService } from '../remediation.service';

jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.user = { organizationId: 'org-normal', userId: 'user-1', role: 'owner' };
    next();
  },
}));
jest.mock('../../middleware/subscription.middleware', () => ({
  requireEnterprise: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../middleware/rateLimiter', () => ({
  remediationExecuteRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { createRemediationRoutes } from '../../routes/remediation.routes';

const RIGHTSIZE_WORKFLOW = {
  id: 'wf-rs',
  organization_id: 'org-normal',
  recommendation_id: null,
  resource_id: 'i-rightsizetarget1',
  resource_type: 'EC2',
  action_type: 'rightsize_instance',
  action_params: { resource_id: 'i-rightsizetarget1', region: 'us-east-1', target_instance_type: 't3.nano' },
  estimated_savings: 20,
  risk_level: 'medium',
  status: 'approved',
  execution_log: null,
  rollback_available: true,
  rollback_snapshot_id: null,
};

const STOP_WORKFLOW = {
  ...RIGHTSIZE_WORKFLOW,
  id: 'wf-stop',
  resource_id: 'i-stoptarget1',
  action_type: 'stop_instance',
  action_params: { resource_id: 'i-stoptarget1', region: 'us-east-1' },
};

/** Fake Pool: answers the workflow SELECT with `row`; records every query. */
function makeFakePool(row: Record<string, any>) {
  const query = jest.fn(async (sql: string) => {
    if (/SELECT \* FROM remediation_workflows/.test(sql)) return { rows: [row] };
    if (/INSERT INTO remediation_workflows/.test(sql)) return { rows: [{ ...row, id: 'wf-new', status: 'pending_approval' }] };
    return { rows: [], rowCount: 1 };
  });
  return { query } as any;
}

const FORBIDDEN_CLAIMS = /no (rightsizing )?opportunit|no instances? need|not supported by AWS|unsupported by AWS|invalid|target instance type is/i;

function mutatingEc2Commands(sendSpy: jest.SpyInstance) {
  return sendSpy.mock.calls
    .map(([command]) => command)
    .filter((c) => c instanceof StopInstancesCommand || c instanceof ModifyInstanceAttributeCommand || c instanceof StartInstancesCommand);
}

describe('rightsize_instance is unavailable in RemediationService', () => {
  const ORIGINAL_ENV = { ...process.env };
  let ec2Send: jest.SpyInstance;

  beforeEach(() => {
    // Kill-switch ON and no self-protection match: the rightsize guard, not the
    // dry-run switch, must be what stops it.
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
    delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;
    ec2Send = jest.spyOn(EC2Client.prototype, 'send').mockImplementation(async () => ({}) as any);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it('create: rejects before any workflow is persisted, with the unavailable message (not "no opportunities")', async () => {
    const pool = makeFakePool(RIGHTSIZE_WORKFLOW);
    const service = new RemediationService(pool);

    const attempt = service.createWorkflow('org-normal', {
      resourceId: 'i-rightsizetarget1', resourceType: 'EC2', actionType: 'rightsize_instance',
      actionParams: { target_instance_type: 't3.nano' }, estimatedSavings: 20, riskLevel: 'medium',
    });

    await expect(attempt).rejects.toThrow(/^ACTION_UNAVAILABLE: EC2 rightsizing remediation is currently unavailable/);
    await attempt.catch((err) => expect(err.message).not.toMatch(FORBIDDEN_CLAIMS));
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('approve: rejects a pending rightsize_instance workflow without changing its status', async () => {
    const pool = makeFakePool({ ...RIGHTSIZE_WORKFLOW, status: 'pending_approval' });
    const service = new RemediationService(pool);

    await expect(service.approve('wf-rs', 'org-normal', 'user-1')).rejects.toThrow(/^ACTION_UNAVAILABLE:/);
    expect(pool.query).toHaveBeenCalledTimes(1); // the workflow SELECT only -- no UPDATE, no audit INSERT
  });

  it('execute: rejects an approved rightsize_instance workflow before any status change, credential fetch, or EC2 call', async () => {
    const pool = makeFakePool(RIGHTSIZE_WORKFLOW);
    const service = new RemediationService(pool);
    const getCreds = jest.spyOn(service as any, 'getAWSCredentials');
    const rightsize = jest.spyOn(service as any, 'rightsizeInstance');

    await expect(service.execute('wf-rs', 'org-normal', 'user-1')).rejects.toThrow(/^ACTION_UNAVAILABLE:/);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(getCreds).not.toHaveBeenCalled();
    expect(rightsize).not.toHaveBeenCalled();
    expect(ec2Send).not.toHaveBeenCalled();
  });

  it('dispatcher: the action dispatcher itself refuses rightsize_instance -- no EC2 StopInstances, ModifyInstanceAttribute, or StartInstances', async () => {
    const service = new RemediationService(makeFakePool(RIGHTSIZE_WORKFLOW));
    const rightsize = jest.spyOn(service as any, 'rightsizeInstance');
    const fakeCreds = { accessKeyId: 'x', secretAccessKey: 'y', sessionToken: 'z', region: 'us-east-1' };

    await expect(
      (service as any).dispatchAction('rightsize_instance', fakeCreds, RIGHTSIZE_WORKFLOW.action_params, '', 'wf-rs')
    ).rejects.toThrow(/^ACTION_UNAVAILABLE:/);

    expect(rightsize).not.toHaveBeenCalled();
    expect(mutatingEc2Commands(ec2Send)).toEqual([]);
    expect(ec2Send).not.toHaveBeenCalled();
  });

  it('rollback: rejects a rightsize_instance workflow -- no credential fetch and no EC2 stop/modify/start', async () => {
    const pool = makeFakePool({ ...RIGHTSIZE_WORKFLOW, status: 'completed', rollback_available: true });
    const service = new RemediationService(pool);
    const getCreds = jest.spyOn(service as any, 'getAWSCredentials');

    await expect(service.rollback('wf-rs', 'org-normal', 'user-1')).rejects.toThrow(/^ACTION_UNAVAILABLE:/);

    expect(getCreds).not.toHaveBeenCalled();
    expect(mutatingEc2Commands(ec2Send)).toEqual([]);
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('a foreign organization still gets "not found", not a hint about the workflow', async () => {
    const service = new RemediationService(makeFakePool(RIGHTSIZE_WORKFLOW));

    await expect(service.execute('wf-rs', 'org-other', 'user-1')).rejects.toThrow('Workflow not found');
  });
});

describe('other remediation actions are unaffected', () => {
  const ORIGINAL_ENV = { ...process.env };

  beforeEach(() => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
    delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it('stop_instance is created (INSERT runs) and approved (UPDATE runs) as before', async () => {
    const createPool = makeFakePool(STOP_WORKFLOW);
    await new RemediationService(createPool).createWorkflow('org-normal', {
      resourceId: 'i-stoptarget1', resourceType: 'EC2', actionType: 'stop_instance',
      actionParams: {}, estimatedSavings: 5, riskLevel: 'low',
    });
    expect(createPool.query.mock.calls.some(([sql]: [string]) => /INSERT INTO remediation_workflows/.test(sql))).toBe(true);

    const approvePool = makeFakePool({ ...STOP_WORKFLOW, status: 'pending_approval' });
    await new RemediationService(approvePool).approve('wf-stop', 'org-normal', 'user-1');
    expect(approvePool.query.mock.calls.some(([sql]: [string]) => /UPDATE remediation_workflows SET status = \$1/.test(sql))).toBe(true);
  });

  it('stop_instance executes through the dispatcher to its own handler and completes with its rollback data', async () => {
    const pool = makeFakePool(STOP_WORKFLOW);
    const service = new RemediationService(pool);
    jest.spyOn(service as any, 'getAWSCredentials').mockResolvedValue({ accessKeyId: 'x', secretAccessKey: 'y', sessionToken: 'z', region: 'us-east-1' });
    jest.spyOn(service as any, 'assertNotDevControlInfrastructureByTag').mockResolvedValue(undefined);
    const stop = jest.spyOn(service as any, 'stopInstance').mockResolvedValue({ log: 'stopped', rollbackSnapshotId: 'snap-1', rollbackAvailable: true });
    const rightsize = jest.spyOn(service as any, 'rightsizeInstance');

    await service.execute('wf-stop', 'org-normal', 'user-1');

    expect(stop).toHaveBeenCalledTimes(1);
    expect(rightsize).not.toHaveBeenCalled();
    const completed = pool.query.mock.calls.find(([sql, values]: [string, any[]]) => /UPDATE remediation_workflows/.test(sql) && values[0] === 'completed');
    expect(completed[1]).toEqual(expect.arrayContaining([true, 'snap-1']));
  });

  it('a handler that returns no rollback data still records rollback_available = false (unchanged by the dispatcher extraction)', async () => {
    const pool = makeFakePool({ ...STOP_WORKFLOW, action_type: 'delete_snapshot', resource_id: 'snap-x' });
    const service = new RemediationService(pool);
    jest.spyOn(service as any, 'getAWSCredentials').mockResolvedValue({ accessKeyId: 'x', secretAccessKey: 'y', sessionToken: 'z', region: 'us-east-1' });
    jest.spyOn(service as any, 'assertNotDevControlInfrastructureByTag').mockResolvedValue(undefined);
    jest.spyOn(service as any, 'deleteSnapshot').mockResolvedValue({ log: 'deleted' });

    await service.execute('wf-stop', 'org-normal', 'user-1');

    const completed = pool.query.mock.calls.find(([sql, values]: [string, any[]]) => /UPDATE remediation_workflows/.test(sql) && values[0] === 'completed');
    const sql: string = completed[0];
    const values: any[] = completed[1];
    const columns = sql.match(/SET (.*) WHERE/)![1].split(', ').filter((c) => !c.startsWith('updated_at')).map((c) => c.split(' = ')[0]);
    expect(values[columns.indexOf('rollback_available')]).toBe(false);
    expect(values[columns.indexOf('rollback_snapshot_id')]).toBeNull();
  });
});

describe('remediation routes return the unavailable error with the existing { success: false, error } convention', () => {
  let server: http.Server;
  let baseUrl: string;
  let pool: any;
  const ORIGINAL_ENV = { ...process.env };

  function serve(row: Record<string, any>) {
    return new Promise<void>((resolve) => {
      pool = makeFakePool(row);
      const app = express();
      app.use(express.json());
      app.use('/api/remediation', createRemediationRoutes(pool));
      server = app.listen(0, () => {
        baseUrl = `http://localhost:${(server.address() as AddressInfo).port}`;
        resolve();
      });
    });
  }

  beforeEach(() => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach((done) => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
    server.close(done);
  });

  async function post(path: string, body: unknown = {}) {
    const res = await fetch(`${baseUrl}${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: res.status, body: (await res.json()) as { success: boolean; error?: string } };
  }

  function expectUnavailable(result: { status: number; body: { success: boolean; error?: string } }) {
    expect(result.status).toBe(400);
    expect(result.body.success).toBe(false);
    expect(result.body.error).toMatch(/EC2 rightsizing remediation is currently unavailable/);
    expect(result.body.error).not.toMatch(FORBIDDEN_CLAIMS);
  }

  it('POST /api/remediation (create) -> 400, nothing persisted', async () => {
    await serve(RIGHTSIZE_WORKFLOW);
    const result = await post('/api/remediation', {
      resourceId: 'i-rightsizetarget1', resourceType: 'EC2', actionType: 'rightsize_instance',
      actionParams: { target_instance_type: 't3.nano' }, riskLevel: 'medium',
    });

    expectUnavailable(result);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('POST /api/remediation/:id/approve -> 400', async () => {
    await serve({ ...RIGHTSIZE_WORKFLOW, status: 'pending_approval' });
    expectUnavailable(await post('/api/remediation/wf-rs/approve'));
  });

  it('POST /api/remediation/:id/execute -> 400, no EC2 command sent', async () => {
    await serve(RIGHTSIZE_WORKFLOW);
    const ec2Send = jest.spyOn(EC2Client.prototype, 'send');

    expectUnavailable(await post('/api/remediation/wf-rs/execute'));
    expect(ec2Send).not.toHaveBeenCalled();
  });

  it('POST /api/remediation/:id/rollback -> 400, no EC2 command sent', async () => {
    await serve({ ...RIGHTSIZE_WORKFLOW, status: 'completed' });
    const ec2Send = jest.spyOn(EC2Client.prototype, 'send');

    expectUnavailable(await post('/api/remediation/wf-rs/rollback'));
    expect(ec2Send).not.toHaveBeenCalled();
  });
});
