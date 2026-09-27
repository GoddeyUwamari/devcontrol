/**
 * Ask AI executor against real Postgres: the rewritten SQL runs against the
 * actual schema (the old services/deployments/alerts queries selected
 * columns that do not exist and always failed into "no data"), every
 * supported filter binds correctly, and results stay inside the requesting
 * organization even when another organization has matching rows.
 */
import { Pool } from 'pg';
import { pool as appPool } from '../../config/database';
import { NLQueryExecutorService } from '../nl-query-executor.service';
import type { NLQueryIntent } from '../nl-query.service';

const executor = new NLQueryExecutorService(appPool as unknown as Pool);
const orgIds: string[] = [];

const intent = (target: string, filters?: Record<string, unknown>): NLQueryIntent =>
  ({ target, action: 'filter', filters, explanation: '', confidence: 'high', period: 'none' } as unknown as NLQueryIntent);

function suffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(label: string): Promise<string> {
  const s = suffix();
  const { rows } = await appPool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'pro', 'active') RETURNING id`,
    [`NLQ ${label} ${s}`, `nlq-${label}-${s}`.toLowerCase()]
  );
  orgIds.push(rows[0].id);
  return rows[0].id;
}

async function insertResource(org: string, r: { type: string; status: string; region: string; cost: number | null; encrypted: boolean; backup: boolean; isPublic: boolean; name: string }) {
  const id = `${r.name}-${suffix()}`;
  await appPool.query(
    `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_name, resource_type, region, status,
                                estimated_monthly_cost, is_encrypted, has_backup, is_public)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
    [org, `arn:test:${id}`, id, r.name, r.type, r.region, r.status, r.cost, r.encrypted, r.backup, r.isPublic]
  );
}

async function insertService(org: string, name: string, status: string, template: string): Promise<string> {
  const { rows } = await appPool.query(
    `INSERT INTO services (name, template, owner, status, organization_id) VALUES ($1, $2, 'owner@test', $3, $4) RETURNING id`,
    [`${name}-${suffix()}`, template, status, org]
  );
  return rows[0].id;
}

async function insertDeployment(org: string, serviceId: string, env: string, status: string, daysAgo: number) {
  await appPool.query(
    `INSERT INTO deployments (service_id, environment, aws_region, status, deployed_by, deployed_at, organization_id)
     VALUES ($1, $2, 'us-east-1', $3, 'ci', NOW() - make_interval(days => $4), $5)`,
    [serviceId, env, status, daysAgo, org]
  );
}

let orgA: string;
let orgB: string;
let orgEmpty: string;

beforeAll(async () => {
  orgA = await insertOrg('a');
  orgB = await insertOrg('b');
  orgEmpty = await insertOrg('empty');

  await insertResource(orgA, { name: 'a-web', type: 'ec2', status: 'running', region: 'us-east-1', cost: 150, encrypted: true, backup: true, isPublic: false });
  await insertResource(orgA, { name: 'a-batch', type: 'ec2', status: 'stopped', region: 'us-west-2', cost: 20, encrypted: false, backup: false, isPublic: false });
  await insertResource(orgA, { name: 'a-db', type: 'rds', status: 'available', region: 'us-east-1', cost: 400, encrypted: false, backup: false, isPublic: true });
  await insertResource(orgA, { name: 'a-bucket', type: 's3', status: 'active', region: 'us-east-1', cost: null, encrypted: false, backup: false, isPublic: true });
  // Org B has rows that would match every org A query.
  await insertResource(orgB, { name: 'b-web', type: 'ec2', status: 'running', region: 'us-east-1', cost: 999, encrypted: false, backup: false, isPublic: true });

  const aApi = await insertService(orgA, 'a-api', 'active', 'api');
  await insertService(orgA, 'a-worker', 'failed', 'worker');
  const bApi = await insertService(orgB, 'b-api', 'failed', 'api');

  await insertDeployment(orgA, aApi, 'production', 'failed', 2);
  await insertDeployment(orgA, aApi, 'production', 'success', 40);
  await insertDeployment(orgA, aApi, 'staging', 'success', 1);
  await insertDeployment(orgB, bApi, 'production', 'failed', 1);
});

afterAll(async () => {
  await appPool.query('DELETE FROM deployments WHERE organization_id = ANY($1::uuid[])', [orgIds]);
  await appPool.query('DELETE FROM services WHERE organization_id = ANY($1::uuid[])', [orgIds]);
  await appPool.query('DELETE FROM aws_resources WHERE organization_id = ANY($1::uuid[])', [orgIds]);
  await appPool.query('DELETE FROM organizations WHERE id = ANY($1::uuid[])', [orgIds]);
  await appPool.end();
});

const names = (rows: any[], key: string) => rows.map(r => String(r[key]).replace(/-\d.*$/, '')).sort();

describe('infrastructure filters against the real schema', () => {
  it.each<[Record<string, unknown>, string[]]>([
    [{}, ['a-batch', 'a-bucket', 'a-db', 'a-web']],
    [{ resourceType: 'ec2' }, ['a-batch', 'a-web']],
    [{ status: 'stopped' }, ['a-batch']],
    [{ awsRegion: 'us-west-2' }, ['a-batch']],
    [{ costMin: 100 }, ['a-db', 'a-web']],
    [{ costMax: 50 }, ['a-batch']],
    [{ encrypted: false }, ['a-batch', 'a-bucket', 'a-db']],
    [{ encrypted: true }, ['a-web']],
    [{ hasBackup: false }, ['a-batch', 'a-bucket', 'a-db']],
    [{ publicAccess: true }, ['a-bucket', 'a-db']],
    [{ resourceType: 'rds', encrypted: false, publicAccess: true, costMin: 100 }, ['a-db']],
  ])('%j', async (filters, expected) => {
    const result = await executor.execute(intent('infrastructure', filters), orgA);
    expect(result.data.outcome).toBe('answered');
    expect(names(result.data.rows, 'resource_name')).toEqual(expected);
  });

  it('P0: never returns another organization\'s resources', async () => {
    const result = await executor.execute(intent('infrastructure', { resourceType: 'ec2', status: 'running' }), orgA);
    expect(names(result.data.rows, 'resource_name')).toEqual(['a-web']);
    expect(JSON.stringify(result)).not.toContain('b-web');
  });

  it('no match over an existing inventory is no_results; an org with no inventory is unavailable', async () => {
    expect((await executor.execute(intent('infrastructure', { resourceType: 'lambda' }), orgA)).data.outcome).toBe('no_results');
    expect((await executor.execute(intent('infrastructure', {}), orgEmpty)).data.outcome).toBe('unavailable');
  });
});

describe('services and deployments run against the real schema (previously always failed)', () => {
  it('services with status and template filters', async () => {
    const all = await executor.execute(intent('services', {}), orgA);
    expect(all.data.outcome).toBe('answered');
    expect(names(all.data.rows, 'name')).toEqual(['a-api', 'a-worker']);
    const failed = await executor.execute(intent('services', { status: 'failed' }), orgA);
    expect(names(failed.data.rows, 'name')).toEqual(['a-worker']);
    const api = await executor.execute(intent('services', { template: 'api', status: 'active' }), orgA);
    expect(names(api.data.rows, 'name')).toEqual(['a-api']);
  });

  it('deployments with status, environment, and date-range filters', async () => {
    const recentProdFailed = await executor.execute(intent('deployments', { environment: 'production', status: 'failed', dateRange: '7d' }), orgA);
    expect(recentProdFailed.data.outcome).toBe('answered');
    expect(recentProdFailed.data.rows).toHaveLength(1);
    expect(recentProdFailed.data.rows[0].service_name).toMatch(/^a-api-/);

    const last30 = await executor.execute(intent('deployments', { dateRange: '30d' }), orgA);
    expect(last30.data.rows).toHaveLength(2);
    const prod = await executor.execute(intent('deployments', { environment: 'production' }), orgA);
    expect(prod.data.rows).toHaveLength(2);
  });

  it('P0: org B\'s services and deployments never appear for org A', async () => {
    const services = await executor.execute(intent('services', { status: 'failed' }), orgA);
    const deployments = await executor.execute(intent('deployments', { status: 'failed' }), orgA);
    expect(JSON.stringify([services, deployments])).not.toMatch(/b-api/);
  });

  it('an organization with no services is no_results', async () => {
    expect((await executor.execute(intent('services', {}), orgEmpty)).data.outcome).toBe('no_results');
  });
});
