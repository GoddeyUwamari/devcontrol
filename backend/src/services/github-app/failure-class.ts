/**
 * D8a-3 (founder ruling 4): which stored processing failures the scheduled
 * retry may try again. Transient failures only; anything else, an unknown
 * code included, is permanent (fail closed).
 *
 * The codes are the ones the existing error path writes (process.ts,
 * failureReason). Each error gets exactly one stored form, never its message:
 *
 *   db_<sqlstate>     a Postgres error (node-pg's DatabaseError) with its SQLSTATE
 *   connection_lost   a connection the driver lost (isConnectionLoss below)
 *   pool_checkout_timeout, connect_timeout
 *                     pg-pool could not hand out a connection in time
 *                     (connectTimeoutReason below)
 *   node_<code>       any other Node error code (EPIPE is node_epipe), so a
 *                     Node code is never stored as a db_ code (fix round 2, S-2)
 *   processing_error  any other error (a programming error, a JSON parse
 *                     failure): permanent
 *
 * Transient: a later attempt can succeed with nothing changed (founder
 * ruling 4; Addendum 2 ruling 2 for connection loss; the fix round 2 ruling
 * for connect timeouts, ETIMEDOUT and EPIPE). These SQLSTATEs can reach the
 * processing transaction (connect, the claim and quota locks, the reads, the
 * deployment insert, COMMIT):
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
 * and, carrying no SQLSTATE:
 *
 *   connection_lost        ECONNRESET, ECONNREFUSED, node-pg's own connection-loss messages
 *   pool_checkout_timeout  the pool was full for connectionTimeoutMillis
 *   connect_timeout        a new physical connection took longer than connectionTimeoutMillis
 *   node_epipe             a write to a socket the other end had closed
 *   node_etimedout         a TCP connect or keepalive timeout
 *
 * Everything else is permanent, including processing_error, every other
 * node_ code and every code not listed. In particular, class 23
 * (constraint), 22 (data), 42 (syntax or privilege) and XX (internal) fail
 * the same way again. 23503 was the D8b-1 disconnect race, now held rather
 * than failed.
 */
export const CONNECTION_LOST_REASON = 'connection_lost';
export const POOL_CHECKOUT_TIMEOUT_REASON = 'pool_checkout_timeout';
export const CONNECT_TIMEOUT_REASON = 'connect_timeout';

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
  POOL_CHECKOUT_TIMEOUT_REASON,
  CONNECT_TIMEOUT_REASON,
  'node_epipe',
  'node_etimedout',
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
 *    socket's 'error' event (pg lib/client.js, the connection's error
 *    listener, then _handleErrorEvent or, while connecting,
 *    _handleErrorWhileConnecting):
 *      ECONNRESET    the server or network reset the connection
 *      ECONNREFUSED  nothing accepted the connection (the server is down)
 *  - node-pg's own errors, by exact message (pg lib/client.js):
 *      'Connection terminated unexpectedly'   the socket ended without our end()
 *      'Connection terminated'                the socket ended during our end()
 *      'Client has encountered a connection error and is not queryable'
 *                                             a query on a client whose connection failed
 *
 * Not connection loss: 'Client was closed and is not queryable' (our own
 * end), 'Query read timeout' (processing_error, permanent), and every other
 * code (stored as node_<code>; EPIPE and ETIMEDOUT are transient that way).
 * The pool's connect timeouts are connectTimeoutReason's. Tests pin the
 * messages to the installed node-pg, and drop real connections (the retry
 * DB suite), so an upgrade that rewords them or changes what is thrown fails.
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

/**
 * Fix round 2 ruling (S-2): pg-pool's own connect timeouts, by exact message
 * (pg-pool index.js). Neither carries a code; nothing ran on the database.
 *   'timeout exceeded when trying to connect'
 *       every connection was checked out for connectionTimeoutMillis
 *   'Connection terminated due to connection timeout'
 *       a new physical connection was not established within connectionTimeoutMillis
 */
export const CONNECT_TIMEOUT_MESSAGES: Readonly<Record<string, string>> = {
  'timeout exceeded when trying to connect': POOL_CHECKOUT_TIMEOUT_REASON,
  'Connection terminated due to connection timeout': CONNECT_TIMEOUT_REASON,
};

export function connectTimeoutReason(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  if (typeof (error as { code?: unknown }).code === 'string') return null;
  return Object.prototype.hasOwnProperty.call(CONNECT_TIMEOUT_MESSAGES, error.message) ? CONNECT_TIMEOUT_MESSAGES[error.message] : null;
}

/**
 * A Node error code (EPIPE, ETIMEDOUT, ENOTFOUND, ERR_...) in its stored form,
 * node_<code>, or null. Fits the processing_reason check (^[a-z0-9_]{1,64}$).
 */
export function nodeErrorReason(error: unknown): string | null {
  if (!(error instanceof Error)) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === 'string' && /^E[A-Z0-9_]{1,58}$/.test(code) ? `node_${code.toLowerCase()}` : null;
}
