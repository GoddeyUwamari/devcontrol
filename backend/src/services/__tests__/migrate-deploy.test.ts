/**
 * Coverage for the migration-tooling deployment path (packaging, runtime
 * dependency resolution on the production host, and the CI/CD workflow's
 * "never auto-execute migrations" safety property) — as distinct from
 * migrate-runner.test.ts, which covers the runner's own DB behavior.
 *
 * No live Postgres connection is used anywhere in this file: packaging and
 * dependency-resolution tests spawn real `tar`/`node` subprocesses against
 * the real repository tree (read-only), and the CI-workflow tests just
 * parse `.github/workflows/ci.yml` as text.
 */

import { execFileSync, execSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '../../../../');
const CI_WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');

/** Extracts one top-level job's YAML block (name line through the line before the next top-level job, or EOF) as raw text. */
function extractJobBlock(ciYml: string, jobName: string): string {
  const match = ciYml.match(new RegExp(`${jobName}:[\\s\\S]*?(?=\\n {2}\\S|\\n?$)`));
  if (!match) {
    throw new Error(`Could not locate job "${jobName}" in ci.yml`);
  }
  return match[0];
}

// This local checkout installs everything into one root-level node_modules/
// (no `backend/node_modules` exists here at all) — unlike production, which
// runs a separate `cd backend && npm install`, producing a real, standalone
// `backend/node_modules`. Whichever directory actually contains `pg` locally
// is the correct stand-in: what the NODE_PATH test below exercises is the
// resolution *mechanism* (a node_modules directory reachable only via
// NODE_PATH, not by walking up the directory tree from a sibling), which is
// identical regardless of which real directory happens to hold `pg`.
const REAL_NODE_MODULES_WITH_PG = path.dirname(path.dirname(require.resolve('pg/package.json')));

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { parseCliArgs } = require('../../../../database/migrate.js');

describe('migration deployment artifact packaging (executes the actual ci.yml command, not a duplicated equivalent)', () => {
  let tmpDir: string;
  let packagingCommand: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-artifact-test-'));

    const ciYml = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
    const jobBlock = extractJobBlock(ciYml, 'deploy-migration-tooling');
    // Extract the exact `run:` command that creates migrations.tar.gz — not
    // a hand-duplicated equivalent maintained separately in this test file.
    // If this line is ever edited to package the wrong directory, add an
    // exclusion, or reference a different archive name, this either fails
    // to match here (loud beforeAll failure) or captures the new command
    // text, which is then actually executed below — so a bad change fails
    // the artifact-content assertions instead of silently continuing to
    // pass against a stale, hand-written duplicate.
    const runMatch = jobBlock.match(/run:\s*(tar czf migrations\.tar\.gz\s.*)$/m);
    if (!runMatch) {
      throw new Error(
        'Could not find the migrations.tar.gz packaging `run:` command inside deploy-migration-tooling — ' +
        'the workflow may have changed shape (e.g. moved to a multi-line `run: |` block).'
      );
    }
    packagingCommand = runMatch[1].trim();
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('executing the actual extracted ci.yml command against the real repo produces an artifact containing migrate.js and migrations/*.sql', () => {
    const artifactPath = path.join(tmpDir, 'ci-extracted-migrations.tar.gz');
    // Redirect only the output archive location into a disposable temp
    // file, so the real repo working tree isn't left with a stray
    // migrations.tar.gz — every other token in the command (in particular
    // the source directory, `-C database .`) runs exactly as written in
    // ci.yml, unmodified.
    const commandToRun = packagingCommand.replace('migrations.tar.gz', artifactPath);
    execSync(commandToRun, { cwd: REPO_ROOT });

    const listing = execFileSync('tar', ['tzf', artifactPath], { encoding: 'utf8' });
    const entries = listing.split('\n').filter(Boolean);

    expect(entries).toContain('./migrate.js');
    expect(entries.some((e) => /^\.\/migrations\/.*\.sql$/.test(e))).toBe(true);
  });

  it('the artifact produced by the actual ci.yml command never contains a backend/migrations/ path', () => {
    const artifactPath = path.join(tmpDir, 'ci-extracted-migrations2.tar.gz');
    const commandToRun = packagingCommand.replace('migrations.tar.gz', artifactPath);
    execSync(commandToRun, { cwd: REPO_ROOT });

    const listing = execFileSync('tar', ['tzf', artifactPath], { encoding: 'utf8' });
    expect(listing).not.toMatch(/backend\/migrations/);
  });

  it('direct proof this suite would catch a "packages the wrong directory" regression: substituting the source dir in the real extracted command fails the content assertion', () => {
    // Empirical proof, not just a claim, that this design closes the
    // duplicated-assumption gap: run the ACTUAL extracted command with only
    // its source directory swapped for one with no migrate.js/migrations/,
    // and confirm the resulting artifact fails the same assertion a real
    // "wrong directory" regression in ci.yml would fail.
    const wrongDir = path.join(REPO_ROOT, 'scripts');
    const artifactPath = path.join(tmpDir, 'ci-extracted-wrongdir.tar.gz');
    const commandToRun = packagingCommand
      .replace('migrations.tar.gz', artifactPath)
      .replace('-C database', `-C ${wrongDir}`);
    execSync(commandToRun, { cwd: REPO_ROOT });

    const listing = execFileSync('tar', ['tzf', artifactPath], { encoding: 'utf8' });
    const entries = listing.split('\n').filter(Boolean);
    expect(entries).not.toContain('./migrate.js');
  });
});

describe('production-style NODE_PATH dependency resolution for pg', () => {
  let tmpRoot: string;
  let databaseSubdir: string;

  beforeAll(() => {
    // Mirrors production layout: <root>/database/<probe file>, sibling to
    // <root>/backend/node_modules (a real node_modules containing `pg`,
    // reachable only via NODE_PATH — never an ancestor of database/, so
    // Node's normal directory-walk resolution can't find it) — reusing the
    // real installed node_modules via symlink rather than duplicating a
    // dependency tree just for this test.
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-nodepath-test-'));
    databaseSubdir = path.join(tmpRoot, 'database');
    fs.mkdirSync(databaseSubdir);
    fs.mkdirSync(path.join(tmpRoot, 'backend'));
    fs.symlinkSync(REAL_NODE_MODULES_WITH_PG, path.join(tmpRoot, 'backend', 'node_modules'), 'dir');
    fs.writeFileSync(
      path.join(databaseSubdir, 'probe.js'),
      "require('pg'); console.log('RESOLVED_PG_OK');",
      'utf8'
    );
  });

  afterAll(() => {
    fs.rmSync(tmpRoot, { recursive: true, force: true });
  });

  it('resolves pg via NODE_PATH pointed at backend/node_modules, with no local node_modules present', () => {
    const nodeModulesPath = path.join(tmpRoot, 'backend', 'node_modules');
    const output = execFileSync('node', [path.join(databaseSubdir, 'probe.js')], {
      encoding: 'utf8',
      env: { ...process.env, NODE_PATH: nodeModulesPath },
    });
    expect(output.trim()).toBe('RESOLVED_PG_OK');
  });

  it('fails to resolve pg without NODE_PATH set — proving the mechanism is actually load-bearing, not incidental', () => {
    const env = { ...process.env };
    delete env.NODE_PATH;
    expect(() => {
      // stdio 'pipe' (the execFileSync default only pipes stdout; stderr is
      // otherwise inherited) so the expected child-process crash trace
      // doesn't spill into this test run's own console output.
      execFileSync('node', [path.join(databaseSubdir, 'probe.js')], {
        encoding: 'utf8',
        env,
        stdio: ['ignore', 'pipe', 'pipe'],
      });
    }).toThrow();
  });
});

describe('CI workflow — migration tooling deployment never auto-executes migrations', () => {
  let ciYml: string;

  beforeAll(() => {
    ciYml = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
  });

  it('the workflow references a migration-tooling deployment job', () => {
    expect(ciYml).toMatch(/deploy-migration-tooling:/);
  });

  it('never invokes `node database/migrate.js` except inside an individual echo/documentation command string', () => {
    // The workflow's SSM steps embed their command list as a single-line
    // JSON blob (`--parameters '{"commands":[...]}'`), matching this file's
    // existing style — so a naive per-text-line check would be fooled by
    // unrelated "echo" tokens elsewhere on the same long line. Instead,
    // parse every such JSON blob for real and inspect each command string
    // in the array individually.
    const jsonBlobs = [...ciYml.matchAll(/--parameters '(\{"commands":\[.*?\]\})' \\/g)].map((m) => m[1]);
    expect(jsonBlobs.length).toBeGreaterThan(0); // sanity: SSM steps must actually exist to inspect

    const allCommands: string[] = jsonBlobs.flatMap((blob) => JSON.parse(blob).commands);
    const migrateInvocations = allCommands.filter((cmd) => /node\s+\S*database\/migrate\.js/.test(cmd));

    expect(migrateInvocations.length).toBeGreaterThan(0); // sanity: the operator-command docs must exist somewhere
    for (const cmd of migrateInvocations) {
      expect(cmd.trim().startsWith('echo')).toBe(true);
    }
  });

  it('never mentions --init-baseline anywhere in the CI workflow at all (not even as an echoed example)', () => {
    // Stricter than "only in echo": baseline initialization is deliberately
    // undocumented in CI output entirely, so there's no risk of an operator
    // copy-pasting a CI log line into an automated context.
    expect(ciYml).not.toMatch(/--init-baseline/);
  });

  it('never references schema_migrations or migration_tracking_baseline outside of comments (deployment must not touch runner-owned ledger state)', () => {
    // A YAML comment *documenting* that deployment never touches these
    // tables is fine (and present, deliberately) — this checks only actual
    // non-comment content, so it would catch a real accidental reference
    // (e.g. an SSM command querying or creating one of these tables)
    // without being tripped up by the explanatory comment itself.
    const nonCommentLines = ciYml
      .split('\n')
      .filter((line) => !line.trim().startsWith('#'))
      .join('\n');
    expect(nonCommentLines).not.toMatch(/schema_migrations/);
    expect(nonCommentLines).not.toMatch(/migration_tracking_baseline/);
  });

  it('the migration-tooling deploy job validates artifact contents (migrate.js + migrations present, backend/migrations absent)', () => {
    const jobBlock = extractJobBlock(ciYml, 'deploy-migration-tooling');
    expect(jobBlock).toMatch(/migrate\.js/);
    expect(jobBlock).toMatch(/backend\/migrations/); // the negative-check assertion string itself
  });

  it('the S3 key used to upload migrations.tar.gz and the S3 key the SSM command downloads it from are exactly the same — extracted from the actual workflow, not two hardcoded copies of the expected value', () => {
    const jobBlock = extractJobBlock(ciYml, 'deploy-migration-tooling');

    // `${{ github.sha }}` contains literal spaces around `github.sha`, so a
    // naive `\S+` capture would truncate mid-URI at the first such space —
    // capture to end-of-line instead (safe here: on the upload step's
    // single-line `run:`, the S3 URI is the last token on the line).
    const uploadMatch = jobBlock.match(/run:\s*aws s3 cp migrations\.tar\.gz\s+(s3:\/\/.*)$/m);
    expect(uploadMatch).toBeTruthy();
    const uploadKey = uploadMatch![1].trim();

    const jsonBlobs = [...jobBlock.matchAll(/--parameters '(\{"commands":\[.*?\]\})' \\/g)].map((m) => m[1]);
    expect(jsonBlobs.length).toBeGreaterThan(0);
    const allCommands: string[] = jsonBlobs.flatMap((blob) => JSON.parse(blob).commands);
    const downloadCommand = allCommands.find((cmd) => /aws s3 cp\s+s3:\/\/.*migrations\.tar\.gz/.test(cmd));
    expect(downloadCommand).toBeTruthy();
    // Same embedded-space issue applies to the download command's source
    // URI — capture non-greedily up to the literal "migrations.tar.gz"
    // rather than relying on whitespace as a boundary.
    const downloadMatch = downloadCommand!.match(/aws s3 cp\s+(s3:\/\/.*?migrations\.tar\.gz)/);
    expect(downloadMatch).toBeTruthy();
    const downloadKey = downloadMatch![1];

    // Both values above came from parsing the real file — neither side is a
    // hardcoded expectation. A future edit that changes one location
    // without the other (the exact "stale artifact path" bug class) fails
    // this assertion regardless of what the "correct" value is assumed to
    // be.
    expect(downloadKey).toBe(uploadKey);
  });
});

describe('deploy-migration-tooling destination pre-flight (executes the actual extracted ci.yml symlink logic, not a duplicated equivalent)', () => {
  /**
   * Extracts the exact `bash -c "..."` symlink-decision command embedded in
   * the deploy-migration-tooling SSM command list, strips only the
   * `sudo -H -u ubuntu --preserve-env=... bash -c "..."` wrapper (sudo isn't
   * available/meaningful in a test environment), and returns the raw inner
   * shell source. If this command's shape ever changes (e.g. no longer
   * matches `DEST=${DEST:-...}`), extraction fails loudly here rather than
   * silently testing stale, hand-duplicated logic.
   */
  function extractPreflightScript(): string {
    const ciYml = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
    const jobBlock = extractJobBlock(ciYml, 'deploy-migration-tooling');
    const jsonBlobs = [...jobBlock.matchAll(/--parameters '(\{"commands":\[.*?\]\})' \\/g)].map((m) => m[1]);
    if (jsonBlobs.length === 0) {
      throw new Error('Could not find the SSM "commands" JSON blob inside deploy-migration-tooling');
    }
    const commands: string[] = JSON.parse(jsonBlobs[0]).commands;
    const preflightCmd = commands.find((c) => c.includes('DEST=${DEST'));
    if (!preflightCmd) {
      throw new Error(
        'Could not find the destination pre-flight command (expected a command containing `DEST=${DEST...}`) — ' +
        'the workflow may have changed shape.'
      );
    }
    const match = preflightCmd.match(/bash -c "([\s\S]*)"$/);
    if (!match) {
      throw new Error('Could not extract the inner bash -c script body from the pre-flight command');
    }
    return match[1];
  }

  let preflightScript: string;
  let tmpBase: string;

  beforeAll(() => {
    preflightScript = extractPreflightScript();
  });

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-preflight-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  /** Runs the real extracted script against disposable DEST/RELEASE_DIR — never production. */
  function runPreflight(dest: string, releaseDir: string): { status: number; stdout: string; stderr: string } {
    const result = require('child_process').spawnSync('bash', ['-c', preflightScript], {
      encoding: 'utf8',
      env: { ...process.env, DEST: dest, RELEASE_DIR: releaseDir },
    });
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  }

  it('the extracted script does not reference bash -n syntax errors', () => {
    expect(() => execFileSync('bash', ['-n', '-c', preflightScript])).not.toThrow();
  });

  it('Case A — destination does not exist: creates the symlink and succeeds', () => {
    const releaseDir = path.join(tmpBase, 'release-a');
    const dest = path.join(tmpBase, 'nested', 'database');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const { status } = runPreflight(dest, releaseDir);

    expect(status).toBe(0);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(dest)).toBe(fs.realpathSync(releaseDir));
  });

  it('Case B — destination already a correct symlink: succeeds idempotently, no error', () => {
    const releaseDir = path.join(tmpBase, 'release-b');
    const dest = path.join(tmpBase, 'nested', 'database');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(releaseDir, dest);

    const { status, stdout } = runPreflight(dest, releaseDir);

    expect(status).toBe(0);
    expect(stdout).toMatch(/Case B/);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
  });

  it('Case B (incorrect) — destination is a symlink pointing elsewhere: fails loudly, does not repoint it', () => {
    const releaseDir = path.join(tmpBase, 'release-b2');
    const wrongTarget = path.join(tmpBase, 'release-wrong');
    const dest = path.join(tmpBase, 'nested', 'database');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.mkdirSync(wrongTarget, { recursive: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(wrongTarget, dest);

    const { status, stderr } = runPreflight(dest, releaseDir);

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/is a symlink pointing to/);
    // Never silently repointed — still points at the original wrong target.
    expect(fs.realpathSync(dest)).toBe(fs.realpathSync(wrongTarget));
  });

  it('Case C — destination exists as a real directory: fails loudly before touching it, contents untouched', () => {
    const releaseDir = path.join(tmpBase, 'release-c');
    const dest = path.join(tmpBase, 'nested', 'database');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.mkdirSync(dest, { recursive: true });
    fs.writeFileSync(path.join(dest, 'legacy-migrate.js'), '// legacy manual tooling', 'utf8');

    const { status, stderr } = runPreflight(dest, releaseDir);

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/already exists as a REAL DIRECTORY/);
    expect(stderr).toMatch(/human must explicitly remediate/);
    // The legacy directory's contents must be completely untouched.
    expect(fs.lstatSync(dest).isDirectory()).toBe(true);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(dest, 'legacy-migrate.js'), 'utf8')).toBe('// legacy manual tooling');
  });

  it('Case D — destination exists as an unexpected filesystem object: fails loudly, does not replace it', () => {
    const releaseDir = path.join(tmpBase, 'release-d');
    const dest = path.join(tmpBase, 'nested', 'database');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.writeFileSync(dest, 'not a directory or symlink', 'utf8');

    const { status, stderr } = runPreflight(dest, releaseDir);

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/unexpected filesystem object/);
    expect(fs.lstatSync(dest).isFile()).toBe(true);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false);
  });
});

describe('deploy-migration-tooling artifact packaging excludes seeds/ (executes the actual extracted ci.yml command)', () => {
  let tmpDir: string;
  let packagingCommand: string;

  beforeAll(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-artifact-seeds-test-'));

    const ciYml = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
    const jobBlock = extractJobBlock(ciYml, 'deploy-migration-tooling');
    const runMatch = jobBlock.match(/run:\s*(tar czf migrations\.tar\.gz\s.*)$/m);
    if (!runMatch) {
      throw new Error('Could not find the migrations.tar.gz packaging `run:` command inside deploy-migration-tooling');
    }
    packagingCommand = runMatch[1].trim();
  });

  afterAll(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('database/seeds/ exists in source (sanity check the exclusion is actually exercised)', () => {
    expect(fs.existsSync(path.join(REPO_ROOT, 'database', 'seeds'))).toBe(true);
  });

  it('the artifact produced by the actual ci.yml command never contains seeds/', () => {
    const artifactPath = path.join(tmpDir, 'ci-extracted-seeds-check.tar.gz');
    const commandToRun = packagingCommand.replace('migrations.tar.gz', artifactPath);
    execSync(commandToRun, { cwd: REPO_ROOT });

    const listing = execFileSync('tar', ['tzf', artifactPath], { encoding: 'utf8' });
    expect(listing).not.toMatch(/(^|\/)seeds(\/|$)/m);
  });

  it('the artifact contains exactly the expected shape: only migrate.js and migrations/**, nothing else', () => {
    const artifactPath = path.join(tmpDir, 'ci-extracted-shape-check.tar.gz');
    const commandToRun = packagingCommand.replace('migrations.tar.gz', artifactPath);
    execSync(commandToRun, { cwd: REPO_ROOT });

    const listing = execFileSync('tar', ['tzf', artifactPath], { encoding: 'utf8' });
    const entries = listing.split('\n').filter(Boolean);
    const allowed = /^\.\/$|^\.\/migrate\.js$|^\.\/migrations\/?$|^\.\/migrations\/.*$/;
    const unexpected = entries.filter((e) => !allowed.test(e));

    expect(unexpected).toEqual([]);
  });
});

describe('database/migrate.js — parseCliArgs (pure, no DB)', () => {
  it('defaults: no flags means no dry-run, no baseline note, no repository ref', () => {
    expect(parseCliArgs([])).toEqual({ dryRun: false, initBaselineNote: null, repositoryRef: null });
  });

  it('--dry-run and --pending both set dryRun', () => {
    expect(parseCliArgs(['--dry-run']).dryRun).toBe(true);
    expect(parseCliArgs(['--pending']).dryRun).toBe(true);
  });

  it('--init-baseline captures the following argument as the note', () => {
    const result = parseCliArgs(['--init-baseline', 'my note here']);
    expect(result.initBaselineNote).toBe('my note here');
  });

  it('--repository-ref is captured only when explicitly passed, never defaulted to anything but null', () => {
    const withoutFlag = parseCliArgs(['--init-baseline', 'note']);
    expect(withoutFlag.repositoryRef).toBeNull();

    const withFlag = parseCliArgs(['--init-baseline', 'note', '--repository-ref', 'abc1234']);
    expect(withFlag.repositoryRef).toBe('abc1234');
  });

  it('--repository-ref is parsed even without --init-baseline, but remains inert there (runMigrations only consults it inside initBaseline)', () => {
    const result = parseCliArgs(['--repository-ref', 'abc1234']);
    expect(result.repositoryRef).toBe('abc1234');
    expect(result.initBaselineNote).toBeNull();
  });
});
