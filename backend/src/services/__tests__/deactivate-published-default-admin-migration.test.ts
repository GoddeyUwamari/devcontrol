/**
 * Live-Postgres coverage for
 * database/migrations/202610161200_deactivate_published_default_admin.sql.
 *
 * Executes the real migration read from disk. The default admin is created by
 * migrations-admin/005's own STEP 1-3 text (extracted by marker, not retyped),
 * so the published password hash never appears in this file either: tests that
 * need a second copy of it copy it from the row 005 inserted.
 *
 * Every test runs inside ONE transaction that is always rolled back, in an
 * isolated schema holding the four tables 005 and this migration touch, shaped
 * like migrations-admin/004. A no-op is proven by ctid: any UPDATE of a row,
 * even one that writes the same values, gives it a new ctid.
 *
 * The "CI bootstrap" block assumes a database bootstrapped by
 * .github/scripts/ci-bootstrap-schema.js, which is what CI's backend test step
 * runs against (run locally against a scratch database bootstrapped the same
 * way).
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const { getMigrationFiles } = require('../../../../database/migrate.js');

const REPO_ROOT = path.join(__dirname, '../../../..');
const MIGRATIONS_DIR = path.join(REPO_ROOT, 'database/migrations');
const ADMIN_DIR = path.join(REPO_ROOT, 'database/migrations-admin');
const MIGRATION_FILE = '202610161200_deactivate_published_default_admin.sql';
const M005 = '005_migrate_existing_data.sql';

const MIGRATION_SQL = fs.readFileSync(path.join(MIGRATIONS_DIR, MIGRATION_FILE), 'utf8');
const M005_SQL = fs.readFileSync(path.join(ADMIN_DIR, M005), 'utf8');

const DEFAULT_ORG_ID = '00000000-0000-0000-0000-000000000001';
const DEFAULT_ADMIN_ID = '00000000-0000-0000-0000-000000000002';
const SCHEMA = 'default_admin_migration_test';

/** 005's STEP 1 (default organization) through STEP 3 (owner membership). */
function m005DefaultAdminSteps(): string {
  const start = M005_SQL.indexOf('-- STEP 1: CREATE DEFAULT ORGANIZATION');
  const end = M005_SQL.indexOf('-- STEP 4: MIGRATE EXISTING DATA');
  if (start === -1 || end === -1 || end < start) throw new Error('Could not locate STEP 1-3 in migration 005');
  return M005_SQL.slice(start, end);
}

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

/** The columns 005 writes and this migration reads or writes, as in 004. */
async function createFixture(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL,
      slug VARCHAR(100) NOT NULL UNIQUE,
      display_name VARCHAR(255),
      description TEXT,
      subscription_tier VARCHAR(50) DEFAULT 'free',
      max_services INTEGER,
      max_users INTEGER,
      max_deployments_per_month INTEGER,
      is_active BOOLEAN DEFAULT true,
      settings JSONB DEFAULT '{}'
    )
  `);
  await client.query(`
    CREATE TABLE users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      full_name VARCHAR(255) NOT NULL,
      is_active BOOLEAN DEFAULT true,
      is_email_verified BOOLEAN DEFAULT false,
      created_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW()
    )
  `);
  await client.query(`
    CREATE TABLE organization_memberships (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      role VARCHAR(50) NOT NULL DEFAULT 'member',
      joined_at TIMESTAMP WITH TIME ZONE,
      is_active BOOLEAN DEFAULT true,
      updated_at TIMESTAMP WITH TIME ZONE DEFAULT NOW(),
      UNIQUE (organization_id, user_id)
    )
  `);
  await client.query(`
    CREATE TABLE sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      access_token_hash TEXT NOT NULL,
      refresh_token_hash TEXT NOT NULL,
      access_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      refresh_token_expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
      is_active BOOLEAN DEFAULT true,
      revoked_at TIMESTAMP WITH TIME ZONE
    )
  `);
}

async function addSession(client: Client, userId: string): Promise<void> {
  await client.query(
    `INSERT INTO sessions (user_id, access_token_hash, refresh_token_hash, access_token_expires_at, refresh_token_expires_at)
     VALUES ($1, 'fixture-access', 'fixture-refresh', NOW() + interval '1 hour', NOW() + interval '1 day')`,
    [userId]
  );
}

/** A second user holding 005's published hash, copied from the row 005 inserted. */
async function addUserWithPublishedHash(client: Client): Promise<string> {
  const { rows } = await client.query(
    `INSERT INTO users (email, password_hash, full_name, is_active)
     SELECT 'second-user@example.test', password_hash, 'Second User', true FROM users WHERE id = $1
     RETURNING id`,
    [DEFAULT_ADMIN_ID]
  );
  const id = rows[0].id as string;
  await client.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role, is_active) VALUES ($1, $2, 'owner', true)`,
    [DEFAULT_ORG_ID, id]
  );
  await addSession(client, id);
  return id;
}

interface UserState {
  user: { is_active: boolean; ctid: string };
  memberships: Array<{ is_active: boolean; ctid: string }>;
  sessions: Array<{ is_active: boolean; revoked: boolean; ctid: string }>;
}

async function stateOf(client: Client, userId: string): Promise<UserState> {
  const user = await client.query('SELECT is_active, ctid::text FROM users WHERE id = $1', [userId]);
  const memberships = await client.query(
    'SELECT is_active, ctid::text FROM organization_memberships WHERE user_id = $1 ORDER BY id',
    [userId]
  );
  const sessions = await client.query(
    'SELECT is_active, revoked_at IS NOT NULL AS revoked, ctid::text FROM sessions WHERE user_id = $1 ORDER BY id',
    [userId]
  );
  return { user: user.rows[0], memberships: memberships.rows, sessions: sessions.rows };
}

let client: Client;

beforeAll(async () => {
  client = new Client(dbConfig());
  await client.connect();
});

afterAll(async () => {
  await client.end();
});

/** BEGIN; isolated schema + fixture + 005 STEP 1-3; fn(); ROLLBACK -- always rolled back. */
async function withDefaultAdmin(fn: () => Promise<void>) {
  await client.query('BEGIN');
  try {
    await client.query(`CREATE SCHEMA ${SCHEMA}`);
    await client.query(`SET LOCAL search_path TO ${SCHEMA}`);
    await createFixture(client);
    await client.query(m005DefaultAdminSteps());
    await fn();
  } finally {
    await client.query('ROLLBACK');
  }
}

describe('file contents and runner selection (no database writes)', () => {
  it('is an ordinary migration the runner selects, sorting after 005 in the merged CI sweep', () => {
    expect(getMigrationFiles(MIGRATIONS_DIR)).toContain(MIGRATION_FILE);
    expect([M005, MIGRATION_FILE].sort()).toEqual([M005, MIGRATION_FILE]);
  });

  it('contains neither the published hash nor the password, only a SHA-256 digest', () => {
    const hashLiteral = M005_SQL.match(/'(\$2[aby]\$[^']*)'/);
    const password = M005_SQL.match(/bcrypt hash of '([^']+)'/);
    expect(hashLiteral).not.toBeNull();
    expect(password).not.toBeNull();
    expect(MIGRATION_SQL.includes(hashLiteral![1])).toBe(false);
    expect(MIGRATION_SQL.includes(password![1])).toBe(false);
    expect(MIGRATION_SQL).not.toMatch(/\$2[aby]\$/);
    expect(MIGRATION_SQL).toMatch(/published_hash_sha256 CONSTANT TEXT := '[0-9a-f]{64}'/);
  });

  it('does not edit 005', () => {
    expect(M005_SQL).toContain("'00000000-0000-0000-0000-000000000002', -- Fixed UUID for default admin");
  });
});

describe('guarded deactivation (isolated schema, rolled back)', () => {
  it('fresh 005 state: deactivates the user, its membership and its sessions', async () => {
    await withDefaultAdmin(async () => {
      await addSession(client, DEFAULT_ADMIN_ID);
      await addSession(client, DEFAULT_ADMIN_ID);
      const before = await stateOf(client, DEFAULT_ADMIN_ID);
      expect(before.user.is_active).toBe(true);
      expect(before.memberships).toHaveLength(1);
      expect(before.memberships[0].is_active).toBe(true);
      expect(before.sessions.map((s) => s.is_active)).toEqual([true, true]);

      await client.query(MIGRATION_SQL);

      const after = await stateOf(client, DEFAULT_ADMIN_ID);
      expect(after.user.is_active).toBe(false);
      expect(after.memberships.map((m) => m.is_active)).toEqual([false]);
      expect(after.sessions.map((s) => [s.is_active, s.revoked])).toEqual([[false, true], [false, true]]);
    });
  });

  it('second run is a no-op: no row is rewritten', async () => {
    await withDefaultAdmin(async () => {
      await addSession(client, DEFAULT_ADMIN_ID);
      await client.query(MIGRATION_SQL);
      const afterFirst = await stateOf(client, DEFAULT_ADMIN_ID);

      await client.query(MIGRATION_SQL);

      expect(await stateOf(client, DEFAULT_ADMIN_ID)).toEqual(afterFirst);
    });
  });

  it('changed password hash: nothing is changed', async () => {
    await withDefaultAdmin(async () => {
      await addSession(client, DEFAULT_ADMIN_ID);
      await client.query(`UPDATE users SET password_hash = password_hash || 'changed' WHERE id = $1`, [DEFAULT_ADMIN_ID]);
      const before = await stateOf(client, DEFAULT_ADMIN_ID);

      await client.query(MIGRATION_SQL);

      const after = await stateOf(client, DEFAULT_ADMIN_ID);
      expect(after).toEqual(before);
      expect(after.user.is_active).toBe(true);
    });
  });

  it('production case -- user already inactive, membership and session still active: nothing is touched', async () => {
    await withDefaultAdmin(async () => {
      await addSession(client, DEFAULT_ADMIN_ID);
      await client.query('UPDATE users SET is_active = false WHERE id = $1', [DEFAULT_ADMIN_ID]);
      const before = await stateOf(client, DEFAULT_ADMIN_ID);
      expect(before.memberships[0].is_active).toBe(true);
      expect(before.sessions[0].is_active).toBe(true);

      await client.query(MIGRATION_SQL);

      expect(await stateOf(client, DEFAULT_ADMIN_ID)).toEqual(before);
    });
  });

  it('another user holding the same published hash is untouched', async () => {
    await withDefaultAdmin(async () => {
      const otherId = await addUserWithPublishedHash(client);
      const otherBefore = await stateOf(client, otherId);

      await client.query(MIGRATION_SQL);

      expect(await stateOf(client, otherId)).toEqual(otherBefore);
      expect((await stateOf(client, DEFAULT_ADMIN_ID)).user.is_active).toBe(false);
    });
  });

  it('another user holding the same hash is untouched even when the default admin is already inactive', async () => {
    await withDefaultAdmin(async () => {
      const otherId = await addUserWithPublishedHash(client);
      await client.query('UPDATE users SET is_active = false WHERE id = $1', [DEFAULT_ADMIN_ID]);
      const otherBefore = await stateOf(client, otherId);

      await client.query(MIGRATION_SQL);

      expect(await stateOf(client, otherId)).toEqual(otherBefore);
    });
  });

  it('no users table: a no-op, not an error', async () => {
    await client.query('BEGIN');
    try {
      await client.query(`CREATE SCHEMA ${SCHEMA}`);
      await client.query(`SET LOCAL search_path TO ${SCHEMA}`);
      await expect(client.query(MIGRATION_SQL)).resolves.toBeDefined();
    } finally {
      await client.query('ROLLBACK');
    }
  });
});

describe('CI bootstrap (rolled back, read-only)', () => {
  it('the fixture has every column the migration uses, with the bootstrapped types', async () => {
    const { rows } = await client.query(`
      SELECT table_name, column_name, data_type
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND (table_name, column_name) IN (
           ('users', 'id'), ('users', 'is_active'), ('users', 'password_hash'), ('users', 'updated_at'),
           ('organization_memberships', 'user_id'), ('organization_memberships', 'is_active'),
           ('organization_memberships', 'updated_at'),
           ('sessions', 'user_id'), ('sessions', 'is_active'), ('sessions', 'revoked_at'))
       ORDER BY 1, 2
    `);
    expect(rows).toEqual([
      { table_name: 'organization_memberships', column_name: 'is_active', data_type: 'boolean' },
      { table_name: 'organization_memberships', column_name: 'updated_at', data_type: 'timestamp with time zone' },
      { table_name: 'organization_memberships', column_name: 'user_id', data_type: 'uuid' },
      { table_name: 'sessions', column_name: 'is_active', data_type: 'boolean' },
      { table_name: 'sessions', column_name: 'revoked_at', data_type: 'timestamp with time zone' },
      { table_name: 'sessions', column_name: 'user_id', data_type: 'uuid' },
      { table_name: 'users', column_name: 'id', data_type: 'uuid' },
      { table_name: 'users', column_name: 'is_active', data_type: 'boolean' },
      { table_name: 'users', column_name: 'password_hash', data_type: 'text' },
      { table_name: 'users', column_name: 'updated_at', data_type: 'timestamp with time zone' },
    ]);
  });

  it('a freshly bootstrapped database has the default admin, its membership and its sessions inactive, and recorded the migration', async () => {
    await client.query('BEGIN READ ONLY');
    try {
      const { rows } = await client.query(
        `SELECT (SELECT count(*) FROM users WHERE id = $1)::int AS users,
                (SELECT count(*) FROM users WHERE id = $1 AND is_active)::int AS active_users,
                (SELECT count(*) FROM organization_memberships WHERE user_id = $1)::int AS memberships,
                (SELECT count(*) FROM organization_memberships WHERE user_id = $1 AND is_active)::int AS active_memberships,
                (SELECT count(*) FROM sessions WHERE user_id = $1 AND is_active)::int AS active_sessions,
                (SELECT count(*) FROM schema_migrations WHERE migration_name = $2)::int AS ledger`,
        [DEFAULT_ADMIN_ID, MIGRATION_FILE]
      );
      expect(rows[0]).toEqual({
        users: 1, active_users: 0, memberships: 1, active_memberships: 0, active_sessions: 0, ledger: 1,
      });
    } finally {
      await client.query('ROLLBACK');
    }
  });
});
