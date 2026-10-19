/**
 * The scan's account context (scan-context.ts) and the fail-closed account
 * selection behind it (multi-region plan M2).
 *
 * Policy under test:
 *   - Two eligible accounts: every consumer that would assume a role (the
 *     client factory, the scan context, Cost Explorer, remediation) and the
 *     cron job refuse with AWS_ACCOUNT_AMBIGUOUS before any STS call.
 *   - One AssumeRole per scan: the cost detectors run on the scan's clients.
 *   - T17: a scan past the credentials' refresh window assumes the role once
 *     more and every client, regional ones included, signs with the new
 *     credentials; a failed refresh is classified as the first AssumeRole is
 *     and is not retried. Clients outside a scan never refresh.
 *
 * Mock-only: the database pool is stubbed and STS is spied; requests are
 * really signed by the SDK and stopped right after signing, so nothing is
 * sent. Every ID, ARN and account ID here is a placeholder.
 */
import { S3Client, ListBucketsCommand } from '@aws-sdk/client-s3';

const mockPoolQuery = jest.fn();
jest.mock('../../config/database', () => ({ pool: { query: mockPoolQuery } }));

import * as platformSts from '../platform-sts';
import { AWSClientFactory } from '../aws-client-factory.service';
import { ScanContext, CREDENTIAL_REFRESH_WINDOW_MS } from '../scan-context';
import { AWSCostService } from '../aws-cost.service';
import { RemediationService } from '../remediation.service';
import costOptimizationService from '../cost-optimization.service';
import { AwsAccountAmbiguousError } from '../../repositories/aws-accounts.repository';
import { ResourceDiscoveryJob } from '../../jobs/resourceDiscovery.job';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';

const ACCOUNT = {
  id: 'acct-1',
  org_id: 'org-scan',
  account_id: '123456789012',
  role_arn: 'arn:aws:iam::123456789012:role/devcontrol-readonly',
  external_id: 'external-id-1',
  region: 'eu-west-1',
  nickname: null,
  status: 'active',
  connected_at: null,
};
const SECOND_ACCOUNT = { ...ACCOUNT, id: 'acct-2', account_id: '111122223333', role_arn: 'arn:aws:iam::111122223333:role/devcontrol-readonly' };

const HOUR = 60 * 60 * 1000;

function credentials(accessKeyId: string, expiresAt: number) {
  return {
    Credentials: { AccessKeyId: accessKeyId, SecretAccessKey: `${accessKeyId}-secret`, SessionToken: `${accessKeyId}-token`, Expiration: new Date(expiresAt) },
  } as any;
}

/** The access key ID each request a client sends was signed with. Requests stop right after signing. */
function signedKeys(client: S3Client): string[] {
  const keys: string[] = [];
  client.middlewareStack.addRelativeTo(
    () => async (args: any) => {
      keys.push(/Credential=([^/]+)\//.exec(args.request.headers.authorization)![1]);
      throw Object.assign(new Error('stopped after signing'), { name: 'StoppedAfterSigning' });
    },
    { relation: 'after', toMiddleware: 'httpSigningMiddleware', name: 'testCaptureSignedKey' }
  );
  return keys;
}

async function send(client: S3Client): Promise<void> {
  await expect(client.send(new ListBucketsCommand({}))).rejects.toThrow('stopped after signing');
}

let start: number;

beforeEach(() => {
  mockPoolQuery.mockReset();
  mockPoolQuery.mockResolvedValue({ rows: [ACCOUNT] });
  start = Date.now();
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

const at = (offset: number) => jest.spyOn(Date, 'now').mockReturnValue(start + offset);

describe('two eligible accounts fail closed before any STS call', () => {
  beforeEach(() => {
    mockPoolQuery.mockResolvedValue({ rows: [ACCOUNT, SECOND_ACCOUNT] });
  });

  it('AWSClientFactory.createClients', async () => {
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform');
    await expect(AWSClientFactory.createClients('org-scan')).rejects.toBeInstanceOf(AwsAccountAmbiguousError);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it('ScanContext.forOrg', async () => {
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform');
    await expect(ScanContext.forOrg('org-scan')).rejects.toThrow(/^AWS_ACCOUNT_AMBIGUOUS: org org-scan has 2 eligible AWS accounts; multiple AWS accounts are not yet supported$/);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it('AWSCostService.createForOrg', async () => {
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform');
    await expect(AWSCostService.createForOrg('org-scan', { query: mockPoolQuery } as any)).rejects.toBeInstanceOf(AwsAccountAmbiguousError);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it('remediation credentials', async () => {
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform');
    const service = new RemediationService({ query: mockPoolQuery } as any);
    await expect((service as any).getAWSCredentials('org-scan')).rejects.toBeInstanceOf(AwsAccountAmbiguousError);
    expect(assumeRole).not.toHaveBeenCalled();
  });

  it('the cron job counts the organization as failed and never starts discovery', async () => {
    const discover = jest.spyOn(AWSResourceDiscoveryService.prototype, 'discoverAllResources');
    const client = {
      query: jest.fn(async (sql: string) => (/FROM aws_accounts/.test(sql) ? { rows: [ACCOUNT, SECOND_ACCOUNT] } : { rows: [] })),
      release: jest.fn(),
    };
    const job = new ResourceDiscoveryJob({ connect: jest.fn().mockResolvedValue(client) } as any);

    const summary = await job.scanOrganizations([{ id: 'org-scan', name: 'Org' }]);

    expect(summary).toMatchObject({ scanned: 0, failed: 1, skipped: 0, inactive: 0 });
    expect(discover).not.toHaveBeenCalled();
  });
});

describe('one AssumeRole per scan', () => {
  it('forOrg assumes the role of the one eligible account once', async () => {
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockResolvedValue(credentials('ASIAFIRST', start + HOUR));

    const context = await ScanContext.forOrg('org-scan');

    expect(assumeRole).toHaveBeenCalledTimes(1);
    expect(assumeRole.mock.calls[0][1]).toMatchObject({ RoleArn: ACCOUNT.role_arn, ExternalId: ACCOUNT.external_id });
    expect(context.region).toBe('eu-west-1');
    expect(context.accountId).toBe('123456789012');
    expect(context.clientsFor('eu-west-1').region).toBe('eu-west-1');
  });

  it('refuses any region but the home region', async () => {
    jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockResolvedValue(credentials('ASIAFIRST', start + HOUR));
    const context = await ScanContext.forOrg('org-scan');

    expect(() => context.clientsFor('us-west-2')).toThrow(/^SCAN_REGION_UNSUPPORTED: /);
  });

  it("the cost detectors run on the scan's clients, with no second lookup or AssumeRole", async () => {
    const createClients = jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({ enabled: false, region: 'eu-west-1' } as any);
    const context = await ScanContext.forOrg('org-scan');
    createClients.mockClear();

    await expect(costOptimizationService.analyzeAllResources('org-scan', context)).resolves.toEqual({
      observations: [], riRecommendations: [], riSucceeded: false,
    });
    expect(createClients).not.toHaveBeenCalled();
    await expect(costOptimizationService.analyzeAllResources('org-other', context)).rejects.toThrow(/^SCAN_CONTEXT_MISMATCH: /);
  });
});

describe('T17: credentials are refreshed before they expire', () => {
  it('before the refresh window: no second AssumeRole, signed with the first credentials', async () => {
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockResolvedValue(credentials('ASIAFIRST', start + HOUR));
    const s3 = (await ScanContext.forOrg('org-scan')).clientsFor('eu-west-1').s3;
    const keys = signedKeys(s3);

    at(HOUR - CREDENTIAL_REFRESH_WINDOW_MS - 60_000);
    await send(s3);

    expect(keys).toEqual(['ASIAFIRST']);
    expect(assumeRole).toHaveBeenCalledTimes(1);
  });

  it('inside the window: the role is assumed once more and every client, regional ones included, signs with the new credentials', async () => {
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform')
      .mockResolvedValueOnce(credentials('ASIAFIRST', start + HOUR))
      .mockResolvedValueOnce(credentials('ASIASECOND', start + 2 * HOUR));
    const clients = (await ScanContext.forOrg('org-scan')).clientsFor('eu-west-1');
    const home = signedKeys(clients.s3);
    const regionalClient = clients.getS3ClientForRegion!('us-west-2');
    const regional = signedKeys(regionalClient);

    await send(clients.s3);
    at(HOUR - CREDENTIAL_REFRESH_WINDOW_MS + 60_000);
    await Promise.all([send(clients.s3), send(clients.s3), send(regionalClient)]);
    await send(clients.s3);

    expect(assumeRole).toHaveBeenCalledTimes(2);
    expect(assumeRole.mock.calls[1]).toEqual(assumeRole.mock.calls[0]);
    expect(home).toEqual(['ASIAFIRST', 'ASIASECOND', 'ASIASECOND', 'ASIASECOND']);
    expect(regional).toEqual(['ASIASECOND']);
  });

  it.each([
    [
      "the organization's role refuses",
      () => Object.assign(new Error('User is not authorized to perform: sts:AssumeRole'), { name: 'AccessDenied' }),
      'AWS_NOT_CONNECTED: org org-scan has not connected an AWS account',
    ],
    [
      "the platform's identity is unavailable",
      () => new platformSts.PlatformAwsCredentialsUnavailableError(new Error('Could not load credentials from any providers')),
      /^PLATFORM_AWS_CREDENTIALS_UNAVAILABLE: /,
    ],
  ])('a failed refresh (%s) is classified as the first AssumeRole is, and not retried', async (_label, failure, expected) => {
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform')
      .mockResolvedValueOnce(credentials('ASIAFIRST', start + HOUR))
      .mockRejectedValueOnce(failure());
    const s3 = (await ScanContext.forOrg('org-scan')).clientsFor('eu-west-1').s3;
    const keys = signedKeys(s3);

    at(HOUR - 60_000);
    await expect(s3.send(new ListBucketsCommand({}))).rejects.toThrow(expected);
    await expect(s3.send(new ListBucketsCommand({}))).rejects.toThrow(expected);

    expect(assumeRole).toHaveBeenCalledTimes(2);
    expect(keys).toEqual([]);
  });

  it('clients from createClients() outside a scan never refresh', async () => {
    const assumeRole = jest.spyOn(platformSts, 'assumeRoleAsPlatform').mockResolvedValue(credentials('ASIAFIRST', start + HOUR));
    const { s3 } = await AWSClientFactory.createClients('org-scan');
    const keys = signedKeys(s3);

    at(HOUR - 60_000);
    await send(s3);

    expect(assumeRole).toHaveBeenCalledTimes(1);
    expect(keys).toEqual(['ASIAFIRST']);
  });
});
