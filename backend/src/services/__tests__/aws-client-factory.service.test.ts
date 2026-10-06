/**
 * AWSClientFactory fails closed.
 *
 * Invariant under test:
 *   - An organization with no connected AWS account gets AWS_NOT_CONNECTED
 *     and NO AWS client is constructed -- in every environment, whether or
 *     not the platform's own credentials are present. NODE_ENV has no say.
 *   - The platform's credentials are used for exactly one thing: as the
 *     caller identity of the STS client that assumes the organization's role.
 *   - Every client the factory returns carries the temporary credentials of
 *     that assumed role, explicitly -- never the platform's keys, never the
 *     SDK's default credential chain.
 *   - The per-region getters reuse those same credentials and make no further
 *     AssumeRole call.
 *
 * Every AWS SDK client class the factory uses is wrapped so each construction
 * is recorded with its configuration; the service clients are otherwise the
 * real classes (their resolved credentials are read back). Only STS's send()
 * and the database pool are stubbed, so no network call is ever made.
 */

// A module, not a script: its top-level names stay local to this file.
export {};

/** Every client the factory can build: [package, class]. STS is handled separately. */
const SERVICE_CLIENTS: Array<[string, string]> = [
  ['@aws-sdk/client-cost-explorer', 'CostExplorerClient'],
  ['@aws-sdk/client-ec2', 'EC2Client'],
  ['@aws-sdk/client-rds', 'RDSClient'],
  ['@aws-sdk/client-s3', 'S3Client'],
  ['@aws-sdk/client-cloudwatch', 'CloudWatchClient'],
  ['@aws-sdk/client-lambda', 'LambdaClient'],
  ['@aws-sdk/client-ecs', 'ECSClient'],
  ['@aws-sdk/client-elastic-load-balancing-v2', 'ElasticLoadBalancingV2Client'],
  ['@aws-sdk/client-eks', 'EKSClient'],
  ['@aws-sdk/client-dynamodb', 'DynamoDBClient'],
  ['@aws-sdk/client-cloudfront', 'CloudFrontClient'],
  ['@aws-sdk/client-api-gateway', 'APIGatewayClient'],
  ['@aws-sdk/client-elasticache', 'ElastiCacheClient'],
  ['@aws-sdk/client-sqs', 'SQSClient'],
  ['@aws-sdk/client-sns', 'SNSClient'],
  ['@aws-sdk/client-iam', 'IAMClient'],
  ['@aws-sdk/client-resource-explorer-2', 'ResourceExplorer2Client'],
  ['@aws-sdk/client-application-auto-scaling', 'ApplicationAutoScalingClient'],
  ['@aws-sdk/client-backup', 'BackupClient'],
  ['@aws-sdk/client-securityhub', 'SecurityHubClient'],
];

interface Construction {
  client: string;
  config: { region?: string; credentials?: unknown } | undefined;
}

const constructed: Construction[] = [];
const stsSend = jest.fn();
const poolQuery = jest.fn();

for (const [packageName, className] of SERVICE_CLIENTS) {
  jest.doMock(packageName, () => {
    const actual = jest.requireActual(packageName);
    const Real = actual[className];
    return {
      ...actual,
      [className]: class extends Real {
        constructor(config?: Construction['config']) {
          super(config);
          constructed.push({ client: className, config });
        }
      },
    };
  });
}
jest.doMock('@aws-sdk/client-sts', () => {
  const actual = jest.requireActual('@aws-sdk/client-sts');
  return {
    ...actual,
    STSClient: class {
      constructor(config?: Construction['config']) {
        constructed.push({ client: 'STSClient', config });
      }
      send = stsSend;
    },
  };
});
jest.doMock('../../config/database', () => ({ pool: { query: poolQuery } }));

// Loaded after the mocks above are registered.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { AWSClientFactory } = require('../aws-client-factory.service') as typeof import('../aws-client-factory.service');

const PLATFORM_KEYS = { accessKeyId: 'AKIAPLATFORMKEYID', secretAccessKey: 'platform-secret-not-a-credential' };
const TEMPORARY = { accessKeyId: 'ASIACUSTOMERTEMP', secretAccessKey: 'customer-temp-secret', sessionToken: 'customer-session-token' };
const ACCOUNT_ROW = { role_arn: 'arn:aws:iam::123456789012:role/devcontrol-readonly', external_id: 'external-id-1', region: 'eu-west-1' };
const ENV_BEFORE_TESTS = process.env;

function setEnvironment(nodeEnv: string | undefined, platformKeys: boolean) {
  const env: Record<string, string | undefined> = { ...ENV_BEFORE_TESTS };
  if (nodeEnv === undefined) delete env.NODE_ENV;
  else env.NODE_ENV = nodeEnv;
  if (platformKeys) {
    env.AWS_ACCESS_KEY_ID = PLATFORM_KEYS.accessKeyId;
    env.AWS_SECRET_ACCESS_KEY = PLATFORM_KEYS.secretAccessKey;
    env.AWS_REGION = 'us-east-1';
  } else {
    delete env.AWS_ACCESS_KEY_ID;
    delete env.AWS_SECRET_ACCESS_KEY;
    delete env.AWS_SESSION_TOKEN;
    delete env.AWS_REGION;
  }
  process.env = env as NodeJS.ProcessEnv;
}

function connected(row: Partial<typeof ACCOUNT_ROW> | Record<string, unknown> = ACCOUNT_ROW) {
  poolQuery.mockResolvedValue({ rows: [row] });
  stsSend.mockResolvedValue({
    Credentials: { AccessKeyId: TEMPORARY.accessKeyId, SecretAccessKey: TEMPORARY.secretAccessKey, SessionToken: TEMPORARY.sessionToken },
  });
}

/** What a real client will actually sign with. */
async function resolvedCredentials(client: unknown) {
  const { accessKeyId, secretAccessKey, sessionToken } = await (client as { config: { credentials: () => Promise<typeof TEMPORARY> } }).config.credentials();
  return { accessKeyId, secretAccessKey, sessionToken };
}

beforeEach(() => {
  constructed.length = 0;
  stsSend.mockReset();
  poolQuery.mockReset();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
  setEnvironment('test', true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(() => {
  process.env = ENV_BEFORE_TESTS;
});

describe('an organization with no connected AWS account', () => {
  const ENVIRONMENTS: Array<[string, string | undefined]> = [
    ['development', 'development'],
    ['test', 'test'],
    ['staging', 'staging'],
    ['production', 'production'],
    ['an unset NODE_ENV', undefined],
  ];

  describe.each(ENVIRONMENTS)('in %s', (_name, nodeEnv) => {
    it.each([
      ['present', true],
      ['absent', false],
    ])('with platform credentials %s: AWS_NOT_CONNECTED, and no AWS client is constructed', async (_keys, platformKeys) => {
      setEnvironment(nodeEnv, platformKeys);
      poolQuery.mockResolvedValue({ rows: [] });

      await expect(AWSClientFactory.createClients('org-without-aws')).rejects.toThrow(
        'AWS_NOT_CONNECTED: org org-without-aws has not connected an AWS account'
      );

      // Not one client -- not a service client on the platform keys, and not
      // even the STS client: there is no role to assume.
      expect(constructed).toEqual([]);
      expect(stsSend).not.toHaveBeenCalled();
      // The account was looked up for this organization and nothing else was read.
      expect(poolQuery).toHaveBeenCalledTimes(1);
      expect(poolQuery.mock.calls[0][1]).toEqual(['org-without-aws']);
    });
  });

  it('the environment-credential and mock-client fallbacks no longer exist', () => {
    const factory = AWSClientFactory as unknown as Record<string, unknown>;
    expect(factory.createClientsFromEnv).toBeUndefined();
    expect(factory.createMockClients).toBeUndefined();
  });

  it('validateCredentials reports false without constructing a client', async () => {
    poolQuery.mockResolvedValue({ rows: [] });

    await expect(AWSClientFactory.validateCredentials('org-without-aws')).resolves.toBe(false);
    expect(constructed).toEqual([]);
  });
});

describe('an account row that cannot be assumed', () => {
  it('missing external_id: AWS_NOT_CONNECTED before any client is constructed', async () => {
    connected({ ...ACCOUNT_ROW, external_id: null });

    await expect(AWSClientFactory.createClients('org-missing-external-id')).rejects.toThrow('AWS_NOT_CONNECTED');
    expect(constructed).toEqual([]);
    expect(stsSend).not.toHaveBeenCalled();
  });

  it.each([
    ['development', true],
    ['production', true],
  ])('AssumeRole refused in %s: AWS_NOT_CONNECTED, and no service client is built on the platform keys', async (nodeEnv) => {
    setEnvironment(nodeEnv, true);
    poolQuery.mockResolvedValue({ rows: [ACCOUNT_ROW] });
    stsSend.mockRejectedValue(Object.assign(new Error('User is not authorized to perform: sts:AssumeRole'), { name: 'AccessDenied' }));

    await expect(AWSClientFactory.createClients('org-role-revoked')).rejects.toThrow('AWS_NOT_CONNECTED');
    // Only the STS client that made the refused call.
    expect(constructed.map((c) => c.client)).toEqual(['STSClient']);
  });
});

describe('a connected organization', () => {
  it('assumes the organization\'s role with the platform identity, and that is the only use of the platform keys', async () => {
    connected();

    await AWSClientFactory.createClients('org-connected');

    const sts = constructed.filter((c) => c.client === 'STSClient');
    expect(sts).toHaveLength(1);
    expect(sts[0].config).toEqual({ region: 'eu-west-1', credentials: PLATFORM_KEYS });
    expect(stsSend).toHaveBeenCalledTimes(1);
    expect(stsSend.mock.calls[0][0].input).toMatchObject({
      RoleArn: ACCOUNT_ROW.role_arn,
      ExternalId: ACCOUNT_ROW.external_id,
    });

    // No other construction mentions the platform keys in any form.
    const others = constructed.filter((c) => c.client !== 'STSClient');
    expect(JSON.stringify(others.map((c) => c.config))).not.toContain(PLATFORM_KEYS.accessKeyId);
    expect(JSON.stringify(others.map((c) => c.config))).not.toContain(PLATFORM_KEYS.secretAccessKey);
  });

  it('every returned client is built with the assumed role\'s temporary credentials, explicitly', async () => {
    connected();

    const clients = await AWSClientFactory.createClients('org-connected');

    const built = constructed.filter((c) => c.client !== 'STSClient');
    // One of each service client, and nothing constructed without explicit credentials.
    expect(built.map((c) => c.client).sort()).toEqual(
      SERVICE_CLIENTS.map(([, name]) => name).filter((name) => name !== 'ApplicationAutoScalingClient').sort()
    );
    for (const { client, config } of built) {
      expect([client, config?.credentials]).toEqual([client, TEMPORARY]);
    }

    // And that is what each real client resolves and will sign with -- not
    // the platform keys in the environment, not a default provider chain.
    const named: Record<string, unknown> = {
      costExplorer: clients.costExplorer, ec2: clients.ec2, rds: clients.rds, s3: clients.s3,
      cloudWatch: clients.cloudWatch, lambda: clients.lambda, ecs: clients.ecs, elb: clients.elb,
      eks: clients.eks, dynamodb: clients.dynamodb, cloudFront: clients.cloudFront,
      apiGateway: clients.apiGateway, elastiCache: clients.elastiCache, sqs: clients.sqs,
      sns: clients.sns, iam: clients.iam, resourceExplorer: clients.resourceExplorer,
      backup: clients.backup, securityHub: clients.securityHub,
    };
    for (const [name, client] of Object.entries(named)) {
      expect([name, await resolvedCredentials(client)]).toEqual([name, TEMPORARY]);
    }

    expect(clients.enabled).toBe(true);
    expect(clients.region).toBe('eu-west-1');
    expect(clients.accountId).toBe('123456789012');
  });

  it('with no platform credentials in the environment the clients are still the assumed role\'s, never ambient', async () => {
    setEnvironment('development', false);
    connected();

    const clients = await AWSClientFactory.createClients('org-connected');

    for (const { client, config } of constructed.filter((c) => c.client !== 'STSClient')) {
      expect([client, config?.credentials]).toEqual([client, TEMPORARY]);
    }
    expect(await resolvedCredentials(clients.ec2)).toEqual(TEMPORARY);
  });

  it('defaults the region to us-east-1 when the account row has none', async () => {
    connected({ ...ACCOUNT_ROW, region: null });

    const clients = await AWSClientFactory.createClients('org-connected');

    expect(clients.region).toBe('us-east-1');
    expect(await clients.ec2.config.region()).toBe('us-east-1');
  });

  it('the per-region getters build distinct clients on the same temporary credentials, with no further AssumeRole', async () => {
    connected();
    const clients = await AWSClientFactory.createClients('org-connected');
    const before = constructed.length;

    const getters: Array<[string, (region: string) => unknown]> = [
      ['DynamoDBClient', clients.getDynamoDBClientForRegion],
      ['ApplicationAutoScalingClient', clients.getApplicationAutoScalingClientForRegion],
      ['CloudWatchClient', clients.getCloudWatchClientForRegion],
    ];
    for (const [name, get] of getters) {
      const west = get('us-west-2') as { config: { region: () => Promise<string> } };
      const south = get('ap-southeast-1') as { config: { region: () => Promise<string> } };

      expect(west).not.toBe(south);
      expect([name, await west.config.region(), await south.config.region()]).toEqual([name, 'us-west-2', 'ap-southeast-1']);
      expect([name, await resolvedCredentials(west)]).toEqual([name, TEMPORARY]);
      expect([name, await resolvedCredentials(south)]).toEqual([name, TEMPORARY]);
    }

    // Six regional clients, each with the temporary credentials passed explicitly.
    const regional = constructed.slice(before);
    expect(regional).toHaveLength(6);
    // (toMatchObject: once a client has resolved them, the SDK annotates the
    // shared object with where the credentials came from -- supplied in code.)
    for (const { client, config } of regional) expect([client, config?.credentials]).toMatchObject([client, TEMPORARY]);
    // The default clients keep the account's region, and STS was called once in total.
    expect(await clients.dynamodb.config.region()).toBe('eu-west-1');
    expect(await clients.cloudWatch.config.region()).toBe('eu-west-1');
    expect(stsSend).toHaveBeenCalledTimes(1);
  });
});
