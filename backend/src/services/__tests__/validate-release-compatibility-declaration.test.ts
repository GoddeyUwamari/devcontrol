/**
 * Coverage for .github/scripts/validate-release-compatibility-declaration.js
 * (Phase 3F) and its CI wiring.
 *
 * Two concerns, same file convention as migrate-deploy.test.ts:
 *  - validateDeclaration() logic: exercised against small, real, disposable
 *    git repositories built fresh per test (git init in a temp dir, real
 *    commits) -- never the real repository's own history, never a mock of
 *    git. No Postgres connection anywhere in this file.
 *  - CI wiring: .github/workflows/ci.yml parsed as text, same
 *    extractJobBlock approach already used by migrate-deploy.test.ts, to
 *    confirm fetch-depth: 0 landed only on lint-and-build and no other job's
 *    checkout was touched.
 */

import { execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { validateDeclaration } = require('../../../../.github/scripts/validate-release-compatibility-declaration.js');

const REPO_ROOT = path.join(__dirname, '../../../../');
const CI_WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

function extractJobBlock(ciYml: string, jobName: string): string {
  const match = ciYml.match(new RegExp(`${jobName}:[\\s\\S]*?(?=\\n {2}\\S|\\n?$)`));
  if (!match) {
    throw new Error(`Could not locate job "${jobName}" in ci.yml`);
  }
  return match[0];
}

function initFixtureRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'validate-declaration-test-'));
  execSync('git init -q', { cwd: dir });
  execSync('git config user.email test@example.com', { cwd: dir });
  execSync('git config user.name "Test"', { cwd: dir });
  fs.mkdirSync(path.join(dir, 'database', 'migrations'), { recursive: true });
  return dir;
}

function writeMigration(dir: string, name: string, sql: string) {
  fs.writeFileSync(path.join(dir, 'database', 'migrations', name), sql, 'utf8');
}

function commitAll(dir: string, message: string): string {
  execSync('git add -A', { cwd: dir });
  execSync(`git commit -q -m "${message}"`, { cwd: dir });
  return execSync('git rev-parse HEAD', { cwd: dir, encoding: 'utf8' }).trim();
}

function rmFixtureRepo(dir: string) {
  fs.rmSync(dir, { recursive: true, force: true });
}

describe('.github/scripts/validate-release-compatibility-declaration.js — validateDeclaration()', () => {
  const fixtureDirs: string[] = [];

  afterAll(() => {
    for (const d of fixtureDirs) rmFixtureRepo(d);
  });

  it('no declaration ({}) always passes -- nothing to validate, no git operation performed', () => {
    const dir = initFixtureRepo();
    fixtureDirs.push(dir);
    // Deliberately no commit here: an absent minimum_required_migration must
    // short-circuit before any git call is made.

    const result = validateDeclaration({ repoRoot: dir, declaration: {} });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('declared migration name does not exist in database/migrations/ -- fails', () => {
    const dir = initFixtureRepo();
    fixtureDirs.push(dir);
    writeMigration(dir, '001_a.sql', 'CREATE TABLE a (id SERIAL PRIMARY KEY);');
    const baselineRef = commitAll(dir, 'baseline');

    const result = validateDeclaration({
      repoRoot: dir,
      declaration: {
        minimum_required_migration: '002_does_not_exist.sql',
        baseline_repository_ref: baselineRef,
        post_baseline_verified: true,
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/does not exist in database\/migrations/);
  });

  it('baseline_repository_ref does not resolve to a real commit -- fails', () => {
    const dir = initFixtureRepo();
    fixtureDirs.push(dir);
    writeMigration(dir, '001_a.sql', 'CREATE TABLE a (id SERIAL PRIMARY KEY);');
    commitAll(dir, 'baseline');

    const result = validateDeclaration({
      repoRoot: dir,
      declaration: {
        minimum_required_migration: '001_a.sql',
        baseline_repository_ref: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef',
        post_baseline_verified: true,
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/does not resolve to a real commit/);
  });

  it('baseline_repository_ref missing entirely while a migration is declared -- fails', () => {
    const dir = initFixtureRepo();
    fixtureDirs.push(dir);
    writeMigration(dir, '001_a.sql', 'CREATE TABLE a (id SERIAL PRIMARY KEY);');
    commitAll(dir, 'baseline');

    const result = validateDeclaration({
      repoRoot: dir,
      declaration: { minimum_required_migration: '001_a.sql', post_baseline_verified: true },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/baseline_repository_ref is required/);
  });

  it('post_baseline_verified missing/null -- fails (must be an explicit human attestation, never inferred)', () => {
    const dir = initFixtureRepo();
    fixtureDirs.push(dir);
    writeMigration(dir, '001_a.sql', 'CREATE TABLE a (id SERIAL PRIMARY KEY);');
    const baselineRef = commitAll(dir, 'baseline');

    const result = validateDeclaration({
      repoRoot: dir,
      declaration: { minimum_required_migration: '001_a.sql', baseline_repository_ref: baselineRef },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/post_baseline_verified must be explicitly true or false/);
  });

  it('declared migration already existed at the referenced baseline commit -- fails (contradicted by git history)', () => {
    const dir = initFixtureRepo();
    fixtureDirs.push(dir);
    writeMigration(dir, '001_a.sql', 'CREATE TABLE a (id SERIAL PRIMARY KEY);');
    const baselineRef = commitAll(dir, 'baseline'); // 001_a.sql already present here

    const result = validateDeclaration({
      repoRoot: dir,
      declaration: {
        minimum_required_migration: '001_a.sql',
        baseline_repository_ref: baselineRef,
        post_baseline_verified: true,
      },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.join(' ')).toMatch(/already existed in database\/migrations\/ at/);
  });

  it('declared migration was added strictly after the referenced baseline commit -- passes', () => {
    const dir = initFixtureRepo();
    fixtureDirs.push(dir);
    writeMigration(dir, '001_a.sql', 'CREATE TABLE a (id SERIAL PRIMARY KEY);');
    const baselineRef = commitAll(dir, 'baseline'); // only 001_a.sql exists here

    writeMigration(dir, '002_b.sql', 'CREATE TABLE b (id SERIAL PRIMARY KEY);');
    commitAll(dir, 'add migration 002 after baseline');

    const result = validateDeclaration({
      repoRoot: dir,
      declaration: {
        minimum_required_migration: '002_b.sql',
        baseline_repository_ref: baselineRef,
        post_baseline_verified: true,
      },
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });

  it('post_baseline_verified: false is accepted as valid (a legitimate, unattested-as-post-baseline declaration)', () => {
    const dir = initFixtureRepo();
    fixtureDirs.push(dir);
    writeMigration(dir, '001_a.sql', 'CREATE TABLE a (id SERIAL PRIMARY KEY);');
    const baselineRef = commitAll(dir, 'baseline');

    const result = validateDeclaration({
      repoRoot: dir,
      declaration: {
        minimum_required_migration: '001_a.sql',
        baseline_repository_ref: baselineRef,
        post_baseline_verified: false,
      },
    });
    expect(result).toEqual({ valid: true, errors: [] });
  });
});

describe('.github/workflows/ci.yml — release-compatibility validation wiring', () => {
  const ciYml = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');

  it('lint-and-build checkout uses fetch-depth: 0', () => {
    const block = extractJobBlock(ciYml, 'lint-and-build');
    const checkoutSection = block.match(/Checkout code[\s\S]*?(?=\n\s*- name:)/);
    expect(checkoutSection).toBeTruthy();
    expect(checkoutSection![0]).toMatch(/fetch-depth:\s*0/);
  });

  it('lint-and-build runs the release-compatibility declaration validator', () => {
    const block = extractJobBlock(ciYml, 'lint-and-build');
    expect(block).toMatch(/validate-release-compatibility-declaration\.js/);
  });

  it('deploy-backend checkout is untouched -- no fetch-depth added', () => {
    const block = extractJobBlock(ciYml, 'deploy-backend');
    const checkoutSection = block.match(/Checkout code[\s\S]*?(?=\n\s*- name:)/);
    expect(checkoutSection).toBeTruthy();
    expect(checkoutSection![0]).not.toMatch(/fetch-depth/);
  });

  it('deploy-migration-tooling checkout is untouched -- no fetch-depth added', () => {
    const block = extractJobBlock(ciYml, 'deploy-migration-tooling');
    const checkoutSection = block.match(/Checkout code[\s\S]*?(?=\n\s*- name:)/);
    expect(checkoutSection).toBeTruthy();
    expect(checkoutSection![0]).not.toMatch(/fetch-depth/);
  });

  it('no job other than lint-and-build references the validator script', () => {
    const jobNames = ['deploy-backend', 'deploy-migration-tooling'];
    for (const jobName of jobNames) {
      const block = extractJobBlock(ciYml, jobName);
      expect(block).not.toMatch(/validate-release-compatibility-declaration\.js/);
    }
  });
});
