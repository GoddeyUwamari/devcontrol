/**
 * AWSCostService only ever reads an organization's own AWS bill.
 *
 * Invariant under test:
 *   - Every Cost Explorer fetch requires an organization id. Without one the
 *     call is refused before anything is looked up or constructed -- it is
 *     never answered from the shared instance or the platform's own account.
 *   - The service builds no AWS client of its own: not when the module loads
 *     its shared instance, not when constructed, and not with the platform's
 *     credentials present in the environment.
 *   - An organization with no connected (active) AWS account gets
 *     AWS_NOT_CONNECTED and no Cost Explorer client.
 *   - A connected organization's Cost Explorer client carries the temporary
 *     credentials of its assumed role, explicitly. The only other client is
 *     the STS client that assumes that role.
 *
 * The AWS SDK client constructors are replaced with recorders and the
 * database pool is a stub, so no network or database call is made.
 */
interface Construction {
  client: string;
  config: { region?: string; credentials?: unknown } | undefined;
}

const mockConstructed: Construction[] = [];
const mockStsSend = jest.fn();
const mockCostExplorerSend = jest.fn();

function mockRecorder(client: string, send?: jest.Mock) {
  return class {
    send = send ?? jest.fn();
    constructor(config?: Construction['config']) {
      mockConstructed.push({ client, config });
    }
  };
}

jest.mock('@aws-sdk/client-sts', () => ({
  ...jest.requireActual('@aws-sdk/client-sts'),
  STSClient: mockRecorder('STSClient', mockStsSend),
}));
jest.mock('@aws-sdk/client-cost-explorer', () => ({
  ...jest.requireActual('@aws-sdk/client-cost-explorer'),
  CostExplorerClient: mockRecorder('CostExplorerClient', mockCostExplorerSend),
}));
// The service once built these on the platform's keys too; it must build none.
jest.mock('@aws-sdk/client-ec2', () => ({ ...jest.requireActual('@aws-sdk/client-ec2'), EC2Client: mockRecorder('EC2Client') }));
jest.mock('@aws-sdk/client-rds', () => ({ ...jest.requireActual('@aws-sdk/client-rds'), RDSClient: mockRecorder('RDSClient') }));
jest.mock('@aws-sdk/client-s3', () => ({ ...jest.requireActual('@aws-sdk/client-s3'), S3Client: mockRecorder('S3Client') }));
jest.mock('../../config/database', () => ({ pool: { query: jest.fn() } }));

const PLATFORM_KEYS = { accessKeyId: 'AKIAPLATFORMKEYID', secretAccessKey: 'platform-secret-not-a-credential' };
// Present before the module (and its shared instance) is loaded: the old
// constructor built four clients on these the moment it ran.
process.env.AWS_ACCESS_KEY_ID = PLATFORM_KEYS.accessKeyId;
process.env.AWS_SECRET_ACCESS_KEY = PLATFORM_KEYS.secretAccessKey;
process.env.AWS_REGION = 'us-east-1';

import type { Pool } from 'pg';
import sharedCostService, { AWSCostService } from '../aws-cost.service';
// eslint-disable-next-line @typescript-eslint/no-var-requires
const ambientPool = require('../../config/database').pool as { query: jest.Mock };

const constructedAtModuleLoad = [...mockConstructed];

const TEMPORARY = { accessKeyId: 'ASIACUSTOMERTEMP', secretAccessKey: 'customer-temp-secret', sessionToken: 'customer-session-token' };
const ACCOUNT_ROW = { role_arn: 'arn:aws:iam::123456789012:role/devcontrol-readonly', external_id: 'external-id-1', region: 'eu-west-1' };
const ENV_BEFORE_TESTS = { ...process.env };

let poolQuery: jest.Mock;
let service: AWSCostService;

function monthlyResponse(amount: string) {
  return { ResultsByTime: [{ Groups: [{ Keys: ['Amazon EC2'], Metrics: { UnblendedCost: { Amount: amount } } }] }] };
}

beforeEach(() => {
  mockConstructed.length = 0;
  mockStsSend.mockReset();
  mockCostExplorerSend.mockReset();
  ambientPool.query.mockReset();
  process.env = { ...ENV_BEFORE_TESTS };
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  poolQuery = jest.fn();
  // A fresh instance per test: its caches are per instance.
  service = new AWSCostService({ query: poolQuery } as unknown as Pool);
  mockConstructed.length = 0;
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  process.env = ENV_BEFORE_TESTS;
});

function connected() {
  poolQuery.mockResolvedValue({ rows: [ACCOUNT_ROW] });
  mockStsSend.mockResolvedValue({
    Credentials: { AccessKeyId: TEMPORARY.accessKeyId, SecretAccessKey: TEMPORARY.secretAccessKey, SessionToken: TEMPORARY.sessionToken },
  });
}

describe('the service builds no AWS client of its own', () => {
  it('loading the module and its shared instance constructs nothing, with platform credentials present', () => {
    expect(process.env.AWS_ACCESS_KEY_ID).toBe(PLATFORM_KEYS.accessKeyId);
    expect(constructedAtModuleLoad).toEqual([]);
  });

  it.each(['development', 'test', 'production'])('constructing an instance in %s constructs nothing', (nodeEnv) => {
    process.env = { ...process.env, NODE_ENV: nodeEnv } as NodeJS.ProcessEnv;

    new AWSCostService({ query: jest.fn() } as unknown as Pool);
    new AWSCostService();

    expect(mockConstructed).toEqual([]);
  });

  it('the methods that read the platform\'s own account are gone', () => {
    const removed = ['fetchEC2Instances', 'fetchRDSInstances', 'fetchS3Buckets', 'fetchAllResources', 'syncResourcesToDatabase'];
    for (const instance of [sharedCostService, service] as unknown as Array<Record<string, unknown>>) {
      for (const method of removed) expect([method, instance[method]]).toEqual([method, undefined]);
    }
  });
});

describe('an organization id is required', () => {
  const MISSING: Array<[string, unknown]> = [
    ['undefined', undefined],
    ['null', null],
    ['an empty string', ''],
    ['whitespace', '   '],
    ['a non-string', 42],
  ];

  describe.each([
    ['the shared instance', () => sharedCostService],
    ['a fresh instance', () => service],
  ])('%s', (_name, instance) => {
    it.each(MISSING)('fetchMonthlyCosts(%s) is refused before any lookup, client or Cost Explorer call', async (_label, organizationId) => {
      await expect(instance().fetchMonthlyCosts(organizationId as string)).rejects.toThrow('ORGANIZATION_REQUIRED');

      expect(mockConstructed).toEqual([]);
      expect(poolQuery).not.toHaveBeenCalled();
      expect(ambientPool.query).not.toHaveBeenCalled();
      expect(mockCostExplorerSend).not.toHaveBeenCalled();
    });

    it.each(MISSING)('fetchCostTrend(%s) is refused before any lookup, client or Cost Explorer call', async (_label, organizationId) => {
      await expect(instance().fetchCostTrend(organizationId as string, '30d')).rejects.toThrow('ORGANIZATION_REQUIRED');

      expect(mockConstructed).toEqual([]);
      expect(poolQuery).not.toHaveBeenCalled();
      expect(ambientPool.query).not.toHaveBeenCalled();
      expect(mockCostExplorerSend).not.toHaveBeenCalled();
    });
  });

  it('an instance that was not created for an organization cannot query Cost Explorer at all', async () => {
    const internals = sharedCostService as unknown as { queryMonthlyCosts(): Promise<unknown>; queryCostTrend(range: string): Promise<unknown> };

    await expect(internals.queryMonthlyCosts()).rejects.toThrow('AWS_NOT_CONNECTED');
    await expect(internals.queryCostTrend('30d')).rejects.toThrow('AWS_NOT_CONNECTED');
    expect(mockConstructed).toEqual([]);
    expect(mockCostExplorerSend).not.toHaveBeenCalled();
  });
});

describe('an organization with no connected AWS account', () => {
  it.each(['development', 'test', 'production'])('in %s: AWS_NOT_CONNECTED, no client, and the platform credentials are not used', async (nodeEnv) => {
    process.env = { ...process.env, NODE_ENV: nodeEnv } as NodeJS.ProcessEnv;
    poolQuery.mockResolvedValue({ rows: [] });

    await expect(service.fetchMonthlyCosts('org-without-aws')).rejects.toThrow(
      'AWS_NOT_CONNECTED: org org-without-aws has not connected an AWS account'
    );
    await expect(service.fetchCostTrend('org-without-aws', '30d')).rejects.toThrow('AWS_NOT_CONNECTED');

    expect(mockConstructed).toEqual([]);
    expect(mockStsSend).not.toHaveBeenCalled();
    expect(mockCostExplorerSend).not.toHaveBeenCalled();
    // The lookup was for this organization.
    for (const call of poolQuery.mock.calls) expect(call[1]).toEqual(['org-without-aws']);
  });

  it('getMonthlySpendWithFallback falls back to the inventory estimate without ever reaching AWS', async () => {
    poolQuery.mockImplementation(async (sql: string) =>
      /aws_accounts/.test(sql) ? { rows: [] } : { rows: [{ total: '12.50' }] }
    );
    ambientPool.query.mockResolvedValue({ rows: [{ total: '12.50' }] });

    const spend = await service.getMonthlySpendWithFallback('org-without-aws');

    expect(spend.source).toBe('estimated');
    expect(mockConstructed).toEqual([]);
    expect(mockCostExplorerSend).not.toHaveBeenCalled();
  });
});

describe('a connected organization', () => {
  it('fetchMonthlyCosts: one AssumeRole, then Cost Explorer on the assumed role\'s temporary credentials', async () => {
    connected();
    mockCostExplorerSend.mockResolvedValue(monthlyResponse('42.50'));

    const costs = await service.fetchMonthlyCosts('org-connected');

    expect(costs.total).toBe(42.5);
    expect(mockConstructed.map((c) => c.client)).toEqual(['STSClient', 'CostExplorerClient']);
    const [sts, costExplorer] = mockConstructed;
    // The Cost Explorer client: the customer's temporary credentials, passed explicitly.
    expect(costExplorer.config).toEqual({ region: 'eu-west-1', credentials: TEMPORARY });
    // The STS client is the platform identity and is used only to assume the organization's role.
    expect(mockStsSend).toHaveBeenCalledTimes(1);
    expect(mockStsSend.mock.calls[0][0].input).toMatchObject({ RoleArn: ACCOUNT_ROW.role_arn, ExternalId: ACCOUNT_ROW.external_id });
    expect(JSON.stringify(sts.config ?? {})).not.toContain(TEMPORARY.accessKeyId);
    // Nothing built for the customer mentions the platform keys.
    expect(JSON.stringify(costExplorer.config)).not.toContain(PLATFORM_KEYS.accessKeyId);
    expect(JSON.stringify(costExplorer.config)).not.toContain(PLATFORM_KEYS.secretAccessKey);
    expect(mockCostExplorerSend).toHaveBeenCalledTimes(1);
  });

  it('fetchCostTrend: the same path, with the range\'s points returned', async () => {
    connected();
    mockCostExplorerSend.mockResolvedValue({
      ResultsByTime: [{ TimePeriod: { Start: '2026-10-01' }, Groups: [{ Keys: ['Amazon EC2'], Metrics: { UnblendedCost: { Amount: '3' } } }] }],
    });

    const trend = await service.fetchCostTrend('org-connected', '30d');

    expect(trend).toHaveLength(1);
    expect(trend[0]).toMatchObject({ date: '2026-10-01', total: 3 });
    expect(mockConstructed.map((c) => c.client)).toEqual(['STSClient', 'CostExplorerClient']);
    expect(mockConstructed[1].config).toEqual({ region: 'eu-west-1', credentials: TEMPORARY });
  });

  it('one organization\'s cached result is never served for another, and each fetch assumes its own role', async () => {
    poolQuery.mockImplementation(async (_sql: string, params: string[]) => ({
      rows: [{ ...ACCOUNT_ROW, role_arn: `arn:aws:iam::123456789012:role/${params[0]}` }],
    }));
    mockStsSend.mockResolvedValue({
      Credentials: { AccessKeyId: TEMPORARY.accessKeyId, SecretAccessKey: TEMPORARY.secretAccessKey, SessionToken: TEMPORARY.sessionToken },
    });
    mockCostExplorerSend.mockResolvedValueOnce(monthlyResponse('10')).mockResolvedValueOnce(monthlyResponse('20'));

    const a = await service.fetchMonthlyCosts('org-a');
    const b = await service.fetchMonthlyCosts('org-b');
    const aAgain = await service.fetchMonthlyCosts('org-a');

    expect([a.total, b.total, aAgain.total]).toEqual([10, 20, 10]);
    expect(mockStsSend.mock.calls.map((call) => call[0].input.RoleArn)).toEqual([
      'arn:aws:iam::123456789012:role/org-a',
      'arn:aws:iam::123456789012:role/org-b',
    ]);
    expect(mockCostExplorerSend).toHaveBeenCalledTimes(2);
  });
});
