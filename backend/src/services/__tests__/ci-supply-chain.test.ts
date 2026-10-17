/**
 * CI supply-chain hardening in .github/workflows/*.yml.
 *
 *  - admin-pg-lockfile.js: the admin migration artifact's node_modules/pg
 *    is derived from the repo's package-lock.json (exercised against the
 *    real lockfile and small, deliberately broken ones), and the
 *    deploy-migration-tooling-admin job installs it with npm ci.
 *
 * ci.yml is parsed as text, like the other ci.yml tests in this directory.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { buildAdminPgManifest, verifyStage } = require('../../../../.github/scripts/admin-pg-lockfile.js');

const REPO_ROOT = path.join(__dirname, '../../../../');
const CI_WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const LOCK_PATH = path.join(REPO_ROOT, 'package-lock.json');
const ciYml = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
const rootLock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));

// Anchored to the job's own `  <name>:` line ('deploy-migration-tooling' is
// a prefix of 'deploy-migration-tooling-admin').
function extractJobBlock(jobName: string): string {
  const match = ciYml.match(new RegExp(`\\n  ${jobName}:\\n[\\s\\S]*?(?=\\n {2}\\S|\\n?$)`));
  if (!match) throw new Error(`Could not locate job "${jobName}" in ci.yml`);
  return match[0];
}

function extractStep(jobName: string, stepName: string): string {
  const job = extractJobBlock(jobName);
  const start = job.indexOf(`- name: ${stepName}`);
  if (start === -1) throw new Error(`Could not locate step "${stepName}" in job "${jobName}"`);
  const next = job.indexOf('\n      - name:', start + 1);
  return next === -1 ? job.slice(start) : job.slice(start, next);
}

function entry(version: string, deps: Record<string, string> = {}, extra: Record<string, unknown> = {}) {
  return {
    version,
    resolved: `https://registry.npmjs.org/x/-/x-${version}.tgz`,
    integrity: `sha512-${version}`,
    ...(Object.keys(deps).length ? { dependencies: deps } : {}),
    ...extra,
  };
}

/** A minimal valid lockfile: pg -> a (-> c), optional pg -> b. */
function fixtureLock(): any {
  return {
    name: 'fixture',
    lockfileVersion: 3,
    requires: true,
    packages: {
      '': { name: 'fixture', dependencies: { pg: '^1.0.0', unrelated: '^1.0.0' } },
      'node_modules/pg': entry('1.2.3', { a: '^1.0.0' }, { optionalDependencies: { b: '^1.0.0' } }),
      'node_modules/a': entry('1.0.0', { c: '^1.0.0' }),
      'node_modules/b': entry('1.0.0', {}, { optional: true }),
      'node_modules/c': entry('1.0.0', {}, { dev: true }),
      'node_modules/unrelated': entry('9.9.9'),
    },
  };
}

describe('admin-pg-lockfile.js — derived from the real package-lock.json', () => {
  const { packageJson, packageLock, packages } = buildAdminPgManifest(rootLock);
  const lockedPg = rootLock.packages['node_modules/pg'].version;

  it('pins pg to exactly the locked version', () => {
    expect(packageJson.dependencies).toEqual({ pg: lockedPg });
    expect(packageLock.packages[''].dependencies).toEqual({ pg: lockedPg });
    expect(packages.pg).toBe(lockedPg);
  });

  it('copies every package with its locked version, resolved URL and integrity', () => {
    for (const [name, version] of Object.entries(packages)) {
      const source = rootLock.packages[`node_modules/${name}`];
      const copied = packageLock.packages[`node_modules/${name}`];
      expect({ name, version: copied.version, resolved: copied.resolved, integrity: copied.integrity }).toEqual({
        name,
        version: source.version,
        resolved: source.resolved,
        integrity: source.integrity,
      });
      expect(version).toBe(source.version);
      expect(copied.integrity).toMatch(/^sha512-/);
    }
  });

  it('is closed: every dependency and optional dependency of every package is included', () => {
    for (const name of Object.keys(packages)) {
      const e = packageLock.packages[`node_modules/${name}`];
      for (const dep of Object.keys({ ...(e.dependencies || {}), ...(e.optionalDependencies || {}) })) {
        expect({ from: name, dep, included: dep in packages }).toEqual({ from: name, dep, included: true });
      }
    }
    expect(Object.keys(packageLock.packages).filter((k) => k !== '').sort()).toEqual(
      Object.keys(packages).map((n) => `node_modules/${n}`).sort()
    );
  });

  it('does not pull in pg-native (an optional PEER dependency)', () => {
    expect(packages).not.toHaveProperty('pg-native');
  });
});

describe('admin-pg-lockfile.js — buildAdminPgManifest on fixtures', () => {
  it('walks dependencies and optionalDependencies, recomputes role flags, ignores unrelated packages', () => {
    const { packages, packageLock } = buildAdminPgManifest(fixtureLock());
    expect(packages).toEqual({ a: '1.0.0', b: '1.0.0', c: '1.0.0', pg: '1.2.3' });
    expect(packageLock.packages['node_modules/b'].optional).toBe(true);
    expect(packageLock.packages['node_modules/a'].optional).toBeUndefined();
    // c is dev-only relative to the fixture root, but required by pg here.
    expect(packageLock.packages['node_modules/c'].dev).toBeUndefined();
    expect(packageLock.packages['node_modules/c'].optional).toBeUndefined();
  });

  it('a package reached through both an optional and a required edge is required', () => {
    const lock = fixtureLock();
    lock.packages['node_modules/a'].dependencies.b = '^1.0.0';
    expect(buildAdminPgManifest(lock).packageLock.packages['node_modules/b'].optional).toBeUndefined();
  });

  it.each<[string, (lock: any) => void, RegExp]>([
    ['not lockfileVersion 3', (l) => { l.lockfileVersion = 2; }, /lockfileVersion 3/],
    ['no pg at all', (l) => { delete l.packages['node_modules/pg']; }, /exactly one top-level "node_modules\/pg"/],
    ['a second, nested pg', (l) => { l.packages['backend/node_modules/pg'] = entry('2.0.0'); }, /exactly one top-level "node_modules\/pg"/],
    ['pg only nested, not top-level', (l) => {
      l.packages['backend/node_modules/pg'] = l.packages['node_modules/pg'];
      delete l.packages['node_modules/pg'];
    }, /exactly one top-level "node_modules\/pg"/],
    ['a dependency with no entry', (l) => { delete l.packages['node_modules/c']; }, /"c" \(needed by pg\) has no top-level/],
    ['a dependency with no integrity', (l) => { delete l.packages['node_modules/a'].integrity; }, /"node_modules\/a" .* has no integrity/],
    ['a dependency with no resolved URL', (l) => { delete l.packages['node_modules/b'].resolved; }, /"node_modules\/b" .* has no resolved/],
    ['a dependency with nested node_modules', (l) => { l.packages['node_modules/a/node_modules/c'] = entry('0.1.0'); }, /"a" has nested node_modules/],
  ])('refuses %s', (_label, mutate, error) => {
    const lock = fixtureLock();
    mutate(lock);
    expect(() => buildAdminPgManifest(lock)).toThrow(error);
  });
});

describe('admin-pg-lockfile.js — verifyStage', () => {
  let dir: string;
  let lockPath: string;

  function install(name: string, version: string): void {
    fs.mkdirSync(path.join(dir, 'node_modules', name), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', name, 'package.json'), JSON.stringify({ name, version }));
  }

  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), 'admin-pg-verify-'));
    lockPath = path.join(dir, 'root-lock.json');
    fs.writeFileSync(lockPath, JSON.stringify(fixtureLock()));
    for (const [n, v] of Object.entries({ pg: '1.2.3', a: '1.0.0', b: '1.0.0', c: '1.0.0' })) install(n, v);
    fs.writeFileSync(path.join(dir, 'node_modules', '.package-lock.json'), '{}');
  });

  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it('passes when node_modules holds exactly the locked packages', () => {
    expect(verifyStage(lockPath, dir)).toEqual([]);
  });

  it('passes when an optional package was skipped', () => {
    fs.rmSync(path.join(dir, 'node_modules', 'b'), { recursive: true });
    expect(verifyStage(lockPath, dir)).toEqual([]);
  });

  it('reports a wrong version, a missing required package and an extra package', () => {
    install('pg', '1.2.4');
    fs.rmSync(path.join(dir, 'node_modules', 'c'), { recursive: true });
    install('surprise', '1.0.0');
    expect(verifyStage(lockPath, dir).sort()).toEqual(
      ['missing c@1.0.0', 'pg: installed 1.2.4, locked 1.2.3', 'unexpected package in node_modules: surprise'].sort()
    );
  });
});

describe('deploy-migration-tooling-admin packages pg from the lockfile', () => {
  const packageStep = extractStep('deploy-migration-tooling-admin', 'Package self-contained admin migration artifact');
  const validateStep = extractStep('deploy-migration-tooling-admin', 'Validate packaged admin artifact contents');

  it('writes the derived project, installs it with npm ci inside $STAGE, then verifies it', () => {
    const write = packageStep.indexOf('node .github/scripts/admin-pg-lockfile.js write package-lock.json "$STAGE"');
    const ci = packageStep.indexOf('(cd "$STAGE" && npm ci --omit=dev --ignore-scripts --no-audit --no-fund)');
    const verify = packageStep.indexOf('node .github/scripts/admin-pg-lockfile.js verify package-lock.json "$STAGE"');
    const tar = packageStep.indexOf('tar czf migrations-admin.tar.gz');
    expect(write).toBeGreaterThan(-1);
    expect(ci).toBeGreaterThan(write);
    expect(verify).toBeGreaterThan(ci);
    expect(tar).toBeGreaterThan(verify);
  });

  it('never runs npm install anywhere in the job', () => {
    expect(extractJobBlock('deploy-migration-tooling-admin')).not.toMatch(/npm install/);
  });

  it('the validate step fails unless the shipped pg equals the locked pg', () => {
    expect(validateStep).toContain(`require('./package-lock.json').packages['node_modules/pg'].version`);
    expect(validateStep).toContain('tar xzf migrations-admin.tar.gz -O ./node_modules/pg/package.json');
    expect(validateStep).toContain('[ "$SHIPPED_PG" = "$LOCKED_PG" ] || {');
  });
});
