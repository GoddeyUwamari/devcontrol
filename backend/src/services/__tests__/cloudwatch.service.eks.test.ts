/**
 * Coverage for EKS cluster health evaluation (evaluateEksService) — the first test
 * file for cloudwatch.service.ts's health engine (evaluateEcsService has none either;
 * not backfilled here, out of scope for this change).
 *
 * evaluateEksService() itself is pure request-in/response-out against an EKSClient —
 * mocked the same way awsResourceDiscovery.pagination.test.ts mocks AWS SDK clients
 * (a real client instance with `.send` overridden, so paginators/instanceof checks
 * that a plain object cast would fail still work). No live AWS credentials needed,
 * no production data touched.
 *
 * getResourceInventory()'s organization_id scoping — the actual isolation boundary
 * for who can see a discovered EKS cluster at all — is tested separately against the
 * real local dev Postgres instance, per this repo's established convention for
 * anything that depends on real WHERE-clause/RLS semantics (see
 * aws-resources-lifecycle.test.ts, resourceReconciliation.service.test.ts).
 */

import { Pool, PoolClient } from 'pg';
import { EKSClient } from '@aws-sdk/client-eks';
import { CloudWatchService } from '../cloudwatch.service';
import { pool as appPool } from '../../config/database';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

describe('CloudWatchService.evaluateEksService', () => {
  const service = new CloudWatchService();
  const resource = {
    resource_id: 'my-cluster',
    resource_name: 'my-cluster',
    resource_type: 'eks' as const,
    resource_arn: 'arn:aws:eks:us-east-1:815931739526:cluster/my-cluster',
    status: 'unknown',
    metadata: { source: 'resource-explorer', service: 'eks' },
  };

  it('(1) an ACTIVE cluster with no reported health issues is healthy', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      cluster: { name: 'my-cluster', status: 'ACTIVE', version: '1.29', health: { issues: [] } },
    });
    const client = withMockedSend(new EKSClient({ region: 'us-east-1' }), send);

    const result = await (service as any).evaluateEksService(client, resource);

    expect(result.status).toBe('healthy');
    expect(result.monitored).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.signals).toEqual({ issueCount: 0 });
    expect(result.resourceType).toBe('eks');
  });

  it('(2) an ACTIVE cluster with AWS-reported health issues is critical, not silently healthy', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      cluster: {
        name: 'my-cluster',
        status: 'ACTIVE',
        version: '1.29',
        health: {
          issues: [
            { code: 'Ec2SubnetNotFound', message: 'One or more subnets could not be found.', resourceIds: ['subnet-abc'] },
          ],
        },
      },
    });
    const client = withMockedSend(new EKSClient({ region: 'us-east-1' }), send);

    const result = await (service as any).evaluateEksService(client, resource);

    expect(result.status).toBe('critical');
    expect(result.monitored).toBe(true);
    expect(result.reason).toContain('subnets could not be found');
    expect(result.signals).toEqual({ issueCount: 1 });
  });

  it.each([
    ['CREATING', 'degraded'],
    ['UPDATING', 'degraded'],
    ['DELETING', 'degraded'],
  ])('(3) a %s cluster (in-progress AWS operation) is degraded, not critical', async (clusterStatus, expected) => {
    const send = jest.fn().mockResolvedValueOnce({
      cluster: { name: 'my-cluster', status: clusterStatus, health: { issues: [] } },
    });
    const client = withMockedSend(new EKSClient({ region: 'us-east-1' }), send);

    const result = await (service as any).evaluateEksService(client, resource);

    expect(result.status).toBe(expected);
    expect(result.monitored).toBe(true);
  });

  it('(3b) a FAILED cluster is critical — the one lifecycle state that is a failure on its own', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      cluster: { name: 'my-cluster', status: 'FAILED', health: { issues: [] } },
    });
    const client = withMockedSend(new EKSClient({ region: 'us-east-1' }), send);

    const result = await (service as any).evaluateEksService(client, resource);

    expect(result.status).toBe('critical');
  });

  it('(3c) a PENDING cluster (EKS-Anywhere/local) is unknown, not guessed at', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      cluster: { name: 'my-cluster', status: 'PENDING', health: { issues: [] } },
    });
    const client = withMockedSend(new EKSClient({ region: 'us-east-1' }), send);

    const result = await (service as any).evaluateEksService(client, resource);

    expect(result.status).toBe('unknown');
    expect(result.reason).toContain('PENDING');
  });

  it('(4) a failed/unreachable EKS API call (e.g. AccessDenied, throttling) yields unknown, not a thrown error', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('AccessDeniedException: not authorized'));
    const client = withMockedSend(new EKSClient({ region: 'us-east-1' }), send);

    const result = await (service as any).evaluateEksService(client, resource);

    expect(result.status).toBe('unknown');
    expect(result.monitored).toBe(false);
    expect(result.reason).toBe('Failed to reach the EKS API for this cluster');
  });

  it('(5) a response with no cluster body (insufficient data) yields unknown, not a crash', async () => {
    const send = jest.fn().mockResolvedValueOnce({});
    const client = withMockedSend(new EKSClient({ region: 'us-east-1' }), send);

    const result = await (service as any).evaluateEksService(client, resource);

    expect(result.status).toBe('unknown');
    expect(result.monitored).toBe(false);
  });

  it('(5b) a missing health field entirely (not just empty issues) is treated as zero issues, not a crash', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      cluster: { name: 'my-cluster', status: 'ACTIVE' },
    });
    const client = withMockedSend(new EKSClient({ region: 'us-east-1' }), send);

    const result = await (service as any).evaluateEksService(client, resource);

    expect(result.status).toBe('healthy');
    expect(result.signals).toEqual({ issueCount: 0 });
  });
});

describe('CloudWatchService.getResourceInventory — organization isolation and eks inclusion', () => {
  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  const service = new CloudWatchService();

  let orgAId: string;
  let orgBId: string;
  let client: PoolClient;

  async function insertResource(orgId: string, overrides: Partial<{
    resource_arn: string;
    resource_type: string;
    status: string;
  }>) {
    const row = {
      resource_arn: 'arn:aws:eks:us-east-1:*:cluster/default',
      resource_type: 'eks',
      status: 'unknown',
      ...overrides,
    };
    await client.query(
      `INSERT INTO aws_resources
         (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status)
       VALUES ($1, $2, $3, $3, $4, 'us-east-1', $5)`,
      [orgId, row.resource_arn, row.resource_arn.split('/').pop(), row.resource_type, row.status]
    );
  }

  beforeAll(async () => {
    client = await pool.connect();
    const orgA = await client.query(
      `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`,
      [`eks-inventory-test-a-${Date.now()}`]
    );
    orgAId = orgA.rows[0].id;
    const orgB = await client.query(
      `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`,
      [`eks-inventory-test-b-${Date.now()}`]
    );
    orgBId = orgB.rows[0].id;
  });

  afterEach(async () => {
    await client.query(`DELETE FROM aws_resources WHERE organization_id = ANY($1)`, [[orgAId, orgBId]]);
  });

  afterAll(async () => {
    await client.query(`DELETE FROM organizations WHERE id = ANY($1)`, [[orgAId, orgBId]]);
    client.release();
    await pool.end();
    // getResourceInventory() queries through the app-wide pool singleton, not this
    // file's own `pool` — close it too so Jest doesn't report an open handle.
    await appPool.end();
  });

  it('(6) an EKS cluster discovered for org A never appears in org B\'s inventory', async () => {
    await insertResource(orgAId, { resource_arn: 'arn:aws:eks:us-east-1:*:cluster/org-a-cluster' });
    await insertResource(orgBId, { resource_arn: 'arn:aws:eks:us-east-1:*:cluster/org-b-cluster' });

    const orgAInventory = await (service as any).getResourceInventory(orgAId);
    const orgBInventory = await (service as any).getResourceInventory(orgBId);

    expect(orgAInventory.map((r: any) => r.resource_id)).toEqual(['org-a-cluster']);
    expect(orgBInventory.map((r: any) => r.resource_id)).toEqual(['org-b-cluster']);
  });

  it('(regression) EKS is now included in the monitoring inventory query — previously excluded entirely', async () => {
    await insertResource(orgAId, { resource_arn: 'arn:aws:eks:us-east-1:*:cluster/included-cluster' });

    const inventory = await (service as any).getResourceInventory(orgAId);

    expect(inventory.some((r: any) => r.resource_type === 'eks')).toBe(true);
  });

  it('(regression) a terminated EKS cluster is excluded from the monitoring inventory, same as every other type', async () => {
    await insertResource(orgAId, { resource_arn: 'arn:aws:eks:us-east-1:*:cluster/gone-cluster', status: 'terminated' });

    const inventory = await (service as any).getResourceInventory(orgAId);

    expect(inventory).toHaveLength(0);
  });

  it('(9) ECS inclusion in the shared inventory query is unaffected by the eks addition', async () => {
    await client.query(
      `INSERT INTO aws_resources
         (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status)
       VALUES ($1, $2, $3, $3, 'ecs', 'us-east-1', 'active')`,
      [orgAId, 'arn:aws:ecs:us-east-1:*:service/cluster-a/svc-a', 'svc-a']
    );

    const inventory = await (service as any).getResourceInventory(orgAId);

    expect(inventory.some((r: any) => r.resource_type === 'ecs')).toBe(true);
  });
});
