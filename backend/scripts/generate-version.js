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

const releaseSha = resolveSha();
const builtAt = new Date().toISOString();

const content = `// Auto-generated at build time by backend/scripts/generate-version.js.
// Do not edit by hand -- regenerated on every "npm run build" / "npm run dev".
export const RELEASE_SHA = ${JSON.stringify(releaseSha)};
export const BUILT_AT = ${JSON.stringify(builtAt)};
`;

fs.writeFileSync(path.join(__dirname, '..', 'src', 'version.ts'), content);
console.log(`Generated src/version.ts -- RELEASE_SHA=${releaseSha}`);
