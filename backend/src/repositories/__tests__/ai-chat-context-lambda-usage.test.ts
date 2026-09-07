/**
 * Phase 3B: AIChatContextRepository::getResourceData()'s Lambda invocation
 * figure now sums aws_resources.metadata->>'invocations_30d' -- the real
 * 30-day CloudWatch usage discovery persists per function (see
 * awsResourceDiscovery.ts::discoverLambdaFunctions() and
 * lambda-usage.util.ts) -- replacing a prior query that summed
 * tags->>'invocations', a key nothing in the codebase ever wrote, so it
 * always evaluated to a confident 0 regardless of real usage.
 *
 * Critical property under test: a function whose usage is unavailable
 * (metadata.usage_state === 'unavailable', no invocations_30d key) must
 * reduce invocationsKnownForCount, not silently count as zero invocations
 * indistinguishable from a function that really had none.
 *
 * Runs against the actual local dev Postgres instance, same harness as
 * ai-chat-context-provenance.test.ts.
 */
import { Pool } from 'pg';
import { AIChatContextRepository } from '../ai-chat-context.repository';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const contextRepo = new AIChatContextRepository(pool);
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'starter', 'active') RETURNING id`,
    [`Lambda Usage Org ${suffix}`, `lambda-usage-org-${suffix}`, `Lambda Usage Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertLambdaResource(
  organizationId: string,
  metadata: Record<string, unknown>,
  tags: Record<string, string> = {}
): Promise<void> {
  const suffix = uniqueSuffix();
  await pool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status, tags, metadata)
     VALUES ($1, $2, $3, 'lambda', 'us-east-1', 'Active', $4, $5)`,
    [
      organizationId,
      `arn:aws:lambda:us-east-1:1:function:fn-${suffix}`,
      `fn-${suffix}`,
      JSON.stringify(tags),
      JSON.stringify(metadata),
    ]
  );
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('AIChatContextRepository -- Lambda invocation figure (real usage, not the broken tags path)', () => {
  it('sums real usage from metadata.invocations_30d, all functions known', async () => {
    const orgId = await insertOrg();
    await insertLambdaResource(orgId, { invocations_30d: 100, usage_state: 'normal_usage' });
    await insertLambdaResource(orgId, { invocations_30d: 50, usage_state: 'normal_usage' });

    const resources = await (contextRepo as any).getResourceData(orgId);

    expect(resources.lambda).toEqual({ count: 2, invocations: 150, invocationsKnownForCount: 2 });
  });

  it('a function with unavailable usage is excluded from the sum but still counted, and lowers invocationsKnownForCount', async () => {
    const orgId = await insertOrg();
    await insertLambdaResource(orgId, { invocations_30d: 100, usage_state: 'normal_usage' });
    await insertLambdaResource(orgId, { usage_state: 'unavailable' }); // no invocations_30d key at all

    const resources = await (contextRepo as any).getResourceData(orgId);

    expect(resources.lambda.count).toBe(2);
    expect(resources.lambda.invocations).toBe(100); // only the known function's real usage
    expect(resources.lambda.invocationsKnownForCount).toBe(1); // NOT 2 -- one function's usage is genuinely unknown
  });

  it('does not read the old, always-empty tags.invocations field even when present', async () => {
    const orgId = await insertOrg();
    // A stale/foreign tag that looks like it could be usage data, but the
    // fix must not read it -- only metadata.invocations_30d is authoritative.
    await insertLambdaResource(orgId, { usage_state: 'unavailable' }, { invocations: '999999' });

    const resources = await (contextRepo as any).getResourceData(orgId);

    expect(resources.lambda.invocations).toBe(0);
    expect(resources.lambda.invocationsKnownForCount).toBe(0);
  });

  it('a genuinely zero-invocation function contributes a real zero and counts as known', async () => {
    const orgId = await insertOrg();
    await insertLambdaResource(orgId, { invocations_30d: 0, usage_state: 'zero_usage' });

    const resources = await (contextRepo as any).getResourceData(orgId);

    expect(resources.lambda).toEqual({ count: 1, invocations: 0, invocationsKnownForCount: 1 });
  });

  it('omits the lambda key entirely when the org has no Lambda functions', async () => {
    const orgId = await insertOrg();

    const resources = await (contextRepo as any).getResourceData(orgId);

    expect(resources.lambda).toBeUndefined();
  });
});
