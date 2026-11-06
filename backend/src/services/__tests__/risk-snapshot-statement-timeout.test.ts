/**
 * AWS connect PR C (C-a): the risk snapshot's fenced transaction carries the same
 * per-statement limit as every other connection-fenced transaction
 * (CONNECTION_FENCE_STATEMENT_TIMEOUT_MS), set with SET LOCAL so it ends with the
 * transaction and never leaks onto the pooled connection.
 *
 * Real Postgres: the timeout is read on the snapshot's own client from inside the
 * transaction (after the fence's lock and connection read). Placeholders only.
 */
import { Pool, PoolClient } from 'pg';
import { RiskTrackingService } from '../risk-tracking.service';
import { CONNECTION_FENCE_STATEMENT_TIMEOUT_MS } from '../aws-connection-fence';
import { connectPlaceholderAccount, removePlaceholderAccounts } from './helpers/scan-source';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const riskTracking = new RiskTrackingService(pool);
const createdOrgIds: string[] = [];

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Snapshot Timeout Org ${suffix}`, `snapshot-timeout-org-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id;
}

const timeoutMs = async (client: PoolClient): Promise<number> =>
  Number((await client.query(`SELECT EXTRACT(EPOCH FROM current_setting('statement_timeout')::interval) * 1000 AS ms`)).rows[0].ms);

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('risk snapshot: the fenced transaction has the connection-fence statement timeout', () => {
  it('inside the transaction the timeout is CONNECTION_FENCE_STATEMENT_TIMEOUT_MS; after it, the connection is back to its own value', async () => {
    const orgId = await insertOrg();
    await connectPlaceholderAccount(pool, orgId);
    const client = await pool.connect();
    try {
      await client.query("SELECT set_config('app.current_organization_id', $1, false)", [orgId]);
      const before = await timeoutMs(client);
      expect(before).not.toBe(CONNECTION_FENCE_STATEMENT_TIMEOUT_MS);
      let inside: number | undefined;
      jest.spyOn(riskTracking as any, 'storeDailySnapshotIn').mockImplementation(async (...args: unknown[]) => {
        inside = await timeoutMs(args[1] as PoolClient);
        return false;
      });
      expect(await riskTracking.storeDailySnapshot(orgId, client)).toBe(false);
      expect(inside).toBe(CONNECTION_FENCE_STATEMENT_TIMEOUT_MS);
      expect(await timeoutMs(client)).toBe(before);
    } finally {
      client.release();
    }
  });
});
