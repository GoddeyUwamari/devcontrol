/**
 * Cache isolation for the evidence the AI reads (AI truth PR 2, step1 §4):
 * the CloudWatch alarms cache (cloudwatch-alarms.service.ts) is keyed by
 * organization AND connection, so
 *   - two organizations never share an entry, even with identical connection
 *     identities (the organization is part of the key and is checked again);
 *   - a changed connection is never answered from the old one's entry;
 *   - a cached result is served for 60 seconds only, and the registry marks
 *     a reading older than five minutes stale -- never current.
 * pool.query (the aws_accounts read) and AWSClientFactory are faked; no AWS.
 */
jest.mock('../../../../config/database', () => ({ pool: { query: jest.fn() } }));
jest.mock('../../../aws-client-factory.service', () => ({
  AWSClientFactory: { createClients: jest.fn() },
  assumedRoleSourceOf: jest.fn(),
}));

import { DescribeAlarmsCommand } from '@aws-sdk/client-cloudwatch';
import { pool } from '../../../../config/database';
import { AWSClientFactory, assumedRoleSourceOf } from '../../../aws-client-factory.service';
import { CloudWatchAlarmsService } from '../../../cloudwatch-alarms.service';
import { DEFAULT_AWS_CALL_POLICY } from '../../../../utils/awsCallPolicy';
import { collectSection } from '../../../ai-context-contract';
import { collectProvider } from '../registry';
import { createEvidenceBasis, type BasisSources } from '../basis';
import { cloudWatchAlarmsProvider, operationsSources } from '../providers/operations';

const ORG_A = '00000000-0000-4000-8000-00000000aaaa';
const ORG_B = '00000000-0000-4000-8000-00000000bbbb';
const T0 = Date.parse('2026-11-06T12:00:00.000Z');

const query = pool.query as unknown as jest.Mock;
const createClients = AWSClientFactory.createClients as unknown as jest.Mock;
const sourceOf = assumedRoleSourceOf as unknown as jest.Mock;

/** The same connection identity for every organization: same row id, account, role and region. */
const SHARED_ROW = { id: 'row-shared', account_id: '123456789012', role_arn: 'arn:aws:iam::123456789012:role/devcontrol', external_id: 'x', region: 'us-east-1', nickname: null, status: 'active', connected_at: null };

let alarmsByOrg: Record<string, string[]>;
let rowId: string;
let now: number;

beforeEach(() => {
  now = T0;
  rowId = SHARED_ROW.id;
  alarmsByOrg = { [ORG_A]: ['alpha-alarm'], [ORG_B]: ['bravo-alarm'] };
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  query.mockReset().mockImplementation(async (_sql: string, params: unknown[]) => ({ rows: [{ ...SHARED_ROW, id: rowId, org_id: params[0] }] }));
  const sources = new WeakMap<object, unknown>();
  createClients.mockReset().mockImplementation(async (orgId: string) => {
    const cloudWatch = {
      send: jest.fn(async (command: unknown) => {
        if (!(command instanceof DescribeAlarmsCommand)) throw new Error('only DescribeAlarms');
        const names = alarmsByOrg[orgId] ?? [];
        return { MetricAlarms: names.map((n) => ({ AlarmName: n, StateValue: 'ALARM', Namespace: 'AWS/EC2', MetricName: 'CPUUtilization', Dimensions: [] })), CompositeAlarms: [] };
      }),
    };
    const clients = { enabled: true, region: 'us-east-1', cloudWatch };
    sources.set(clients, { organizationId: orgId, account: { ...SHARED_ROW, id: rowId, org_id: orgId }, region: 'us-east-1' });
    return clients;
  });
  sourceOf.mockReset().mockImplementation((clients: object) => sources.get(clients));
});
afterEach(() => jest.restoreAllMocks());

const service = () => new CloudWatchAlarmsService({ ...DEFAULT_AWS_CALL_POLICY, sleep: async () => undefined, timeoutMs: 1_000 }, () => now);
const names = (r: Awaited<ReturnType<CloudWatchAlarmsService['getAlarms']>>) => (r.status === 'ok' ? r.in_alarm.map((a) => a.name) : r.reason);

describe('the CloudWatch alarms cache', () => {
  it('never crosses organizations, even when their connection identities are identical', async () => {
    const svc = service();
    expect(names(await svc.getAlarms(ORG_A))).toEqual(['alpha-alarm']);
    expect(names(await svc.getAlarms(ORG_B))).toEqual(['bravo-alarm']);
    // Both cached now: each organization still gets only its own.
    expect(names(await svc.getAlarms(ORG_A))).toEqual(['alpha-alarm']);
    expect(names(await svc.getAlarms(ORG_B))).toEqual(['bravo-alarm']);
    expect(createClients).toHaveBeenCalledTimes(2);
  });

  it('never answers a changed connection from the old entry', async () => {
    const svc = service();
    await svc.getAlarms(ORG_A);
    rowId = 'row-reconnected';
    alarmsByOrg[ORG_A] = ['after-reconnect'];
    expect(names(await svc.getAlarms(ORG_A))).toEqual(['after-reconnect']);
  });

  it('serves an entry for 60 seconds only', async () => {
    const svc = service();
    await svc.getAlarms(ORG_A);
    alarmsByOrg[ORG_A] = ['newer'];
    now = T0 + 59_000;
    expect(names(await svc.getAlarms(ORG_A))).toEqual(['alpha-alarm']);
    now = T0 + 60_000;
    expect(names(await svc.getAlarms(ORG_A))).toEqual(['newer']);
  });
});

describe('through the evidence registry', () => {
  const basisSources = {
    context: {
      gatherInventoryBasis: async () => ({
        discovery: await collectSection({ source: 'd' }, async () => ({ state: 'unavailable' as const, reason: 'x' })),
        account: await collectSection({ source: 'a' }, async () => ({ state: 'available' as const, data: { accountId: '123456789012', region: 'us-east-1' } })),
        inventoryScope: { kind: 'resource_inventory' as const, connectedAccountId: '123456789012', discoveryRegion: 'us-east-1' },
      }),
    },
  } as unknown as BasisSources;

  it('a cached reading is never presented as current once older than five minutes', async () => {
    const svc = service();
    jest.spyOn(operationsSources, 'alarms').mockImplementation((org: string) => svc.getAlarms(org));
    const at = (iso: string) => ({ organizationId: ORG_A, now: new Date(iso), period: { from: '2026-10-07', to: '2026-11-07' }, basis: createEvidenceBasis(ORG_A, basisSources) });

    const fresh = await collectProvider(cloudWatchAlarmsProvider, at('2026-11-06T12:00:30.000Z'));
    expect(fresh.state).toBe('available');
    // The same reading (asOf 12:00:00), presented six minutes later, is stale.
    jest.spyOn(operationsSources, 'alarms').mockResolvedValue(await svc.getAlarms(ORG_A));
    const later = await collectProvider(cloudWatchAlarmsProvider, at('2026-11-06T12:06:00.000Z'));
    expect(later.state).toBe('stale');
    expect(later.reason).toMatch(/^as of 2026-11-06T12:00:00\.000Z, older than five minutes/);
  });

  it('each organization\'s provider section carries only its own alarms', async () => {
    const svc = service();
    jest.spyOn(operationsSources, 'alarms').mockImplementation((org: string) => svc.getAlarms(org));
    const ctx = (org: string) => ({ organizationId: org, now: new Date(T0), period: { from: '2026-10-07', to: '2026-11-07' }, basis: createEvidenceBasis(org, basisSources) });
    const a = await collectProvider(cloudWatchAlarmsProvider, ctx(ORG_A));
    const b = await collectProvider(cloudWatchAlarmsProvider, ctx(ORG_B));
    expect(a.untrusted?.map((u) => u.text)).toEqual(['alpha-alarm']);
    expect(b.untrusted?.map((u) => u.text)).toEqual(['bravo-alarm']);
  });
});
