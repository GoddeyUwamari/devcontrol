/**
 * Leases with fencing tokens (multi-region plan M4a): one scan per
 * (organization, AWS account, scan kind) in aws_scan_leases, and one
 * scheduled-job run per (organization, job name) in job_leases. Both tables
 * and the token contract come from
 * database/migrations-admin/202610191200_create_multi_region_scan_foundation.sql.
 *
 * Callers (M4b): scan-session.ts takes these leases at every scan entry
 * point, and every destructive transaction of a scan is fenced with them.
 *
 * THE GUARANTEE IS THE DATABASE ROW, never process memory. Acquire, renew,
 * release, completion and the commit fence are each one statement on the
 * shared tables, and every time they compare or write is the database's
 * current time (clock_timestamp()), never a timestamp sent by this process
 * and never the transaction's start time (now()), which can be long past
 * inside an open transaction. So the lease holds across processes and hosts
 * that share the database, whatever their clocks say. In-process state
 * (LeaseHeartbeat.lost) only lets a worker notice its own loss early; a
 * worker that has not noticed is still stopped by the fence.
 *
 * TOKENS. The database draws fencing_token on every acquisition (INSERT takes
 * the identity default; a takeover sets it to DEFAULT), so a key's tokens only
 * increase. Tokens are opaque strings compared by equality.
 *
 * THE COMMIT FENCE is the first statement of every destructive transaction:
 * `SELECT … FOR SHARE` of the lease row with the caller's token, still held
 * by the database clock. The row lock makes a takeover wait until the
 * transaction ends, so a worker whose lease expired cannot commit after
 * another worker acquired it, and its next fence fails. A scan lease's fence
 * also checks the account (fenceScanLease) with the one account rule
 * (findEligibleAwsAccount): exactly one eligible account, and it is the
 * lease's, or nothing is written.
 *
 * TENANT ISOLATION: both lease tables force row-level security on
 * app.current_organization_id, and every statement here also filters by the
 * organization. Callers pass a dedicated connection already tagged with the
 * organization; the heartbeat tags its own and clears the tag before
 * returning the connection.
 */
import { randomUUID } from 'crypto';
import { hostname } from 'os';
import { ClientBase, PoolClient } from 'pg';
import { findEligibleAwsAccount } from '../repositories/aws-accounts.repository';
import { parseAccountIdFromArn } from './aws-client-factory.service';

/**
 * A dedicated connection (a Client or a checked-out PoolClient) the caller has
 * already tagged with the organization. Never a Pool: the fence's row lock and
 * the transaction it belongs to only mean something on one connection.
 */
type Executor = ClientBase;

/** What the heartbeat checks connections out of (a pg Pool, or anything handing out PoolClients). */
export interface ConnectionSource {
  connect(): Promise<PoolClient>;
}

/** How long an acquisition or renewal holds the lease (the M3 contract's 5 minutes). */
export const LEASE_TTL_SECONDS = 5 * 60;

/** How often a held lease is renewed. */
export const LEASE_HEARTBEAT_INTERVAL_MS = 60 * 1000;

/**
 * The oldest a lease may get: renewal is refused once the lease was acquired
 * this long ago, by the database clock, and the holder must then stop.
 *
 * PROVISIONAL, FOR M4 ONLY. Sized for today's single-region scans (30 days of
 * production: p99 4.0 s, longest 5.3 s). It is NOT a multi-region guarantee
 * and must be reassessed before multi-region scanning (M7) with measured
 * multi-region durations, heartbeat reliability and per-region timeouts. A
 * healthy, heartbeating scan must never lose its lease to this limit without
 * that reassessment.
 */
export const MAX_LEASE_AGE_SECONDS = 60 * 60;

/** A lease that reaches this fraction of MAX_LEASE_AGE_SECONDS (by the database clock) is logged once. */
export const LEASE_AGE_WARNING_FRACTION = 0.5;

/** A renewal waits at most this long for a row lock (e.g. the holder's own fenced transaction). */
export const RENEW_LOCK_TIMEOUT_MS = 10 * 1000;

/** How much longer than its lock timeout any one heartbeat statement may run before the server cancels it. */
export const RENEW_STATEMENT_TIMEOUT_MARGIN_MS = 2 * 1000;

/** The heartbeat waits at most this long for a connection from its pool. */
export const HEARTBEAT_CONNECT_TIMEOUT_MS = 10 * 1000;

/**
 * How much longer than its server-side statement timeout the heartbeat waits for
 * any one reply on its own connection before giving the connection up (a dead TCP
 * connection never replies, and the server's limit cannot reach a client that is
 * no longer connected).
 */
export const HEARTBEAT_CLIENT_TIMEOUT_MARGIN_MS = 2 * 1000;

/** Consecutive renewal errors (not refusals) after which a lease counts as lost. */
export const MAX_CONSECUTIVE_RENEW_ERRORS = 2;

/** Log token for the age warning: logs only, nothing user-visible. */
export const LEASE_AGE_WARNING = 'scan_lease_age_warning';

/** The longest any ONE statement of a fenced transaction may run (statement_timeout is per statement). */
export const FENCED_STATEMENT_TIMEOUT_MS = 60 * 1000;

/**
 * The longest a fenced transaction may sit idle between statements. Past it
 * the server ends the session, which rolls the transaction back; the
 * connection is then unusable and must be released with an error.
 */
export const FENCED_IDLE_IN_TRANSACTION_TIMEOUT_MS = 10 * 1000;

const LOCK_NOT_AVAILABLE = '55P03';

export interface FencedTransactionOptions {
  statementTimeoutMs?: number;
  idleInTransactionTimeoutMs?: number;
}

export type LeaseKey =
  | { table: 'aws_scan_leases'; organizationId: string; awsAccountId: string; scanKind: string }
  | { table: 'job_leases'; organizationId: string; jobName: string };

/** A lease this worker acquired. */
export interface HeldLease {
  key: LeaseKey;
  fencingToken: string;
  holder: string;
  /** acquired_at, as the database recorded it. */
  acquiredAt: Date;
}

export type LeaseLossReason = 'lease_lost' | 'max_age' | 'account_changed';

/** A fence, renewal or completion found that this worker no longer holds its lease. */
export class LeaseLostError extends Error {
  readonly code = 'SCAN_LEASE_LOST';

  constructor(readonly reason: LeaseLossReason, key: LeaseKey) {
    super(`SCAN_LEASE_LOST: ${describeKey(key)} is no longer held by this worker (${reason}); nothing was written`);
    this.name = 'LeaseLostError';
  }
}

export function isLeaseLost(err: unknown): err is LeaseLostError {
  return err instanceof LeaseLostError;
}

function describeKey(key: LeaseKey): string {
  return key.table === 'aws_scan_leases'
    ? `scan lease (org ${key.organizationId}, account ${key.awsAccountId}, ${key.scanKind})`
    : `job lease (org ${key.organizationId}, ${key.jobName})`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** `<hostname>:<pid>:<run id>`, for logs only. */
export function leaseHolder(): string {
  return `${hostname()}:${process.pid}:${randomUUID()}`.slice(0, 255);
}

/** The key columns of `key`'s table, as a WHERE clause over $1.. and its values. */
function keyPredicate(key: LeaseKey): { sql: string; values: string[] } {
  return key.table === 'aws_scan_leases'
    ? { sql: 'organization_id = $1 AND aws_account_id = $2 AND scan_kind = $3', values: [key.organizationId, key.awsAccountId, key.scanKind] }
    : { sql: 'organization_id = $1 AND job_name = $2', values: [key.organizationId, key.jobName] };
}

/** What an acquisition statement returns. */
type AcquiredRow = { fencing_token: string | number; acquired_at: Date };

function held(key: LeaseKey, holder: string, row: AcquiredRow): HeldLease {
  return { key, fencingToken: String(row.fencing_token), holder, acquiredAt: row.acquired_at };
}

export interface AcquireOptions {
  ttlSeconds?: number;
  /**
   * The longest the acquisition waits for the lease row's lock (it waits
   * while the holder is inside a fenced transaction). When given, the
   * acquisition runs in its own transaction, so it must not be called inside
   * an open one; running out of time returns null, as when the lease is held.
   */
  lockTimeoutMs?: number;
}

/**
 * One acquisition statement. The inserted row's times are one clock reading
 * (the table's CHECK orders them); a takeover's expiry test reads the clock
 * again when the row is evaluated, after any wait for its lock. A takeover
 * that waited keeps the times read before the wait, so its lease is shorter
 * by the wait, never longer.
 */
async function acquire(db: Executor, sql: string, values: unknown[], lockTimeoutMs: number | undefined): Promise<AcquiredRow[]> {
  if (lockTimeoutMs === undefined) return (await db.query(sql, values)).rows;
  await db.query('BEGIN');
  try {
    await db.query(`SET LOCAL lock_timeout = ${Math.max(1, Math.round(lockTimeoutMs))}`);
    const { rows } = await db.query(sql, values);
    await db.query('COMMIT');
    return rows;
  } catch (error: unknown) {
    await db.query('ROLLBACK').catch(() => undefined);
    if ((error as { code?: string } | null)?.code === LOCK_NOT_AVAILABLE) return [];
    throw error;
  }
}

/**
 * Acquires the scan lease for (organization, AWS account, scan kind): a new
 * row, or a takeover of one that was released or has expired. Null when
 * another worker holds it (or, with lockTimeoutMs, could not be checked in time).
 */
export async function acquireScanLease(
  db: Executor,
  key: { organizationId: string; awsAccountId: string; scanKind: string },
  holder: string,
  { ttlSeconds = LEASE_TTL_SECONDS, lockTimeoutMs }: AcquireOptions = {}
): Promise<HeldLease | null> {
  const rows = await acquire(
    db,
    `INSERT INTO aws_scan_leases (organization_id, aws_account_id, scan_kind, holder, acquired_at, heartbeat_at, expires_at)
     SELECT $1, $2, $3, $4, c.ts, c.ts, c.ts + make_interval(secs => $5) FROM (SELECT clock_timestamp() AS ts) c
     ON CONFLICT (organization_id, aws_account_id, scan_kind) DO UPDATE
       SET fencing_token = DEFAULT, holder = EXCLUDED.holder, acquired_at = EXCLUDED.acquired_at,
           heartbeat_at = EXCLUDED.heartbeat_at, expires_at = EXCLUDED.expires_at, released_at = NULL, job_id = NULL
     WHERE aws_scan_leases.released_at IS NOT NULL OR aws_scan_leases.expires_at <= clock_timestamp()
     RETURNING fencing_token, acquired_at`,
    [key.organizationId, key.awsAccountId, key.scanKind, holder, ttlSeconds],
    lockTimeoutMs
  );
  return rows.length === 0 ? null : held({ table: 'aws_scan_leases', ...key }, holder, rows[0]);
}

/**
 * Acquires the job lease for (organization, job name). Null when another
 * worker holds it, or when `minSecondsSinceCompletion` is given and the job
 * last completed more recently than that (so two processes whose schedules
 * drift apart do not run the same cycle back to back).
 */
export async function acquireJobLease(
  db: Executor,
  key: { organizationId: string; jobName: string },
  holder: string,
  { ttlSeconds = LEASE_TTL_SECONDS, lockTimeoutMs, minSecondsSinceCompletion }: AcquireOptions & { minSecondsSinceCompletion?: number } = {}
): Promise<HeldLease | null> {
  const rows = await acquire(
    db,
    `INSERT INTO job_leases (organization_id, job_name, holder, acquired_at, heartbeat_at, expires_at)
     SELECT $1, $2, $3, c.ts, c.ts, c.ts + make_interval(secs => $4) FROM (SELECT clock_timestamp() AS ts) c
     ON CONFLICT (organization_id, job_name) DO UPDATE
       SET fencing_token = DEFAULT, holder = EXCLUDED.holder, acquired_at = EXCLUDED.acquired_at,
           heartbeat_at = EXCLUDED.heartbeat_at, expires_at = EXCLUDED.expires_at, released_at = NULL
     WHERE (job_leases.released_at IS NOT NULL OR job_leases.expires_at <= clock_timestamp())
       AND ($5::double precision IS NULL OR job_leases.last_completed_at IS NULL
            OR job_leases.last_completed_at <= clock_timestamp() - make_interval(secs => $5::double precision))
     RETURNING fencing_token, acquired_at`,
    [key.organizationId, key.jobName, holder, ttlSeconds, minSecondsSinceCompletion ?? null],
    lockTimeoutMs
  );
  return rows.length === 0 ? null : held({ table: 'job_leases', ...key }, holder, rows[0]);
}

/**
 * The renewal statement. Returns the lease's age in seconds by the database
 * clock when renewed, null when refused. The clock is read when the row is
 * evaluated (after any lock wait), so a lease that expired while the
 * renewal waited, or inside the caller's open transaction, is not renewed.
 */
async function renewReportingAge(
  db: Executor,
  lease: HeldLease,
  ttlSeconds: number,
  maxAgeSeconds: number
): Promise<number | null> {
  const { sql, values } = keyPredicate(lease.key);
  const n = values.length;
  const { rows } = await db.query(
    `UPDATE ${lease.key.table}
        SET heartbeat_at = clock_timestamp(), expires_at = clock_timestamp() + make_interval(secs => $${n + 2})
      WHERE ${sql} AND fencing_token = $${n + 1} AND released_at IS NULL AND expires_at > clock_timestamp()
        AND acquired_at > clock_timestamp() - make_interval(secs => $${n + 3})
      RETURNING EXTRACT(EPOCH FROM clock_timestamp() - acquired_at)::double precision AS age_seconds`,
    [...values, lease.fencingToken, ttlSeconds, maxAgeSeconds]
  );
  return rows.length === 1 ? Number(rows[0].age_seconds) : null;
}

/**
 * Extends a held lease by `ttlSeconds` from now. False when the lease is no
 * longer this worker's (released, expired, taken over) or has reached
 * `maxAgeSeconds` since it was acquired: the worker must stop.
 */
export async function renewLease(
  db: Executor,
  lease: HeldLease,
  { ttlSeconds = LEASE_TTL_SECONDS, maxAgeSeconds = MAX_LEASE_AGE_SECONDS }: { ttlSeconds?: number; maxAgeSeconds?: number } = {}
): Promise<boolean> {
  return (await renewReportingAge(db, lease, ttlSeconds, maxAgeSeconds)) !== null;
}

/** Releases a held lease (the row is kept: tokens must never restart). False when it was no longer this worker's. */
export async function releaseLease(db: Executor, lease: HeldLease): Promise<boolean> {
  const { sql, values } = keyPredicate(lease.key);
  const result = await db.query(
    `UPDATE ${lease.key.table} SET released_at = clock_timestamp()
      WHERE ${sql} AND fencing_token = $${values.length + 1} AND released_at IS NULL`,
    [...values, lease.fencingToken]
  );
  return (result.rowCount ?? 0) === 1;
}

/**
 * Records a job run as completed and releases its lease, only while this
 * worker still holds it by the database clock. False when it does not:
 * last_completed_at is then left as the current holder sets it.
 */
export async function completeJobLease(db: Executor, lease: HeldLease): Promise<boolean> {
  if (lease.key.table !== 'job_leases') throw new Error(`completeJobLease: ${describeKey(lease.key)} is not a job lease`);
  const { sql, values } = keyPredicate(lease.key);
  const result = await db.query(
    `UPDATE job_leases SET last_completed_at = clock_timestamp(), released_at = clock_timestamp()
      WHERE ${sql} AND fencing_token = $${values.length + 1} AND released_at IS NULL AND expires_at > clock_timestamp()`,
    [...values, lease.fencingToken]
  );
  return (result.rowCount ?? 0) === 1;
}

/**
 * The commit fence, without the account check. Must run inside the caller's
 * open transaction, before its first write: the FOR SHARE row lock it takes
 * is what makes a takeover wait for that transaction to end. Throws
 * LeaseLostError when the lease is not held with this token by the database
 * clock at this moment.
 */
export async function fenceLease(client: Executor, lease: HeldLease): Promise<void> {
  const { sql, values } = keyPredicate(lease.key);
  const { rows } = await client.query(
    `SELECT 1 FROM ${lease.key.table}
      WHERE ${sql} AND fencing_token = $${values.length + 1} AND released_at IS NULL AND expires_at > clock_timestamp()
      FOR SHARE`,
    [...values, lease.fencingToken]
  );
  if (rows.length === 0) throw new LeaseLostError('lease_lost', lease.key);
}

/**
 * The commit fence for a scan lease: fenceLease, then the account check, by
 * the one account rule every scan path uses (findEligibleAwsAccount,
 * aws-accounts.repository.ts): the organization's one eligible account must
 * be the lease's AWS account, read from its role ARN as ScanContext reads it
 * (scan-context.ts). More than one eligible account throws
 * AwsAccountAmbiguousError (AWS_ACCOUNT_AMBIGUOUS); none, or another account,
 * throws LeaseLostError('account_changed'). Either way the caller rolls back
 * and writes nothing.
 *
 * The account row is read without a row lock (aws_accounts has no RLS and
 * its grants are outside the repository's migrations, S3a audit §1.1), so a
 * change made while the transaction runs is caught by the next fence.
 */
export async function fenceScanLease(client: Executor, lease: HeldLease): Promise<void> {
  if (lease.key.table !== 'aws_scan_leases') throw new Error(`fenceScanLease: ${describeKey(lease.key)} is not a scan lease`);
  await fenceLease(client, lease);
  const account = await findEligibleAwsAccount(client, lease.key.organizationId);
  if (!account || parseAccountIdFromArn(account.role_arn ?? '') !== lease.key.awsAccountId) {
    throw new LeaseLostError('account_changed', lease.key);
  }
}

/** The fence for `lease`'s table: fenceScanLease for a scan lease, fenceLease for a job lease. */
export async function fence(client: Executor, lease: HeldLease): Promise<void> {
  if (lease.key.table === 'aws_scan_leases') await fenceScanLease(client, lease);
  else await fenceLease(client, lease);
}

/**
 * Records the scan's own discovery job on its lease row (plan §5.1 F15), so a
 * manual Sync that finds the lease held can join that job. Token-guarded: it is
 * its own fence. False when the lease is no longer this worker's.
 */
export async function linkScanLeaseJob(db: Executor, lease: HeldLease, jobId: string): Promise<boolean> {
  if (lease.key.table !== 'aws_scan_leases') throw new Error(`linkScanLeaseJob: ${describeKey(lease.key)} is not a scan lease`);
  const { sql, values } = keyPredicate(lease.key);
  const result = await db.query(
    `UPDATE aws_scan_leases SET job_id = $${values.length + 2}
      WHERE ${sql} AND fencing_token = $${values.length + 1} AND released_at IS NULL AND expires_at > clock_timestamp()`,
    [...values, lease.fencingToken, jobId]
  );
  return (result.rowCount ?? 0) === 1;
}

/** Who holds a scan key now, by the database clock, and the job it linked. */
export interface ScanLeaseState {
  held: boolean;
  jobId: string | null;
}

/** The current state of a scan key's lease row (no row: not held). */
export async function readScanLeaseState(
  db: Executor,
  key: { organizationId: string; awsAccountId: string; scanKind: string }
): Promise<ScanLeaseState> {
  const { rows } = await db.query(
    `SELECT (released_at IS NULL AND expires_at > clock_timestamp()) AS held, job_id
       FROM aws_scan_leases WHERE organization_id = $1 AND aws_account_id = $2 AND scan_kind = $3`,
    [key.organizationId, key.awsAccountId, key.scanKind]
  );
  return rows.length === 0 ? { held: false, jobId: null } : { held: rows[0].held === true, jobId: rows[0].job_id ?? null };
}

/**
 * The start of a fenced transaction, for a caller that has just issued BEGIN on
 * `client` itself (a repository that takes an advisory lock first): the two
 * server limits of withFencedTransaction, then the fence. Throws as the fence
 * does; the caller rolls back.
 */
export async function beginFenced(
  client: Executor,
  lease: HeldLease,
  {
    statementTimeoutMs = FENCED_STATEMENT_TIMEOUT_MS,
    idleInTransactionTimeoutMs = FENCED_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  }: FencedTransactionOptions = {}
): Promise<void> {
  await client.query(`SET LOCAL statement_timeout = ${Math.round(statementTimeoutMs)}`);
  await client.query(`SET LOCAL idle_in_transaction_session_timeout = ${Math.round(idleInTransactionTimeoutMs)}`);
  await fence(client, lease);
}


/**
 * Runs `fn` in one transaction on `client` that starts with the fence for
 * `lease`. Any error, the fence's included, rolls the whole transaction back.
 *
 * CONTRACT: `fn` runs database statements on `client` only. No AWS call, no
 * timer and no other await may happen inside it: everything it writes must
 * be computed before the transaction starts. Two server limits enforce
 * this: each statement may run at most FENCED_STATEMENT_TIMEOUT_MS, and the
 * transaction may sit idle between statements at most
 * FENCED_IDLE_IN_TRANSACTION_TIMEOUT_MS, after which the server ends the
 * session (rolling the transaction back). The connection is then unusable;
 * the caller must release it with the error.
 */
export async function withFencedTransaction<T>(
  client: Executor,
  lease: HeldLease,
  fn: () => Promise<T>,
  {
    statementTimeoutMs = FENCED_STATEMENT_TIMEOUT_MS,
    idleInTransactionTimeoutMs = FENCED_IDLE_IN_TRANSACTION_TIMEOUT_MS,
  }: FencedTransactionOptions = {}
): Promise<T> {
  await client.query('BEGIN');
  try {
    await beginFenced(client, lease, { statementTimeoutMs, idleInTransactionTimeoutMs });
    const result = await fn();
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

export interface HeartbeatOptions {
  intervalMs?: number;
  ttlSeconds?: number;
  maxAgeSeconds?: number;
  renewLockTimeoutMs?: number;
  /** Defaults to renewLockTimeoutMs + RENEW_STATEMENT_TIMEOUT_MARGIN_MS. */
  renewStatementTimeoutMs?: number;
  connectTimeoutMs?: number;
}

/**
 * Keeps a held lease renewed until stop(), on its own short-lived connections
 * (checkout, tag, renew, untag, release), never on the worker's connection,
 * which is busy with the scan.
 *
 * The lease counts as lost, and is no longer renewed, when a renewal is
 * refused (taken over, released, expired, or MAX_LEASE_AGE_SECONDS reached),
 * or after MAX_CONSECUTIVE_RENEW_ERRORS renewal errors in a row. Every step
 * is bounded, so a renewal always settles and stop() / stopAndRelease()
 * always return: the connection checkout by connectTimeoutMs, a row-lock
 * wait by renewLockTimeoutMs, and any one statement by
 * renewStatementTimeoutMs. A renewal that runs out of time counts as an
 * error. The worker reads `lost` at its checkpoints (checkpoint() throws);
 * every write is fenced regardless.
 */
export class LeaseHeartbeat {
  private timer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private consecutiveErrors = 0;
  private ageWarned = false;
  private lossReason: LeaseLossReason | undefined;
  private readonly intervalMs: number;
  private readonly ttlSeconds: number;
  private readonly maxAgeSeconds: number;
  private readonly renewLockTimeoutMs: number;
  private readonly renewStatementTimeoutMs: number;
  private readonly connectTimeoutMs: number;

  constructor(
    private readonly pool: ConnectionSource,
    readonly lease: HeldLease,
    options: HeartbeatOptions = {}
  ) {
    this.intervalMs = options.intervalMs ?? LEASE_HEARTBEAT_INTERVAL_MS;
    this.ttlSeconds = options.ttlSeconds ?? LEASE_TTL_SECONDS;
    this.maxAgeSeconds = options.maxAgeSeconds ?? MAX_LEASE_AGE_SECONDS;
    this.renewLockTimeoutMs = options.renewLockTimeoutMs ?? RENEW_LOCK_TIMEOUT_MS;
    this.renewStatementTimeoutMs = options.renewStatementTimeoutMs ?? this.renewLockTimeoutMs + RENEW_STATEMENT_TIMEOUT_MARGIN_MS;
    this.connectTimeoutMs = options.connectTimeoutMs ?? HEARTBEAT_CONNECT_TIMEOUT_MS;
  }

  /** Starts renewing every intervalMs. */
  start(): this {
    if (!this.timer && !this.lossReason) this.schedule();
    return this;
  }

  get lost(): boolean {
    return this.lossReason !== undefined;
  }

  get reason(): LeaseLossReason | undefined {
    return this.lossReason;
  }

  /** Throws LeaseLostError once the lease is known lost; the worker stops at that point. */
  checkpoint(): void {
    if (this.lossReason) throw new LeaseLostError(this.lossReason, this.lease.key);
  }

  /** Stops renewing; an in-flight renewal is awaited (it is bounded, so this returns). Does not release. */
  async stop(): Promise<void> {
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    await this.inFlight;
  }

  /**
   * stop(), then release the lease on its own connection. False when the
   * lease was no longer this worker's, or the release could not be made (it
   * then expires on its own); never throws.
   */
  async stopAndRelease(): Promise<boolean> {
    await this.stop();
    try {
      return await this.onOwnConnection((client) => this.bounded(client, () => releaseLease(client, this.lease)));
    } catch (error: unknown) {
      console.error(`[ScanLease] Release of ${describeKey(this.lease.key)} failed; it expires on its own:`, errorMessage(error));
      return false;
    }
  }

  /** One renewal now (also what each timer tick runs). Always settles. */
  async beat(): Promise<void> {
    if (this.lossReason) return;
    try {
      const ageSeconds = await this.onOwnConnection((client) =>
        this.bounded(client, () => renewReportingAge(client, this.lease, this.ttlSeconds, this.maxAgeSeconds))
      );
      this.consecutiveErrors = 0;
      if (ageSeconds === null) {
        this.markLost((await this.refusedForAge().catch(() => false)) ? 'max_age' : 'lease_lost');
      } else {
        this.warnOnAge(ageSeconds);
      }
    } catch (error: unknown) {
      this.consecutiveErrors++;
      console.error(
        `[ScanLease] Renewal of ${describeKey(this.lease.key)} failed (${this.consecutiveErrors}/${MAX_CONSECUTIVE_RENEW_ERRORS}):`,
        errorMessage(error)
      );
      if (this.consecutiveErrors >= MAX_CONSECUTIVE_RENEW_ERRORS) this.markLost('lease_lost');
    }
  }

  private schedule(): void {
    this.timer = setTimeout(() => {
      this.inFlight = this.beat().finally(() => {
        this.inFlight = undefined;
        if (this.timer && !this.lossReason) this.schedule();
      });
    }, this.intervalMs);
    this.timer.unref?.();
  }

  private markLost(reason: LeaseLossReason): void {
    if (this.lossReason) return;
    this.lossReason = reason;
    if (this.timer) clearTimeout(this.timer);
    this.timer = undefined;
    console.error(`[ScanLease] ${describeKey(this.lease.key)} lost (${reason}); the worker stops at its next checkpoint`);
  }

  /** Whether a refused renewal was refused only because the lease reached its maximum age, by the database clock. */
  private async refusedForAge(): Promise<boolean> {
    const { sql, values } = keyPredicate(this.lease.key);
    const n = values.length;
    const { rows } = await this.onOwnConnection((client) =>
      this.bounded(client, () =>
        client.query(
          `SELECT 1 FROM ${this.lease.key.table}
            WHERE ${sql} AND fencing_token = $${n + 1} AND released_at IS NULL AND expires_at > clock_timestamp()
              AND acquired_at <= clock_timestamp() - make_interval(secs => $${n + 2})`,
          [...values, this.lease.fencingToken, this.maxAgeSeconds]
        )
      )
    );
    return rows.length === 1;
  }

  /** Logs once when the lease's age, as the database measured it at the last renewal, passes the warning fraction. */
  private warnOnAge(ageSeconds: number): void {
    if (this.ageWarned || ageSeconds < this.maxAgeSeconds * LEASE_AGE_WARNING_FRACTION) return;
    this.ageWarned = true;
    console.warn(
      `[ScanLease] ${LEASE_AGE_WARNING}: ${describeKey(this.lease.key)} has been held for ${Math.round(ageSeconds)}s ` +
        `of its ${this.maxAgeSeconds}s maximum`
    );
  }

  /** `fn` in a transaction whose lock waits and statements the server cuts off, so it always settles. */
  private async bounded<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
    await client.query('BEGIN');
    try {
      await client.query(`SET LOCAL lock_timeout = ${Math.round(this.renewLockTimeoutMs)}`);
      await client.query(`SET LOCAL statement_timeout = ${Math.round(this.renewStatementTimeoutMs)}`);
      const result = await fn();
      await client.query('COMMIT');
      return result;
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    }
  }

  /**
   * A connection from the pool, tagged with the organization for `fn`, and
   * untagged again before it goes back. Every query on it is also bounded on
   * this side (the server's statement timeout plus a margin): a connection that
   * stops answering (a dead TCP connection) fails the query instead of holding
   * the heartbeat forever. A connection on which anything failed is released
   * with the error, so the pool discards it.
   */
  private async onOwnConnection<T>(fn: (client: PoolClient) => Promise<T>): Promise<T> {
    const raw = await this.connect();
    const client = withClientTimeout(raw, this.renewStatementTimeoutMs + HEARTBEAT_CLIENT_TIMEOUT_MARGIN_MS);
    let releaseError: Error | undefined;
    try {
      await client.query("SELECT set_config('app.current_organization_id', $1, false)", [this.lease.key.organizationId]);
      return await fn(client);
    } catch (error: unknown) {
      releaseError = error instanceof Error ? error : new Error(String(error));
      throw error;
    } finally {
      if (!releaseError) {
        try {
          await client.query("SELECT set_config('app.current_organization_id', '', false)");
        } catch (error: unknown) {
          releaseError = error instanceof Error ? error : new Error(String(error));
        }
      }
      raw.release(releaseError);
    }
  }

  /** pool.connect(), given up after connectTimeoutMs; a connection that arrives later is released at once. */
  private async connect(): Promise<PoolClient> {
    let timedOut = false;
    let timer: NodeJS.Timeout | undefined;
    const pending = this.pool.connect();
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => {
        timedOut = true;
        reject(new Error(`no database connection within ${this.connectTimeoutMs} ms`));
      }, this.connectTimeoutMs);
      timer.unref?.();
    });
    try {
      return await Promise.race([pending, deadline]);
    } catch (error) {
      if (timedOut) pending.then((late) => late.release(), () => undefined);
      throw error;
    } finally {
      clearTimeout(timer);
    }
  }
}

/**
 * `client` with every query given up after `timeoutMs` on this side. The same
 * connection underneath (it inherits from it); only `query` is replaced. A query
 * given up this way leaves the connection in an unknown state: the caller must
 * release it with the error.
 */
function withClientTimeout(client: PoolClient, timeoutMs: number): PoolClient {
  const guarded = Object.create(client) as PoolClient;
  guarded.query = ((...args: unknown[]) => {
    let timer: NodeJS.Timeout | undefined;
    const reply = (client.query as (...a: unknown[]) => Promise<unknown>).apply(client, args);
    const deadline = new Promise<never>((_, reject) => {
      timer = setTimeout(() => reject(new Error(`no reply from the database within ${timeoutMs} ms`)), timeoutMs);
      timer.unref?.();
    });
    return Promise.race([reply, deadline]).finally(() => clearTimeout(timer));
  }) as PoolClient['query'];
  return guarded;
}
