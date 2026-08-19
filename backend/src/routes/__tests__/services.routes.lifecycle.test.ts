/**
 * Live-DB coverage for GET /api/services/:id's lifecycle boundary — the gap
 * left by 8d21ded ("exclude terminated resources from operational views"),
 * which fixed fetchServices() (list + /stats) but not this sibling detail
 * lookup. Before this fix, a terminated resource was still reachable by id
 * and mapStatus() mapped its raw lifecycle status (e.g. EC2 'terminated',
 * ECS 'inactive', RDS 'failed'/'deleting') to a fabricated 'critical' health
 * status, even though the resource no longer exists in AWS.
 *
 * Runs against the actual local dev Postgres instance, not mocked pg
 * clients — same rationale as aws-resources-lifecycle.test.ts and
 * resourceReconciliation.service.test.ts: the WHERE-clause semantics under
 * test are exactly what a JS-side mock would get wrong silently.
 */

import { Pool, PoolClient } from 'pg';
import { fetchServiceById, mapStatus } from '../services.routes';
import { pool as appPool } from '../../config/database';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});

let orgId: string;
let client: PoolClient;

async function insertRow(overrides: Partial<{
  resource_arn: string;
  resource_type: string;
  region: string;
  status: string;
}>) {
  const row = {
    resource_arn: 'arn:aws:ec2:us-east-1:*:instance/default',
    resource_type: 'ec2',
    region: 'us-east-1',
    status: 'running',
    ...overrides,
  };
  const { rows } = await client.query(
    `INSERT INTO aws_resources
       (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status)
     VALUES ($1, $2, $3, $3, $4, $5, $6)
     RETURNING id`,
    [orgId, row.resource_arn, row.resource_arn.split('/').pop(), row.resource_type, row.region, row.status]
  );
  return rows[0].id as string;
}

beforeAll(async () => {
  client = await pool.connect();
  const { rows } = await client.query(
    `INSERT INTO organizations (name, slug, display_name)
     VALUES ($1, $1, $1)
     RETURNING id`,
    [`services-detail-lifecycle-test-${Date.now()}`]
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
  // fetchServiceById() queries through the app-wide pool singleton (imported
  // transitively via services.routes.ts), not this file's own `pool` — close
  // it too so Jest doesn't report an open handle after this suite.
  await appPool.end();
});

describe('mapStatus — terminated/lifecycle to health-status translation', () => {
  it('maps a running EC2 instance to healthy', () => {
    expect(mapStatus('ec2', 'running')).toBe('healthy');
  });

  it('maps a terminated EC2 instance to critical (raw mapping — callers must exclude terminated upstream)', () => {
    // This documents mapStatus()'s own behavior is unchanged (fetchServices's
    // comment on the terminated->critical mapping still applies); the fix is
    // that fetchServiceById() below now never calls mapStatus with a
    // terminated row's status in the first place.
    expect(mapStatus('ec2', 'terminated')).toBe('critical');
  });
});

describe('fetchServiceById — GET /api/services/:id excludes terminated resources', () => {
  it('(1) an active resource is returned with its mapped status', async () => {
    const id = await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/active-1', status: 'running' });

    const service = await fetchServiceById(orgId, id);

    expect(service).not.toBeNull();
    expect(service!.status).toBe('healthy');
  });

  it('(2) a terminated resource is not returned at all — not a false "critical"', async () => {
    const id = await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/gone-1', status: 'terminated' });

    const service = await fetchServiceById(orgId, id);

    expect(service).toBeNull();
  });

  it('(3) a terminated ECS/RDS resource is also excluded, not just EC2', async () => {
    const ecsId = await insertRow({ resource_arn: 'arn:aws:ecs:us-east-1:*:service/gone-ecs', resource_type: 'ecs', status: 'terminated' });
    const rdsId = await insertRow({ resource_arn: 'arn:aws:rds:us-east-1:*:db:gone-rds', resource_type: 'rds', status: 'terminated' });

    expect(await fetchServiceById(orgId, ecsId)).toBeNull();
    expect(await fetchServiceById(orgId, rdsId)).toBeNull();
  });

  it('(4) a non-existent id returns null (existing behavior unchanged)', async () => {
    const service = await fetchServiceById(orgId, '00000000-0000-0000-0000-000000000000');
    expect(service).toBeNull();
  });

  it('(5) a resource from a different organization is not returned (org scoping unchanged)', async () => {
    const id = await insertRow({ resource_arn: 'arn:aws:ec2:us-east-1:*:instance/other-org', status: 'running' });

    const service = await fetchServiceById('00000000-0000-0000-0000-000000000000', id);

    expect(service).toBeNull();
  });
});
