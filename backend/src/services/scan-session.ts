/**
 * A scan's hold on its lease (multi-region plan M4b, §4): acquired before the
 * scan writes anything, heartbeated from the moment it is acquired, checked at
 * every checkpoint, and released in `finally` on every path.
 *
 * Every destructive transaction of the scan runs through fenced() (or, in a
 * repository that takes an advisory lock first, beginFenced() with `lease`):
 * the M4a commit fence is its first statement, so a worker whose lease was lost
 * commits nothing. A fence that fails marks the session lost, so the worker
 * also stops at its next checkpoint even before its heartbeat notices.
 *
 * The approved user-visible texts for the lease (§4.2, §4.6) live here.
 */
import { Pool, PoolClient } from 'pg';
import { findEligibleAwsAccount } from '../repositories/aws-accounts.repository';
import { parseAccountIdFromArn } from './aws-client-factory.service';
import {
  HeartbeatOptions,
  HeldLease,
  LeaseHeartbeat,
  LeaseLostError,
  acquireJobLease,
  acquireScanLease,
  completeJobLease,
  isLeaseLost,
  leaseHolder,
  readScanLeaseState,
  withFencedTransaction,
} from './scan-lease';

/** The scan kind discovery and cost Analyze share: they change the same rows (§4.1). */
export const SCAN_KIND_DISCOVERY = 'discovery';

/** The cron's per-organization job lease (§4.3). */
export const DISCOVERY_JOB_NAME = 'resource_discovery';

/** A scheduled cycle that completed this recently is not run again by another process (§4.3). */
export const DISCOVERY_JOB_MIN_SECONDS_SINCE_COMPLETION = 5 * 60 * 60;

/** Approved (Q1): a manual Sync or cost Analyze that waited the full cap for a running scan. */
export const SCAN_BUSY_MESSAGE = 'A scan is already running for this AWS account. Try again in a few minutes.';

/** Approved (Q3): the job row of a scan that stopped because another scan took over its lease. */
export const DISCOVERY_LEASE_LOST_MESSAGE =
  'Discovery was interrupted because another scan took over. Results will update on the next sync.';

/** Approved (rev 3): the job row of an earlier scan that never finished, closed by race-safe recovery (F16). */
export const DISCOVERY_INTERRUPTED_MESSAGE = 'Discovery was interrupted before it finished. It will run again on the next sync.';

/** Logged (server only) when an organization's eligible account has a role ARN that names no AWS account. */
export const UNPARSEABLE_ROLE_ARN_WARNING = 'scan_lease_account_unparseable';

/** How often a waiting manual Sync or Analyze looks at the lease again. */
export const SCAN_WAIT_POLL_MS = 2 * 1000;

/** How long a manual Sync or Analyze waits for a running scan before answering 409. */
export const SCAN_WAIT_CAP_MS = 15 * 60 * 1000;

/** An acquisition waits at most this long for the lease row's lock (the holder may be inside a fenced transaction). */
export const SCAN_ACQUIRE_LOCK_TIMEOUT_MS = 10 * 1000;

/** Another worker holds the scan lease for this (organization, AWS account): this scan did not start. */
export class ScanAlreadyRunningError extends Error {
  readonly code = 'SCAN_ALREADY_RUNNING';

  constructor(readonly organizationId: string, readonly awsAccountId: string) {
    super(`SCAN_ALREADY_RUNNING: a scan for org ${organizationId}, account ${awsAccountId} is already running`);
    this.name = 'ScanAlreadyRunningError';
  }
}

export function isScanAlreadyRunning(err: unknown): err is ScanAlreadyRunningError {
  return err instanceof ScanAlreadyRunningError;
}

/** A manual Sync or Analyze waited SCAN_WAIT_CAP_MS for a running scan: answered 409 with SCAN_BUSY_MESSAGE. */
export class ScanBusyError extends Error {
  readonly code = 'SCAN_BUSY';

  constructor(organizationId: string) {
    super(`SCAN_BUSY: a scan for org ${organizationId} was still running after the wait cap`);
    this.name = 'ScanBusyError';
  }
}

export function isScanBusy(err: unknown): err is ScanBusyError {
  return err instanceof ScanBusyError;
}

/** How a session's heartbeat and waits are timed. Production uses the defaults; tests shorten them. */
export interface LeaseTiming {
  /** The lease's TTL at acquisition (and each renewal's, unless heartbeat.ttlSeconds says otherwise). */
  ttlSeconds?: number;
  heartbeat?: HeartbeatOptions;
  pollMs?: number;
  capMs?: number;
  acquireLockTimeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const realSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** One held lease and its heartbeat. */
export class LeaseSession {
  private readonly heartbeat: LeaseHeartbeat;
  private fenceFailure: LeaseLostError | undefined;
  private ended = false;

  constructor(private readonly pool: Pool, readonly lease: HeldLease, timing: LeaseTiming = {}) {
    // Started at once, so the lease is renewed (and its age measured) from acquisition on.
    this.heartbeat = new LeaseHeartbeat(pool, lease, { ttlSeconds: timing.ttlSeconds, ...timing.heartbeat }).start();
  }

  /** Whether the lease is known lost (by the heartbeat, or by a fence that failed). */
  get lost(): boolean {
    return this.fenceFailure !== undefined || this.heartbeat.lost;
  }

  /** Throws LeaseLostError once the lease is known lost: the worker writes nothing more. */
  checkpoint(): void {
    if (this.fenceFailure) throw this.fenceFailure;
    this.heartbeat.checkpoint();
  }

  /**
   * `fn` in one fenced transaction on `client` (withFencedTransaction): database
   * statements only. Checks the session first; a fence that fails marks it lost.
   */
  async fenced<T>(client: PoolClient, fn: () => Promise<T>): Promise<T> {
    this.checkpoint();
    return this.watch(() => withFencedTransaction(client, this.lease, fn));
  }

  /** Runs a call that fences with `lease` itself (a repository method); a lost lease it reports marks the session lost. */
  async watch<T>(call: () => Promise<T>): Promise<T> {
    try {
      return await call();
    } catch (error: unknown) {
      if (isLeaseLost(error)) this.fenceFailure ??= error;
      throw error;
    }
  }

  /** Stops the heartbeat and releases the lease. Idempotent; never throws. */
  async end(): Promise<void> {
    if (this.ended) return;
    this.ended = true;
    await this.heartbeat.stopAndRelease();
  }

  /**
   * For a job lease: stops the heartbeat, then records the run as completed and
   * releases the lease in one token-guarded statement (M3 contract). False when the
   * lease was no longer this worker's, or the write failed (the lease then expires);
   * never throws. Idempotent with end().
   */
  async complete(): Promise<boolean> {
    if (this.ended) return false;
    this.ended = true;
    await this.heartbeat.stop();
    try {
      return await onTaggedConnection(this.pool, this.lease.key.organizationId, (client) => completeJobLease(client, this.lease));
    } catch (error: unknown) {
      console.error('[ScanLease] Job completion failed; the lease expires on its own:', error instanceof Error ? error.message : String(error));
      return false;
    }
  }
}

/**
 * The AWS account a scan of this organization would lease: its one eligible
 * account's id, read from the role ARN as ScanContext reads it. Null when there
 * is none, it is ambiguous or its ARN names no account: the scan then fails
 * before it writes anything, exactly as it does today (ScanContext.forOrg).
 * An eligible account whose ARN names no account is logged (server log only:
 * nothing of it reaches the user), so the organization can be found and fixed.
 */
export async function leaseAccountFor(db: PoolClient | Pool, organizationId: string): Promise<string | null> {
  let account: Awaited<ReturnType<typeof findEligibleAwsAccount>>;
  try {
    account = await findEligibleAwsAccount(db, organizationId);
  } catch {
    return null;
  }
  if (!account) return null;
  const awsAccountId = parseAccountIdFromArn(account.role_arn ?? '') ?? null;
  if (!awsAccountId) {
    console.warn(
      `[ScanLease] ${UNPARSEABLE_ROLE_ARN_WARNING}: org ${organizationId}'s eligible AWS account has a role ARN that names no account; nothing is leased or written`
    );
  }
  return awsAccountId;
}

/** `fn` on a connection of its own, tagged with the organization, untagged before it goes back. */
export async function onTaggedConnection<T>(pool: Pool, organizationId: string, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  let releaseError: Error | undefined;
  try {
    await client.query("SELECT set_config('app.current_organization_id', $1, false)", [organizationId]);
    return await fn(client);
  } finally {
    try {
      await client.query("SELECT set_config('app.current_organization_id', '', false)");
    } catch (error: unknown) {
      releaseError = error instanceof Error ? error : new Error(String(error));
    }
    client.release(releaseError);
  }
}

/** Acquires the scan lease on `client` (tagged with the organization) and starts its heartbeat. Null when held. */
export async function openScanSession(
  pool: Pool,
  client: PoolClient,
  organizationId: string,
  awsAccountId: string,
  timing: LeaseTiming = {}
): Promise<LeaseSession | null> {
  const lease = await acquireScanLease(
    client,
    { organizationId, awsAccountId, scanKind: SCAN_KIND_DISCOVERY },
    leaseHolder(),
    { lockTimeoutMs: timing.acquireLockTimeoutMs ?? SCAN_ACQUIRE_LOCK_TIMEOUT_MS, ttlSeconds: timing.ttlSeconds }
  );
  return lease ? new LeaseSession(pool, lease, timing) : null;
}

/** Acquires the cron's job lease for the organization (unless held, or completed within the guard) and starts its heartbeat. */
export async function openDiscoveryJobSession(
  pool: Pool,
  client: PoolClient,
  organizationId: string,
  timing: LeaseTiming = {}
): Promise<LeaseSession | null> {
  const lease = await acquireJobLease(client, { organizationId, jobName: DISCOVERY_JOB_NAME }, leaseHolder(), {
    ttlSeconds: timing.ttlSeconds,
    lockTimeoutMs: timing.acquireLockTimeoutMs ?? SCAN_ACQUIRE_LOCK_TIMEOUT_MS,
    minSecondsSinceCompletion: DISCOVERY_JOB_MIN_SECONDS_SINCE_COMPLETION,
  });
  return lease ? new LeaseSession(pool, lease, timing) : null;
}

/**
 * Waits for the organization's scan lease (cost Analyze, §4.6): tries to acquire
 * it every pollMs until it is free, up to capMs, then throws ScanBusyError.
 * Every attempt is a database acquisition, so it waits for a scan running in any
 * process or on any host.
 */
export async function waitForScanSession(
  pool: Pool,
  organizationId: string,
  awsAccountId: string,
  timing: LeaseTiming = {}
): Promise<LeaseSession> {
  const pollMs = timing.pollMs ?? SCAN_WAIT_POLL_MS;
  const capMs = timing.capMs ?? SCAN_WAIT_CAP_MS;
  const sleep = timing.sleep ?? realSleep;
  const started = Date.now();
  for (;;) {
    const session = await onTaggedConnection(pool, organizationId, (client) =>
      openScanSession(pool, client, organizationId, awsAccountId, timing)
    );
    if (session) return session;
    if (Date.now() - started + pollMs > capMs) throw new ScanBusyError(organizationId);
    await sleep(pollMs);
  }
}

/** The state of the organization's scan lease, read on a tagged connection. */
export async function scanLeaseState(pool: Pool, organizationId: string, awsAccountId: string) {
  return onTaggedConnection(pool, organizationId, (client) =>
    readScanLeaseState(client, { organizationId, awsAccountId, scanKind: SCAN_KIND_DISCOVERY })
  );
}

export { realSleep as sleep };
