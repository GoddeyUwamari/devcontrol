/**
 * What the remediation routes tell the caller, and log, when a request fails.
 *
 * The caller sees either a refusal written in remediation.service.ts (a fixed
 * sentence, or one that adds only a workflow status) or the route's fixed
 * message -- never an AWS SDK or database error's text. A self-protection
 * refusal is answered with one fixed sentence; which check matched goes to
 * the server log only. The log holds the error's name, code and a redacted
 * message, never the error object or its stack. Status codes are as before.
 *
 * Hermetic: the auth, plan, role and rate-limit middleware are stubbed to let
 * the request through as an admin, and RemediationService's methods are
 * stubbed to throw. No database, no AWS.
 */
import express from 'express';
import http from 'http';
import { AddressInfo } from 'net';

jest.mock('../../config/database', () => ({ pool: {} }));
jest.mock('../../middleware/auth.middleware', () => ({
  authenticateToken: (req: any, _res: any, next: any) => {
    req.organizationId = '00000000-0000-4000-8000-00000000000a';
    req.user = { userId: '00000000-0000-4000-8000-00000000000b', organizationId: req.organizationId, role: 'admin' };
    next();
  },
}));
jest.mock('../../middleware/subscription.middleware', () => ({
  requireEnterprise: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../middleware/rbac.middleware', () => ({
  requireMember: (_req: any, _res: any, next: any) => next(),
}));
jest.mock('../../middleware/rateLimiter', () => ({
  remediationExecuteRateLimiter: (_req: any, _res: any, next: any) => next(),
}));

import { createRemediationRoutes } from '../remediation.routes';
import {
  RemediationService,
  ACTION_UNAVAILABLE_PREFIX,
  REGION_MISMATCH_PREFIX,
  REGION_UNKNOWN_MESSAGE,
} from '../../services/remediation.service';

const WORKFLOW_ID = '00000000-0000-4000-8000-00000000000c';
const SELF_PROTECTION = "This action isn't allowed on this resource.";

/** An AWS SDK-style failure whose text must never reach the caller. */
function awsFailure(): Error {
  return Object.assign(
    new Error('User: arn:aws:sts::123456789012:assumed-role/SentinelRole/x is not authorized (account 123456789012)'),
    { name: 'AccessDenied', code: 'AccessDenied', stack: 'STACK-SENTINEL', $metadata: { requestId: 'REQ-SENTINEL' } }
  );
}

const LEAKS = /arn:|123456789012|SentinelRole|STACK-SENTINEL|REQ-SENTINEL/;

let server: http.Server;
let baseUrl: string;

beforeAll(async () => {
  const app = express();
  app.use(express.json());
  app.use('/api/remediation', createRemediationRoutes({} as any));
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/remediation`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

let consoleError: jest.SpyInstance;

beforeEach(() => {
  consoleError = jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

type Action = 'approve' | 'reject' | 'execute' | 'rollback';
const SERVICE_METHOD: Record<Action, 'approve' | 'reject' | 'execute' | 'rollback'> = {
  approve: 'approve',
  reject: 'reject',
  execute: 'execute',
  rollback: 'rollback',
};

function throwFrom(method: keyof RemediationService, error: unknown): void {
  jest.spyOn(RemediationService.prototype as any, method).mockImplementation(async () => {
    throw error;
  });
}

async function act(action: Action): Promise<{ status: number; text: string }> {
  const response = await fetch(`${baseUrl}/${WORKFLOW_ID}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
  });
  return { status: response.status, text: await response.text() };
}

function loggedFor(operation: string): any[] {
  return consoleError.mock.calls.filter(([label]) => label === `[Remediation] ${operation} error:`);
}

describe('an AWS or database failure is answered with the route\'s fixed message', () => {
  const cases: Array<[Action, number, string]> = [
    ['approve', 400, 'Failed to approve workflow'],
    ['reject', 400, 'Failed to reject workflow'],
    ['execute', 500, 'Failed to execute workflow'],
    ['rollback', 400, 'Failed to roll back workflow'],
  ];

  it.each(cases)('%s: status %i and only the fixed message', async (action, status, message) => {
    throwFrom(SERVICE_METHOD[action], awsFailure());

    const result = await act(action);

    expect(result.status).toBe(status);
    expect(JSON.parse(result.text)).toEqual({ success: false, error: message });
    expect(result.text).not.toMatch(LEAKS);
  });

  it.each(cases)('%s: logs name, code and a redacted message, never the error object', async (action) => {
    throwFrom(SERVICE_METHOD[action], awsFailure());

    await act(action);

    const logged = loggedFor(action);
    expect(logged).toHaveLength(1);
    expect(logged[0]).toHaveLength(2);
    expect(logged[0][1]).toEqual({
      workflowId: WORKFLOW_ID,
      name: 'AccessDenied',
      code: 'AccessDenied',
      message: 'User: [arn] is not authorized (account [account-id])',
    });
    expect(JSON.stringify(consoleError.mock.calls)).not.toMatch(LEAKS);
  });

  it('create: a database failure is 500 with the fixed message', async () => {
    throwFrom('createWorkflow', Object.assign(new Error('insert failed for owner@example.com'), { code: '23505' }));

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceId: 'i-1234567890abcdef0', resourceType: 'ec2', actionType: 'stop_instance', riskLevel: 'low' }),
    });
    const text = await response.text();

    expect(response.status).toBe(500);
    expect(JSON.parse(text)).toEqual({ success: false, error: 'Failed to create workflow' });
    expect(loggedFor('create')[0][1]).toEqual({
      workflowId: undefined,
      name: 'Error',
      code: '23505',
      message: 'insert failed for [email]',
    });
  });

  it('create: a REGION_MISMATCH refusal that quotes an identifier keeps its 400 but not its text', async () => {
    throwFrom('createWorkflow', new Error(`${REGION_MISMATCH_PREFIX} arn:aws:ec2:us-east-1:123456789012:volume/x is in more than one region`));

    const response = await fetch(baseUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ resourceId: 'i-1234567890abcdef0', resourceType: 'ec2', actionType: 'stop_instance', riskLevel: 'low' }),
    });
    const text = await response.text();

    expect(response.status).toBe(400);
    expect(JSON.parse(text)).toEqual({ success: false, error: 'Failed to create workflow' });
    expect(text).not.toMatch(LEAKS);
  });

  it('a thrown non-Error value is still answered', async () => {
    throwFrom('approve', 'not an error 123456789012');

    const result = await act('approve');

    expect(result.status).toBe(400);
    expect(JSON.parse(result.text)).toEqual({ success: false, error: 'Failed to approve workflow' });
  });
});

describe('self-protection refusals: one fixed sentence; the reason is logged only', () => {
  const reasons = [
    'REMEDIATION_BLOCKED: Cannot execute automated actions against DevControl operational infrastructure (resource_id matches DEVCONTROL_PROD_INSTANCE_ID)',
    'REMEDIATION_BLOCKED: Cannot execute automated actions against DevControl operational infrastructure (organization_id matches DEVCONTROL_OPERATIONAL_ORG_ID)',
    'REMEDIATION_BLOCKED: Cannot execute automated actions against DevControl operational infrastructure (resource tag App=DevControl present)',
    'REMEDIATION_BLOCKED: Unable to verify i-1234567890abcdef0 is not DevControl operational infrastructure (tag lookup failed: arn:aws:iam::123456789012:role/SentinelRole denied)',
  ];

  it.each(reasons)('execute: %s', async (reason) => {
    throwFrom('execute', new Error(reason));

    const result = await act('execute');

    expect(result.status).toBe(500);
    expect(JSON.parse(result.text)).toEqual({ success: false, error: SELF_PROTECTION });
    expect(result.text).not.toMatch(/DEVCONTROL_|App=DevControl|REMEDIATION_BLOCKED|i-1234567890abcdef0/);
    expect(result.text).not.toMatch(LEAKS);
    expect(loggedFor('execute')[0][1].message).toMatch(/^REMEDIATION_BLOCKED: /);
  });

  it('rollback answers the same sentence with its own status', async () => {
    throwFrom('rollback', new Error(reasons[0]));

    const result = await act('rollback');

    expect(result.status).toBe(400);
    expect(JSON.parse(result.text)).toEqual({ success: false, error: SELF_PROTECTION });
    expect(loggedFor('rollback')[0][1].message).toContain('DEVCONTROL_PROD_INSTANCE_ID');
  });
});

describe('refusals written by the service keep their text and status', () => {
  const cases: Array<[Action, string, number]> = [
    ['approve', 'Cannot approve workflow in status: completed', 400],
    ['reject', 'Cannot reject workflow in status: rejected', 400],
    ['approve', 'Workflow not found', 404],
    ['execute', 'Workflow must be approved before executing. Current status: failed', 400],
    ['execute', `${ACTION_UNAVAILABLE_PREFIX} EC2 rightsizing remediation is currently unavailable.`, 400],
    ['execute', REGION_UNKNOWN_MESSAGE, 409],
    ['execute', 'No active AWS account configured. Connect an AWS account first.', 500],
    ['rollback', 'Can only rollback completed workflows', 400],
  ];

  it.each(cases)('%s: %s', async (action, message, status) => {
    throwFrom(SERVICE_METHOD[action], new Error(message));

    const result = await act(action);

    expect(result.status).toBe(status);
    expect(JSON.parse(result.text)).toEqual({ success: false, error: message });
  });

  it('a status message with anything appended is not passed through', async () => {
    throwFrom('approve', new Error('Cannot approve workflow in status: completed (arn:aws:iam::123456789012:role/x)'));

    const result = await act('approve');

    expect(JSON.parse(result.text)).toEqual({ success: false, error: 'Failed to approve workflow' });
  });
});
