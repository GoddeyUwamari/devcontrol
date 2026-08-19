/**
 * Live-DB coverage for the operational/historical lifecycle boundary (the
 * downstream half of the orphan-removal fix — reconciliation itself, commit
 * 2da8441, is tested separately in services/__tests__/resourceReconciliation
 * .service.test.ts and is NOT touched here).
 *
 * Runs against the actual local dev Postgres instance (same DB the app
 * connects to — see src/config/database.ts), not mocked pg clients, for the
 * same reason as the reconciliation tests: the WHERE-clause semantics under
 * test (`status != 'terminated'` vs. an explicit `status = 'terminated'`
 * filter) are exactly what a JS-side mock would get wrong silently.
 *
 * Product rule under test: operational/current-state consumers must exclude
 * status='terminated'; historical/audit consumers (an explicit status filter)
 * must still be able to see it. See awsResources.repository.ts::findAll,
 * ::getStats, and ai-chat-context.repository.ts's resource/service context.
 */

import { Pool, PoolClient } from 'pg';
import { AWSResourcesRepository } from '../awsResources.repository';
import { AIChatContextRepository } from '../ai-chat-context.repository';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

const resourcesRepo = new AWSResourcesRepository(pool);
const aiChatRepo = new AIChatContextRepository(pool);

let orgId: string;
let client: PoolClient;

async function insertRow(overrides: Partial<{
  resource_arn: string;
  resource_type: string;
  region: string;
  status: string;
  estimated_monthly_cost: number;
}>) {
  const row = {
    resource_arn: 'arn:aws:ec2:us-east-1:*:instance/default',
    resource_type: 'ec2',
    region: 'us-east-1',
    status: 'running',
    estimated_monthly_cost: 0,
    ...overrides,
  };
  await client.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status, estimated_monthly_cost)
     VALUES ($1, $2, $3, $3, $4, $5, $6, $7)`,
    [orgId, row.resource_arn, row.resource_arn.split('/').pop(), row.resource_type, row.region, row.status, row.estimated_monthly_cost]
  );
}

beforeAll(async () => {
  client = await pool.connect();
  const { rows } = await client.query(
    `INSERT INTO organizations (name, slug, display_name)
     VALUES ($1, $1, $1)
     RETURNING id`,
    [`lifecycle-test-${Date.now()}`]
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

describe('AWSResourcesRepository — operational vs. historical lifecycle boundary', () => {
  it('(1) an active resource appears in operational inventory (findAll, default)', async () => {
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/active-1', status: 'running' });

    const { resources, total } = await resourcesRepo.findAll(orgId);

    expect(total).toBe(1);
    expect(resources.map((r: any) => r.resource_arn)).toContain('arn:aws:ec2:us-east-1:*:instance/active-1');
  });

  it('(2) a terminated resource does NOT appear in operational inventory (findAll, default)', async () => {
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/gone-1', status: 'terminated' });

    const { resources, total } = await resourcesRepo.findAll(orgId);

    expect(total).toBe(0);
    expect(resources).toHaveLength(0);
  });

  it('(3) terminated resources do not inflate operational resource counts (getStats.total_resources)', async () => {
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/active-2', status: 'running' });
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/gone-2', status: 'terminated' });
    await insertRow({ resource_arn: 'arn:aws:rds:us-east-1:*:db:gone-3', resource_type: 'rds', status: 'terminated' });

    const stats = await resourcesRepo.getStats(orgId);

    expect(stats.total_resources).toBe(1);
    expect(stats.by_type.ec2).toBe(1);
    expect(stats.by_type.rds).toBeUndefined();
    // by_status stays internally consistent with total_resources — no phantom
    // 'terminated' bucket counted alongside it.
    expect(stats.by_status.terminated).toBeUndefined();
    expect(Object.values(stats.by_status).reduce((a, b) => a + b, 0)).toBe(stats.total_resources);
  });

  it('(4) terminated resources do not inflate resource-derived current cost totals (getStats.total_monthly_cost)', async () => {
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/active-cost', status: 'running', estimated_monthly_cost: 100 });
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/gone-cost', status: 'terminated', estimated_monthly_cost: 9000 });

    const stats = await resourcesRepo.getStats(orgId);

    expect(stats.total_monthly_cost).toBe(100);
    expect(stats.cost_by_type.ec2).toBe(100);
  });

  it('(5) historical/audit queries can still see terminated resources via an explicit status filter', async () => {
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/active-3', status: 'running' });
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/gone-4', status: 'terminated' });

    const activeOnly = await resourcesRepo.findAll(orgId, { status: 'running' as any });
    const terminatedOnly = await resourcesRepo.findAll(orgId, { status: 'terminated' as any });

    expect(activeOnly.total).toBe(1);
    expect(activeOnly.resources[0].resource_arn).toBe('arn:aws:ec2:us-east-1:*:instance/active-3');
    expect(terminatedOnly.total).toBe(1);
    expect(terminatedOnly.resources[0].resource_arn).toBe('arn:aws:ec2:us-east-1:*:instance/gone-4');
  });

  it('(7) existing behavior for non-terminated resources is unchanged — every non-terminated status still appears by default', async () => {
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/running', status: 'running' });
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/stopped', status: 'stopped' });
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/pending', status: 'pending' });
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/unknown', status: 'unknown' });

    const { total } = await resourcesRepo.findAll(orgId);

    expect(total).toBe(4);
  });
});

describe('AI Chat context — current infrastructure must exclude terminated resources', () => {
  it('(6) getResourceData does not count a terminated resource as active infrastructure', async () => {
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/ai-active', resource_type: 'ec2', status: 'running' });
    await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/ai-gone', resource_type: 'ec2', status: 'terminated' });

    const resources = await (aiChatRepo as any).getResourceData(orgId);

    expect(resources.ec2.count).toBe(1);
  });

  it('(6) getResourceData omits a resource type whose only rows are terminated', async () => {
    await insertRow({ resource_arn: 'arn:aws:rds:us-east-1:*:db:ai-gone-rds', resource_type: 'rds', status: 'terminated' });

    const resources = await (aiChatRepo as any).getResourceData(orgId);

    expect(resources.rds).toBeUndefined();
  });

  it('(6) getServices does not list a resource_type whose only instances are terminated', async () => {
    await insertRow({ resource_arn: 'arn:aws:sns:us-east-1:*:topic/ai-gone-sns', resource_type: 'sns', status: 'terminated' });
    await insertRow({ resource_arn: 'arn:aws:sqs:us-east-1:*:queue/ai-active-sqs', resource_type: 'sqs', status: 'active' });

    const services = await (aiChatRepo as any).getServices(orgId);

    expect(services).toContain('sqs');
    expect(services).not.toContain('sns');
  });
});
