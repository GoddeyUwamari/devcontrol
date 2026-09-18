/**
 * Production-accuracy fix: discoverS3Buckets()'s is_encrypted/is_public determination
 * previously coerced ANY AWS API error (AccessDenied, throttling, malformed response,
 * etc.) from GetBucketEncryptionCommand/GetBucketAclCommand into a confirmed `false`,
 * which then shipped as a `provenance: 'OBSERVED'` compliance finding -- exactly the
 * fabricated-negative-evidence failure mode Security Truthfulness #40/#41 already
 * prohibit for EC2/EBS/RDS/backups. This is the same fix applied to S3, following the
 * exact same pattern: an AWS API error must produce `null` (unknown/unavailable),
 * never a fabricated `false`, and null must never reach a compliance check as a
 * confirmed negative.
 *
 * Same synthetic-mock pattern as awsResourceDiscovery.backup-encryption.test.ts --
 * pure unit-of-work tests against discoverS3Buckets()/upsertResource() directly, no
 * database.
 */
import { S3Client } from '@aws-sdk/client-s3';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { ComplianceScannerService } from '../complianceScanner';
import { AWSResource, CreateAWSResourceInput } from '../../types/aws-resources.types';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

function awsError(name: string, message = name): any {
  const err: any = new Error(message);
  err.name = name;
  return err;
}

/**
 * Builds a dispatching S3Client.send mock for one bucket. ListBuckets/GetBucketLocation
 * always succeed; GetBucketLifecycleConfiguration always reports "no configuration"
 * (irrelevant to this fix, kept inert so discovery doesn't crash on it); encryption and
 * ACL outcomes are the two axes under test.
 */
function mockS3(opts: {
  encryption: 'configured' | 'not-configured' | { error: any };
  acl: { publicGrant: boolean } | { error: any };
}): S3Client {
  const send = jest.fn(async (command: any) => {
    const name = command.constructor.name;
    if (name === 'ListBucketsCommand') {
      return { Buckets: [{ Name: 'test-bucket', CreationDate: new Date() }] };
    }
    if (name === 'GetBucketLocationCommand') {
      return { LocationConstraint: 'us-east-1' };
    }
    if (name === 'GetBucketLifecycleConfigurationCommand') {
      throw awsError('NoSuchLifecycleConfiguration');
    }
    if (name === 'GetBucketEncryptionCommand') {
      if (opts.encryption === 'configured') return { ServerSideEncryptionConfiguration: { Rules: [] } };
      if (opts.encryption === 'not-configured') throw awsError('ServerSideEncryptionConfigurationNotFoundError');
      throw opts.encryption.error;
    }
    if (name === 'GetBucketAclCommand') {
      if ('error' in opts.acl) throw opts.acl.error;
      return {
        Grants: opts.acl.publicGrant
          ? [{ Grantee: { URI: 'http://acs.amazonaws.com/groups/global/AllUsers' }, Permission: 'READ' }]
          : [{ Grantee: { ID: 'owner-canonical-id' }, Permission: 'FULL_CONTROL' }],
      };
    }
    throw new Error(`Unexpected command in S3 mock: ${name}`);
  });
  return withMockedSend(new S3Client({ region: 'us-east-1' }), send);
}

const service = new AWSResourceDiscoveryService({} as any);

describe('discoverS3Buckets — is_encrypted', () => {
  it('(1) successful encrypted response -> is_encrypted: true', async () => {
    const s3Client = mockS3({ encryption: 'configured', acl: { publicGrant: false } });
    const resources = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');
    expect(resources[0].is_encrypted).toBe(true);
  });

  it('(2) successful, confirmed-not-configured response (ServerSideEncryptionConfigurationNotFoundError) -> is_encrypted: false', async () => {
    const s3Client = mockS3({ encryption: 'not-configured', acl: { publicGrant: false } });
    const resources = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');
    expect(resources[0].is_encrypted).toBe(false);
  });

  it('(3) GetBucketEncryption AccessDenied -> is_encrypted: null, never false', async () => {
    const s3Client = mockS3({ encryption: { error: awsError('AccessDenied') }, acl: { publicGrant: false } });
    const resources = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');
    expect(resources[0].is_encrypted).toBeNull();
  });

  it('(3b) GetBucketEncryption throttling/transient failure -> is_encrypted: null, discovery does not crash', async () => {
    const s3Client = mockS3({ encryption: { error: awsError('ThrottlingException') }, acl: { publicGrant: false } });
    const resources = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');
    expect(resources[0].is_encrypted).toBeNull();
  });
});

describe('discoverS3Buckets — is_public', () => {
  it('(6) successful response with a public ACL grant -> is_public: true (existing detection remains intact)', async () => {
    const s3Client = mockS3({ encryption: 'configured', acl: { publicGrant: true } });
    const resources = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');
    expect(resources[0].is_public).toBe(true);
  });

  it('successful response with no public grant -> is_public: false', async () => {
    const s3Client = mockS3({ encryption: 'configured', acl: { publicGrant: false } });
    const resources = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');
    expect(resources[0].is_public).toBe(false);
  });

  it('(4) GetBucketAcl AccessDenied -> is_public: null, never false', async () => {
    const s3Client = mockS3({ encryption: 'configured', acl: { error: awsError('AccessDenied') } });
    const resources = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');
    expect(resources[0].is_public).toBeNull();
  });

  it('GetBucketAcl throttling/transient failure -> is_public: null, discovery does not crash', async () => {
    const s3Client = mockS3({ encryption: 'configured', acl: { error: awsError('ThrottlingException') } });
    const resources = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');
    expect(resources[0].is_public).toBeNull();
  });
});

describe('discoverS3Buckets — a GetBucketLocation failure leaves both fields unknown', () => {
  it('the outer per-bucket try/catch never leaves isEncrypted/isPublic at their old `false` default', async () => {
    const send = jest.fn(async (command: any) => {
      const name = command.constructor.name;
      if (name === 'ListBucketsCommand') return { Buckets: [{ Name: 'location-fails', CreationDate: new Date() }] };
      if (name === 'GetBucketLocationCommand') throw awsError('AccessDenied');
      if (name === 'GetBucketLifecycleConfigurationCommand') throw awsError('NoSuchLifecycleConfiguration');
      throw new Error(`Unexpected command: ${name}`);
    });
    const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), send);

    const resources = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');

    expect(resources[0].is_encrypted).toBeNull();
    expect(resources[0].is_public).toBeNull();
  });
});

describe('(5) unknown S3 evidence does not produce an OBSERVED false-negative compliance finding', () => {
  const scanner = new ComplianceScannerService();

  function resourceFrom(discovered: CreateAWSResourceInput): AWSResource {
    return {
      id: 'id-1',
      organization_id: 'org-1',
      resource_arn: discovered.resource_arn,
      resource_id: discovered.resource_id,
      resource_name: discovered.resource_name ?? null,
      resource_type: discovered.resource_type,
      region: discovered.region,
      tags: discovered.tags ?? {},
      metadata: discovered.metadata ?? {},
      status: discovered.status ?? null,
      estimated_monthly_cost: discovered.estimated_monthly_cost ?? null,
      actual_monthly_cost: discovered.actual_monthly_cost ?? 0,
      is_encrypted: discovered.is_encrypted ?? null,
      is_public: discovered.is_public ?? false,
      has_backup: discovered.has_backup ?? null,
      compliance_issues: [],
      is_orphaned: false,
      orphaned_monthly_savings: 0,
      last_synced_at: new Date(),
      first_discovered_at: new Date(),
      created_at: new Date(),
      updated_at: new Date(),
    };
  }

  it('a bucket whose encryption/ACL checks both failed (AccessDenied) produces zero encryption/public-access findings', async () => {
    const s3Client = mockS3({ encryption: { error: awsError('AccessDenied') }, acl: { error: awsError('AccessDenied') } });
    const [discovered] = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');
    expect(discovered.is_encrypted).toBeNull();
    expect(discovered.is_public).toBeNull();

    const resource = resourceFrom(discovered);
    const encryptionIssues = (scanner as any).checkEncryption(resource);
    const publicAccessIssues = (scanner as any).checkPublicAccess(resource);

    expect(encryptionIssues).toHaveLength(0);
    expect(publicAccessIssues).toHaveLength(0);
  });

  it('control: a bucket with a verified-false encryption result (ServerSideEncryptionConfigurationNotFoundError) still produces the real finding', async () => {
    const s3Client = mockS3({ encryption: 'not-configured', acl: { publicGrant: false } });
    const [discovered] = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');
    expect(discovered.is_encrypted).toBe(false);

    const resource = resourceFrom(discovered);
    const encryptionIssues = (scanner as any).checkEncryption(resource);

    expect(encryptionIssues).toHaveLength(1);
    expect(encryptionIssues[0].provenance).toBe('OBSERVED');
  });
});

describe('(7) unrelated S3 discovery behavior does not regress', () => {
  it('region, resource identity, and estimated cost still populate correctly alongside the fixed encryption/public-access logic', async () => {
    const s3Client = mockS3({ encryption: 'configured', acl: { publicGrant: false } });
    const [resource] = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');

    expect(resource.resource_id).toBe('test-bucket');
    expect(resource.resource_arn).toBe('arn:aws:s3:::test-bucket');
    expect(resource.resource_type).toBe('s3');
    expect(resource.region).toBe('us-east-1');
    expect(resource.estimated_monthly_cost).toBe(5);
    expect(resource.has_backup).toBe(false); // unchanged -- S3 has versioning, not traditional backups
  });
});

describe('upsertResource — is_public parameter binding no longer coerces null to false', () => {
  function baseInput(overrides: Partial<CreateAWSResourceInput> = {}): CreateAWSResourceInput {
    return {
      organization_id: 'org-1',
      resource_arn: 'arn:aws:s3:::param-binding-test',
      resource_id: 'param-binding-test',
      resource_name: 'param-binding-test',
      resource_type: 's3',
      region: 'us-east-1',
      tags: {},
      metadata: {},
      status: 'active',
      is_encrypted: null,
      is_public: null,
      has_backup: false,
      ...overrides,
    };
  }

  it('a genuinely unknown is_public (null) is bound as null, not coerced to false', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ inserted: true }] });
    const mockClient = { query };

    await (service as any).upsertResource(mockClient, baseInput({ is_public: null }));

    const params = query.mock.calls[0][1];
    // Matches upsertResource's fixed column order: ..., is_encrypted, is_public, has_backup, ...
    const isPublicParam = params[12];
    expect(isPublicParam).toBeNull();
  });

  it('an undefined is_public (resource type that never set the field) still defaults to false, preserving prior behavior', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ inserted: true }] });
    const mockClient = { query };

    await (service as any).upsertResource(mockClient, baseInput({ is_public: undefined }));

    const params = query.mock.calls[0][1];
    const isPublicParam = params[12];
    expect(isPublicParam).toBe(false);
  });

  it('a confirmed-true is_public is passed through unchanged', async () => {
    const query = jest.fn().mockResolvedValue({ rows: [{ inserted: true }] });
    const mockClient = { query };

    await (service as any).upsertResource(mockClient, baseInput({ is_public: true }));

    const params = query.mock.calls[0][1];
    expect(params[12]).toBe(true);
  });
});
