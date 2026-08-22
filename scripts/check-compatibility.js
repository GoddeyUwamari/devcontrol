/**
 * Read-only release-compatibility evaluator (Phase 3F).
 *
 * Lives at the repo root's scripts/ dir (alongside the existing, similarly
 * standalone scripts/run-migrations.js) rather than inside database/,
 * deliberately: database/ is packaged verbatim by the deploy-migration-
 * tooling CI job (`tar czf migrations.tar.gz -C database .`) and shipped to
 * the production host -- this evaluator and its companion declaration file
 * (release-compatibility.json, also repo-root) are repo-side tooling, not
 * part of that shipped artifact's contract.
 *
 * Computes, fresh on every invocation, one of four statuses for a given
 * release declaration against the *current* live schema_migrations /
 * migration_tracking_baseline state:
 *
 *   COMPATIBLE     — declared migration present, ledger checksum-clean globally.
 *   INCOMPATIBLE   — declared migration absent, AND attested (in the frozen
 *                    declaration itself) to postdate a specific baseline that
 *                    matches the live migration_tracking_baseline row.
 *   SCHEMA-UNKNOWN — absence cannot be trusted (no baseline, ambiguous
 *                    baseline, pre-baseline migration, missing/mismatched
 *                    attestation, or any checksum mismatch anywhere in the
 *                    ledger).
 *   RELEASE-UNKNOWN — no declaration at all for this release.
 *
 * This never writes anything, never caches a result, and never performs a
 * git-history check itself — "postdates baseline" is a fact the declaration
 * must already carry (established once, by a human, in a repository-aware
 * environment, at declaration-authoring time). See
 * database/migrations/README.md's --execute-only section for why this tool
 * deliberately does not call git: the deployed migration-tooling artifact on
 * the production host has no .git directory, so any such check would
 * silently behave differently depending on environment.
 *
 * Reuses database/migrate.js's exports directly (getClient, getBaseline,
 * getPendingMigrations, getMigrationFiles, MIGRATIONS_DIR) — no ledger-
 * reading logic is duplicated here.
 */
const path = require('path');
const { execSync } = require('child_process');
const {
  getClient,
  getBaseline,
  getPendingMigrations,
  getMigrationFiles,
  MIGRATIONS_DIR,
} = require('../database/migrate.js');

/**
 * Pure evaluation: given a connected client, a migrations directory, and a
 * declaration object ({ minimum_required_migration, baseline_repository_ref,
 * post_baseline_verified }), returns { status, detail }.
 *
 * Throws (does not return a status) if minimum_required_migration is set but
 * names a file that doesn't exist under migrationsDir — that's a broken
 * declaration, not a compatibility state, and should fail loudly rather than
 * be silently classified as any of the four statuses.
 */
async function evaluateCompatibility({ client, migrationsDir, declaration }) {
  const {
    minimum_required_migration: requiredMigration,
    baseline_repository_ref: declaredBaselineRef,
    post_baseline_verified: postBaselineVerified,
  } = declaration || {};

  if (!requiredMigration) {
    return {
      status: 'RELEASE-UNKNOWN',
      detail: 'No release-compatibility declaration is present for this release.',
    };
  }

  const files = getMigrationFiles(migrationsDir);
  if (!files.includes(requiredMigration)) {
    throw new Error(
      `Declared minimum_required_migration "${requiredMigration}" does not exist in ` +
      `${migrationsDir}. This is a broken declaration (or the migration file was renamed/` +
      `removed since the declaration was authored) -- not a compatibility state. Fix the ` +
      `declaration; do not interpret this as SCHEMA-UNKNOWN.`
    );
  }

  const { rows: baselineRows } = await client.query(
    'SELECT COUNT(*)::int AS count FROM migration_tracking_baseline'
  );
  const baselineCount = baselineRows[0].count;

  if (baselineCount === 0) {
    return {
      status: 'SCHEMA-UNKNOWN',
      detail: 'No migration_tracking_baseline row exists. Historical migration-execution ' +
        'provenance is unresolved; absence from schema_migrations cannot be trusted.',
    };
  }
  if (baselineCount > 1) {
    return {
      status: 'SCHEMA-UNKNOWN',
      detail: `${baselineCount} migration_tracking_baseline rows exist -- the baseline is ` +
        'ambiguous. Refusing to silently pick one; this must be investigated before any ' +
        'INCOMPATIBLE determination can be trusted.',
    };
  }

  const { pending, mismatched } = await getPendingMigrations(client, migrationsDir);

  if (mismatched.length > 0) {
    return {
      status: 'SCHEMA-UNKNOWN',
      detail: `Checksum mismatch in schema_migrations for: ${mismatched.map((m) => m.file).join(', ')}. ` +
        'The ledger\'s integrity cannot be trusted anywhere while any row is mismatched -- ' +
        'this mirrors migrate.js\'s own global fail-closed rule.',
    };
  }

  const isAbsent = pending.some((p) => p.file === requiredMigration);

  if (!isAbsent) {
    return {
      status: 'COMPATIBLE',
      detail: `${requiredMigration} is present in schema_migrations and the ledger is ` +
        'checksum-clean globally.',
    };
  }

  if (postBaselineVerified === true && declaredBaselineRef) {
    const baseline = await getBaseline(client);
    if (baseline && baseline.repository_ref === declaredBaselineRef) {
      return {
        status: 'INCOMPATIBLE',
        detail: `${requiredMigration} is declared post-baseline (attested against ` +
          `${declaredBaselineRef}, matching the live baseline) and is absent from ` +
          'schema_migrations.',
      };
    }
    return {
      status: 'SCHEMA-UNKNOWN',
      detail: `Declaration's baseline_repository_ref (${declaredBaselineRef}) does not match ` +
        `the live migration_tracking_baseline row's repository_ref ` +
        `(${baseline ? baseline.repository_ref : 'none'}). Refusing to trust the ` +
        'post-baseline attestation against a baseline it was not verified against.',
    };
  }

  return {
    status: 'SCHEMA-UNKNOWN',
    detail: `${requiredMigration} is absent from schema_migrations, but is not attested as ` +
      'post-baseline. Historical execution provenance for a pre-baseline (or unattested) ' +
      'migration is unresolved and must not be inferred from absence.',
  };
}

/**
 * Reads a release declaration from a specific git commit, read-only, via
 * `git show`. Requires a repository-aware environment (a developer checkout
 * or CI) with full history for the given ref -- NEVER intended to run on the
 * production host, which has no .git directory at all. Mirrors exactly the
 * same environment restriction --execute-only's own precondition already
 * documents.
 */
function fetchDeclarationFromGit(releaseSha, repoRoot) {
  const raw = execSync(
    `git show ${releaseSha}:release-compatibility.json`,
    { cwd: repoRoot, encoding: 'utf8' }
  );
  const parsed = JSON.parse(raw);
  return {
    minimum_required_migration: parsed.minimum_required_migration ?? null,
    baseline_repository_ref: parsed.baseline_repository_ref ?? null,
    post_baseline_verified: parsed.post_baseline_verified ?? null,
  };
}

/**
 * Reads the release declaration for whichever release is currently running,
 * via the live /version endpoint. This is the mode intended to run on the
 * production host (or anywhere with network access to the API) -- no git
 * required.
 */
function fetchDeclarationFromVersionEndpoint(baseUrl) {
  return new Promise((resolve, reject) => {
    const client = baseUrl.startsWith('https') ? require('https') : require('http');
    client
      .get(`${baseUrl.replace(/\/$/, '')}/version`, (res) => {
        let body = '';
        res.on('data', (chunk) => { body += chunk; });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(body);
            resolve({
              minimum_required_migration: parsed.minimum_required_migration ?? null,
              baseline_repository_ref: parsed.baseline_repository_ref ?? null,
              post_baseline_verified: parsed.post_baseline_verified ?? null,
            });
          } catch (err) {
            reject(err);
          }
        });
      })
      .on('error', reject);
  });
}

async function main(argv) {
  const releaseShaFlagIdx = argv.indexOf('--release-sha');
  const releaseSha = releaseShaFlagIdx !== -1 ? argv[releaseShaFlagIdx + 1] : null;
  const versionUrlFlagIdx = argv.indexOf('--version-url');
  const versionUrl = versionUrlFlagIdx !== -1 ? argv[versionUrlFlagIdx + 1] : 'http://localhost:3001';

  const declaration = releaseSha
    ? fetchDeclarationFromGit(releaseSha, path.join(__dirname, '..'))
    : await fetchDeclarationFromVersionEndpoint(versionUrl);

  const client = getClient();
  await client.connect();
  try {
    const result = await evaluateCompatibility({ client, migrationsDir: MIGRATIONS_DIR, declaration });
    console.log(JSON.stringify({ declaration, ...result }, null, 2));
  } finally {
    await client.end();
  }
}

module.exports = {
  evaluateCompatibility,
  fetchDeclarationFromGit,
  fetchDeclarationFromVersionEndpoint,
};

if (require.main === module) {
  main(process.argv.slice(2)).catch((error) => {
    console.error('Fatal error:', error.message);
    process.exit(1);
  });
}
