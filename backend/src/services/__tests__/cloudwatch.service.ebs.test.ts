/**
 * Service Health Coverage Expansion: coverage for EBS volume health evaluation
 * (evaluateEbsVolumes) — mirrors cloudwatch.service.eks.test.ts's structure and mocking
 * convention (a real EC2Client instance with `.send` overridden, exercising the real
 * @aws-sdk/client-ec2 paginateDescribeVolumeStatus paginator against it, exactly as
 * awsResourceDiscovery.ebs.test.ts already does for paginateDescribeVolumes). No live AWS
 * credentials needed, no production data touched.
 *
 * getResourceInventory()'s organization_id scoping and ebs inclusion are tested against
 * the real local dev Postgres instance, per this repo's established convention (see
 * cloudwatch.service.eks.test.ts's equivalent section).
 */

import { Pool, PoolClient } from 'pg';
import { EC2Client } from '@aws-sdk/client-ec2';
import { CloudWatchService } from '../cloudwatch.service';
import { pool as appPool } from '../../config/database';

function withMockedSend<T extends { send: (...args: any[]) => any }>(client: T, send: jest.Mock): T {
  (client as any).send = send;
  return client;
}

function volumeRow(overrides: Partial<{ resource_id: string; resource_name: string | null; status: string; metadata: Record<string, any> | null }> = {}) {
  return {
    id: 'db-uuid-1',
    resource_id: 'vol-abc123',
    resource_name: 'vol-abc123',
    resource_type: 'ebs' as const,
    resource_arn: 'arn:aws:ec2:us-east-1:*:volume/vol-abc123',
    status: 'available',
    metadata: { volume_type: 'gp3', size_gb: 100 },
    ...overrides,
  };
}

describe('CloudWatchService.evaluateEbsVolumes', () => {
  const service = new CloudWatchService();

  it('(1) a volume state check of "ok" is healthy and monitored', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      VolumeStatuses: [{ VolumeId: 'vol-abc123', VolumeStatus: { Status: 'ok' }, Events: [] }],
    });
    const client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const [result] = await (service as any).evaluateEbsVolumes(client, [volumeRow()]);

    expect(result.status).toBe('healthy');
    expect(result.monitored).toBe(true);
    expect(result.reason).toBeNull();
    expect(result.resourceType).toBe('ebs');
    // No fabricated uptime/latency/error-rate for a resource type with none of those
    // concepts.
    expect(result.uptime).toBeNull();
    expect(result.responseTimeMs).toBeNull();
    expect(result.errorRate).toBeNull();
  });

  it('(2) a volume status check of "warning" is degraded, not silently healthy', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      VolumeStatuses: [{ VolumeId: 'vol-abc123', VolumeStatus: { Status: 'warning' }, Events: [{ eventType: 'io-performance' }] }],
    });
    const client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const [result] = await (service as any).evaluateEbsVolumes(client, [volumeRow()]);

    expect(result.status).toBe('degraded');
    expect(result.monitored).toBe(true);
    expect(result.signals).toEqual({ eventCount: 1 });
  });

  it('(3) a volume status check of "impaired" is critical', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      VolumeStatuses: [{ VolumeId: 'vol-abc123', VolumeStatus: { Status: 'impaired' }, Events: [] }],
    });
    const client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const [result] = await (service as any).evaluateEbsVolumes(client, [volumeRow()]);

    expect(result.status).toBe('critical');
    expect(result.monitored).toBe(true);
  });

  it('(4) discovery-reported state "error" is down, overriding any live status check', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      VolumeStatuses: [{ VolumeId: 'vol-abc123', VolumeStatus: { Status: 'ok' }, Events: [] }],
    });
    const client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const [result] = await (service as any).evaluateEbsVolumes(client, [volumeRow({ status: 'error' })]);

    expect(result.status).toBe('down');
    expect(result.monitored).toBe(true);
    expect(result.reason).toContain('error state');
  });

  it('(5) discovery-reported state "deleting" is down', async () => {
    const send = jest.fn().mockResolvedValueOnce({ VolumeStatuses: [] });
    const client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const [result] = await (service as any).evaluateEbsVolumes(client, [volumeRow({ status: 'deleting' })]);

    expect(result.status).toBe('down');
    expect(result.monitored).toBe(true);
  });

  it('(6) a volume status check of "insufficient-data" is unknown, not healthy — missing datapoints never become healthy', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      VolumeStatuses: [{ VolumeId: 'vol-abc123', VolumeStatus: { Status: 'insufficient-data' }, Events: [] }],
    });
    const client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const [result] = await (service as any).evaluateEbsVolumes(client, [volumeRow()]);

    expect(result.status).toBe('unknown');
    // AWS DID return a real response for this volume, just an ambiguous one — treated as
    // monitored (a genuine evaluation happened), unlike a total API failure below.
    expect(result.monitored).toBe(true);
  });

  it('(7) discovery-reported state "creating" (transitional) is unknown and not monitored when no live status exists yet', async () => {
    const send = jest.fn().mockResolvedValueOnce({ VolumeStatuses: [] });
    const client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const [result] = await (service as any).evaluateEbsVolumes(client, [volumeRow({ status: 'creating' })]);

    expect(result.status).toBe('unknown');
    expect(result.monitored).toBe(false);
  });

  it('(8) a failed/unreachable EC2 API call (e.g. AccessDenied, throttling) yields unknown for every volume, not a thrown error — AWS API failure never becomes healthy', async () => {
    const send = jest.fn().mockRejectedValueOnce(new Error('AccessDeniedException: not authorized'));
    const client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const results = await (service as any).evaluateEbsVolumes(client, [volumeRow({ resource_id: 'vol-1' }), volumeRow({ resource_id: 'vol-2' })]);

    expect(results).toHaveLength(2);
    for (const r of results) {
      expect(r.status).toBe('unknown');
      expect(r.monitored).toBe(false);
    }
  });

  it('(9) resource identity fields are populated from the inventory row, not fabricated', async () => {
    const send = jest.fn().mockResolvedValueOnce({
      VolumeStatuses: [{ VolumeId: 'vol-abc123', VolumeStatus: { Status: 'ok' }, Events: [] }],
    });
    const client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const [result] = await (service as any).evaluateEbsVolumes(client, [
      volumeRow({ resource_id: 'vol-abc123', resource_name: 'db-data-volume' }),
    ]);

    expect(result.resourceId).toBe('vol-abc123');
    expect(result.resourceDbId).toBe('db-uuid-1');
    expect(result.resourceSortName).toBe('db-data-volume');
    expect(result.name).toBe('db-data-volume');
  });

  it('(10) an empty volume list makes zero AWS calls and returns an empty array', async () => {
    const send = jest.fn();
    const client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);

    const results = await (service as any).evaluateEbsVolumes(client, []);

    expect(results).toEqual([]);
    expect(send).not.toHaveBeenCalled();
  });

  it('(11) more than one chunk (>200 volumes) issues multiple batched calls, never one call per volume', async () => {
    const send = jest.fn().mockResolvedValue({ VolumeStatuses: [] });
    const client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);
    const volumes = Array.from({ length: 250 }, (_, i) => volumeRow({ resource_id: `vol-${i}` }));

    await (service as any).evaluateEbsVolumes(client, volumes);

    // 250 volumes at a 200-per-chunk cap is 2 chunks -- 2 calls, not 250.
    expect(send.mock.calls.length).toBe(2);
  });

  it('(12) a chunk-level AWS failure only affects that chunk\'s volumes, not the whole fleet (resource-level failure isolation)', async () => {
    const send = jest
      .fn()
      .mockRejectedValueOnce(new Error('Throttled'))
      .mockResolvedValueOnce({ VolumeStatuses: [{ VolumeId: 'vol-201', VolumeStatus: { Status: 'ok' }, Events: [] }] });
    const client = withMockedSend(new EC2Client({ region: 'us-east-1' }), send);
    const volumes = [
      ...Array.from({ length: 200 }, (_, i) => volumeRow({ resource_id: `vol-${i}` })),
      volumeRow({ resource_id: 'vol-201' }),
    ];

    const results = await (service as any).evaluateEbsVolumes(client, volumes);

    expect(results).toHaveLength(201);
    expect(results.filter((r: any) => r.status === 'unknown' && !r.monitored)).toHaveLength(200);
    const healthyOne = results.find((r: any) => r.resourceId === 'vol-201');
    expect(healthyOne.status).toBe('healthy');
  });
});

describe('CloudWatchService.getResourceInventory — organization isolation and ebs inclusion', () => {
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
      resource_arn: 'arn:aws:ec2:us-east-1:*:volume/default',
      resource_type: 'ebs',
      status: 'available',
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
      [`ebs-inventory-test-a-${Date.now()}`]
    );
    orgAId = orgA.rows[0].id;
    const orgB = await client.query(
      `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`,
      [`ebs-inventory-test-b-${Date.now()}`]
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
    await appPool.end();
  });

  it('an EBS volume discovered for org A never appears in org B\'s inventory', async () => {
    await insertResource(orgAId, { resource_arn: 'arn:aws:ec2:us-east-1:*:volume/org-a-vol' });
    await insertResource(orgBId, { resource_arn: 'arn:aws:ec2:us-east-1:*:volume/org-b-vol' });

    const orgAInventory = await (service as any).getResourceInventory(orgAId);
    const orgBInventory = await (service as any).getResourceInventory(orgBId);

    expect(orgAInventory.map((r: any) => r.resource_id)).toEqual(['org-a-vol']);
    expect(orgBInventory.map((r: any) => r.resource_id)).toEqual(['org-b-vol']);
  });

  it('(regression) EBS is now included in the monitoring inventory query — previously excluded entirely', async () => {
    await insertResource(orgAId, { resource_arn: 'arn:aws:ec2:us-east-1:*:volume/included-vol' });

    const inventory = await (service as any).getResourceInventory(orgAId);

    expect(inventory.some((r: any) => r.resource_type === 'ebs')).toBe(true);
  });

  it('(regression) a terminated EBS volume is excluded from the monitoring inventory, same as every other type', async () => {
    await insertResource(orgAId, { resource_arn: 'arn:aws:ec2:us-east-1:*:volume/gone-vol', status: 'terminated' });

    const inventory = await (service as any).getResourceInventory(orgAId);

    expect(inventory).toHaveLength(0);
  });
});
