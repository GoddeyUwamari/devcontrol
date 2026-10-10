/**
 * Live-Postgres coverage for
 * database/migrations-admin/202610101200_create_resource_health_evaluations.sql
 * and its paired rollback. Executes the actual files (read from disk, not
 * reimplemented) against a fixture shaped like the production tables they
 * touch, in an isolated schema -- the technique of
 * compliance-framework-security-foundation-migration.test.ts.
 *
 * Every test runs inside ONE transaction that is always rolled back: the
 * schema, the fixture, the migration, every grant and every row disappear
 * with it, so nothing outlives a test and no role is created.
 *
 * The connecting role (`postgres` in CI and locally) is a superuser, which
 * row-level security never restricts. Every RLS and tenant-integrity
 * assertion therefore runs after `SET LOCAL ROLE devcontrol` -- the
 * application's role, created in CI before the schema bootstrap -- and first
 * asserts that the acting role is neither a superuser nor BYPASSRLS.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATION_FILE = '202610101200_create_resource_health_evaluations.sql';
const ROLLBACK_FILE = '202610101200_create_resource_health_evaluations_rollback.sql';
const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');

const SCHEMA_PREFIX = 'rh_eval_mig_test_';
const RUNS = 'resource_health_evaluation_runs';
const RESULTS = 'resource_health_evaluation_results';

/** The policy expression, as PostgreSQL deparses it, for USING and WITH CHECK alike. */
const TENANT_EXPRESSION =
  "(organization_id = (NULLIF(current_setting('app.current_organization_id'::text, true), ''::text))::uuid)";

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

/**
 * The production shapes this migration touches: organizations, aws_resources
 * (008_create_aws_resources.sql, including its row-level security) and the
 * schema_migrations ledger (database/migrate.js ensureTrackingTables()).
 */
async function createFixture(client: Client, { awsResources = true } = {}) {
  await client.query(`
    CREATE TABLE organizations (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name VARCHAR(255) NOT NULL
    )
  `);
  if (awsResources) {
    await client.query(`
      CREATE TABLE aws_resources (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
        resource_arn VARCHAR(255) NOT NULL,
        resource_id VARCHAR(255) NOT NULL,
        resource_name VARCHAR(255),
        resource_type VARCHAR(50) NOT NULL,
        region VARCHAR(50) NOT NULL,
        status VARCHAR(50),
        metadata JSONB DEFAULT '{}',
        UNIQUE (organization_id, resource_arn)
      )
    `);
    await client.query('ALTER TABLE aws_resources ENABLE ROW LEVEL SECURITY');
    await client.query(`
      CREATE POLICY aws_resources_isolation_policy ON aws_resources
        FOR ALL USING (organization_id::text = current_setting('app.current_organization_id', true))
    `);
    await client.query(`
      CREATE POLICY aws_resources_insert_policy ON aws_resources
        FOR INSERT WITH CHECK (organization_id::text = current_setting('app.current_organization_id', true))
    `);
  }
  await client.query(`
    CREATE TABLE schema_migrations (
      id SERIAL PRIMARY KEY,
      migration_name VARCHAR(255) UNIQUE NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
}

let schemaCounter = 0;

interface Options {
  migrate?: boolean;
  awsResources?: boolean;
}

/**
 * Runs `fn` in a fresh connection, inside one transaction holding a new
 * isolated schema with the fixture (and, by default, the migration applied).
 * Always rolled back.
 */
async function inIsolatedSchema(
  fn: (client: Client, schema: string) => Promise<void>,
  { migrate = true, awsResources = true }: Options = {}
): Promise<void> {
  const client = new Client(dbConfig());
  await client.connect();
  const schema = `${SCHEMA_PREFIX}${process.pid}_${Date.now()}_${schemaCounter++}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    // Schema-only search_path: no fallback to public, so nothing here can
    // resolve against real tables of the same name.
    await client.query(`SET LOCAL search_path TO ${schema}`);
    await createFixture(client, { awsResources });
    if (migrate) await client.query(MIGRATION_SQL);
    await fn(client, schema);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

/** The error `sql` fails with; the transaction continues from before it. */
async function failureOf(client: Client, sql: string, params: unknown[] = []): Promise<{ code?: string; constraint?: string; message: string }> {
  await client.query('SAVEPOINT expected_failure');
  try {
    await client.query(sql, params);
  } catch (err) {
    await client.query('ROLLBACK TO SAVEPOINT expected_failure');
    return err as { code?: string; constraint?: string; message: string };
  }
  await client.query('ROLLBACK TO SAVEPOINT expected_failure');
  throw new Error(`expected this statement to fail, and it succeeded: ${sql}`);
}

/**
 * Act as the application role for the rest of the transaction. `organization`
 * undefined leaves app.current_organization_id untouched (unset in a new
 * session); a string is set transaction-locally, as given.
 */
async function asApp(client: Client, schema: string, organization?: string): Promise<void> {
  await client.query(`GRANT USAGE ON SCHEMA ${schema} TO devcontrol`);
  await client.query('SET LOCAL ROLE devcontrol');
  if (organization !== undefined) {
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organization]);
  }
  const { rows } = await client.query(
    'SELECT current_user AS role, rolsuper, rolbypassrls FROM pg_roles WHERE rolname = current_user'
  );
  expect(rows).toEqual([{ role: 'devcontrol', rolsuper: false, rolbypassrls: false }]);
}

async function asOwner(client: Client): Promise<void> {
  await client.query('RESET ROLE');
}

async function count(client: Client, table: string, where = 'TRUE', params: unknown[] = []): Promise<number> {
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE ${where}`, params);
  return rows[0].n;
}

const INSERT_FINISHED_RUN = `
  INSERT INTO ${RUNS} (organization_id, status, evaluation_range, evaluated_at, finished_at,
                       inventory_count, evaluated_count, failed_count)
  VALUES ($1, 'complete', '1h', NOW(), NOW(), 1, 1, 0)
  RETURNING id`;

const INSERT_RESULT = `
  INSERT INTO ${RESULTS} (run_id, organization_id, resource_id, resource_type, outcome,
                          evaluator_status, monitored, check_name, evaluated_at)
  VALUES ($1, $2, $3, 'ec2', 'evaluated', 'healthy', true, 'ec2_status_check', NOW())`;

interface Tenant {
  org: string;
  resource: string;
  run: string;
}

/** Two organizations, each with one resource, one finished run and one result. Inserted as the owner. */
async function seedTwoTenants(client: Client): Promise<{ a: Tenant; b: Tenant }> {
  const tenant = async (name: string): Promise<Tenant> => {
    const org = (await client.query('INSERT INTO organizations (name) VALUES ($1) RETURNING id', [name])).rows[0].id;
    const resource = (
      await client.query(
        `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status)
         VALUES ($1, $2, $3, 'ec2', 'test-region-1', 'running') RETURNING id`,
        [org, `arn:aws:ec2:test-region-1:000000000000:instance/synthetic-${name}`, `synthetic-${name}`]
      )
    ).rows[0].id;
    const run = (await client.query(INSERT_FINISHED_RUN, [org])).rows[0].id;
    await client.query(INSERT_RESULT, [run, org, resource]);
    return { org, resource, run };
  };
  return { a: await tenant('org-a'), b: await tenant('org-b') };
}

afterAll(async () => {
  // Every test rolls back its schema; none may survive.
  const client = new Client(dbConfig());
  await client.connect();
  try {
    const { rows } = await client.query('SELECT nspname FROM pg_namespace WHERE nspname LIKE $1', [`${SCHEMA_PREFIX}%`]);
    expect(rows).toEqual([]);
  } finally {
    await client.end();
  }
});

describe(`${MIGRATION_FILE}: catalog`, () => {
  it('creates both tables, owned by the migrating role and not by devcontrol', async () => {
    await inIsolatedSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT relname, pg_get_userbyid(relowner) AS owner, current_user AS migrator
           FROM pg_class WHERE oid IN ($1::regclass, $2::regclass) ORDER BY relname`,
        [RESULTS, RUNS]
      );
      expect(rows.map((r) => r.relname)).toEqual([RESULTS, RUNS]);
      for (const row of rows) {
        expect(row.owner).toBe(row.migrator);
        expect(row.owner).not.toBe('devcontrol');
      }
    });
  });

  it('enables and forces row-level security on both tables', async () => {
    await inIsolatedSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity
           FROM pg_class WHERE oid IN ($1::regclass, $2::regclass) ORDER BY relname`,
        [RESULTS, RUNS]
      );
      expect(rows).toEqual([
        { relname: RESULTS, relrowsecurity: true, relforcerowsecurity: true },
        { relname: RUNS, relrowsecurity: true, relforcerowsecurity: true },
      ]);
    });
  });

  it('has exactly one tenant policy per table, for every command, on app.current_organization_id', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { rows } = await client.query(
        `SELECT tablename, policyname, cmd, permissive, roles::text[] AS roles, qual, with_check
           FROM pg_policies WHERE schemaname = $1 AND tablename IN ($2, $3) ORDER BY tablename`,
        [schema, RESULTS, RUNS]
      );
      expect(rows).toEqual([
        {
          tablename: RESULTS, policyname: `${RESULTS}_tenant`, cmd: 'ALL', permissive: 'PERMISSIVE',
          roles: ['public'], qual: TENANT_EXPRESSION, with_check: TENANT_EXPRESSION,
        },
        {
          tablename: RUNS, policyname: `${RUNS}_tenant`, cmd: 'ALL', permissive: 'PERMISSIVE',
          roles: ['public'], qual: TENANT_EXPRESSION, with_check: TENANT_EXPRESSION,
        },
      ]);
    });
  });

  it('grants devcontrol SELECT, INSERT, UPDATE and DELETE only -- never TRUNCATE', async () => {
    await inIsolatedSchema(async (client, schema) => {
      for (const table of [RUNS, RESULTS]) {
        const { rows } = await client.query(
          `SELECT privilege_type FROM information_schema.role_table_grants
            WHERE grantee = 'devcontrol' AND table_schema = $1 AND table_name = $2 ORDER BY privilege_type`,
          [schema, table]
        );
        expect(rows.map((r) => r.privilege_type)).toEqual(['DELETE', 'INSERT', 'SELECT', 'UPDATE']);
        for (const privilege of ['TRUNCATE', 'REFERENCES', 'TRIGGER']) {
          const { rows: has } = await client.query('SELECT has_table_privilege($1, $2::regclass, $3) AS granted', [
            'devcontrol', table, privilege,
          ]);
          expect(has[0].granted).toBe(false);
        }
      }
    });
  });

  it('adds aws_resources_id_org_unique as UNIQUE (id, organization_id), leaving the existing constraints as they were', async () => {
    await inIsolatedSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT conname, pg_get_constraintdef(oid) AS def FROM pg_constraint
          WHERE conrelid = 'aws_resources'::regclass ORDER BY conname`
      );
      expect(rows).toEqual([
        { conname: 'aws_resources_id_org_unique', def: 'UNIQUE (id, organization_id)' },
        { conname: 'aws_resources_organization_id_fkey', def: 'FOREIGN KEY (organization_id) REFERENCES organizations(id) ON DELETE CASCADE' },
        { conname: 'aws_resources_organization_id_resource_arn_key', def: 'UNIQUE (organization_id, resource_arn)' },
        { conname: 'aws_resources_pkey', def: 'PRIMARY KEY (id)' },
      ]);
    });
  });

  it('keys results to their run and their resource by (id, organization_id)', async () => {
    await inIsolatedSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT fk.conname, pg_get_constraintdef(fk.oid) AS def, uq.conname AS uses
           FROM pg_constraint fk
           JOIN pg_constraint uq ON uq.conindid = fk.conindid AND uq.contype = 'u'
          WHERE fk.conrelid = $1::regclass AND fk.contype = 'f'
          ORDER BY fk.conname`,
        [RESULTS]
      );
      expect(rows).toEqual([
        {
          conname: `${RESULTS}_resource_fk`,
          def: 'FOREIGN KEY (resource_id, organization_id) REFERENCES aws_resources(id, organization_id) ON DELETE CASCADE',
          uses: 'aws_resources_id_org_unique',
        },
        {
          conname: `${RESULTS}_run_fk`,
          def: `FOREIGN KEY (run_id, organization_id) REFERENCES ${RUNS}(id, organization_id) ON DELETE CASCADE`,
          uses: `${RUNS}_id_org_unique`,
        },
      ]);
    });
  });

  it('creates the one-running, latest-run and per-resource indexes', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { rows } = await client.query(
        `SELECT indexname, indexdef FROM pg_indexes
          WHERE schemaname = $1 AND tablename IN ($2, $3) AND indexname NOT LIKE '%_pkey' ORDER BY indexname`,
        [schema, RESULTS, RUNS]
      );
      expect(rows).toEqual([
        {
          indexname: `${RESULTS}_org_resource_time`,
          indexdef: `CREATE INDEX ${RESULTS}_org_resource_time ON ${schema}.${RESULTS} USING btree (organization_id, resource_id, evaluated_at DESC)`,
        },
        {
          indexname: `${RUNS}_id_org_unique`,
          indexdef: `CREATE UNIQUE INDEX ${RUNS}_id_org_unique ON ${schema}.${RUNS} USING btree (id, organization_id)`,
        },
        {
          indexname: `${RUNS}_one_running`,
          indexdef: `CREATE UNIQUE INDEX ${RUNS}_one_running ON ${schema}.${RUNS} USING btree (organization_id) WHERE ((status)::text = 'running'::text)`,
        },
        {
          indexname: `${RUNS}_org_started`,
          indexdef: `CREATE INDEX ${RUNS}_org_started ON ${schema}.${RUNS} USING btree (organization_id, started_at DESC)`,
        },
      ]);
    });
  });

  it('names the range column evaluation_range', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { rows } = await client.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_schema = $1 AND table_name = $2 AND column_name IN ('range', 'evaluation_range')`,
        [schema, RUNS]
      );
      expect(rows).toEqual([{ column_name: 'evaluation_range' }]);
    });
  });

  it('defines exactly these CHECK constraints', async () => {
    await inIsolatedSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT conrelid::regclass::text AS tbl, conname FROM pg_constraint
          WHERE conrelid IN ($1::regclass, $2::regclass) AND contype = 'c' ORDER BY 1, 2`,
        [RESULTS, RUNS]
      );
      expect(rows.map((r) => `${r.tbl}.${r.conname}`)).toEqual([
        `${RESULTS}.${RESULTS}_evaluator_status_check`,
        `${RESULTS}.${RESULTS}_outcome_check`,
        `${RESULTS}.${RESULTS}_outcome_shape`,
        `${RUNS}.${RUNS}_complete_no_failures`,
        `${RUNS}.${RUNS}_evaluated_count_check`,
        `${RUNS}.${RUNS}_evaluation_range_check`,
        `${RUNS}.${RUNS}_failed_count_check`,
        `${RUNS}.${RUNS}_failure_code_check`,
        `${RUNS}.${RUNS}_inventory_count_check`,
        `${RUNS}.${RUNS}_lifecycle`,
        `${RUNS}.${RUNS}_partial_has_failures`,
        `${RUNS}.${RUNS}_status_check`,
        `${RUNS}.${RUNS}_time_order`,
      ]);
    });
  });
});

describe(`${MIGRATION_FILE}: refusals`, () => {
  it('refuses to run again, and the first application is left as it was', async () => {
    await inIsolatedSchema(async (client) => {
      const err = await failureOf(client, MIGRATION_SQL);
      expect(err.message).toMatch(/already exists -- this migration creates them and refuses to proceed/);
      expect(await count(client, 'pg_constraint', "conname = 'aws_resources_id_org_unique' AND connamespace = current_schema()::regnamespace")).toBe(1);
      expect(await count(client, 'pg_policies', 'schemaname = current_schema() AND tablename IN ($1, $2)', [RUNS, RESULTS])).toBe(2);
    });
  });

  it('refuses, and creates nothing, when aws_resources_id_org_unique already exists', async () => {
    await inIsolatedSchema(
      async (client) => {
        await client.query('ALTER TABLE aws_resources ADD CONSTRAINT aws_resources_id_org_unique UNIQUE (id, organization_id)');
        const err = await failureOf(client, MIGRATION_SQL);
        expect(err.message).toMatch(/aws_resources_id_org_unique already exists -- refusing to proceed/);
        const { rows } = await client.query('SELECT to_regclass($1) AS runs, to_regclass($2) AS results', [RUNS, RESULTS]);
        expect(rows[0]).toEqual({ runs: null, results: null });
      },
      { migrate: false }
    );
  });

  it('refuses when aws_resources does not exist', async () => {
    await inIsolatedSchema(
      async (client) => {
        const err = await failureOf(client, MIGRATION_SQL);
        expect(err.message).toMatch(/aws_resources does not exist -- refusing to proceed/);
      },
      { migrate: false, awsResources: false }
    );
  });

  it('is administrative: invisible to the ordinary path, and its rollback is never selected by the runner', () => {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { getMigrationFiles, MIGRATIONS_DIR } = require('../../../../database/migrate.js');
    expect(getMigrationFiles(MIGRATIONS_DIR)).not.toContain(MIGRATION_FILE);
    expect(getMigrationFiles(ADMIN_DIR)).toContain(MIGRATION_FILE);
    expect(getMigrationFiles(ADMIN_DIR)).not.toContain(ROLLBACK_FILE);
    expect(fs.existsSync(path.join(ADMIN_DIR, ROLLBACK_FILE))).toBe(true);
  });
});

describe(`${MIGRATION_FILE}: row-level security, as devcontrol`, () => {
  it("tagged with one organization, reads only that organization's runs and results", async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { a } = await seedTwoTenants(client);
      await asApp(client, schema, a.org);
      expect((await client.query(`SELECT id FROM ${RUNS}`)).rows).toEqual([{ id: a.run }]);
      expect((await client.query(`SELECT run_id, organization_id FROM ${RESULTS}`)).rows).toEqual([
        { run_id: a.run, organization_id: a.org },
      ]);
    });
  });

  it('with the setting never set, reads nothing and writes nothing', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { a } = await seedTwoTenants(client);
      // Precondition: a new session has no value for the setting at all.
      expect((await client.query("SELECT current_setting('app.current_organization_id', true) AS v")).rows[0].v).toBeNull();
      await asApp(client, schema);
      expect(await count(client, RUNS)).toBe(0);
      expect(await count(client, RESULTS)).toBe(0);
      expect((await failureOf(client, INSERT_FINISHED_RUN, [a.org])).code).toBe('42501');
      expect((await client.query(`UPDATE ${RUNS} SET failed_count = 0`)).rowCount).toBe(0);
      expect((await client.query(`DELETE FROM ${RESULTS}`)).rowCount).toBe(0);
    });
  });

  it('with the setting empty, reads nothing and writes nothing', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { a } = await seedTwoTenants(client);
      await asApp(client, schema, '');
      expect(await count(client, RUNS)).toBe(0);
      expect(await count(client, RESULTS)).toBe(0);
      expect((await failureOf(client, INSERT_FINISHED_RUN, [a.org])).code).toBe('42501');
      expect((await failureOf(client, INSERT_RESULT, [a.run, a.org, a.resource])).code).toBe('42501');
      expect((await client.query(`DELETE FROM ${RUNS}`)).rowCount).toBe(0);
    });
  });

  it('with a setting that is not a UUID, every read and write fails', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { a } = await seedTwoTenants(client);
      await asApp(client, schema, 'not-a-uuid');
      for (const sql of [`SELECT * FROM ${RUNS}`, `SELECT * FROM ${RESULTS}`, `UPDATE ${RUNS} SET failed_count = 0`, `DELETE FROM ${RESULTS}`]) {
        expect((await failureOf(client, sql)).code).toBe('22P02');
      }
      expect((await failureOf(client, INSERT_FINISHED_RUN, [a.org])).code).toBe('22P02');
      await asOwner(client);
      expect(await count(client, RUNS)).toBe(2);
      expect(await count(client, RESULTS)).toBe(2);
    });
  });

  it('cannot write a row for another organization, or move its own row to one', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { a, b } = await seedTwoTenants(client);
      await asApp(client, schema, a.org);
      expect((await failureOf(client, INSERT_FINISHED_RUN, [b.org])).code).toBe('42501');
      expect((await failureOf(client, INSERT_RESULT, [b.run, b.org, b.resource])).code).toBe('42501');
      expect((await failureOf(client, `UPDATE ${RUNS} SET organization_id = $1 WHERE id = $2`, [b.org, a.run])).code).toBe('42501');
    });
  });

  it("cannot read, update or delete another organization's rows", async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { a, b } = await seedTwoTenants(client);
      await asApp(client, schema, a.org);
      expect(await count(client, RUNS, 'id = $1', [b.run])).toBe(0);
      expect((await client.query(`UPDATE ${RUNS} SET failed_count = 0 WHERE id = $1`, [b.run])).rowCount).toBe(0);
      expect((await client.query(`DELETE FROM ${RESULTS} WHERE run_id = $1`, [b.run])).rowCount).toBe(0);
      expect((await client.query(`DELETE FROM ${RUNS} WHERE id = $1`, [b.run])).rowCount).toBe(0);
      await asOwner(client);
      expect(await count(client, RUNS, 'id = $1', [b.run])).toBe(1);
      expect(await count(client, RESULTS, 'run_id = $1', [b.run])).toBe(1);
    });
  });
});

describe(`${MIGRATION_FILE}: tenant integrity, as devcontrol`, () => {
  it("a result's organization must be its run's", async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { a, b } = await seedTwoTenants(client);
      await asApp(client, schema, a.org);
      const err = await failureOf(client, INSERT_RESULT, [b.run, a.org, a.resource]);
      expect(err.code).toBe('23503');
      expect(err.constraint).toBe(`${RESULTS}_run_fk`);
    });
  });

  it("a result's organization must be its resource's", async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { a, b } = await seedTwoTenants(client);
      await asApp(client, schema, a.org);
      const run = (await client.query(INSERT_FINISHED_RUN, [a.org])).rows[0].id;
      const err = await failureOf(client, INSERT_RESULT, [run, a.org, b.resource]);
      expect(err.code).toBe('23503');
      expect(err.constraint).toBe(`${RESULTS}_resource_fk`);
    });
  });

  it('allows at most one running run per organization', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { a, b } = await seedTwoTenants(client);
      const claim = `INSERT INTO ${RUNS} (organization_id, status, evaluation_range) VALUES ($1, 'running', '1h')`;
      await asApp(client, schema, a.org);
      await client.query(claim, [a.org]);
      const err = await failureOf(client, claim, [a.org]);
      expect(err.code).toBe('23505');
      expect(err.constraint).toBe(`${RUNS}_one_running`);
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [b.org]);
      await client.query(claim, [b.org]);
    });
  });

  it('enforces the run lifecycle', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { a } = await seedTwoTenants(client);
      await asApp(client, schema, a.org);
      const insert = (columns: string, values: string) =>
        `INSERT INTO ${RUNS} (organization_id, evaluation_range, ${columns}) VALUES ($1, '1h', ${values})`;
      const rejected: Array<[string, string]> = [
        [insert('status, finished_at', "'running', NOW()"), `${RUNS}_lifecycle`],
        [insert('status, evaluated_at, finished_at', "'complete', NOW(), NOW()"), `${RUNS}_lifecycle`],
        [insert('status, finished_at', "'failed', NOW()"), `${RUNS}_lifecycle`],
        [insert('status, evaluated_at, finished_at, inventory_count, evaluated_count, failed_count, failure_code',
          "'complete', NOW(), NOW(), 1, 1, 0, 'unexpected'"), `${RUNS}_lifecycle`],
        [insert('status, evaluated_at, finished_at, inventory_count, evaluated_count, failed_count',
          "'complete', NOW(), NOW(), 2, 1, 1"), `${RUNS}_complete_no_failures`],
        [insert('status, evaluated_at, finished_at, inventory_count, evaluated_count, failed_count',
          "'partial', NOW(), NOW(), 1, 1, 0"), `${RUNS}_partial_has_failures`],
        [insert('status, finished_at, failure_code', "'failed', NOW() - interval '1 hour', 'timeout'"), `${RUNS}_time_order`],
        // Also outside the lifecycle; CHECKs are applied in name order, so lifecycle reports it.
        [insert('status', "'queued'"), `${RUNS}_lifecycle`],
        [`INSERT INTO ${RUNS} (organization_id, evaluation_range, status) VALUES ($1, '24h', 'running')`, `${RUNS}_evaluation_range_check`],
        [insert('status, finished_at, failure_code', "'failed', NOW(), 'oops'"), `${RUNS}_failure_code_check`],
        [insert('status, evaluated_at, finished_at, inventory_count, evaluated_count, failed_count',
          "'complete', NOW(), NOW(), -1, 0, 0"), `${RUNS}_inventory_count_check`],
      ];
      for (const [sql, constraint] of rejected) {
        const err = await failureOf(client, sql, [a.org]);
        expect({ sql, code: err.code, constraint: err.constraint }).toEqual({ sql, code: '23514', constraint });
      }
      // Accepted: a partial run in which nothing could be evaluated, and a failed run.
      await client.query(insert('status, evaluated_at, finished_at, inventory_count, evaluated_count, failed_count',
        "'partial', NOW(), NOW(), 2, 0, 2"), [a.org]);
      await client.query(insert('status, finished_at, failure_code', "'failed', NOW(), 'client_unavailable'"), [a.org]);
    });
  });

  it('enforces the shape of each result outcome', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { a } = await seedTwoTenants(client);
      await asApp(client, schema, a.org);
      const run = (await client.query(INSERT_FINISHED_RUN, [a.org])).rows[0].id;
      const insert = `INSERT INTO ${RESULTS} (run_id, organization_id, resource_id, resource_type, outcome,
                                              evaluator_status, monitored, check_name, evaluated_at)
                      VALUES ($1, $2, $3, 'ec2', $4, $5, $6, $7, NOW())`;
      const rejected: Array<[unknown[], string]> = [
        [['evaluated', null, true, 'ec2_status_check'], `${RESULTS}_outcome_shape`],
        [['evaluated', 'healthy', null, 'ec2_status_check'], `${RESULTS}_outcome_shape`],
        [['evaluated', 'healthy', true, null], `${RESULTS}_outcome_shape`],
        [['evaluation_failed', 'unknown', null, null], `${RESULTS}_outcome_shape`],
        [['evaluation_failed', null, false, null], `${RESULTS}_outcome_shape`],
        [['skipped', null, null, null], `${RESULTS}_outcome_check`],
        [['evaluated', 'fine', true, 'ec2_status_check'], `${RESULTS}_evaluator_status_check`],
      ];
      for (const [values, constraint] of rejected) {
        const err = await failureOf(client, insert, [run, a.org, a.resource, ...values]);
        expect({ values, code: err.code, constraint: err.constraint }).toEqual({ values, code: '23514', constraint });
      }
      await client.query(insert, [run, a.org, a.resource, 'evaluation_failed', null, null, null]);
    });
  });

  it('removes results with their run, their resource and their organization', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { a, b } = await seedTwoTenants(client);
      const secondResource = (
        await client.query(
          `INSERT INTO aws_resources (organization_id, resource_arn, resource_id, resource_type, region, status)
           VALUES ($1, 'arn:aws:ec2:test-region-1:000000000000:instance/synthetic-second', 'synthetic-second', 'ec2', 'test-region-1', 'running')
           RETURNING id`,
          [a.org]
        )
      ).rows[0].id;
      const secondRun = (await client.query(INSERT_FINISHED_RUN, [a.org])).rows[0].id;
      await client.query(INSERT_RESULT, [secondRun, a.org, secondResource]);
      // The application deletes inventory rows (orphaned-resource removal);
      // mirror that privilege here. Rolled back with everything else.
      await client.query('GRANT SELECT, DELETE ON aws_resources TO devcontrol');

      await asApp(client, schema, a.org);
      await client.query(`DELETE FROM ${RUNS} WHERE id = $1`, [a.run]);
      expect(await count(client, RESULTS, 'run_id = $1', [a.run])).toBe(0);
      await client.query('DELETE FROM aws_resources WHERE id = $1', [secondResource]);
      expect(await count(client, RESULTS, 'resource_id = $1', [secondResource])).toBe(0);
      expect(await count(client, RUNS, 'id = $1', [secondRun])).toBe(1);

      await asOwner(client);
      await client.query('DELETE FROM organizations WHERE id = $1', [a.org]);
      expect(await count(client, RUNS, 'organization_id = $1', [a.org])).toBe(0);
      expect(await count(client, RESULTS, 'organization_id = $1', [a.org])).toBe(0);
      expect(await count(client, RUNS, 'organization_id = $1', [b.org])).toBe(1);
      expect(await count(client, RESULTS, 'organization_id = $1', [b.org])).toBe(1);
    });
  });
});

describe(ROLLBACK_FILE, () => {
  it("removes exactly what the migration created and only the migration's own ledger row; the migration can then run again", async () => {
    await inIsolatedSchema(async (client) => {
      const { a } = await seedTwoTenants(client);
      await client.query(
        "INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, 'x'), ('008_create_aws_resources.sql', 'y')",
        [MIGRATION_FILE]
      );

      await client.query(ROLLBACK_SQL);

      const { rows } = await client.query('SELECT to_regclass($1) AS runs, to_regclass($2) AS results', [RUNS, RESULTS]);
      expect(rows[0]).toEqual({ runs: null, results: null });
      const constraints = await client.query("SELECT conname FROM pg_constraint WHERE conrelid = 'aws_resources'::regclass ORDER BY conname");
      expect(constraints.rows.map((r) => r.conname)).toEqual([
        'aws_resources_organization_id_fkey',
        'aws_resources_organization_id_resource_arn_key',
        'aws_resources_pkey',
      ]);
      expect(await count(client, 'aws_resources', 'id = $1', [a.resource])).toBe(1);
      expect((await client.query('SELECT migration_name FROM schema_migrations')).rows).toEqual([
        { migration_name: '008_create_aws_resources.sql' },
      ]);

      await client.query(MIGRATION_SQL);
      expect(await count(client, 'pg_policies', 'schemaname = current_schema() AND tablename IN ($1, $2)', [RUNS, RESULTS])).toBe(2);
    });
  });

  it('refuses, dropping nothing, when another foreign key uses aws_resources_id_org_unique', async () => {
    await inIsolatedSchema(async (client) => {
      await client.query(`
        CREATE TABLE other_reference (
          resource_id UUID NOT NULL,
          organization_id UUID NOT NULL,
          CONSTRAINT other_reference_resource_fk FOREIGN KEY (resource_id, organization_id)
            REFERENCES aws_resources (id, organization_id)
        )
      `);
      const err = await failureOf(client, ROLLBACK_SQL);
      expect(err.message).toMatch(/aws_resources_id_org_unique is referenced by other foreign keys \(other_reference_resource_fk on other_reference\)/);
      expect(await count(client, 'pg_constraint', "conname = 'aws_resources_id_org_unique' AND connamespace = current_schema()::regnamespace")).toBe(1);
    });
  });

  it('refuses when another table references the evaluation tables', async () => {
    await inIsolatedSchema(async (client) => {
      await client.query(`
        CREATE TABLE run_annotations (
          run_id UUID NOT NULL,
          organization_id UUID NOT NULL,
          CONSTRAINT run_annotations_run_fk FOREIGN KEY (run_id, organization_id)
            REFERENCES ${RUNS} (id, organization_id)
        )
      `);
      const err = await failureOf(client, ROLLBACK_SQL);
      expect(err.message).toMatch(/resource_health_evaluation_\* is referenced by other foreign keys \(run_annotations_run_fk on run_annotations\)/);
    });
  });

  it('never cascades: a view over a table makes it fail', async () => {
    await inIsolatedSchema(async (client) => {
      await client.query(`CREATE VIEW latest_results AS SELECT run_id, resource_id FROM ${RESULTS}`);
      const err = await failureOf(client, ROLLBACK_SQL);
      expect(err.code).toBe('2BP01');
      expect(await count(client, 'pg_class', 'oid = $1::regclass', [RESULTS])).toBe(1);
    });
  });

  it('refuses when the migration is not applied', async () => {
    await inIsolatedSchema(
      async (client) => {
        const err = await failureOf(client, ROLLBACK_SQL);
        expect(err.message).toMatch(/not found -- the paired migration is not applied here; nothing to roll back/);
      },
      { migrate: false }
    );
  });
});
