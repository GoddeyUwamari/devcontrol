/**
 * downgrade_rds_instance changes a DB instance's class. Its only source, the
 * oversized-RDS detector, was retired for having no utilisation data, so the
 * action must be unavailable at every remediation boundary: create, approve,
 * execute (both before any side effect and in the action dispatcher itself),
 * and rollback. No RDS ModifyDBInstance may be reachable. Modelled on
 * remediation.rightsize-unavailable.test.ts.
 *
 * Mock-only: fake Pool, no real AWS credentials, no network calls to AWS.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';
import { RDSClient } from '@aws-sdk/client-rds';
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

const RDS_WORKFLOW = {
  id: 'wf-rds',
  organization_id: 'org-normal',
  recommendation_id: null,
  resource_id: 'dev-db',
  resource_type: 'RDS',
  action_type: 'downgrade_rds_instance',
  action_params: { resource_id: 'dev-db', region: 'us-east-1', target_instance_class: 'db.t3.small' },
  estimated_savings: 98,
  risk_level: 'medium',
  status: 'approved',
  execution_log: null,
  rollback_available: true,
  rollback_snapshot_id: null,
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

const UNAVAILABLE = /^ACTION_UNAVAILABLE: RDS instance downgrade remediation is currently unavailable/;

describe('downgrade_rds_instance is unavailable in RemediationService', () => {
  const ORIGINAL_ENV = { ...process.env };
  let rdsSend: jest.SpyInstance;

  beforeEach(() => {
    // Kill-switch ON and no self-protection match: the unavailable guard, not
    // the dry-run switch, must be what stops it.
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
    delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;
    rdsSend = jest.spyOn(RDSClient.prototype, 'send').mockImplementation(async () => ({}) as any);
  });

  afterEach(() => {
    process.env = { ...ORIGINAL_ENV };
    jest.restoreAllMocks();
  });

  it('create: rejects before any workflow is persisted', async () => {
    const pool = makeFakePool(RDS_WORKFLOW);
    const service = new RemediationService(pool);

    await expect(service.createWorkflow('org-normal', {
      resourceId: 'dev-db', resourceType: 'RDS', actionType: 'downgrade_rds_instance',
      actionParams: { target_instance_class: 'db.t3.small' }, estimatedSavings: 98, riskLevel: 'medium',
    })).rejects.toThrow(UNAVAILABLE);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('approve: rejects a pending workflow without changing its status', async () => {
    const pool = makeFakePool({ ...RDS_WORKFLOW, status: 'pending_approval' });

    await expect(new RemediationService(pool).approve('wf-rds', 'org-normal', 'user-1')).rejects.toThrow(UNAVAILABLE);
    expect(pool.query).toHaveBeenCalledTimes(1); // the workflow SELECT only
  });

  it('execute: rejects an approved workflow before any status change, credential fetch, or RDS call', async () => {
    const pool = makeFakePool(RDS_WORKFLOW);
    const service = new RemediationService(pool);
    const getCreds = jest.spyOn(service as any, 'getAWSCredentials');
    const downgrade = jest.spyOn(service as any, 'downgradeRDSInstance');

    await expect(service.execute('wf-rds', 'org-normal', 'user-1')).rejects.toThrow(UNAVAILABLE);

    expect(pool.query).toHaveBeenCalledTimes(1);
    expect(getCreds).not.toHaveBeenCalled();
    expect(downgrade).not.toHaveBeenCalled();
    expect(rdsSend).not.toHaveBeenCalled();
  });

  it('dispatcher: the action dispatcher itself refuses downgrade_rds_instance', async () => {
    const service = new RemediationService(makeFakePool(RDS_WORKFLOW));
    const downgrade = jest.spyOn(service as any, 'downgradeRDSInstance');
    const fakeCreds = { accessKeyId: 'x', secretAccessKey: 'y', sessionToken: 'z', region: 'us-east-1' };

    await expect(
      (service as any).dispatchAction('downgrade_rds_instance', fakeCreds, RDS_WORKFLOW.action_params, '', 'wf-rds')
    ).rejects.toThrow(UNAVAILABLE);

    expect(downgrade).not.toHaveBeenCalled();
    expect(rdsSend).not.toHaveBeenCalled();
  });

  it('rollback: rejects a completed workflow -- no credential fetch and no RDS call', async () => {
    const pool = makeFakePool({ ...RDS_WORKFLOW, status: 'completed' });
    const service = new RemediationService(pool);
    const getCreds = jest.spyOn(service as any, 'getAWSCredentials');

    await expect(service.rollback('wf-rds', 'org-normal', 'user-1')).rejects.toThrow(UNAVAILABLE);

    expect(getCreds).not.toHaveBeenCalled();
    expect(rdsSend).not.toHaveBeenCalled();
    expect(pool.query).toHaveBeenCalledTimes(1);
  });

  it('a foreign organization still gets "not found"', async () => {
    const service = new RemediationService(makeFakePool(RDS_WORKFLOW));

    await expect(service.execute('wf-rds', 'org-other', 'user-1')).rejects.toThrow('Workflow not found');
  });
});

describe('remediation routes reject downgrade_rds_instance server-side with { success: false, error }', () => {
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
    expect(result.body.error).toMatch(/RDS instance downgrade remediation is currently unavailable/);
  }

  it('POST /api/remediation (create) -> 400, nothing persisted', async () => {
    await serve(RDS_WORKFLOW);
    const result = await post('/api/remediation', {
      resourceId: 'dev-db', resourceType: 'RDS', actionType: 'downgrade_rds_instance',
      actionParams: { target_instance_class: 'db.t3.small' }, riskLevel: 'medium',
    });

    expectUnavailable(result);
    expect(pool.query).not.toHaveBeenCalled();
  });

  it('POST /api/remediation/:id/approve -> 400', async () => {
    await serve({ ...RDS_WORKFLOW, status: 'pending_approval' });
    expectUnavailable(await post('/api/remediation/wf-rds/approve'));
  });

  it('POST /api/remediation/:id/execute -> 400, no RDS command sent', async () => {
    await serve(RDS_WORKFLOW);
    const rdsSend = jest.spyOn(RDSClient.prototype, 'send');

    expectUnavailable(await post('/api/remediation/wf-rds/execute'));
    expect(rdsSend).not.toHaveBeenCalled();
  });

  it('POST /api/remediation/:id/rollback -> 400, no RDS command sent', async () => {
    await serve({ ...RDS_WORKFLOW, status: 'completed' });
    const rdsSend = jest.spyOn(RDSClient.prototype, 'send');

    expectUnavailable(await post('/api/remediation/wf-rds/rollback'));
    expect(rdsSend).not.toHaveBeenCalled();
  });
});
