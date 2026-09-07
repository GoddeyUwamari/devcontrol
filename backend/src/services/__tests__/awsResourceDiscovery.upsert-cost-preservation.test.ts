/**
 * Phase 3B: live-DB coverage for upsertResource()'s null-preserving merge of
 * `estimated_monthly_cost`. A Lambda function whose CloudWatch usage lookup
 * fails on a given discovery cycle now passes `estimated_monthly_cost: null`
 * (see discoverLambdaFunctions()) rather than a fabricated 0 -- this proves
 * the ON CONFLICT clause's COALESCE(EXCLUDED.estimated_monthly_cost,
 * aws_resources.estimated_monthly_cost) actually preserves a
 * previously-known-good value instead of silently overwriting it with NULL,
 * and that a genuinely first-ever insert with no prior value correctly
 * persists NULL (not a fabricated 0) rather than relying on the column's
 * DEFAULT 0.00 (which only applies when a column is omitted, not when NULL
 * is explicitly bound).
 *
 * Runs against the actual local dev Postgres instance, same harness as
 * aws-resources-lifecycle.test.ts.
 */
import { Pool, PoolClient } from 'pg';
import { AWSResourceDiscoveryService } from '../awsResourceDiscovery';
import { CreateAWSResourceInput } from '../../types/aws-resources.types';

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

function lambdaInput(overrides: Partial<CreateAWSResourceInput> = {}): CreateAWSResourceInput {
  return {
    organization_id: orgId,
    resource_arn: 'arn:aws:lambda:us-east-1:1:function:upsert-cost-test',
    resource_id: 'upsert-cost-test',
    resource_name: 'upsert-cost-test',
    resource_type: 'lambda',
    region: 'us-east-1',
    tags: {},
    metadata: {},
    status: 'Active',
    is_encrypted: false,
    ...overrides,
  };
}

beforeAll(async () => {
  client = await pool.connect();
  const { rows } = await client.query(
    `INSERT INTO organizations (name, slug, display_name)
     VALUES ($1, $1, $1)
     RETURNING id`,
    [`upsert-cost-test-${Date.now()}`]
  );
  orgId = rows[0].id;
  await client.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
});

afterEach(async () => {
  await client.query(`DELETE FROM aws_resources WHERE organization_id = $1`, [orgId]);
});

afterAll(async () => {
  await client.query(`DELETE FROM organizations WHERE id = $1`, [orgId]);
  client.release();
  await pool.end();
});

describe('AWSResourceDiscoveryService.upsertResource -- estimated_monthly_cost null/COALESCE handling', () => {
  it('a first-ever insert with no known cost persists NULL, not a fabricated 0', async () => {
    await (service as any).upsertResource(client, lambdaInput({ estimated_monthly_cost: null }));

    const { rows } = await client.query(
      `SELECT estimated_monthly_cost FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
      [orgId, 'arn:aws:lambda:us-east-1:1:function:upsert-cost-test']
    );

    expect(rows[0].estimated_monthly_cost).toBeNull();
  });

  it('a later cycle with a real cost overwrites a prior NULL', async () => {
    await (service as any).upsertResource(client, lambdaInput({ estimated_monthly_cost: null }));
    await (service as any).upsertResource(client, lambdaInput({ estimated_monthly_cost: 12.34 }));

    const { rows } = await client.query(
      `SELECT estimated_monthly_cost FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
      [orgId, 'arn:aws:lambda:us-east-1:1:function:upsert-cost-test']
    );

    expect(parseFloat(rows[0].estimated_monthly_cost)).toBeCloseTo(12.34);
  });

  it('a transient CloudWatch failure on a later cycle (null) preserves the prior known-good value instead of erasing it', async () => {
    await (service as any).upsertResource(client, lambdaInput({ estimated_monthly_cost: 45.67 }));
    await (service as any).upsertResource(client, lambdaInput({ estimated_monthly_cost: null }));

    const { rows } = await client.query(
      `SELECT estimated_monthly_cost FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
      [orgId, 'arn:aws:lambda:us-east-1:1:function:upsert-cost-test']
    );

    expect(parseFloat(rows[0].estimated_monthly_cost)).toBeCloseTo(45.67);
  });

  it('a genuine real zero cost is preserved as 0, distinct from an unavailable/null cost', async () => {
    await (service as any).upsertResource(client, lambdaInput({ estimated_monthly_cost: 0 }));

    const { rows } = await client.query(
      `SELECT estimated_monthly_cost FROM aws_resources WHERE organization_id = $1 AND resource_arn = $2`,
      [orgId, 'arn:aws:lambda:us-east-1:1:function:upsert-cost-test']
    );

    expect(rows[0].estimated_monthly_cost).not.toBeNull();
    expect(parseFloat(rows[0].estimated_monthly_cost)).toBe(0);
  });
});
