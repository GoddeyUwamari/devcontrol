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

/**
 * deploy-migration-tooling builds its SSM "commands" array dynamically with
 * `jq` (so the base64-encoded symlink script can be embedded without any
 * hand-escaping), unlike every other SSM step in this file, which embeds a
 * static single-quoted JSON literal. Static regex extraction can't recover
 * this job's real command list — so this extracts the actual
 * `PARAMS=$(jq -n ... '{"commands": [...]}')` assignment from the job's
 * `run:` block and executes it for real, substituting a concrete SHA for
 * GitHub Actions' `${{ github.sha }}` templating (which bash never sees
 * directly — the Actions runner replaces it with literal text before any
 * shell runs). Returns the real resulting commands array, so a change that
 * breaks the jq filter's actual output is caught here, not validated
 * against a stale hand-duplicated assumption.
 */
function buildDeployMigrationToolingCommands(sha: string, scriptB64: string): string[] {
  const ciYml = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
  const jobBlock = extractJobBlock(ciYml, 'deploy-migration-tooling');
  const match = jobBlock.match(/PARAMS=\$\(jq -n[\s\S]*?\]\}'\)/);
  if (!match) {
    throw new Error(
      'Could not find the PARAMS=$(jq -n ... ) block inside deploy-migration-tooling — the workflow may have changed shape.'
    );
  }
  const paramsAssignment = match[0].replace(/\$\{\{ github\.sha \}\}/g, sha);
  const script = [`SYMLINK_SCRIPT_B64=${JSON.stringify(scriptB64)}`, paramsAssignment, 'echo "$PARAMS"'].join('\n');
  const output = execSync(script, { encoding: 'utf8', shell: '/bin/bash' });
  return JSON.parse(output).commands;
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
    // deploy-backend's SSM steps embed their command list as a single-line
    // JSON blob (`--parameters '{"commands":[...]}'`) — parse every such
    // blob for real. deploy-migration-tooling builds its own commands array
    // dynamically via jq (not a static blob this regex can see), so its
    // real output is executed and included separately, via the same
    // mechanism the "actually deployed script" tests below use.
    const jsonBlobs = [...ciYml.matchAll(/--parameters '(\{"commands":\[.*?\]\})' \\/g)].map((m) => m[1]);
    expect(jsonBlobs.length).toBeGreaterThan(0); // sanity: deploy-backend's SSM steps must actually exist

    const staticCommands: string[] = jsonBlobs.flatMap((blob) => JSON.parse(blob).commands);
    const stubScriptB64 = Buffer.from('#!/usr/bin/env bash\necho stub\n').toString('base64');
    const migrationToolingCommands = buildDeployMigrationToolingCommands('deadbeef'.repeat(5), stubScriptB64);
    const allCommands = [...staticCommands, ...migrationToolingCommands];

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

    // The download key lives inside the dynamically jq-built commands array
    // (see buildDeployMigrationToolingCommands) — execute it for real with
    // a concrete stand-in SHA, since GitHub Actions' `${{ github.sha }}`
    // templating is resolved before any shell runs, not by bash itself.
    const sha = 'deadbeef'.repeat(5);
    const stubScriptB64 = Buffer.from('#!/usr/bin/env bash\necho stub\n').toString('base64');
    const allCommands = buildDeployMigrationToolingCommands(sha, stubScriptB64);
    const downloadCommand = allCommands.find((cmd) => /aws s3 cp\s+s3:\/\/.*migrations\.tar\.gz/.test(cmd));
    expect(downloadCommand).toBeTruthy();
    // Same embedded-space issue applies to the download command's source
    // URI — capture non-greedily up to the literal "migrations.tar.gz"
    // rather than relying on whitespace as a boundary.
    const downloadMatch = downloadCommand!.match(/aws s3 cp\s+(s3:\/\/.*?migrations\.tar\.gz)/);
    expect(downloadMatch).toBeTruthy();
    const downloadKey = downloadMatch![1];

    // uploadKey still contains the literal, un-resolved `${{ github.sha }}`
    // placeholder (that step's `run:` line was never changed); downloadKey
    // was produced by actually executing the jq filter with a concrete
    // stand-in SHA substituted in. Resolve the same substitution on the
    // upload side before comparing, so both sides represent the same
    // hypothetical real SHA — neither side is a hardcoded expectation, so a
    // future edit that changes one location without the other (the exact
    // "stale artifact path" bug class) still fails this assertion
    // regardless of what the "correct" value is assumed to be.
    const uploadKeyResolved = uploadKey.replace(/\$\{\{\s*github\.sha\s*\}\}/g, sha);
    expect(downloadKey).toBe(uploadKeyResolved);
  });
});

describe('deploy-migration-tooling destination pre-flight (executes the real .github/scripts/deploy-migration-symlink.sh file — the exact artifact CI base64-encodes and ships, not a reconstructed fragment)', () => {
  const SYMLINK_SCRIPT_PATH = path.join(REPO_ROOT, '.github', 'scripts', 'deploy-migration-symlink.sh');
  let tmpBase: string;

  beforeAll(() => {
    expect(fs.existsSync(SYMLINK_SCRIPT_PATH)).toBe(true);
  });

  beforeEach(() => {
    tmpBase = fs.mkdtempSync(path.join(os.tmpdir(), 'migrate-symlink-script-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpBase, { recursive: true, force: true });
  });

  /** Runs the real script file directly — no extraction, no re-parsing through any other shell. */
  function run(releaseDir: string, dest: string): { status: number; stdout: string; stderr: string } {
    const result = require('child_process').spawnSync('bash', [SYMLINK_SCRIPT_PATH, releaseDir, dest], {
      encoding: 'utf8',
    });
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  }

  /**
   * Runs the script through the same general execution shape the real
   * deployment uses: base64-decode piped into `bash -s -- <args>`, wrapped
   * in a bare `set -e` with NO `pipefail`. That is deliberate, not an
   * oversight — the real production SSM script (see the "Deploy migration
   * tooling via SSM" step in ci.yml) only ever sets bare `set -e`, never
   * `pipefail`. Using a stricter wrapper here would validate a
   * configuration that isn't actually deployed and could mask a real
   * regression (a failure that only fails to propagate without pipefail
   * specifically). A sentinel command after the pipe proves whether the
   * failure actually survived, since a bare `set -e` still aborts on a
   * pipeline's failure as long as the failing stage is the pipeline's last
   * command — which it is here (bash -s -- is last) — but this is exactly
   * the propagation behavior that must be proven, not assumed.
   */
  function runThroughPipeline(releaseDir: string, dest: string): { status: number; stdout: string; stderr: string } {
    const scriptB64 = fs.readFileSync(SYMLINK_SCRIPT_PATH).toString('base64');
    const wrapperPath = path.join(tmpBase, `pipeline-wrapper-${Date.now()}-${Math.random()}.sh`);
    fs.writeFileSync(
      wrapperPath,
      [
        'set -e', // bare set -e, NO pipefail — matches the real deployed outer script exactly
        `export RELEASE_DIR=${JSON.stringify(releaseDir)}`,
        `echo ${scriptB64} | base64 -d | bash -s -- "$RELEASE_DIR" ${JSON.stringify(dest)}`,
        'echo SENTINEL_AFTER_PIPE_RAN',
      ].join('\n'),
      'utf8'
    );
    const result = require('child_process').spawnSync('bash', [wrapperPath], { encoding: 'utf8' });
    return { status: result.status ?? -1, stdout: result.stdout, stderr: result.stderr };
  }

  it('the script has no syntax errors', () => {
    expect(() => execFileSync('bash', ['-n', SYMLINK_SCRIPT_PATH])).not.toThrow();
  });

  it('DEST defaults to the real production path when the second argument is omitted', () => {
    // Not invoked with the real default (that path does not exist on this
    // machine) — instead confirms the literal default expression in the
    // script source is wired to the real production path, so a future edit
    // that silently changes or drops the default fails this test.
    const src = fs.readFileSync(SYMLINK_SCRIPT_PATH, 'utf8');
    expect(src).toMatch(/DEST="\$\{2:-\/home\/ubuntu\/devcontrol\/database\}"/);
  });

  it('ci.yml actually base64-encodes and ships this exact file (byte-identical, not a different or duplicated copy)', () => {
    const ciYml = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');
    const jobBlock = extractJobBlock(ciYml, 'deploy-migration-tooling');

    const b64Match = jobBlock.match(
      /SYMLINK_SCRIPT_B64=\$\((base64 < \.github\/scripts\/deploy-migration-symlink\.sh \| tr -d '\\n')\)/
    );
    expect(b64Match).toBeTruthy();

    // Run the actual extracted encoding command against the real repo tree
    // and confirm it decodes back to byte-identical content with the file
    // every other test in this block exercises directly — proving the
    // shipped artifact and the tested artifact are the same bytes, not
    // just the same file path referenced in two places that could drift.
    const encoded = execSync(b64Match![1], { cwd: REPO_ROOT, encoding: 'utf8' }).trim();
    const decoded = Buffer.from(encoded, 'base64').toString('utf8');
    expect(decoded).toBe(fs.readFileSync(SYMLINK_SCRIPT_PATH, 'utf8'));

    // Confirm the real, executed (not raw-source) command text pipes the
    // decoded script into a standalone `bash -s --` invocation with the
    // right arguments — checked against actual jq output so escaped-quote
    // differences between jq source and decoded JSON can't produce a false
    // match or a false failure here.
    const stubScriptB64 = Buffer.from('#!/usr/bin/env bash\necho stub\n').toString('base64');
    const commands = buildDeployMigrationToolingCommands('deadbeef'.repeat(5), stubScriptB64);
    const symlinkInvocation = commands.find((c) => c.includes('base64 -d'));
    expect(symlinkInvocation).toBeTruthy();
    expect(symlinkInvocation).toMatch(
      /base64 -d \| sudo -H -u ubuntu --preserve-env=PATH,RELEASE_DIR bash -s -- "\$RELEASE_DIR" \/home\/ubuntu\/devcontrol\/database/
    );
  });

  it('Case A — destination does not exist: creates the symlink and succeeds', () => {
    const releaseDir = path.join(tmpBase, 'release-a');
    const dest = path.join(tmpBase, 'nested', 'database');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const { status } = run(releaseDir, dest);

    expect(status).toBe(0);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(dest)).toBe(fs.realpathSync(releaseDir));
  });

  it('Case A through the full base64-decode-pipe-into-bash pipeline (bare set -e, no pipefail): succeeds and the sentinel after it runs', () => {
    const releaseDir = path.join(tmpBase, 'release-a-pipe');
    const dest = path.join(tmpBase, 'nested-a-pipe', 'database');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });

    const { status, stdout } = runThroughPipeline(releaseDir, dest);

    expect(status).toBe(0);
    expect(stdout).toMatch(/SENTINEL_AFTER_PIPE_RAN/);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(dest)).toBe(fs.realpathSync(releaseDir));
  });

  it('Case B — destination already a correct symlink: succeeds idempotently, no error', () => {
    const releaseDir = path.join(tmpBase, 'release-b');
    const dest = path.join(tmpBase, 'nested', 'database');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(releaseDir, dest);

    const { status, stdout } = run(releaseDir, dest);

    expect(status).toBe(0);
    expect(stdout).toMatch(/Case B/);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
  });

  it('Case B2 — destination is a symlink pointing elsewhere: fails loudly, does not repoint it', () => {
    const releaseDir = path.join(tmpBase, 'release-b2');
    const wrongTarget = path.join(tmpBase, 'release-wrong');
    const dest = path.join(tmpBase, 'nested', 'database');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.mkdirSync(wrongTarget, { recursive: true });
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.symlinkSync(wrongTarget, dest);

    const { status, stderr } = run(releaseDir, dest);

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

    const { status, stderr } = run(releaseDir, dest);

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

    const { status, stderr } = run(releaseDir, dest);

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/unexpected filesystem object/);
    expect(fs.lstatSync(dest).isFile()).toBe(true);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(false);
  });

  it('Case E — genuine OS-level failure (permission denied on ln, not one of the intended A/B/B2/C/D branches): propagates as a real non-zero exit both directly and through the full pipeline', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      // Root bypasses permission bits entirely, which would make this
      // specific failure mode unreproducible rather than genuinely absent —
      // skip rather than silently pass on a broken assumption.
      return;
    }

    const releaseDir = path.join(tmpBase, 'release-e');
    const readonlyParent = path.join(tmpBase, 'readonly-parent');
    const dest = path.join(readonlyParent, 'database');
    fs.mkdirSync(releaseDir, { recursive: true });
    fs.mkdirSync(readonlyParent, { recursive: true });
    fs.chmodSync(readonlyParent, 0o555); // no write permission: ln -s cannot create an entry here
    try {
      // Direct execution: the script's own set -euo pipefail must catch
      // ln's real failure and exit non-zero — a genuine unhandled OS error
      // on stderr, not one of the four echo'd Case A/B2/C/D messages.
      const direct = run(releaseDir, dest);
      expect(direct.status).not.toBe(0);
      expect(direct.stderr).toMatch(/[Pp]ermission denied/);
      expect(fs.existsSync(dest)).toBe(false);

      // Through the full pipeline, with the same bare set -e (no pipefail)
      // the real production script uses: the sentinel after the pipe must
      // never run, and the wrapper's own exit code must be non-zero.
      const piped = runThroughPipeline(releaseDir, dest);
      expect(piped.status).not.toBe(0);
      expect(piped.stdout).not.toMatch(/SENTINEL_AFTER_PIPE_RAN/);
      expect(piped.stderr).toMatch(/[Pp]ermission denied/);
      expect(fs.existsSync(dest)).toBe(false);
    } finally {
      fs.chmodSync(readonlyParent, 0o755); // restore so afterEach's rmSync can clean up
    }
  });

  /**
   * A "valid release" per the script: a directory living directly under the
   * same RELEASES_DIR (dirname of the release_dir argument) whose own
   * basename exactly matches the content of its own .deployed_sha marker —
   * the same marker CI writes inside the release directory before ever
   * touching the symlink (see database/migrations/README.md).
   */
  function makeValidRelease(releasesDir: string, sha: string): string {
    const dir = path.join(releasesDir, sha);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '.deployed_sha'), sha, 'utf8');
    return dir;
  }

  it('Case F — known valid old release to known valid new release: advances the symlink, exit 0, destination is the new release', () => {
    const releasesDir = path.join(tmpBase, 'nested', 'database-releases');
    fs.mkdirSync(releasesDir, { recursive: true });
    const dest = path.join(tmpBase, 'nested', 'database');
    const oldRelease = makeValidRelease(releasesDir, 'oldsha1111111111');
    const newRelease = makeValidRelease(releasesDir, 'newsha2222222222');
    fs.symlinkSync(oldRelease, dest);

    const { status, stdout } = run(newRelease, dest);

    expect(status).toBe(0);
    expect(stdout).toMatch(/Case F/);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(dest)).toBe(fs.realpathSync(newRelease));

    // No leftover "database.new.<pid>" temp link — the swap must be clean.
    const leftovers = fs.readdirSync(path.dirname(dest)).filter((f) => f.startsWith('database.new.'));
    expect(leftovers).toHaveLength(0);
  });

  it('Case F disqualified — current target resolves outside database-releases/: still refuses like Case B2, unchanged', () => {
    const releasesDir = path.join(tmpBase, 'nested', 'database-releases');
    fs.mkdirSync(releasesDir, { recursive: true });
    const dest = path.join(tmpBase, 'nested', 'database');
    const newRelease = makeValidRelease(releasesDir, 'newsha3333333333');

    // Current target carries a plausible-looking, self-consistent
    // .deployed_sha marker, but lives OUTSIDE database-releases/ entirely.
    const outsideDir = path.join(tmpBase, 'somewhere-else', 'oldsha4444444444');
    fs.mkdirSync(outsideDir, { recursive: true });
    fs.writeFileSync(path.join(outsideDir, '.deployed_sha'), 'oldsha4444444444', 'utf8');
    fs.symlinkSync(outsideDir, dest);

    const { status, stderr } = run(newRelease, dest);

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/is a symlink pointing to/);
    expect(fs.realpathSync(dest)).toBe(fs.realpathSync(outsideDir));
  });

  it('Case F disqualified — current symlink target does not exist: refuses, dest left as the same dangling symlink', () => {
    const releasesDir = path.join(tmpBase, 'nested', 'database-releases');
    fs.mkdirSync(releasesDir, { recursive: true });
    const dest = path.join(tmpBase, 'nested', 'database');
    const newRelease = makeValidRelease(releasesDir, 'newsha5555555555');

    const missingTarget = path.join(releasesDir, 'oldsha-does-not-exist');
    fs.symlinkSync(missingTarget, dest); // dangling — never created

    const { status, stderr } = run(newRelease, dest);

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/is a symlink pointing to/);
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.readlinkSync(dest)).toBe(missingTarget);
  });

  it('Case F disqualified — new release fails its own valid-release check (basename does not match its own .deployed_sha): refuses, unchanged (proves the symmetric check)', () => {
    const releasesDir = path.join(tmpBase, 'nested', 'database-releases');
    fs.mkdirSync(releasesDir, { recursive: true });
    const dest = path.join(tmpBase, 'nested', 'database');
    const oldRelease = makeValidRelease(releasesDir, 'oldsha6666666666');
    fs.symlinkSync(oldRelease, dest);

    const newRelease = path.join(releasesDir, 'newsha7777777777');
    fs.mkdirSync(newRelease, { recursive: true });
    // Marker deliberately mismatches its own directory name.
    fs.writeFileSync(path.join(newRelease, '.deployed_sha'), 'some-other-sha-entirely', 'utf8');

    const { status, stderr } = run(newRelease, dest);

    expect(status).not.toBe(0);
    expect(stderr).toMatch(/is a symlink pointing to/);
    expect(fs.realpathSync(dest)).toBe(fs.realpathSync(oldRelease));
  });

  it('Case F — genuine OS-level failure creating the temp symlink: dest left completely untouched, no leftover temp file (same discipline as Case E)', () => {
    if (typeof process.getuid === 'function' && process.getuid() === 0) {
      // Root bypasses permission bits entirely — skip rather than silently
      // pass on a broken assumption, matching the existing Case E test.
      return;
    }

    const releasesParent = path.join(tmpBase, 'nested');
    fs.mkdirSync(releasesParent, { recursive: true });
    const releasesDir = path.join(releasesParent, 'database-releases');
    fs.mkdirSync(releasesDir, { recursive: true });
    const dest = path.join(releasesParent, 'database');
    const oldRelease = makeValidRelease(releasesDir, 'oldsha8888888888');
    const newRelease = makeValidRelease(releasesDir, 'newsha9999999999');
    fs.symlinkSync(oldRelease, dest);

    // Block creation of the temp symlink by making dest's parent directory
    // read-only — same technique the existing Case E test uses, targeted at
    // the Case F temp-symlink-then-mv-T swap instead of the Case A create.
    fs.chmodSync(releasesParent, 0o555);
    try {
      const { status, stderr } = run(newRelease, dest);

      expect(status).not.toBe(0);
      expect(stderr).toMatch(/[Pp]ermission denied/);
      expect(stderr).toMatch(/left completely untouched/);
    } finally {
      fs.chmodSync(releasesParent, 0o755); // restore so afterEach's rmSync can clean up
    }

    // dest must still be the original symlink to the OLD release.
    expect(fs.lstatSync(dest).isSymbolicLink()).toBe(true);
    expect(fs.realpathSync(dest)).toBe(fs.realpathSync(oldRelease));

    // No leftover "database.new.<pid>" temp link anywhere.
    const leftovers = fs.readdirSync(releasesParent).filter((f) => f.startsWith('database.new.'));
    expect(leftovers).toHaveLength(0);
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
