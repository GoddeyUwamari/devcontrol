/**
 * CI-time validation of release-compatibility.json (Phase 3F).
 *
 * Mechanically automates, at merge/build time in a repository-aware
 * environment, exactly the manual precondition database/migrations/README.md
 * already documents for --execute-only operators: confirming a migration
 * genuinely postdates the recorded baseline by checking real git history.
 * This is categorically different from a runtime check inside
 * database/migrate.js on the production host -- that host has no .git
 * directory at all and never will (see migrate.js's own doc comments and
 * README's --execute-only section for why). CI has full history and runs
 * before merge; the production artifact never re-derives this fact.
 *
 * Validates, only when a declaration actually names a migration (an empty
 * `{}` -- no declaration yet -- always passes, nothing to check):
 *   1. minimum_required_migration names a file that exists in
 *      database/migrations/.
 *   2. baseline_repository_ref is present and resolves to a real commit in
 *      this repository's git history. (This proves structural validity
 *      only -- it does NOT and cannot prove the ref equals whatever is
 *      currently in production's live migration_tracking_baseline row; CI
 *      has no production database access, by design, and this script does
 *      not attempt to gain any.)
 *   3. post_baseline_verified is explicitly true or false (never
 *      missing/null -- it is a human attestation, never inferred).
 *   4. If post_baseline_verified is true: the declared migration file must
 *      NOT have existed in database/migrations/ at baseline_repository_ref.
 *      If it did, the declaration is objectively contradicted by git
 *      history and validation fails.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function readDeclaration(repoRoot) {
  const declarationPath = path.join(repoRoot, 'release-compatibility.json');
  if (!fs.existsSync(declarationPath)) return {};
  return JSON.parse(fs.readFileSync(declarationPath, 'utf8'));
}

function migrationExists(repoRoot, migrationName) {
  const migrationsDir = path.join(repoRoot, 'database', 'migrations');
  return fs.existsSync(migrationsDir) && fs.readdirSync(migrationsDir).includes(migrationName);
}

function refResolves(repoRoot, ref) {
  try {
    execSync(`git rev-parse --verify ${ref}^{commit}`, { cwd: repoRoot, stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

function existedAtRef(repoRoot, ref, migrationName) {
  const relPath = `database/migrations/${migrationName}`;
  const output = execSync(`git ls-tree -r --name-only ${ref} -- ${relPath}`, {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  return output.trim().length > 0;
}

/**
 * Validates a declaration against actual git history. Returns
 * { valid, errors[] }. Never throws for a bad *declaration* -- only for a
 * genuine tool-usage error (e.g. repoRoot not a git repository at all).
 */
function validateDeclaration({ repoRoot, declaration }) {
  const errors = [];
  const {
    minimum_required_migration: requiredMigration,
    baseline_repository_ref: baselineRef,
    post_baseline_verified: postBaselineVerified,
  } = declaration || {};

  if (!requiredMigration) {
    return { valid: true, errors: [] };
  }

  if (!migrationExists(repoRoot, requiredMigration)) {
    errors.push(
      `minimum_required_migration "${requiredMigration}" does not exist in database/migrations/.`
    );
  }

  let baselineRefValid = false;
  if (!baselineRef) {
    errors.push('baseline_repository_ref is required whenever minimum_required_migration is declared.');
  } else if (!refResolves(repoRoot, baselineRef)) {
    errors.push(
      `baseline_repository_ref "${baselineRef}" does not resolve to a real commit in this ` +
      'repository\'s git history.'
    );
  } else {
    baselineRefValid = true;
  }

  if (typeof postBaselineVerified !== 'boolean') {
    errors.push(
      'post_baseline_verified must be explicitly true or false, never missing/null -- it is a ' +
      'human attestation and must never be left to be inferred.'
    );
  }

  if (
    postBaselineVerified === true &&
    baselineRefValid &&
    migrationExists(repoRoot, requiredMigration) &&
    existedAtRef(repoRoot, baselineRef, requiredMigration)
  ) {
    errors.push(
      `post_baseline_verified is true, but "${requiredMigration}" already existed in ` +
      `database/migrations/ at ${baselineRef} -- this declaration is contradicted by git history.`
    );
  }

  return { valid: errors.length === 0, errors };
}

function main() {
  const repoRoot = path.join(__dirname, '..', '..');
  const declaration = readDeclaration(repoRoot);
  const result = validateDeclaration({ repoRoot, declaration });
  if (result.valid) {
    console.log('release-compatibility.json: valid (or no declaration present).');
    process.exit(0);
  }
  console.error('release-compatibility.json failed validation:');
  for (const err of result.errors) console.error(`  - ${err}`);
  process.exit(1);
}

module.exports = {
  validateDeclaration,
  readDeclaration,
  migrationExists,
  refResolves,
  existedAtRef,
};

if (require.main === module) {
  main();
}
