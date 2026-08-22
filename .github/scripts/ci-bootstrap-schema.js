/**
 * CI-only schema bootstrap for the ephemeral `lint-and-build` postgres
 * service container. Never runs against production, and does not modify
 * database/migrate.js — it calls the same exported runMigrations() the
 * canonical runner itself uses (same checksum tracking, advisory lock,
 * per-migration transaction), just pointed at a filtered copy of
 * database/migrations/.
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
 * Also excludes 202608221231_enable_rls_on_anomaly_rules.sql for the same
 * reason: it ALTERs the pre-existing, production-only anomaly_rules table
 * (see that migration's own header) and deliberately refuses to run against
 * any database where anomaly_rules doesn't already exist -- which a fresh
 * CI database never will. Its own comments document that it must only ever
 * be run via `--execute-only` against production, never via a blanket
 * --pending run; this is that same constraint applied to CI's bootstrap.
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Client } = require('pg');
const { runMigrations } = require('../../database/migrate.js');

const SOURCE_DIR = path.join(__dirname, '..', '..', 'database', 'migrations');
const EXCLUDED = new Set([
  '026_api_keys_org_scoping.sql',
  '027_webhook_endpoints_org_scoping.sql',
  '202608221231_enable_rls_on_anomaly_rules.sql',
]);

async function main() {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ci-migrations-'));
  for (const file of fs.readdirSync(SOURCE_DIR)) {
    if (!file.endsWith('.sql') || file.includes('rollback') || EXCLUDED.has(file)) continue;
    fs.copyFileSync(path.join(SOURCE_DIR, file), path.join(tmpDir, file));
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
