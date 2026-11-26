/**
 * D8a-3 (founder ruling 4): which stored processing failures the scheduled
 * retry may try again. Transient failures only; anything else, an unknown
 * code included, is permanent (fail closed).
 *
 * The codes are the ones the existing error path writes. processStoredEvent
 * stores a failure as `db_<sqlstate>` when the error carries a Postgres
 * SQLSTATE, else `processing_error` (process.ts, failureReason). An error
 * with no SQLSTATE (a programming error, a JSON parse failure, a socket
 * closed under node-pg) is not told apart from any other, so
 * `processing_error` is permanent.
 *
 * Transient: a later attempt can succeed with nothing changed. These SQLSTATEs
 * can reach the processing transaction (connect, the claim and quota locks,
 * the reads, the deployment insert, COMMIT):
 *
 *   40001  serialization_failure   a concurrent transaction won (COMMIT under contention)
 *   40P01  deadlock_detected       lock waits between concurrent processors
 *   55P03  lock_not_available      the retry transaction's own lock_timeout
 *   57014  query_canceled          the retry transaction's own statement_timeout
 *   57P01  admin_shutdown          the server was stopped or restarted
 *   57P02  crash_shutdown          the server crashed
 *   57P03  cannot_connect_now      the server is starting up
 *   53300  too_many_connections    the server's connection limit was reached at connect
 *
 * Everything else is permanent. In particular, class 23 (constraint), 22
 * (data), 42 (syntax or privilege) and XX (internal) fail the same way
 * again. 23503 was the D8b-1 disconnect race, now held rather than failed.
 */
export const TRANSIENT_FAILURE_REASONS: readonly string[] = [
  'db_40001',
  'db_40p01',
  'db_55p03',
  'db_57014',
  'db_57p01',
  'db_57p02',
  'db_57p03',
  'db_53300',
];

export function isTransientFailure(reason: string | null): boolean {
  return reason !== null && TRANSIENT_FAILURE_REASONS.includes(reason);
}
