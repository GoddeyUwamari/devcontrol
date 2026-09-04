/**
 * Coverage for .github/scripts/wait-for-ssm-command.sh — the bounded-polling
 * replacement for `aws ssm wait command-executed` in deploy-backend's deploy
 * and rollback steps (see ci.yml). Fixes the false-failure observed in run
 * 33836015818: a real ~3m15s deploy (dominated by `npm install --production`
 * on the host) was reported as FAILED because the waiter's short default
 * ceiling (~100s) gave up while the SSM command was still genuinely
 * InProgress, not actually failed.
 *
 * No real AWS credentials or network calls: a fake `aws` executable is
 * placed first on PATH (same "test the real file, not a reconstruction"
 * approach as deploy-migration-symlink.sh's own tests in
 * migrate-deploy.test.ts) that returns a scripted sequence of
 * `get-command-invocation` responses, so the script under test really runs
 * `bash .github/scripts/wait-for-ssm-command.sh`, just against a stubbed AWS
 * CLI instead of the real one.
 */

import { spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const REPO_ROOT = path.join(__dirname, '../../../../');
const SCRIPT_PATH = path.join(REPO_ROOT, '.github', 'scripts', 'wait-for-ssm-command.sh');

/**
 * Writes a fake `aws` on disk that only understands the two `ssm` subcommands
 * this script calls (`get-command-invocation` for --query Status, and again
 * for --query StandardOutputContent / StandardErrorContent). Each call to
 * `get-command-invocation --query Status` consumes the next entry of
 * `statusSequence` (and repeats the last entry once exhausted, so a test
 * whose loop runs longer than the scripted sequence doesn't crash the fake).
 */
function makeFakeAws(tmpDir: string, statusSequence: string[]): void {
  const counterFile = path.join(tmpDir, 'call-count');
  fs.writeFileSync(counterFile, '0');

  const statusArray = statusSequence.map((s) => `"${s}"`).join(' ');

  const script = `#!/usr/bin/env bash
set -e
if [ "$1" = "ssm" ] && [ "$2" = "get-command-invocation" ]; then
  # Find --query value (the only argument that decides what to print)
  QUERY=""
  for i in "$@"; do
    if [ "$prev" = "--query" ]; then QUERY="$i"; fi
    prev="$i"
  done

  if [ "$QUERY" = "Status" ]; then
    STATUSES=(${statusArray})
    COUNT=$(cat "${counterFile}")
    IDX=$COUNT
    if [ $IDX -ge \${#STATUSES[@]} ]; then IDX=$((\${#STATUSES[@]} - 1)); fi
    echo $((COUNT + 1)) > "${counterFile}"
    echo "\${STATUSES[$IDX]}"
    exit 0
  elif [ "$QUERY" = "StandardOutputContent" ]; then
    echo "fake stdout content"
    exit 0
  elif [ "$QUERY" = "StandardErrorContent" ]; then
    echo "fake stderr content"
    exit 0
  fi
fi
echo "fake aws: unhandled invocation: $*" >&2
exit 1
`;

  const awsPath = path.join(tmpDir, 'aws');
  fs.writeFileSync(awsPath, script, { mode: 0o755 });
}

function runScript(
  tmpDir: string,
  statusSequence: string[],
  envOverrides: Record<string, string> = {}
): { status: number | null; stdout: string; stderr: string } {
  makeFakeAws(tmpDir, statusSequence);

  const result = spawnSync('bash', [SCRIPT_PATH, 'cmd-123', 'i-fakeinstance'], {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: `${tmpDir}:${process.env.PATH}`,
      ...envOverrides,
    },
  });

  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

describe('wait-for-ssm-command.sh', () => {
  it('exists and is syntactically valid bash', () => {
    expect(fs.existsSync(SCRIPT_PATH)).toBe(true);
    expect(() => spawnSync('bash', ['-n', SCRIPT_PATH]).status).not.toBeNull();
    const check = spawnSync('bash', ['-n', SCRIPT_PATH]);
    expect(check.status).toBe(0);
  });

  it('1. succeeds after several polling intervals ending in Success', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
    const { status, stdout } = runScript(tmpDir, ['InProgress', 'InProgress', 'InProgress', 'Success'], {
      SSM_WAIT_POLL_SECONDS: '0',
    });
    expect(status).toBe(0);
    expect(stdout).toContain('fake stdout content');
    expect(stdout).not.toContain('stderr');
  });

  it('2. treats a long InProgress stretch (several polling minutes worth of intervals) that eventually succeeds as success, never as failure', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
    const longInProgress = Array(20).fill('InProgress');
    const { status } = runScript(tmpDir, [...longInProgress, 'Success'], {
      SSM_WAIT_POLL_SECONDS: '0',
      // Large enough ceiling that 20 zero-second-poll iterations never trip it.
      SSM_WAIT_MAX_SECONDS: '999999',
    });
    expect(status).toBe(0);
  });

  it('3. reaches Failed and exits non-zero with stderr printed', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
    const { status, stdout } = runScript(tmpDir, ['InProgress', 'Failed'], { SSM_WAIT_POLL_SECONDS: '0' });
    expect(status).toBe(1);
    expect(stdout).toContain('fake stderr content');
    expect(stdout).toContain('SSM command finished with status: Failed');
  });

  it('4. reaches TimedOut and exits non-zero', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
    const { status, stdout } = runScript(tmpDir, ['InProgress', 'TimedOut'], { SSM_WAIT_POLL_SECONDS: '0' });
    expect(status).toBe(1);
    expect(stdout).toContain('SSM command finished with status: TimedOut');
  });

  it('5. reaches Cancelled and exits non-zero (Cancelling is treated as still-running, not terminal)', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
    const { status, stdout } = runScript(tmpDir, ['InProgress', 'Cancelling', 'Cancelling', 'Cancelled'], {
      SSM_WAIT_POLL_SECONDS: '0',
    });
    expect(status).toBe(1);
    expect(stdout).toContain('SSM command finished with status: Cancelled');
  });

  it('6. exceeds the maximum polling timeout while still InProgress and fails with a clear message — never silently treats InProgress as failure early', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
    // Never reaches a terminal state — every poll returns InProgress.
    const alwaysInProgress = Array(50).fill('InProgress');
    const { status, stdout } = runScript(tmpDir, alwaysInProgress, {
      SSM_WAIT_POLL_SECONDS: '0',
      SSM_WAIT_MAX_SECONDS: '0', // first check already at/over the ceiling
    });
    expect(status).toBe(1);
    expect(stdout).toContain('did not reach a terminal state within 0s');
    expect(stdout).toContain('treating as failed');
  });

  it('does not exit non-zero merely because a status is InProgress — only a terminal or timed-out state can trigger exit 1', () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
    // Regression guard for the exact bug this script fixes: InProgress must
    // never itself be treated as a failure, regardless of how many times it
    // repeats, as long as the poller hasn't exceeded SSM_WAIT_MAX_SECONDS.
    const { status } = runScript(tmpDir, ['InProgress', 'InProgress', 'InProgress', 'InProgress', 'Success'], {
      SSM_WAIT_POLL_SECONDS: '0',
      SSM_WAIT_MAX_SECONDS: '999999',
    });
    expect(status).toBe(0);
  });
});

describe('deploy-backend and rollback steps use the shared script instead of the raw waiter', () => {
  const ciYml = fs.readFileSync(path.join(REPO_ROOT, '.github', 'workflows', 'ci.yml'), 'utf8');

  it('the deploy step ("Deploy via SSM and restart PM2") no longer uses the short-ceiling waiter, and calls the shared polling script instead', () => {
    const deployStep = ciYml.match(/- name: Deploy via SSM and restart PM2[\s\S]*?(?=\n {6}- name:)/);
    expect(deployStep).not.toBeNull();
    expect(deployStep![0]).not.toContain('wait command-executed --command-id');
    expect(deployStep![0]).toContain('bash .github/scripts/wait-for-ssm-command.sh "$COMMAND_ID" "i-0c3e55c290844ec59"');
  });

  it('the rollback step ("Roll back to previous deploy") no longer uses the short-ceiling waiter, and calls the shared polling script instead', () => {
    const rollbackStep = ciYml.match(/- name: Roll back to previous deploy[\s\S]*?(?=\n {6}- name:)/);
    expect(rollbackStep).not.toBeNull();
    expect(rollbackStep![0]).not.toContain('wait command-executed --command-id');
    expect(rollbackStep![0]).toContain('bash .github/scripts/wait-for-ssm-command.sh "$COMMAND_ID" "i-0c3e55c290844ec59"');
  });

  it('"Get last known-good deploy" is deliberately left untouched — its command is a near-instant file read, never exposed to the slow-npm-install risk this fixes', () => {
    const getPrevShaStep = ciYml.match(/- name: Get last known-good deploy[\s\S]*?(?=\n {6}- name:)/);
    expect(getPrevShaStep).not.toBeNull();
    expect(getPrevShaStep![0]).toContain('aws ssm wait command-executed');
  });

  it('7. downstream steps (smoke test, record-success, rollback, verify-rollback, fail-on-broken) are untouched by this change', () => {
    // These `if:`/id contracts are exactly what determines which steps run
    // after a Success vs a Failure from the deploy step — asserting they're
    // byte-identical to before proves this fix only changed *how* the
    // terminal status is determined, not what happens once it is.
    expect(ciYml).toContain("id: smoke_test\n        continue-on-error: true");
    expect(ciYml).toContain("- name: Record successful deploy\n        if: steps.smoke_test.outcome == 'success'");
    expect(ciYml).toContain(
      "steps.smoke_test.outcome == 'failure' &&\n          steps.get_prev_sha.outputs.prev_artifact_exists == 'true' &&\n          steps.get_prev_sha.outputs.prev_sha != github.sha"
    );
    expect(ciYml).toContain("- name: Verify rollback health\n        id: rollback_smoke_test\n        if: steps.rollback.outcome == 'success'");
    expect(ciYml).toContain("- name: Fail job on broken deploy\n        if: steps.smoke_test.outcome == 'failure'");
  });
});
