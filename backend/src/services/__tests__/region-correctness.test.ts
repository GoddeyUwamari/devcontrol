/**
 * Region correctness at one scanned region (multi-region plan, PR M1):
 *
 *   - a recommendation's region is the region the detector scanned, never one
 *     derived from an availability zone (a Local Zone such as us-west-2-lax-1a
 *     is not "us-west-2-lax-1") and never the platform's AWS_REGION;
 *   - S3 reads (discovery's encryption/ACL/lifecycle/tags, the lifecycle
 *     detector's lifecycle and size) are made in each bucket's own region,
 *     and GetBucketLocation's legacy 'EU' is stored as eu-west-1;
 *   - the RI check reports whether it completed.
 *
 * Synthetic clients only: no database, no network.
 */
import { EC2Client } from '@aws-sdk/client-ec2';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { S3Client } from '@aws-sdk/client-s3';
import costOptimizationService from '../cost-optimization.service';
import { AWSClientFactory } from '../aws-client-factory.service';
import { OptimizationRuleConfigService } from '../optimization-rule-config.service';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

const service = costOptimizationService as any;
const LOCAL_ZONE = 'us-west-2-lax-1a';
const GB = 1024 * 1024 * 1024;
const ENV_BEFORE = { ...process.env };

beforeEach(() => {
  // The platform's own region, which must never become a recommendation's region.
  process.env.AWS_REGION = 'ap-south-1';
  process.env.AWS_DEFAULT_REGION = 'ap-south-1';
  jest.spyOn(console, 'error').mockImplementation(() => {});
  jest.spyOn(console, 'log').mockImplementation(() => {});
});

afterEach(() => {
  process.env = { ...ENV_BEFORE };
  jest.restoreAllMocks();
});

describe('detector region labels are the scanned region', () => {
  it('unattached EBS in a Local Zone is labelled with the region it was listed in', async () => {
    const ec2 = withMockedSend(new EC2Client({ region: 'us-west-2' }), jest.fn().mockResolvedValueOnce({
      Volumes: [{ VolumeId: 'vol-localzone', VolumeType: 'gp3', Size: 100, State: 'available', AvailabilityZone: LOCAL_ZONE }],
    }));

    const result = await service.detectUnattachedEBSVolumes(ec2, 'us-west-2');

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].awsRegion).toBe('us-west-2');
  });

  it('gp2 -> gp3 in a Local Zone is labelled with the region it was listed in', async () => {
    const ec2 = withMockedSend(new EC2Client({ region: 'us-west-2' }), jest.fn().mockResolvedValueOnce({
      Volumes: [{ VolumeId: 'vol-gp2-localzone', VolumeType: 'gp2', Size: 100, Iops: 300, AvailabilityZone: LOCAL_ZONE }],
    }));

    const result = await service.detectGp2ToGp3Migrations(ec2, 'us-west-2');

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].awsRegion).toBe('us-west-2');
  });

  it('an idle instance in a Local Zone is labelled with the region it was listed in', async () => {
    const ec2 = withMockedSend(new EC2Client({ region: 'us-west-2' }), jest.fn().mockResolvedValueOnce({
      Reservations: [{ Instances: [{
        InstanceId: 'i-1234567890abcdef0', InstanceType: 't3.micro',
        LaunchTime: new Date(Date.now() - 30 * 24 * 60 * 60 * 1000), Placement: { AvailabilityZone: LOCAL_ZONE },
      }] }],
    }));
    const cw = withMockedSend(new CloudWatchClient({ region: 'us-west-2' }), jest.fn().mockResolvedValueOnce({
      Datapoints: Array.from({ length: 168 }, () => ({ Average: 1 })),
    }));
    const config = { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 5, source: 'default' };

    const result = await service.detectIdleEC2Instances(ec2, cw, config, 'us-west-2');

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].awsRegion).toBe('us-west-2');
  });

  it('an unused Elastic IP is labelled with the scanned region, not AWS_REGION', async () => {
    const ec2 = withMockedSend(new EC2Client({ region: 'eu-west-1' }), jest.fn().mockResolvedValueOnce({
      Addresses: [{ AllocationId: 'eipalloc-unused', PublicIp: '198.51.100.7' }],
    }));

    const result = await service.detectUnusedElasticIPs(ec2, 'eu-west-1');

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].awsRegion).toBe('eu-west-1');
  });

  it('a low-usage Lambda function is labelled with the scanned region, not AWS_REGION', async () => {
    const lambda = withMockedSend(new LambdaClient({ region: 'eu-west-1' }), jest.fn().mockResolvedValueOnce({
      Functions: [{ FunctionName: 'never-called', MemorySize: 128 }],
    }));
    const cw = withMockedSend(new CloudWatchClient({ region: 'eu-west-1' }), jest.fn().mockResolvedValueOnce({ Datapoints: [] }));
    const config = { ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default' };

    const result = await service.detectLowUsageLambdaFunctions('org-region', lambda, cw, config, 'eu-west-1');

    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].awsRegion).toBe('eu-west-1');
  });

  it('an RI coverage gap is labelled with the scanned region, not AWS_REGION', async () => {
    const ec2 = withMockedSend(new EC2Client({ region: 'eu-west-1' }), jest.fn()
      .mockResolvedValueOnce({ Reservations: [{ Instances: [
        { InstanceId: 'i-a', InstanceType: 'm5.large' },
        { InstanceId: 'i-b', InstanceType: 'm5.large' },
      ] }] })
      .mockResolvedValueOnce({ ReservedInstances: [] }));

    const result = await service.detectReservedInstanceOpportunities(ec2, 'eu-west-1');

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].awsRegion).toBe('eu-west-1');
  });

  it('analyzeAllResources passes the scanned region to every region-labelled detector', async () => {
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({
      enabled: true, region: 'eu-west-1', ec2: {}, s3: {}, lambda: {}, cloudWatch: {},
      getS3ClientForRegion: jest.fn(), getCloudWatchClientForRegion: jest.fn(),
    } as any);
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockImplementation((async (
      _org: string, ruleId: string, parameterId: string
    ) => ({ ruleId, parameterId, value: 5, source: 'default' })) as any);
    const ok = { success: true, issues: [] };
    const spies = Object.fromEntries(
      ['detectIdleEC2Instances', 'detectUnusedElasticIPs', 'detectUnattachedEBSVolumes', 'detectGp2ToGp3Migrations',
        'detectLowUsageLambdaFunctions', 'detectReservedInstanceOpportunities', 'detectS3LifecycleOptimization',
        'detectDynamoDBCapacityOptimization', 'detectDynamoDBOnDemandVsProvisionedOptimization']
        .map((name) => [name, jest.spyOn(service, name).mockResolvedValue(ok)])
    );

    await costOptimizationService.analyzeAllResources('org-region');

    for (const name of ['detectIdleEC2Instances', 'detectUnusedElasticIPs', 'detectUnattachedEBSVolumes',
      'detectGp2ToGp3Migrations', 'detectLowUsageLambdaFunctions', 'detectReservedInstanceOpportunities']) {
      const args = spies[name].mock.calls[0];
      expect([name, args[args.length - 1]]).toEqual([name, 'eu-west-1']);
    }
  });
});

describe('the RI check reports whether it completed', () => {
  it('a failed RI check is success: false, not an empty answer', async () => {
    const ec2 = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockRejectedValueOnce(new Error('UnauthorizedOperation')));

    await expect(service.detectReservedInstanceOpportunities(ec2, 'us-east-1')).resolves.toEqual({ success: false, issues: [] });
  });

  it('analyzeAllResources reports riSucceeded from the RI check', async () => {
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({ enabled: true, region: 'us-east-1' } as any);
    jest.spyOn(OptimizationRuleConfigService.prototype, 'resolveEffectiveConfig').mockRejectedValue(new Error('skip'));
    for (const name of ['detectUnusedElasticIPs', 'detectUnattachedEBSVolumes', 'detectGp2ToGp3Migrations',
      'detectS3LifecycleOptimization', 'detectDynamoDBCapacityOptimization', 'detectDynamoDBOnDemandVsProvisionedOptimization']) {
      jest.spyOn(service, name).mockResolvedValue({ success: true, issues: [] });
    }
    const ri = jest.spyOn(service, 'detectReservedInstanceOpportunities');

    ri.mockResolvedValueOnce({ success: false, issues: [] });
    expect((await costOptimizationService.analyzeAllResources('org-ri')).riSucceeded).toBe(false);

    ri.mockResolvedValueOnce({ success: true, issues: [] });
    expect((await costOptimizationService.analyzeAllResources('org-ri')).riSucceeded).toBe(true);
  });
});

/** A client recorder per region: every command sent, by region, answered by `answer`. */
function regionalClients<T extends { send: unknown }>(
  build: (region: string) => T,
  answer: (region: string, command: { constructor: { name: string }; input: any }) => unknown
) {
  const sent: Array<{ region: string; command: string }> = [];
  const forRegion = jest.fn((region: string) =>
    withMockedSend(build(region) as any, jest.fn(async (command: any) => {
      sent.push({ region, command: command.constructor.name });
      return answer(region, command);
    }))
  );
  return { forRegion, sent };
}

const awsError = (name: string) => Object.assign(new Error(name), { name });

describe('S3 lifecycle detector: each bucket in its own region', () => {
  it("reads lifecycle and size in the bucket's region and labels the finding with it ('EU' is eu-west-1)", async () => {
    const homeSend = jest.fn(async (command: any) => {
      if (command.constructor.name === 'ListBucketsCommand') return { Buckets: [{ Name: 'legacy-eu-bucket' }] };
      if (command.constructor.name === 'GetBucketLocationCommand') return { LocationConstraint: 'EU' };
      throw new Error(`home client must not be asked ${command.constructor.name}`);
    });
    const homeS3 = withMockedSend(new S3Client({ region: 'us-east-1' }), homeSend);
    const homeCw = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn(async () => {
      throw new Error('home CloudWatch must not be asked');
    }));
    const s3 = regionalClients((r) => new S3Client({ region: r }), () => { throw awsError('NoSuchLifecycleConfiguration'); });
    const cw = regionalClients((r) => new CloudWatchClient({ region: r }), () => ({ Datapoints: [{ Average: 100 * GB, Timestamp: new Date() }] }));

    const result = await service.detectS3LifecycleOptimization(homeS3, homeCw, {
      s3ClientForRegion: s3.forRegion,
      cloudWatchClientForRegion: cw.forRegion,
    });

    expect(result.success).toBe(true);
    expect(result.issues).toHaveLength(1);
    expect(result.issues[0].awsRegion).toBe('eu-west-1');
    expect(s3.sent).toEqual([{ region: 'eu-west-1', command: 'GetBucketLifecycleConfigurationCommand' }]);
    expect(cw.sent).toEqual([{ region: 'eu-west-1', command: 'GetMetricStatisticsCommand' }]);
  });

  it('a bucket whose region cannot be read is skipped, never read in the home region', async () => {
    const homeSend = jest.fn(async (command: any) => {
      if (command.constructor.name === 'ListBucketsCommand') return { Buckets: [{ Name: 'unknown-region-bucket' }] };
      if (command.constructor.name === 'GetBucketLocationCommand') throw awsError('AccessDenied');
      throw new Error(`home client must not be asked ${command.constructor.name}`);
    });
    const homeS3 = withMockedSend(new S3Client({ region: 'us-east-1' }), homeSend);
    const homeCw = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn());
    const s3 = regionalClients((r) => new S3Client({ region: r }), () => ({}));

    const result = await service.detectS3LifecycleOptimization(homeS3, homeCw, { s3ClientForRegion: s3.forRegion });

    expect(result).toEqual({ success: true, issues: [] });
    expect(s3.sent).toEqual([]);
  });
});

describe('S3 discovery: each bucket in its own region', () => {
  it("stores 'EU' as eu-west-1 and reads encryption, ACL, lifecycle and tags with the eu-west-1 client", async () => {
    const homeCommands: string[] = [];
    const homeS3 = withMockedSend(new S3Client({ region: 'us-east-1' }), jest.fn(async (command: any) => {
      homeCommands.push(command.constructor.name);
      if (command.constructor.name === 'ListBucketsCommand') return { Buckets: [{ Name: 'legacy-eu-bucket' }] };
      if (command.constructor.name === 'GetBucketLocationCommand') return { LocationConstraint: 'EU' };
      throw new Error(`home client must not be asked ${command.constructor.name}`);
    }));
    const regional = regionalClients((r) => new S3Client({ region: r }), (_region, command) => {
      switch (command.constructor.name) {
        case 'GetBucketEncryptionCommand': return {};
        case 'GetBucketAclCommand': return { Grants: [] };
        case 'GetBucketLifecycleConfigurationCommand': throw awsError('NoSuchLifecycleConfiguration');
        case 'GetBucketTaggingCommand': return { TagSet: [{ Key: 'team', Value: 'data' }] };
        default: throw new Error(`unexpected ${command.constructor.name}`);
      }
    });
    const discovery = new AWSResourceDiscoveryService({} as any) as any;

    const [bucket] = await discovery.discoverS3Buckets('org-s3', homeS3, 'us-east-1', regional.forRegion);

    expect(bucket.region).toBe('eu-west-1');
    expect(bucket.is_encrypted).toBe(true);
    expect(bucket.is_public).toBe(false);
    expect(bucket.metadata.lifecycle_status).toBe('no_lifecycle_configuration');
    expect(bucket.tags).toEqual({ team: 'data' });
    expect(homeCommands).toEqual(['ListBucketsCommand', 'GetBucketLocationCommand']);
    expect(new Set(regional.sent.map((s) => s.region))).toEqual(new Set(['eu-west-1']));
    expect(regional.sent.map((s) => s.command).sort()).toEqual([
      'GetBucketAclCommand', 'GetBucketEncryptionCommand', 'GetBucketLifecycleConfigurationCommand', 'GetBucketTaggingCommand',
    ]);
  });

  it('a bucket in the home region is read with the home client', async () => {
    const homeCommands: string[] = [];
    const homeS3 = withMockedSend(new S3Client({ region: 'us-east-1' }), jest.fn(async (command: any) => {
      homeCommands.push(command.constructor.name);
      switch (command.constructor.name) {
        case 'ListBucketsCommand': return { Buckets: [{ Name: 'home-bucket' }] };
        case 'GetBucketLocationCommand': return {};
        case 'GetBucketEncryptionCommand': return {};
        case 'GetBucketAclCommand': return { Grants: [] };
        case 'GetBucketLifecycleConfigurationCommand': throw awsError('NoSuchLifecycleConfiguration');
        case 'GetBucketTaggingCommand': throw awsError('NoSuchTagSet');
        default: throw new Error(`unexpected ${command.constructor.name}`);
      }
    }));
    const regional = regionalClients((r) => new S3Client({ region: r }), () => ({}));
    const discovery = new AWSResourceDiscoveryService({} as any) as any;

    const [bucket] = await discovery.discoverS3Buckets('org-s3', homeS3, 'us-east-1', regional.forRegion);

    expect(bucket.region).toBe('us-east-1');
    expect(regional.sent).toEqual([]);
    expect(homeCommands).toContain('GetBucketEncryptionCommand');
  });
});
