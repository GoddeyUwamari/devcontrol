/**
 * Home region HR-1 item 2, the change transaction under concurrency (T5):
 *
 *   - it takes the organization's connection lock EXCLUSIVE: a fenced writer
 *     already past its check (SHARED) is waited for; past the lock timeout the
 *     change is refused as busy with nothing changed;
 *   - every fenced writer that started for the OLD connection (the identity
 *     includes the home region) writes nothing after the change;
 *   - what was validated is checked again under the lock: a home region edited by
 *     hand meanwhile (compare-and-set) and a scan that started meanwhile both
 *     refuse the change, with nothing changed;
 *   - the region itself is the only aws_accounts column written.
 *
 * Live database, a dedicated pool as the connection source. Placeholders only.
 */
import { Pool, PoolClient } from 'pg';
import { changeHomeRegion, isHomeRegionChangeRefused } from '../home-region.service';
import { withConnectionFence, withConnectionFenceOn, isConnectionChanged } from '../aws-connection-fence';
import { awsConnectionIdentity } from '../../repositories/aws-accounts.repository';
import { ISSUE_EC2_IDLE_INSTANCE } from '../../config/optimization-rules';
import { SCAN_KIND_DISCOVERY } from '../scan-session';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];
const uniqueAccountId = () => String(100000000000 + Math.floor(Math.random() * 899999999999));

interface Fixture { orgId: string; userId: string; accountId: string; rowId: string }

async function fixture(): Promise<Fixture> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const orgId = (await pool.query(
    `INSERT INTO organizations (name, slug, display_name) VALUES ($1, $1, 'HR concurrency') RETURNING id`, [`hr-conc-${suffix}`])).rows[0].id;
  createdOrgIds.push(orgId);
  const userId = (await pool.query(`INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'HR') RETURNING id`, [`hr-conc-${suffix}@example.com`])).rows[0].id;
  const accountId = uniqueAccountId();
  const rowId = (await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, connected_at, status, nickname)
     VALUES ($1, $2, $3, 'placeholder-external-id', 'us-east-1', '2026-11-01T00:00:00Z', 'active', 'prod') RETURNING id`,
    [orgId, `arn:aws:iam::${accountId}:role/DevControlRole`, accountId])).rows[0].id;
  for (const region of ['us-east-1', 'us-west-2']) {
    await pool.query(
      `INSERT INTO aws_account_regions (organization_id, aws_account_id, region, opt_in_status, enabled, last_listed_at)
       VALUES ($1, $2, $3, 'opt-in-not-required', true, NOW())`, [orgId, accountId, region]);
  }
  await pool.query(
    `INSERT INTO cost_recommendations (organization_id, resource_id, resource_name, resource_type, issue, description, potential_savings, severity, aws_region, metadata)
     VALUES ($1, 'i-hr-a1', 'x', 'EC2', $2, 'placeholder', 1, 'LOW', 'us-east-1', '{}')`, [orgId, ISSUE_EC2_IDLE_INSTANCE]);
  return { orgId, userId, accountId, rowId };
}

const account = async (f: Fixture) => (await pool.query(
  `SELECT id, org_id, account_id, role_arn, external_id, region, nickname, status, connected_at FROM aws_accounts WHERE id = $1`, [f.rowId])).rows[0];
const activeRecs = async (f: Fixture) => (await pool.query(`SELECT count(*)::int AS n FROM cost_recommendations WHERE organization_id = $1`, [f.orgId])).rows[0].n;
const auditRows = async (f: Fixture) => (await pool.query(`SELECT count(*)::int AS n FROM audit_logs WHERE organization_id = $1`, [f.orgId])).rows[0].n;
const change = (f: Fixture, options: { lockTimeoutMs?: number } = {}) =>
  changeHomeRegion({ organizationId: f.orgId, actorId: f.userId, to: 'us-west-2', request: null }, pool, options);
const refusal = (error: unknown) => (isHomeRegionChangeRefused(error) ? error.refusal : error);

/** A fenced transaction for the organization's current connection, left open (SHARED connection lock held). */
async function holdShared(f: Fixture): Promise<{ client: PoolClient; finish: () => Promise<void> }> {
  const client = await pool.connect();
  // A test that fails while holding the lock must fail cleanly, never crash on a server-side timeout.
  client.on('error', () => undefined);
  let release!: () => void;
  const released = new Promise<void>((resolve) => { release = resolve; });
  let entered!: () => void;
  const inside = new Promise<void>((resolve) => { entered = resolve; });
  const done = withConnectionFenceOn(client, f.orgId, awsConnectionIdentity(await account(f)), async () => { entered(); await released; });
  await inside;
  return { client, finish: async () => { release(); await done; client.release(); } };
}

/** Waits until a session waits for THIS organization's connection lock (the change, blocked by the holder). */
async function waitForLockWaiter(f: Fixture): Promise<void> {
  for (let i = 0; i < 200; i++) {
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n
         FROM pg_locks l, (SELECT hashtextextended('aws_connection:' || $1::uuid::text, 0) AS k) key
        WHERE l.locktype = 'advisory' AND NOT l.granted AND l.objsubid = 1
          AND ((l.classid::bigint << 32) | l.objid::bigint) = key.k`,
      [f.orgId]
    );
    if (rows[0].n > 0) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error('no session ever waited for the connection lock');
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});
beforeEach(() => {
  jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());
afterAll(async () => {
  for (const table of ['cost_recommendations', 'aws_account_regions', 'aws_scan_leases', 'audit_logs', 'aws_connection_checks']) {
    await pool.query(`DELETE FROM ${table} WHERE organization_id = ANY($1)`, [createdOrgIds]);
  }
  await pool.query('DELETE FROM aws_accounts WHERE org_id = ANY($1)', [createdOrgIds]);
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.end();
});

describe('the change and the connection lock (T5)', () => {
  it('a fenced writer past its check holds the change off; past the lock timeout it is busy and nothing changed', async () => {
    const f = await fixture();
    const before = await account(f);
    const holder = await holdShared(f);
    try {
      expect(refusal(await change(f, { lockTimeoutMs: 200 }).catch((e) => e))).toBe('busy');
      expect(await account(f)).toEqual(before);
      expect(await activeRecs(f)).toBe(1);
      expect(await auditRows(f)).toBe(0);
    } finally {
      await holder.finish();
    }
    // Once the writer has committed, the change goes through.
    expect(await change(f)).toMatchObject({ from: 'us-east-1', to: 'us-west-2' });
  });

  it('the change waits for the writer, then commits; only the region column differs', async () => {
    const f = await fixture();
    const before = await account(f);
    const holder = await holdShared(f);
    const pending = change(f, { lockTimeoutMs: 10_000 }).catch((e) => e);
    try {
      await waitForLockWaiter(f);
      expect((await account(f)).region).toBe('us-east-1');
    } finally {
      await holder.finish();
    }
    expect(await pending).toMatchObject({ to: 'us-west-2' });
    expect(await account(f)).toEqual({ ...before, region: 'us-west-2' });
  });

  it('a writer that started for the old connection writes nothing after the change', async () => {
    const f = await fixture();
    const oldIdentity = awsConnectionIdentity(await account(f));
    await change(f);
    expect(awsConnectionIdentity(await account(f))).not.toBe(oldIdentity);
    const error = await withConnectionFence(pool, f.orgId, oldIdentity, async (client) => {
      await client.query(`UPDATE cost_recommendations SET description = 'stale write' WHERE organization_id = $1`, [f.orgId]);
    }).catch((e) => e);
    expect(isConnectionChanged(error)).toBe(true);
    expect((await pool.query(`SELECT count(*)::int AS n FROM cost_recommendations WHERE description = 'stale write' AND organization_id = $1`, [f.orgId])).rows[0].n).toBe(0);
  });
});

describe('validated, then checked again under the lock', () => {
  it('a home region edited by hand while the change waits: connection_changed, the edit stays, nothing removed, no audit', async () => {
    const f = await fixture();
    const holder = await holdShared(f);
    const pending = change(f, { lockTimeoutMs: 10_000 }).catch((e) => e);
    try {
      await waitForLockWaiter(f);
      await pool.query(`UPDATE aws_accounts SET region = 'eu-west-1' WHERE id = $1`, [f.rowId]);
    } finally {
      await holder.finish();
    }
    expect(refusal(await pending)).toBe('connection_changed');
    expect((await account(f)).region).toBe('eu-west-1');
    expect(await activeRecs(f)).toBe(1);
    expect(await auditRows(f)).toBe(0);
  });

  it('a scan that started while the change waits: scan_in_progress under the lock, nothing changed', async () => {
    const f = await fixture();
    const before = await account(f);
    const holder = await holdShared(f);
    const pending = change(f, { lockTimeoutMs: 10_000 }).catch((e) => e);
    try {
      await waitForLockWaiter(f);
      await pool.query(
        `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, acquired_at, heartbeat_at, expires_at)
         VALUES ($1, $2, $3, 'racing-scan', NOW(), NOW(), NOW() + interval '1 hour')`,
        [f.orgId, f.accountId, SCAN_KIND_DISCOVERY]
      );
    } finally {
      await holder.finish();
    }
    expect(refusal(await pending)).toBe('scan_in_progress');
    expect(await account(f)).toEqual(before);
    expect(await activeRecs(f)).toBe(1);
  });

  it('compare-and-set: a hand edit between the in-transaction re-read and the UPDATE refuses the change, nothing changed', async () => {
    const f = await fixture();
    // The change's own connections: just before its UPDATE of aws_accounts, the row is edited by hand
    // (autocommit, another connection, no connection lock), so the re-read passed and only the
    // compare-and-set can see the difference.
    const source = {
      connect: async () => {
        const client = await pool.connect();
        const query = client.query.bind(client) as (...args: any[]) => any;
        (client as any).query = async (...args: any[]) => {
          if (typeof args[0] === 'string' && /^\s*UPDATE aws_accounts SET region/.test(args[0])) {
            await pool.query(`UPDATE aws_accounts SET region = 'eu-west-1' WHERE id = $1`, [f.rowId]);
          }
          return query(...args);
        };
        const release = client.release.bind(client);
        (client as any).release = (err?: Error) => { (client as any).query = query; release(err); };
        return client;
      },
    };
    const result = await changeHomeRegion({ organizationId: f.orgId, actorId: f.userId, to: 'us-west-2', request: null }, source).catch((e) => e);
    expect(refusal(result)).toBe('connection_changed');
    expect((await account(f)).region).toBe('eu-west-1');
    expect(await activeRecs(f)).toBe(1);
    expect(await auditRows(f)).toBe(0);
  });

  it('a failure after the region moved (the audit insert) rolls everything back', async () => {
    const f = await fixture();
    const before = await account(f);
    const auditModule = await import('../auditEvents.service');
    jest.spyOn(auditModule, 'insertAuditEventInTransaction').mockRejectedValue(new Error('audit down'));
    await expect(change(f)).rejects.toThrow('audit down');
    expect(await account(f)).toEqual(before);
    expect(await activeRecs(f)).toBe(1);
  });
});
