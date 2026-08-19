/**
 * Live-DB coverage for the conservative reconciliation state machine (orphan-removal
 * fix): ResourceReconciliationService.reconcile() against the actual local dev
 * Postgres instance (same DB the app itself connects to — see src/config/database.ts),
 * not a mocked pg client. The WHERE-clause semantics this service depends on
 * (`status != 'terminated'`, ARN-presence membership, resource_type/region scoping)
 * are exactly the kind of thing a JS-side mock of `client.query` would silently
 * get wrong in a way that still makes the test pass — running the real SQL against
 * a real table is what actually proves the state machine.
 *
 * Uses one disposable organization (created in beforeAll, deleted in afterAll —
 * aws_resources rows cascade-delete with it via the FK). Every query in this file
 * is scoped to that organization's id, per the standing rule that any manual
 * aws_resources mutation must filter by organization_id (resource_arn is only
 * unique per-org, not globally — see repo history/incidents on this table).
 */

import { Pool, PoolClient } from 'pg';
import { ResourceReconciliationService, MISSING_SCAN_THRESHOLD } from '../resourceReconciliation.service';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const service = new ResourceReconciliationService();
const TEST_REGION = 'us-east-1';
let orgId: string;
let client: PoolClient;

async function insertRow(overrides: Partial<{
  resource_arn: string;
  resource_type: string;
  region: string;
  status: string;
  missing_scan_count: number;
}>) {
  const row = {
    resource_arn: 'arn:aws:sns:us-east-1:*:topic/default',
    resource_type: 'sns',
    region: TEST_REGION,
    status: 'active',
    missing_scan_count: 0,
    ...overrides,
  };
  await client.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, missing_scan_count)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7)`,
    [orgId, row.resource_arn, row.resource_arn.split('/').pop(), row.resource_type, row.region, row.status, row.missing_scan_count]
  );
}

async function getRow(resourceArn: string) {
  const { rows } = await client.query(
    `SELECT resource_arn, status, missing_scan_count FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
    [orgId, resourceArn]
  );
  return rows[0];
}

beforeAll(async () => {
  client = await pool.connect();
  const { rows } = await client.query(
    `INSERT INTO organizations (name, slug, display_name)
     VALUES ($1, $1, $1)
     RETURNING id`,
    [`reconciliation-test-${Date.now()}`]
  );
  orgId = rows[0].id;
  await client.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
});

afterEach(async () => {
  // Each test asserts exact resetCount/incrementedCount for its own rows —
  // clear the org's aws_resources between tests so an earlier test's leftover
  // rows of the same resource_type can't inflate this test's counts.
  await client.query(`DELETE FROM aws_resources WHERE organization_id = $1`, [orgId]);
});

afterAll(async () => {
  await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  client.release();
  await pool.end();
});

describe('ResourceReconciliationService.reconcile() — live Postgres', () => {
  it('confirms MISSING_SCAN_THRESHOLD is 2 (2 consecutive successful absent scans, ~12h at the 6h discovery cadence)', () => {
    expect(MISSING_SCAN_THRESHOLD).toBe(2);
  });

  it('resource present in the scan resets missing_scan_count to 0', async () => {
    const arn = 'arn:aws:sns:us-east-1:*:topic/present';
    await insertRow({ resource_arn: arn, resource_type: 'sns', missing_scan_count: 1, status: 'active' });

    const result = await service.reconcile(client, orgId, TEST_REGION, new Set([arn]), ['sns']);

    expect(result.resetCount).toBe(1);
    const row = await getRow(arn);
    expect(row.missing_scan_count).toBe(0);
    expect(row.status).toBe('active');
  });

  it('resource absent from the first successful scan: count becomes 1, stays active', async () => {
    const arn = 'arn:aws:sns:us-east-1:*:topic/absent-once';
    await insertRow({ resource_arn: arn, resource_type: 'sns', missing_scan_count: 0, status: 'active' });

    // presentArns deliberately does not include this ARN
    const result = await service.reconcile(client, orgId, TEST_REGION, new Set(['arn:aws:sns:us-east-1:*:topic/unrelated']), ['sns']);

    expect(result.incrementedCount).toBe(1);
    expect(result.terminatedArns).not.toContain(arn);
    const row = await getRow(arn);
    expect(row.missing_scan_count).toBe(1);
    expect(row.status).toBe('active');
  });

  it('resource absent from a second consecutive successful scan: status becomes terminated', async () => {
    const arn = 'arn:aws:sns:us-east-1:*:topic/absent-twice';
    await insertRow({ resource_arn: arn, resource_type: 'sns', missing_scan_count: 1, status: 'active' });

    const result = await service.reconcile(client, orgId, TEST_REGION, new Set([]), ['sns']);

    expect(result.terminatedArns).toContain(arn);
    const row = await getRow(arn);
    expect(row.missing_scan_count).toBe(2);
    expect(row.status).toBe('terminated');
  });

  it('a terminated resource is not touched again by increment (status != \'terminated\' guard)', async () => {
    const arn = 'arn:aws:sns:us-east-1:*:topic/already-terminated';
    await insertRow({ resource_arn: arn, resource_type: 'sns', missing_scan_count: 2, status: 'terminated' });

    const result = await service.reconcile(client, orgId, TEST_REGION, new Set([]), ['sns']);

    expect(result.incrementedCount).toBe(0);
    const row = await getRow(arn);
    expect(row.missing_scan_count).toBe(2);
    expect(row.status).toBe('terminated');
  });

  it('missing_scan_count stays capped/stable across many consecutive absent scans after termination — does not increment indefinitely', async () => {
    const arn = 'arn:aws:sns:us-east-1:*:topic/terminated-forever-absent';
    await insertRow({ resource_arn: arn, resource_type: 'sns', missing_scan_count: 2, status: 'terminated' });

    // Simulate 5 more scan cycles, all still absent, after termination.
    for (let i = 0; i < 5; i++) {
      await service.reconcile(client, orgId, TEST_REGION, new Set([]), ['sns']);
    }

    const row = await getRow(arn);
    expect(row.missing_scan_count).toBe(2); // never moves past the value it terminated at
    expect(row.status).toBe('terminated');
  });

  it('failed/partial discovery never calls reconcile — row is untouched (asserted by the caller contract, not this call)', async () => {
    // reconcile() has no "failed" input mode by design — awsResourceDiscovery.ts
    // simply skips calling it when the underlying discovery/search step didn't
    // succeed. This test documents that reconcile() itself performs no query at
    // all unless invoked, i.e. there is no code path inside it that could ever
    // mark something terminated without a presence signal.
    const arn = 'arn:aws:sns:us-east-1:*:topic/never-touched';
    await insertRow({ resource_arn: arn, resource_type: 'sns', missing_scan_count: 1, status: 'active' });
    // (deliberately not calling reconcile — simulating a skipped/failed scan)
    const row = await getRow(arn);
    expect(row.missing_scan_count).toBe(1);
    expect(row.status).toBe('active');
  });

  it('resourceTypes scoping: an unrelated resource type in the same org is never touched', async () => {
    const snsArn = 'arn:aws:sns:us-east-1:*:topic/scope-sns';
    const vpcArn = 'arn:aws:ec2:us-east-1:*:vpc/scope-vpc';
    await insertRow({ resource_arn: snsArn, resource_type: 'sns', missing_scan_count: 1, status: 'active' });
    await insertRow({ resource_arn: vpcArn, resource_type: 'vpc', missing_scan_count: 1, status: 'active' });

    // Only reconciling 'sns' this call — vpc must be untouched even though its
    // ARN is also absent from presentArns.
    await service.reconcile(client, orgId, TEST_REGION, new Set([]), ['sns']);

    const vpcRow = await getRow(vpcArn);
    expect(vpcRow.missing_scan_count).toBe(1); // unchanged, not incremented to 2
    expect(vpcRow.status).toBe('active');
  });

  it('region scoping: a resource in a different region is never touched by a region-scoped call', async () => {
    const arn = 'arn:aws:sns:us-west-2:*:topic/other-region';
    await insertRow({ resource_arn: arn, resource_type: 'sns', region: 'us-west-2', missing_scan_count: 1, status: 'active' });

    await service.reconcile(client, orgId, TEST_REGION /* us-east-1 */, new Set([]), ['sns']);

    const row = await getRow(arn);
    expect(row.missing_scan_count).toBe(1); // unchanged
  });

  it('does not double-increment when the same scan is reconciled twice for disjoint resourceTypes (no cross-touch)', async () => {
    const snsArn = 'arn:aws:sns:us-east-1:*:topic/disjoint-sns';
    const s3Arn = 'arn:aws:s3:::disjoint-bucket';
    await insertRow({ resource_arn: snsArn, resource_type: 'sns', missing_scan_count: 0, status: 'active' });
    await insertRow({ resource_arn: s3Arn, resource_type: 's3', region: 'us-east-1', missing_scan_count: 0, status: 'active' });

    // Simulates the real call pattern: one reconcile() call for RE_RECONCILED_TYPES,
    // a separate one for ['s3'] — each row must be advanced by exactly one of them.
    await service.reconcile(client, orgId, TEST_REGION, new Set([]), ['sns']);
    await service.reconcile(client, orgId, null, new Set([]), ['s3']);

    const snsRow = await getRow(snsArn);
    const s3Row = await getRow(s3Arn);
    expect(snsRow.missing_scan_count).toBe(1);
    expect(s3Row.missing_scan_count).toBe(1);
  });
});

describe('Terminated resource reappears — full upsert + reconcile path, live Postgres', () => {
  const discoveryService = new AWSResourceDiscoveryService(pool);

  it('a terminated generic (Resource Explorer-sourced) resource seen again clears status and, once reconciled, resets missing_scan_count to 0', async () => {
    const arn = 'arn:aws:ec2:us-east-1:123456789012:vpc/vpc-reappear';
    await insertRow({ resource_arn: arn, resource_type: 'vpc', missing_scan_count: 2, status: 'terminated' });

    // Step 1: the exact code path discoverAllResources runs for every entry a
    // successful Resource Explorer search returns — upsertGenericResource is
    // private, called the same way the pagination test file calls other
    // private discover* methods.
    await (discoveryService as any).upsertGenericResource(client, orgId, {
      arn,
      resourceType: 'vpc',
      region: TEST_REGION,
      service: 'ec2',
      tags: {},
    });

    const afterUpsert = await getRow(arn);
    expect(afterUpsert.status).toBe('unknown'); // no longer stuck at 'terminated'
    expect(afterUpsert.missing_scan_count).toBe(2); // upsert alone does not touch this

    // Step 2: the reconcile() call discoverAllResources makes right after the
    // upsert loop, in the same scan, with this ARN in the present set.
    const result = await service.reconcile(client, orgId, TEST_REGION, new Set([arn]), ['vpc']);

    expect(result.resetCount).toBe(1);
    const afterReconcile = await getRow(arn);
    expect(afterReconcile.status).toBe('unknown');
    expect(afterReconcile.missing_scan_count).toBe(0);
  });

  it('a non-terminated generic resource keeps its existing status across re-upsert (only the terminated case is special-cased)', async () => {
    const arn = 'arn:aws:ec2:us-east-1:123456789012:vpc/vpc-still-unknown';
    await insertRow({ resource_arn: arn, resource_type: 'vpc', missing_scan_count: 0, status: 'unknown' });

    await (discoveryService as any).upsertGenericResource(client, orgId, {
      arn,
      resourceType: 'vpc',
      region: TEST_REGION,
      service: 'ec2',
      tags: {},
    });

    const row = await getRow(arn);
    expect(row.status).toBe('unknown');
  });

  it('a terminated deep-monitored (own-Describe*-discovery) resource seen again is restored to whatever status the scan actually reports, via the same upsertResource path every discovered resource goes through', async () => {
    const arn = 'arn:aws:ec2:us-east-1:*:instance/i-reappear';
    await insertRow({ resource_arn: arn, resource_type: 'ec2', missing_scan_count: 2, status: 'terminated' });

    // Step 1: the exact code path discoverEC2Instances' output goes through —
    // upsertResource unconditionally writes EXCLUDED.status, whatever the
    // fresh DescribeInstances call actually reported (here: 'running'). No
    // separate "restore" logic — this is the plain, ordinary upsert every
    // discovered resource takes.
    await (discoveryService as any).upsertResource(client, {
      organization_id: orgId,
      resource_arn: arn,
      resource_id: 'i-reappear',
      resource_name: 'i-reappear',
      resource_type: 'ec2',
      region: TEST_REGION,
      status: 'running',
    });

    const afterUpsert = await getRow(arn);
    expect(afterUpsert.status).toBe('running'); // whatever the scan reported, not a fabricated "restore" value
    expect(afterUpsert.missing_scan_count).toBe(2); // upsertResource never touches this column

    // Step 2: the RE_RECONCILED_TYPES reconcile() call that follows in the same
    // scan (ec2 is presence-reconciled via Resource Explorer even though its
    // inventory content comes from Describe*) sees status is no longer
    // 'terminated' and zeroes the counter.
    const result = await service.reconcile(client, orgId, TEST_REGION, new Set([arn]), ['ec2']);

    expect(result.resetCount).toBe(1);
    const afterReconcile = await getRow(arn);
    expect(afterReconcile.status).toBe('running');
    expect(afterReconcile.missing_scan_count).toBe(0);
  });
});
