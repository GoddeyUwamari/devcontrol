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

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

const GB = 1024 * 1024 * 1024;
const LONG_RUNNING = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
const service = costOptimizationService as any;

type Issue = { potentialSavings: number; metadata: Record<string, unknown> };

// Each entry drives one detector to a positive-savings finding.
const DRIVEN: Record<string, () => Promise<Issue[]>> = {
  ec2_idle: async () => {
    const ec2 = withMockedSend(new EC2Client({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({
      Reservations: [{ Instances: [{ InstanceId: 'i-1234567890abcdef0', InstanceType: 'm5.large', LaunchTime: LONG_RUNNING, Placement: { AvailabilityZone: 'us-east-1a' } }] }],
    }));
    const cw = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn().mockResolvedValueOnce({
      Datapoints: Array.from({ length: 168 }, () => ({ Average: 1 })),
    }));
    return (await service.detectIdleEC2Instances(ec2, cw, { ruleId: 'ec2_idle', parameterId: 'cpu_threshold_percent', value: 5, source: 'default' })).issues;
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
