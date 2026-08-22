/**
 * Live-Postgres coverage for
 * database/migrations/202608221231_enable_rls_on_anomaly_rules.sql --
 * executes the actual migration file's SQL (read from disk, not
 * reimplemented) against a disposable fixture shaped like the real
 * production `anomaly_rules` table, in an isolated schema. Confirms it:
 *   - enables RLS and creates both policies on the existing table,
 *   - never creates a new table (ALTER-only, adoption not recreation),
 *   - is safe to re-run (idempotent policy guards),
 *   - fails loudly rather than silently creating a table when its
 *     required assumptions (table presence, organization_id shape, FK to
 *     organizations) aren't met.
 *
 * Same isolated-schema technique as migrate-runner.test.ts.
 */

import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATION_SQL = fs.readFileSync(
  path.join(__dirname, '../../../../database/migrations/202608221231_enable_rls_on_anomaly_rules.sql'),
  'utf8'
);

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

async function baseTableCount(client: Client, schemaName: string): Promise<number> {
  const { rows } = await client.query(
    `SELECT COUNT(*)::int AS count FROM pg_tables WHERE schemaname = $1`,
    [schemaName]
  );
  return rows[0].count;
}

describe('202608221231_enable_rls_on_anomaly_rules.sql', () => {
  let schemaCounter = 0;
  const schemas: string[] = [];

  function nextSchema() {
    const name = `anomaly_rules_mig_test_${Date.now()}_${schemaCounter++}`;
    schemas.push(name);
    return name;
  }

  afterAll(async () => {
    for (const s of schemas) await dropSchema(s);
  });

  async function createRealisticFixture(client: Client) {
    await client.query(`
      CREATE TABLE organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR NOT NULL)
    `);
    await client.query(`
      CREATE TABLE anomaly_rules (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        name VARCHAR NOT NULL,
        description TEXT,
        metric VARCHAR NOT NULL,
        condition VARCHAR NOT NULL,
        threshold NUMERIC NOT NULL,
        time_window VARCHAR DEFAULT '24h',
        severity VARCHAR DEFAULT 'warning',
        enabled BOOLEAN DEFAULT true,
        created_at TIMESTAMP DEFAULT NOW(),
        updated_at TIMESTAMP DEFAULT NOW()
      )
    `);
  }

  it('(1) enables RLS and creates both policies on the existing table, with no new table created', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      await createRealisticFixture(client);
      const tablesBefore = await baseTableCount(client, schemaName);

      await client.query(MIGRATION_SQL);

      const tablesAfter = await baseTableCount(client, schemaName);
      expect(tablesAfter).toBe(tablesBefore); // no table created

      const { rows: rls } = await client.query(
        `SELECT relrowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = 'anomaly_rules' AND n.nspname = $1`,
        [schemaName]
      );
      expect(rls[0].relrowsecurity).toBe(true);

      const { rows: policies } = await client.query(
        `SELECT polname FROM pg_policy p
         JOIN pg_class c ON c.oid = p.polrelid
         JOIN pg_namespace n ON n.oid = c.relnamespace
         WHERE c.relname = 'anomaly_rules' AND n.nspname = $1 ORDER BY polname`,
        [schemaName]
      );
      expect(policies.map(r => r.polname)).toEqual([
        'anomaly_rules_insert_policy',
        'anomaly_rules_isolation_policy',
      ]);
    } finally {
      await client.end();
    }
  });

  it('(2) preserves organization_id, its FK, defaults, and existing data unchanged', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      await createRealisticFixture(client);
      const org = await client.query(`INSERT INTO organizations (name) VALUES ('preexisting') RETURNING id`);
      await client.query(
        `INSERT INTO anomaly_rules (organization_id, name, metric, condition, threshold)
         VALUES ($1, 'pre-existing rule', 'total_cost', 'greater_than', 500)`,
        [org.rows[0].id]
      );

      await client.query(MIGRATION_SQL);

      const { rows } = await client.query(`SELECT * FROM anomaly_rules`);
      expect(rows).toHaveLength(1);
      expect(rows[0].name).toBe('pre-existing rule');
      expect(rows[0].organization_id).toBe(org.rows[0].id);

      const { rows: fk } = await client.query(`
        SELECT conname FROM pg_constraint
        WHERE conrelid = 'anomaly_rules'::regclass AND contype = 'f'
      `);
      expect(fk).toHaveLength(1);
    } finally {
      await client.end();
    }
  });

  it('(3) is safe to re-run (idempotent)', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      await createRealisticFixture(client);
      await client.query(MIGRATION_SQL);
      await expect(client.query(MIGRATION_SQL)).resolves.toBeDefined();
    } finally {
      await client.end();
    }
  });

  it('(4) fails loudly and creates nothing when anomaly_rules does not exist', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      // No fixture at all -- table is genuinely absent.
      await expect(client.query(MIGRATION_SQL)).rejects.toThrow(/anomaly_rules does not exist/);

      const { rows } = await client.query(
        `SELECT to_regclass($1) AS reg`,
        [`${schemaName}.anomaly_rules`]
      );
      expect(rows[0].reg).toBeNull(); // still does not exist -- nothing was silently created
    } finally {
      await client.end();
    }
  });

  it('(5) fails loudly when organization_id does not match the required shape', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      await client.query(`
        CREATE TABLE anomaly_rules (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id VARCHAR NOT NULL
        )
      `);
      await expect(client.query(MIGRATION_SQL)).rejects.toThrow(/organization_id is missing, nullable, or not uuid/);
    } finally {
      await client.end();
    }
  });

  it('(6) fails loudly when the foreign key to organizations is missing', async () => {
    const schemaName = nextSchema();
    const client = await newIsolatedClient(schemaName);
    try {
      await client.query(`
        CREATE TABLE anomaly_rules (
          id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
          organization_id UUID NOT NULL
        )
      `);
      await expect(client.query(MIGRATION_SQL)).rejects.toThrow(/has no foreign key to organizations/);
    } finally {
      await client.end();
    }
  });
});
