/**
 * AWS connect PR C (C-a): the connection lock key and the "no connection" rule.
 *
 * T-A7. The organization's connection lock key is hashed from the canonical
 * uuid text of its id, so the same organization locks the same key whatever
 * case or form the id was written in, and the key equals the database-side
 * form hashtextextended('aws_connection:' || <uuid>::text, 0). A value that
 * is not a uuid fails instead of locking an unrelated key.
 *
 * No connection is never a pass: a fence whose work started with no eligible
 * connection refuses before it locks or writes anything.
 *
 * Real Postgres, concurrent transactions on separate connections. Placeholders only.
 */
import { Pool, PoolClient } from 'pg';
import {
  AWS_CONNECTION_LOCK_KEY_SQL,
  ConnectionChangedError,
  assertConnectionUnchanged,
  currentConnectionIdentity,
  lockConnectionShared,
  withConnectionChange,
  withConnectionFence,
} from '../aws-connection-fence';
import { connectPlaceholderAccount, removePlaceholderAccounts } from './helpers/scan-source';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

const pool = new Pool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'platform_portal',
  user: process.env.DB_USER || 'postgres',
  password: process.env.DB_PASSWORD || 'postgres',
});
const createdOrgIds: string[] = [];

async function insertOrg(): Promise<string> {
  const suffix = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status) VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`Fence Key Org ${suffix}`, `fence-key-org-${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id;
}

/** Whether some backend is waiting for an advisory lock right now. */
async function someoneWaitsForAdvisoryLock(): Promise<boolean> {
  const { rows } = await pool.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND NOT granted`);
  return rows[0].n > 0;
}

async function until(condition: () => Promise<boolean>, what: string, ms = 10_000): Promise<void> {
  const deadline = Date.now() + ms;
  while (!(await condition())) {
    if (Date.now() > deadline) throw new Error(`timed out waiting for: ${what}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await removePlaceholderAccounts(pool, createdOrgIds);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('T-A7: the connection lock key is the canonical uuid form', () => {
  const ORG = '0a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
  const keyOf = async (value: string): Promise<string> =>
    (await pool.query(`SELECT (${AWS_CONNECTION_LOCK_KEY_SQL})::text AS key`, [value])).rows[0].key;

  it('lower-case, upper-case and braced ids give one key, equal to the database-side form over the uuid', async () => {
    const lower = await keyOf(ORG);
    expect(await keyOf(ORG.toUpperCase())).toBe(lower);
    expect(await keyOf(`{${ORG}}`)).toBe(lower);
    const dbSide = (await pool.query(`SELECT hashtextextended('aws_connection:' || $1::uuid::text, 0)::text AS key`, [ORG.toUpperCase()])).rows[0].key;
    expect(dbSide).toBe(lower);
    // And the hashed text is exactly the canonical lower-case uuid.
    const literal = (await pool.query(`SELECT hashtextextended('aws_connection:' || $1, 0)::text AS key`, [ORG])).rows[0].key;
    expect(literal).toBe(lower);
  });

  it('a value that is not a uuid fails (22P02) instead of locking an unrelated key', async () => {
    await expect(keyOf('not-a-uuid')).rejects.toMatchObject({ code: '22P02' });
  });

  it('an exclusive lock taken with the upper-case id blocks a shared lock taken with the lower-case id (one key)', async () => {
    const orgId = await insertOrg();
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    const change = withConnectionChange(pool, orgId.toUpperCase(), async () => {
      entered();
      await held;
    });
    await inside;
    const reader: PoolClient = await pool.connect();
    try {
      await reader.query('BEGIN');
      await reader.query(`SET LOCAL lock_timeout = 300`);
      await expect(lockConnectionShared(reader, orgId)).rejects.toMatchObject({ code: '55P03' });
      await reader.query('ROLLBACK');
    } finally {
      reader.release();
      release();
      await change;
    }
  });
});

describe('no connection is never a pass', () => {
  it('assertConnectionUnchanged refuses null (and empty) before taking any lock, even when the organization has no connection', async () => {
    const orgId = await insertOrg();
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      expect(await currentConnectionIdentity(client, orgId)).toBeNull();
      await expect(assertConnectionUnchanged(client, orgId, null)).rejects.toBeInstanceOf(ConnectionChangedError);
      await expect(assertConnectionUnchanged(client, orgId, '')).rejects.toBeInstanceOf(ConnectionChangedError);
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()`);
      expect(rows[0].n).toBe(0);
      await client.query('ROLLBACK');
    } finally {
      await client.query('ROLLBACK').catch(() => undefined);
      client.release();
    }
  });

  it('withConnectionFence with null never runs its body, so nothing is written', async () => {
    const orgId = await insertOrg();
    const body = jest.fn(async () => 'written');
    await expect(withConnectionFence(pool, orgId, null, body)).rejects.toBeInstanceOf(ConnectionChangedError);
    expect(body).not.toHaveBeenCalled();
  });

  it('a connected organization still passes with its own identity', async () => {
    const orgId = await insertOrg();
    await connectPlaceholderAccount(pool, orgId);
    const identity = await currentConnectionIdentity(pool, orgId);
    expect(identity).not.toBeNull();
    expect(await withConnectionFence(pool, orgId, identity, async () => 'written')).toBe('written');
  });

  it('concurrent: a fence that started while a connection change held the lock sees the change and refuses', async () => {
    const orgId = await insertOrg();
    await connectPlaceholderAccount(pool, orgId);
    const before = await currentConnectionIdentity(pool, orgId);
    let release!: () => void;
    const held = new Promise<void>((resolve) => (release = resolve));
    let entered!: () => void;
    const inside = new Promise<void>((resolve) => (entered = resolve));
    // The change: the org's row replaced by a new one (new id, so a new identity), committed only on release.
    const change = withConnectionChange(pool, orgId, async (c) => {
      const { rows } = await c.query(`DELETE FROM aws_accounts WHERE org_id = $1 RETURNING role_arn, account_id, region`, [orgId]);
      await c.query(
        `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, region, status) VALUES ($1, $2, $3, 'placeholder-external-id', $4, 'active')`,
        [orgId, rows[0].role_arn, rows[0].account_id, rows[0].region]
      );
      entered();
      await held;
    });
    await inside;
    const body = jest.fn(async () => 'written');
    const fenced = withConnectionFence(pool, orgId, before, body).catch((error: unknown) => error);
    try {
      await until(someoneWaitsForAdvisoryLock, 'the fence to wait for the connection lock');
      expect(body).not.toHaveBeenCalled();
    } finally {
      release();
      await change;
    }
    expect(await fenced).toBeInstanceOf(ConnectionChangedError);
    expect(body).not.toHaveBeenCalled();
  }, 30_000);
});
