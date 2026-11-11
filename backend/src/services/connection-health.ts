/**
 * Connection health (AWS connect PR D1, connect-d1-step1.md §1.3, founder
 * decisions D1-D1..D1-D4): whether DevControl can still assume the role of the
 * organization's AWS connection, from the AssumeRole every scan already makes,
 * the connect check and the owner's "Check again".
 *
 * Pure: no database, no AWS, no clock. The repository
 * (aws-connection-checks.repository.ts) reads the row under its lock, calls
 * nextHealth and writes the result; readers call displayHealth with the server
 * clock.
 *
 * Contract:
 *   - Only a role-side refusal counts (role_refused: AccessDenied;
 *     role_not_found: NoSuchEntity; role_error: any other permanent refusal).
 *     A transient AWS failure or a failure on DevControl's own side is
 *     recorded as the last attempt and changes nothing else (D1-D2).
 *   - ok -> failing at the first role failure after a success (failing_since =
 *     that attempt); failing -> lost when, at a written failure, there have been
 *     at least LOST_MIN_FAILURES in a row AND failing_since is at least
 *     LOST_MIN_MS old (D1-D1). Any success -> ok, counters cleared. Lost never
 *     comes from a timer, only from evidence. Nothing here ever disconnects.
 *   - An attempt older than the last recorded one, or as old, changes nothing
 *     (monotonic: a slow writer never overwrites a newer result).
 *   - Display: no conclusive attempt yet -> not_checked_yet; the last
 *     conclusive attempt (ok or a role failure) more than STALE_AFTER_MS ago ->
 *     not_checked_recently, whatever the stored state (D1-D4); otherwise the
 *     stored state.
 */

export const STALE_AFTER_MS = 24 * 60 * 60 * 1000;
export const LOST_MIN_FAILURES = 3;
export const LOST_MIN_MS = 24 * 60 * 60 * 1000;

/** How one AssumeRole attempt ended. */
export type AssumeResult = 'ok' | 'role_refused' | 'role_not_found' | 'role_error' | 'aws_unavailable' | 'platform_unavailable';

export const ASSUME_RESULTS: readonly AssumeResult[] = ['ok', 'role_refused', 'role_not_found', 'role_error', 'aws_unavailable', 'platform_unavailable'];

/** The recorded result of an AssumeRole failure, by classifyAssumeRoleError's kind (connect-role-check.ts). */
export const ASSUME_RESULT_FOR_KIND: Record<'platform' | 'trust_denied' | 'transient' | 'not_found' | 'permanent', AssumeResult> = {
  platform: 'platform_unavailable',
  trust_denied: 'role_refused',
  transient: 'aws_unavailable',
  not_found: 'role_not_found',
  permanent: 'role_error',
};

/** Results that count toward failing and lost. */
const ROLE_FAILURES: ReadonlySet<AssumeResult> = new Set(['role_refused', 'role_not_found', 'role_error']);

export function isRoleFailure(result: AssumeResult): boolean {
  return ROLE_FAILURES.has(result);
}

/** Conclusive: says something about the role (success, or a role-side refusal). */
export function isConclusive(result: AssumeResult): boolean {
  return result === 'ok' || isRoleFailure(result);
}

export type HealthState = 'ok' | 'failing' | 'lost';

/** The stored health columns of one connection's row. */
export interface HealthRow {
  last_attempt_at: Date | null;
  last_attempt_result: AssumeResult | null;
  last_conclusive_at: Date | null;
  last_ok_at: Date | null;
  health_state: HealthState | null;
  failing_since: Date | null;
  lost_at: Date | null;
  consecutive_role_failures: number;
}

export const EMPTY_HEALTH: HealthRow = {
  last_attempt_at: null,
  last_attempt_result: null,
  last_conclusive_at: null,
  last_ok_at: null,
  health_state: null,
  failing_since: null,
  lost_at: null,
  consecutive_role_failures: 0,
};

export interface AssumeAttempt {
  /** When the AssumeRole was started. */
  at: Date;
  result: AssumeResult;
}

/**
 * The row after `attempt`, or null when the attempt is not newer than the last
 * recorded one (nothing is written).
 */
export function nextHealth(prev: HealthRow, attempt: AssumeAttempt): HealthRow | null {
  if (prev.last_attempt_at && attempt.at.getTime() <= prev.last_attempt_at.getTime()) return null;
  const base: HealthRow = { ...prev, last_attempt_at: attempt.at, last_attempt_result: attempt.result };

  if (attempt.result === 'ok') {
    return {
      ...base,
      last_conclusive_at: attempt.at,
      last_ok_at: attempt.at,
      health_state: 'ok',
      failing_since: null,
      lost_at: null,
      consecutive_role_failures: 0,
    };
  }
  if (!isRoleFailure(attempt.result)) return base;

  const failures = (prev.health_state === 'ok' || prev.health_state === null ? 0 : prev.consecutive_role_failures) + 1;
  const failingSince = prev.health_state === 'failing' || prev.health_state === 'lost' ? prev.failing_since ?? attempt.at : attempt.at;
  const lost =
    prev.health_state === 'lost' ||
    (failures >= LOST_MIN_FAILURES && attempt.at.getTime() - failingSince.getTime() >= LOST_MIN_MS);
  return {
    ...base,
    last_conclusive_at: attempt.at,
    health_state: lost ? 'lost' : 'failing',
    failing_since: failingSince,
    lost_at: lost ? prev.lost_at ?? attempt.at : null,
    consecutive_role_failures: failures,
  };
}

export type HealthDisplayState = 'ok' | 'failing' | 'lost' | 'not_checked_recently' | 'not_checked_yet';

export interface HealthDisplay {
  state: HealthDisplayState;
  /** The stored state, named as secondary text when stale; null when never checked. */
  lastResult: HealthState | null;
  /** The last conclusive attempt. */
  checkedAt: string | null;
  failingSince: string | null;
  lostAt: string | null;
}

const iso = (d: Date | null) => (d ? d.toISOString() : null);

export function displayHealth(row: HealthRow | null, now: Date): HealthDisplay {
  if (!row || !row.last_conclusive_at || !row.health_state) {
    return { state: 'not_checked_yet', lastResult: null, checkedAt: null, failingSince: null, lostAt: null };
  }
  const stale = now.getTime() - row.last_conclusive_at.getTime() > STALE_AFTER_MS;
  return {
    state: stale ? 'not_checked_recently' : row.health_state,
    lastResult: row.health_state,
    checkedAt: iso(row.last_conclusive_at),
    failingSince: iso(row.failing_since),
    lostAt: iso(row.lost_at),
  };
}

/**
 * IAM's documented role ID shape, also the CHECK on aws_connection_checks.role_unique_id:
 * Role.RoleId has "Length Constraints: Minimum length of 16. Maximum length of 128.
 * Pattern: [\w]+" (IAM API Reference, Role data type:
 * https://docs.aws.amazon.com/IAM/latest/APIReference/API_Role.html), i.e. ASCII
 * letters of either case, digits and underscore. Every example AWS shows is upper-case
 * (AROADBQP57FF2AEXAMPLE), but the documented pattern is the contract kept here.
 */
export const ROLE_UNIQUE_ID_PATTERN = /^[A-Za-z0-9_]{16,128}$/;

/**
 * The role's unique ID from an AssumeRole response's AssumedRoleUser.AssumedRoleId.
 * AWS documents that field as "A unique identifier that contains the role ID and the
 * role session name of the role that is being assumed. The role ID is generated by
 * AWS when the role is created." (pattern [\w+=,.@:-]*; STS API Reference,
 * AssumedRoleUser: https://docs.aws.amazon.com/STS/latest/APIReference/API_AssumedRoleUser.html),
 * and shows the form "AROADBQP57FF2AEXAMPLE:role-session-name" (IAM User Guide, IAM
 * identifiers, Unique identifiers:
 * https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_identifiers.html#identifiers-unique-ids).
 * A role ID never contains ':' ([\w]+), so it is the part before the first ':'.
 * Null when absent or not that shape: never guessed. Not tested against live AWS.
 */
export function roleUniqueIdOf(assumedRoleId: unknown): string | null {
  if (typeof assumedRoleId !== 'string') return null;
  const colon = assumedRoleId.indexOf(':');
  if (colon <= 0) return null;
  const id = assumedRoleId.slice(0, colon);
  return ROLE_UNIQUE_ID_PATTERN.test(id) ? id : null;
}
