/**
 * Synthetic-mock coverage for the pagination fix in awsResourceDiscovery.ts.
 * No real org has enough resources to naturally trigger a multi-page AWS
 * response today, so these tests fabricate NextToken/ContinuationToken-bearing
 * responses to exercise the loop logic directly, without touching production
 * data or requiring live AWS credentials.
 *
 * EC2 and S3 still have their own dedicated, per-type discovery methods on
 * AWSResourceDiscoveryService, so those are called directly via
 * `(service as any)` — deliberately narrow, side-effect-free (pure AWS call
 * -> resource array) units, avoiding a mock of the full discoverAllResources
 * orchestration (Pool, AWSClientFactory, ComplianceScannerService, etc.).
 *
 * ECS is different: Phase 2B removed its dedicated Describe*-based discovery
 * (ListClusters/ListServices/DescribeServices) entirely. ECS resources are
 * now found the same way as every other "generic" type — via a single AWS
 * Resource Explorer Search call, paginated by the SDK's own generated
 * `paginateSearch`, and classified by `ResourceExplorerService.normalize()`.
 * There is no more ECS-specific discovery method to call — the pagination
 * and ECS-classification tests below exercise `ResourceExplorerService`
 * directly, the actual unit ECS discovery now runs through.
 */

import { EC2Client } from '@aws-sdk/client-ec2';
import {
  S3Client,
  ListBucketsCommand,
  GetBucketLocationCommand,
  GetBucketEncryptionCommand,
  GetBucketAclCommand,
} from '@aws-sdk/client-s3';
import { ResourceExplorer2Client, SearchCommand, Resource as REResource } from '@aws-sdk/client-resource-explorer-2';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { ResourceExplorerService } from '../resourceExplorer.service';

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

  describe('ECS service discovery — via ResourceExplorerService.search() (generic Resource Explorer path)', () => {
    const makeEcsResource = (n: number, overrides: Partial<REResource> = {}): REResource => ({
      Arn: `arn:aws:ecs:us-east-1:1:service/cluster-c/svc-${n}`,
      Region: 'us-east-1',
      Service: 'ecs',
      CfnResourceType: 'AWS::ECS::Service',
      Properties: [{ Name: 'tags', Data: [{ Key: 'env', Value: 'prod' }] } as any],
      ...overrides,
    });

    it('search() paginates past a NextToken-bearing page, collecting resources from every page in order', async () => {
      const page1 = Array.from({ length: 10 }, (_, i) => makeEcsResource(i));
      const page2 = Array.from({ length: 5 }, (_, i) => makeEcsResource(i + 10));

      const send = jest.fn(async (command: any) => {
        if (command instanceof SearchCommand) {
          return command.input.NextToken
            ? { Resources: page2 }
            : { Resources: page1, NextToken: 'page-2' };
        }
        throw new Error(`Unexpected command: ${command.constructor.name}`);
      });
      const client = withMockedSend(new ResourceExplorer2Client({ region: 'us-east-1' }), send);

      const explorer = new ResourceExplorerService();
      const result = await explorer.search(client, 'us-east-1');

      const searchCalls = send.mock.calls.filter(([cmd]) => cmd instanceof SearchCommand);
      expect(searchCalls).toHaveLength(2); // paginateSearch followed NextToken, never one call
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.resources).toHaveLength(15);
      expect(result.resources.map((r) => r.Arn)).toEqual([...page1, ...page2].map((r) => r.Arn));
    });

    it('single-page case (real-world today) makes exactly one Search call', async () => {
      const resources = [makeEcsResource(0), makeEcsResource(1)];
      const send = jest.fn(async (command: any) => {
        if (command instanceof SearchCommand) return { Resources: resources };
        throw new Error(`Unexpected command: ${command.constructor.name}`);
      });
      const client = withMockedSend(new ResourceExplorer2Client({ region: 'us-east-1' }), send);

      const explorer = new ResourceExplorerService();
      const result = await explorer.search(client, 'us-east-1');

      const searchCalls = send.mock.calls.filter(([cmd]) => cmd instanceof SearchCommand);
      expect(searchCalls).toHaveLength(1);
      expect(result.success).toBe(true);
      if (!result.success) throw new Error('unreachable');
      expect(result.resources).toHaveLength(2);
    });

    it('normalize() classifies an AWS::ECS::Service entry as a generic "ecs" resource, and includes its ARN in the reconciliation presence set', () => {
      const ecsResource = makeEcsResource(0);
      const explorer = new ResourceExplorerService();

      const { allArns, genericEntries } = explorer.normalize([ecsResource], 'us-east-1');

      expect(allArns.has(ecsResource.Arn!)).toBe(true);
      expect(genericEntries).toHaveLength(1);
      expect(genericEntries[0]).toMatchObject({
        arn: ecsResource.Arn,
        resourceType: 'ecs',
        region: 'us-east-1',
        service: 'ecs',
        tags: { env: 'prod' },
      });
    });

    it('end-to-end: a paginated Search response containing ECS services normalizes into exactly that many generic "ecs" entries', async () => {
      const page1 = Array.from({ length: 10 }, (_, i) => makeEcsResource(i));
      const page2 = Array.from({ length: 5 }, (_, i) => makeEcsResource(i + 10));

      const send = jest.fn(async (command: any) => {
        if (command instanceof SearchCommand) {
          return command.input.NextToken
            ? { Resources: page2 }
            : { Resources: page1, NextToken: 'page-2' };
        }
        throw new Error(`Unexpected command: ${command.constructor.name}`);
      });
      const client = withMockedSend(new ResourceExplorer2Client({ region: 'us-east-1' }), send);

      const explorer = new ResourceExplorerService();
      const searchResult = await explorer.search(client, 'us-east-1');
      expect(searchResult.success).toBe(true);
      if (!searchResult.success) throw new Error('unreachable');

      const { allArns, genericEntries } = explorer.normalize(searchResult.resources, 'us-east-1');
      const ecsEntries = genericEntries.filter((e) => e.resourceType === 'ecs');

      expect(ecsEntries).toHaveLength(15);
      expect(allArns.size).toBe(15);
    });
  });
});
