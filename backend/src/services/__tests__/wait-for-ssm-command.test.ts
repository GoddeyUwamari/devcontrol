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
 *
 * Also covers the run 38037952336 false failure: `get-command-invocation`
 * returning InvocationDoesNotExist right after `send-command`, before the
 * invocation is registered. Status-sequence entries of the form
 * `ERR:<Code>` make the fake CLI fail the way the real one does (exit 254,
 * "An error occurred (<Code>) ..." on stderr).
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
    ENTRY="\${STATUSES[$IDX]}"
    case "$ENTRY" in
      ERR:*)
        echo "" >&2
        echo "An error occurred (\${ENTRY#ERR:}) when calling the GetCommandInvocation operation: fake" >&2
        exit 254
        ;;
    esac
    echo "$ENTRY"
    exit 0
  elif [ "$QUERY" = "StandardOutputContent" ]; then
    if [ -n "$FAKE_OUTPUT_FETCH_FAILS" ]; then
      echo "An error occurred (InvocationDoesNotExist) when calling the GetCommandInvocation operation: fake" >&2
      exit 254
    fi
    echo "fake stdout content"
    exit 0
  elif [ "$QUERY" = "StandardErrorContent" ]; then
    if [ -n "$FAKE_OUTPUT_FETCH_FAILS" ]; then
      echo "An error occurred (InvocationDoesNotExist) when calling the GetCommandInvocation operation: fake" >&2
      exit 254
    fi
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

/** How many `--query Status` calls the fake CLI received. */
function statusCallCount(tmpDir: string): number {
  return Number(fs.readFileSync(path.join(tmpDir, 'call-count'), 'utf8').trim());
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

  describe('registration delay (InvocationDoesNotExist right after send-command — run 38037952336)', () => {
    it('8. retries InvocationDoesNotExist several times, then follows the invocation to Success', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
      const { status, stdout } = runScript(
        tmpDir,
        ['ERR:InvocationDoesNotExist', 'ERR:InvocationDoesNotExist', 'ERR:InvocationDoesNotExist', 'InProgress', 'Success'],
        { SSM_WAIT_POLL_SECONDS: '0', SSM_WAIT_REGISTRATION_BACKOFF_SECONDS: '0' }
      );
      expect(status).toBe(0);
      expect(statusCallCount(tmpDir)).toBe(5);
      expect(stdout.match(/not registered yet \(InvocationDoesNotExist/g)).toHaveLength(3);
      expect(stdout).toContain('fake stdout content');
    });

    it('9. a registration delay followed by a real Failed status still fails (retry never masks the outcome)', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
      const { status, stdout } = runScript(tmpDir, ['ERR:InvocationDoesNotExist', 'Failed'], {
        SSM_WAIT_POLL_SECONDS: '0',
        SSM_WAIT_REGISTRATION_BACKOFF_SECONDS: '0',
      });
      expect(status).toBe(1);
      expect(stdout).toContain('SSM command finished with status: Failed');
    });

    it('10. persistent InvocationDoesNotExist fails once the registration deadline passes, with command/instance diagnostics', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
      const { status, stdout, stderr } = runScript(tmpDir, ['ERR:InvocationDoesNotExist'], {
        SSM_WAIT_POLL_SECONDS: '0',
        SSM_WAIT_REGISTRATION_MAX_SECONDS: '1',
        SSM_WAIT_REGISTRATION_BACKOFF_SECONDS: '1',
        // Output can't be fetched for an invocation that doesn't exist —
        // the diagnostics must say so instead of crashing.
        FAKE_OUTPUT_FETCH_FAILS: '1',
      });
      expect(status).toBe(1);
      // How many retries fit in 1s depends on machine load (a slow first
      // call can consume the whole window); retry counting is covered
      // deterministically by test 8. This test pins the bounded deadline.
      expect(statusCallCount(tmpDir)).toBeGreaterThanOrEqual(1);
      expect(stdout).toMatch(/was still not registered \(InvocationDoesNotExist\) after \d+s \(limit 1s\)/);
      expect(stdout).toContain('SSM command ID: cmd-123');
      expect(stdout).toContain('Instance ID: i-fakeinstance');
      expect(stdout).toContain('InvocationDoesNotExist');
      expect(stderr).toContain('(InvocationDoesNotExist)');
    });

    it('11. a registration deadline of 0 fails on the first InvocationDoesNotExist without sleeping', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
      const { status } = runScript(tmpDir, ['ERR:InvocationDoesNotExist', 'Success'], {
        SSM_WAIT_REGISTRATION_MAX_SECONDS: '0',
        FAKE_OUTPUT_FETCH_FAILS: '1',
      });
      expect(status).toBe(1);
      expect(statusCallCount(tmpDir)).toBe(1);
    });
  });

  describe('genuine errors fail immediately — never retried', () => {
    it.each(['AccessDeniedException', 'InvalidCommandId', 'InvalidInstanceId', 'ThrottlingException'])(
      '12. %s fails on the first call with no retry',
      (code) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
        const { status, stdout, stderr } = runScript(tmpDir, [`ERR:${code}`, 'Success'], {
          SSM_WAIT_POLL_SECONDS: '0',
          SSM_WAIT_REGISTRATION_BACKOFF_SECONDS: '0',
        });
        expect(status).toBe(1);
        expect(statusCallCount(tmpDir)).toBe(1);
        expect(stdout).not.toContain('retrying');
        expect(stdout).toContain('non-retryable error');
        expect(stderr).toContain(`(${code})`);
      }
    );

    it('13. InvocationDoesNotExist AFTER the invocation was already seen is not a registration delay — fails immediately', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
      const { status, stdout } = runScript(tmpDir, ['InProgress', 'ERR:InvocationDoesNotExist', 'Success'], {
        SSM_WAIT_POLL_SECONDS: '0',
        SSM_WAIT_REGISTRATION_BACKOFF_SECONDS: '0',
      });
      expect(status).toBe(1);
      expect(statusCallCount(tmpDir)).toBe(2);
      expect(stdout).toContain('non-retryable error');
    });

    it.each([['an empty status', ''], ['None', 'None'], ['an unknown status', 'Exploded']])(
      '14. %s is treated as malformed and fails immediately, never polled forever',
      (_label, value) => {
        const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
        const { status, stdout } = runScript(tmpDir, [value, 'Success'], { SSM_WAIT_POLL_SECONDS: '0' });
        expect(status).toBe(1);
        expect(statusCallCount(tmpDir)).toBe(1);
        expect(stdout).toContain('unrecognized status');
      }
    );
  });

  describe('terminal statuses print full diagnostics', () => {
    it.each(['Failed', 'TimedOut', 'Cancelled'])('15. %s exits 1 and prints command ID, instance ID, stdout and stderr', (terminal) => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
      const { status, stdout } = runScript(tmpDir, ['Pending', 'InProgress', terminal], { SSM_WAIT_POLL_SECONDS: '0' });
      expect(status).toBe(1);
      expect(stdout).toContain('SSM command ID: cmd-123');
      expect(stdout).toContain('Instance ID: i-fakeinstance');
      expect(stdout).toContain('fake stdout content');
      expect(stdout).toContain('fake stderr content');
      expect(stdout).toContain(`SSM command finished with status: ${terminal}`);
    });

    it('16. timing out while still InProgress prints command ID, instance ID and output diagnostics', () => {
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
      const { status, stdout } = runScript(tmpDir, ['InProgress'], {
        SSM_WAIT_POLL_SECONDS: '0',
        SSM_WAIT_MAX_SECONDS: '0',
      });
      expect(status).toBe(1);
      expect(stdout).toContain('SSM command ID: cmd-123');
      expect(stdout).toContain('Instance ID: i-fakeinstance');
      expect(stdout).toContain('fake stdout content');
      expect(stdout).toContain('fake stderr content');
    });

    it('17. Success is not turned into a failure when fetching stdout afterwards errors', () => {
      // A false failure here would trigger a rollback of a healthy deploy.
      const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ssm-wait-test-'));
      const { status, stdout } = runScript(tmpDir, ['Success'], { FAKE_OUTPUT_FETCH_FAILS: '1' });
      expect(status).toBe(0);
      expect(stdout).toContain('could not retrieve StandardOutputContent');
    });
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

  it('7. smoke-test and record-success contracts are unchanged; rollback, verify-rollback and fail-on-broken now also cover deploy-step failure', () => {
    // Unchanged: these decide what happens after a SUCCESSFUL deploy step.
    expect(ciYml).toContain("id: smoke_test\n        continue-on-error: true");
    expect(ciYml).toContain("- name: Record successful deploy\n        if: steps.smoke_test.outcome == 'success'");
    // Changed on purpose (run 38037952336): see deploy-safety.test.ts for
    // the evaluated truth table of these expressions.
    expect(ciYml).toContain("- name: Deploy via SSM and restart PM2\n        id: deploy\n");
    expect(ciYml).toContain("steps.deploy.outcome == 'failure' &&\n              steps.deploy.outputs.live_release_untouched != 'true'");
    expect(ciYml).toContain(
      "steps.get_prev_sha.outputs.prev_artifact_exists == 'true' &&\n          steps.get_prev_sha.outputs.prev_sha != github.sha"
    );
    expect(ciYml).toContain(
      "- name: Verify rollback health\n        id: rollback_smoke_test\n        if: \"!cancelled() && steps.rollback.outcome == 'success'\""
    );
    expect(ciYml).toContain(
      "- name: Fail job on broken deploy\n        if: >\n          !cancelled() &&\n          (steps.deploy.outcome == 'failure' || steps.smoke_test.outcome == 'failure')"
    );
  });
});
