/**
 * tag_pattern evaluation stays fast and never holds the event loop, whatever
 * pattern a customer saved.
 *
 * Each case runs in a child process (helpers/tag-pattern-load.child.js) under
 * a deadline this process enforces with SIGKILL: a regression fails as
 * "missed its deadline" instead of hanging the suite. The child scans through
 * the real CustomComplianceService.runScanBody and reports each evaluation's
 * duration, the largest gap of a 10 ms heartbeat, and event-loop delay.
 *
 * Thresholds allow for a busy CI runner (CPU contention stretches every
 * timing several-fold) and still sit orders of magnitude below a backtracking
 * engine, which takes seconds to hours on these inputs or misses the deadline.
 */
import { fork } from 'child_process';
import path from 'path';

const CHILD = path.join(__dirname, 'helpers', 'tag-pattern-load.child.js');

function runChild<T>(job: Record<string, unknown>, deadlineMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const child = fork(CHILD, [], { execArgv: [], stdio: ['ignore', 'ignore', 'inherit', 'ipc'] });
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`child missed its ${deadlineMs} ms deadline`));
    }, deadlineMs);
    child.on('message', (message: any) => {
      if (message.ready) {
        child.send(job);
        return;
      }
      clearTimeout(timer);
      if (message.ok) resolve(message.result as T);
      else reject(new Error(message.error));
    });
    child.on('exit', (code, signal) => {
      clearTimeout(timer);
      if (code !== 0) reject(new Error(`child exited with ${code ?? signal}`));
    });
  });
}

type Loop = { maxGapMs: number; beats: number; p99LagMs: number; maxLagMs: number };
type Evaluations = {
  perPattern: Record<string, { worstMs: number; statuses: string[] }>;
  evaluations: number;
  slowEvaluations: number;
  totalMs: number;
  loop: Loop;
};

/** Patterns that take exponential or high-polynomial time in a backtracking engine. */
const BACKTRACKING_PATTERNS = ['(a+)+$', '(a|a)*$', '(a|aa)+$', '(\\w|\\d)+$', '([a-zA-Z]+)*$', '^.*.*.*.*.*x$', '(.*a){20}'];
const ADVERSARIAL_VALUES = [`${'a'.repeat(127)}!`, `${'a'.repeat(255)}!`, 'ab'.repeat(128), 'a'.repeat(256)];

describe('tag_pattern evaluation time', () => {
  it('backtracking-prone patterns on long adversarial values: every evaluation under 100 ms, the loop never held', async () => {
    const result = await runChild<Evaluations>(
      { kind: 'evaluations', patterns: BACKTRACKING_PATTERNS, values: [...ADVERSARIAL_VALUES, ...ADVERSARIAL_VALUES] },
      30_000
    );

    for (const pattern of BACKTRACKING_PATTERNS) {
      expect({ pattern, worstMs: result.perPattern[pattern].worstMs < 100 }).toEqual({ pattern, worstMs: true });
      // Evaluated (pass or fail), not refused: the engine, not the pattern check, is what keeps these fast.
      expect(result.perPattern[pattern].statuses.every((s) => s === 'pass' || s === 'fail')).toBe(true);
    }
    expect(result.loop.maxGapMs).toBeLessThan(500);
    expect(result.loop.p99LagMs).toBeLessThan(100);
    expect(result.totalMs).toBeLessThan(20_000);
  }, 40_000);

  it('the slowest pattern the limits admit, on the longest admitted value: measured, and bounded', async () => {
    // Optional repetition followed by a long counted run: the slowest found in a
    // sweep of what the limits admit, against values at the 256-character limit.
    const patterns = ['(?:a?){256}a{256}', '(?:a?){800}a{250}', '(?:a?){666}a{256}'];
    // Distinct values, so that none is answered from the engine's cache.
    const VALUES = Array.from({ length: 6 }, (_, i) => `${'a'.repeat(256 - i)}${'c'.repeat(i)}`);
    const result = await runChild<Evaluations>(
      { kind: 'evaluations', patterns, values: VALUES },
      30_000
    );

    const worstMs = Math.max(...patterns.map((p) => result.perPattern[p].worstMs));
    // The measured worst case, for the record (see the author report). It is under
    // 100 ms on a quiet machine; CPU contention has stretched this kind of evaluation
    // about 25-fold, which is the margin in these limits.
    console.info(`[tag-pattern-load] worst admitted evaluation ${worstMs.toFixed(1)} ms; largest heartbeat gap ${result.loop.maxGapMs.toFixed(1)} ms; ${result.slowEvaluations} of ${result.evaluations} evaluations over 10 ms; ${result.loop.beats} heartbeats`);
    expect(worstMs).toBeLessThan(2_500);
    // The loop is released after every evaluation: one that outlasts the heartbeat's
    // interval leaves a beat due, and that beat fires before the next evaluation.
    expect(result.evaluations).toBe(patterns.length * VALUES.length);
    expect(result.slowEvaluations).toBeGreaterThan(0);
    expect(result.loop.beats).toBeGreaterThanOrEqual(result.slowEvaluations);
    expect(result.loop.maxGapMs).toBeLessThan(3_000);
    for (const p of patterns) expect(result.perPattern[p].statuses.every((s) => s === 'pass' || s === 'fail')).toBe(true);
  }, 40_000);

  it('another organisation\'s scan and unrelated requests keep being served while backtracking-prone rules are evaluated', async () => {
    const result = await runChild<{
      loop: Loop;
      requests: number;
      maxRequestMs: number;
      heavy: { summary: any; statuses: string[]; worstMs: number };
      light: { summary: any; statuses: string[] };
    }>(
      { kind: 'concurrent', heavyPatterns: BACKTRACKING_PATTERNS.slice(0, 3), heavyValue: `${'a'.repeat(255)}!`, heavyCount: 200, lightCount: 50 },
      60_000
    );

    expect(result.heavy.summary).toMatchObject({ status: 'completed', resources_scanned: 200 });
    expect(result.light.summary).toMatchObject({ status: 'completed', resources_scanned: 50, compliant_resources: 25, non_compliant_resources: 25 });
    expect(result.light.statuses.filter((s) => s === 'pass')).toHaveLength(25);
    expect(result.requests).toBeGreaterThan(0);
    expect(result.maxRequestMs).toBeLessThan(1_000);
    expect(result.loop.maxGapMs).toBeLessThan(500);
  }, 70_000);
});
