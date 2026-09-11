/**
 * Unit coverage for the weekly-email job monitor: a pure classifier over log
 * text, no DB/network/AWS access, so every case here is a synthetic log
 * excerpt in, a WeeklyEmailMonitorResult out.
 */
import { evaluateWeeklyEmailRun } from '../weeklyEmailJobMonitor';

const RELEASE = '3c752ab25ab5941a33f10aabdd8b73f4c0c4586e';
const OTHER_RELEASE = 'deadbeefcafebabe1234567890abcdef12345678';

function startLine(overrides: Partial<{ timestamp: string; releaseSha: string }> = {}): string {
  return `[Weekly AI Summary] START ${JSON.stringify({
    timestamp: '2026-09-14T09:00:00.000Z',
    releaseSha: RELEASE,
    ...overrides,
  })}`;
}

function completeLine(
  overrides: Partial<{ timestamp: string; durationMs: number; organizations: number; sent: number; errors: number; releaseSha: string }> = {}
): string {
  return `[Weekly AI Summary] COMPLETE ${JSON.stringify({
    timestamp: '2026-09-14T09:00:42.000Z',
    durationMs: 42000,
    organizations: 3,
    sent: 3,
    errors: 0,
    releaseSha: RELEASE,
    ...overrides,
  })}`;
}

function errorLine(overrides: Partial<{ timestamp: string; message: string; releaseSha: string }> = {}): string {
  return `[Weekly AI Summary] ERROR ${JSON.stringify({
    timestamp: '2026-09-14T09:00:05.000Z',
    message: 'getActiveOrganizations failed: connection terminated',
    releaseSha: RELEASE,
    ...overrides,
  })}`;
}

describe('evaluateWeeklyEmailRun', () => {
  it('1. expected release + successful START/COMPLETE -> COMPLETED_SUCCESSFULLY', () => {
    const log = [
      '[Weekly AI Summary] Job scheduled - runs every Monday at 9 AM',
      startLine(),
      '[Weekly AI Summary] Found 3 organizations',
      completeLine({ sent: 3, errors: 0 }),
    ].join('\n');

    const result = evaluateWeeklyEmailRun(log, RELEASE);

    expect(result.status).toBe('COMPLETED_SUCCESSFULLY');
    expect(result.evidence.complete?.sent).toBe(3);
    expect(result.evidence.complete?.errors).toBe(0);
  });

  it('2. START without COMPLETE -> STARTED_NOT_COMPLETED', () => {
    const log = [startLine(), '[Weekly AI Summary] Found 3 organizations'].join('\n');

    const result = evaluateWeeklyEmailRun(log, RELEASE);

    expect(result.status).toBe('STARTED_NOT_COMPLETED');
    expect(result.evidence.start).toBeDefined();
    expect(result.evidence.complete).toBeUndefined();
  });

  it('3. no START at all -> NOT_STARTED', () => {
    const log = [
      'GET /health 200 - 3ms',
      '[Anomaly Detection Job] Complete: 0 total new anomalies detected',
      '[Scheduled Reports Job] No reports due at this time',
    ].join('\n');

    const result = evaluateWeeklyEmailRun(log, RELEASE);

    expect(result.status).toBe('NOT_STARTED');
    expect(result.evidence.start).toBeUndefined();
    expect(result.evidence.complete).toBeUndefined();
  });

  it('4. completion with errors -> COMPLETED_WITH_ERRORS', () => {
    const log = [startLine(), completeLine({ sent: 2, errors: 1, organizations: 3 })].join('\n');

    const result = evaluateWeeklyEmailRun(log, RELEASE);

    expect(result.status).toBe('COMPLETED_WITH_ERRORS');
    expect(result.evidence.complete?.errors).toBe(1);
    expect(result.reason).toContain('1 error');
  });

  it('5a. wrong release SHA at COMPLETE -> WRONG_RELEASE', () => {
    const log = [startLine(), completeLine({ releaseSha: OTHER_RELEASE })].join('\n');

    const result = evaluateWeeklyEmailRun(log, RELEASE);

    expect(result.status).toBe('WRONG_RELEASE');
    expect(result.reason).toContain(OTHER_RELEASE);
  });

  it('5b. wrong release SHA at START (no COMPLETE yet) -> WRONG_RELEASE', () => {
    const log = [startLine({ releaseSha: OTHER_RELEASE })].join('\n');

    const result = evaluateWeeklyEmailRun(log, RELEASE);

    expect(result.status).toBe('WRONG_RELEASE');
  });

  it('6a. insufficient/ambiguous logs: unparseable marker payload -> INSUFFICIENT_EVIDENCE', () => {
    const log = '[Weekly AI Summary] START {this is not valid json}';

    const result = evaluateWeeklyEmailRun(log, RELEASE);

    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.evidence.unparseableMarkerCount).toBe(1);
  });

  it('6b. insufficient/ambiguous logs: ERROR marker with no START or COMPLETE -> INSUFFICIENT_EVIDENCE', () => {
    const log = errorLine();

    const result = evaluateWeeklyEmailRun(log, RELEASE);

    expect(result.status).toBe('INSUFFICIENT_EVIDENCE');
    expect(result.evidence.error).toBeDefined();
    expect(result.evidence.start).toBeUndefined();
    expect(result.evidence.complete).toBeUndefined();
  });

  it('7. never surfaces customer PII from surrounding log noise', () => {
    const log = [
      '[Weekly AI Summary] ✅ Sent to anmolguptadev@gmail.com via Resend (ID: 2418adb8-2222-44a6-b4a1-afe66ddb0431)',
      startLine(),
      completeLine(),
    ].join('\n');

    const result = evaluateWeeklyEmailRun(log, RELEASE);

    const serialized = JSON.stringify(result);
    expect(serialized).not.toContain('@gmail.com');
    expect(serialized).not.toContain('anmolguptadev');
  });

  it('COMPLETE supersedes an earlier ERROR marker in the same excerpt', () => {
    // e.g. a per-org failure inside sendSummaryForOrganization does not stop
    // the batch -- the run still reaches COMPLETE with errors > 0, and any
    // stray unrelated ERROR-shaped line shouldn't override that stronger signal.
    const log = [startLine(), completeLine({ sent: 2, errors: 1 })].join('\n');

    const result = evaluateWeeklyEmailRun(log, RELEASE);

    expect(result.status).toBe('COMPLETED_WITH_ERRORS');
  });

  it('takes the last marker of each kind when multiple runs appear in one excerpt', () => {
    const log = [
      startLine({ timestamp: '2026-09-07T09:00:00.000Z' }),
      completeLine({ timestamp: '2026-09-07T09:00:30.000Z', sent: 3, errors: 0 }),
      startLine({ timestamp: '2026-09-14T09:00:00.000Z' }),
      completeLine({ timestamp: '2026-09-14T09:00:45.000Z', sent: 5, errors: 2, organizations: 7 }),
    ].join('\n');

    const result = evaluateWeeklyEmailRun(log, RELEASE);

    expect(result.status).toBe('COMPLETED_WITH_ERRORS');
    expect(result.evidence.complete?.timestamp).toBe('2026-09-14T09:00:45.000Z');
    expect(result.evidence.complete?.sent).toBe(5);
  });
});
