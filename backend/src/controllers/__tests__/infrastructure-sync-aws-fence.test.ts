/**
 * AWS connect PR C (C-a): POST /api/infrastructure/sync-aws writes the
 * organization's Cost Explorer total (infrastructure_resources row
 * aws_id 'cost-explorer-total', resource_type 'AWS_COST_TOTAL') only inside a
 * transaction fenced on the connection whose credentials fetched it.
 *
 *   - no eligible connection: 409 NOT_CONNECTED with the approved text, nothing written;
 *   - the connection changed after the fetch: 409, nothing written;
 *   - concurrent: a connection change holding the lock makes the write wait, and
 *     after it commits the write is refused;
 *   - unchanged connection: the row is written.
 *
 * The write is exercised through its UPDATE path (an existing row): the INSERT
 * path's NULL service_id is refused by the repository schema's NOT NULL on
 * infrastructure_resources.service_id, unrelated to the fence. Cost Explorer is
 * stubbed; the database is real. Placeholders only.
 */
import { Pool } from 'pg';
import { Request, Response } from 'express';
import { InfrastructureController } from '../infrastructure.controller';
import awsCostService from '../../services/aws-cost.service';
import { currentConnectionIdentity, withConnectionChange } from '../../services/aws-connection-fence';
import { AWS_NOT_CONNECTED_CODE, AWS_NOT_CONNECTED_MESSAGE } from '../../services/aws-connection-messages';
import { connectPlaceholderAccount, removePlaceholderAccounts } from '../../services/__tests__/helpers/scan-source';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const controller = new InfrastructureController();
const createdOrgIds: string[] = [];
const savedRegion = process.env.AWS_REGION;

const COSTS = { total: 12.34, period: { start: '2026-11-01', end: '2026-11-05' }, byService: [], fetchedAt: '2026-11-05T00:00:00.000Z' } as any;

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Sync AWS Org ${suffix}`, `sync-aws-org-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id;
}

/** The org's existing cost-total row (the UPDATE path), with a stale value. */
async function seedCostRow(orgId: string): Promise<void> {
  const service = await pool.query(
    `INSERT INTO services (name, template, owner, organization_id) VALUES ('sync-aws-fixture', 'api', 'owner', $1) RETURNING id`,
    [orgId]
  );
  await pool.query(
    `INSERT INTO infrastructure_resources (service_id, resource_type, aws_id, aws_region, status, cost_per_month, metadata, organization_id)
     VALUES ($1, 'AWS_COST_TOTAL', 'cost-explorer-total', 'us-east-1', 'Active', 1.00, '{}', $2)`,
    [service.rows[0].id, orgId]
  );
}

async function costRow(orgId: string): Promise<{ cost: string } | undefined> {
  const { rows } = await pool.query(
    `SELECT cost_per_month::text AS cost FROM infrastructure_resources WHERE organization_id = $1 AND aws_id = 'cost-explorer-total' AND resource_type = 'AWS_COST_TOTAL'`,
    [orgId]
  );
  return rows[0];
}

/** B becomes active: the org's row replaced by one that differs only in its id (a new identity). */
async function replaceRow(c: { query: Pool['query'] }, orgId: string): Promise<void> {
  const { rows } = await c.query(`DELETE FROM aws_accounts WHERE org_id = $1 RETURNING role_arn, account_id, region`, [orgId]);
  await c.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status) VALUES ($1, $2, $3, 'placeholder-external-id', $4, 'active')`,
    [orgId, rows[0].role_arn, rows[0].account_id, rows[0].region]
  );
}

async function sync(orgId: string): Promise<{ status: number; body: any }> {
  const out = { status: 200, body: undefined as any };
  const res = {
    status(code: number) { out.status = code; return this; },
    json(body: unknown) { out.body = body; return this; },
  } as unknown as Response;
  await controller.syncAWS({ user: { organizationId: orgId } } as unknown as Request, res);
  return out;
}

async function until(condition: () => Promise<boolean>, what: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeAll(async () => {
  process.env.AWS_REGION = 'us-east-1';
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  if (savedRegion === undefined) delete process.env.AWS_REGION;
  else process.env.AWS_REGION = savedRegion;
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM infrastructure_resources WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM services WHERE organization_id = ANY($1)', [createdOrgIds]);
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('sync-aws: the cost total is written only under the connection fence', () => {
  it('no eligible connection: 409 NOT_CONNECTED with the approved text, and nothing is written', async () => {
    const orgId = await insertOrg();
    await seedCostRow(orgId);
    const result = await sync(orgId);
    expect(result).toEqual({ status: 409, body: { success: false, code: AWS_NOT_CONNECTED_CODE, error: AWS_NOT_CONNECTED_MESSAGE } });
    expect(AWS_NOT_CONNECTED_MESSAGE).toBe('No AWS account is connected.');
    expect(await costRow(orgId)).toEqual({ cost: '1.00' });
  });

  it('unchanged connection: the row is written', async () => {
    const orgId = await insertOrg();
    await connectPlaceholderAccount(pool, orgId);
    await seedCostRow(orgId);
    const identity = await currentConnectionIdentity(pool, orgId);
    jest.spyOn(awsCostService, 'fetchMonthlyCostsWithConnection').mockResolvedValue({ costs: COSTS, connection: identity! });
    const result = await sync(orgId);
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ success: true, data: { resourcesSynced: 1, totalCost: 12.34 } });
    expect(await costRow(orgId)).toEqual({ cost: '12.34' });
  });

  it('the connection changed after the costs were fetched: 409, and nothing is written', async () => {
    const orgId = await insertOrg();
    await connectPlaceholderAccount(pool, orgId);
    await seedCostRow(orgId);
    const stale = await currentConnectionIdentity(pool, orgId);
    jest.spyOn(awsCostService, 'fetchMonthlyCostsWithConnection').mockImplementation(async () => {
      await withConnectionChange(pool, orgId, (c) => replaceRow(c, orgId));
      return { costs: COSTS, connection: stale! };
    });
    const result = await sync(orgId);
    expect(result).toEqual({ status: 409, body: { success: false, code: AWS_NOT_CONNECTED_CODE, error: AWS_NOT_CONNECTED_MESSAGE } });
    expect(await costRow(orgId)).toEqual({ cost: '1.00' });
  });

  it('concurrent: a change holding the connection lock makes the write wait; after it commits, the write is refused', async () => {
    const orgId = await insertOrg();
    await connectPlaceholderAccount(pool, orgId);
    await seedCostRow(orgId);
    const stale = await currentConnectionIdentity(pool, orgId);
    jest.spyOn(awsCostService, 'fetchMonthlyCostsWithConnection').mockResolvedValue({ costs: COSTS, connection: stale! });

    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const change = withConnectionChange(pool, orgId, async (c) => {
      await replaceRow(c, orgId);
      entered();
      await held;
    });
    await inside;

    let settled = false;
    const pending = sync(orgId).then((result) => { settled = true; return result; });
    try {
      await until(async () => settled || (await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`)).rows[0].n > 0, 'the sync write to wait for the connection lock');
      expect(settled).toBe(false);
    } finally {
      release();
      await change;
    }
    const result = await pending;
    expect(result).toEqual({ status: 409, body: { success: false, code: AWS_NOT_CONNECTED_CODE, error: AWS_NOT_CONNECTED_MESSAGE } });
    expect(await costRow(orgId)).toEqual({ cost: '1.00' });
  }, 30_000);
});
