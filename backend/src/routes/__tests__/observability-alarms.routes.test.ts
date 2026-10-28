/**
 * GET /api/observability/alarms: authentication, tenant isolation, and that
 * an AWS failure is reported as an error, never as 0 alarms.
 *
 * Policy under test:
 *   - 401 without a token and for an inactive membership; every role with an
 *     active membership may read, viewers included.
 *   - The organization, account and region are the authenticated caller's.
 *     Nothing in the query string selects them.
 *   - An error carries no count and no list.
 *   - The route is mounted at /api/observability only.
 *
 * Real route over an in-process HTTP server against live Postgres (the
 * aws_accounts read is real). authService.verifyToken chooses the caller;
 * AWSClientFactory.createClients is replaced by a fake that resolves the
 * caller's real eligible account and returns a fake CloudWatch client for it.
 * Placeholders only.
 */
import fs from 'fs';
import path from 'path';
import { DescribeAlarmsCommand, type MetricAlarm } from '@aws-sdk/client-cloudwatch';

jest.mock('../../services/aws-client-factory.service', () => ({
  ...jest.requireActual('../../services/aws-client-factory.service'),
  assumedRoleSourceOf: jest.fn(),
}));

import observabilityAlarmsRoutes from '../observability-alarms.routes';
import observabilityRoutes from '../observability.routes';
import { AWSClientFactory, assumedRoleSourceOf } from '../../services/aws-client-factory.service';
import * as accountsRepository from '../../repositories/aws-accounts.repository';
import { AwsAccountAmbiguousError, homeRegionOf, requireEligibleAwsAccount } from '../../repositories/aws-accounts.repository';
import { pool as appPool } from '../../config/database';
import { createRoleGateHarness, Role, RoleGateOrg } from './role-gate-harness';
import { ensureSharedFixtureTable } from './shared-fixture-tables';

const harness = createRoleGateHarness('observability-alarms');
const { pool } = harness;
const sourceOf = assumedRoleSourceOf as unknown as jest.Mock;

const suffix = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const alarm = (name: string, instanceId: string): MetricAlarm => ({
  AlarmName: name,
  AlarmArn: `arn:aws:cloudwatch:us-east-1:123456789012:alarm:${name}`,
  AlarmDescription: 'description not kept',
  AlarmActions: ['arn:aws:sns:us-east-1:123456789012:ops'],
  StateValue: 'ALARM',
  StateTransitionedTimestamp: new Date('2026-10-27T08:00:00.000Z'),
  Namespace: 'AWS/EC2',
  MetricName: 'CPUUtilization',
  Dimensions: [{ Name: 'InstanceId', Value: instanceId }],
  ComparisonOperator: 'GreaterThanThreshold',
  Threshold: 80,
});

/** What each account row's fake CloudWatch answers: alarms, or an error. */
const cloudByAccountRow = new Map<string, MetricAlarm[] | Error>();
const sources = new WeakMap<object, unknown>();
const sends: Array<{ accountRowId: string }> = [];

let orgA: RoleGateOrg;
let orgB: RoleGateOrg;
let unconnected: RoleGateOrg;
let deniedOrg: RoleGateOrg;
let accountRowA = '';
let accountRowB = '';

async function connect(orgId: string, region: string): Promise<string> {
  const { rows } = await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status)
     VALUES ($1, $2, $3, 'observability-alarms-external-id', $4, 'active') RETURNING id`,
    [orgId, 'arn:aws:iam::000000000000:role/observability-alarms', `oa-${suffix()}`.slice(0, 32), region]
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  orgA = await harness.buildOrg();
  orgB = await harness.buildOrg();
  unconnected = await harness.buildOrg();
  deniedOrg = await harness.buildOrg();
  accountRowA = await connect(orgA.orgId, 'us-east-1');
  accountRowB = await connect(orgB.orgId, 'eu-west-1');
  const deniedRow = await connect(deniedOrg.orgId, 'us-east-1');
  cloudByAccountRow.set(accountRowA, [alarm('org-a-alarm', 'i-0aaaaaaaaaaaaaaaa')]);
  cloudByAccountRow.set(accountRowB, [alarm('org-b-alarm', 'i-0bbbbbbbbbbbbbbbb'), alarm('org-b-second', 'i-0cccccccccccccccc')]);
  cloudByAccountRow.set(deniedRow, Object.assign(new Error('not authorized'), { name: 'AccessDenied' }));

  await harness.listen((app) => {
    // As server.ts mounts them.
    app.use('/api/observability', observabilityRoutes);
    app.use('/api/observability', observabilityAlarmsRoutes);
    app.use('/api/system', observabilityRoutes);
  });
});

beforeEach(() => {
  sends.length = 0;
  // The caller's real eligible account, assumed by a fake: its CloudWatch answers for that row only.
  jest.spyOn(AWSClientFactory, 'createClients').mockImplementation(async (organizationId: string) => {
    const account = await requireEligibleAwsAccount(appPool, organizationId);
    const answer = cloudByAccountRow.get(account.id) ?? [];
    const cloudWatch = {
      send: jest.fn(async (command: unknown) => {
        if (!(command instanceof DescribeAlarmsCommand)) throw new Error('only DescribeAlarms is expected');
        sends.push({ accountRowId: account.id });
        if (answer instanceof Error) throw answer;
        return { MetricAlarms: answer, CompositeAlarms: [] };
      }),
    };
    const clients = { enabled: true, region: homeRegionOf(account), cloudWatch } as any;
    sources.set(clients, { organizationId, account, region: homeRegionOf(account) });
    return clients;
  });
  sourceOf.mockImplementation((clients: object) => sources.get(clients));
});

afterEach(() => jest.restoreAllMocks());

afterAll(async () => {
  await harness.close(async (orgIds) => {
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [orgIds]);
  });
});

const get = (org: RoleGateOrg, role: Role, query = '') => harness.sendAs(org.orgId, org[role], 'GET', `/observability/alarms${query}`);

describe('GET /api/observability/alarms', () => {
  it('401 without a token', async () => {
    const response = await fetch(`${harness.url()}/observability/alarms`);
    expect(response.status).toBe(401);
  });

  it('401 for an inactive membership', async () => {
    const user = await harness.insertUser('removed');
    await pool.query(
      `INSERT INTO organization_memberships (organization_id, user_id, role, joined_at, is_active)
       VALUES ($1, $2, 'owner', NOW(), false)`,
      [orgA.orgId, user.id]
    );
    const response = await harness.sendAs(orgA.orgId, user.id, 'GET', '/observability/alarms');
    expect(response.status).toBe(401);
    expect(sends).toEqual([]);
  });

  it.each(['viewer', 'member', 'admin', 'owner'] as Role[])('a %s reads the organization\'s alarms', async (role) => {
    const response = await get(orgA, role);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.data).toMatchObject({ status: 'ok', region: 'us-east-1', configured_count: 1 });
    expect(body.data.in_alarm.map((i: { name: string }) => i.name)).toEqual(['org-a-alarm']);
  });

  it('each organization gets only its own account\'s alarms; the query string selects nothing', async () => {
    const a = await (await get(orgA, 'viewer', `?org=${orgB.orgId}&account_id=${accountRowB}&region=eu-west-1`)).json();
    const b = await (await get(orgB, 'viewer', `?org=${orgA.orgId}&account_id=${accountRowA}&region=us-east-1`)).json();
    expect(a.data.region).toBe('us-east-1');
    expect(a.data.in_alarm.map((i: { name: string }) => i.name)).toEqual(['org-a-alarm']);
    expect(b.data.region).toBe('eu-west-1');
    expect(b.data.in_alarm.map((i: { name: string }) => i.name)).toEqual(['org-b-alarm', 'org-b-second']);
    expect(sends.every((s) => s.accountRowId === accountRowA || s.accountRowId === accountRowB)).toBe(true);
    const text = JSON.stringify(a) + JSON.stringify(b);
    expect(text).not.toMatch(/arn:aws:|description not kept|\b\d{12}\b/);
  });

  it('access denied is status error with no count and no list, never 0', async () => {
    const response = await get(deniedOrg, 'viewer');
    expect(response.status).toBe(200);
    const { data } = await response.json();
    expect(data).toMatchObject({
      status: 'error',
      reason: 'access_denied',
      in_alarm: null,
      configured_count: null,
      configured_count_complete: null,
      truncated: null,
    });
  });

  it('an organization with no connected account is not_connected', async () => {
    const { data } = await (await get(unconnected, 'viewer')).json();
    expect(data).toMatchObject({ status: 'error', reason: 'not_connected', configured_count: null, in_alarm: null, region: null });
    expect(sends).toEqual([]);
  });

  it('more than one eligible account is multiple_accounts', async () => {
    // aws_accounts_org_id_key keeps a second row out of the table, so the lookup is stubbed.
    jest.spyOn(accountsRepository, 'findEligibleAwsAccount').mockRejectedValue(new AwsAccountAmbiguousError(unconnected.orgId, 2));
    const { data } = await (await get(unconnected, 'viewer')).json();
    expect(data).toMatchObject({ status: 'error', reason: 'multiple_accounts', configured_count: null, in_alarm: null });
  });

  it('is not served under /api/system', async () => {
    const response = await harness.sendAs(orgA.orgId, orgA.viewer, 'GET', '/system/alarms');
    expect(response.status).toBe(404);
  });

  it('server.ts mounts it at /api/observability only', () => {
    const server = fs.readFileSync(path.join(__dirname, '..', '..', 'server.ts'), 'utf-8');
    const mounts = server.match(/app\.use\([^)]*observabilityAlarmsRoutes\)/g);
    expect(mounts).toEqual(["app.use('/api/observability', observabilityAlarmsRoutes)"]);
  });
});
