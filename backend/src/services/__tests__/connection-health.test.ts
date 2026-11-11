/**
 * Connection health (AWS connect PR D1): the state machine and its display,
 * pure (connection-health.ts). The contract is connect-d1-step1.md §1.3 with
 * founder decisions D1-D1 (thresholds), D1-D2 (what counts) and D1-D4 (stale
 * overrides every state). Placeholders only.
 */
import {
  ASSUME_RESULT_FOR_KIND,
  EMPTY_HEALTH,
  LOST_MIN_FAILURES,
  LOST_MIN_MS,
  STALE_AFTER_MS,
  displayHealth,
  isConclusive,
  isRoleFailure,
  nextHealth,
  roleUniqueIdOf,
  type AssumeResult,
  type HealthRow,
} from '../connection-health';

const HOUR = 60 * 60 * 1000;
const T0 = Date.parse('2026-11-11T00:00:00Z');
const at = (hours: number) => new Date(T0 + hours * HOUR);

function apply(steps: Array<[number, AssumeResult]>, from: HealthRow = EMPTY_HEALTH): HealthRow {
  let row = from;
  for (const [hours, result] of steps) {
    const next = nextHealth(row, { at: at(hours), result });
    if (next) row = next;
  }
  return row;
}

describe('thresholds (D1-D1)', () => {
  it('are 24 h stale, 3 failures and 24 h for lost', () => {
    expect(STALE_AFTER_MS).toBe(24 * HOUR);
    expect(LOST_MIN_FAILURES).toBe(3);
    expect(LOST_MIN_MS).toBe(24 * HOUR);
  });
});

describe('what counts (D1-D2)', () => {
  it('maps every classified AssumeRole failure kind', () => {
    expect(ASSUME_RESULT_FOR_KIND).toEqual({
      platform: 'platform_unavailable',
      trust_denied: 'role_refused',
      transient: 'aws_unavailable',
      not_found: 'role_not_found',
      permanent: 'role_error',
    });
  });

  it.each([
    ['ok', false, true],
    ['role_refused', true, true],
    ['role_not_found', true, true],
    ['role_error', true, true],
    ['aws_unavailable', false, false],
    ['platform_unavailable', false, false],
  ] as const)('%s: role failure %s, conclusive %s', (result, failure, conclusive) => {
    expect(isRoleFailure(result)).toBe(failure);
    expect(isConclusive(result)).toBe(conclusive);
  });
});

describe('nextHealth', () => {
  it('a first success is ok', () => {
    expect(apply([[0, 'ok']])).toMatchObject({ health_state: 'ok', last_ok_at: at(0), last_conclusive_at: at(0), consecutive_role_failures: 0, failing_since: null });
  });

  it('ok -> failing at the first role failure, failing_since = that attempt', () => {
    expect(apply([[0, 'ok'], [6, 'role_refused']])).toMatchObject({ health_state: 'failing', failing_since: at(6), consecutive_role_failures: 1, lost_at: null });
  });

  it('a first-ever attempt that fails is failing', () => {
    expect(apply([[0, 'role_not_found']])).toMatchObject({ health_state: 'failing', failing_since: at(0), consecutive_role_failures: 1 });
  });

  it('two failures at 30 h are still failing (fewer than 3)', () => {
    expect(apply([[0, 'ok'], [1, 'role_refused'], [31, 'role_refused']])).toMatchObject({ health_state: 'failing', consecutive_role_failures: 2 });
  });

  it('three failures within 24 h of the first are still failing', () => {
    const row = apply([[0, 'ok'], [1, 'role_refused'], [2, 'role_refused'], [1 + 23 + 59 / 60, 'role_refused']]);
    expect(row).toMatchObject({ health_state: 'failing', consecutive_role_failures: 3, lost_at: null });
  });

  it('the third failure at exactly 24 h after the first is lost', () => {
    const row = apply([[0, 'ok'], [1, 'role_refused'], [2, 'role_refused'], [25, 'role_refused']]);
    expect(row).toMatchObject({ health_state: 'lost', consecutive_role_failures: 3, lost_at: at(25), failing_since: at(1) });
  });

  it('a burst of failures in minutes never reaches lost', () => {
    const steps: Array<[number, AssumeResult]> = Array.from({ length: 20 }, (_, i) => [1 + i / 60, 'role_refused']);
    expect(apply([[0, 'ok'], ...steps])).toMatchObject({ health_state: 'failing', consecutive_role_failures: 20 });
  });

  it('lost stays lost on another failure; lost_at keeps its first value', () => {
    const lost = apply([[0, 'ok'], [1, 'role_refused'], [2, 'role_refused'], [25, 'role_refused']]);
    expect(apply([[31, 'role_error']], lost)).toMatchObject({ health_state: 'lost', lost_at: at(25), consecutive_role_failures: 4 });
  });

  it.each([['failing'], ['lost']])('a success from %s is ok, counters cleared', (state) => {
    const steps: Array<[number, AssumeResult]> = state === 'failing'
      ? [[0, 'ok'], [1, 'role_refused']]
      : [[0, 'ok'], [1, 'role_refused'], [2, 'role_refused'], [25, 'role_refused']];
    expect(apply([[30, 'ok']], apply(steps))).toMatchObject({ health_state: 'ok', failing_since: null, lost_at: null, consecutive_role_failures: 0, last_ok_at: at(30) });
  });

  it.each([['aws_unavailable'], ['platform_unavailable']] as const)('%s changes only the last attempt', (result) => {
    const failing = apply([[0, 'ok'], [1, 'role_refused']]);
    const after = nextHealth(failing, { at: at(2), result })!;
    expect(after).toEqual({ ...failing, last_attempt_at: at(2), last_attempt_result: result });
  });

  it('an attempt older than, or as old as, the recorded one changes nothing', () => {
    const row = apply([[5, 'ok']]);
    expect(nextHealth(row, { at: at(4), result: 'role_refused' })).toBeNull();
    expect(nextHealth(row, { at: at(5), result: 'role_refused' })).toBeNull();
  });
});

describe('displayHealth', () => {
  const now = at(100);

  it('no row or no conclusive attempt: not checked yet', () => {
    expect(displayHealth(null, now).state).toBe('not_checked_yet');
    expect(displayHealth(apply([[99, 'aws_unavailable']]), now)).toEqual({ state: 'not_checked_yet', lastResult: null, checkedAt: null, failingSince: null, lostAt: null });
  });

  it('fresh: the stored state', () => {
    expect(displayHealth(apply([[90, 'ok']]), now)).toMatchObject({ state: 'ok', lastResult: 'ok', checkedAt: at(90).toISOString() });
    expect(displayHealth(apply([[80, 'ok'], [90, 'role_refused']]), now)).toMatchObject({ state: 'failing', failingSince: at(90).toISOString() });
  });

  it('exactly 24 h old is still fresh; a millisecond more is stale', () => {
    const row = apply([[76, 'ok']]);
    expect(displayHealth(row, now).state).toBe('ok');
    expect(displayHealth(row, new Date(now.getTime() + 1)).state).toBe('not_checked_recently');
  });

  it('stale overrides every state, naming the last result (D1-D4)', () => {
    const ok = apply([[10, 'ok']]);
    const failing = apply([[0, 'ok'], [10, 'role_refused']]);
    const lost = apply([[0, 'ok'], [1, 'role_refused'], [2, 'role_refused'], [25, 'role_refused']]);
    expect(displayHealth(ok, now)).toMatchObject({ state: 'not_checked_recently', lastResult: 'ok' });
    expect(displayHealth(failing, now)).toMatchObject({ state: 'not_checked_recently', lastResult: 'failing' });
    expect(displayHealth(lost, now)).toMatchObject({ state: 'not_checked_recently', lastResult: 'lost', lostAt: at(25).toISOString() });
  });

  it('transient attempts never refresh freshness', () => {
    const row = apply([[10, 'ok'], [99, 'aws_unavailable'], [99.5, 'platform_unavailable']]);
    expect(displayHealth(row, now)).toMatchObject({ state: 'not_checked_recently', checkedAt: at(10).toISOString() });
  });
});

describe('roleUniqueIdOf (AssumedRoleUser.AssumedRoleId = <role ID>:<session name>)', () => {
  it('takes the role ID before the colon', () => {
    expect(roleUniqueIdOf('AROAEXAMPLEROLEID0001:devcontrol-validation')).toBe('AROAEXAMPLEROLEID0001');
  });

  it.each([
    [undefined], [null], [42], [''], ['AROAEXAMPLEROLEID0001'], [':session'], ['AROA:session'], ['AROA-EXAMPLE-ROLE-ID01:session'], ['A'.repeat(129) + ':s'],
  ])('%p is not a role ID', (value) => {
    expect(roleUniqueIdOf(value)).toBeNull();
  });
});
