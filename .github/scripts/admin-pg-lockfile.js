/**
 * Pins the admin migration artifact's node_modules/pg to the repository's
 * own package-lock.json.
 *
 * deploy-migration-tooling-admin ships a self-contained migrate.js plus its
 * one runtime dependency, pg. It used to run `npm install pg`, which
 * resolved whatever pg (and pg's own dependencies) the registry offered at
 * deploy time. This script instead derives a tiny project from the root
 * lockfile -- pg at the exact locked version plus every package pg needs
 * (dependencies and optionalDependencies, transitively), each copied with
 * its locked version, resolved URL and integrity hash -- so the workflow can
 * install it with `npm ci`. npm ci refuses to run if package.json and the
 * lockfile disagree, installs exactly the locked versions, and checks every
 * tarball against the lockfile's sha512: the artifact gets the same bytes
 * the backend test suite ran against. Bumping pg in package-lock.json flows
 * through automatically; there is no second pin to drift.
 *
 * Node built-ins only (it runs before any npm install).
 *
 * Usage:
 *   node admin-pg-lockfile.js write  <package-lock.json> <stageDir>
 *     writes <stageDir>/package.json and <stageDir>/package-lock.json
 *   node admin-pg-lockfile.js verify <package-lock.json> <stageDir>
 *     checks <stageDir>/node_modules holds exactly the locked packages at
 *     the locked versions
 */
const fs = require('fs');
const path = require('path');

const ROOT_DEPENDENCY = 'pg';
// Lockfile-entry fields that describe a package's role relative to the
// ROOT project (dev/peer-only/optional reachability). They are recomputed
// for the derived project rather than copied.
const ROLE_FIELDS = ['dev', 'devOptional', 'peer', 'optional'];

function entryKey(name) {
  return `node_modules/${name}`;
}

/**
 * Derives { packageJson, packageLock, packages } from a parsed root
 * lockfile. `packages` maps each package name to its locked version. Throws
 * on anything that would make the derived install ambiguous or unverifiable.
 */
function buildAdminPgManifest(lock) {
  if (!lock || lock.lockfileVersion !== 3 || !lock.packages) {
    throw new Error('package-lock.json must be lockfileVersion 3 with a "packages" map');
  }
  const pgKeys = Object.keys(lock.packages).filter((k) => /(^|\/)node_modules\/pg$/.test(k));
  if (pgKeys.length !== 1 || pgKeys[0] !== entryKey(ROOT_DEPENDENCY)) {
    throw new Error(
      `expected exactly one top-level "node_modules/pg" entry in package-lock.json, found: ${JSON.stringify(pgKeys)}`
    );
  }

  // Walk pg's dependency graph through top-level entries. Track which
  // packages are reachable through required edges only, so anything reached
  // solely through an optionalDependencies edge stays optional.
  const closure = new Map();
  const required = new Set();
  const queue = [{ name: ROOT_DEPENDENCY, optional: false }];
  while (queue.length) {
    const { name, optional } = queue.shift();
    const seenRequired = required.has(name);
    if (closure.has(name) && (optional || seenRequired)) continue;

    const entry = lock.packages[entryKey(name)];
    if (!entry) {
      throw new Error(`"${name}" (needed by pg) has no top-level "node_modules/${name}" entry in package-lock.json`);
    }
    const nested = Object.keys(lock.packages).filter((k) => k.startsWith(`${entryKey(name)}/node_modules/`));
    if (nested.length) {
      throw new Error(`"${name}" has nested node_modules entries in package-lock.json (${nested.join(', ')}); refusing to flatten`);
    }
    for (const field of ['version', 'resolved', 'integrity']) {
      if (typeof entry[field] !== 'string' || entry[field] === '') {
        throw new Error(`"node_modules/${name}" in package-lock.json has no ${field}`);
      }
    }

    closure.set(name, entry);
    if (!optional) required.add(name);
    for (const dep of Object.keys(entry.dependencies || {})) queue.push({ name: dep, optional });
    for (const dep of Object.keys(entry.optionalDependencies || {})) queue.push({ name: dep, optional: true });
  }

  const pgVersion = closure.get(ROOT_DEPENDENCY).version;
  const name = 'devcontrol-admin-migrate';
  const packageJson = { name, private: true, dependencies: { [ROOT_DEPENDENCY]: pgVersion } };
  const lockPackages = { '': { name, dependencies: { [ROOT_DEPENDENCY]: pgVersion } } };
  const packages = {};
  for (const [pkg, entry] of [...closure.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    const copy = { ...entry };
    for (const field of ROLE_FIELDS) delete copy[field];
    if (!required.has(pkg)) copy.optional = true;
    lockPackages[entryKey(pkg)] = copy;
    packages[pkg] = entry.version;
  }
  const packageLock = { name, lockfileVersion: 3, requires: true, packages: lockPackages };
  return { packageJson, packageLock, packages };
}

function readLock(lockPath) {
  return JSON.parse(fs.readFileSync(lockPath, 'utf8'));
}

function writeStage(lockPath, stageDir) {
  const { packageJson, packageLock, packages } = buildAdminPgManifest(readLock(lockPath));
  fs.writeFileSync(path.join(stageDir, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`);
  fs.writeFileSync(path.join(stageDir, 'package-lock.json'), `${JSON.stringify(packageLock, null, 2)}\n`);
  return packages;
}

/**
 * Returns a list of problems (empty when <stageDir>/node_modules holds
 * exactly the locked packages, each at its locked version). Dot-entries
 * such as npm's own node_modules/.package-lock.json are ignored.
 */
function verifyStage(lockPath, stageDir) {
  const { packageLock, packages } = buildAdminPgManifest(readLock(lockPath));
  const nodeModules = path.join(stageDir, 'node_modules');
  const problems = [];
  const installed = fs.existsSync(nodeModules)
    ? fs.readdirSync(nodeModules).filter((n) => !n.startsWith('.'))
    : [];
  for (const extra of installed.filter((n) => !(n in packages))) {
    problems.push(`unexpected package in node_modules: ${extra}`);
  }
  for (const [pkg, version] of Object.entries(packages)) {
    const manifest = path.join(nodeModules, pkg, 'package.json');
    if (!fs.existsSync(manifest)) {
      // Optional packages (pg-cloudflare) may legitimately be skipped by npm.
      if (packageLock.packages[entryKey(pkg)].optional) continue;
      problems.push(`missing ${pkg}@${version}`);
      continue;
    }
    const actual = JSON.parse(fs.readFileSync(manifest, 'utf8')).version;
    if (actual !== version) problems.push(`${pkg}: installed ${actual}, locked ${version}`);
  }
  return problems;
}

function main() {
  const [mode, lockPath, stageDir] = process.argv.slice(2);
  if (!['write', 'verify'].includes(mode) || !lockPath || !stageDir) {
    console.error('usage: admin-pg-lockfile.js write|verify <package-lock.json> <stageDir>');
    process.exit(2);
  }
  try {
    if (mode === 'write') {
      const packages = writeStage(lockPath, stageDir);
      console.log(`admin pg project written from ${lockPath} (${Object.keys(packages).length} packages):`);
      for (const [pkg, version] of Object.entries(packages)) console.log(`  ${pkg}@${version}`);
      return;
    }
    const problems = verifyStage(lockPath, stageDir);
    if (problems.length) {
      console.error('admin pg install does not match package-lock.json:');
      for (const p of problems) console.error(`  - ${p}`);
      process.exit(1);
    }
    console.log('admin pg install matches package-lock.json');
  } catch (err) {
    console.error(`admin-pg-lockfile: ${err.message}`);
    process.exit(1);
  }
}

module.exports = { buildAdminPgManifest, writeStage, verifyStage };

if (require.main === module) {
  main();
}
