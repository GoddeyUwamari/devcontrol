/**
 * The connection fence (AWS connect PR B, prB-plan.md (b)): every write of
 * AWS-derived data belongs to ONE AWS connection, the aws_accounts row whose
 * credentials fetched it, and commits only while that row is still the
 * organization's one eligible connection.
 *
 * IDENTITY. awsConnectionIdentity() (aws-accounts.repository.ts, from #289) is
 * the one canonical identity and key format: [row id, AWS account, role ARN,
 * home region], JSON. The row id comes first, so a replaced connection is a new
 * identity even with the same account, role ARN and region. Every writer
 * captures it when its work starts, from the row it actually used (the row its
 * AWS clients were built from, connectionIdentityOfClients), and every cache
 * and in-flight entry of AWS-derived data is keyed by it.
 *
 * THE LOCK. One transaction-level advisory lock per organization:
 *
 *   key = hashtextextended('aws_connection:' || <organization id>::uuid::text, 0)
 *
 * The id is cast through uuid first, so the text hashed is always the
 * canonical lower-case form: every caller, and any database-side user of the
 * same key, locks the same key for the same organization however the id was
 * written. A value that is not a uuid fails (22P02) instead of locking an
 * unrelated key.
 *
 * The 'aws_connection:' namespace keeps the key apart from every other
 * advisory-lock user (organization-authorization.ts hashes
 * 'organization_memberships:' || id; the cost, SOC 2, custom-compliance and
 * Stripe locks hash a bare id with their own non-zero salts; the migration
 * runner uses one fixed integer). Only the _xact_ forms are used, never the
 * session forms, so a lock always ends with its transaction and can never leak
 * onto a pooled connection.
 *
 *   - A writer takes it SHARED as the first statement of its write
 *     transaction, then reads the eligible row and compares identities, then
 *     writes, then commits. Shared holders never wait for each other.
 *   - Whatever changes which row is the active connection takes it EXCLUSIVE
 *     in the same transaction as that change: the connect INSERT
 *     (routes/aws.routes.ts), and PR C's disconnect.
 *
 * So the check and every write of its transaction are atomic with respect to
 * a connection change: the change waits for every fenced transaction already
 * past its check, and every fenced transaction that starts after it sees the
 * new row. Lock order is this lock first, then any lease row (scan-lease.ts),
 * so a disconnect that also touches lease rows cannot deadlock with a writer.
 *
 * No transaction or connection is held across an AWS call: a fenced
 * transaction holds database statements only, computed before it starts (the
 * same contract as scan-lease.ts withFencedTransaction).
 *
 * aws_accounts has no row-level security; findEligibleAwsAccount filters by
 * organization itself. A change to aws_accounts made by hand, outside the app
 * and without this lock, is not serialized (prB-plan.md D9): the next fence
 * still sees it.
 */
import type { ClientBase, PoolClient } from 'pg';
import {
  AwsAccountsQueryable,
  awsConnectionIdentity,
  findEligibleAwsAccount,
} from '../repositories/aws-accounts.repository';
import { assumedRoleSourceOf, type AWSClients } from './aws-client-factory.service';

/** The namespace of the connection lock's key (see the module comment). */
export const AWS_CONNECTION_LOCK_NAMESPACE = 'aws_connection:';

/** The lock key, in SQL, over the organization id passed as $1 (canonical uuid text; see the module comment). */
export const AWS_CONNECTION_LOCK_KEY_SQL = `hashtextextended('${AWS_CONNECTION_LOCK_NAMESPACE}' || $1::uuid::text, 0)`;

/** The longest any one statement of a connection-fenced transaction may run. */
export const CONNECTION_FENCE_STATEMENT_TIMEOUT_MS = 60 * 1000;

/** The longest a connection-fenced transaction may sit idle between statements. */
export const CONNECTION_FENCE_IDLE_IN_TRANSACTION_TIMEOUT_MS = 10 * 1000;

/** Logged (server only) when a fenced-out writer stops: organization and run ids only. */
export const CONNECTION_CHANGED = 'connection_changed';

/** The connection the work started with is no longer the active one: nothing was written. */
export class ConnectionChangedError extends Error {
  readonly code = 'CONNECTION_CHANGED';

  constructor(readonly organizationId: string) {
    super(`CONNECTION_CHANGED: org ${organizationId}'s AWS connection changed since this work started; nothing was written`);
    this.name = 'ConnectionChangedError';
  }
}

export function isConnectionChanged(err: unknown): err is ConnectionChangedError {
  return err instanceof ConnectionChangedError;
}

type Executor = Pick<ClientBase, 'query'>;

/** Takes the organization's connection lock SHARED until the current transaction ends. */
export async function lockConnectionShared(client: Executor, organizationId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock_shared(${AWS_CONNECTION_LOCK_KEY_SQL})`, [organizationId]);
}

/**
 * Takes the organization's connection lock EXCLUSIVE until the current
 * transaction ends: for the transaction that changes the active connection.
 */
export async function lockConnectionExclusive(client: Executor, organizationId: string): Promise<void> {
  await client.query(`SELECT pg_advisory_xact_lock(${AWS_CONNECTION_LOCK_KEY_SQL})`, [organizationId]);
}

/**
 * The organization's current connection identity, or null when it has no
 * eligible account. Throws AwsAccountAmbiguousError for more than one.
 */
export async function currentConnectionIdentity(db: AwsAccountsQueryable, organizationId: string): Promise<string | null> {
  const account = await findEligibleAwsAccount(db, organizationId);
  return account ? awsConnectionIdentity(account) : null;
}

/** The identity of the row a set of createClients() clients was built from; null for any other object. */
export function connectionIdentityOfClients(clients: AWSClients): string | null {
  const source = assumedRoleSourceOf(clients);
  return source ? awsConnectionIdentity(source.account) : null;
}

/**
 * The fence itself, inside the caller's open transaction and before its first
 * write: the shared lock, then the comparison, as two separate statements (the
 * comparison's snapshot is taken only after the lock is held). `expected` is
 * the identity of the connection the work started with. Work that started with
 * no eligible connection has nothing AWS-derived to write: `expected` null (or
 * empty) is never a pass, and is refused before anything else runs. Throws
 * ConnectionChangedError on any difference (AwsAccountAmbiguousError for more
 * than one eligible row); the caller rolls back.
 */
export async function assertConnectionUnchanged(client: Executor, organizationId: string, expected: string | null): Promise<void> {
  if (!expected) throw new ConnectionChangedError(organizationId);
  await lockConnectionShared(client, organizationId);
  const current = await currentConnectionIdentity(client, organizationId);
  if (current !== expected) throw new ConnectionChangedError(organizationId);
}

export interface ConnectionFenceOptions {
  statementTimeoutMs?: number;
  idleInTransactionTimeoutMs?: number;
}

/**
 * `fn` in one transaction on `client` that starts with the connection fence.
 * The organization tag is set LOCAL, so it ends with the transaction. Any
 * error, the fence's included, rolls everything back. `fn` runs database
 * statements on `client` only: no AWS call, no timer.
 */
export async function withConnectionFenceOn<T>(
  client: Executor,
  organizationId: string,
  expected: string | null,
  fn: () => Promise<T>,
  {
    statementTimeoutMs = CONNECTION_FENCE_STATEMENT_TIMEOUT_MS,
    idleInTransactionTimeoutMs = CONNECTION_FENCE_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  }: ConnectionFenceOptions = {}
): Promise<T> {
  await client.query('BEGIN');
  try {
    await client.query(`SET LOCAL statement_timeout = ${Math.round(statementTimeoutMs)}`);
    await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${Math.round(idleInTransactionTimeoutMs)}`);
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    await assertConnectionUnchanged(client, organizationId, expected);
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

/** How long a connection change waits for in-flight fenced writes before giving up (it then changes nothing). */
export const CONNECTION_CHANGE_LOCK_TIMEOUT_MS = 15 * 1000;

/**
 * `fn` in one transaction, on a connection of its own, that first takes the
 * organization's connection lock EXCLUSIVE: for the statement(s) that change
 * which aws_accounts row is the active connection (the connect INSERT; PR C's
 * disconnect). It waits for every in-flight fenced write (at most
 * `lockTimeoutMs`, after which it fails with lock_not_available, 55P03, and
 * changes nothing); every fence that starts after it commits sees the new row.
 */
export async function withConnectionChange<T>(
  pool: FenceConnectionSource,
  organizationId: string,
  fn: (client: PoolClient) => Promise<T>,
  { lockTimeoutMs = CONNECTION_CHANGE_LOCK_TIMEOUT_MS }: { lockTimeoutMs?: number } = {}
): Promise<T> {
  const client = await pool.connect();
  let failure: Error | undefined;
  try {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL lock_timeout = ${Math.max(1, Math.round(lockTimeoutMs))}`);
      await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
      await lockConnectionExclusive(client, organizationId);
      const result = await fn(client);
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  } catch (error: unknown) {
    failure = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    client.release(failure);
  }
}

/** What withConnectionFence checks a connection out of. */
export interface FenceConnectionSource {
  connect(): Promise<PoolClient>;
}

/**
 * withConnectionFenceOn on a connection of its own, released afterwards (with
 * the error when anything failed, so the pool discards it).
 */
export async function withConnectionFence<T>(
  pool: FenceConnectionSource,
  organizationId: string,
  expected: string | null,
  fn: (client: PoolClient) => Promise<T>,
  options: ConnectionFenceOptions = {}
): Promise<T> {
  const client = await pool.connect();
  let failure: Error | undefined;
  try {
    return await withConnectionFenceOn(client, organizationId, expected, () => fn(client), options);
  } catch (error: unknown) {
    // A fence refusal leaves the connection clean (rolled back); anything else may not.
    if (!isConnectionChanged(error)) failure = error instanceof Error ? error : new Error(String(error));
    throw error;
  } finally {
    client.release(failure);
  }
}
