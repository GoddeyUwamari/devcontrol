/**
 * Database Migration Runner (canonical)
 *
 * Runs PostgreSQL migration scripts from database/migrations/, in filename
 * order, tracking successful execution in `schema_migrations` with a
 * SHA-256 checksum of each file's content at the time it was applied.
 *
 * This is the canonical migration runner for this repository. See
 * database/migrations/README.md for the full forensic/historical context —
 * in short: this runner's own ledger only covers migrations executed
 * through it from an explicitly-established baseline onward. It does not,
 * and cannot, retroactively prove what ran before that baseline.
 *
 * Usage:
 *   node database/migrate.js                          Run all pending migrations
 *   node database/migrate.js --dry-run                 List pending migrations without running them
 *   node database/migrate.js --pending                 Alias for --dry-run
 *   node database/migrate.js --init-baseline "<note>" [--repository-ref <ref>]
 *                                                       Establish the tracking baseline (one-time, refuses if
 *                                                       one already exists). --repository-ref is optional and
 *                                                       purely operator-supplied — e.g. a deployed git SHA —
 *                                                       never inferred or guessed by this script. Ignored
 *                                                       when --init-baseline is not also given.
 *
 * Environment Variables:
 * - DB_HOST: Database host (default: localhost)
 * - DB_PORT: Database port (default: 5432)
 * - DB_NAME: Database name (default: platform_portal)
 * - DB_USER: Database user (default: postgres)
 * - DB_PASSWORD: Database password
 */

const { Client } = require('pg');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const MIGRATIONS_DIR = path.join(__dirname, 'migrations');

// Arbitrary fixed key for a session-level advisory lock, scoped to this
// runner only — prevents two concurrent `node database/migrate.js`
// invocations from racing on the same pending migration.
const ADVISORY_LOCK_KEY = 727271;

function getClient(overrides = {}) {
  return new Client({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
    ...overrides,
  });
}

function computeChecksum(sql) {
  return crypto.createHash('sha256').update(sql, 'utf8').digest('hex');
}

/**
 * Bootstraps this runner's own tracking infrastructure. Both statements are
 * idempotent (IF NOT EXISTS) and scoped only to this runner's own ledger
 * tables — never to application schema. The ALTER is not a no-op for a
 * database that already has an old-shaped `schema_migrations` (created by a
 * pre-checksum version of this file, before this column existed): those
 * pre-existing rows get `checksum = NULL`, since ALTER ... ADD COLUMN can't
 * retroactively know what a row's checksum "should" be. See
 * `backfillLegacyChecksums`, always called immediately after this function
 * in `runMigrations`, for how those NULLs get resolved into real checksums
 * without ever fabricating one or weakening mismatch detection for rows
 * that already have a real checksum.
 *
 * IMPORTANT: this DDL has not been run against production as part of this
 * change. The first real invocation of this runner against any database —
 * including production — is what actually executes it there, and that must
 * be reviewed/approved as its own explicit, separate step.
 */
async function ensureTrackingTables(client) {
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      id SERIAL PRIMARY KEY,
      migration_name VARCHAR(255) UNIQUE NOT NULL,
      checksum VARCHAR(64) NOT NULL,
      executed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW()
    );
  `);
  await client.query(`
    ALTER TABLE schema_migrations ADD COLUMN IF NOT EXISTS checksum VARCHAR(64);
  `);
  // Deliberately a separate table from schema_migrations, not a fake row in
  // it — see database/migrations/README.md. A baseline is a forward-looking
  // marker ("tracking starts here"), never a claim that any historical
  // migration executed.
  await client.query(`
    CREATE TABLE IF NOT EXISTS migration_tracking_baseline (
      id SERIAL PRIMARY KEY,
      established_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW(),
      note TEXT NOT NULL,
      repository_ref VARCHAR(255)
    );
  `);
}

/**
 * Backfills `checksum` for `schema_migrations` rows left NULL by the ALTER
 * in `ensureTrackingTables` — rows recorded by a pre-checksum version of
 * this runner. Without this, every such row would be a permanent false
 * "checksum mismatch": `NULL !== <real checksum>` is always true in
 * `getPendingMigrations`, even though the file was never actually modified
 * — the row simply predates the column.
 *
 * Safety properties, each deliberate:
 *  - Only ever touches rows where `checksum IS NULL` (both the initial
 *    SELECT and the UPDATE's own `WHERE ... AND checksum IS NULL` guard) —
 *    a row that already has a real checksum is never read for this purpose
 *    and can never be overwritten, so mismatch detection for modern,
 *    already-checksummed rows is completely unaffected.
 *  - If the file a legacy row refers to no longer exists on disk (renamed
 *    or deleted at some point in this project's history — not hypothetical,
 *    see database/migrations/README.md's forensic-audit findings), this
 *    deliberately leaves that row's checksum NULL rather than fabricating
 *    one. Inventing a checksum for content that can't be verified is
 *    exactly the class of mistake the forensic audit exists to prevent.
 *    This is safe to leave unresolved: `getPendingMigrations` only ever
 *    looks up a ledger row by iterating actual files on disk, so a NULL
 *    checksum on an orphaned row (no matching file) is never read or
 *    compared again — permanently inert, not a latent landmine.
 *  - Existing rows are never deleted or recreated — only ever UPDATEd in
 *    place, preserving `id`/`executed_at`/history exactly as recorded.
 *  - Does not touch `migration_tracking_baseline` or interact with the
 *    baseline safety gate at all — this is pure ledger hygiene, orthogonal
 *    to whether a baseline exists.
 */
async function backfillLegacyChecksums(client, migrationsDir) {
  const { rows: legacyRows } = await client.query(
    'SELECT migration_name FROM schema_migrations WHERE checksum IS NULL'
  );
  if (legacyRows.length === 0) {
    return { backfilled: [], missingFiles: [] };
  }

  const backfilled = [];
  const missingFiles = [];

  for (const { migration_name: migrationName } of legacyRows) {
    const filePath = path.join(migrationsDir, migrationName);
    if (!fs.existsSync(filePath)) {
      missingFiles.push(migrationName);
      console.warn(
        `⚠️  Legacy ledger row "${migrationName}" has no corresponding file in ${migrationsDir} — ` +
        `leaving its checksum unset rather than fabricating one.`
      );
      continue;
    }

    const sql = fs.readFileSync(filePath, 'utf8');
    const checksum = computeChecksum(sql);
    await client.query(
      'UPDATE schema_migrations SET checksum = $1 WHERE migration_name = $2 AND checksum IS NULL',
      [checksum, migrationName]
    );
    backfilled.push(migrationName);
  }

  if (backfilled.length > 0) {
    console.log(
      `ℹ️  Backfilled checksum for ${backfilled.length} legacy migration record(s) ` +
      `(recorded before checksum tracking existed): ${backfilled.join(', ')}`
    );
  }

  return { backfilled, missingFiles };
}

/**
 * Conservative "does this database already contain application schema"
 * check. Used only to decide whether an unbaselined, ledger-empty database
 * is a genuinely fresh/disposable database (safe to run migrations against
 * from scratch) or an existing database of unknown historical provenance
 * (must not proceed without an explicit baseline — see the safety gate in
 * `runMigrations`).
 *
 * Deliberately schema-generic: introspects `information_schema.tables`
 * scoped to `current_schema()` — the single primary schema this session's
 * unqualified DDL actually lands in (first entry of the effective
 * search_path), not every schema reachable from it — excluding only this
 * runner's own two bookkeeping tables. No application table name is ever
 * hard-coded, so this doesn't need updating as application schema evolves.
 *
 * Deliberately `current_schema()` (singular), not `current_schemas(false)`
 * (plural, every schema on the search_path): a search_path of
 * `"$user", public` — or, in tests, an isolated disposable schema followed
 * by `public` as a fallback — would otherwise make this see unrelated
 * tables in `public` and report a false positive. Migrations themselves
 * run as unqualified DDL, so the schema they'd actually write into is the
 * only schema whose pre-existing contents matter here.
 *
 * Recomputed fresh on every call — never cached — so callers must invoke
 * this at the point they need the answer, not reuse a stale result.
 */
async function hasApplicationSchema(client) {
  const { rows } = await client.query(`
    SELECT table_schema, table_name
    FROM information_schema.tables
    WHERE table_schema = current_schema()
      AND table_name NOT IN ('schema_migrations', 'migration_tracking_baseline')
  `);
  return rows.length > 0;
}

function getMigrationFiles(migrationsDir) {
  return fs.readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql') && !file.includes('GUIDE') && !file.includes('rollback'))
    .sort();
}

async function getBaseline(client) {
  const { rows } = await client.query(
    'SELECT * FROM migration_tracking_baseline ORDER BY id LIMIT 1'
  );
  return rows[0] || null;
}

/**
 * Establishes the migration-tracking baseline. Refuses if one already
 * exists — a baseline is a one-time, deliberate marker, not something to
 * silently overwrite. Does NOT insert any row into `schema_migrations`;
 * establishing a baseline never records any migration as applied.
 */
async function initBaseline(client, note, repositoryRef) {
  const existing = await getBaseline(client);
  if (existing) {
    throw new Error(
      `Baseline already established at ${existing.established_at.toISOString()}: "${existing.note}". ` +
      `Refusing to create a second baseline.`
    );
  }
  if (!note || !note.trim()) {
    throw new Error(
      'A baseline note is required, e.g.: --init-baseline "production schema as of 2026-08-20; ' +
      'historical migration provenance not reconstructed, see database/migrations/README.md"'
    );
  }
  const { rows } = await client.query(
    `INSERT INTO migration_tracking_baseline (note, repository_ref) VALUES ($1, $2) RETURNING *`,
    [note, repositoryRef || null]
  );
  return rows[0];
}

async function getAppliedMigrations(client) {
  const { rows } = await client.query(
    'SELECT migration_name, checksum, executed_at FROM schema_migrations ORDER BY migration_name'
  );
  const map = new Map();
  for (const row of rows) map.set(row.migration_name, row);
  return map;
}

/**
 * Classifies every migration file on disk against the ledger:
 *  - pending: no ledger row yet
 *  - mismatched: ledger row exists, but the file's current checksum differs
 *    from the checksum recorded when it was applied — the file was edited
 *    after being applied. This is always treated as an error, never a
 *    silent skip or a silent re-run.
 */
async function getPendingMigrations(client, migrationsDir) {
  const applied = await getAppliedMigrations(client);
  const files = getMigrationFiles(migrationsDir);
  const pending = [];
  const mismatched = [];

  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    const checksum = computeChecksum(sql);
    const record = applied.get(file);

    if (!record) {
      pending.push({ file, checksum });
    } else if (record.checksum !== checksum) {
      mismatched.push({
        file,
        expectedChecksum: record.checksum,
        actualChecksum: checksum,
        recordedAt: record.executed_at,
      });
    }
  }

  return { files, pending, mismatched, appliedCount: applied.size };
}

/**
 * Runs pending migrations. `options.client` and `options.migrationsDir` are
 * injectable for testing against disposable fixtures; both default to the
 * real production-shaped connection/directory for CLI use.
 */
async function runMigrations(options = {}) {
  const {
    dryRun = false,
    initBaselineNote = null,
    repositoryRef = null,
    migrationsDir = MIGRATIONS_DIR,
    client: injectedClient = null,
  } = options;

  const client = injectedClient || getClient();
  const ownsConnection = !injectedClient;
  const result = { executed: [], mismatched: [], pending: [], baseline: null };

  try {
    if (ownsConnection) {
      console.log('🔌 Connecting to database...');
      await client.connect();
      console.log('✅ Connected to database');
    }

    await ensureTrackingTables(client);
    await backfillLegacyChecksums(client, migrationsDir);

    if (initBaselineNote !== null) {
      result.baseline = await initBaseline(client, initBaselineNote, repositoryRef);
      console.log(`✅ Baseline established: "${result.baseline.note}"`);
      console.log(`   at ${result.baseline.established_at.toISOString()}`);
      console.log('   This marks where forward migration tracking begins.');
      console.log('   It does NOT record that any historical migration executed.');
      return result;
    }

    // Fetched together, fresh, right before the decision below — never cached
    // or computed ahead of time. This runs before the advisory lock is
    // acquired and before any pending migration is executed.
    const baseline = await getBaseline(client);
    const { files, pending, mismatched, appliedCount } = await getPendingMigrations(client, migrationsDir);
    result.pending = pending.map((p) => p.file);
    result.mismatched = mismatched;
    const alreadyApplied = files.length - pending.length - mismatched.length;

    if (baseline) {
      console.log(`ℹ️  Baseline: "${baseline.note}" (established ${baseline.established_at.toISOString()})`);
    } else if (appliedCount > 0) {
      // Scenario 5: schema_migrations already has real rows recorded by this
      // runner, but no formal baseline was ever established. Those rows are
      // authentic evidence of prior runner-executed migrations (this runner
      // wrote them itself) — not a fabricated or inferred history — so it's
      // safe to continue treating this as an ordinary in-progress ledger.
      // This is intentionally distinct from, and does not satisfy, the
      // "existing application schema with zero ledger rows" case below.
      console.warn(`⚠️  No formal baseline established, but schema_migrations already has ${appliedCount} recorded migration(s).`);
      console.warn('   Treating existing ledger history as authentic and proceeding.');
      console.warn('   Consider running --init-baseline to document this database\'s starting point explicitly.');
    } else {
      // No baseline AND no ledger history. Safe only if the database is
      // genuinely empty (aside from this runner's own bookkeeping tables) —
      // otherwise this is exactly the dangerous "existing database of
      // unknown provenance" state and must fail closed.
      const appSchemaPresent = await hasApplicationSchema(client);
      if (appSchemaPresent) {
        throw new Error(
          'Refusing to run migrations: this database already contains application ' +
          'schema objects, but has no migration tracking baseline and no recorded ' +
          'migration history in schema_migrations. Running migrations now would ' +
          'attempt every migration from 001 onward against a database whose actual ' +
          'historical provenance is unknown — this is precisely the scenario the ' +
          'baseline mechanism exists to prevent.\n\n' +
          'Establish a baseline first, then re-run:\n' +
          '  node database/migrate.js --init-baseline "<note>"\n\n' +
          'See database/migrations/README.md for what a baseline does and does not mean.'
        );
      }
      console.warn('⚠️  No migration tracking baseline has been established yet.');
      console.warn('   Database appears genuinely empty (no application schema detected) — proceeding.');
    }

    console.log(
      `\n📁 Found ${files.length} migration file(s): ` +
      `${alreadyApplied} already applied, ${pending.length} pending, ${mismatched.length} checksum mismatch(es)`
    );

    if (mismatched.length > 0) {
      console.error('\n❌ Checksum mismatch — a previously-applied migration file has been modified:');
      for (const m of mismatched) {
        console.error(`   ${m.file}`);
        console.error(`     recorded checksum: ${m.expectedChecksum}  (applied ${m.recordedAt.toISOString()})`);
        console.error(`     current checksum:  ${m.actualChecksum}`);
      }
      console.error('\nRefusing to proceed. Do not edit an already-applied migration file — create a new one instead.');
      throw new Error('Checksum mismatch on previously-applied migration(s); refusing to proceed');
    }

    if (dryRun) {
      console.log('\n🔍 Dry run — pending migrations (not executed):');
      if (pending.length === 0) console.log('   (none)');
      pending.forEach((p) => console.log(`   - ${p.file}`));
      return result;
    }

    await client.query(`SELECT pg_advisory_lock(${ADVISORY_LOCK_KEY})`);
    try {
      for (const { file, checksum } of pending) {
        const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
        console.log(`\n🚀 Executing: ${file}`);
        try {
          await client.query('BEGIN');
          await client.query(sql);
          await client.query(
            'INSERT INTO schema_migrations (migration_name, checksum) VALUES ($1, $2)',
            [file, checksum]
          );
          await client.query('COMMIT');
          console.log(`✅ Applied: ${file}`);
          result.executed.push(file);
        } catch (error) {
          await client.query('ROLLBACK');
          console.error(`❌ Failed: ${file} — ${error.message}`);
          console.error('   Rolled back. Not recorded as applied.');
          throw error;
        }
      }
    } finally {
      await client.query(`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY})`);
    }

    console.log(`\n${'='.repeat(60)}`);
    console.log('📊 Migration Summary:');
    console.log(`   ✅ Executed this run: ${result.executed.length}`);
    console.log(`   ⏭️  Already applied:   ${alreadyApplied}`);
    console.log(`   📁 Total:             ${files.length}`);
    console.log('='.repeat(60));

    return result;
  } catch (error) {
    console.error('\n❌ Migration process failed:', error.message);
    throw error;
  } finally {
    if (ownsConnection) {
      await client.end();
      console.log('\n🔌 Database connection closed');
    }
  }
}

/**
 * Pure CLI argument parser — no I/O, no DB, no process access beyond the
 * array it's given. Deliberately factored out of the `require.main` block
 * so flag-parsing behavior (in particular --repository-ref, which is
 * purely operator-supplied and never inferred) is directly unit-testable
 * without spawning a subprocess or touching a database.
 */
function parseCliArgs(argv) {
  const dryRun = argv.includes('--dry-run') || argv.includes('--pending');
  const baselineFlagIdx = argv.indexOf('--init-baseline');
  const initBaselineNote = baselineFlagIdx !== -1 ? (argv[baselineFlagIdx + 1] || '') : null;
  // e.g. `--repository-ref $(cat .deployed_sha)` — never inferred
  // automatically. Only has any effect when combined with --init-baseline;
  // a no-op otherwise, matching runMigrations()'s own handling of the
  // option.
  const repositoryRefFlagIdx = argv.indexOf('--repository-ref');
  const repositoryRef = repositoryRefFlagIdx !== -1 ? (argv[repositoryRefFlagIdx + 1] || null) : null;

  return { dryRun, initBaselineNote, repositoryRef };
}

module.exports = {
  runMigrations,
  getPendingMigrations,
  getAppliedMigrations,
  getBaseline,
  initBaseline,
  ensureTrackingTables,
  backfillLegacyChecksums,
  hasApplicationSchema,
  computeChecksum,
  getMigrationFiles,
  getClient,
  parseCliArgs,
  MIGRATIONS_DIR,
  ADVISORY_LOCK_KEY,
};

if (require.main === module) {
  runMigrations(parseCliArgs(process.argv.slice(2))).catch((error) => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}
