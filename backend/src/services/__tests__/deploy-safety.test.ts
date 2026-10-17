/**
 * Coverage for the deploy-safety fixes made after run 38037952336, where a
 * production deploy's SSM command deleted the live backend dist/ and
 * node_modules/, then hit a full root disk in `npm ci`, while the CI job
 * had already failed on a transient InvocationDoesNotExist and skipped
 * rollback:
 *
 *   - .github/scripts/deploy-disk-preflight.sh, executed directly against a
 *     stubbed `df`;
 *   - the REAL SSM command lists of deploy-backend, deploy-migration-tooling
 *     and deploy-migration-tooling-admin — built by executing each step's
 *     actual `PARAMS=$(jq -n ...)` from ci.yml (same approach as
 *     migrate-deploy.test.ts) — run under `sh` in a disposable sandbox,
 *     with production paths rewritten into the sandbox and `sudo`, `aws`,
 *     `npm`, `pm2`, `df` and `chgrp` stubbed on PATH;
 *   - the deploy step's "live release untouched" output logic, executed
 *     from ci.yml against a stubbed wait script;
 *   - the rollback / verify-rollback / fail-job `if:` expressions,
 *     evaluated as a truth table over step outcomes;
 *   - the deploy step's runner side (payload encoding guard, send-command
 *     failure → "untouched"), the "Stop the deploy command before
 *     rollback" step (cancel → terminal, or rollback skipped) and the
 *     fail-job messages, each executed from ci.yml with a stubbed `aws`;
 *   - corrupt / truncated / empty base64 payloads on the host, which must
 *     stop every deploy before any download or deletion;
 *   - the host deploy lock, with real flock: a second deploy aborts
 *     untouched, rollback waits for the lock or reports ROLLBACK_NOT_STARTED,
 *     and a pm2 daemon started by a deploy never keeps the lock held;
 *   - one concurrency group per production deploy job.
 *
 * No AWS credentials, network calls or real hosts are involved.
 */

import { ChildProcess, execSync, spawn, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '../../../../');
const CI_WORKFLOW_PATH = path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml');
const PREFLIGHT_SCRIPT_PATH = path.join(REPO_ROOT, '.github', 'scripts', 'deploy-disk-preflight.sh');
const SHA = 'deadbeef'.repeat(5);

const ciYml = fs.readFileSync(CI_WORKFLOW_PATH, 'utf8');

function extractJobBlock(jobName: string): string {
  const match = ciYml.match(new RegExp(`\\n  ${jobName}:\\n[\\s\\S]*?(?=\\n  \\S|$)`));
  if (!match) throw new Error(`Could not locate job "${jobName}" in ci.yml`);
  return match[0];
}

function extractStep(jobName: string, stepName: string): string {
  const job = extractJobBlock(jobName);
  const start = job.indexOf(`- name: ${stepName}`);
  if (start === -1) throw new Error(`Could not locate step "${stepName}" in job "${jobName}"`);
  const rest = job.slice(start);
  const next = rest.slice(1).search(/\n {6}- name:|\n {4}#|\n {6}#/);
  return next === -1 ? rest : rest.slice(0, next + 1);
}

function minFreeMib(): number {
  const match = ciYml.match(/\n {2}DEPLOY_MIN_FREE_MIB: '(\d+)'/);
  if (!match) throw new Error('DEPLOY_MIN_FREE_MIB not found in workflow-level env');
  return Number(match[1]);
}

/**
 * Executes a step's real `*_SCRIPT_B64=$(base64 < ...)` lines and its
 * `PARAMS=$(jq -n ...)` assignment (with `${{ github.sha }}` and any other
 * `${{ ... }}` from ctx resolved, as the Actions runner does before any
 * shell runs) and returns the parsed SSM parameters.
 */
function buildParams(
  jobName: string,
  stepName: string,
  ctx: Record<string, string> = {}
): { commands: string[]; executionTimeout?: string[] } {
  const step = extractStep(jobName, stepName);
  const b64Lines = step.match(/^\s*[A-Z_]+_SCRIPT_(?:B64|SHA256)=\$\((?:base64|sha256sum) < .*\)$/gm) ?? [];
  const params = step.match(/PARAMS=\$\(jq -n[\s\S]*?\}'\)/);
  if (!params) throw new Error(`No PARAMS=$(jq -n ...) block in ${jobName} / ${stepName}`);
  const script = [...b64Lines.map((l) => l.trim()), params[0], 'echo "$PARAMS"']
    .join('\n')
    .replace(/\$\{\{ github\.sha \}\}/g, SHA)
    .replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
      if (!(expr in ctx)) throw new Error(`No test value for \${{ ${expr} }} in ${stepName}`);
      return ctx[expr];
    });
  const output = execSync(script, {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    shell: '/bin/bash',
    env: { ...process.env, DEPLOY_MIN_FREE_MIB: String(minFreeMib()) },
  });
  return JSON.parse(output);
}

const BACKEND = { job: 'deploy-backend', step: 'Deploy via SSM and restart PM2' };
const MIGRATION = {
  job: 'deploy-migration-tooling',
  step: 'Deploy migration tooling via SSM (files only — never executes migrations)',
};
const ADMIN = {
  job: 'deploy-migration-tooling-admin',
  step: 'Deploy admin migration tooling via SSM (files only — never executes migrations)',
};

// ---------------------------------------------------------------------------
// Sandbox: fake host filesystem + stubbed commands
// ---------------------------------------------------------------------------

interface Sandbox {
  root: string;
  app: string; // stands in for /home/ubuntu/devcontrol
  admin: string; // stands in for /opt/devcontrol-admin
  tmp: string; // stands in for /tmp
  lock: string; // stands in for /var/lock
  fixtures: string; // stands in for the S3 bucket
  log: string;
}

function writeExecutable(file: string, body: string): void {
  fs.writeFileSync(file, `#!/usr/bin/env bash\n${body}`, { mode: 0o755 });
}

function makeSandbox(): Sandbox {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-safety-')));
  const sb: Sandbox = {
    root,
    app: path.join(root, 'home/ubuntu/devcontrol'),
    admin: path.join(root, 'opt/devcontrol-admin'),
    tmp: path.join(root, 'tmp'),
    lock: path.join(root, 'var/lock'),
    fixtures: path.join(root, 's3'),
    log: path.join(root, 'commands.log'),
  };
  for (const d of [sb.app, path.join(root, 'opt'), sb.tmp, sb.lock, sb.fixtures, path.join(root, 'bin')]) {
    fs.mkdirSync(d, { recursive: true });
  }
  fs.writeFileSync(sb.log, '');
  const bin = path.join(root, 'bin');

  // sudo: drop `-H`, `-u <user>`, `--preserve-env=...`, log, then run as-is.
  writeExecutable(
    path.join(bin, 'sudo'),
    `while [ $# -gt 0 ]; do case "$1" in -H) shift ;; -u) shift 2 ;; --preserve-env=*) shift ;; *) break ;; esac; done
echo "sudo $*" >> "${sb.log}"
exec "$@"
`
  );
  // aws s3 cp s3://<bucket>/<key> <dest>: copies <fixtures>/<key>.
  writeExecutable(
    path.join(bin, 'aws'),
    `echo "aws $*" >> "${sb.log}"
if [ "$1" = "s3" ] && [ "$2" = "cp" ]; then
  KEY="\${3#s3://*/}"
  if [ -n "$FAIL_S3_MATCH" ] && [[ "$KEY" == *"$FAIL_S3_MATCH"* ]]; then
    echo "fake aws: download failed: [Errno 28] No space left on device" >&2
    exit 1
  fi
  if [ ! -f "${sb.fixtures}/$KEY" ]; then echo "fake aws: no such key $KEY" >&2; exit 1; fi
  cp "${sb.fixtures}/$KEY" "$4"
  exit 0
fi
echo "fake aws: unhandled $*" >&2
exit 1
`
  );
  writeExecutable(
    path.join(bin, 'npm'),
    `echo "npm $*" >> "${sb.log}"
if [ -n "$FAIL_NPM" ]; then echo "npm ERR! ENOSPC: no space left on device" >&2; exit 1; fi
mkdir -p node_modules && echo fresh > node_modules/.fresh-install
`
  );
  writeExecutable(path.join(bin, 'pm2'), `echo "pm2 $*" >> "${sb.log}"\n`);
  writeExecutable(path.join(bin, 'chgrp'), `echo "chgrp $*" >> "${sb.log}"\n`);
  writeExecutable(path.join(bin, 'node'), `echo "node $*" >> "${sb.log}"\nexit 1\n`);
  // df -Pk <path>: POSIX format, available KiB from FAKE_DF_AVAIL_KIB.
  writeExecutable(
    path.join(bin, 'df'),
    `echo "df $*" >> "${sb.log}"
echo "Filesystem 1024-blocks Used Available Capacity Mounted on"
echo "/dev/fake 20000000 1000 \${FAKE_DF_AVAIL_KIB} 1% /"
`
  );
  return sb;
}

function writeFile(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content);
}

/** Every file/symlink under a directory, mapped to its content or link target. */
function snapshot(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(dir)) return out;
  const walk = (d: string) => {
    for (const entry of fs.readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, entry.name);
      const rel = path.relative(dir, full);
      if (entry.isSymbolicLink()) out[rel] = `-> ${fs.readlinkSync(full)}`;
      else if (entry.isDirectory()) {
        out[`${rel}/`] = 'dir';
        walk(full);
      } else out[rel] = fs.readFileSync(full, 'utf8');
    }
  };
  walk(dir);
  return out;
}

function tarFromFiles(tarball: string, files: Record<string, string>): void {
  const stage = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-safety-stage-'));
  for (const [rel, content] of Object.entries(files)) writeFile(path.join(stage, rel), content);
  fs.mkdirSync(path.dirname(tarball), { recursive: true });
  execSync(`tar czf ${JSON.stringify(tarball)} -C ${JSON.stringify(stage)} .`);
}

/** Rewrites production paths in the real commands to sandbox paths. */
function toSandbox(sb: Sandbox, commands: string[]): string[] {
  return commands.map((c) =>
    c
      .replace(/(^|[\s'"=])\/tmp(?=[/\s'"]|$)/g, `$1${sb.tmp}`)
      .split('/home/ubuntu/devcontrol')
      .join(sb.app)
      .split('/opt/devcontrol-admin')
      .join(sb.admin)
      .split('/var/lock/')
      .join(`${sb.lock}/`)
  );
}

function runOnSandbox(
  sb: Sandbox,
  commands: string[],
  env: Record<string, string>
): { status: number; stdout: string; stderr: string; log: string[] } {
  const scriptPath = path.join(sb.root, '_script.sh');
  fs.writeFileSync(scriptPath, toSandbox(sb, commands).join('\n') + '\n');
  // AWS-RunShellScript runs the joined commands with `sh` (dash on the
  // Ubuntu host and on the CI runner).
  const result = spawnSync('sh', [scriptPath], {
    cwd: sb.root,
    encoding: 'utf8',
    env: {
      PATH: `${path.join(sb.root, 'bin')}:${process.env.PATH}`,
      HOME: sb.root,
      // Decoded payloads go through `mktemp`; keep them inside the sandbox
      // so leftovers are visible to the assertions.
      TMPDIR: sb.tmp,
      ...env,
    },
  });
  return {
    status: result.status ?? -1,
    stdout: result.stdout,
    stderr: result.stderr,
    log: fs.readFileSync(sb.log, 'utf8').split('\n').filter(Boolean),
  };
}

const ENOUGH_KIB = String((minFreeMib() + 500) * 1024);
const TOO_LITTLE_KIB = String((minFreeMib() - 1) * 1024);

type Corruption = 'invalid' | 'truncated' | 'empty';
const CORRUPTIONS: Corruption[] = ['invalid', 'truncated', 'empty'];

/**
 * Replaces the base64 payload in the real `echo <b64> | base64 -d > "$<VAR>"`
 * command with a bad one: not base64 at all, a valid-but-truncated prefix
 * (decodes fine, fails the SHA-256 check), or nothing.
 */
function corruptPayload(commands: string[], target: 'PREFLIGHT_SH' | 'SYMLINK_SH', mode: Corruption): string[] {
  const suffix = ` | base64 -d > "$${target}"`;
  const idx = commands.findIndex((c) => c.startsWith('echo ') && c.endsWith(suffix));
  if (idx === -1) throw new Error(`No ${target} decode command found`);
  const b64 = commands[idx].slice('echo '.length, -suffix.length);
  const bad = mode === 'invalid' ? '@@not-base64@@' : mode === 'truncated' ? b64.slice(0, 200) : '';
  const out = [...commands];
  out[idx] = `echo ${bad}${suffix}`;
  return out;
}

// ---------------------------------------------------------------------------
// deploy-disk-preflight.sh
// ---------------------------------------------------------------------------

describe('deploy-disk-preflight.sh', () => {
  function runPreflight(args: string[], availKib: string) {
    const sb = makeSandbox();
    const result = spawnSync('bash', [PREFLIGHT_SCRIPT_PATH, ...args], {
      encoding: 'utf8',
      env: { PATH: `${path.join(sb.root, 'bin')}:${process.env.PATH}`, FAKE_DF_AVAIL_KIB: availKib },
    });
    return { status: result.status, stdout: result.stdout, stderr: result.stderr, sb };
  }

  it('has no syntax errors', () => {
    expect(spawnSync('bash', ['-n', PREFLIGHT_SCRIPT_PATH]).status).toBe(0);
  });

  it('passes when every filesystem has at least the required free space', () => {
    const { status, stdout } = runPreflight(['1024', os.tmpdir(), REPO_ROOT], String(1024 * 1024));
    expect(status).toBe(0);
    expect(stdout.match(/Disk preflight OK/g)).toHaveLength(2);
  });

  it('fails with a clear message when free space is below the threshold', () => {
    const { status, stderr } = runPreflight(['1024', os.tmpdir()], String(1023 * 1024));
    expect(status).toBe(1);
    expect(stderr).toContain('insufficient disk space');
    expect(stderr).toContain('1023 MiB free, 1024 MiB required');
    expect(stderr).toContain('the running release is untouched');
  });

  it('checks a not-yet-existing path via its nearest existing ancestor', () => {
    const missing = path.join(os.tmpdir(), 'does-not-exist-yet', 'a', 'b');
    const { status, sb } = runPreflight(['10', missing], String(20 * 1024));
    expect(status).toBe(0);
    const dfCalls = fs.readFileSync(sb.log, 'utf8');
    expect(dfCalls).toContain(`df -Pk ${os.tmpdir()}`);
    expect(dfCalls).not.toContain('does-not-exist-yet');
  });

  it('fails closed when df output cannot be parsed', () => {
    const { status, stderr } = runPreflight(['10', os.tmpdir()], 'garbage');
    expect(status).toBe(1);
    expect(stderr).toContain('could not determine free space');
  });

  it('fails closed on bad usage (no paths, non-numeric threshold)', () => {
    expect(runPreflight(['10'], '1').status).toBe(1);
    expect(runPreflight(['lots', os.tmpdir()], '1').status).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// deploy-backend: real SSM command list executed in a sandbox
// ---------------------------------------------------------------------------

describe('deploy-backend SSM command (executes the real jq-built command list from ci.yml)', () => {
  const params = buildParams(BACKEND.job, BACKEND.step);

  function seedBackend(sb: Sandbox): void {
    // Live release + persistent state on the "host".
    writeFile(path.join(sb.app, 'backend/dist/index.js'), 'OLD RELEASE');
    writeFile(path.join(sb.app, 'backend/node_modules/.old'), 'old deps');
    writeFile(path.join(sb.app, 'node_modules/.old'), 'old root deps');
    writeFile(path.join(sb.app, 'backend/package.json'), 'old backend manifest');
    writeFile(path.join(sb.app, 'package.json'), 'old workspace manifest');
    writeFile(path.join(sb.app, 'package-lock.json'), 'old lockfile');
    writeFile(path.join(sb.app, 'backend/.deployed_sha'), 'previous-known-good-sha');
    writeFile(path.join(sb.app, 'backend/logs/app.log'), 'investigation logs');
    writeFile(path.join(sb.app, 'database-releases/previous/migrate.js'), 'previous migration tooling');
    writeFile(path.join(sb.app, 'uploads/user-file.txt'), 'user data');
    writeFile(path.join(sb.tmp, 'unrelated-dist-other.tar.gz'), 'someone else’s tarball');
    // "S3" artifacts for this SHA.
    tarFromFiles(path.join(sb.fixtures, `backend/${SHA}/dist.tar.gz`), { 'index.js': 'NEW RELEASE' });
    writeFile(path.join(sb.fixtures, `backend/${SHA}/package.json`), 'new backend manifest');
    writeFile(path.join(sb.fixtures, `backend/${SHA}/workspace-package.json`), 'new workspace manifest');
    writeFile(path.join(sb.fixtures, `backend/${SHA}/package-lock.json`), 'new lockfile');
  }

  const PERSISTENT = [
    'backend/.deployed_sha',
    'backend/logs/app.log',
    'database-releases/previous/migrate.js',
    'uploads/user-file.txt',
  ];

  function expectPersistentIntact(sb: Sandbox, before: Record<string, string>): void {
    const after = snapshot(sb.app);
    for (const rel of PERSISTENT) expect(after[rel]).toBe(before[rel]);
    expect(fs.readFileSync(path.join(sb.tmp, 'unrelated-dist-other.tar.gz'), 'utf8')).toBe('someone else’s tarball');
  }

  function expectNoDeployLeftovers(sb: Sandbox): void {
    expect(fs.existsSync(path.join(sb.tmp, `dist-${SHA}.tar.gz`))).toBe(false);
    expect(fs.existsSync(path.join(sb.app, `.deploy-staging-${SHA}`))).toBe(false);
    // Only the unrelated seeded file remains: decoded payload temp files are gone.
    expect(fs.readdirSync(sb.tmp)).toEqual(['unrelated-dist-other.tar.gz']);
  }

  it('bounds the command: 120s delivery timeout + 480s executionTimeout fit within the poller ceiling (defense in depth — the settle step is the real guard)', () => {
    const pollerSrc = fs.readFileSync(path.join(REPO_ROOT, '.github/scripts/wait-for-ssm-command.sh'), 'utf8');
    const ceiling = Number(pollerSrc.match(/SSM_WAIT_MAX_SECONDS:-(\d+)/)![1]);
    expect(params.executionTimeout).toEqual(['480']);
    expect(extractStep(BACKEND.job, BACKEND.step)).toMatch(/--timeout-seconds 120 \\\n/);
    expect(120 + 480).toBeLessThanOrEqual(ceiling);
  });

  it.each([
    [BACKEND.job, BACKEND.step],
    [BACKEND.job, 'Roll back to previous deploy'],
    [MIGRATION.job, MIGRATION.step],
    [ADMIN.job, ADMIN.step],
  ])('%s / %s: send-command sets a 120s delivery timeout so an undelivered command never starts late', (job, step) => {
    const src = extractStep(job, step);
    expect(src).toContain('aws ssm send-command');
    expect(src).toMatch(/--timeout-seconds 120 \\\n/);
  });

  it('runs the disk preflight on /tmp AND the install root before any download, extraction or deletion', () => {
    const cmds = params.commands;
    const preflightIdx = cmds.findIndex((c) => c.startsWith('bash "$PREFLIGHT_SH" '));
    expect(cmds[preflightIdx]).toBe(`bash "$PREFLIGHT_SH" ${minFreeMib()} /tmp /home/ubuntu/devcontrol`);
    const firstMutating = cmds.findIndex((c) => /aws s3 cp|tar xzf|rm -rf|rm -f |mkdir|mv /.test(c) && !c.startsWith('trap'));
    expect(preflightIdx).toBeGreaterThan(-1);
    expect(preflightIdx).toBeLessThan(firstMutating);
  });

  it('5. insufficient disk: fails before any download/extract/delete and leaves the live release byte-identical', () => {
    const sb = makeSandbox();
    seedBackend(sb);
    const before = snapshot(sb.app);
    const { status, stdout, stderr, log } = runOnSandbox(sb, params.commands, { FAKE_DF_AVAIL_KIB: TOO_LITTLE_KIB });
    expect(status).not.toBe(0);
    expect(stderr).toContain('insufficient disk space');
    expect(log.some((l) => l.startsWith('aws '))).toBe(false);
    expect(log.some((l) => l.startsWith('npm ') || l.startsWith('pm2 '))).toBe(false);
    expect(snapshot(sb.app)).toEqual(before);
    expect(stdout).toContain('DEPLOY_ABORTED_BEFORE_LIVE_CHANGES');
  });

  it('6. adequate disk: stages everything first, then swaps in the new release, reinstalls and restarts', () => {
    const sb = makeSandbox();
    seedBackend(sb);
    const before = snapshot(sb.app);
    const { status, stdout, log } = runOnSandbox(sb, params.commands, { FAKE_DF_AVAIL_KIB: ENOUGH_KIB });
    expect(status).toBe(0);
    expect(stdout).not.toContain('DEPLOY_ABORTED_BEFORE_LIVE_CHANGES');

    const after = snapshot(sb.app);
    expect(after['backend/dist/index.js']).toBe('NEW RELEASE');
    expect(after['backend/package.json']).toBe('new backend manifest');
    expect(after['package.json']).toBe('new workspace manifest');
    expect(after['package-lock.json']).toBe('new lockfile');
    expect(after['node_modules/.old']).toBeUndefined();
    expect(after['backend/node_modules/.old']).toBeUndefined();
    expect(after['node_modules/.fresh-install']).toBe('fresh\n');
    expect(log).toContain('sudo pm2 restart devcontrol-api --update-env');

    // Ordering: every artifact download happens before the live dist is deleted.
    const lastDownload = Math.max(...log.map((l, i) => (l.startsWith('aws s3 cp') ? i : -1)));
    const liveDistDelete = log.indexOf(`sudo rm -rf ${sb.app}/backend/dist`);
    expect(liveDistDelete).toBeGreaterThan(lastDownload);

    // 7 (success) + 8: tarball/staging removed, persistent files untouched.
    expectNoDeployLeftovers(sb);
    expectPersistentIntact(sb, before);
  });

  it.each([
    ['the dist tarball download', 'dist.tar.gz'],
    ['a manifest download after extraction', 'package-lock.json'],
  ])('7. failure in %s: aborts with the live release byte-identical, marker printed, tarball + staging removed', (_l, match) => {
    const sb = makeSandbox();
    seedBackend(sb);
    const before = snapshot(sb.app);
    const { status, stdout } = runOnSandbox(sb, params.commands, {
      FAKE_DF_AVAIL_KIB: ENOUGH_KIB,
      FAIL_S3_MATCH: match,
    });
    expect(status).not.toBe(0);
    expect(stdout).toContain('DEPLOY_ABORTED_BEFORE_LIVE_CHANGES');
    expect(snapshot(sb.app)).toEqual(before);
    expectNoDeployLeftovers(sb);
  });

  it('7/8. failure after the live release was modified (npm ci): no "untouched" marker, deploy temp files removed, persistent files kept', () => {
    const sb = makeSandbox();
    seedBackend(sb);
    const before = snapshot(sb.app);
    const { status, stdout } = runOnSandbox(sb, params.commands, { FAKE_DF_AVAIL_KIB: ENOUGH_KIB, FAIL_NPM: '1' });
    expect(status).not.toBe(0);
    // Rollback must run for this case — the marker is the only thing that skips it.
    expect(stdout).not.toContain('DEPLOY_ABORTED_BEFORE_LIVE_CHANGES');
    expectNoDeployLeftovers(sb);
    expectPersistentIntact(sb, before);
  });

  it.each(CORRUPTIONS)('S1. %s preflight payload: stops before preflight/download/delete, live release byte-identical, marker printed', (mode) => {
    const sb = makeSandbox();
    seedBackend(sb);
    const before = snapshot(sb.app);
    const { status, stdout, stderr, log } = runOnSandbox(sb, corruptPayload(params.commands, 'PREFLIGHT_SH', mode), {
      FAKE_DF_AVAIL_KIB: ENOUGH_KIB,
    });
    expect(status).not.toBe(0);
    if (mode !== 'invalid') expect(stderr).toContain('payload failed to decode or verify');
    // Nothing ran at all: no df (preflight never executed), no sudo, no aws.
    expect(log).toEqual([]);
    expect(snapshot(sb.app)).toEqual(before);
    expect(stdout).toContain('DEPLOY_ABORTED_BEFORE_LIVE_CHANGES');
    expectNoDeployLeftovers(sb);
  });

  // -------------------------------------------------------------------------
  // Host deploy lock: real flock, real dash, two "SSM commands" racing
  // -------------------------------------------------------------------------

  describe('host deploy lock (deploy + rollback, executed with real flock)', () => {
    const LOCK = '/var/lock/devcontrol-backend-deploy.lock';
    const PREV = 'cafef00d'.repeat(5);
    const ROLLBACK_STEP = 'Roll back to previous deploy';
    const rollbackParams = (ws: 'true' | 'false') =>
      buildParams(BACKEND.job, ROLLBACK_STEP, {
        'steps.get_prev_sha.outputs.prev_sha': PREV,
        'steps.get_prev_sha.outputs.prev_workspace_artifacts_exist': ws,
      });
    const children: ChildProcess[] = [];
    const pids: number[] = [];

    afterEach(() => {
      for (const c of children.splice(0)) c.kill('SIGKILL');
      for (const p of pids.splice(0)) {
        try {
          process.kill(p, 'SIGKILL');
        } catch {
          // already gone
        }
      }
    });

    const lockFile = (sb: Sandbox) => path.join(sb.lock, path.basename(LOCK));

    function waitFor(cond: () => boolean, ms = 5000): void {
      const end = Date.now() + ms;
      while (!cond()) {
        if (Date.now() > end) throw new Error('waitFor timed out');
        execSync('sleep 0.05');
      }
    }

    /** Another deploy/rollback "SSM command": holds the lock for `seconds`. */
    function holdLock(sb: Sandbox, seconds: number): ChildProcess {
      const ready = path.join(sb.root, 'holder.ready');
      const child = spawn(
        'sh',
        ['-c', 'exec 9>"$1"; flock -n 9 || exit 3; : > "$2"; exec sleep "$3"', 'sh', lockFile(sb), ready, String(seconds)],
        { stdio: 'ignore' }
      );
      children.push(child);
      waitFor(() => fs.existsSync(ready));
      return child;
    }

    const isLocked = (sb: Sandbox) => spawnSync('flock', ['-n', lockFile(sb), 'true']).status !== 0;

    function seedPrevious(sb: Sandbox): void {
      tarFromFiles(path.join(sb.fixtures, `backend/${PREV}/dist.tar.gz`), { 'index.js': 'PREVIOUS RELEASE' });
      writeFile(path.join(sb.fixtures, `backend/${PREV}/package.json`), 'previous backend manifest');
      writeFile(path.join(sb.fixtures, `backend/${PREV}/workspace-package.json`), 'previous workspace manifest');
      writeFile(path.join(sb.fixtures, `backend/${PREV}/package-lock.json`), 'previous lockfile');
    }

    /** pm2 stub that, like a real first `pm2 restart`, leaves a daemon behind. */
    function daemonizingPm2(sb: Sandbox): string {
      const pidFile = path.join(sb.root, 'pm2-daemon.pid');
      writeExecutable(
        path.join(sb.root, 'bin/pm2'),
        `echo "pm2 $*" >> "${sb.log}"
if [ "$1" = restart ]; then nohup sleep 60 >/dev/null 2>&1 </dev/null & echo $! > "${pidFile}"; fi
`
      );
      return pidFile;
    }

    it('deploy and rollback take the same lock before anything else runs; every pm2 call closes fd 9', () => {
      for (const cmds of [params.commands, rollbackParams('true').commands, rollbackParams('false').commands]) {
        const lockIdx = cmds.findIndex((c) => c === `exec 9>${LOCK}`);
        expect(lockIdx).toBeGreaterThan(-1);
        expect(cmds[lockIdx + 1]).toMatch(/^if ! flock -(n|w 300) 9; then /);
        const firstWork = cmds.findIndex((c) => /mktemp|aws s3 cp|tar xzf|rm -rf|rm -f |mkdir|mv |npm |pm2 /.test(c) && !c.startsWith('trap'));
        expect(lockIdx).toBeLessThan(firstWork);
        expect(cmds.findIndex((c) => c.includes('command -v flock'))).toBeLessThan(lockIdx);
        const pm2 = cmds.filter((c) => / pm2 /.test(c));
        expect(pm2.length).toBe(2);
        for (const c of pm2) expect(c).toMatch(/ 9>&-$/);
      }
      expect(params.commands).toContain(`if ! flock -n 9; then echo "ERROR: another backend deploy or rollback holds ${LOCK} — refusing to deploy. The live release was not touched." >&2; exit 1; fi`);
    });

    it('rollback is bounded: 300s lock wait + 480s install = executionTimeout 780, and 120s delivery + 780 fit the 960s poller ceiling', () => {
      expect(rollbackParams('true').executionTimeout).toEqual(['780']);
      expect(rollbackParams('true').commands.some((c) => c.startsWith('if ! flock -w 300 9; then '))).toBe(true);
      expect(extractStep(BACKEND.job, ROLLBACK_STEP)).toContain(
        'SSM_WAIT_MAX_SECONDS=960 bash .github/scripts/wait-for-ssm-command.sh "$COMMAND_ID" "i-0c3e55c290844ec59"'
      );
      expect(120 + 300 + 480).toBeLessThanOrEqual(960);
    });

    it('a second deploy aborts while another deploy/rollback holds the lock: untouched marker, nothing run, same-SHA staging + tarball of the running one kept', () => {
      const sb = makeSandbox();
      seedBackend(sb);
      // The lock holder is a same-SHA deploy mid-flight (e.g. a re-run).
      writeFile(path.join(sb.app, `.deploy-staging-${SHA}/dist/index.js`), 'IN-FLIGHT STAGING');
      writeFile(path.join(sb.tmp, `dist-${SHA}.tar.gz`), 'IN-FLIGHT TARBALL');
      const before = snapshot(sb.app);
      holdLock(sb, 30);
      const { status, stdout, stderr, log } = runOnSandbox(sb, params.commands, { FAKE_DF_AVAIL_KIB: ENOUGH_KIB });
      expect(status).not.toBe(0);
      expect(stdout).toContain('DEPLOY_ABORTED_BEFORE_LIVE_CHANGES');
      expect(stderr).toContain(`another backend deploy or rollback holds ${sb.lock}/devcontrol-backend-deploy.lock`);
      expect(log).toEqual([]);
      expect(snapshot(sb.app)).toEqual(before);
      expect(fs.readFileSync(path.join(sb.tmp, `dist-${SHA}.tar.gz`), 'utf8')).toBe('IN-FLIGHT TARBALL');
    });

    it('deploy fails closed when flock is missing: untouched marker, nothing run', () => {
      const sb = makeSandbox();
      seedBackend(sb);
      const before = snapshot(sb.app);
      const cmds = params.commands.map((c) => c.replace('command -v flock ', 'command -v flock-not-installed '));
      expect(cmds).not.toEqual(params.commands);
      const { status, stdout, stderr, log } = runOnSandbox(sb, cmds, { FAKE_DF_AVAIL_KIB: ENOUGH_KIB });
      expect(status).not.toBe(0);
      expect(stdout).toContain('DEPLOY_ABORTED_BEFORE_LIVE_CHANGES');
      expect(stderr).toContain('flock (util-linux) not found on the host — refusing to deploy');
      expect(log).toEqual([]);
      expect(snapshot(sb.app)).toEqual(before);
    });

    it('a pm2 daemon started during the deploy does NOT keep the lock held after the deploy ends', () => {
      const sb = makeSandbox();
      seedBackend(sb);
      const pidFile = daemonizingPm2(sb);
      const { status } = runOnSandbox(sb, params.commands, { FAKE_DF_AVAIL_KIB: ENOUGH_KIB });
      expect(status).toBe(0);
      const pid = Number(fs.readFileSync(pidFile, 'utf8'));
      pids.push(pid);
      expect(() => process.kill(pid, 0)).not.toThrow(); // the "daemon" is still alive...
      expect(isLocked(sb)).toBe(false); // ...and the lock is free.
    });

    it('control: without `9>&-` the same daemon WOULD keep the lock held (proves the test above can fail)', () => {
      const sb = makeSandbox();
      seedBackend(sb);
      const pidFile = daemonizingPm2(sb);
      const cmds = params.commands.map((c) => c.replace(/ 9>&-$/, ''));
      expect(cmds).not.toEqual(params.commands);
      const { status } = runOnSandbox(sb, cmds, { FAKE_DF_AVAIL_KIB: ENOUGH_KIB });
      expect(status).toBe(0);
      pids.push(Number(fs.readFileSync(pidFile, 'utf8')));
      expect(isLocked(sb)).toBe(true);
    });

    it('rollback waits for the lock, then proceeds once it is released', () => {
      const sb = makeSandbox();
      seedBackend(sb);
      seedPrevious(sb);
      holdLock(sb, 2);
      const started = Date.now();
      const { status, stdout, log } = runOnSandbox(sb, rollbackParams('true').commands, {});
      const elapsed = Date.now() - started;
      expect(status).toBe(0);
      expect(elapsed).toBeGreaterThanOrEqual(1500);
      expect(stdout).toContain(`Rolled back to ${PREV}`);
      expect(stdout).not.toContain('ROLLBACK_NOT_STARTED');
      expect(fs.readFileSync(path.join(sb.app, 'backend/dist/index.js'), 'utf8')).toBe('PREVIOUS RELEASE');
      expect(log).toContain('sudo pm2 restart devcontrol-api --update-env');
      expect(isLocked(sb)).toBe(false);
    });

    it('rollback times out on the lock: ROLLBACK_NOT_STARTED, nothing run, live release untouched', () => {
      const sb = makeSandbox();
      seedBackend(sb);
      seedPrevious(sb);
      const before = snapshot(sb.app);
      holdLock(sb, 30);
      // Same command list with the 300s wait shortened so the test is fast.
      const cmds = rollbackParams('true').commands.map((c) => c.replace('flock -w 300 9', 'flock -w 1 9'));
      expect(cmds).not.toEqual(rollbackParams('true').commands);
      const { status, stdout, stderr, log } = runOnSandbox(sb, cmds, {});
      expect(status).not.toBe(0);
      expect(stdout).toContain('ROLLBACK_NOT_STARTED');
      expect(stderr).toContain('rollback NOT started, nothing was changed');
      expect(log).toEqual([]);
      expect(snapshot(sb.app)).toEqual(before);
    });
  });
});

// ---------------------------------------------------------------------------
// Migration tooling + admin migration tooling: real command lists
// ---------------------------------------------------------------------------

describe.each([
  {
    label: 'deploy-migration-tooling',
    spec: MIGRATION,
    s3Key: `database/${SHA}/migrations.tar.gz`,
    tarball: `migrations-${SHA}.tar.gz`,
    releases: (sb: Sandbox) => path.join(sb.app, 'database-releases'),
    dest: (sb: Sandbox) => path.join(sb.app, 'database'),
    preflightArgs: '/tmp /home/ubuntu/devcontrol/database-releases',
  },
  {
    label: 'deploy-migration-tooling-admin',
    spec: ADMIN,
    s3Key: `database-admin/${SHA}/migrations-admin.tar.gz`,
    tarball: `migrations-admin-${SHA}.tar.gz`,
    releases: (sb: Sandbox) => path.join(sb.admin, 'database-releases'),
    dest: (sb: Sandbox) => path.join(sb.admin, 'database'),
    preflightArgs: '/tmp /opt/devcontrol-admin/database-releases',
  },
])('$label SSM command (executes the real jq-built command list from ci.yml)', (c) => {
  const params = buildParams(c.spec.job, c.spec.step);

  function seed(sb: Sandbox): void {
    tarFromFiles(path.join(sb.fixtures, c.s3Key), {
      'migrate.js': 'console.log("migrate")',
      'migrations/001_init.sql': 'select 1;',
    });
    writeFile(path.join(sb.app, 'backend/dist/index.js'), 'LIVE BACKEND');
  }

  it('preflight is the first command after setup, before the download', () => {
    const cmds = params.commands;
    const preflightIdx = cmds.findIndex((x) => x.startsWith('bash "$PREFLIGHT_SH" '));
    const symlinkDecodeIdx = cmds.findIndex((x) => x.includes('| base64 -d > "$SYMLINK_SH"'));
    const downloadIdx = cmds.findIndex((x) => x.includes('aws s3 cp'));
    expect(cmds[preflightIdx]).toBe(`bash "$PREFLIGHT_SH" ${minFreeMib()} ${c.preflightArgs}`);
    expect(preflightIdx).toBeGreaterThan(-1);
    expect(symlinkDecodeIdx).toBeGreaterThan(-1);
    expect(preflightIdx).toBeLessThan(downloadIdx);
    expect(symlinkDecodeIdx).toBeLessThan(downloadIdx);
  });

  it('uses the shared bounded poller, never `aws ssm wait command-executed`', () => {
    const step = extractStep(c.spec.job, c.spec.step);
    expect(step).toContain('bash .github/scripts/wait-for-ssm-command.sh "$COMMAND_ID"');
    expect(step).not.toMatch(/^\s*aws ssm wait command-executed/m);
  });

  it('5. insufficient disk: fails before any download/extract, creates nothing, touches nothing', () => {
    const sb = makeSandbox();
    seed(sb);
    const before = snapshot(sb.root);
    const { status, stderr, log } = runOnSandbox(sb, params.commands, { FAKE_DF_AVAIL_KIB: TOO_LITTLE_KIB });
    expect(status).not.toBe(0);
    expect(stderr).toContain('insufficient disk space');
    expect(log.some((l) => l.startsWith('aws '))).toBe(false);
    const after = snapshot(sb.root);
    delete after['commands.log'];
    delete after['_script.sh'];
    const beforeCmp = { ...before };
    delete beforeCmp['commands.log'];
    expect(after).toEqual(beforeCmp);
    expect(fs.existsSync(c.releases(sb))).toBe(false);
  });

  it('6/7. adequate disk: deploys files only (never runs migrate.js), points the symlink, removes its tarball', () => {
    const sb = makeSandbox();
    seed(sb);
    const { status, log } = runOnSandbox(sb, params.commands, { FAKE_DF_AVAIL_KIB: ENOUGH_KIB });
    expect(status).toBe(0);
    const release = path.join(c.releases(sb), SHA);
    expect(fs.readFileSync(path.join(release, 'migrate.js'), 'utf8')).toContain('migrate');
    expect(fs.readFileSync(path.join(release, '.deployed_sha'), 'utf8').trim()).toBe(SHA);
    expect(fs.realpathSync(c.dest(sb))).toBe(fs.realpathSync(release));
    expect(fs.existsSync(path.join(sb.tmp, c.tarball))).toBe(false);
    expect(log.some((l) => l.startsWith('node '))).toBe(false);
    expect(fs.readFileSync(path.join(sb.app, 'backend/dist/index.js'), 'utf8')).toBe('LIVE BACKEND');
  });

  it('7/8. a failed extract into an EXISTING (live) release dir never deletes it, and the tarball is still removed', () => {
    const sb = makeSandbox();
    const release = path.join(c.releases(sb), SHA);
    writeFile(path.join(release, 'migrate.js'), 'live tooling');
    writeFile(path.join(release, '.deployed_sha'), SHA);
    fs.symlinkSync(release, c.dest(sb));
    writeFile(path.join(sb.fixtures, c.s3Key), 'not a gzip tarball');
    const { status } = runOnSandbox(sb, params.commands, { FAKE_DF_AVAIL_KIB: ENOUGH_KIB });
    expect(status).not.toBe(0);
    expect(fs.readFileSync(path.join(release, 'migrate.js'), 'utf8')).toBe('live tooling');
    expect(fs.realpathSync(c.dest(sb))).toBe(fs.realpathSync(release));
    expect(fs.existsSync(path.join(sb.tmp, c.tarball))).toBe(false);
  });

  it('7. a failed extract into a NEW release dir removes only that half-extracted dir and the tarball', () => {
    const sb = makeSandbox();
    writeFile(path.join(sb.fixtures, c.s3Key), 'not a gzip tarball');
    const { status } = runOnSandbox(sb, params.commands, { FAKE_DF_AVAIL_KIB: ENOUGH_KIB });
    expect(status).not.toBe(0);
    expect(fs.existsSync(path.join(c.releases(sb), SHA))).toBe(false);
    expect(fs.existsSync(path.join(sb.tmp, c.tarball))).toBe(false);
  });

  it.each(
    (['PREFLIGHT_SH', 'SYMLINK_SH'] as const).flatMap((target) => CORRUPTIONS.map((mode) => [target, mode] as const))
  )('S1. %s payload %s: stops before preflight/download, creates and touches nothing', (target, mode) => {
    const sb = makeSandbox();
    seed(sb);
    const before = snapshot(sb.root);
    const { status, stderr, log } = runOnSandbox(sb, corruptPayload(params.commands, target, mode), {
      FAKE_DF_AVAIL_KIB: ENOUGH_KIB,
    });
    expect(status).not.toBe(0);
    if (mode !== 'invalid') expect(stderr).toContain('payload failed to decode or verify');
    expect(log).toEqual([]);
    const after = snapshot(sb.root);
    delete after['commands.log'];
    delete after['_script.sh'];
    const beforeCmp = { ...before };
    delete beforeCmp['commands.log'];
    // Includes the sandbox tmp dir: the decoded temp files were removed too.
    expect(after).toEqual(beforeCmp);
  });
});

// ---------------------------------------------------------------------------
// Deploy step: "live release untouched" output, executed from ci.yml
// ---------------------------------------------------------------------------

describe('deploy step marks live_release_untouched only on a positive remote marker', () => {
  const step = extractStep(BACKEND.job, BACKEND.step);
  const tailMatch = step.match(/ {10}SSM_LOG=[\s\S]*\n {10}exit 1\n/);

  function runTail(fakeWaitOutput: string, fakeWaitExit: number) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-step-tail-'));
    fs.mkdirSync(path.join(dir, '.github/scripts'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'wait-output.txt'), fakeWaitOutput);
    fs.writeFileSync(
      path.join(dir, '.github/scripts/wait-for-ssm-command.sh'),
      `cat "${path.join(dir, 'wait-output.txt')}"\nexit ${fakeWaitExit}\n`
    );
    const outputFile = path.join(dir, 'github-output');
    fs.writeFileSync(outputFile, '');
    const script = ['set -eo pipefail', 'COMMAND_ID=cmd-123', tailMatch![0].replace(/\$\{\{ github\.sha \}\}/g, SHA)].join('\n');
    const result = spawnSync('bash', ['-c', script], {
      cwd: dir,
      encoding: 'utf8',
      env: { ...process.env, RUNNER_TEMP: dir, GITHUB_OUTPUT: outputFile },
    });
    return { status: result.status, stdout: result.stdout, output: fs.readFileSync(outputFile, 'utf8') };
  }

  it('the tail of the step can be located', () => {
    expect(tailMatch).not.toBeNull();
  });

  it('success: exits 0 and sets no output', () => {
    const r = runTail('--- stdout ---\nok\n', 0);
    expect(r.status).toBe(0);
    expect(r.output).toBe('');
  });

  it('failure WITH the marker (e.g. disk preflight): exits 1 and sets live_release_untouched=true', () => {
    const r = runTail('--- stdout ---\nERROR: insufficient disk space\nDEPLOY_ABORTED_BEFORE_LIVE_CHANGES\n', 1);
    expect(r.status).toBe(1);
    expect(r.output).toBe('live_release_untouched=true\n');
  });

  it('failure WITHOUT the marker (mid-install failure, unregistered invocation, killed command): exits 1, output unset so rollback runs', () => {
    for (const out of ['--- stdout ---\nnpm ERR! ENOSPC\n', '--- stdout ---\n(could not retrieve StandardOutputContent)\n']) {
      const r = runTail(out, 1);
      expect(r.status).toBe(1);
      expect(r.output).toBe('');
    }
  });
});

// ---------------------------------------------------------------------------
// Rollback conditions: evaluated truth table
// ---------------------------------------------------------------------------

type Outcome = 'success' | 'failure' | 'skipped';
interface Ctx {
  cancelled: boolean;
  deploy: Outcome;
  untouched: string;
  smoke: Outcome;
  settled: string;
  rollback: Outcome;
  prevExists: string;
  prevSha: string;
}

/**
 * Translates the small subset of GitHub Actions expression syntax these
 * conditions use (status functions, step outcomes/outputs, ==, !=, &&, ||,
 * parentheses, single-quoted strings) into a JS predicate. Any token outside
 * that subset makes translation throw, so an unexpected construct is caught
 * rather than silently mis-evaluated.
 */
function compileCondition(expr: string): (ctx: Ctx) => boolean {
  const js = expr
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/!cancelled\(\)/g, '!ctx.cancelled')
    .replace(/steps\.deploy\.outputs\.live_release_untouched/g, 'ctx.untouched')
    .replace(/steps\.settle_deploy\.outputs\.settled/g, 'ctx.settled')
    .replace(/steps\.get_prev_sha\.outputs\.prev_artifact_exists/g, 'ctx.prevExists')
    .replace(/steps\.get_prev_sha\.outputs\.prev_sha/g, 'ctx.prevSha')
    .replace(/steps\.deploy\.outcome/g, 'ctx.deploy')
    .replace(/steps\.smoke_test\.outcome/g, 'ctx.smoke')
    .replace(/steps\.rollback\.outcome/g, 'ctx.rollback')
    .replace(/github\.sha/g, `'${SHA}'`)
    .replace(/==/g, '===')
    .replace(/!=(?!=)/g, '!==');
  const leftover = js.replace(/ctx\.\w+|'[^']*'|===|!==|&&|\|\||[()!\s]/g, '');
  if (leftover !== '') throw new Error(`Untranslated expression content: "${leftover}" in: ${expr}`);
  return new Function('ctx', `return (${js});`) as (ctx: Ctx) => boolean;
}

function stepIf(stepName: string): string {
  const step = extractStep(BACKEND.job, stepName);
  const folded = step.match(/\n {8}if: >\n((?: {10}.*\n)+)/);
  if (folded) return folded[1];
  const quoted = step.match(/\n {8}if: "(.*)"\n/);
  if (quoted) return quoted[1];
  const plain = step.match(/\n {8}if: (.*)\n/);
  if (plain) return plain[1];
  throw new Error(`No if: on step ${stepName}`);
}

describe('9. rollback / verify-rollback / fail-job conditions (evaluated)', () => {
  const settleIf = compileCondition(stepIf('Stop the deploy command before rollback'));
  const rollbackIf = compileCondition(stepIf('Roll back to previous deploy'));

  /**
   * Rollback is two steps: the settle step decides whether rollback is
   * needed and, if so, confirms the deploy command finished (writing
   * settled=true); rollback runs only on that output.
   */
  function rollbackRuns(ctx: Ctx, settleConfirmsStopped = true): boolean {
    const settleRan = settleIf(ctx);
    return rollbackIf({ ...ctx, settled: settleRan && settleConfirmsStopped ? 'true' : '' });
  }
  const verifyIf = compileCondition(stepIf('Verify rollback health'));
  const failIf = compileCondition(stepIf('Fail job on broken deploy'));

  const base: Ctx = {
    cancelled: false,
    deploy: 'success',
    untouched: '',
    smoke: 'success',
    settled: '',
    rollback: 'skipped',
    prevExists: 'true',
    prevSha: 'previous-sha',
  };

  it.each<[string, Partial<Ctx>, boolean]>([
    ['deploy step FAILED (run 38037952336) — smoke test skipped', { deploy: 'failure', smoke: 'skipped' }, true],
    ['deploy step failed but proved the live release untouched', { deploy: 'failure', smoke: 'skipped', untouched: 'true' }, false],
    ['deploy ok, smoke test failed (pre-existing behaviour)', { smoke: 'failure' }, true],
    ['deploy ok, smoke test ok', {}, false],
    ['deploy skipped because an earlier step failed', { deploy: 'skipped', smoke: 'skipped' }, false],
    ['workflow cancelled during deploy', { deploy: 'failure', smoke: 'skipped', cancelled: true }, false],
    ['deploy failed, no previous artifact', { deploy: 'failure', smoke: 'skipped', prevExists: 'false' }, false],
    ['deploy failed, previous sha == this sha', { deploy: 'failure', smoke: 'skipped', prevSha: SHA }, false],
  ])('rollback: %s — overrides %j → runs: %p', (_label, overrides, expected) => {
    expect(rollbackRuns({ ...base, ...overrides })).toBe(expected);
  });

  it.each<[string, Partial<Ctx>]>([
    ['deploy step failed', { deploy: 'failure', smoke: 'skipped' }],
    ['smoke test failed', { smoke: 'failure' }],
  ])('B1. %s but the deploy command could not be confirmed stopped → rollback SKIPPED', (_label, overrides) => {
    const ctx = { ...base, ...overrides };
    expect(settleIf(ctx)).toBe(true);
    expect(rollbackRuns(ctx, false)).toBe(false);
  });

  it('rollback never runs on its own: without settled=true, or once cancelled', () => {
    expect(rollbackIf({ ...base, deploy: 'failure', smoke: 'failure', settled: '' })).toBe(false);
    expect(rollbackIf({ ...base, settled: 'true', cancelled: true })).toBe(false);
    expect(rollbackIf({ ...base, settled: 'true' })).toBe(true);
  });

  it('verify-rollback health runs after a successful rollback even though the deploy step failed', () => {
    expect(verifyIf({ ...base, deploy: 'failure', smoke: 'skipped', rollback: 'success' })).toBe(true);
    expect(verifyIf({ ...base, deploy: 'failure', smoke: 'skipped', rollback: 'failure' })).toBe(false);
    expect(verifyIf({ ...base, rollback: 'skipped' })).toBe(false);
  });

  it('fail-job runs on deploy-step failure or smoke failure, and not on a clean deploy', () => {
    expect(failIf({ ...base, deploy: 'failure', smoke: 'skipped', rollback: 'success' })).toBe(true);
    expect(failIf({ ...base, deploy: 'failure', smoke: 'skipped', untouched: 'true' })).toBe(true);
    expect(failIf({ ...base, smoke: 'failure' })).toBe(true);
    expect(failIf(base)).toBe(false);
  });

  it('the translator rejects constructs it does not understand (guards against a silently wrong truth table)', () => {
    expect(() => compileCondition("always() && steps.deploy.outcome == 'failure'")).toThrow(/Untranslated/);
  });
});

// ---------------------------------------------------------------------------
// Runner side, executed from ci.yml: deploy step, settle step, fail-job
// ---------------------------------------------------------------------------

/** A step's `run: |` block, de-indented, with `${{ ... }}` resolved from ctx. */
function runBlock(job: string, stepName: string, ctx: Record<string, string>): string {
  const step = extractStep(job, stepName);
  const m = step.match(/\n {8}run: \|\n([\s\S]*)$/);
  if (!m) throw new Error(`No run: | block in ${job} / ${stepName}`);
  const body = m[1]
    .split('\n')
    .map((l) => {
      if (l.startsWith('          ')) return l.slice(10);
      if (l.trim() === '') return '';
      throw new Error(`Unexpected indentation in ${stepName}: ${l}`);
    })
    .join('\n');
  return body.replace(/\$\{\{\s*([^}]+?)\s*\}\}/g, (_m, expr: string) => {
    if (!(expr in ctx)) throw new Error(`No test value for \${{ ${expr} }} in ${stepName}`);
    return ctx[expr];
  });
}

/**
 * Fake `aws` covering what these steps call: send-command, cancel-command
 * and get-command-invocation (Status sequence from FAKE_STATUSES, one entry
 * per call, last one repeating; `ERR:<Code>` fails like the real CLI).
 * Plus a no-op `sleep`, and optionally a `base64` that prints nothing.
 */
function makeFakeRunnerBin(dir: string, emptyBase64: boolean): void {
  writeExecutable(
    path.join(dir, 'aws'),
    `echo "aws $*" >> "$FAKE_AWS_LOG"
err() { echo "An error occurred ($1) when calling the $2 operation: fake" >&2; exit 254; }
case "$1 $2" in
  "ssm send-command")
    [ -n "$FAKE_SEND_FAILS" ] && err AccessDeniedException SendCommand
    [ -n "$FAKE_SEND_EMPTY" ] && exit 0
    echo cmd-fake-1; exit 0 ;;
  "ssm cancel-command")
    [ -n "$FAKE_CANCEL_FAILS" ] && err AccessDeniedException CancelCommand
    exit 0 ;;
  "ssm get-command-invocation")
    q=""; prev=""; for a in "$@"; do [ "$prev" = "--query" ] && q="$a"; prev="$a"; done
    case "$q" in
      Status)
        IFS=, read -r -a S <<< "$FAKE_STATUSES"
        n=$(cat "$FAKE_AWS_LOG.count" 2>/dev/null || echo 0)
        i=$n; [ "$i" -ge "\${#S[@]}" ] && i=$((\${#S[@]} - 1))
        echo $((n + 1)) > "$FAKE_AWS_LOG.count"
        e="\${S[$i]}"
        case "$e" in ERR:*) err "\${e#ERR:}" GetCommandInvocation ;; esac
        echo "$e"; exit 0 ;;
      StandardOutputContent) printf '%s\\n' "$FAKE_STDOUT"; exit 0 ;;
      StandardErrorContent) echo "fake stderr"; exit 0 ;;
    esac ;;
esac
echo "fake aws: unhandled $*" >&2
exit 1
`
  );
  writeExecutable(path.join(dir, 'sleep'), 'exit 0\n');
  if (emptyBase64) writeExecutable(path.join(dir, 'base64'), 'cat > /dev/null\nexit 0\n');
}

function runStep(
  job: string,
  stepName: string,
  ctx: Record<string, string>,
  env: Record<string, string> = {},
  opts: { emptyBase64?: boolean } = {}
) {
  const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-step-')));
  const bin = path.join(dir, 'bin');
  fs.mkdirSync(bin);
  makeFakeRunnerBin(bin, !!opts.emptyBase64);
  const scriptPath = path.join(dir, 'step.sh');
  fs.writeFileSync(scriptPath, runBlock(job, stepName, ctx));
  const outputFile = path.join(dir, 'github-output');
  const awsLog = path.join(dir, 'aws.log');
  fs.writeFileSync(outputFile, '');
  fs.writeFileSync(awsLog, '');
  // `bash -e {0}` is what Actions runs for a `run:` step without `shell:`.
  const r = spawnSync('bash', ['-e', scriptPath], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      GITHUB_OUTPUT: outputFile,
      RUNNER_TEMP: dir,
      DEPLOY_MIN_FREE_MIB: String(minFreeMib()),
      FAKE_AWS_LOG: awsLog,
      FAKE_STATUSES: 'Success',
      FAKE_STDOUT: 'remote stdout',
      ...env,
    },
  });
  const outputs: Record<string, string> = {};
  for (const line of fs.readFileSync(outputFile, 'utf8').split('\n').filter(Boolean)) {
    const eq = line.indexOf('=');
    outputs[line.slice(0, eq)] = line.slice(eq + 1);
  }
  const awsCalls = fs.readFileSync(awsLog, 'utf8').split('\n').filter(Boolean);
  return { status: r.status, stdout: r.stdout, stderr: r.stderr, outputs, awsCalls };
}

describe('deploy step (runner side, executed from ci.yml)', () => {
  const ctx = { 'github.sha': SHA };

  it('success: records command_id, sends with --timeout-seconds 120, no "untouched" output', () => {
    const r = runStep(BACKEND.job, BACKEND.step, ctx, { FAKE_STATUSES: 'InProgress,Success' });
    expect(r.status).toBe(0);
    expect(r.outputs).toEqual({ command_id: 'cmd-fake-1' });
    const send = r.awsCalls.find((c) => c.startsWith('aws ssm send-command'))!;
    expect(send).toContain('--timeout-seconds 120');
  });

  it.each([
    ['send-command errors', { FAKE_SEND_FAILS: '1' }],
    ['send-command returns no command ID', { FAKE_SEND_EMPTY: '1' }],
  ])('N4. %s → nothing was sent: live_release_untouched=true, no command_id, never polled', (_l, env) => {
    const r = runStep(BACKEND.job, BACKEND.step, ctx, env);
    expect(r.status).not.toBe(0);
    expect(r.outputs).toEqual({ live_release_untouched: 'true' });
    expect(r.stdout).toContain('failed before an SSM command ID was received');
    expect(r.awsCalls.some((c) => c.includes('get-command-invocation'))).toBe(false);
  });

  it('S1. empty preflight payload on the runner → refuses before send-command, marked untouched', () => {
    const r = runStep(BACKEND.job, BACKEND.step, ctx, {}, { emptyBase64: true });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('Could not encode .github/scripts/deploy-disk-preflight.sh');
    expect(r.awsCalls).toEqual([]);
    expect(r.outputs).toEqual({ live_release_untouched: 'true' });
  });

  it('remote failure without the marker: command_id recorded, NOT untouched (rollback path)', () => {
    const r = runStep(BACKEND.job, BACKEND.step, ctx, { FAKE_STATUSES: 'Failed', FAKE_STDOUT: 'npm ERR! ENOSPC' });
    expect(r.status).toBe(1);
    expect(r.outputs).toEqual({ command_id: 'cmd-fake-1' });
  });

  it('remote failure WITH the marker: command_id recorded AND untouched', () => {
    const r = runStep(BACKEND.job, BACKEND.step, ctx, {
      FAKE_STATUSES: 'Failed',
      FAKE_STDOUT: 'DEPLOY_ABORTED_BEFORE_LIVE_CHANGES',
    });
    expect(r.status).toBe(1);
    expect(r.outputs).toEqual({ command_id: 'cmd-fake-1', live_release_untouched: 'true' });
  });
});

describe.each([MIGRATION, ADMIN])('$job deploy step (runner side, executed from ci.yml)', (spec) => {
  const ctx = { 'github.sha': SHA };

  it('success: sends with --timeout-seconds 120', () => {
    const r = runStep(spec.job, spec.step, ctx);
    expect(r.status).toBe(0);
    expect(r.awsCalls.find((c) => c.startsWith('aws ssm send-command'))).toContain('--timeout-seconds 120');
  });

  it('S1. empty payloads on the runner → refuses before send-command', () => {
    const r = runStep(spec.job, spec.step, ctx, {}, { emptyBase64: true });
    expect(r.status).not.toBe(0);
    expect(r.stdout).toContain('Could not encode .github/scripts/');
    expect(r.awsCalls).toEqual([]);
  });
});

describe('B1. "Stop the deploy command before rollback" (executed from ci.yml, real poller, stubbed aws)', () => {
  const STEP = 'Stop the deploy command before rollback';
  const run = (env: Record<string, string>) =>
    runStep(BACKEND.job, STEP, {}, { DEPLOY_COMMAND_ID: 'cmd-deploy-9', INSTANCE_ID: 'i-test', ...env });

  it('step env wires the deploy step command_id and the instance', () => {
    const step = extractStep(BACKEND.job, STEP);
    expect(step).toContain('DEPLOY_COMMAND_ID: ${{ steps.deploy.outputs.command_id }}');
    expect(step).toContain('INSTANCE_ID: i-0c3e55c290844ec59');
  });

  it.each(['Success', 'Failed', 'TimedOut', 'Cancelled'])('deploy already %s → settled without cancelling', (st) => {
    const r = run({ FAKE_STATUSES: st });
    expect(r.status).toBe(0);
    expect(r.outputs).toEqual({ settled: 'true' });
    expect(r.awsCalls.some((c) => c.includes('cancel-command'))).toBe(false);
  });

  it.each([
    ['still InProgress', 'InProgress,Cancelling,Cancelled'],
    ['lookup fails (InvocationDoesNotExist)', 'ERR:InvocationDoesNotExist,Pending,Cancelled'],
    ['still Pending (queued, not delivered)', 'Pending,Pending,Cancelled'],
  ])('deploy %s → cancel → terminal → settled, rollback may run', (_l, statuses) => {
    const r = run({ FAKE_STATUSES: statuses });
    expect(r.status).toBe(0);
    expect(r.outputs).toEqual({ settled: 'true' });
    const cancelIdx = r.awsCalls.findIndex((c) => c.startsWith('aws ssm cancel-command'));
    expect(cancelIdx).toBe(1);
    expect(r.awsCalls[cancelIdx]).toContain('--command-id cmd-deploy-9 --instance-ids i-test');
    expect(r.stdout).toContain('reached terminal status: Cancelled');
  });

  it('cancel accepted but the command never reaches terminal within 180s → NOT settled, fails loudly with IDs', () => {
    const r = run({ FAKE_STATUSES: 'InProgress' });
    expect(r.status).toBe(1);
    expect(r.outputs).toEqual({});
    expect(r.stdout).toContain('did not reach a terminal state within 180s');
    expect(r.stdout).toContain('Deploy command cmd-deploy-9 on instance i-test did not reach a terminal status');
    expect(r.stdout).toContain('rollback is SKIPPED');
  });

  it('cancel-command fails (e.g. ssm:CancelCommand not granted) → NOT settled, fails loudly, never polls', () => {
    const r = run({ FAKE_STATUSES: 'InProgress', FAKE_CANCEL_FAILS: '1' });
    expect(r.status).toBe(1);
    expect(r.outputs).toEqual({});
    expect(r.stdout).toContain('cancel-command failed for deploy command cmd-deploy-9 on instance i-test');
    expect(r.stdout).toContain('ssm:CancelCommand');
    expect(r.awsCalls.filter((c) => c.includes('get-command-invocation'))).toHaveLength(1);
  });

  it('no deploy command ID recorded → NOT settled, fails loudly, no AWS calls', () => {
    const r = run({ DEPLOY_COMMAND_ID: '' });
    expect(r.status).toBe(1);
    expect(r.outputs).toEqual({});
    expect(r.stdout).toContain('rollback SKIPPED');
    expect(r.awsCalls).toEqual([]);
  });
});

describe('N1. "Fail job on broken deploy" messages (executed from ci.yml)', () => {
  const base: Record<string, string> = {
    'github.sha': SHA,
    'steps.deploy.outcome': 'failure',
    'steps.deploy.outputs.live_release_untouched': '',
    'steps.deploy.outputs.command_id': 'cmd-deploy-9',
    'steps.settle_deploy.outcome': 'skipped',
    'steps.rollback.outcome': 'skipped',
    'steps.rollback.outputs.not_started': '',
    'steps.rollback_smoke_test.outcome': 'skipped',
    'steps.get_prev_sha.outputs.prev_sha': 'previous-sha',
    'steps.get_prev_sha.outputs.prev_artifact_exists': 'true',
  };
  const fail = (o: Record<string, string>) => runStep(BACKEND.job, 'Fail job on broken deploy', { ...base, ...o });

  it.each<[string, Record<string, string>, string]>([
    ['untouched release', { 'steps.deploy.outputs.live_release_untouched': 'true' }, 'aborted before modifying the live release'],
    ['deploy command not confirmed stopped', { 'steps.settle_deploy.outcome': 'failure' }, "deploy command 'cmd-deploy-9' on instance i-0c3e55c290844ec59 could not be confirmed stopped"],
    [
      'rollback could not take the host deploy lock',
      { 'steps.settle_deploy.outcome': 'success', 'steps.rollback.outcome': 'failure', 'steps.rollback.outputs.not_started': 'true' },
      'the host deploy lock (/var/lock/devcontrol-backend-deploy.lock) was not acquired within 300s',
    ],
    ['prev_sha == this sha',{ 'steps.get_prev_sha.outputs.prev_sha': SHA }, `last known-good marker already points at ${SHA}`],
    ['rollback + verify succeeded', { 'steps.settle_deploy.outcome': 'success', 'steps.rollback.outcome': 'success', 'steps.rollback_smoke_test.outcome': 'success' }, 'Automatic rollback to previous deploy (previous-sha) succeeded'],
    ['no usable previous artifact', { 'steps.get_prev_sha.outputs.prev_artifact_exists': 'false' }, 'No usable previous known-good deploy artifact'],
  ])('%s → job fails with an accurate message', (_l, o, expected) => {
    const r = fail(o);
    expect(r.status).toBe(1);
    expect(r.stdout).toContain(expected);
  });
});

describe('rollback step (runner side, executed from ci.yml, real poller, stubbed aws)', () => {
  const ctx = {
    'steps.deploy.outcome': 'failure',
    'steps.smoke_test.outcome': 'skipped',
    'steps.get_prev_sha.outputs.prev_sha': 'cafef00d'.repeat(5),
    'steps.get_prev_sha.outputs.prev_workspace_artifacts_exist': 'true',
  };
  const run = (env: Record<string, string>) => runStep(BACKEND.job, 'Roll back to previous deploy', ctx, env);

  it('success: exits 0, no not_started output', () => {
    const r = run({ FAKE_STATUSES: 'InProgress,Success', FAKE_STDOUT: 'Rolled back' });
    expect(r.status).toBe(0);
    expect(r.outputs).toEqual({});
  });

  it('host lock not acquired (ROLLBACK_NOT_STARTED): exits 1, not_started=true, loud error', () => {
    const r = run({ FAKE_STATUSES: 'Failed', FAKE_STDOUT: 'ROLLBACK_NOT_STARTED' });
    expect(r.status).toBe(1);
    expect(r.outputs).toEqual({ not_started: 'true' });
    expect(r.stdout).toContain('::error::Rollback SKIPPED: the host deploy lock was not acquired within 300s');
  });

  it('rollback failed mid-install (no marker): exits 1, not_started unset', () => {
    const r = run({ FAKE_STATUSES: 'Failed', FAKE_STDOUT: 'npm ERR! ENOSPC' });
    expect(r.status).toBe(1);
    expect(r.outputs).toEqual({});
  });
});

describe('N2. production deploy concurrency groups', () => {
  const JOBS = [BACKEND.job, MIGRATION.job, ADMIN.job];

  it.each(JOBS)('%s has its own group with cancel-in-progress: false', (job) => {
    expect(extractJobBlock(job)).toContain(
      `\n    concurrency:\n      group: production-${job}\n      cancel-in-progress: false\n`
    );
  });

  it('the groups are distinct (a shared group would cancel pending sibling jobs of the same run)', () => {
    const groups = JOBS.map((job) => extractJobBlock(job).match(/\n {6}group: (.*)\n/)![1]);
    expect(new Set(groups).size).toBe(JOBS.length);
  });

  it('the workflow-level group cancels only pull_request runs; every other run gets a group of its own', () => {
    expect(ciYml.match(/^concurrency:/gm)).toHaveLength(1);
    expect(ciYml).toContain(
      "\nconcurrency:\n  group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && format('pr-{0}', github.event.pull_request.number) || format('run-{0}', github.run_id) }}\n  cancel-in-progress: ${{ github.event_name == 'pull_request' }}\n"
    );
  });
});
