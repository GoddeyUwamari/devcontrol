/**
 * CI-only schema bootstrap for the ephemeral `lint-and-build` postgres
 * service container. Never runs against production, and does not modify
 * database/migrate.js — it calls the same exported runMigrations() the
 * canonical runner itself uses (same checksum tracking, advisory lock,
 * per-migration transaction), just pointed at a filtered copy combining
 * database/migrations/ and database/migrations-admin/ into one directory.
 *
 * Excludes 026_api_keys_org_scoping.sql and 027_webhook_endpoints_org_scoping.sql:
 * database/migrations/README.md already documents these as unrunnable
 * against any database ("Do not execute" / "Never run") — both ALTER
 * api_keys/webhook_endpoints, tables no migration in this repo's history
 * (canonical or legacy) ever creates. Excluding exactly these two,
 * confirmed by that same README to be dead migrations rather than ones
 * this CI job happens to skip for convenience, is what lets every other
 * migration apply cleanly to a brand-new database.
 *
 * Administrative migrations (ones requiring ownership-level DDL in
 * production, e.g. ENABLE ROW LEVEL SECURITY on a postgres-owned table)
 * live in database/migrations-admin/ so the *production* runner
 * (connecting as the non-superuser `devcontrol` role) never sweeps them
 * automatically -- see database/migrations-admin/README.md. That
 * production-ownership restriction does not apply here: this job's own
 * "Create devcontrol role for CI schema bootstrap" step aside, both this
 * bootstrap and the subsequent test run connect as `postgres` (the actual
 * superuser of the ephemeral container), so there is no ownership
 * distinction for CI to enforce. Eligible files from both directories are
 * therefore combined into a single temp directory and applied through one
 * runMigrations() call, letting the runner's existing alphabetical
 * filename sort -- not a second pass -- resolve cross-directory ordering
 * (e.g. an admin-classified migration that ALTERs a table an ordinary
 * migration creates).
 *
 * One admin migration is excluded from this CI sweep for a reason
 * unrelated to ownership: 202608221231_enable_rls_on_anomaly_rules.sql
 * intentionally RAISE EXCEPTIONs unless the pre-existing production table
 * `anomaly_rules` already exists with an exact assumed shape -- no
 * migration in this repository creates that table, so it cannot succeed
 * against any fresh database, CI included. This is not a workaround; it
 * reflects exactly what that migration's own file says about itself.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Client } = require('pg');
const { runMigrations } = require('../../database/migrate.js');

const SOURCE_DIRS = [
  path.join(__dirname, '..', '..', 'database', 'migrations'),
  path.join(__dirname, '..', '..', 'database', 'migrations-admin'),
];
const EXCLUDED = new Set([
  '026_api_keys_org_scoping.sql',
  '027_webhook_endpoints_org_scoping.sql',
  '202608221231_enable_rls_on_anomaly_rules.sql',
]);

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-migrations-'));
  for (const sourceDir of SOURCE_DIRS) {
    for (const file of fs.readdirSync(sourceDir)) {
      if (!file.endsWith('.sql') || file.includes('rollback') || EXCLUDED.has(file)) continue;
      fs.copyFileSync(path.join(sourceDir, file), path.join(tmpDir, file));
    }
  }

  const client = new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  });
  await client.connect();
  try {
    const result = await runMigrations({ client, migrationsDir: tmpDir });
    console.log(`✅ CI schema bootstrap complete: ${result.executed.length} migrations applied`);
  } finally {
    await client.end();
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

main().catch((err) => {
  console.error('❌ CI schema bootstrap failed:', err.message);
  process.exit(1);
});
