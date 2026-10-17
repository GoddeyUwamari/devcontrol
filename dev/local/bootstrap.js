/**
 * Builds the local database idempotently, connected as the container's
 * `postgres` superuser:
 *
 *   1. the `devcontrol` role the migrations GRANT to (NOLOGIN, as in CI);
 *   2. the schema, by running CI's own .github/scripts/ci-bootstrap-schema.js
 *      (same directory merge and exclusions, same migration ledger), so the
 *      local schema is exactly what CI tests against;
 *   3. dev/local/reconstructed-tables.sql, for tables no migration creates;
 *   4. the application role `devcontrol_local`: LOGIN, NOSUPERUSER,
 *      NOBYPASSRLS, DML only (no CREATE on schema public, owns nothing) --
 *      row-level security applies to it as it does to production's
 *      `devcontrol`;
 *   5. the default admin from migrations-admin/005 deactivated, and checked.
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const REPO_ROOT = path.join(__dirname, '..', '..');
const CI_BOOTSTRAP = path.join(REPO_ROOT, '.github', 'scripts', 'ci-bootstrap-schema.js');
const RECONSTRUCTED_TABLES = path.join(__dirname, 'reconstructed-tables.sql');

const APP_ROLE = 'devcontrol_local';
// The fixed id migrations-admin/005 gives its default admin, whose password
// is published in that file.
const DEFAULT_ADMIN_ID = '00000000-0000-0000-0000-000000000002';

async function ensureRole(client, sql) {
  await client.query(`DO $$ BEGIN ${sql} EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
}

function runCiSchemaBootstrap(db) {
  const result = spawnSync(process.execPath, [CI_BOOTSTRAP], {
    cwd: REPO_ROOT,
    stdio: ['ignore', 'inherit', 'inherit'],
    env: {
      PATH: process.env.PATH,
      DB_HOST: db.host,
      DB_PORT: String(db.port),
      DB_NAME: db.database,
      DB_USER: 'postgres',
      DB_PASSWORD: db.superuserPassword,
    },
  });
  if (result.status !== 0) throw new Error('schema bootstrap (ci-bootstrap-schema.js) failed');
}

async function bootstrap(client, db) {
  await ensureRole(client, 'CREATE ROLE devcontrol NOLOGIN;');
  runCiSchemaBootstrap(db);

  await client.query(fs.readFileSync(RECONSTRUCTED_TABLES, 'utf8'));

  await ensureRole(client, `CREATE ROLE ${APP_ROLE} LOGIN;`);
  // Postgres 14 lets every role CREATE in schema public; the app role gets DML
  // only. Anything it created before this rule existed is dropped (DROP OWNED
  // also revokes its grants, which are re-granted below).
  await client.query('REVOKE CREATE ON SCHEMA public FROM PUBLIC');
  await client.query(`DROP OWNED BY ${APP_ROLE}`);
  // Re-asserted every run, so an existing role cannot keep stronger attributes.
  await client.query(
    `ALTER ROLE ${APP_ROLE} LOGIN NOSUPERUSER NOBYPASSRLS NOCREATEDB NOCREATEROLE NOREPLICATION PASSWORD '${db.appPassword.replace(/'/g, "''")}'`,
  );
  await client.query(`GRANT CONNECT ON DATABASE ${db.database} TO ${APP_ROLE}`);
  await client.query(`GRANT USAGE ON SCHEMA public TO ${APP_ROLE}`);
  await client.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO ${APP_ROLE}`);
  await client.query(`GRANT USAGE, SELECT, UPDATE ON ALL SEQUENCES IN SCHEMA public TO ${APP_ROLE}`);
  await client.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO ${APP_ROLE}`);

  await client.query('UPDATE organization_memberships SET is_active = false WHERE user_id = $1 AND is_active', [DEFAULT_ADMIN_ID]);
  await client.query('UPDATE users SET is_active = false WHERE id = $1 AND is_active', [DEFAULT_ADMIN_ID]);
  const { rows } = await client.query(
    `SELECT (SELECT count(*) FROM users WHERE id = $1 AND is_active)::int
          + (SELECT count(*) FROM organization_memberships WHERE user_id = $1 AND is_active)::int AS active`,
    [DEFAULT_ADMIN_ID],
  );
  if (rows[0].active !== 0) throw new Error('the published default admin from migrations-admin/005 is still active');

  const { rows: [role] } = await client.query(
    'SELECT rolsuper, rolbypassrls, rolcreatedb, rolcreaterole FROM pg_roles WHERE rolname = $1',
    [APP_ROLE],
  );
  const { rows: [extra] } = await client.query(
    `SELECT has_schema_privilege($1, 'public', 'CREATE') AS can_create,
            (SELECT count(*) FROM pg_class WHERE relowner = (SELECT oid FROM pg_roles WHERE rolname = $1))::int AS owned`,
    [APP_ROLE],
  );
  if (!role || role.rolsuper || role.rolbypassrls || role.rolcreatedb || role.rolcreaterole || extra.can_create || extra.owned > 0) {
    throw new Error(`${APP_ROLE} has privileges beyond DML`);
  }
}

module.exports = { bootstrap, APP_ROLE, DEFAULT_ADMIN_ID };
