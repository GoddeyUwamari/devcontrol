/**
 * Guard: no dollar figure without a stated basis. Every implemented
 * detector's recommendation with potential_savings > 0 must carry a
 * metadata.savings_basis that classifySavingsBasis() recognises -- otherwise
 * aggregateEstimatedSavings() drops it from every total and the UI shows "No
 * dollar estimate", so a new detector that forgets its basis is caught here
 * rather than silently disappearing (or, worse, being summed unlabelled).
 *
 *   - Behavioural: each cheap-to-drive detector is run against mocked AWS
 *     responses that produce a positive figure.
 *   - Coverage: every 'implemented' registry rule is either driven above, or
 *     listed with the reason it is covered elsewhere -- adding a rule without
 *     updating this file fails.
 *   - Static: every issues.push() in cost-optimization.service.ts either sets
 *     potentialSavings: 0 or names a savings_basis, and every literal basis
 *     uses a recognised prefix.
 *
 * Mock-only: no network calls to AWS.
 */
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { EC2Client } from '@aws-sdk/client-ec2';
import { S3Client } from '@aws-sdk/client-s3';
import { LambdaClient } from '@aws-sdk/client-lambda';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import costOptimizationService from '../cost-optimization.service';
import { classifySavingsBasis } from '../estimated-savings';
import { getImplementedOptimizationRules } from '../../config/optimization-rules';
import { fakeAutoScaling, fakeClassicElb, fakeClient, fakeCloudWatch, fakeEc2, fakeElb } from './helpers/low-activity-aws';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

const GB = 1024 * 1024 * 1024;
const service = costOptimizationService as any;

type Issue = { potentialSavings: number; metadata: Record<string, unknown> };

// Each entry drives one detector to a positive-savings finding.
const DRIVEN: Record<string, () => Promise<Issue[]>> = {
  ec2_idle: async () => {
    // The low-activity rule (FP PR 2b) on a quiet, long-running instance.
    const now = new Date();
    const clients = {
      ec2: fakeEc2([{ InstanceId: 'i-1234567890abcdef0', InstanceType: 'm5.large', LaunchTime: new Date(Date.now() - 60 * 24 * 60 * 60 * 1000) }]),
      cloudWatch: fakeCloudWatch(now, {}), elb: fakeElb({}), elbClassic: fakeClassicElb({}), autoScaling: fakeAutoScaling({}),
    };
    return (await service.detectLowActivityEC2Instances(clients, 'us-east-1', now)).issues;
  },
  ec2_unused_elastic_ip: async () => {
    const ec2 = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({
      Addresses: [{ AllocationId: 'eipalloc-placeholder', PublicIp: '203.0.113.10' }],
    }));
    return (await service.detectUnusedElasticIPs(ec2)).issues;
  },
  ebs_unattached: async () => {
    const ec2 = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({
      Volumes: [{ VolumeId: 'vol-unattached-guard', Size: 100, VolumeType: 'gp3', AvailabilityZone: 'us-east-1a', State: 'available' }],
    }));
    return (await service.detectUnattachedEBSVolumes(ec2)).issues;
  },
  ebs_gp2_to_gp3: async () => {
    const ec2 = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({
      Volumes: [{ VolumeId: 'vol-gp2-guard', Size: 100, VolumeType: 'gp2', Iops: 300, AvailabilityZone: 'us-east-1a' }],
    }));
    return (await service.detectGp2ToGp3Migrations(ec2)).issues;
  },
  s3_lifecycle: async () => {
    const s3 = withMockedSend(new S3Client({ region: 'us-east-1' }), jest.fn()
      .mockResolvedValueOnce({ Buckets: [{ Name: 'guard-bucket' }] })
      .mockResolvedValueOnce({}) // GetBucketLocation: no constraint, us-east-1
      .mockRejectedValueOnce({ name: 'NoSuchLifecycleConfiguration' }));
    const cw = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({
      Datapoints: [{ Average: 100 * GB, Timestamp: new Date() }],
    }));
    return (await service.detectS3LifecycleOptimization(s3, cw)).issues;
  },
  lambda_low_usage: async () => {
    const lambda = withMockedSend(new LambdaClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({
      Functions: [{ FunctionName: `guard-fn-${Date.now()}`, MemorySize: 512 }],
    }));
    const cw = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn()
      .mockResolvedValueOnce({ Datapoints: [{ Sum: 3 }] })
      .mockResolvedValueOnce({ Datapoints: [{ Average: 250 }] }));
    const config = { ruleId: 'lambda_low_usage', parameterId: 'max_invocations', value: 10, source: 'default' };
    return (await service.detectLowUsageLambdaFunctions(`guard-org-${Date.now()}`, lambda, cw, config)).issues;
  },
  ebs_old_snapshots: async () => {
    // C1: a 400-day-old 100 GB snapshot that no AMI, backup vault, DLM policy or lock uses.
    const ec2 = fakeClient((command: any) => {
      const name = command.constructor.name;
      if (name === 'DescribeSnapshotsCommand') {
        return { Snapshots: [{ SnapshotId: 'snap-0000000000000guard', State: 'completed', StorageTier: 'standard', StartTime: new Date(Date.now() - 400 * 24 * 60 * 60 * 1000), VolumeId: 'vol-0000000000000guard', VolumeSize: 100 }] };
      }
      if (name === 'DescribeLockedSnapshotsCommand') return { Snapshots: [] };
      return name === 'DescribeImagesCommand' ? { Images: [] } : { Volumes: [] };
    });
    const backup = fakeClient((command: any) => (command.constructor.name === 'ListBackupVaultsCommand' ? { BackupVaultList: [] } : { RecoveryPoints: [] }));
    return (await service.detectOldEBSSnapshots({ ec2, backup }, 'us-east-1')).issues;
  },
  nat_gateway_idle: async () => {
    // C2: an available zonal NAT gateway created long before the window, with an
    // hourly 0 for all five metrics in every hour of the 32-day window and no routes.
    const DAY = 24 * 60 * 60 * 1000;
    const ec2 = fakeClient((command: any) => (command.constructor.name === 'DescribeNatGatewaysCommand'
      ? { NatGateways: [{ NatGatewayId: 'nat-placeholder-guard', State: 'available', ConnectivityType: 'public', CreateTime: new Date(Date.now() - 90 * DAY), NatGatewayAddresses: [{ AllocationId: 'eipalloc-placeholder-guard', PublicIp: '192.0.2.10' }] }] }
      : { RouteTables: [] }));
    const cw = fakeClient((command: any) => {
      const start = (command.input.StartTime as Date).getTime();
      const end = (command.input.EndTime as Date).getTime();
      const Timestamps: Date[] = [];
      for (let t = start; t < end; t += 60 * 60 * 1000) Timestamps.push(new Date(t));
      return { MetricDataResults: (command.input.MetricDataQueries as any[]).map((q) => ({ Id: q.Id, Timestamps, Values: Timestamps.map(() => 0), StatusCode: 'Complete' })) };
    });
    return (await service.detectIdleNatGateways({ ec2, cloudWatch: cw }, 'us-east-1')).issues;
  },
  rds_idle: async () => {
    // C1b: an available PostgreSQL db.t3.medium (Single-AZ, us-east-1a, not on an Outpost) created long before
    // the window, with no connections and low CPU/IOPS in every hour of the 30-day window.
    const DAY = 24 * 60 * 60 * 1000;
    const rds = fakeClient(() => ({ DBInstances: [{
      DBInstanceIdentifier: 'placeholder-db-guard', DBInstanceStatus: 'available', Engine: 'postgres', LicenseModel: 'postgresql-license',
      DBInstanceClass: 'db.t3.medium', MultiAZ: false, AvailabilityZone: 'us-east-1a', InstanceCreateTime: new Date(Date.now() - 90 * DAY),
      DBSubnetGroup: { DBSubnetGroupName: 'placeholder', Subnets: [{ SubnetIdentifier: 'subnet-placeholder', SubnetOutpost: {} }] },
    }] }));
    const cw = fakeClient((command: any) => {
      const start = (command.input.StartTime as Date).getTime();
      const end = (command.input.EndTime as Date).getTime();
      const Timestamps: Date[] = [];
      for (let t = start; t < end; t += 60 * 60 * 1000) Timestamps.push(new Date(t));
      return { MetricDataResults: (command.input.MetricDataQueries as any[]).map((q) => ({ Id: q.Id, Timestamps, Values: Timestamps.map(() => (q.MetricStat.Metric.MetricName === 'DatabaseConnections' ? 0 : 1)), StatusCode: 'Complete' })) };
    });
    return (await service.detectIdleRDSInstances({ rds, cloudWatch: cw }, 'us-east-1')).issues;
  },
};

// Implemented rules not driven above. Each names the test file (in this
// directory) that runs its detector and the assertion there that proves its
// basis -- the coverage test below fails if the file is missing, does not call
// the detector, or no longer contains the assertion.
const COVERED_ELSEWHERE: Record<string, { file: string; detector: string; assertion: RegExp; why: string }> = {
  ec2_reserved_instances: {
    file: 'estimated-savings.test.ts',
    detector: 'detectReservedInstanceOpportunities',
    assertion: /expect\(issue\.potentialSavings\)\.toBe\(0\);[^]*expect\(issue\.metadata\.savings_basis\)\.toBeUndefined\(\)/,
    why: 'carries no dollar figure at all',
  },
  dynamodb_capacity: {
    file: 'cost-optimization-dynamodb-capacity.test.ts',
    detector: 'detectDynamoDBCapacityOptimization',
    assertion: /expect\(classifySavingsBasis\(result\.issues\[0\]\.metadata\.savings_basis\)\)\.toBe\('ceiling'\)/,
    why: 'needs aws_resources + regional clients',
  },
  dynamodb_capacity_mode: {
    file: 'cost-optimization-dynamodb-mode-comparison.test.ts',
    detector: 'detectDynamoDBOnDemandVsProvisionedOptimization',
    assertion: /expect\(classifySavingsBasis\(result\.issues\[0\]\.metadata\.savings_basis\)\)\.toBe\('estimate'\)/,
    why: 'needs aws_resources + regional clients',
  },
};

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => jest.restoreAllMocks());

describe('savings basis guard: behavioural', () => {
  it.each(Object.keys(DRIVEN))('%s: every finding with a positive figure states a recognised savings_basis', async (ruleId) => {
    const issues = await DRIVEN[ruleId]();
    const positive = issues.filter((issue) => issue.potentialSavings > 0);

    expect(positive.length).toBeGreaterThan(0); // the fixture must actually exercise a dollar figure
    for (const issue of positive) {
      expect(classifySavingsBasis(issue.metadata.savings_basis)).not.toBeNull();
    }
  });

  it('ebs_old_snapshots states its figure as a ceiling, never an estimate', async () => {
    const [issue] = await DRIVEN.ebs_old_snapshots();
    expect(classifySavingsBasis(issue.metadata.savings_basis)).toBe('ceiling');
  });

  it('nat_gateway_idle states its figure as an estimate (regional hourly list price), never a ceiling', async () => {
    const [issue] = await DRIVEN.nat_gateway_idle();
    expect(classifySavingsBasis(issue.metadata.savings_basis)).toBe('estimate');
    expect(issue.potentialSavings).toBe(32.85);
  });

  it('rds_idle states its figure as an estimate (regional instance-hour list price), never a ceiling', async () => {
    const [issue] = await DRIVEN.rds_idle();
    expect(classifySavingsBasis(issue.metadata.savings_basis)).toBe('estimate');
    expect(issue.potentialSavings).toBe(52.56);
  });

  it('s3_lifecycle states its figure as a ceiling, never an estimate', async () => {
    const [issue] = await DRIVEN.s3_lifecycle();
    expect(classifySavingsBasis(issue.metadata.savings_basis)).toBe('ceiling');
  });
});

describe('savings basis guard: coverage', () => {
  it('every implemented registry rule is either driven by this guard or explicitly covered elsewhere', () => {
    const accountedFor = [...Object.keys(DRIVEN), ...Object.keys(COVERED_ELSEWHERE)].sort();
    expect(getImplementedOptimizationRules().map((r) => r.id).sort()).toEqual(accountedFor);
  });

  it.each(Object.entries(COVERED_ELSEWHERE))('%s: the named test file exists, runs the detector, and asserts its basis', (_ruleId, cover) => {
    const path = join(__dirname, cover.file);
    expect(existsSync(path)).toBe(true);
    const testSource = readFileSync(path, 'utf-8');
    expect(testSource).toContain(cover.detector);
    expect(testSource).toMatch(cover.assertion);
  });
});

describe('savings basis guard: static', () => {
  const source = readFileSync(join(__dirname, '../cost-optimization.service.ts'), 'utf-8');

  function pushBlocks(): string[] {
    const blocks: string[] = [];
    let from = 0;
    for (;;) {
      const start = source.indexOf('issues.push({', from);
      if (start === -1) return blocks;
      let depth = 0;
      let i = source.indexOf('{', start);
      for (; i < source.length; i++) {
        if (source[i] === '{') depth++;
        else if (source[i] === '}' && --depth === 0) break;
      }
      blocks.push(source.slice(start, i + 1));
      from = i + 1;
    }
  }

  it('every issues.push() either has no dollar figure or names a savings_basis', () => {
    const blocks = pushBlocks();
    expect(blocks.length).toBeGreaterThanOrEqual(8);
    for (const block of blocks) {
      const noFigure = /potentialSavings: 0,/.test(block);
      expect({ block: block.slice(0, 120), ok: noFigure || /savings_basis[:,]/.test(block) }).toEqual({ block: block.slice(0, 120), ok: true });
    }
  });

  it('every literal savings_basis (and the basis strings it is built from) uses a recognised prefix', () => {
    const literals = [...source.matchAll(/savings_basis: (['`])(.*?)\1/g)].map((m) => m[2]);
    const built = [...source.matchAll(/['`]((?:estimated|scenario|comparison|ceiling):[^'`]*)['`]/g)].map((m) => m[1]);
    expect(literals.length).toBeGreaterThanOrEqual(5);
    for (const basis of [...literals, ...built]) {
      expect({ basis, kind: classifySavingsBasis(basis) }).toEqual({ basis, kind: expect.stringMatching(/^(estimate|ceiling)$/) });
    }
  });
});
