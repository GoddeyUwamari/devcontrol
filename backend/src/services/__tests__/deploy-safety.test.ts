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
 *     evaluated as a truth table over step outcomes.
 *
 * No AWS credentials, network calls or real hosts are involved.
 */

import { execSync, spawnSync } from 'child_process';
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
 * `PARAMS=$(jq -n ...)` assignment (with `${{ github.sha }}` resolved, as
 * the Actions runner does before any shell runs) and returns the parsed
 * SSM parameters.
 */
function buildParams(jobName: string, stepName: string): { commands: string[]; executionTimeout?: string[] } {
  const step = extractStep(jobName, stepName);
  const b64Lines = step.match(/^\s*[A-Z_]+_SCRIPT_B64=\$\(base64 < .*\)$/gm) ?? [];
  const params = step.match(/PARAMS=\$\(jq -n[\s\S]*?\}'\)/);
  if (!params) throw new Error(`No PARAMS=$(jq -n ...) block in ${jobName} / ${stepName}`);
  const script = [...b64Lines.map((l) => l.trim()), params[0], 'echo "$PARAMS"']
    .join('\n')
    .replace(/\$\{\{ github\.sha \}\}/g, SHA);
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
    fixtures: path.join(root, 's3'),
    log: path.join(root, 'commands.log'),
  };
  for (const d of [sb.app, path.join(root, 'opt'), sb.tmp, sb.fixtures, path.join(root, 'bin')]) {
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
  }

  it('sets an executionTimeout below the poller ceiling so rollback never races a running deploy', () => {
    const pollerSrc = fs.readFileSync(path.join(REPO_ROOT, '.github/scripts/wait-for-ssm-command.sh'), 'utf8');
    const ceiling = Number(pollerSrc.match(/SSM_WAIT_MAX_SECONDS:-(\d+)/)![1]);
    const registration = Number(pollerSrc.match(/SSM_WAIT_REGISTRATION_MAX_SECONDS:-(\d+)/)![1]);
    const poll = Number(pollerSrc.match(/SSM_WAIT_POLL_SECONDS:-(\d+)/)![1]);
    expect(params.executionTimeout).toEqual(['480']);
    expect(480 + registration + poll).toBeLessThan(ceiling);
  });

  it('runs the disk preflight on /tmp AND the install root before any download, extraction or deletion', () => {
    const cmds = params.commands;
    const preflightIdx = cmds.findIndex((c) => c.includes('base64 -d | bash -s -- '));
    expect(cmds[preflightIdx]).toMatch(new RegExp(`bash -s -- ${minFreeMib()} /tmp /home/ubuntu/devcontrol$`));
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
    const preflightIdx = cmds.findIndex((x) => x.includes(`bash -s -- ${minFreeMib()} `));
    const downloadIdx = cmds.findIndex((x) => x.includes('aws s3 cp'));
    expect(cmds[preflightIdx]).toMatch(new RegExp(`bash -s -- ${minFreeMib()} ${c.preflightArgs}$`));
    expect(preflightIdx).toBeGreaterThan(-1);
    expect(preflightIdx).toBeLessThan(downloadIdx);
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
  const rollbackIf = compileCondition(stepIf('Roll back to previous deploy'));
  const verifyIf = compileCondition(stepIf('Verify rollback health'));
  const failIf = compileCondition(stepIf('Fail job on broken deploy'));

  const base: Ctx = {
    cancelled: false,
    deploy: 'success',
    untouched: '',
    smoke: 'success',
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
    expect(rollbackIf({ ...base, ...overrides })).toBe(expected);
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
