/**
 * Generates backend/src/version.ts before every build (see package.json's
 * "build"/"dev" scripts). This is the ONLY place RELEASE_SHA is written --
 * the /version endpoint (server.ts) just re-exports the module compiled
 * from this generated file. There is deliberately no second, independently
 * -written marker (e.g. a runtime env var read, or a separate file dropped
 * on the host at deploy time) that could drift from what's actually in the
 * built artifact -- the embedded constant and what the endpoint reports are
 * the same single value, baked in at build time.
 *
 * SHA resolution never touches the production host: this script only runs
 * where a build happens (CI runners, or a developer's local checkout),
 * both of which have git / GITHUB_SHA available. The compiled dist/ that
 * actually ships to the production host never re-derives this value --
 * production has no git dependency at runtime.
 */
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

function resolveSha() {
  if (process.env.GITHUB_SHA) return process.env.GITHUB_SHA;
  try {
    return execSync('git rev-parse HEAD', { cwd: __dirname, encoding: 'utf8' }).trim();
  } catch {
    return 'unknown';
  }
}

// Reads the tracked, human-authored release-compatibility declaration from
// release-compatibility.json at the repo root (a sibling of both backend/
// and database/ -- deliberately NOT inside database/, since that directory
// is packaged verbatim into the migration-tooling deploy artifact and this
// declaration is release/backend-side metadata, not something that ships to
// the production host alongside migrate.js). Unlike RELEASE_SHA, these
// fields are never derived -- they are copied forward verbatim from a
// committed source, since version.ts itself is git-ignored and regenerated
// every build (see backend/.gitignore). A missing file means "no declaration
// for this release" (all fields null, evaluated as RELEASE-UNKNOWN
// downstream) -- that is not an error. Malformed JSON in a file that does
// exist IS an error and fails the build loudly, since that means someone's
// authored declaration is broken, not absent.
function resolveDeclaration() {
  const declarationPath = path.join(__dirname, '..', '..', 'release-compatibility.json');
  if (!fs.existsSync(declarationPath)) {
    return { minimum_required_migration: null, baseline_repository_ref: null, post_baseline_verified: null };
  }
  const raw = fs.readFileSync(declarationPath, 'utf8');
  const parsed = JSON.parse(raw);
  return {
    minimum_required_migration: parsed.minimum_required_migration ?? null,
    baseline_repository_ref: parsed.baseline_repository_ref ?? null,
    post_baseline_verified: parsed.post_baseline_verified ?? null,
  };
}

const releaseSha = resolveSha();
const builtAt = new Date().toISOString();
const declaration = resolveDeclaration();

const content = `// Auto-generated at build time by backend/scripts/generate-version.js.
// Do not edit by hand -- regenerated on every "npm run build" / "npm run dev".
export const RELEASE_SHA = ${JSON.stringify(releaseSha)};
export const BUILT_AT = ${JSON.stringify(builtAt)};
export const MINIMUM_REQUIRED_MIGRATION = ${JSON.stringify(declaration.minimum_required_migration)};
export const BASELINE_REPOSITORY_REF = ${JSON.stringify(declaration.baseline_repository_ref)};
export const POST_BASELINE_VERIFIED = ${JSON.stringify(declaration.post_baseline_verified)};
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'version.ts'), content);
console.log(`Generated src/version.ts -- RELEASE_SHA=${releaseSha}`);
