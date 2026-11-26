/**
 * D8a-3: the scheduled retry and the scheduled expiry, one organization at a
 * time (the job, jobs/github-app-events.job.ts, walks the organizations).
 *
 * Retry (S1, founder rulings 3-5b): the organization's events that
 * retryEligibleSql picks (pipeline-events.repository.ts: replayEligibleSql
 * narrowed), at most `limit` per call, oldest first. Each runs through the
 * same processing as a live delivery, in its own transaction, behind a guard
 * that first:
 *
 *   1 bounds the transaction: lock_timeout and statement_timeout (SET LOCAL);
 *   2 takes the organization's quota lock (record.ts QUOTA_LOCK_SQL);
 *   3 locks the event row FOR UPDATE and re-checks its state and eligibility.
 *
 * Lock order is quota -> event row -> claim (FOR KEY SHARE). The live,
 * replay and claim paths take claim -> quota -> event row, and the paths
 * that update an event row without the quota lock take nothing after it.
 * The disconnect takes only the claim (FOR UPDATE). So no path can wait on
 * the retry while holding something the retry waits for: no deadlock.
 *
 * One deployment row per GitHub job or deployment is the database's rule
 * (deployments_github_job_uidx / deployments_github_deployment_uidx and
 * ON CONFLICT DO NOTHING, record.ts), not this file's.
 *
 * Expiry (S2, rulings 1 and 6): claim holds past the window, and released,
 * never-processed deployment candidates past the window, are marked
 * 'ignored' / hold_expired. Nothing is deleted.
 *
 * Logs codes and counts only: never facts, payloads or configuration.
 */
import { PoolClient } from 'pg';
import {
  EXPIRE_BATCH,
  expireStaleClaimHolds,
  expireStaleReleasedEvents,
  findRetryableEvents,
  lockRetryCandidate,
  MAX_PROCESSING_ATTEMPTS,
  RetryCandidate,
} from '../../repositories/pipeline-events.repository';
import { ConnectionSource, withOrgClient } from './db';
import { isTransientFailure } from './failure-class';
import { EventProcessor, processEvent, processRetryCandidate, SKIPPED } from './process';
import { QUOTA_LOCK_SQL } from './record';

/** The guard's own bounds: a retry never waits long on a lock or a statement. */
export const RETRY_LOCK_TIMEOUT = '5s';
export const RETRY_STATEMENT_TIMEOUT = '30s';

export interface RetryCounts {
  /** Events picked. */
  considered: number;
  /** Processed and now linked to a newly written deployment row. */
  recorded: number;
  /** Ended in another final status (already recorded, ignored, unmapped, over the limit, held again). */
  settled: number;
  /** Failed again; still retryable later. */
  failed: number;
  /** Failed and never retried again (a permanent code, or the last attempt). */
  gaveUp: number;
  /** The guard said no (processed, held or expired meanwhile) or couldn't take its locks. */
  skipped: number;
}

export const emptyRetryCounts = (): RetryCounts => ({ considered: 0, recorded: 0, settled: 0, failed: 0, gaveUp: 0, skipped: 0 });

function guardFor(organizationId: string, candidate: RetryCandidate) {
  return async (client: PoolClient): Promise<boolean> => {
    await client.query(`SET LOCAL lock_timeout = '${RETRY_LOCK_TIMEOUT}'`);
    await client.query(`SET LOCAL statement_timeout = '${RETRY_STATEMENT_TIMEOUT}'`);
    await client.query(QUOTA_LOCK_SQL, [organizationId]);
    return lockRetryCandidate(client, organizationId, candidate);
  };
}

export interface RetryOptions {
  limit: number;
  /** Checked before each event: false stops the call early (the job's time budget). */
  keepGoing?: () => boolean;
  processor?: EventProcessor;
  log?: (line: string) => void;
}

/** One organization's retry: its counts, and whether keepGoing stopped it before its picked events were done. */
export interface OrganizationRetry extends RetryCounts {
  cutShort: boolean;
}

export async function retryOrganization(source: ConnectionSource, organizationId: string, options: RetryOptions): Promise<OrganizationRetry> {
  const log = options.log ?? ((line: string) => console.log(line));
  const counts: OrganizationRetry = { ...emptyRetryCounts(), cutShort: false };
  const candidates = await withOrgClient(source, organizationId, (client) => findRetryableEvents(client, organizationId, options.limit));
  for (const candidate of candidates) {
    if (options.keepGoing && !options.keepGoing()) {
      counts.cutShort = true;
      break;
    }
    counts.considered += 1;
    const outcome = await processRetryCandidate(source, organizationId, candidate, guardFor(organizationId, candidate),
      options.processor ?? processEvent);
    if (outcome === SKIPPED) {
      counts.skipped += 1;
    } else if (outcome.status === 'failed') {
      // processing counted this attempt: the candidate's attempts + 1.
      // A committed attempt (deployment_id set) is retried within the window whatever its count (retryEligibleSql).
      const lastAttempt = !candidate.committed && candidate.processingAttempts + 1 >= MAX_PROCESSING_ATTEMPTS;
      if ((!candidate.committed && !isTransientFailure(outcome.reason)) || lastAttempt) {
        counts.gaveUp += 1;
        // Ruling 8: a terminal failure is logged internally (a permanent code is logged by process.ts too).
        log(`[github-app-events] retry gave_up org=${organizationId} event=${candidate.id} reason=${outcome.reason} attempts=${candidate.processingAttempts + 1}`);
      } else {
        counts.failed += 1;
      }
    } else if (outcome.status === 'processed' && outcome.reason === null) {
      counts.recorded += 1;
    } else {
      counts.settled += 1;
    }
  }
  return counts;
}

export interface ExpiryCounts {
  claimHolds: number;
  released: number;
}

/** Expiry statements per kind per organization per run (each marks at most EXPIRE_BATCH rows). */
export const EXPIRE_ROUNDS = 4;

/** Marks this organization's expired holds, at most EXPIRE_ROUNDS x EXPIRE_BATCH rows of each kind. */
export async function expireOrganization(source: ConnectionSource, organizationId: string, batch = EXPIRE_BATCH): Promise<ExpiryCounts> {
  return withOrgClient(source, organizationId, async (client) => {
    const counts: ExpiryCounts = { claimHolds: 0, released: 0 };
    for (let round = 0; round < EXPIRE_ROUNDS; round += 1) {
      const n = await expireStaleClaimHolds(client, organizationId, batch);
      counts.claimHolds += n;
      if (n < batch) break;
    }
    for (let round = 0; round < EXPIRE_ROUNDS; round += 1) {
      const n = await expireStaleReleasedEvents(client, organizationId, batch);
      counts.released += n;
      if (n < batch) break;
    }
    return counts;
  });
}
