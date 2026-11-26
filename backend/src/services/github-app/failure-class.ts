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
 * Transient: a later attempt can succeed with nothing changed (founder
 * rulings 4 and, for connection loss, Addendum 2 ruling 2). These SQLSTATEs
 * can reach the processing transaction (connect, the claim and quota locks,
 * the reads, the deployment insert, COMMIT):
 *
 *   class 08 connection exceptions (Addendum 2): 08000 connection_exception,
 *   08003 connection_does_not_exist, 08006 connection_failure, 08001
 *   sqlclient_unable_to_establish_sqlconnection, 08004
 *   sqlserver_rejected_establishment_of_sqlconnection, 08007
 *   transaction_resolution_unknown, 08P01 protocol_violation
 *   40001  serialization_failure   a concurrent transaction won (COMMIT under contention)
 *   40P01  deadlock_detected       lock waits between concurrent processors
 *   55P03  lock_not_available      the retry transaction's own lock_timeout
 *   57014  query_canceled          the retry transaction's own statement_timeout
 *   57P01  admin_shutdown          the server was stopped or restarted
 *   57P02  crash_shutdown          the server crashed
 *   57P03  cannot_connect_now      the server is starting up
 *   53300  too_many_connections    the server's connection limit was reached at connect
 *
 * and CONNECTION_LOST_REASON: a connection the driver lost, which carries no
 * SQLSTATE (isConnectionLoss below).
 *
 * Everything else is permanent, including processing_error (any other error
 * with no SQLSTATE) and every code not listed. In particular, class 23
 * (constraint), 22 (data), 42 (syntax or privilege) and XX (internal) fail
 * the same way again. 23503 was the D8b-1 disconnect race, now held rather
 * than failed.
 */
export const CONNECTION_LOST_REASON = 'connection_lost';

export const TRANSIENT_FAILURE_REASONS: readonly string[] = [
  'db_08000',
  'db_08003',
  'db_08006',
  'db_08001',
  'db_08004',
  'db_08007',
  'db_08p01',
  'db_40001',
  'db_40p01',
  'db_55p03',
  'db_57014',
  'db_57p01',
  'db_57p02',
  'db_57p03',
  'db_53300',
  CONNECTION_LOST_REASON,
];

export function isTransientFailure(reason: string | null): boolean {
  return reason !== null && TRANSIENT_FAILURE_REASONS.includes(reason);
}

/**
 * Addendum 2 ruling 2: the driver lost the connection (reset, refused or
 * terminated). These errors carry no SQLSTATE, so they are recognised
 * exactly, and nothing else is:
 *
 *  - Node socket errors, by `code`, which node-pg passes on unchanged from the
 *    socket's 'error' event (pg 8.16.3 lib/client.js:191, the connection's
 *    error listener, then _handleErrorEvent :344 or, while connecting,
 *    _handleErrorWhileConnecting :328):
 *      ECONNRESET    the server or network reset the connection
 *      ECONNREFUSED  nothing accepted the connection (the server is down)
 *  - node-pg's own errors, by exact message:
 *      'Connection terminated unexpectedly'   lib/client.js:136, the socket ended without our end()
 *      'Connection terminated'                lib/client.js:136, the socket ended during our end()
 *      'Client has encountered a connection error and is not queryable'
 *                                             lib/client.js:592, a query on a client whose connection failed
 *
 * Not connection loss (permanent): pg-pool's 'timeout exceeded when trying
 * to connect' and 'Connection terminated due to connection timeout' (connect
 * timeouts), 'Client was closed and is not queryable' (our own end), 'Query
 * read timeout', EPIPE and every other code. A test pins the three
 * messages to the installed node-pg, so an upgrade that rewords them fails.
 */
export const CONNECTION_LOSS_ERROR_CODES: readonly string[] = ['ECONNRESET', 'ECONNREFUSED'];
export const CONNECTION_LOSS_MESSAGES: readonly string[] = [
  'Connection terminated unexpectedly',
  'Connection terminated',
  'Client has encountered a connection error and is not queryable',
];

export function isConnectionLoss(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as { code?: unknown }).code;
  if (typeof code === 'string') return CONNECTION_LOSS_ERROR_CODES.includes(code);
  return CONNECTION_LOSS_MESSAGES.includes(error.message);
}
