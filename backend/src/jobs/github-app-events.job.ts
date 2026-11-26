import cron from 'node-cron';
import { GitHubAppConfigResult, readGitHubAppConfig } from '../config/github-app';
import { DEMO_EXCLUSION_SQL } from '../demo/demo-workspace';
import { ConnectionSource, defaultSource } from '../services/github-app/db';
import { EventProcessor, failureReason } from '../services/github-app/process';
import { emptyRetryCounts, expireOrganization, ExpiryCounts, retryOrganization, RetryCounts } from '../services/github-app/retry';

/**
 * GitHub App events job (D8a-3, founder rulings of 2026-11-25,
 * d8a3-stage-a.md Addendum 1).
 *
 *  retry    hourly. Re-processes the organization's stored deployment events
 *           that the retry selection picks (services/github-app/retry.ts):
 *           transient failures (5 attempts, backoff 1/2/4/8 h), events stored
 *           but never processed (after 15 minutes), and held events of a
 *           reconnected installation that its claim did not reach. Never
 *           'over_limit', never a hold whose installation is still not
 *           claimed, never anything outside the 168-hour window.
 *  cleanup  daily at 03:30 UTC. Marks claim holds, and never-processed
 *           deployment events (released by a claim or stored live), past the
 *           window 'ignored' / hold_expired.
 *
 * Feature flag (rulings 1-2, and Q13 for the cleanup): **the retry does
 * nothing while the GitHub App is not configured (GITHUB_APP_ENABLED off,
 * or a value missing).** It logs that it skipped, and touches no table. **The
 * cleanup runs whether or not the flag is on**, because retention is a promise
 * about stored data, not a live feature. It only marks rows: it writes no
 * deployment row and changes no count or list a customer sees (held counts
 * already leave out everything past the window).
 *
 * Deletes nothing (ruling 1): no event purge, no held-delivery purge
 * (github_purge_held_deliveries stays uncalled), no install-state sweep.
 *
 * Safe to run twice at once, and to interrupt (ruling 9):
 *  - each kind of run holds its own session advisory try-lock on a dedicated
 *    connection for the whole run. A second runner (another process, a
 *    deploy restart) skips. A dead process's lock ends with its connection;
 *  - an in-process flag stops a run overlapping itself;
 *  - every event is its own transaction and every expiry statement its own
 *    statement. A run cut short leaves each row either done or untouched,
 *    and the next run's selection starts again from the stored state.
 *
 * Bounded (per run): at most RETRY_PER_ORG events per organization,
 * RETRY_PER_RUN in all, and RUN_BUDGET_MS of time. Organizations are taken
 * round robin: each run starts after the last organization the previous run
 * finished, so one organization's backlog can't starve the others.
 *
 * Logs counts and codes only (organization and event ids, status codes);
 * never facts, payloads, configuration values or secrets. The job reads no
 * secret and makes no GitHub call.
 */

export const RETRY_CRON = '0 * * * *';
export const CLEANUP_CRON = '30 3 * * *';
export const EVENTS_JOB_TIMEZONE = 'Etc/UTC';
export const RETRY_LOCK_KEY = 'github_app_events_retry';
export const CLEANUP_LOCK_KEY = 'github_app_events_cleanup';
export const RETRY_PER_ORG = 50;
export const RETRY_PER_RUN = 1000;
export const RUN_BUDGET_MS = 10 * 60_000;

const PREFIX = '[github-app-events]';

export interface EventsJobDeps {
  source: ConnectionSource;
  readConfig: () => GitHubAppConfigResult;
  /** The organizations to visit, in a stable order. */
  listOrganizations: (source: ConnectionSource) => Promise<string[]>;
  log: (line: string) => void;
  perOrg: number;
  perRun: number;
  budgetMs: number;
  now: () => number;
  processor?: EventProcessor;
}

/** Every organization but the demo workspace, read untagged (ids only; organizations is not tenant-gated). */
export async function listOrganizationIds(source: ConnectionSource): Promise<string[]> {
  const client = await source.connect();
  try {
    const { rows } = await client.query<{ id: string }>(`SELECT o.id::text AS id FROM organizations o WHERE ${DEMO_EXCLUSION_SQL} ORDER BY o.id`);
    return rows.map((r) => r.id);
  } finally {
    client.release();
  }
}

export type RunResult<T> = { ran: true; summary: T } | { ran: false; reason: 'feature_off' | 'already_running' | 'lock_held' };

export interface RetryRunSummary extends RetryCounts {
  organizations: number;
  errors: number;
  stoppedEarly: boolean;
}

export interface CleanupRunSummary extends ExpiryCounts {
  organizations: number;
  errors: number;
  stoppedEarly: boolean;
}

export class GitHubAppEventsJob {
  private retryTask: ReturnType<typeof cron.schedule> | null = null;
  private cleanupTask: ReturnType<typeof cron.schedule> | null = null;
  private running = { retry: false, cleanup: false };
  /** The last organization a retry run finished; the next run starts after it. */
  private retryCursor: string | null = null;
  private readonly deps: EventsJobDeps;

  constructor(deps: Partial<EventsJobDeps> = {}) {
    this.deps = {
      source: defaultSource,
      readConfig: () => readGitHubAppConfig(),
      listOrganizations: listOrganizationIds,
      log: (line) => console.log(line),
      perOrg: RETRY_PER_ORG,
      perRun: RETRY_PER_RUN,
      budgetMs: RUN_BUDGET_MS,
      now: () => Date.now(),
      ...deps,
    };
  }

  start(): void {
    if (this.retryTask || this.cleanupTask) {
      this.deps.log(`${PREFIX} already started`);
      return;
    }
    this.retryTask = cron.schedule(RETRY_CRON, () => this.scheduled('retry', () => this.runRetry()), { timezone: EVENTS_JOB_TIMEZONE });
    this.cleanupTask = cron.schedule(CLEANUP_CRON, () => this.scheduled('cleanup', () => this.runCleanup()), { timezone: EVENTS_JOB_TIMEZONE });
    this.deps.log(`${PREFIX} started: retry hourly, cleanup daily at 03:30 UTC`);
  }

  stop(): void {
    this.retryTask?.stop();
    this.cleanupTask?.stop();
    this.retryTask = null;
    this.cleanupTask = null;
  }

  private async scheduled(kind: 'retry' | 'cleanup', run: () => Promise<unknown>): Promise<void> {
    try {
      await run();
    } catch (error) {
      this.deps.log(`${PREFIX} ${kind} error code=${codeOf(error)}`);
    }
  }

  /** One retry run. Does nothing (and touches no table) while the GitHub App is not configured. */
  async runRetry(): Promise<RunResult<RetryRunSummary>> {
    if (!this.deps.readConfig().enabled) {
      this.deps.log(`${PREFIX} retry skipped reason=feature_off`);
      return { ran: false, reason: 'feature_off' };
    }
    return this.exclusive('retry', RETRY_LOCK_KEY, async () => {
      const started = this.deps.now();
      const summary: RetryRunSummary = { ...emptyRetryCounts(), organizations: 0, errors: 0, stoppedEarly: false };
      const keepGoing = () => summary.considered < this.deps.perRun && this.deps.now() - started < this.deps.budgetMs;
      for (const organizationId of rotateAfter(await this.deps.listOrganizations(this.deps.source), this.retryCursor)) {
        if (!keepGoing()) {
          summary.stoppedEarly = true;
          break;
        }
        let cutShort = false;
        try {
          const counts = await retryOrganization(this.deps.source, organizationId, {
            limit: Math.min(this.deps.perOrg, this.deps.perRun - summary.considered),
            keepGoing,
            processor: this.deps.processor,
            log: this.deps.log,
          });
          addCounts(summary, counts);
          cutShort = counts.cutShort;
          if (counts.considered > 0) {
            this.deps.log(`${PREFIX} retry org=${organizationId} ${formatCounts(counts)}`);
          }
        } catch (error) {
          summary.errors += 1;
          this.deps.log(`${PREFIX} retry org=${organizationId} error code=${codeOf(error)}`);
        }
        summary.organizations += 1;
        // Only an organization this run finished moves the cursor: one cut short by the budget is first next time.
        if (cutShort) {
          summary.stoppedEarly = true;
          break;
        }
        this.retryCursor = organizationId;
      }
      this.deps.log(`${PREFIX} retry done organizations=${summary.organizations} ${formatCounts(summary)} errors=${summary.errors}`
        + ` stopped_early=${summary.stoppedEarly} ms=${this.deps.now() - started}`);
      return summary;
    });
  }

  /** One cleanup run: marks expired holds. Runs whether or not the flag is on (Q13); only marks, never deletes. */
  async runCleanup(): Promise<RunResult<CleanupRunSummary>> {
    return this.exclusive('cleanup', CLEANUP_LOCK_KEY, async () => {
      const started = this.deps.now();
      const summary: CleanupRunSummary = { claimHolds: 0, unprocessed: 0, organizations: 0, errors: 0, stoppedEarly: false };
      for (const organizationId of await this.deps.listOrganizations(this.deps.source)) {
        if (this.deps.now() - started >= this.deps.budgetMs) {
          summary.stoppedEarly = true;
          break;
        }
        try {
          const counts = await expireOrganization(this.deps.source, organizationId);
          summary.claimHolds += counts.claimHolds;
          summary.unprocessed += counts.unprocessed;
          if (counts.claimHolds + counts.unprocessed > 0) {
            this.deps.log(`${PREFIX} cleanup org=${organizationId} expired_claim_holds=${counts.claimHolds} expired_unprocessed=${counts.unprocessed}`);
          }
        } catch (error) {
          summary.errors += 1;
          this.deps.log(`${PREFIX} cleanup org=${organizationId} error code=${codeOf(error)}`);
        }
        summary.organizations += 1;
      }
      this.deps.log(`${PREFIX} cleanup done organizations=${summary.organizations} expired_claim_holds=${summary.claimHolds}`
        + ` expired_unprocessed=${summary.unprocessed} errors=${summary.errors} stopped_early=${summary.stoppedEarly} ms=${this.deps.now() - started}`);
      return summary;
    });
  }

  /**
   * Runs `fn` while holding the run's session advisory lock on a dedicated
   * connection; skips if this process is already running it or another
   * session holds the lock. The lock is always released before the
   * connection goes back to the pool; if the unlock fails, the connection is
   * destroyed instead, so no pooled connection keeps the lock.
   */
  private async exclusive<T>(kind: 'retry' | 'cleanup', key: string, fn: () => Promise<T>): Promise<RunResult<T>> {
    if (this.running[kind]) {
      this.deps.log(`${PREFIX} ${kind} skipped reason=already_running`);
      return { ran: false, reason: 'already_running' };
    }
    this.running[kind] = true;
    try {
      const client = await this.deps.source.connect();
      let broken: Error | undefined;
      try {
        const { rows } = await client.query<{ locked: boolean }>('SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked', [key]);
        if (rows[0]?.locked !== true) {
          this.deps.log(`${PREFIX} ${kind} skipped reason=lock_held`);
          return { ran: false, reason: 'lock_held' };
        }
        try {
          return { ran: true, summary: await fn() };
        } finally {
          await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [key]).catch((error: unknown) => {
            broken = error instanceof Error ? error : new Error('advisory unlock failed');
          });
        }
      } finally {
        client.release(broken);
      }
    } finally {
      this.running[kind] = false;
    }
  }
}

/** The ids after `cursor` first, then the rest: each run starts where the last one stopped. */
export function rotateAfter(ids: string[], cursor: string | null): string[] {
  if (cursor === null) return ids;
  const start = ids.findIndex((id) => id > cursor);
  return start <= 0 ? ids : [...ids.slice(start), ...ids.slice(0, start)];
}

function addCounts(into: RetryCounts, from: RetryCounts): void {
  into.considered += from.considered;
  into.recorded += from.recorded;
  into.settled += from.settled;
  into.failed += from.failed;
  into.gaveUp += from.gaveUp;
  into.skipped += from.skipped;
}

function formatCounts(c: RetryCounts): string {
  return `considered=${c.considered} recorded=${c.recorded} settled=${c.settled} failed=${c.failed} gave_up=${c.gaveUp} skipped=${c.skipped}`;
}

/** A SQLSTATE-style code for a log line; never an error message. */
function codeOf(error: unknown): string {
  return failureReason(error);
}
