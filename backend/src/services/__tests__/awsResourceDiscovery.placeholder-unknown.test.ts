/**
 * Resource truth (2B): discovery stores what AWS reported, and unknown for what it
 * did not. No default stands in for a value nothing read.
 *
 *   - the three flags (is_encrypted, is_public, has_backup): NULL when not read
 *   - status: 'not_applicable' for a type with no lifecycle status
 *   - tags: recorded as observed or unavailable for every type whose tags need a read
 *   - EC2: its security groups, read in the instance's own region
 *
 * Unit-of-work tests against the discovery methods directly, with mocked AWS
 * clients and no database (the pattern of awsResourceDiscovery.s3-error-handling.test.ts).
 */
import fs from 'fs';
import path from 'path';
import { EC2Client } from '@aws-sdk/client-ec2';
import { S3Client } from '@aws-sdk/client-s3';
import { RDSClient } from '@aws-sdk/client-rds';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { ElasticLoadBalancingV2Client } from '@aws-sdk/client-elastic-load-balancing-v2';
import { CloudFrontClient } from '@aws-sdk/client-cloudfront';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { ResourceExplorerService, GENERIC_RESOURCE_TYPES } from '../resourceExplorer.service';
import { CreateAWSResourceInput } from '../../types/aws-resources.types';

const ORG = '00000000-0000-0000-0000-000000000001';
const awsError = (name: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(name), { name }, extra);

function client<T extends { send: unknown }>(real: T, handlers: Record<string, (input: any) => unknown>): T & { send: jest.Mock } {
  (real as any).send = jest.fn(async (command: any) => {
    const handler = handlers[command.constructor.name];
    if (!handler) throw new Error(`Unexpected command: ${command.constructor.name}`);
    return handler(command.input);
  });
  return real as T & { send: jest.Mock };
}
const commandsSent = (c: { send: jest.Mock }) => c.send.mock.calls.map(([command]) => command.constructor.name);

const service = () => new AWSResourceDiscoveryService({} as any) as any;
const noBackupEvidence = async () => null;

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

/** upsertResource's parameters, by column. */
async function storedBy(resource: Partial<CreateAWSResourceInput>) {
  const query = jest.fn().mockResolvedValue({ rows: [{ inserted: true }] });
  await service().upsertResource({ query }, {
    organization_id: ORG, resource_arn: 'arn:aws:x', resource_id: 'x', resource_type: 'lambda', region: 'us-east-1', ...resource,
  });
  const params = query.mock.calls[0][1];
  return { status: params[8], is_encrypted: params[11], is_public: params[12], has_backup: params[13] };
}

describe('upsertResource: a flag discovery did not set is stored as NULL, not false', () => {
  it('undefined is NULL', async () => {
    expect(await storedBy({})).toMatchObject({ is_encrypted: null, is_public: null, has_backup: null });
  });

  it('null is NULL', async () => {
    expect(await storedBy({ is_encrypted: null, is_public: null, has_backup: null })).toMatchObject({ is_encrypted: null, is_public: null, has_backup: null });
  });

  it('an observed false stays false, and an observed true stays true', async () => {
    expect(await storedBy({ is_encrypted: false, is_public: false, has_backup: false })).toMatchObject({ is_encrypted: false, is_public: false, has_backup: false });
    expect(await storedBy({ is_encrypted: true, is_public: true, has_backup: true })).toMatchObject({ is_encrypted: true, is_public: true, has_backup: true });
  });
});

describe('generic (Resource Explorer) resources', () => {
  async function upsertGeneric(resourceType: string, tagsState = 'observed') {
    const query = jest.fn().mockResolvedValue({ rows: [{ inserted: false }] });
    await service().upsertGenericResource({ query }, ORG, {
      arn: `arn:aws:${resourceType}:us-east-1:111122223333:thing/one`, resourceType, region: 'us-east-1', service: resourceType, tags: {}, tagsState,
    });
    const [sql, params] = query.mock.calls[0];
    return { sql: String(sql).replace(/\s+/g, ' '), params, metadata: JSON.parse(params[7]), status: params[9] };
  }

  it('inserts the three flags as NULL', async () => {
    const { sql } = await upsertGeneric('vpc');
    expect(sql).toContain("VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $10, $9, 0, NULL, NULL, NULL, '[]', 0, NOW())");
    expect(sql).not.toMatch(/false, false, false/);
  });

  it('rewrites them as NULL on every later discovery, clearing the false an earlier release stored', async () => {
    const { sql } = await upsertGeneric('sns');
    const onConflict = sql.slice(sql.indexOf('ON CONFLICT'));
    expect(onConflict).toContain('is_encrypted = NULL');
    expect(onConflict).toContain('is_public = NULL');
    expect(onConflict).toContain('has_backup = NULL');
  });

  it.each(GENERIC_RESOURCE_TYPES.map((t) => [t]))('applies to %s: all nine generic types go through the same statement', async (type) => {
    const { sql } = await upsertGeneric(type);
    expect(sql).toContain('NULL, NULL, NULL');
    expect(sql).toContain('is_encrypted = NULL');
  });

  it('there are nine generic types', () => {
    expect([...GENERIC_RESOURCE_TYPES].sort()).toEqual(['api-gateway', 'aurora', 'dynamodb', 'ecs', 'eks', 'elasticache', 'sns', 'sqs', 'vpc']);
  });

  it.each([['vpc'], ['sns']])('%s is stored as not_applicable, and an existing row is rewritten to it', async (type) => {
    const { sql, status } = await upsertGeneric(type);
    expect(status).toBe('not_applicable');
    expect(sql).toContain("WHEN EXCLUDED.status = 'not_applicable' THEN EXCLUDED.status");
  });

  it.each([['dynamodb'], ['ecs'], ['sqs'], ['aurora']])('%s has a lifecycle status that was not read: unknown, and a known one is kept', async (type) => {
    const { sql, status } = await upsertGeneric(type);
    expect(status).toBe('unknown');
    expect(sql).toContain("WHEN aws_resources.status = 'terminated' THEN 'unknown' ELSE aws_resources.status END");
  });

  it('records whether the tags were reported', async () => {
    expect((await upsertGeneric('vpc', 'observed')).metadata.tags_state).toBe('observed');
    expect((await upsertGeneric('vpc', 'unavailable')).metadata.tags_state).toBe('unavailable');
  });

  describe('Resource Explorer tags', () => {
    const normalize = (Properties: unknown) =>
      new ResourceExplorerService().normalize(
        [{ Arn: 'arn:aws:ec2:us-east-1:111122223333:vpc/vpc-1234567890abcdef0', CfnResourceType: 'AWS::EC2::VPC', Region: 'us-east-1', Properties } as any],
        'us-east-1'
      ).genericEntries[0];

    it('a tags property with tags is observed', () => {
      expect(normalize([{ Name: 'tags', Data: [{ Key: 'Owner', Value: 'net' }] }])).toMatchObject({ tags: { Owner: 'net' }, tagsState: 'observed' });
    });

    it('an empty tags property is a resource with no tags: observed', () => {
      expect(normalize([{ Name: 'tags', Data: [] }])).toMatchObject({ tags: {}, tagsState: 'observed' });
    });

    it.each([['no properties', undefined], ['an empty property list', []], ['a tags property that is not a list', [{ Name: 'tags', Data: 'x' }]]])(
      '%s: the tags were not reported, so they are unknown',
      (_name, properties) => {
        expect(normalize(properties)).toMatchObject({ tags: {}, tagsState: 'unavailable' });
      }
    );
  });

  // GUARD (see upsertGenericResource's doc comment): the upsert rewrites the three
  // flags as NULL on every discovery. That is only safe while no enrichment step
  // writes them. If this fails, an enrichment step has started to: the upsert must
  // stop clearing what that step writes, in the same change.
  describe('no enrichment step writes the flags the upsert clears', () => {
    const source = fs.readFileSync(path.join(__dirname, '..', 'awsResourceDiscovery.ts'), 'utf8');
    const FLAGS = /\b(is_encrypted|is_public|has_backup)\b/;

    /** The source of one private method: from its declaration to the next method's doc comment. */
    function methodSource(name: string): string {
      const start = source.indexOf(`private async ${name}(`);
      expect(start).toBeGreaterThan(-1);
      const end = source.indexOf('\n  /**', start);
      return source.slice(start, end === -1 ? undefined : end);
    }

    it('finds every enrichment step by name', () => {
      const enrichers = [...source.matchAll(/private async (enrich\w+)\(/g)].map((m) => m[1]).sort();
      expect(enrichers).toEqual(['enrichAuroraClusters', 'enrichDynamoDBTables']);
    });

    it.each([['enrichDynamoDBTables'], ['enrichAuroraClusters']])('%s does not mention is_encrypted, is_public or has_backup', (name) => {
      const body = methodSource(name);
      expect(body.length).toBeGreaterThan(200);
      expect(body).not.toMatch(FLAGS);
    });

    it('the only SQL statements in discovery that write the flags are the two upserts', () => {
      // Every SQL string that inserts into or updates aws_resources and names a flag.
      const statements = [...source.matchAll(/`[^`]*`/g)]
        .map((m) => ({ text: m[0], at: m.index as number }))
        .filter(({ text }) => /(INSERT INTO|UPDATE) aws_resources/.test(text) && FLAGS.test(text));
      const methodAt = (offset: number) =>
        [...source.slice(0, offset).matchAll(/private async (\w+)\(/g)].map((m) => m[1]).pop();
      expect(statements.map(({ at }) => methodAt(at)).sort()).toEqual(['upsertGenericResource', 'upsertResource']);
    });
  });
});

describe('EBS volumes', () => {
  const volumes = (Encrypted: unknown) =>
    client(new EC2Client({ region: 'us-east-1' }), {
      DescribeVolumesCommand: () => ({ Volumes: [{ VolumeId: 'vol-1234567890abcdef0', VolumeType: 'gp3', Size: 8, State: 'available', Encrypted, AvailabilityZone: 'us-east-1a' }] }),
    });
  const discover = async (Encrypted: unknown) =>
    (await service().discoverEBSVolumes(ORG, volumes(Encrypted), 'us-east-1', '111122223333', noBackupEvidence))[0];

  it('Encrypted: false is an unencrypted volume', async () => {
    expect((await discover(false)).is_encrypted).toBe(false);
  });

  it('Encrypted: true is an encrypted volume', async () => {
    expect((await discover(true)).is_encrypted).toBe(true);
  });

  it('a volume AWS reports no encryption state for is unknown, not unencrypted', async () => {
    expect((await discover(undefined)).is_encrypted).toBeNull();
  });

  it('keeps the lifecycle state AWS reported: a volume has one', async () => {
    expect((await discover(true)).status).toBe('available');
  });
});

describe('EC2 instances', () => {
  const instance = (overrides: Record<string, unknown> = {}) => ({
    InstanceId: 'i-1234567890abcdef0', InstanceType: 't3.micro', State: { Name: 'running' }, PublicIpAddress: '203.0.113.10',
    Placement: { AvailabilityZone: 'us-east-1a' }, SecurityGroups: [{ GroupId: 'sg-1234567890abcdef0' }],
    BlockDeviceMappings: [{ Ebs: { VolumeId: 'vol-1234567890abcdef0' } }], ...overrides,
  });
  function ec2(opts: { instances?: unknown[]; volumes?: () => unknown; groups?: () => unknown } = {}) {
    return client(new EC2Client({ region: 'us-east-1' }), {
      DescribeInstancesCommand: () => ({ Reservations: [{ Instances: opts.instances ?? [instance()] }] }),
      DescribeVolumesCommand: opts.volumes ?? (() => ({ Volumes: [{ VolumeId: 'vol-1234567890abcdef0', Encrypted: true }] })),
      DescribeSecurityGroupsCommand: opts.groups ?? (() => ({ SecurityGroups: [{ GroupId: 'sg-1234567890abcdef0', IpPermissions: [] }] })),
    });
  }
  const discover = async (c: EC2Client, listedIn = 'us-east-1') =>
    service().discoverEC2Instances(ORG, c, listedIn, '111122223333', noBackupEvidence);
  const openSsh = { GroupId: 'sg-1234567890abcdef0', IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, IpRanges: [{ CidrIp: '0.0.0.0/0' }] }] };

  describe('volume encryption', () => {
    it('every volume confirmed encrypted: true', async () => {
      expect((await discover(ec2()))[0].is_encrypted).toBe(true);
    });

    it('a volume confirmed unencrypted: false', async () => {
      expect((await discover(ec2({ volumes: () => ({ Volumes: [{ VolumeId: 'vol-1234567890abcdef0', Encrypted: false }] }) })))[0].is_encrypted).toBe(false);
    });

    it('the volume lookup failed: unknown, not "encrypted"', async () => {
      expect((await discover(ec2({ volumes: () => { throw awsError('UnauthorizedOperation'); } })))[0].is_encrypted).toBeNull();
    });

    it('a volume AWS returned no encryption state for: unknown', async () => {
      expect((await discover(ec2({ volumes: () => ({ Volumes: [{ VolumeId: 'vol-1234567890abcdef0' }] }) })))[0].is_encrypted).toBeNull();
    });

    it('an instance with no EBS volume: unknown, not "encrypted"', async () => {
      expect((await discover(ec2({ instances: [instance({ BlockDeviceMappings: [] })] })))[0].is_encrypted).toBeNull();
    });
  });

  describe('security groups', () => {
    it('records the attached groups and an open administrative port', async () => {
      const [resource] = await discover(ec2({ groups: () => ({ SecurityGroups: [openSsh] }) }));
      expect(resource.metadata.security_group_ids).toEqual(['sg-1234567890abcdef0']);
      expect(resource.metadata.network_exposure).toEqual({
        state: 'open_admin_port',
        rules: [{ security_group_id: 'sg-1234567890abcdef0', protocol: 'tcp', from_port: 22, to_port: 22, cidr: '0.0.0.0/0', admin_ports: [22] }],
      });
    });

    it('records not_established when the groups were read and show no such rule', async () => {
      expect((await discover(ec2()))[0].metadata.network_exposure).toEqual({ state: 'not_established' });
    });

    it.each([
      ['UnauthorizedOperation (the role lacks ec2:DescribeSecurityGroups)', awsError('UnauthorizedOperation', { $metadata: { httpStatusCode: 403 } })],
      ['a throttling error', awsError('RequestLimitExceeded')],
      ['a network failure', new Error('socket hang up')],
    ])('%s: the exposure is unknown, and discovery still returns the instance', async (_name, error) => {
      const resources = await discover(ec2({ groups: () => { throw error; } }));
      expect(resources).toHaveLength(1);
      expect(resources[0].metadata.network_exposure).toEqual({ state: 'unknown', reason: 'security_groups_unreadable' });
      expect(resources[0].is_public).toBe(true);
    });

    it('a failure on a later page discards the pages already read: a partial read establishes nothing', async () => {
      let page = 0;
      const c = ec2({ groups: () => { if (page++ === 0) return { SecurityGroups: [openSsh], NextToken: 'next' }; throw awsError('RequestLimitExceeded'); } });
      expect((await discover(c))[0].metadata.network_exposure).toEqual({ state: 'unknown', reason: 'security_groups_unreadable' });
    });

    it('follows every page', async () => {
      let page = 0;
      const c = ec2({ groups: () => (page++ === 0 ? { SecurityGroups: [{ GroupId: 'sg-other', IpPermissions: [] }], NextToken: 'next' } : { SecurityGroups: [openSsh] }) });
      expect((await discover(c))[0].metadata.network_exposure.state).toBe('open_admin_port');
    });

    it('reads the groups once, however many instances there are', async () => {
      const c = ec2({ instances: [instance(), instance({ InstanceId: 'i-0123456789abcdef0' })] });
      await discover(c);
      expect(commandsSent(c).filter((name) => name === 'DescribeSecurityGroupsCommand')).toHaveLength(1);
    });

    it('makes no read at all when no instance has a security group', async () => {
      const c = ec2({ instances: [instance({ SecurityGroups: [] })] });
      const [resource] = await discover(c);
      expect(commandsSent(c)).not.toContain('DescribeSecurityGroupsCommand');
      expect(resource.metadata.network_exposure).toEqual({ state: 'not_established' });
    });

    // An instance is in the region it was listed in. Its availability zone is not a
    // reliable way to name that region: a Local Zone or Wavelength Zone name is not
    // "region + one letter".
    it.each([
      ['a Local Zone', 'us-west-2-lax-1a'],
      ['a Wavelength Zone', 'us-west-2-wl1-sea-wlz-1'],
      ['an ordinary zone', 'us-west-2b'],
      ['no reported zone', undefined],
    ])('an instance in %s (%s) has its groups read in the region it was listed in, with the client that listed it', async (_name, zone) => {
      const c = ec2({
        instances: [instance({ Placement: zone ? { AvailabilityZone: zone } : undefined })],
        groups: () => ({ SecurityGroups: [openSsh] }),
      });
      const [resource] = await discover(c, 'us-west-2');

      // One read, by the listing client: nothing was derived from the zone name.
      expect(commandsSent(c).filter((name) => name === 'DescribeSecurityGroupsCommand')).toHaveLength(1);
      expect(resource.metadata.network_exposure.state).toBe('open_admin_port');
      expect(resource.region).toBe('us-west-2');
      expect(resource.resource_arn).toBe('arn:aws:ec2:us-west-2:*:instance/i-1234567890abcdef0');
    });

    it('a prefix-list source on an admin port is recorded as unknown, not as not_established', async () => {
      const viaList = { GroupId: 'sg-1234567890abcdef0', IpPermissions: [{ IpProtocol: 'tcp', FromPort: 22, ToPort: 22, PrefixListIds: [{ PrefixListId: 'pl-0123456789abcdef0' }] }] };
      const [resource] = await discover(ec2({ groups: () => ({ SecurityGroups: [viaList] }) }));
      expect(resource.metadata.network_exposure).toEqual({ state: 'unknown', reason: 'prefix_list_source' });
    });
  });
});

describe('RDS instances', () => {
  const rds = (overrides: Record<string, unknown>) =>
    client(new RDSClient({ region: 'us-east-1' }), {
      DescribeDBInstancesCommand: () => ({ DBInstances: [{ DBInstanceIdentifier: 'app-db', DBInstanceStatus: 'available', ...overrides }] }),
    });

  it('stores what DescribeDBInstances reports', async () => {
    const [db] = await service().discoverRDSDatabases(ORG, rds({ StorageEncrypted: false, PubliclyAccessible: true, BackupRetentionPeriod: 0 }), 'us-east-1');
    expect(db).toMatchObject({ is_encrypted: false, is_public: true, has_backup: false });
  });

  it('a field it leaves out is unknown, not false', async () => {
    const [db] = await service().discoverRDSDatabases(ORG, rds({}), 'us-east-1');
    expect(db).toMatchObject({ is_encrypted: null, is_public: null, has_backup: null });
  });
});

describe('S3 buckets', () => {
  function s3(region: string, opts: { location?: () => unknown; tagging: () => unknown }) {
    return client(new S3Client({ region }), {
      ListBucketsCommand: () => ({ Buckets: [{ Name: 'app-prod-backups', CreationDate: new Date('2026-01-01T00:00:00Z') }] }),
      GetBucketLocationCommand: opts.location ?? (() => ({})),
      GetBucketEncryptionCommand: () => ({ ServerSideEncryptionConfiguration: { Rules: [] } }),
      GetBucketAclCommand: () => ({ Grants: [] }),
      GetBucketLifecycleConfigurationCommand: () => { throw awsError('NoSuchLifecycleConfiguration'); },
      GetBucketTaggingCommand: opts.tagging,
    });
  }
  const discover = async (c: S3Client, forRegion?: (region: string) => S3Client) =>
    (await service().discoverS3Buckets(ORG, c, 'us-east-1', forRegion))[0];

  it('has no lifecycle status: stored as not_applicable, never active', async () => {
    expect((await discover(s3('us-east-1', { tagging: () => ({ TagSet: [] }) }))).status).toBe('not_applicable');
  });

  it('records no versioning, logging or backup value it did not read', async () => {
    const bucket = await discover(s3('us-east-1', { tagging: () => ({ TagSet: [] }) }));
    expect(bucket.metadata).not.toHaveProperty('versioning_enabled');
    expect(bucket.metadata).not.toHaveProperty('logging_enabled');
    expect(bucket.has_backup).toBeNull();
  });

  it('stores the tags GetBucketTagging returns', async () => {
    const bucket = await discover(s3('us-east-1', { tagging: () => ({ TagSet: [{ Key: 'Owner', Value: 'platform' }] }) }));
    expect(bucket.tags).toEqual({ Owner: 'platform' });
    expect(bucket.metadata.tags_state).toBe('observed');
  });

  it('NoSuchTagSet: observed, with no tags', async () => {
    const bucket = await discover(s3('us-east-1', { tagging: () => { throw awsError('NoSuchTagSet'); } }));
    expect(bucket.tags).toEqual({});
    expect(bucket.metadata.tags_state).toBe('observed');
  });

  it.each([['AccessDenied'], ['SlowDown'], ['InternalError']])('%s: the tags are unavailable, and the bucket is still discovered', async (name) => {
    const bucket = await discover(s3('us-east-1', { tagging: () => { throw awsError(name); } }));
    expect(bucket.tags).toEqual({});
    expect(bucket.metadata.tags_state).toBe('unavailable');
    expect(bucket.is_encrypted).toBe(true);
  });

  describe('a bucket outside the home region', () => {
    const elsewhere = (tagging: () => unknown) => client(new S3Client({ region: 'eu-west-1' }), { GetBucketTaggingCommand: tagging });

    it('has its tags read by a client for the region GetBucketLocation reports', async () => {
      const home = s3('us-east-1', { location: () => ({ LocationConstraint: 'eu-west-1' }), tagging: () => { throw new Error('the home-region client must not be asked'); } });
      const regional = elsewhere(() => ({ TagSet: [{ Key: 'Owner', Value: 'web' }] }));
      const regionsAsked: string[] = [];
      const bucket = await discover(home, (region) => { regionsAsked.push(region); return regional; });

      expect(regionsAsked).toEqual(['eu-west-1']);
      expect(commandsSent(home)).not.toContain('GetBucketTaggingCommand');
      expect(bucket.tags).toEqual({ Owner: 'web' });
      expect(bucket.metadata.tags_state).toBe('observed');
    });

    it('the legacy "EU" location is read in eu-west-1', async () => {
      const home = s3('us-east-1', { location: () => ({ LocationConstraint: 'EU' }), tagging: () => { throw new Error('not here'); } });
      const regionsAsked: string[] = [];
      await discover(home, (region) => { regionsAsked.push(region); return elsewhere(() => ({ TagSet: [] })); });
      expect(regionsAsked).toEqual(['eu-west-1']);
    });

    it('when its region could not be determined, the wrong-region answer is followed instead of being recorded as unknown', async () => {
      const home = s3('us-east-1', {
        location: () => { throw awsError('AccessDenied'); },
        tagging: () => { throw awsError('PermanentRedirect', { $metadata: { httpStatusCode: 301 }, $response: { headers: { 'x-amz-bucket-region': 'eu-west-1' } } }); },
      });
      // GetBucketLocation failing aborts the encryption and ACL reads (existing behaviour); the tags are still read.
      const bucket = await discover(home, () => elsewhere(() => { throw awsError('NoSuchTagSet'); }));
      expect(bucket.metadata.tags_state).toBe('observed');
      expect(bucket.tags).toEqual({});
    });

    it('AccessDenied in its own region is unknown', async () => {
      const home = s3('us-east-1', { location: () => ({ LocationConstraint: 'eu-west-1' }), tagging: () => { throw new Error('not here'); } });
      const bucket = await discover(home, () => elsewhere(() => { throw awsError('AccessDenied'); }));
      expect(bucket.metadata.tags_state).toBe('unavailable');
    });
  });
});

describe('tags of Lambda functions, load balancers and CloudFront distributions', () => {
  const noUsage = { send: jest.fn(async () => { throw awsError('AccessDenied'); }) } as any;

  it('Lambda: ListTags answered -> observed', async () => {
    const lambda = client(new LambdaClient({ region: 'us-east-1' }), {
      ListFunctionsCommand: () => ({ Functions: [{ FunctionArn: 'arn:aws:lambda:us-east-1:111122223333:function:app-fn', FunctionName: 'app-fn' }] }),
      ListTagsCommand: () => ({ Tags: {} }),
    });
    const [fn] = await service().discoverLambdaFunctions(ORG, lambda, noUsage, 'us-east-1');
    expect(fn.metadata.tags_state).toBe('observed');
  });

  it('Lambda: no State from ListFunctions is an unknown status, never "Active"; a reported State is kept', async () => {
    const fn = (extra: Record<string, unknown>) => ({ FunctionArn: 'arn:aws:lambda:us-east-1:111122223333:function:app-fn', FunctionName: 'app-fn', ...extra });
    const discover = async (extra: Record<string, unknown>) =>
      (await service().discoverLambdaFunctions(ORG, client(new LambdaClient({ region: 'us-east-1' }), {
        ListFunctionsCommand: () => ({ Functions: [fn(extra)] }),
        ListTagsCommand: () => ({ Tags: {} }),
      }), noUsage, 'us-east-1'))[0];

    expect((await discover({})).status).toBe('unknown');
    expect((await discover({ State: 'Active' })).status).toBe('Active');
    expect((await discover({ State: 'Failed' })).status).toBe('Failed');
  });

  it('Lambda: is_encrypted is unknown, not a hardcoded true, with or without a KMS key or environment variables', async () => {
    const lambda = client(new LambdaClient({ region: 'us-east-1' }), {
      ListFunctionsCommand: () => ({ Functions: [
        { FunctionArn: 'arn:aws:lambda:us-east-1:111122223333:function:plain', FunctionName: 'plain' },
        { FunctionArn: 'arn:aws:lambda:us-east-1:111122223333:function:keyed', FunctionName: 'keyed', KMSKeyArn: 'arn:aws:kms:us-east-1:111122223333:key/k', Environment: { Variables: { A: 'b' } } },
      ] }),
      ListTagsCommand: () => ({ Tags: {} }),
    });
    const functions = await service().discoverLambdaFunctions(ORG, lambda, noUsage, 'us-east-1');
    expect(functions.map((f: any) => f.is_encrypted)).toEqual([null, null]);
  });

  it('Lambda: ListTags denied -> unavailable', async () => {
    const lambda = client(new LambdaClient({ region: 'us-east-1' }), {
      ListFunctionsCommand: () => ({ Functions: [{ FunctionArn: 'arn:aws:lambda:us-east-1:111122223333:function:app-fn', FunctionName: 'app-fn' }] }),
      ListTagsCommand: () => { throw awsError('AccessDeniedException'); },
    });
    const [fn] = await service().discoverLambdaFunctions(ORG, lambda, noUsage, 'us-east-1');
    expect(fn.tags).toEqual({});
    expect(fn.metadata.tags_state).toBe('unavailable');
  });

  const balancer = { LoadBalancerArn: 'arn:aws:elasticloadbalancing:us-east-1:111122223333:loadbalancer/app/app-lb/0abc', LoadBalancerName: 'app-lb', Scheme: 'internal', State: { Code: 'active' } };

  it('load balancer: DescribeTags answered -> observed', async () => {
    const elb = client(new ElasticLoadBalancingV2Client({ region: 'us-east-1' }), {
      DescribeLoadBalancersCommand: () => ({ LoadBalancers: [balancer] }),
      DescribeTagsCommand: () => ({ TagDescriptions: [{ Tags: [] }] }),
    });
    const [lb] = await service().discoverLoadBalancers(ORG, elb, 'us-east-1');
    expect(lb.metadata.tags_state).toBe('observed');
  });

  it('load balancer: DescribeTags denied -> unavailable', async () => {
    const elb = client(new ElasticLoadBalancingV2Client({ region: 'us-east-1' }), {
      DescribeLoadBalancersCommand: () => ({ LoadBalancers: [balancer] }),
      DescribeTagsCommand: () => { throw awsError('AccessDenied'); },
    });
    const [lb] = await service().discoverLoadBalancers(ORG, elb, 'us-east-1');
    expect(lb.tags).toEqual({});
    expect(lb.metadata.tags_state).toBe('unavailable');
  });

  describe('CloudFront', () => {
    const distributions = async (items: Array<Record<string, unknown>>) =>
      service().discoverCloudFrontDistributions(ORG, client(new CloudFrontClient({ region: 'us-east-1' }), {
        ListDistributionsCommand: () => ({ DistributionList: { Items: items.map((item, i) => ({ ARN: `arn:aws:cloudfront::111122223333:distribution/E${i}ABC`, Id: `E${i}ABC`, ...item })) } }),
      }));

    it.each([
      ['Deployed', 'active'],
      ['InProgress', 'in-progress'],
      ['SomethingNew', 'unknown'],
      [undefined, 'unknown'],
    ])('Status %p is stored as %s -- never "inactive" by default', async (awsStatus, stored) => {
      const [distribution] = await distributions([{ Status: awsStatus }]);
      expect(distribution.status).toBe(stored);
      expect(distribution.status).not.toBe('inactive');
    });

    it('is_public is not set (a distribution is public by design), so it is stored as NULL', async () => {
      const [distribution] = await distributions([{ Status: 'Deployed' }]);
      expect(distribution.is_public).toBeUndefined();
      expect((await storedBy(distribution)).is_public).toBeNull();
    });
  });

  it('CloudFront: tags are not read, so they are unavailable', async () => {
    const cloudFront = client(new CloudFrontClient({ region: 'us-east-1' }), {
      ListDistributionsCommand: () => ({ DistributionList: { Items: [{ ARN: 'arn:aws:cloudfront::111122223333:distribution/E0ABC', Id: 'E0ABC', Status: 'Deployed' }] } }),
    });
    const [distribution] = await service().discoverCloudFrontDistributions(ORG, cloudFront);
    expect(distribution.tags).toEqual({});
    expect(distribution.metadata.tags_state).toBe('unavailable');
  });
});
