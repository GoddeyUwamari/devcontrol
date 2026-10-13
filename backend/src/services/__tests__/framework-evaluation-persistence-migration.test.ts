/**
 * Live-Postgres coverage for
 * database/migrations-admin/202610112300_create_framework_evaluation_persistence.sql
 * and its paired rollback. Executes the actual files (read from disk) against a
 * fixture shaped like the production tables they touch, in an isolated schema --
 * the technique of compliance-framework-security-foundation-migration.test.ts.
 *
 * Every test runs inside ONE transaction that is always rolled back: the schema,
 * the fixture, the migration, every grant and every row disappear with it.
 *
 * The connecting role (`postgres` in CI and locally) is a superuser, which
 * row-level security never restricts. Every RLS, grant and tenant-integrity
 * assertion therefore runs after `SET LOCAL ROLE devcontrol` -- the application's
 * role (NOLOGIN here, so SET ROLE is the only way to act as it) -- and first
 * asserts that the acting role is neither a superuser nor BYPASSRLS.
 */
import { Client } from 'pg';
import * as fs from 'fs';
import * as path from 'path';

const MIGRATION_FILE = '202610112300_create_framework_evaluation_persistence.sql';
const ROLLBACK_FILE = '202610112300_create_framework_evaluation_persistence_rollback.sql';
const ADMIN_DIR = path.join(__dirname, '../../../../database/migrations-admin');
const MIGRATION_SQL = fs.readFileSync(path.join(ADMIN_DIR, MIGRATION_FILE), 'utf8');
const ROLLBACK_SQL = fs.readFileSync(path.join(ADMIN_DIR, ROLLBACK_FILE), 'utf8');

const RUNS = 'framework_evaluation_runs';
const CHECKS = 'compliance_check_evaluations';
const RECONCILIATIONS = 'framework_evaluation_reconciliations';
const TABLES = [RUNS, CHECKS, RECONCILIATIONS];
const OWN_CONSTRAINT = 'aws_resources_compliance_evaluation_ref_key';
/** The constraint the pending resource-health migration adds, and refuses to run over. */
const OTHER_CONSTRAINT = 'aws_resources_id_org_unique';

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

/** The production shapes this migration touches. */
async function createFixture(client: Client): Promise<void> {
  await client.query(`CREATE TABLE organizations (id UUID PRIMARY KEY DEFAULT gen_random_uuid(), name VARCHAR(255) NOT NULL)`);
  await client.query(`
    CREATE TABLE aws_resources (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      resource_arn VARCHAR(255) NOT NULL,
      resource_type VARCHAR(50) NOT NULL,
      compliance_issues JSONB DEFAULT '[]',
      UNIQUE (organization_id, resource_arn)
    )
  `);
  await client.query(`
    CREATE TABLE resource_discovery_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      organization_id UUID NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
      status VARCHAR(50) NOT NULL DEFAULT 'running'
    )
  `);
  await client.query(`
    CREATE TABLE schema_migrations (
      id SERIAL PRIMARY KEY,
      migration_name VARCHAR(255) UNIQUE NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    )
  `);
}

/**
 * What the pending resource-health migration does to aws_resources, with its own
 * guard: it refuses when its constraint NAME already exists, adds the constraint,
 * and creates a table whose foreign key references (id, organization_id).
 */
async function applyOtherMigration(client: Client): Promise<void> {
  await client.query(`
    DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = '${OTHER_CONSTRAINT}' AND conrelid = 'aws_resources'::regclass) THEN
        RAISE EXCEPTION '${OTHER_CONSTRAINT} already exists -- refusing to proceed.';
      END IF;
    END $$;
  `);
  await client.query(`ALTER TABLE aws_resources ADD CONSTRAINT ${OTHER_CONSTRAINT} UNIQUE (id, organization_id)`);
  await client.query(`
    CREATE TABLE other_results (
      resource_id UUID NOT NULL,
      organization_id UUID NOT NULL,
      CONSTRAINT other_results_resource_fk FOREIGN KEY (resource_id, organization_id)
        REFERENCES aws_resources (id, organization_id) ON DELETE CASCADE
    )
  `);
}

let schemaCounter = 0;

async function inIsolatedSchema(
  fn: (client: Client, schema: string) => Promise<void>,
  { migrate = true, before }: { migrate?: boolean; before?: (client: Client) => Promise<void> } = {}
): Promise<void> {
  const client = new Client(dbConfig());
  await client.connect();
  const schema = `fw_eval_mig_test_${process.pid}_${Date.now()}_${schemaCounter++}`;
  try {
    await client.query('BEGIN');
    await client.query(`CREATE SCHEMA ${schema}`);
    // Schema-only search_path: nothing here can resolve against real tables of the same name.
    await client.query(`SET LOCAL search_path TO ${schema}`);
    await createFixture(client);
    if (before) await before(client);
    if (migrate) await client.query(MIGRATION_SQL);
    await fn(client, schema);
  } finally {
    await client.query('ROLLBACK').catch(() => undefined);
    await client.end();
  }
}

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

/** Lets devcontrol reach the isolated schema and the fixture tables, then acts as it. */
async function actAsApplicationRole(client: Client, schema: string): Promise<void> {
  await client.query(`GRANT USAGE ON SCHEMA ${schema} TO devcontrol`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON organizations, aws_resources, resource_discovery_jobs TO devcontrol`);
  await client.query('SET LOCAL ROLE devcontrol');
  const { rows } = await client.query('SELECT current_user AS who, rolsuper OR rolbypassrls AS bypasses FROM pg_roles WHERE rolname = current_user');
  expect(rows[0]).toEqual({ who: 'devcontrol', bypasses: false });
}

async function setOrganization(client: Client, organizationId: string | null): Promise<void> {
  await client.query(`SELECT set_config('app.current_organization_id', $1, true)`, [organizationId ?? '']);
}

async function seedTwoOrganizations(client: Client) {
  const orgA = (await client.query(`INSERT INTO organizations (name) VALUES ('A') RETURNING id`)).rows[0].id as string;
  const orgB = (await client.query(`INSERT INTO organizations (name) VALUES ('B') RETURNING id`)).rows[0].id as string;
  const resource = async (org: string, arn: string) =>
    (await client.query(`INSERT INTO aws_resources (organization_id, resource_arn, resource_type) VALUES ($1, $2, 'ebs') RETURNING id`, [org, arn])).rows[0].id as string;
  const job = async (org: string) =>
    (await client.query(`INSERT INTO resource_discovery_jobs (organization_id) VALUES ($1) RETURNING id`, [org])).rows[0].id as string;
  return {
    orgA, orgB,
    resourceA: await resource(orgA, 'arn:a'), resourceB: await resource(orgB, 'arn:b'),
    jobA: await job(orgA), jobB: await job(orgB),
  };
}

const INSERT_RUN = `
  INSERT INTO ${RUNS} (organization_id, framework, applicability, applicability_reason_code, discovery_job_id, evaluator_version)
  VALUES ($1, 'HIPAA', 'enabled', 'explicitly_enabled', $2, '1')
  RETURNING id, generation::text AS generation`;

const INSERT_CHECK = `
  INSERT INTO ${CHECKS}
    (organization_id, resource_id, source_kind, source_key, check_key, evaluation_state, severity,
     evidence_basis, provenance, reason_code, error_code, run_generation, evaluator_version)
  VALUES ($1, $2, 'framework', 'HIPAA', $3, $4, $5, $6, NULL, 'no_backup_reported', $7, $8, '1')`;

/** Which unique constraint a foreign key is bound to. */
async function constraintBehind(client: Client, table: string, fkName: string): Promise<string> {
  const { rows } = await client.query(
    `SELECT uq.conname
       FROM pg_constraint fk
       JOIN pg_constraint uq ON uq.conindid = fk.conindid AND uq.contype IN ('u', 'p') AND uq.conrelid = fk.confrelid
      WHERE fk.conname = $1 AND fk.conrelid = $2::regclass`,
    [fkName, table]
  );
  return rows[0]?.conname;
}

async function tablesPresent(client: Client): Promise<boolean[]> {
  const { rows } = await client.query(`SELECT to_regclass(name) IS NOT NULL AS present FROM unnest($1::text[]) AS name`, [TABLES]);
  return rows.map((r) => r.present);
}

async function hasConstraint(client: Client, name: string): Promise<boolean> {
  const { rows } = await client.query(`SELECT 1 FROM pg_constraint WHERE conname = $1 AND conrelid = 'aws_resources'::regclass`, [name]);
  return rows.length === 1;
}

describe('fresh installation', () => {
  it('creates the three tables, owned by the migrating role, with row-level security enabled and forced', async () => {
    await inIsolatedSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT relname, relrowsecurity, relforcerowsecurity, pg_get_userbyid(relowner) = current_user AS owned_by_migrator
           FROM pg_class WHERE oid = ANY($1::regclass[]) ORDER BY relname`,
        [TABLES]
      );
      expect(rows).toEqual(
        [CHECKS, RECONCILIATIONS, RUNS].map((relname) => ({ relname, relrowsecurity: true, relforcerowsecurity: true, owned_by_migrator: true }))
      );
    });
  });

  it('gives each table exactly one FOR ALL policy with the tenant expression as USING and WITH CHECK', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { rows } = await client.query(
        `SELECT tablename, cmd, qual, with_check FROM pg_policies WHERE schemaname = $1 ORDER BY tablename`,
        [schema]
      );
      expect(rows).toEqual(
        [CHECKS, RECONCILIATIONS, RUNS].map((tablename) => ({ tablename, cmd: 'ALL', qual: TENANT_EXPRESSION, with_check: TENANT_EXPRESSION }))
      );
    });
  });

  it('grants devcontrol SELECT, INSERT, UPDATE and DELETE on each table and nothing else', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const { rows } = await client.query(
        `SELECT table_name, array_agg(privilege_type::text ORDER BY privilege_type) AS privileges
           FROM information_schema.role_table_grants
          WHERE table_schema = $1 AND grantee = 'devcontrol' AND table_name = ANY($2)
          GROUP BY table_name ORDER BY table_name`,
        [schema, TABLES]
      );
      expect(rows).toEqual(
        [CHECKS, RECONCILIATIONS, RUNS].map((table_name) => ({ table_name, privileges: ['DELETE', 'INSERT', 'SELECT', 'UPDATE'] }))
      );
    });
  });

  it('records no foreign key from check state to run history, so pruning runs cannot reach current state', async () => {
    await inIsolatedSchema(async (client) => {
      const { rows } = await client.query(
        `SELECT conname FROM pg_constraint WHERE contype = 'f' AND confrelid = '${RUNS}'::regclass`
      );
      expect(rows).toEqual([]);
    });
  });

  it('refuses to run a second time, and leaves the first installation intact', async () => {
    await inIsolatedSchema(async (client) => {
      const error = await failureOf(client, MIGRATION_SQL);
      expect(error.message).toMatch(/already exists -- this migration creates them and refuses to proceed/);
      expect(await tablesPresent(client)).toEqual([true, true, true]);
    });
  });

  it.each([
    ['organizations', /organizations does not exist/],
    ['aws_resources', /aws_resources does not exist/],
    ['resource_discovery_jobs', /resource_discovery_jobs does not exist/],
  ])('refuses when %s is missing', async (table, message) => {
    await inIsolatedSchema(async (client) => {
      await client.query(`DROP TABLE ${table} CASCADE`);
      expect((await failureOf(client, MIGRATION_SQL)).message).toMatch(message);
    }, { migrate: false });
  });
});

describe('ordering with the pending resource-health migration (aws_resources id/organization uniqueness)', () => {
  it('this migration first: adds its own constraint, binds its foreign keys to it, and leaves the other name free', async () => {
    await inIsolatedSchema(async (client) => {
      expect(await hasConstraint(client, OWN_CONSTRAINT)).toBe(true);
      expect(await hasConstraint(client, OTHER_CONSTRAINT)).toBe(false);
      expect(await constraintBehind(client, CHECKS, 'compliance_check_evaluations_resource_fk')).toBe(OWN_CONSTRAINT);
      expect(await constraintBehind(client, RECONCILIATIONS, 'framework_evaluation_reconciliations_resource_fk')).toBe(OWN_CONSTRAINT);

      // The other migration then applies unedited: its guard looks only for its own name.
      await applyOtherMigration(client);
      expect(await hasConstraint(client, OTHER_CONSTRAINT)).toBe(true);
    });
  });

  it('the other migration first: reuses its constraint and adds no redundant one', async () => {
    await inIsolatedSchema(async (client) => {
      expect(await hasConstraint(client, OWN_CONSTRAINT)).toBe(false);
      expect(await constraintBehind(client, CHECKS, 'compliance_check_evaluations_resource_fk')).toBe(OTHER_CONSTRAINT);
      expect(await constraintBehind(client, RECONCILIATIONS, 'framework_evaluation_reconciliations_resource_fk')).toBe(OTHER_CONSTRAINT);
      const { rows } = await client.query(
        `SELECT count(*)::int AS n FROM pg_constraint WHERE conrelid = 'aws_resources'::regclass AND contype = 'u'
            AND pg_get_constraintdef(oid) = 'UNIQUE (id, organization_id)'`
      );
      expect(rows[0].n).toBe(1);
    }, { before: applyOtherMigration });
  });

  it('does not treat a constraint over the same columns in another order, or over more columns, as suitable', async () => {
    await inIsolatedSchema(async (client) => {
      expect(await hasConstraint(client, OWN_CONSTRAINT)).toBe(true);
    }, {
      before: async (client) => {
        await client.query(`ALTER TABLE aws_resources ADD CONSTRAINT reversed UNIQUE (organization_id, id)`);
        await client.query(`ALTER TABLE aws_resources ADD CONSTRAINT wider UNIQUE (id, organization_id, resource_arn)`);
      },
    });
  });
});

describe('rollback', () => {
  const ledger = (client: Client) => client.query(`INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, 'x'), ('other.sql', 'y')`, [MIGRATION_FILE]);

  it('removes the three tables, its own constraint and its own ledger row, and nothing else', async () => {
    await inIsolatedSchema(async (client) => {
      await ledger(client);
      await client.query(ROLLBACK_SQL);

      expect(await tablesPresent(client)).toEqual([false, false, false]);
      expect(await hasConstraint(client, OWN_CONSTRAINT)).toBe(false);
      expect((await client.query(`SELECT migration_name FROM schema_migrations`)).rows).toEqual([{ migration_name: 'other.sql' }]);
      expect((await client.query(`SELECT to_regclass('aws_resources') IS NOT NULL AS present`)).rows[0].present).toBe(true);

      // And the migration can be applied again afterwards.
      await client.query(MIGRATION_SQL);
      expect(await tablesPresent(client)).toEqual([true, true, true]);
    });
  });

  it('never drops a constraint it reused: the other migration\'s constraint and table survive', async () => {
    await inIsolatedSchema(async (client) => {
      await client.query(ROLLBACK_SQL);
      expect(await tablesPresent(client)).toEqual([false, false, false]);
      expect(await hasConstraint(client, OTHER_CONSTRAINT)).toBe(true);
      expect(await constraintBehind(client, 'other_results', 'other_results_resource_fk')).toBe(OTHER_CONSTRAINT);
    }, { before: applyOtherMigration });
  });

  it('this migration first, the other second: the rollback drops its tables and keeps its constraint exactly when the other foreign key was bound to it', async () => {
    await inIsolatedSchema(async (client) => {
      await applyOtherMigration(client);
      const otherBoundTo = await constraintBehind(client, 'other_results', 'other_results_resource_fk');

      await client.query(ROLLBACK_SQL);

      expect(await tablesPresent(client)).toEqual([false, false, false]);
      // Never dropped from under a dependent; dropped when nothing depends on it.
      expect(await hasConstraint(client, OWN_CONSTRAINT)).toBe(otherBoundTo === OWN_CONSTRAINT);
      expect(await hasConstraint(client, OTHER_CONSTRAINT)).toBe(true);
      // The other table's foreign key still works either way.
      const org = (await client.query(`INSERT INTO organizations (name) VALUES ('A') RETURNING id`)).rows[0].id;
      const res = (await client.query(`INSERT INTO aws_resources (organization_id, resource_arn, resource_type) VALUES ($1, 'arn', 'ebs') RETURNING id`, [org])).rows[0].id;
      await client.query(`INSERT INTO other_results (resource_id, organization_id) VALUES ($1, $2)`, [res, org]);
    });
  });

  it('refuses, without cascading, when another table references one of its tables', async () => {
    await inIsolatedSchema(async (client) => {
      await client.query(`CREATE TABLE dependent (run_id UUID REFERENCES ${RUNS}(id))`);
      const error = await failureOf(client, ROLLBACK_SQL);
      expect(error.message).toMatch(/referenced by other foreign keys \(.*dependent.*\) -- refusing to drop them/);
      expect(await tablesPresent(client)).toEqual([true, true, true]);
    });
  });

  it('refuses when the migration is not applied', async () => {
    await inIsolatedSchema(async (client) => {
      expect((await failureOf(client, ROLLBACK_SQL)).message).toMatch(/not applied here; nothing to roll back/);
    }, { migrate: false });
  });

  it('contains no CASCADE', () => {
    const statements = ROLLBACK_SQL.split('\n').filter((line) => !line.trim().startsWith('--')).join('\n');
    expect(statements).not.toMatch(/\bCASCADE\b/i);
  });
});

describe('as the application role: identity column, grants and forced row-level security', () => {
  it('inserts a run without any sequence privilege, and the database assigns increasing generations', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const seed = await seedTwoOrganizations(client);
      // What the role holds on the identity sequence: nothing was granted.
      const { rows: sequence } = await client.query(
        `SELECT pg_get_serial_sequence('${schema}.${RUNS}', 'generation') AS name`
      );
      expect(sequence[0].name).toBe(`${schema}.${RUNS}_generation_seq`);
      const { rows: privileges } = await client.query(
        `SELECT has_sequence_privilege('devcontrol', $1, 'USAGE') AS usage,
                has_sequence_privilege('devcontrol', $1, 'SELECT') AS read,
                has_sequence_privilege('devcontrol', $1, 'UPDATE') AS write`,
        [sequence[0].name]
      );
      expect(privileges[0]).toEqual({ usage: false, read: false, write: false });

      await actAsApplicationRole(client, schema);
      await setOrganization(client, seed.orgA);
      const first = (await client.query(INSERT_RUN, [seed.orgA, seed.jobA])).rows[0];
      const second = (await client.query(INSERT_RUN, [seed.orgA, seed.jobA])).rows[0];
      expect(BigInt(second.generation)).toBeGreaterThan(BigInt(first.generation));

      // The value is the database's: the role cannot supply or change it.
      expect((await failureOf(client,
        `INSERT INTO ${RUNS} (organization_id, generation, framework, applicability, applicability_reason_code, evaluator_version)
         VALUES ($1, 999999, 'HIPAA', 'enabled', 'explicitly_enabled', '1')`, [seed.orgA])).code).toBe('428C9');
      expect((await failureOf(client, `UPDATE ${RUNS} SET generation = 1 WHERE id = $1`, [first.id])).code).toBe('428C9');
      // And it cannot read the sequence directly, so it cannot see how far other tenants have advanced it.
      expect((await failureOf(client, `SELECT last_value FROM ${RUNS}_generation_seq`)).code).toBe('42501');
    });
  });

  it('reads, updates and deletes its own organization\'s rows in all three tables', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const seed = await seedTwoOrganizations(client);
      await actAsApplicationRole(client, schema);
      await setOrganization(client, seed.orgA);

      const run = (await client.query(INSERT_RUN, [seed.orgA, seed.jobA])).rows[0];
      await client.query(INSERT_CHECK, [seed.orgA, seed.resourceA, 'hipaa.automated_backups', 'failed', 'critical', 'aws_api', null, run.generation]);
      await client.query(
        `INSERT INTO ${RECONCILIATIONS} (organization_id, resource_id, failure_code, last_run_generation) VALUES ($1, $2, 'persist_error', $3)`,
        [seed.orgA, seed.resourceA, run.generation]
      );

      for (const table of TABLES) {
        expect((await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`, [seed.orgA])).rows[0].n).toBe(1);
      }
      expect((await client.query(
        `UPDATE ${RUNS} SET status = 'complete', finished_at = clock_timestamp(), resources_in_scope = 1, resources_persisted = 1, resources_failed = 0 WHERE id = $1`,
        [run.id]
      )).rowCount).toBe(1);
      expect((await client.query(`UPDATE ${CHECKS} SET reason_code = 'backup_state_unknown' WHERE organization_id = $1`, [seed.orgA])).rowCount).toBe(1);
      for (const table of [RECONCILIATIONS, CHECKS, RUNS]) {
        expect((await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [seed.orgA])).rowCount).toBe(1);
      }
      // TRUNCATE is not granted: row-level security does not apply to it.
      expect((await failureOf(client, `TRUNCATE ${CHECKS}`)).code).toBe('42501');
    });
  });

  it('cannot read, write, update or delete another organization\'s rows, and reads nothing with no organization context', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const seed = await seedTwoOrganizations(client);
      // B's rows, written as the migrating role.
      const runB = (await client.query(INSERT_RUN, [seed.orgB, seed.jobB])).rows[0];
      await client.query(INSERT_CHECK, [seed.orgB, seed.resourceB, 'hipaa.automated_backups', 'failed', 'critical', 'aws_api', null, runB.generation]);
      await client.query(
        `INSERT INTO ${RECONCILIATIONS} (organization_id, resource_id, failure_code, last_run_generation) VALUES ($1, $2, 'persist_error', $3)`,
        [seed.orgB, seed.resourceB, runB.generation]
      );

      await actAsApplicationRole(client, schema);

      await setOrganization(client, null);
      for (const table of TABLES) {
        expect((await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
      }

      await setOrganization(client, seed.orgA);
      for (const table of TABLES) {
        // With and without an explicit predicate naming B.
        expect((await client.query(`SELECT count(*)::int AS n FROM ${table}`)).rows[0].n).toBe(0);
        expect((await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`, [seed.orgB])).rows[0].n).toBe(0);
        expect((await client.query(`DELETE FROM ${table} WHERE organization_id = $1`, [seed.orgB])).rowCount).toBe(0);
      }
      expect((await client.query(`UPDATE ${RUNS} SET status = 'failed', failure_code = 'unexpected', finished_at = clock_timestamp() WHERE id = $1`, [runB.id])).rowCount).toBe(0);
      expect((await client.query(`UPDATE ${CHECKS} SET reason_code = 'x' WHERE organization_id = $1`, [seed.orgB])).rowCount).toBe(0);

      // Writing a row FOR another organization is rejected by WITH CHECK.
      expect((await failureOf(client, INSERT_RUN, [seed.orgB, seed.jobB])).code).toBe('42501');
      expect((await failureOf(client, INSERT_CHECK,
        [seed.orgB, seed.resourceB, 'hipaa.s3_versioning', 'unable_to_evaluate', null, 'none', null, 1])).code).toBe('42501');
      // Moving an own row to another organization is rejected too.
      const runA = (await client.query(INSERT_RUN, [seed.orgA, seed.jobA])).rows[0];
      expect((await failureOf(client, `UPDATE ${RUNS} SET organization_id = $1 WHERE id = $2`, [seed.orgB, runA.id])).code).toBe('42501');

      // B's rows are untouched.
      await client.query('RESET ROLE');
      for (const table of TABLES) {
        expect((await client.query(`SELECT count(*)::int AS n FROM ${table} WHERE organization_id = $1`, [seed.orgB])).rows[0].n).toBe(1);
      }
    });
  });

  it('cannot attach an evaluation to another organization\'s resource: the composite foreign key rejects it', async () => {
    await inIsolatedSchema(async (client, schema) => {
      const seed = await seedTwoOrganizations(client);
      await actAsApplicationRole(client, schema);
      await setOrganization(client, seed.orgA);
      const run = (await client.query(INSERT_RUN, [seed.orgA, seed.jobA])).rows[0];

      // A's own row, pointing at B's resource: passes the policy (organization_id is A), fails the key.
      const error = await failureOf(client, INSERT_CHECK,
        [seed.orgA, seed.resourceB, 'hipaa.automated_backups', 'failed', 'critical', 'aws_api', null, run.generation]);
      expect(error).toMatchObject({ code: '23503', constraint: 'compliance_check_evaluations_resource_fk' });
      const reconciliation = await failureOf(client,
        `INSERT INTO ${RECONCILIATIONS} (organization_id, resource_id, failure_code, last_run_generation) VALUES ($1, $2, 'persist_error', 1)`,
        [seed.orgA, seed.resourceB]);
      expect(reconciliation).toMatchObject({ code: '23503', constraint: 'framework_evaluation_reconciliations_resource_fk' });
    });
  });
});

describe('constraints', () => {
  async function withRun(fn: (client: Client, seed: Awaited<ReturnType<typeof seedTwoOrganizations>>, generation: string) => Promise<void>) {
    await inIsolatedSchema(async (client) => {
      const seed = await seedTwoOrganizations(client);
      const run = (await client.query(INSERT_RUN, [seed.orgA, seed.jobA])).rows[0];
      await fn(client, seed, run.generation);
    });
  }

  // [state, severity, evidence_basis, error_code] -> the constraint that rejects it, or null when it is valid.
  const checkCases: Array<[string, string, string | null, string, string | null, string | null]> = [
    ['a failure with a severity and AWS evidence', 'failed', 'critical', 'aws_api', null, null],
    ['a pass with AWS evidence and no severity', 'passed', null, 'aws_api', null, null],
    ['unable_to_evaluate with no evidence', 'unable_to_evaluate', null, 'none', null, null],
    ['unable_to_evaluate from a tag', 'unable_to_evaluate', null, 'tag', null, null],
    ['an error with a code', 'error', null, 'none', 'check_exception', null],
    ['not_evaluated', 'not_evaluated', null, 'none', null, null],
    ['not_applicable', 'not_applicable', null, 'none', null, null],
    ['a failure without a severity', 'failed', null, 'aws_api', null, 'compliance_check_evaluations_severity_only_on_failed'],
    ['a pass carrying a severity', 'passed', 'high', 'aws_api', null, 'compliance_check_evaluations_severity_only_on_failed'],
    ['unable_to_evaluate carrying Critical', 'unable_to_evaluate', 'critical', 'none', null, 'compliance_check_evaluations_severity_only_on_failed'],
    ['an error carrying High', 'error', 'high', 'none', 'check_exception', 'compliance_check_evaluations_severity_only_on_failed'],
    ['not_evaluated carrying a severity', 'not_evaluated', 'low', 'none', null, 'compliance_check_evaluations_severity_only_on_failed'],
    ['not_applicable carrying a severity', 'not_applicable', 'medium', 'none', null, 'compliance_check_evaluations_severity_only_on_failed'],
    ['a failure resting on a tag', 'failed', 'critical', 'tag', null, 'compliance_check_evaluations_conclusive_needs_evidence'],
    ['a pass resting on a tag', 'passed', null, 'tag', null, 'compliance_check_evaluations_conclusive_needs_evidence'],
    ['a pass resting on nothing', 'passed', null, 'none', null, 'compliance_check_evaluations_conclusive_needs_evidence'],
    ['an error without a code', 'error', null, 'none', null, 'compliance_check_evaluations_error_code_only_on_error'],
    ['a pass with an error code', 'passed', null, 'aws_api', 'check_exception', 'compliance_check_evaluations_error_code_only_on_error'],
    ['a state nobody defined', 'unknown', null, 'none', null, 'compliance_check_evaluations_evaluation_state_check'],
    ['a severity nobody defined', 'failed', 'severe', 'aws_api', null, 'compliance_check_evaluations_severity_check'],
    ['error text where a code belongs', 'error', null, 'none', 'AccessDenied: arn:aws:iam::1:role/x', 'compliance_check_evaluations_error_code_check'],
  ];

  it.each(checkCases)('check row: %s', async (_name, state, severity, basis, errorCode, rejectedBy) => {
    await withRun(async (client, seed, generation) => {
      const params = [seed.orgA, seed.resourceA, 'hipaa.automated_backups', state, severity, basis, errorCode, generation];
      if (rejectedBy === null) {
        await client.query(INSERT_CHECK, params);
      } else {
        expect(await failureOf(client, INSERT_CHECK, params)).toMatchObject({ code: '23514', constraint: rejectedBy });
      }
    });
  });

  it('check row: codes and keys are format-checked, so free text cannot be stored in them', async () => {
    await withRun(async (client, seed, generation) => {
      const insert = (column: string, value: string) => {
        const row: Record<string, string> = {
          source_kind: 'framework', source_key: 'HIPAA', check_key: 'hipaa.x', evidence_basis: 'none', reason_code: 'no_setting',
          [column]: value,
        };
        return failureOf(client,
          `INSERT INTO ${CHECKS} (organization_id, resource_id, source_kind, source_key, check_key, evaluation_state, evidence_basis, reason_code, run_generation, evaluator_version)
           VALUES ($1, $2, $4, $5, $6, 'not_evaluated', $7, $8, $3, '1')`,
          [seed.orgA, seed.resourceA, generation, row.source_kind, row.source_key, row.check_key, row.evidence_basis, row.reason_code]);
      };
      for (const [column, value] of [
        ['reason_code', 'Bucket policy unavailable (AccessDenied)'],
        ['check_key', 'HIPAA: S3 lacks logging'],
        ['source_key', 'x; DROP TABLE y'],
        ['source_kind', 'Framework'],
        ['evidence_basis', 'AWS API'],
      ]) {
        expect((await insert(column, value)).code).toBe('23514');
      }
    });
  });

  it('check row: evidence must be a small object with a schema_version', async () => {
    await withRun(async (client, seed, generation) => {
      const withEvidence = (evidence: string) =>
        `INSERT INTO ${CHECKS} (organization_id, resource_id, source_kind, source_key, check_key, evaluation_state, evidence_basis, reason_code, run_generation, evaluator_version, evidence)
         VALUES ('${seed.orgA}', '${seed.resourceA}', 'framework', 'HIPAA', 'hipaa.e', 'not_evaluated', 'none', 'no_setting', ${generation}, '1', '${evidence}'::jsonb)`;
      await client.query(withEvidence('{"schema_version": 1, "has_backup": false}'));
      await client.query(`DELETE FROM ${CHECKS}`);
      // Incompressible, so the stored size really exceeds the cap.
      const oversized = JSON.stringify({ schema_version: 1, blob: Array.from({ length: 6000 }, () => Math.random().toString(36)).join('') });
      for (const bad of ['{"has_backup": false}', '[1]', '"text"', oversized]) {
        expect(await failureOf(client, withEvidence(bad))).toMatchObject({ code: '23514', constraint: 'compliance_check_evaluations_evidence_shape' });
      }
    });
  });

  it('check row: the last conclusive result has a severity only when it was a failure', async () => {
    await withRun(async (client, seed, generation) => {
      const sql = `INSERT INTO ${CHECKS} (organization_id, resource_id, source_kind, source_key, check_key, evaluation_state, evidence_basis, reason_code, run_generation, evaluator_version,
                                last_conclusive_state, last_conclusive_at, last_conclusive_severity)
          VALUES ($1, $2, 'framework', 'HIPAA', 'hipaa.l', 'unable_to_evaluate', 'none', 'backup_state_unknown', $3, '1', $4, $5::timestamptz, $6)`;
      const params = (shape: Array<string | null>) => [seed.orgA, seed.resourceA, generation, ...shape];

      for (const valid of [[null, null, null], ['passed', '2026-01-01', null], ['failed', '2026-01-01', 'critical']]) {
        await client.query(sql, params(valid));
        await client.query(`DELETE FROM ${CHECKS}`);
      }
      for (const invalid of [['passed', '2026-01-01', 'high'], ['failed', '2026-01-01', null], ['failed', null, 'high'], [null, '2026-01-01', null], [null, null, 'low']]) {
        expect(await failureOf(client, sql, params(invalid))).toMatchObject({ code: '23514', constraint: 'compliance_check_evaluations_last_conclusive_shape' });
      }
    });
  });

  it('run: lifecycle and the complete/partial rule', async () => {
    await withRun(async (client, seed) => {
      const run = async () => (await client.query(INSERT_RUN, [seed.orgA, seed.jobA])).rows[0].id as string;
      const finish = (id: string, set: string) => failureOf(client, `UPDATE ${RUNS} SET ${set} WHERE id = '${id}'`);
      const done = `finished_at = clock_timestamp(), resources_in_scope = 2, resources_persisted`;

      await client.query(`UPDATE ${RUNS} SET status = 'complete', ${done} = 2, resources_failed = 0 WHERE id = $1`, [await run()]);
      await client.query(`UPDATE ${RUNS} SET status = 'partial', ${done} = 1, resources_failed = 1 WHERE id = $1`, [await run()]);
      await client.query(`UPDATE ${RUNS} SET status = 'failed', failure_code = 'abandoned', finished_at = clock_timestamp() WHERE id = $1`, [await run()]);

      expect((await finish(await run(), `status = 'complete', ${done} = 1, resources_failed = 1`)).constraint).toBe('framework_evaluation_runs_complete_no_failures');
      expect((await finish(await run(), `status = 'partial', ${done} = 2, resources_failed = 0`)).constraint).toBe('framework_evaluation_runs_partial_has_failures');
      expect((await finish(await run(), `status = 'complete'`)).constraint).toBe('framework_evaluation_runs_lifecycle');
      expect((await finish(await run(), `status = 'failed', finished_at = clock_timestamp()`)).constraint).toBe('framework_evaluation_runs_lifecycle');
      expect((await finish(await run(), `failure_code = 'unexpected'`)).constraint).toBe('framework_evaluation_runs_lifecycle');
      expect((await finish(await run(), `applicability = 'on'`)).code).toBe('23514');
      expect((await finish(await run(), `failure_code = 'AccessDenied on table'`)).code).toMatch(/^(23514|22001)$/);
    });
  });

  it('deleting a resource removes its evaluations; deleting a discovery job keeps the run; deleting runs keeps check rows', async () => {
    await withRun(async (client, seed, generation) => {
      await client.query(INSERT_CHECK, [seed.orgA, seed.resourceA, 'hipaa.automated_backups', 'failed', 'critical', 'aws_api', null, generation]);
      await client.query(
        `INSERT INTO ${RECONCILIATIONS} (organization_id, resource_id, failure_code, last_run_generation) VALUES ($1, $2, 'persist_error', $3)`,
        [seed.orgA, seed.resourceA, generation]
      );

      await client.query(`DELETE FROM resource_discovery_jobs WHERE id = $1`, [seed.jobA]);
      expect((await client.query(`SELECT discovery_job_id FROM ${RUNS}`)).rows).toEqual([{ discovery_job_id: null }]);

      await client.query(`DELETE FROM ${RUNS}`);
      expect((await client.query(`SELECT count(*)::int AS n FROM ${CHECKS}`)).rows[0].n).toBe(1);

      await client.query(`DELETE FROM aws_resources WHERE id = $1`, [seed.resourceA]);
      expect((await client.query(`SELECT count(*)::int AS n FROM ${CHECKS}`)).rows[0].n).toBe(0);
      expect((await client.query(`SELECT count(*)::int AS n FROM ${RECONCILIATIONS}`)).rows[0].n).toBe(0);
    });
  });
});
