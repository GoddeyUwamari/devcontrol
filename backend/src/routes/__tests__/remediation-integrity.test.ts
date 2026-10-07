/**
 * Remediation workflow integrity and authorization.
 *
 * Policy under test:
 *   - POST /api/remediation (a draft: two database rows, no AWS call) is for
 *     member, admin and owner; a viewer is refused with 403.
 *   - approve, reject, execute and rollback stay admin/owner only.
 *   - A referenced recommendation must belong to the caller's organization;
 *     another organization's is answered exactly like one that does not exist.
 *   - A workflow has one target. action_params.resource_id is set from
 *     resourceId, a different value is refused, and execute, rollback and the
 *     self-protection guards all act on that one target.
 *   - Rollback obeys the kill-switch and the self-protection guards, as
 *     execute does.
 *   - Another organization's workflow is answered exactly like one that does
 *     not exist.
 *
 * Real routes over an in-process HTTP server against live Postgres, in
 * Enterprise organizations so the plan gate (which runs before the role
 * check) passes. Stubbed: authService.verifyToken (to choose the caller) and
 * the STS and EC2 clients -- no test reaches AWS.
 *
 * POST /:id/execute is limited to 10 requests an hour per caller address, and
 * every request here comes from one address: this file sends 9.
 */
import express from 'express';
import http from 'http';
import { Pool } from 'pg';
import { STSClient } from '@aws-sdk/client-sts';
import {
  EC2Client,
  DescribeInstancesCommand,
  StartInstancesCommand,
  StopInstancesCommand,
  CreateSnapshotCommand,
} from '@aws-sdk/client-ec2';
import { createRemediationRoutes } from '../remediation.routes';
import { errorHandler } from '../../middleware/error-handler';
import { authService } from '../../services/auth.service';
import { pool as appPool } from '../../config/database';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const NONEXISTENT_ID = '00000000-0000-4000-8000-0000000000aa';
const ROLE_REFUSAL = {
  success: false,
  error: 'Only admins and owners can approve, reject, execute, or roll back remediation workflows.',
};
const LIFECYCLE_ACTIONS = ['approve', 'reject', 'execute', 'rollback'] as const;

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];
const ORIGINAL_ENV = { ...process.env };

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

function instanceId(): string {
  return `i-${Math.random().toString(16).slice(2, 12).padEnd(10, '0')}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'enterprise', 'active') RETURNING id`,
    [`Remediation Integrity ${suffix}`, `remediation-integrity-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(label: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Remediation Integrity User') RETURNING id`,
    [`remediation-integrity-${label}-${uniqueSuffix()}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function member(
  orgId: string,
  role: string,
  state: { isActive?: boolean; invitationToken?: string | null } = {}
): Promise<string> {
  const userId = await insertUser(role);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active, invitation_token)
     VALUES ($1, $2, $3, NOW(), $4, $5)`,
    [orgId, userId, role, state.isActive ?? true, state.invitationToken ?? null]
  );
  return userId;
}

async function buildOrg() {
  const orgId = await insertOrg();
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, status)
     VALUES ($1, $2, $3, 'remediation-integrity-external-id', 'active')`,
    [orgId, 'arn:aws:iam::000000000000:role/remediation-integrity', uniqueSuffix().slice(0, 32)]
  );
  return {
    orgId,
    owner: await member(orgId, 'owner'),
    admin: await member(orgId, 'admin'),
    member: await member(orgId, 'member'),
    viewer: await member(orgId, 'viewer'),
  };
}

type Org = Awaited<ReturnType<typeof buildOrg>>;
type Role = 'owner' | 'admin' | 'member' | 'viewer';

async function insertRecommendation(orgId: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_type, issue, severity)
     VALUES ($1, $2, 'EC2', 'Idle Instance', 'LOW') RETURNING id`,
    [orgId, instanceId()]
  );
  return rows[0].id as string;
}

/** A stored workflow, written directly so it can be in any state. */
async function insertWorkflow(
  orgId: string,
  overrides: {
    resourceId?: string;
    actionParams?: Record<string, unknown>;
    status?: string;
    rollbackAvailable?: boolean;
  } = {}
): Promise<{ id: string; resourceId: string }> {
  const resourceId = overrides.resourceId ?? instanceId();
  const { rows } = await pool.query(
    `INSERT INTO remediation_workflows
       (organization_id, resource_id, resource_type, action_type, action_params, risk_level, status, rollback_available)
     VALUES ($1, $2, 'EC2', 'stop_instance', $3, 'low', $4, $5) RETURNING id`,
    [
      orgId,
      resourceId,
      JSON.stringify(overrides.actionParams ?? { resource_id: resourceId, region: 'us-east-1' }),
      overrides.status ?? 'pending_approval',
      overrides.rollbackAvailable ?? false,
    ]
  );
  return { id: rows[0].id as string, resourceId };
}

async function workflowRow(id: string) {
  const { rows } = await pool.query('SELECT * FROM remediation_workflows WHERE id = $1', [id]);
  return rows[0];
}

/** Every workflow and audit row an organization has. */
async function rowCounts(orgId: string): Promise<{ workflows: number; audits: number }> {
  const { rows } = await pool.query(
    `SELECT (SELECT COUNT(*)::int FROM remediation_workflows WHERE organization_id = $1) AS workflows,
            (SELECT COUNT(*)::int FROM remediation_audit_log al
               JOIN remediation_workflows rw ON rw.id = al.workflow_id
              WHERE rw.organization_id = $1) AS audits`,
    [orgId]
  );
  return rows[0];
}

function draft(overrides: Record<string, unknown> = {}) {
  return {
    resourceId: instanceId(),
    resourceType: 'EC2',
    actionType: 'stop_instance',
    riskLevel: 'low',
    estimatedSavings: 12,
    ...overrides,
  };
}

let server: http.Server;
let baseUrl: string;
let home: Org;
let other: Org;
let stsSend: jest.SpyInstance;
let ec2Send: jest.SpyInstance;
/** Tags the stubbed DescribeInstances reports for the instance it is asked about. */
let instanceTags: Array<{ Key: string; Value: string }>;

const awsCommands = <T>(type: new (...args: any[]) => T): T[] =>
  ec2Send.mock.calls.map(([command]) => command).filter((command) => command instanceof type);

function expectNoAwsMutation() {
  expect(awsCommands(StopInstancesCommand)).toHaveLength(0);
  expect(awsCommands(StartInstancesCommand)).toHaveLength(0);
  expect(awsCommands(CreateSnapshotCommand)).toHaveLength(0);
}

function expectNoAwsCall() {
  expect(stsSend).not.toHaveBeenCalled();
  expect(ec2Send).not.toHaveBeenCalled();
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await ensureSharedFixtureTable(pool, 'remediation_workflows');
  await ensureSharedFixtureTable(pool, 'remediation_audit_log');
  home = await buildOrg();
  other = await buildOrg();

  const app = express();
  app.use(express.json());
  // The same factory, mounted at the same path, as server.ts.
  app.use('/api/remediation', createRemediationRoutes(appPool));
  app.use(errorHandler);
  server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : 0;
  baseUrl = `http://127.0.0.1:${port}/api/remediation`;
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});

  delete process.env.ENABLE_AUTOMATED_REMEDIATION;
  delete process.env.DEVCONTROL_PROD_INSTANCE_ID;
  delete process.env.DEVCONTROL_OPERATIONAL_ORG_ID;

  instanceTags = [];
  stsSend = jest.spyOn(STSClient.prototype, 'send').mockImplementation(async () => ({
    Credentials: { AccessKeyId: 'stub-key', SecretAccessKey: 'stub-secret', SessionToken: 'stub-token' },
  }));
  ec2Send = jest.spyOn(EC2Client.prototype, 'send').mockImplementation(async (command: unknown) =>
    command instanceof DescribeInstancesCommand ? { Reservations: [{ Instances: [{ Tags: instanceTags }] }] } : {}
  );
});

afterEach(() => {
  process.env = { ...ORIGINAL_ENV };
  jest.restoreAllMocks();
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  await pool.query('DELETE FROM remediation_workflows WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM cost_recommendations WHERE organization_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
  await pool.query(
    'DELETE FROM organization_memberships WHERE organization_id = ANY($1) OR user_id = ANY($2)',
    [createdOrgIds, createdUserIds]
  );
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  await pool.end();
  await appPool.end();
});

/**
 * A request authenticated as `userId` in `orgId`. The token's role CLAIM is
 * always 'owner', so every refusal below is proven to come from the caller's
 * current membership rather than the claim.
 */
function sendAs(orgId: string, userId: string, method: string, route = '', body?: unknown) {
  jest.spyOn(authService, 'verifyToken').mockReturnValue({
    userId,
    email: 'remediation-integrity-caller@example.com',
    organizationId: orgId,
    role: 'owner',
    type: 'access',
  } as unknown as ReturnType<typeof authService.verifyToken>);
  return fetch(`${baseUrl}${route}`, {
    method,
    headers: { Authorization: 'Bearer test-token', 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

const create = (org: Org, role: Role, body: unknown) => sendAs(org.orgId, org[role], 'POST', '', body);
const act = (org: Org, role: Role, id: string, action: string) =>
  sendAs(org.orgId, org[role], 'POST', `/${id}/${action}`, action === 'reject' ? { reason: 'test' } : {});

describe('POST /api/remediation: recommendation ownership', () => {
  it('accepts a recommendation of the caller’s own organization', async () => {
    const recommendationId = await insertRecommendation(home.orgId);
    const before = await rowCounts(home.orgId);

    const response = await create(home, 'member', draft({ recommendationId }));

    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data).toMatchObject({
      organization_id: home.orgId,
      recommendation_id: recommendationId,
      status: 'pending_approval',
    });
    expect(await rowCounts(home.orgId)).toEqual({ workflows: before.workflows + 1, audits: before.audits + 1 });
    expect((await workflowRow(data.id)).organization_id).toBe(home.orgId);
  });

  it('answers another organization’s recommendation exactly like one that does not exist, writing nothing', async () => {
    const foreignId = await insertRecommendation(other.orgId);
    const before = await rowCounts(home.orgId);

    const foreign = await create(home, 'member', draft({ recommendationId: foreignId }));
    const missing = await create(home, 'member', draft({ recommendationId: NONEXISTENT_ID }));

    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    const foreignBody = await foreign.json();
    expect(foreignBody).toEqual({ success: false, error: 'Recommendation not found' });
    expect(await missing.json()).toEqual(foreignBody);
    expect(await rowCounts(home.orgId)).toEqual(before);
    expect(await rowCounts(other.orgId)).toEqual({ workflows: 0, audits: 0 });
  });

  it.each(['not-a-uuid', '', 42, { id: NONEXISTENT_ID }])(
    'refuses the malformed recommendationId %p with 400, writing nothing',
    async (recommendationId) => {
      const before = await rowCounts(home.orgId);

      const response = await create(home, 'member', draft({ recommendationId }));

      expect(response.status).toBe(400);
      expect(await rowCounts(home.orgId)).toEqual(before);
    }
  );

  it.each([undefined, null])('still creates a workflow with no recommendation (%p)', async (recommendationId) => {
    const response = await create(home, 'member', draft({ recommendationId }));

    expect(response.status).toBe(201);
    expect((await response.json()).data.recommendation_id).toBeNull();
  });
});

describe('POST /api/remediation: one target', () => {
  it('accepts action params that name the same resource', async () => {
    const resourceId = instanceId();

    const response = await create(
      home,
      'member',
      draft({ resourceId, actionParams: { resource_id: resourceId, region: 'eu-west-1' } })
    );

    expect(response.status).toBe(201);
    const { data } = await response.json();
    expect(data.resource_id).toBe(resourceId);
    expect(data.action_params).toEqual({ resource_id: resourceId, region: 'eu-west-1' });
  });

  it.each([undefined, {}, { region: 'eu-west-1' }])(
    'sets the action target from resourceId when action params are %p',
    async (actionParams) => {
      const resourceId = instanceId();

      const response = await create(home, 'member', draft({ resourceId, actionParams }));

      expect(response.status).toBe(201);
      expect((await response.json()).data.action_params).toEqual({ ...actionParams, resource_id: resourceId });
    }
  );

  it.each([[instanceId()], [null], [''], [['i-0000000000']]])(
    'refuses action params naming a different resource (%p) with 400, writing nothing',
    async (conflicting) => {
      const before = await rowCounts(home.orgId);

      const response = await create(home, 'member', draft({ actionParams: { resource_id: conflicting } }));

      expect(response.status).toBe(400);
      expect((await response.json()).error).toMatch(/^TARGET_MISMATCH:/);
      expect(await rowCounts(home.orgId)).toEqual(before);
    }
  );

  it.each([[['i-0000000000', 'i-1111111111']], [{ id: 'i-0000000000' }], [7]])(
    'refuses a resourceId that is not a string (%p) with 400, writing nothing',
    async (resourceId) => {
      const before = await rowCounts(home.orgId);

      const response = await create(home, 'member', draft({ resourceId }));

      expect(response.status).toBe(400);
      expect(await rowCounts(home.orgId)).toEqual(before);
    }
  );

  it('a self-protected instance cannot be smuggled in behind a harmless resourceId', async () => {
    process.env.DEVCONTROL_PROD_INSTANCE_ID = instanceId();
    const before = await rowCounts(home.orgId);

    const response = await create(
      home,
      'member',
      draft({ actionParams: { resource_id: process.env.DEVCONTROL_PROD_INSTANCE_ID } })
    );

    expect(response.status).toBe(400);
    expect(await rowCounts(home.orgId)).toEqual(before);
  });
});

describe('execute acts on the workflow’s one target', () => {
  it('stops the resource the workflow names, after the tag guard inspected that same resource', async () => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    const resourceId = instanceId();
    const created = await create(home, 'member', draft({ resourceId }));
    const { id } = (await created.json()).data;
    expect((await act(home, 'admin', id, 'approve')).status).toBe(200);

    const response = await act(home, 'owner', id, 'execute');

    expect(response.status).toBe(200);
    const describes = awsCommands(DescribeInstancesCommand);
    const stops = awsCommands(StopInstancesCommand);
    expect(stops).toHaveLength(1);
    expect(stops[0].input.InstanceIds).toEqual([resourceId]);
    // The tag guard runs first, and every lookup is for that one resource.
    expect(describes.length).toBeGreaterThan(0);
    for (const describe of describes) expect(describe.input.InstanceIds).toEqual([resourceId]);
    expect(ec2Send.mock.calls[0][0]).toBeInstanceOf(DescribeInstancesCommand);
    expect((await workflowRow(id)).status).toBe('completed');
  });

  it('refuses a stored workflow whose action target differs from its resource_id, reaching no AWS', async () => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    // A row as creation could write it before the target was bound: the
    // guards would inspect resource_id while the action stopped another.
    process.env.DEVCONTROL_PROD_INSTANCE_ID = instanceId();
    const { id } = await insertWorkflow(home.orgId, {
      actionParams: { resource_id: process.env.DEVCONTROL_PROD_INSTANCE_ID, region: 'us-east-1' },
      status: 'approved',
    });

    const response = await act(home, 'admin', id, 'execute');

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/^REMEDIATION_BLOCKED:.*does not match its resource_id/);
    expectNoAwsCall();
    expect((await workflowRow(id)).status).toBe('approved');
  });

  it('the self-protection guard blocks the workflow’s target', async () => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    const { id, resourceId } = await insertWorkflow(home.orgId, { status: 'approved' });
    process.env.DEVCONTROL_PROD_INSTANCE_ID = resourceId;

    const response = await act(home, 'admin', id, 'execute');

    expect(response.status).toBe(500);
    expect((await response.json()).error).toMatch(/^REMEDIATION_BLOCKED:.*DEVCONTROL_PROD_INSTANCE_ID/);
    expectNoAwsCall();
  });
});

describe('POST /api/remediation: who may create a draft', () => {
  it('refuses a viewer with 403, writing nothing', async () => {
    const before = await rowCounts(home.orgId);

    const response = await create(home, 'viewer', draft());

    expect(response.status).toBe(403);
    expect(await response.json()).toMatchObject({ success: false, error: 'Insufficient permissions' });
    expect(await rowCounts(home.orgId)).toEqual(before);
    expectNoAwsCall();
  });

  it.each(['member', 'admin', 'owner'] as const)('lets a %s create a draft, which reaches no AWS', async (role) => {
    const before = await rowCounts(home.orgId);

    const response = await create(home, role, draft());

    expect(response.status).toBe(201);
    expect(await rowCounts(home.orgId)).toEqual({ workflows: before.workflows + 1, audits: before.audits + 1 });
    expectNoAwsCall();
  });

  it.each([
    ['inactive', { isActive: false }],
    ['still-pending', { invitationToken: `pending-${uniqueSuffix()}` }],
  ])('refuses an %s owner membership with 401 MEMBERSHIP_REVOKED, writing nothing', async (_label, state) => {
    const userId = await member(home.orgId, 'owner', state);
    const before = await rowCounts(home.orgId);

    const response = await sendAs(home.orgId, userId, 'POST', '', draft());

    expect(response.status).toBe(401);
    expect((await response.json()).code).toBe('MEMBERSHIP_REVOKED');
    expect(await rowCounts(home.orgId)).toEqual(before);
    expectNoAwsCall();
  });

  it('a viewer can still read workflows', async () => {
    const { id } = await insertWorkflow(home.orgId);

    expect((await sendAs(home.orgId, home.viewer, 'GET')).status).toBe(200);
    expect((await sendAs(home.orgId, home.viewer, 'GET', `/${id}`)).status).toBe(200);
  });
});

describe('lifecycle actions stay admin/owner only', () => {
  it.each(['viewer', 'member'] as const)('refuses a %s on approve, reject, execute and rollback', async (role) => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    const pending = await insertWorkflow(home.orgId);
    const approved = await insertWorkflow(home.orgId, { status: 'approved' });
    const completed = await insertWorkflow(home.orgId, { status: 'completed', rollbackAvailable: true });
    const targets = { approve: pending, reject: pending, execute: approved, rollback: completed };
    const before = await rowCounts(home.orgId);

    for (const action of LIFECYCLE_ACTIONS) {
      const response = await act(home, role, targets[action].id, action);
      expect(response.status).toBe(403);
      expect(await response.json()).toEqual(ROLE_REFUSAL);
    }

    expect((await workflowRow(pending.id)).status).toBe('pending_approval');
    expect((await workflowRow(approved.id)).status).toBe('approved');
    expect((await workflowRow(completed.id)).status).toBe('completed');
    expect(await rowCounts(home.orgId)).toEqual(before);
    expectNoAwsCall();
  });

  it.each(['admin', 'owner'] as const)('a %s can approve and reject', async (role) => {
    const toApprove = await insertWorkflow(home.orgId);
    const toReject = await insertWorkflow(home.orgId);

    const approved = await act(home, role, toApprove.id, 'approve');
    const rejected = await act(home, role, toReject.id, 'reject');

    expect(approved.status).toBe(200);
    expect((await approved.json()).data).toMatchObject({ status: 'approved', approved_by: home[role] });
    expect(rejected.status).toBe(200);
    expect((await rejected.json()).data).toMatchObject({ status: 'rejected', rejection_reason: 'test' });
  });

  it('an admin’s execute is refused with 400 while the kill-switch is off: no AWS action', async () => {
    const { id } = await insertWorkflow(home.orgId, { status: 'approved' });

    const response = await act(home, 'admin', id, 'execute');

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/^DRY_RUN_MODE:/);
    expect((await workflowRow(id)).status).toBe('approved');
    expectNoAwsCall();
  });
});

describe('another organization’s workflow', () => {
  it.each(['admin', 'owner'] as const)(
    'is answered to a %s exactly like one that does not exist, and is left unchanged',
    async (role) => {
      process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
      const pending = await insertWorkflow(other.orgId);
      const approved = await insertWorkflow(other.orgId, { status: 'approved' });
      const completed = await insertWorkflow(other.orgId, { status: 'completed', rollbackAvailable: true });
      const targets = { approve: pending, reject: pending, execute: approved, rollback: completed };
      const snapshot = async () => [
        await workflowRow(pending.id),
        await workflowRow(approved.id),
        await workflowRow(completed.id),
        await rowCounts(other.orgId),
      ];
      const before = await snapshot();

      for (const action of LIFECYCLE_ACTIONS) {
        const foreign = await act(home, role, targets[action].id, action);
        expect(foreign.status).toBe(404);
        const foreignBody = await foreign.json();
        expect(foreignBody).toEqual({ success: false, error: 'Workflow not found' });

        // One execute comparison is enough for the hourly execute limit.
        if (action === 'execute' && role === 'owner') continue;
        const missing = await act(home, role, NONEXISTENT_ID, action);
        expect(missing.status).toBe(404);
        expect(await missing.json()).toEqual(foreignBody);
      }

      expect((await sendAs(home.orgId, home[role], 'GET', `/${pending.id}`)).status).toBe(404);
      expect(await snapshot()).toEqual(before);
      expectNoAwsCall();
    }
  );
});

describe('rollback obeys the same safety boundary as execute', () => {
  const completedWorkflow = (overrides: Parameters<typeof insertWorkflow>[1] = {}) =>
    insertWorkflow(home.orgId, { status: 'completed', rollbackAvailable: true, ...overrides });

  it.each(['admin', 'owner'] as const)('a %s’s rollback restarts the resource the workflow names', async (role) => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    const { id, resourceId } = await completedWorkflow();

    const response = await act(home, role, id, 'rollback');

    expect(response.status).toBe(200);
    const starts = awsCommands(StartInstancesCommand);
    expect(starts).toHaveLength(1);
    expect(starts[0].input.InstanceIds).toEqual([resourceId]);
    for (const describe of awsCommands(DescribeInstancesCommand)) {
      expect(describe.input.InstanceIds).toEqual([resourceId]);
    }
    expect((await workflowRow(id)).status).toBe('rolled_back');
  });

  it.each([undefined, 'false'])('takes no AWS action while the kill-switch is %p', async (flag) => {
    if (flag !== undefined) process.env.ENABLE_AUTOMATED_REMEDIATION = flag;
    const { id } = await completedWorkflow();

    const response = await act(home, 'admin', id, 'rollback');

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/^DRY_RUN_MODE:/);
    expectNoAwsCall();
    expect((await workflowRow(id)).status).toBe('completed');
  });

  it('refuses a stored workflow whose action target differs from its resource_id', async () => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    const { id } = await completedWorkflow({ actionParams: { resource_id: instanceId(), region: 'us-east-1' } });

    const response = await act(home, 'admin', id, 'rollback');

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/^REMEDIATION_BLOCKED:.*does not match its resource_id/);
    expectNoAwsCall();
    expect((await workflowRow(id)).status).toBe('completed');
  });

  it('cannot act on the self-protected instance', async () => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    const { id, resourceId } = await completedWorkflow();
    process.env.DEVCONTROL_PROD_INSTANCE_ID = resourceId;

    const response = await act(home, 'admin', id, 'rollback');

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/^REMEDIATION_BLOCKED:.*DEVCONTROL_PROD_INSTANCE_ID/);
    expectNoAwsCall();
    expect((await workflowRow(id)).status).toBe('completed');
  });

  it('cannot act for the self-protected organization', async () => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    process.env.DEVCONTROL_OPERATIONAL_ORG_ID = home.orgId;
    const { id } = await completedWorkflow();

    const response = await act(home, 'admin', id, 'rollback');

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/^REMEDIATION_BLOCKED:.*DEVCONTROL_OPERATIONAL_ORG_ID/);
    expectNoAwsCall();
  });

  it('cannot start an instance tagged as DevControl infrastructure', async () => {
    process.env.ENABLE_AUTOMATED_REMEDIATION = 'true';
    instanceTags = [{ Key: 'App', Value: 'DevControl' }];
    const { id, resourceId } = await completedWorkflow();

    const response = await act(home, 'admin', id, 'rollback');

    expect(response.status).toBe(400);
    expect((await response.json()).error).toMatch(/^REMEDIATION_BLOCKED:.*App=DevControl/);
    expect(awsCommands(DescribeInstancesCommand)[0].input.InstanceIds).toEqual([resourceId]);
    expectNoAwsMutation();
    expect((await workflowRow(id)).status).toBe('completed');
  });
});
