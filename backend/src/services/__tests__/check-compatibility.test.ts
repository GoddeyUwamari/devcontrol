/**
 * Live-Postgres coverage for scripts/check-compatibility.js — the read-only
 * release-compatibility evaluator (Phase 3F).
 *
 * Same convention as migrate-runner.test.ts: runs against the actual local
 * dev Postgres instance, not a mocked pg client. Full isolation per test via
 * a disposable Postgres SCHEMA + search_path — never touches `public` or any
 * real application table, and never uses the real database/migrations/
 * directory.
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { evaluateCompatibility, fetchDeclarationFromGit } = require('../../../../scripts/check-compatibility.js');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { ensureTrackingTables, initBaseline, computeChecksum } = require('../../../../database/migrate.js');

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

async function newIsolatedClient(schemaName: string): Promise<Client> {
  const admin = new Client(dbConfig());
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.query(`CREATE SCHEMA ${schemaName}`);
  await admin.end();

  const client = new Client(dbConfig());
  await client.connect();
  await client.query(`SET search_path TO ${schemaName}, public`);
  return client;
}

async function dropSchema(schemaName: string) {
  const admin = new Client(dbConfig());
  await admin.connect();
  await admin.query(`DROP SCHEMA IF EXISTS ${schemaName} CASCADE`);
  await admin.end();
}

function mkFixtureDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'check-compat-test-'));
  for (const [name, content] of Object.entries(files)) {
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
  }
  return dir;
}

function rmFixtureDir(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

async function insertAppliedRow(client: Client, migrationName: string, sql: string) {
  await client.query(
    'INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, $2)',
    [migrationName, computeChecksum(sql)]
  );
}

describe('database/check-compatibility.js — read-only evaluator', () => {
  let schemaCounter = 0;
  const schemas: string[] = [];
  const fixtureDirs: string[] = [];

  function nextSchema() {
    const name = `check_compat_test_${Date.now()}_${schemaCounter++}`;
    schemas.push(name);
    return name;
  }

  afterAll(async () => {
    for (const s of schemas) await dropSchema(s);
    for (const d of fixtureDirs) rmFixtureDir(d);
  });

  it('(1) present + clean ledger -> COMPATIBLE', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const sql = 'CREATE TABLE widget (id SERIAL PRIMARY KEY);';
    const dir = mkFixtureDir({ '001_create_widget.sql': sql });
    fixtureDirs.push(dir);
    try {
      await ensureTrackingTables(client);
      await initBaseline(client, 'test baseline', 'baseline-ref-abc');
      await insertAppliedRow(client, '001_create_widget.sql', sql);

      const result = await evaluateCompatibility({
        client,
        migrationsDir: dir,
        declaration: {
          minimum_required_migration: '001_create_widget.sql',
          baseline_repository_ref: 'baseline-ref-abc',
          post_baseline_verified: true,
        },
      });
      expect(result.status).toBe('COMPATIBLE');
    } finally {
      await client.end();
    }
  });

  it('(2) present, but a checksum mismatch exists elsewhere in the ledger -> SCHEMA-UNKNOWN', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const sqlA = 'CREATE TABLE widget (id SERIAL PRIMARY KEY);';
    const sqlB = 'CREATE TABLE gadget (id SERIAL PRIMARY KEY);';
    const dir = mkFixtureDir({
      '001_create_widget.sql': sqlA,
      '002_create_gadget.sql': sqlB,
    });
    fixtureDirs.push(dir);
    try {
      await ensureTrackingTables(client);
      await initBaseline(client, 'test baseline', 'baseline-ref-abc');
      await insertAppliedRow(client, '001_create_widget.sql', sqlA);
      // Record 002 as applied against different content than what's on disk now.
      await client.query(
        'INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, $2)',
        ['002_create_gadget.sql', computeChecksum('-- edited after being applied')]
      );

      const result = await evaluateCompatibility({
        client,
        migrationsDir: dir,
        declaration: {
          minimum_required_migration: '001_create_widget.sql',
          baseline_repository_ref: 'baseline-ref-abc',
          post_baseline_verified: true,
        },
      });
      expect(result.status).toBe('SCHEMA-UNKNOWN');
      expect(result.detail).toMatch(/Checksum mismatch/);
    } finally {
      await client.end();
    }
  });

  it('(3) the declared migration itself is checksum-mismatched -> SCHEMA-UNKNOWN', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const sql = 'CREATE TABLE widget (id SERIAL PRIMARY KEY);';
    const dir = mkFixtureDir({ '001_create_widget.sql': sql });
    fixtureDirs.push(dir);
    try {
      await ensureTrackingTables(client);
      await initBaseline(client, 'test baseline', 'baseline-ref-abc');
      await client.query(
        'INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, $2)',
        ['001_create_widget.sql', computeChecksum('-- edited after being applied')]
      );

      const result = await evaluateCompatibility({
        client,
        migrationsDir: dir,
        declaration: {
          minimum_required_migration: '001_create_widget.sql',
          baseline_repository_ref: 'baseline-ref-abc',
          post_baseline_verified: true,
        },
      });
      expect(result.status).toBe('SCHEMA-UNKNOWN');
    } finally {
      await client.end();
    }
  });

  it('(4) absent + post-baseline verified against the matching live baseline -> INCOMPATIBLE', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const sql = 'CREATE TABLE widget (id SERIAL PRIMARY KEY);';
    const dir = mkFixtureDir({ '001_create_widget.sql': sql });
    fixtureDirs.push(dir);
    try {
      await ensureTrackingTables(client);
      await initBaseline(client, 'test baseline', 'baseline-ref-abc');

      const result = await evaluateCompatibility({
        client,
        migrationsDir: dir,
        declaration: {
          minimum_required_migration: '001_create_widget.sql',
          baseline_repository_ref: 'baseline-ref-abc',
          post_baseline_verified: true,
        },
      });
      expect(result.status).toBe('INCOMPATIBLE');
    } finally {
      await client.end();
    }
  });

  it('(5) absent, not attested as post-baseline -> SCHEMA-UNKNOWN', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const sql = 'CREATE TABLE widget (id SERIAL PRIMARY KEY);';
    const dir = mkFixtureDir({ '001_create_widget.sql': sql });
    fixtureDirs.push(dir);
    try {
      await ensureTrackingTables(client);
      await initBaseline(client, 'test baseline', 'baseline-ref-abc');

      const result = await evaluateCompatibility({
        client,
        migrationsDir: dir,
        declaration: {
          minimum_required_migration: '001_create_widget.sql',
          baseline_repository_ref: 'baseline-ref-abc',
          post_baseline_verified: false,
        },
      });
      expect(result.status).toBe('SCHEMA-UNKNOWN');

      // Also missing the field entirely, not just false.
      const result2 = await evaluateCompatibility({
        client,
        migrationsDir: dir,
        declaration: { minimum_required_migration: '001_create_widget.sql' },
      });
      expect(result2.status).toBe('SCHEMA-UNKNOWN');
    } finally {
      await client.end();
    }
  });

  it('(5b) absent, post_baseline_verified true but declared baseline_repository_ref does not match the live baseline -> SCHEMA-UNKNOWN', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const sql = 'CREATE TABLE widget (id SERIAL PRIMARY KEY);';
    const dir = mkFixtureDir({ '001_create_widget.sql': sql });
    fixtureDirs.push(dir);
    try {
      await ensureTrackingTables(client);
      await initBaseline(client, 'test baseline', 'the-real-baseline-ref');

      const result = await evaluateCompatibility({
        client,
        migrationsDir: dir,
        declaration: {
          minimum_required_migration: '001_create_widget.sql',
          baseline_repository_ref: 'a-different-ref-entirely',
          post_baseline_verified: true,
        },
      });
      expect(result.status).toBe('SCHEMA-UNKNOWN');
      expect(result.detail).toMatch(/does not match/);
    } finally {
      await client.end();
    }
  });

  it('(6) no baseline row at all -> SCHEMA-UNKNOWN regardless of declaration', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const sql = 'CREATE TABLE widget (id SERIAL PRIMARY KEY);';
    const dir = mkFixtureDir({ '001_create_widget.sql': sql });
    fixtureDirs.push(dir);
    try {
      await ensureTrackingTables(client);
      // No initBaseline call -- zero rows in migration_tracking_baseline.

      const result = await evaluateCompatibility({
        client,
        migrationsDir: dir,
        declaration: {
          minimum_required_migration: '001_create_widget.sql',
          baseline_repository_ref: 'baseline-ref-abc',
          post_baseline_verified: true,
        },
      });
      expect(result.status).toBe('SCHEMA-UNKNOWN');
      expect(result.detail).toMatch(/No migration_tracking_baseline row exists/);
    } finally {
      await client.end();
    }
  });

  it('(7) no declaration at all -> RELEASE-UNKNOWN', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({});
    fixtureDirs.push(dir);
    try {
      await ensureTrackingTables(client);

      const result = await evaluateCompatibility({
        client,
        migrationsDir: dir,
        declaration: {
          minimum_required_migration: null,
          baseline_repository_ref: null,
          post_baseline_verified: null,
        },
      });
      expect(result.status).toBe('RELEASE-UNKNOWN');
    } finally {
      await client.end();
    }
  });

  it('(8) declared migration name does not exist -> throws, not a status', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const dir = mkFixtureDir({ '001_create_widget.sql': 'CREATE TABLE widget (id SERIAL PRIMARY KEY);' });
    fixtureDirs.push(dir);
    try {
      await ensureTrackingTables(client);
      await initBaseline(client, 'test baseline', 'baseline-ref-abc');

      await expect(
        evaluateCompatibility({
          client,
          migrationsDir: dir,
          declaration: {
            minimum_required_migration: '999_does_not_exist.sql',
            baseline_repository_ref: 'baseline-ref-abc',
            post_baseline_verified: true,
          },
        })
      ).rejects.toThrow(/does not exist/);
    } finally {
      await client.end();
    }
  });

  it('(9) empty schema_migrations (0 rows total) -- matches today\'s real production shape -> SCHEMA-UNKNOWN', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const sql = 'CREATE TABLE widget (id SERIAL PRIMARY KEY);';
    const dir = mkFixtureDir({ '001_create_widget.sql': sql });
    fixtureDirs.push(dir);
    try {
      await ensureTrackingTables(client);
      await initBaseline(client, 'test baseline', '089cef41054d8d950886924e9a8501dca1f93aab');
      const { rows } = await client.query('SELECT * FROM schema_migrations');
      expect(rows).toHaveLength(0);

      const result = await evaluateCompatibility({
        client,
        migrationsDir: dir,
        declaration: {
          minimum_required_migration: '001_create_widget.sql',
          baseline_repository_ref: '089cef41054d8d950886924e9a8501dca1f93aab',
          post_baseline_verified: false, // this migration predates that baseline
        },
      });
      expect(result.status).toBe('SCHEMA-UNKNOWN');
    } finally {
      await client.end();
    }
  });

  it('(10) multiple migration_tracking_baseline rows -> SCHEMA-UNKNOWN, not a silent pick', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const sql = 'CREATE TABLE widget (id SERIAL PRIMARY KEY);';
    const dir = mkFixtureDir({ '001_create_widget.sql': sql });
    fixtureDirs.push(dir);
    try {
      await ensureTrackingTables(client);
      await client.query(
        `INSERT INTO migration_tracking_baseline (note, repository_ref) VALUES ($1, $2), ($3, $4)`,
        ['first baseline', 'ref-1', 'second baseline (should never happen)', 'ref-2']
      );
      const { rows: baselineRows } = await client.query('SELECT * FROM migration_tracking_baseline');
      expect(baselineRows).toHaveLength(2);

      const result = await evaluateCompatibility({
        client,
        migrationsDir: dir,
        declaration: {
          minimum_required_migration: '001_create_widget.sql',
          baseline_repository_ref: 'ref-1',
          post_baseline_verified: true,
        },
      });
      expect(result.status).toBe('SCHEMA-UNKNOWN');
      expect(result.detail).toMatch(/ambiguous/);
    } finally {
      await client.end();
    }
  });

  it('(11) re-evaluated live: the same declaration returns a different status once the migration is applied', async () => {
    const schema = nextSchema();
    const client = await newIsolatedClient(schema);
    const sql = 'CREATE TABLE widget (id SERIAL PRIMARY KEY);';
    const dir = mkFixtureDir({ '001_create_widget.sql': sql });
    fixtureDirs.push(dir);
    try {
      await ensureTrackingTables(client);
      await initBaseline(client, 'test baseline', 'baseline-ref-abc');

      const declaration = {
        minimum_required_migration: '001_create_widget.sql',
        baseline_repository_ref: 'baseline-ref-abc',
        post_baseline_verified: true,
      };

      const before = await evaluateCompatibility({ client, migrationsDir: dir, declaration });
      expect(before.status).toBe('INCOMPATIBLE');

      await insertAppliedRow(client, '001_create_widget.sql', sql);

      const after = await evaluateCompatibility({ client, migrationsDir: dir, declaration });
      expect(after.status).toBe('COMPATIBLE');
    } finally {
      await client.end();
    }
  });

  it('(12) fetchDeclarationFromGit: reading a ref that predates release-compatibility.json throws, not a status', () => {
    const repoRoot = path.join(__dirname, '..', '..', '..', '..');
    // HEAD~1 is a real, resolvable commit in this repository's actual history
    // that predates release-compatibility.json's introduction -- unlike
    // testing against an uncommitted local file (which breaks the moment
    // this repo's own Phase 3F commit lands, as it does on CI verification
    // branches), a historical ref that genuinely never had the file is a
    // stable fixture regardless of the file's current commit status. This is
    // a real, read-only `git show` against local history: no network, no
    // production contact, and no commit made by this test.
    expect(() => fetchDeclarationFromGit('HEAD~1', repoRoot)).toThrow();
  });
});
