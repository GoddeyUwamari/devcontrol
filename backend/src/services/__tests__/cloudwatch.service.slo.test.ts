/**
 * Coverage for CloudWatchService.evaluateResourceForSlo — the SLO 3A entry point into
 * the same evaluateResource() engine getMetrics() uses. Same testing shape as
 * cloudwatch.service.eks.test.ts: AWS SDK client `.send` is mocked directly (no live
 * credentials), real local Postgres for the aws_resources inventory row (the actual
 * organization-scoping boundary), and AWSClientFactory.createClients is spied on so no
 * real AWS SDK client construction / STS AssumeRole happens in this suite.
 */

import { Pool } from 'pg';
import { CloudWatchClient } from '@aws-sdk/client-cloudwatch';
import { CloudWatchService } from '../cloudwatch.service';
import { AWSClientFactory } from '../aws-client-factory.service';
import { pool as appPool } from '../../config/database';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

function datapoint(field: 'Average' | 'Sum', value: number) {
  return { Datapoints: [{ [field]: value, Timestamp: new Date() }] };
}

function emptyDatapoints() {
  return { Datapoints: [] };
}

describe('CloudWatchService.evaluateResourceForSlo', () => {
  const service = new CloudWatchService();
  const pool = new Pool(dbConfig());

  let orgId: string;
  const createdOrgIds: string[] = [];

  async function insertResource(overrides: { resource_id: string; resource_type: string; resource_arn: string; status?: string }) {
    await pool.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status)
       VALUES ($1, $2, $3, $3, $4, 'us-east-1', $5)`,
      [orgId, overrides.resource_arn, overrides.resource_id, overrides.resource_type, overrides.status ?? 'active']
    );
  }

  beforeAll(async () => {
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`,
      [`slo-cloudwatch-test-${Date.now()}`]
    );
    orgId = rows[0].id;
    createdOrgIds.push(orgId);
  });

  afterEach(async () => {
    await pool.query(`DELETE FROM aws_resources WHERE organization_id = $1`, [orgId]);
    jest.restoreAllMocks();
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM organizations WHERE id = ANY($1)`, [createdOrgIds]);
    await pool.end();
    await appPool.end();
  }, 15000);

  it('(1) AWS not connected returns null, never a fabricated observation', async () => {
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({ enabled: false } as any);

    const result = await service.evaluateResourceForSlo(orgId, 'ec2', 'i-anything', '24h');
    expect(result).toBeNull();
  });

  it('(2) a resource_id not in this org\'s inventory yields resourceExists:false, not a crash', async () => {
    const mockClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn());
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({ enabled: true, cloudWatch: mockClient, region: 'us-east-1' } as any);

    const result = await service.evaluateResourceForSlo(orgId, 'ec2', 'i-does-not-exist', '24h');
    expect(result).toEqual({ resourceExists: false, monitored: false, uptime: null, avgLatencyMs: null, errorRatePercent: null });
    expect(mockClient.send).not.toHaveBeenCalled();
  });

  it('(3) EC2 availability: real inventory row + healthy StatusCheckFailed telemetry', async () => {
    await insertResource({ resource_id: 'i-slo-1', resource_type: 'ec2', resource_arn: 'arn:aws:ec2:us-east-1:*:instance/i-slo-1' });
    const send = jest.fn()
      .mockResolvedValueOnce(datapoint('Average', 0)) // statusCheckFailed
      .mockResolvedValueOnce(datapoint('Average', 12)); // cpu
    const mockClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), send);
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({ enabled: true, cloudWatch: mockClient, region: 'us-east-1' } as any);

    const result = await service.evaluateResourceForSlo(orgId, 'ec2', 'i-slo-1', '7d');

    expect(result).toEqual({ resourceExists: true, monitored: true, uptime: 100, avgLatencyMs: null, errorRatePercent: null });
  });

  it('(4) EC2 with no CloudWatch datapoints yields monitored:false, not 0% uptime', async () => {
    await insertResource({ resource_id: 'i-slo-2', resource_type: 'ec2', resource_arn: 'arn:aws:ec2:us-east-1:*:instance/i-slo-2' });
    const send = jest.fn().mockResolvedValue(emptyDatapoints());
    const mockClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), send);
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({ enabled: true, cloudWatch: mockClient, region: 'us-east-1' } as any);

    const result = await service.evaluateResourceForSlo(orgId, 'ec2', 'i-slo-2', '24h');

    expect(result?.monitored).toBe(false);
    expect(result?.uptime).toBeNull();
  });

  it('(5) ALB latency + error rate observed together from one evaluation', async () => {
    await insertResource({ resource_id: 'alb-slo-1', resource_type: 'load-balancer', resource_arn: 'arn:aws:elasticloadbalancing:us-east-1:*:loadbalancer/app/alb-slo-1/abc123', status: 'active' });
    const send = jest.fn()
      .mockResolvedValueOnce(datapoint('Average', 0.25)) // latencySec -> 250ms
      .mockResolvedValueOnce(datapoint('Sum', 1000)) // requestSum
      .mockResolvedValueOnce(datapoint('Sum', 10)) // errorSum -> 1% error rate
      .mockResolvedValueOnce(datapoint('Average', 0.2)); // previousLatencySec
    const mockClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), send);
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({ enabled: true, cloudWatch: mockClient, region: 'us-east-1' } as any);

    const result = await service.evaluateResourceForSlo(orgId, 'load-balancer', 'alb-slo-1', '24h');

    expect(result).toEqual({ resourceExists: true, monitored: true, uptime: null, avgLatencyMs: 250, errorRatePercent: 1 });
  });

  it('(6) Lambda error rate observed independently of ALB error rate', async () => {
    await insertResource({ resource_id: 'my-fn', resource_type: 'lambda', resource_arn: 'arn:aws:lambda:us-east-1:*:function:my-fn' });
    const send = jest.fn()
      .mockResolvedValueOnce(datapoint('Sum', 200)) // invocations
      .mockResolvedValueOnce(datapoint('Sum', 4)) // errors -> 2% error rate
      .mockResolvedValueOnce(datapoint('Average', 150)); // duration
    const mockClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), send);
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({ enabled: true, cloudWatch: mockClient, region: 'us-east-1' } as any);

    const result = await service.evaluateResourceForSlo(orgId, 'lambda', 'my-fn', '7d');

    // avgLatencyMs is populated too (Lambda's capability also reports duration as its
    // responseTimeMs) -- only errorRatePercent is relevant to the lambda_error_rate SLI,
    // proving it's computed independently of ALB's error rate in test (5) above.
    expect(result).toEqual({ resourceExists: true, monitored: true, uptime: null, avgLatencyMs: 150, errorRatePercent: 2 });
  });

  it('(7) a terminated resource is treated as not-in-inventory, same as getMetrics()\'s convention', async () => {
    await insertResource({ resource_id: 'i-gone', resource_type: 'ec2', resource_arn: 'arn:aws:ec2:us-east-1:*:instance/i-gone', status: 'terminated' });
    const mockClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn());
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({ enabled: true, cloudWatch: mockClient, region: 'us-east-1' } as any);

    const result = await service.evaluateResourceForSlo(orgId, 'ec2', 'i-gone', '24h');

    expect(result?.resourceExists).toBe(false);
  });

  it('(8) a resource belonging to a different organization is never observed — cross-tenant isolation', async () => {
    const { rows } = await pool.query(
      `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`,
      [`slo-cloudwatch-other-org-${Date.now()}`]
    );
    const otherOrgId = rows[0].id;
    createdOrgIds.push(otherOrgId);
    await pool.query(
      `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status)
       VALUES ($1, $2, $3, $3, 'ec2', 'us-east-1', 'active')`,
      [otherOrgId, 'arn:aws:ec2:us-east-1:*:instance/i-other-org', 'i-other-org']
    );
    const mockClient = withMockedSend(new CloudWatchClient({ region: 'us-east-1' }), jest.fn());
    jest.spyOn(AWSClientFactory, 'createClients').mockResolvedValue({ enabled: true, cloudWatch: mockClient, region: 'us-east-1' } as any);

    // Requesting orgId (not otherOrgId) must not see the other org's resource.
    const result = await service.evaluateResourceForSlo(orgId, 'ec2', 'i-other-org', '24h');

    expect(result?.resourceExists).toBe(false);
    await pool.query(`DELETE FROM aws_resources WHERE organization_id = $1`, [otherOrgId]);
  });
});
