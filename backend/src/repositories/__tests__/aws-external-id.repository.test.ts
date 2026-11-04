/**
 * The organization's stable External ID (aws-external-id.repository.ts) against
 * a real database with admin migration 202611031200 applied: precedence, malformed
 * values, concurrency, immutability, and the application role's row-level
 * security and grants.
 */
import { Pool } from 'pg';
import {
  generateExternalId,
  isWellFormedExternalId,
  resolveOrganizationExternalId,
} from '../aws-external-id.repository';
import { ensureSharedFixtureTable } from '../../routes/__tests__/shared-fixture-tables';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];

function suffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
function accountId(): string {
  return String(100000000000 + Math.floor(Math.random() * 899999999999));
}

async function insertOrg(): Promise<string> {
  const s = suffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $1, 'free', 'free') RETURNING id`,
    [`ExtId Org ${s}`, `extid-org-${s}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id;
}

async function insertAccount(orgId: string, externalId: string | null, status: string, connectedAt = 'NOW()'): Promise<void> {
  const id = accountId();
  await pool.query(
    `INSERT INTO aws_accounts (org_id, role_arn, account_id, external_id, status, connected_at)
     VALUES ($1, $2, $3, $4, $5, ${connectedAt})`,
    [orgId, `arn:aws:iam::${id}:role/DevControlRole`, id, externalId, status]
  );
}

async function insertSession(orgId: string, externalId: string, expired: boolean): Promise<void> {
  await pool.query(
    `INSERT INTO aws_connect_sessions (org_id, external_id, expires_at)
     VALUES ($1, $2, NOW() + ($3 || ' hours')::interval)`,
    [orgId, externalId, expired ? '-48' : '1']
  );
}

async function storedRow(orgId: string) {
  const { rows } = await pool.query(`SELECT external_id, source FROM aws_org_external_ids WHERE organization_id = $1`, [orgId]);
  return rows[0] as { external_id: string; source: string } | undefined;
}

beforeAll(async () => {
  await ensureSharedFixtureTable(pool, 'aws_accounts');
  await ensureSharedFixtureTable(pool, 'aws_connect_sessions');
});

afterAll(async () => {
  for (const table of ['aws_accounts', 'aws_connect_sessions']) {
    await pool.query(`DELETE FROM ${table} WHERE org_id = ANY($1)`, [createdOrgIds]);
  }
  // aws_org_external_ids rows go with their organization (ON DELETE CASCADE).
  await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  await pool.end();
});

describe('generateExternalId / isWellFormedExternalId', () => {
  it('generates 32 base64url characters, all different', () => {
    const values = new Set(Array.from({ length: 50 }, generateExternalId));
    expect(values.size).toBe(50);
    for (const v of values) expect(v).toMatch(/^[A-Za-z0-9_-]{32}$/);
  });
  it.each([
    ['ext-123', true], ['a', false], ['', false], ['has space', false], ['x'.repeat(65), false],
    ['ok+=,.@:/_-AZaz09', true], [null, false],
  ])('%p well-formed: %p', (value, expected) => {
    expect(isWellFormedExternalId(value)).toBe(expected);
  });
});

describe('resolveOrganizationExternalId: precedence', () => {
  it('a connection value AWS already trusts wins over a session value', async () => {
    const orgId = await insertOrg();
    await insertAccount(orgId, 'Conn_Trusted-111', 'active');
    await insertSession(orgId, 'Session_Value-222', false);
    expect(await resolveOrganizationExternalId(pool, orgId)).toBe('Conn_Trusted-111');
    expect(await storedRow(orgId)).toEqual({ external_id: 'Conn_Trusted-111', source: 'connection' });
  });

  it('an inactive connection value is still preferred to a session value', async () => {
    const orgId = await insertOrg();
    await insertAccount(orgId, 'Conn_Inactive-333', 'inactive');
    await insertSession(orgId, 'Session_Value-444', false);
    expect(await resolveOrganizationExternalId(pool, orgId)).toBe('Conn_Inactive-333');
  });

  it('a missing or malformed connection value is skipped, never copied: the session value is used', async () => {
    const orgId = await insertOrg();
    await insertAccount(orgId, 'bad value with spaces', 'active');
    await insertSession(orgId, 'Session_Value-555', false);
    expect(await resolveOrganizationExternalId(pool, orgId)).toBe('Session_Value-555');
    expect((await storedRow(orgId))!.source).toBe('session');

    const nullOrg = await insertOrg();
    await insertAccount(nullOrg, null, 'active');
    await insertSession(nullOrg, 'Session_Value-556', false);
    expect(await resolveOrganizationExternalId(pool, nullOrg)).toBe('Session_Value-556');
  });

  it('an EXPIRED session value is adopted: the customer may already have used it', async () => {
    const orgId = await insertOrg();
    await insertSession(orgId, 'Expired_Session-666', true);
    expect(await resolveOrganizationExternalId(pool, orgId)).toBe('Expired_Session-666');
  });

  it('with no source a value is generated, recorded once, and returned on every later call', async () => {
    const orgId = await insertOrg();
    const first = await resolveOrganizationExternalId(pool, orgId);
    expect(first).toMatch(/^[A-Za-z0-9_-]{32}$/);
    expect((await storedRow(orgId))!.source).toBe('generated');
    for (let i = 0; i < 3; i++) expect(await resolveOrganizationExternalId(pool, orgId)).toBe(first);
  });

  it('a recorded value is never replaced, even when a later connection holds another value', async () => {
    const orgId = await insertOrg();
    const first = await resolveOrganizationExternalId(pool, orgId);
    await insertAccount(orgId, 'Later_Conn-777', 'active');
    expect(await resolveOrganizationExternalId(pool, orgId)).toBe(first);
  });

  it('concurrent first visits agree on one value', async () => {
    const orgId = await insertOrg();
    const values = await Promise.all(Array.from({ length: 6 }, () => resolveOrganizationExternalId(pool, orgId)));
    expect(new Set(values).size).toBe(1);
  });

  it('a missing legacy source table is skipped, not fatal', async () => {
    const calls: string[] = [];
    const undefinedTable = Object.assign(new Error('relation does not exist'), { code: '42P01' });
    const db = {
      query: jest.fn(async (text: string) => {
        calls.push(text);
        if (/FROM aws_accounts|FROM aws_connect_sessions/.test(text)) throw undefinedTable;
        if (/^SELECT external_id FROM aws_org_external_ids/.test(text.trim())) {
          return { rows: calls.filter((c) => c.includes('INSERT INTO aws_org_external_ids')).length ? [{ external_id: 'generated-value-xx' }] : [] };
        }
        return { rows: [] };
      }),
    };
    expect(await resolveOrganizationExternalId(db, '00000000-0000-4000-8000-000000000001')).toBe('generated-value-xx');
    const insert = db.query.mock.calls.find(([t]) => (t as string).includes('INSERT INTO aws_org_external_ids')) as unknown as [string, unknown[]];
    expect(insert[1][2]).toBe('generated');
  });

  it('any other database error is thrown to the caller', async () => {
    const db = { query: jest.fn().mockRejectedValue(Object.assign(new Error('connection reset'), { code: '08006' })) };
    await expect(resolveOrganizationExternalId(db, '00000000-0000-4000-8000-000000000002')).rejects.toThrow('connection reset');
  });
});

describe('aws_org_external_ids: immutability, RLS and grants', () => {
  it('refuses UPDATE even for the table owner (trigger)', async () => {
    const orgId = await insertOrg();
    await resolveOrganizationExternalId(pool, orgId);
    await expect(
      pool.query(`UPDATE aws_org_external_ids SET external_id = 'Rotated-000' WHERE organization_id = $1`, [orgId])
    ).rejects.toThrow(/immutable/);
  });

  it('the CHECK refuses a malformed value', async () => {
    const orgId = await insertOrg();
    await expect(
      pool.query(`INSERT INTO aws_org_external_ids (organization_id, external_id, source) VALUES ($1, 'bad value', 'generated')`, [orgId])
    ).rejects.toThrow(/check constraint/);
  });

  it('as devcontrol: sees only its tagged organization, may insert for it, and may not update or delete', async () => {
    const mine = await insertOrg();
    const other = await insertOrg();
    await resolveOrganizationExternalId(pool, other);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query('SET LOCAL ROLE devcontrol');
      await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [mine]);
      // The application role inserts its own organization's row (as the
      // repository does) and reads it back.
      await client.query(
        `INSERT INTO aws_org_external_ids (organization_id, external_id, source) VALUES ($1, $2, 'generated')
         ON CONFLICT (organization_id) DO NOTHING`, [mine, generateExternalId()]
      );

      const visible = await client.query(`SELECT organization_id FROM aws_org_external_ids`);
      expect(visible.rows.map((r) => r.organization_id)).toEqual([mine]);

      await client.query('SAVEPOINT s1');
      await expect(client.query(`UPDATE aws_org_external_ids SET source = 'session' WHERE organization_id = $1`, [mine]))
        .rejects.toThrow(/permission denied/);
      await client.query('ROLLBACK TO SAVEPOINT s1');
      await expect(client.query(`DELETE FROM aws_org_external_ids WHERE organization_id = $1`, [mine]))
        .rejects.toThrow(/permission denied/);
      await client.query('ROLLBACK TO SAVEPOINT s1');
      await expect(client.query(
        `INSERT INTO aws_org_external_ids (organization_id, external_id, source) VALUES ($1, 'Cross_Tenant-1', 'generated')`, [other]
      )).rejects.toThrow(/row-level security/);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
