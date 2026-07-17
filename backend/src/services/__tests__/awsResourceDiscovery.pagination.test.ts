/**
 * Synthetic-mock coverage for the pagination fix in awsResourceDiscovery.ts.
 * No real org has enough resources to naturally trigger a multi-page AWS
 * response today, so these tests fabricate NextToken/ContinuationToken-bearing
 * responses to exercise the loop logic directly, without touching production
 * data or requiring live AWS credentials.
 *
 * Each private discover* method is called directly via `(service as any)` —
 * they're deliberately narrow, side-effect-free (pure AWS call -> resource
 * array) units, so this avoids mocking the full discoverAllResources
 * orchestration (Pool, AWSClientFactory, ComplianceScannerService, etc.).
 */

import { EC2Client } from '@aws-sdk/client-ec2';
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetBucketEncryptionCommand,
  GetBucketAclCommand,
} from '@aws-sdk/client-s3';
import {
  ECSClient,
  ListClustersCommand,
  ListServicesCommand,
  DescribeServicesCommand,
} from '@aws-sdk/client-ecs';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';

/**
 * AWS SDK v3's generated paginators (paginateDescribeInstances, paginateListServices,
 * etc.) do `if (config.client instanceof ClientCtor)` internally — see
 * @smithy/core's createPaginator — and throw "Invalid client, expected instance of
 * X" otherwise. A plain object cast with `as unknown as EC2Client` fails that check.
 * A real client instance with `.send` overridden as an own property satisfies both
 * the instanceof check (unaffected by own-property overrides) and the mock.
 */
function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

describe('AWSResourceDiscoveryService pagination', () => {
  const service = new AWSResourceDiscoveryService({} as any);

  describe('EC2 instance discovery — representative of all paginateX()-wrapped calls', () => {
    it('collects instances across multiple pages, in order, with no duplicates', async () => {
      const send = jest
        .fn()
        .mockResolvedValueOnce({
          Reservations: [{ Instances: [{ InstanceId: 'i-page1a' }, { InstanceId: 'i-page1b' }] }],
          NextToken: 'token-2',
        })
        .mockResolvedValueOnce({
          Reservations: [{ Instances: [{ InstanceId: 'i-page2a' }] }],
          // no NextToken -> paginator stops here
        });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const resources = await (service as any).discoverEC2Instances('org-1', ec2Client, 'us-east-1');

      expect(send).toHaveBeenCalledTimes(2);
      expect(resources.map((r: any) => r.resource_id)).toEqual(['i-page1a', 'i-page1b', 'i-page2a']);
    });

    it('single-page case (100% of real orgs today) makes exactly one call — output unchanged from pre-fix behavior', async () => {
      const send = jest.fn().mockResolvedValueOnce({
        Reservations: [{ Instances: [{ InstanceId: 'i-only' }] }],
        // no NextToken
      });
      const ec2Client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

      const resources = await (service as any).discoverEC2Instances('org-1', ec2Client, 'us-east-1');

      expect(send).toHaveBeenCalledTimes(1);
      expect(resources).toHaveLength(1);
      expect(resources[0].resource_id).toBe('i-only');
      expect(resources[0].resource_type).toBe('ec2');
    });
  });

  describe('S3 bucket discovery — manual ContinuationToken loop (no generated paginator)', () => {
    const mockPerBucketCalls = (command: any) => {
      if (command instanceof GetBucketLocationCommand) return { LocationConstraint: 'us-east-1' };
      if (command instanceof GetBucketEncryptionCommand) throw new Error('no encryption configured');
      if (command instanceof GetBucketAclCommand) return { Grants: [] };
      return undefined;
    };

    it('follows ContinuationToken across multiple pages', async () => {
      const send = jest.fn(async (command: any) => {
        if (command instanceof ListBucketsCommand) {
          return command.input.ContinuationToken
            ? { Buckets: [{ Name: 'bucket-c' }] }
            : { Buckets: [{ Name: 'bucket-a' }, { Name: 'bucket-b' }], ContinuationToken: 'tok-1' };
        }
        const perBucket = mockPerBucketCalls(command);
        if (perBucket !== undefined) return perBucket;
        throw new Error(`Unexpected command: ${command.constructor.name}`);
      });
      const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), send);

      const resources = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');

      const listBucketsCalls = send.mock.calls.filter(([cmd]) => cmd instanceof ListBucketsCommand);
      expect(listBucketsCalls).toHaveLength(2);
      expect(resources.map((r: any) => r.resource_id)).toEqual(['bucket-a', 'bucket-b', 'bucket-c']);
    });

    it('single-page case makes exactly one ListBuckets call', async () => {
      const send = jest.fn(async (command: any) => {
        if (command instanceof ListBucketsCommand) return { Buckets: [{ Name: 'only-bucket' }] };
        const perBucket = mockPerBucketCalls(command);
        if (perBucket !== undefined) return perBucket;
        throw new Error(`Unexpected command: ${command.constructor.name}`);
      });
      const s3Client = withMockedSend(new S3Client({ region: 'us-east-1' }), send);

      const resources = await (service as any).discoverS3Buckets('org-1', s3Client, 'us-east-1');

      const listBucketsCalls = send.mock.calls.filter(([cmd]) => cmd instanceof ListBucketsCommand);
      expect(listBucketsCalls).toHaveLength(1);
      expect(resources).toHaveLength(1);
      expect(resources[0].resource_id).toBe('only-bucket');
    });
  });

  describe('ECS service discovery — ListServices pagination + DescribeServices 10-ARN chunking', () => {
    it('paginates ListServices past its 10-item default page and chunks DescribeServices at 10 ARNs/call', async () => {
      const page1Arns = Array.from({ length: 10 }, (_, i) => `arn:aws:ecs:us-east-1:1:service/c/svc-${i}`);
      const page2Arns = Array.from({ length: 5 }, (_, i) => `arn:aws:ecs:us-east-1:1:service/c/svc-${i + 10}`);
      const allArns = [...page1Arns, ...page2Arns];

      const send = jest.fn(async (command: any) => {
        if (command instanceof ListClustersCommand) {
          return { clusterArns: ['arn:aws:ecs:us-east-1:1:cluster/c'] };
        }
        if (command instanceof ListServicesCommand) {
          return command.input.nextToken
            ? { serviceArns: page2Arns }
            : { serviceArns: page1Arns, nextToken: 'svc-page-2' };
        }
        if (command instanceof DescribeServicesCommand) {
          const requested: string[] = command.input.services!;
          expect(requested.length).toBeLessThanOrEqual(10);
          return {
            services: requested.map((arn) => ({
              serviceArn: arn,
              serviceName: arn.split('/').pop(),
              clusterArn: 'arn:aws:ecs:us-east-1:1:cluster/c',
              status: 'ACTIVE',
              desiredCount: 1,
            })),
          };
        }
        throw new Error(`Unexpected command: ${command.constructor.name}`);
      });
      const ecsClient = withMockedSend(new ECSClient({ region: 'us-east-1' }), send);

      const resources = await (service as any).discoverECSServices('org-1', ecsClient, 'us-east-1');

      const describeServicesCalls = send.mock.calls.filter(([cmd]) => cmd instanceof DescribeServicesCommand);
      expect(describeServicesCalls).toHaveLength(2); // chunked 10 + 5, never one call with all 15
      expect(resources).toHaveLength(15);
      expect(resources.map((r: any) => r.resource_id)).toEqual(allArns.map((a) => a.split('/').pop()));
    });

    it('single-page case (≤10 services, real-world today) makes exactly one DescribeServices call', async () => {
      const arns = Array.from({ length: 3 }, (_, i) => `arn:aws:ecs:us-east-1:1:service/c/svc-${i}`);

      const send = jest.fn(async (command: any) => {
        if (command instanceof ListClustersCommand) return { clusterArns: ['arn:aws:ecs:us-east-1:1:cluster/c'] };
        if (command instanceof ListServicesCommand) return { serviceArns: arns };
        if (command instanceof DescribeServicesCommand) {
          return {
            services: (command.input.services as string[]).map((arn) => ({
              serviceArn: arn,
              serviceName: arn.split('/').pop(),
              clusterArn: 'arn:aws:ecs:us-east-1:1:cluster/c',
              status: 'ACTIVE',
            })),
          };
        }
        throw new Error('unexpected command');
      });
      const ecsClient = withMockedSend(new ECSClient({ region: 'us-east-1' }), send);

      const resources = await (service as any).discoverECSServices('org-1', ecsClient, 'us-east-1');

      const describeServicesCalls = send.mock.calls.filter(([cmd]) => cmd instanceof DescribeServicesCommand);
      expect(describeServicesCalls).toHaveLength(1);
      expect(resources).toHaveLength(3);
    });
  });
});
