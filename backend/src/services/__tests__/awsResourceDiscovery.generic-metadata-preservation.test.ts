/**
 * Phase 3E, Checkpoint A: live-DB coverage for upsertGenericResource()'s
 * metadata merge. Before this change, `metadata = EXCLUDED.metadata`
 * unconditionally overwrote the column on every re-run -- for DynamoDB
 * tables specifically, that would silently erase enrichDynamoDBTables()'s
 * real per-table configuration (billing mode, capacity, etc.) on any later
 * discovery cycle whose own DescribeTable call happened to fail
 * transiently, even though nothing about the table actually changed. This
 * is the same class of bug Phase 3B fixed for Lambda's
 * estimated_monthly_cost via COALESCE, applied here via a JSONB merge
 * instead: `metadata = aws_resources.metadata || EXCLUDED.metadata`.
 *
 * Proves two things: (1) enrichment metadata written by a separate step
 * survives a later upsertGenericResource() call (the actual regression this
 * exists to prevent), and (2) the generic path's own fields (source,
 * service) still update correctly on that same later call -- the merge must
 * not freeze the generic upsert's own writes in place either.
 *
 * Runs against the actual local dev Postgres instance, same harness as
 * aws-resources-lifecycle.test.ts / awsResourceDiscovery.upsert-cost-preservation.test.ts.
 */
import { Pool, PoolClient } from 'pg';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { NormalizedResourceEntry } from '../resourceExplorer.service';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const service = new AWSResourceDiscoveryService(pool);

let orgId: string;
let client: PoolClient;

const TABLE_ARN = 'arn:aws:dynamodb:us-east-1:123456789012:table/metadata-preservation-test';

function genericEntry(overrides: Partial<NormalizedResourceEntry> = {}): NormalizedResourceEntry {
  return {
    arn: TABLE_ARN,
    resourceType: 'dynamodb',
    region: 'us-east-1',
    service: 'dynamodb',
    tags: {},
    ...overrides,
  };
}

beforeAll(async () => {
  client = await pool.connect();
  const { rows } = await client.query(
    `INSERT INTO organizations (name, slug, display_name)
     VALUES ($1, $1, $1)
     RETURNING id`,
    [`generic-metadata-test-${Date.now()}`]
  );
  orgId = rows[0].id;
});

afterEach(async () => {
  await client.query(`DELETE FROM aws_resources WHERE organization_id = $1`, [orgId]);
});

afterAll(async () => {
  await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  client.release();
  await pool.end();
});

async function getMetadata(): Promise<Record<string, unknown>> {
  const { rows } = await client.query(
    `SELECT metadata FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
    [orgId, TABLE_ARN]
  );
  return rows[0].metadata;
}

describe('AWSResourceDiscoveryService.upsertGenericResource -- metadata merge (not overwrite)', () => {
  it('a first insert persists the plain generic {source, service} metadata', async () => {
    await (service as any).upsertGenericResource(client, orgId, genericEntry());

    const metadata = await getMetadata();
    expect(metadata).toEqual({ source: 'resource-explorer', service: 'dynamodb' });
  });

  it('enrichment metadata written after the generic upsert survives a later re-run of upsertGenericResource', async () => {
    await (service as any).upsertGenericResource(client, orgId, genericEntry());

    // Simulate enrichDynamoDBTables() having enriched this row in the same
    // discovery cycle (real behavior is exercised in
    // awsResourceDiscovery.dynamodb.test.ts; this test isolates the merge
    // guarantee upsertGenericResource() itself must provide).
    await client.query(
      `UPDATE aws_resources SET metadata = metadata || $1::jsonb WHERE organization_id = $2 AND resource_arn = $3`,
      [JSON.stringify({ billing_mode: 'PROVISIONED', provisioned_read_capacity: 50 }), orgId, TABLE_ARN]
    );

    // A later discovery cycle's generic upsert must not erase that enrichment,
    // even though it only ever "knows about" {source, service}.
    await (service as any).upsertGenericResource(client, orgId, genericEntry());

    const metadata = await getMetadata();
    expect(metadata).toEqual({
      source: 'resource-explorer',
      service: 'dynamodb',
      billing_mode: 'PROVISIONED',
      provisioned_read_capacity: 50,
    });
  });

  it('the generic path\'s own fields (source/service) still update correctly on a later run, even with enrichment metadata present', async () => {
    await (service as any).upsertGenericResource(client, orgId, genericEntry({ service: 'dynamodb' }));
    await client.query(
      `UPDATE aws_resources SET metadata = metadata || $1::jsonb WHERE organization_id = $2 AND resource_arn = $3`,
      [JSON.stringify({ billing_mode: 'PAY_PER_REQUEST' }), orgId, TABLE_ARN]
    );

    // Resource Explorer reports a different `service` value on a later scan.
    await (service as any).upsertGenericResource(client, orgId, genericEntry({ service: 'dynamodb-v2' }));

    const metadata = await getMetadata();
    expect(metadata).toEqual({
      source: 'resource-explorer',
      service: 'dynamodb-v2', // updated
      billing_mode: 'PAY_PER_REQUEST', // preserved
    });
  });

  it('does not leak metadata across organizations', async () => {
    const { rows } = await client.query(
      `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, $1) RETURNING id`,
      [`generic-metadata-test-other-${Date.now()}`]
    );
    const otherOrgId = rows[0].id;

    try {
      await (service as any).upsertGenericResource(client, orgId, genericEntry());
      await client.query(
        `UPDATE aws_resources SET metadata = metadata || $1::jsonb WHERE organization_id = $2 AND resource_arn = $3`,
        [JSON.stringify({ billing_mode: 'PROVISIONED' }), orgId, TABLE_ARN]
      );

      // Same ARN string, different organization -- must be a fully separate row.
      await (service as any).upsertGenericResource(client, otherOrgId, genericEntry());

      const { rows: otherRows } = await client.query(
        `SELECT metadata FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
        [otherOrgId, TABLE_ARN]
      );
      expect(otherRows[0].metadata).toEqual({ source: 'resource-explorer', service: 'dynamodb' });
      expect(otherRows[0].metadata.billing_mode).toBeUndefined();
    } finally {
      await client.query(`DELETE FROM aws_resources WHERE organization_id = $1`, [otherOrgId]);
      await client.query(`DELETE FROM organizations WHERE id = $1`, [otherOrgId]);
    }
  });
});
