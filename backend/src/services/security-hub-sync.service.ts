/**
 * Orchestrates a manual Security Hub sync for one org: capability probe -> enabled
 * standards discovery -> paginated ACTIVE-finding ingestion -> persisted result.
 *
 * Manual sync only (v1, approved decision) -- no scheduler/cron here. In-flight
 * deduplication ensures a user double-clicking "Sync" (or two browser tabs) shares one
 * running sync instead of firing two concurrent AssumeRole+GetFindings sequences for
 * the same org, mirroring the in-flight-promise pattern already used by
 * cloudwatch.service.ts/aws-cost.service.ts (without adopting their 45s cache TTL,
 * which doesn't apply here -- there is no read-path caching in this service; each
 * GET reads the last persisted sync result from the repository/DB directly).
 *
 * One createClients() call per sync job, reused for every page and for the standards
 * discovery call -- no repeated AssumeRole calls per page (that inefficiency exists
 * elsewhere in AWSClientFactory's callers but is not introduced here).
 */
import { AWSClientFactory } from './aws-client-factory.service';
import { pool } from '../config/database';
import {
  CONNECTION_CHANGED,
  connectionIdentityOfClients,
  currentConnectionIdentity,
  isConnectionChanged,
} from './aws-connection-fence';
import { SecurityHubClientService } from './security-hub-client.service';
import { SecurityHubStateRepository } from '../repositories/security-hub-state.repository';
import { SecurityHubFindingsRepository } from '../repositories/security-hub-findings.repository';
import { SecurityHubCapabilityResult, SecurityHubSyncStatus } from '../types/security-hub-foundation.types';

export interface SecurityHubSyncOutcome {
  capability: SecurityHubCapabilityResult;
  syncStatus: SecurityHubSyncStatus;
  pagesProcessed: number;
  findingsCount: number;
  error: string | null;
  /**
   * True when the organization's AWS connection changed while this sync ran (AWS
   * connect PR B): it stopped, and nothing more was written, not even the sync
   * result (the stored state belongs to the current connection).
   */
  connectionChanged?: boolean;
}

/** The answer of a sync stopped by a connection change; `error` is a fixed code, never free text. */
function connectionChangedOutcome(pagesProcessed: number, findingsCount: number): SecurityHubSyncOutcome {
  return {
    capability: { status: 'ERROR', checkedAt: new Date().toISOString(), error: 'CONNECTION_CHANGED' },
    syncStatus: 'FAILED',
    pagesProcessed,
    findingsCount,
    error: 'CONNECTION_CHANGED',
    connectionChanged: true,
  };
}

/**
 * In-flight syncs, keyed by organization AND connection identity (prB-plan.md D6:
 * one rule for every cache and in-flight entry): a request after a connection
 * change never joins the old connection's sync.
 */
const inFlightSyncs = new Map<string, Promise<SecurityHubSyncOutcome>>();

function inFlightKey(organizationId: string, identity: string | null): string {
  return JSON.stringify([organizationId, identity]);
}

export class SecurityHubSyncService {
  private stateRepo = new SecurityHubStateRepository();
  private findingsRepo = new SecurityHubFindingsRepository();

  async sync(organizationId: string): Promise<SecurityHubSyncOutcome> {
    // The connection this sync belongs to, read before the in-flight lookup. A failed
    // read (including more than one eligible account) writes nothing: no state can be
    // shown to belong to any one connection.
    let identity: string | null;
    try {
      identity = await currentConnectionIdentity(pool, organizationId);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      console.error(`[SecurityHubSync] sync.error org=${organizationId} reason=connection_unreadable`, message);
      return {
        capability: { status: 'ERROR', checkedAt: new Date().toISOString(), error: message },
        syncStatus: 'FAILED',
        pagesProcessed: 0,
        findingsCount: 0,
        error: message,
      };
    }

    const key = inFlightKey(organizationId, identity);
    const existing = inFlightSyncs.get(key);
    if (existing) {
      console.log(`[SecurityHubSync] Reusing in-flight sync for org ${organizationId}`);
      return existing;
    }

    const promise = this.runSync(organizationId, identity)
      .catch((err: unknown) => {
        // A fenced write found the connection changed: stop, writing nothing more.
        if (!isConnectionChanged(err)) throw err;
        console.warn(`[SecurityHubSync] ${CONNECTION_CHANGED} org=${organizationId}; stopped, nothing more written`);
        return connectionChangedOutcome(0, 0);
      })
      .finally(() => {
        inFlightSyncs.delete(key);
      });
    inFlightSyncs.set(key, promise);
    return promise;
  }

  /**
   * Every write is fenced on `identity` (aws-connection-fence.ts): the state writes
   * and each page's upsert commit only while it is still the active connection. A
   * change throws ConnectionChangedError out of a write; sync() answers it.
   */
  private async runSync(organizationId: string, identity: string | null): Promise<SecurityHubSyncOutcome> {
    const startedAt = Date.now();
    console.log(`[SecurityHubSync] sync.start org=${organizationId}`);
    await this.stateRepo.markSyncStarted(organizationId, identity);

    let clients;
    try {
      clients = await AWSClientFactory.createClients(organizationId);
    } catch (err: unknown) {
      // No connected AWS account at all -- not a Security Hub-specific error, but must
      // still resolve to an explicit capability state rather than throwing to the caller.
      const message = err instanceof Error ? err.message : String(err);
      const capability: SecurityHubCapabilityResult = {
        status: 'ERROR',
        checkedAt: new Date().toISOString(),
        error: message,
      };
      await this.stateRepo.recordSyncResult(organizationId, identity, {
        capability,
        enabledStandards: [],
        syncStatus: 'FAILED',
        syncError: message,
        pagesProcessed: 0,
        findingsCount: 0,
      });
      console.error(`[SecurityHubSync] sync.error org=${organizationId} reason=no_aws_client`, message);
      return { capability, syncStatus: 'FAILED', pagesProcessed: 0, findingsCount: 0, error: message };
    }

    // The clients must come from the connection this sync started with; otherwise
    // nothing they fetch is written.
    if (connectionIdentityOfClients(clients) !== identity) {
      console.warn(`[SecurityHubSync] ${CONNECTION_CHANGED} org=${organizationId} before any call; nothing written`);
      return connectionChangedOutcome(0, 0);
    }

    const capability = await SecurityHubClientService.checkCapability(clients.securityHub);
    console.log(`[SecurityHubSync] capability.checked org=${organizationId} status=${capability.status}`);

    if (capability.status !== 'ENABLED') {
      // NOT_GRANTED / NOT_AVAILABLE / ERROR -- never attempt findings ingestion, and
      // never represent this as a failed sync of a working integration: it's the
      // capability state itself that the caller (evaluator/UI) must surface.
      await this.stateRepo.recordSyncResult(organizationId, identity, {
        capability,
        enabledStandards: [],
        syncStatus: capability.status === 'ERROR' ? 'FAILED' : 'COMPLETED',
        syncError: capability.error,
        pagesProcessed: 0,
        findingsCount: 0,
      });
      return {
        capability,
        syncStatus: capability.status === 'ERROR' ? 'FAILED' : 'COMPLETED',
        pagesProcessed: 0,
        findingsCount: 0,
        error: capability.error,
      };
    }

    let enabledStandards;
    try {
      enabledStandards = await SecurityHubClientService.getEnabledStandards(clients.securityHub);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      await this.stateRepo.recordSyncResult(organizationId, identity, {
        capability,
        enabledStandards: [],
        syncStatus: 'FAILED',
        syncError: message,
        pagesProcessed: 0,
        findingsCount: 0,
      });
      console.error(`[SecurityHubSync] sync.error org=${organizationId} reason=standards_discovery_failed`, message);
      return { capability, syncStatus: 'FAILED', pagesProcessed: 0, findingsCount: 0, error: message };
    }

    // Paginated ingestion: each page is persisted (upserted) as soon as it's fetched, so
    // a failure on page N never discards pages 1..N-1 -- see repository/migration
    // comments for why upsert-only ingestion makes this safe.
    let pagesProcessed = 0;
    let findingsCount = 0;
    let syncStatus: SecurityHubSyncStatus = 'COMPLETED';
    let syncError: string | null = null;

    try {
      for await (const page of SecurityHubClientService.getActiveFindingsPaged(clients.securityHub)) {
        await this.findingsRepo.upsertFindings(organizationId, page.findings, identity);
        pagesProcessed += 1;
        findingsCount += page.findings.length;
        console.log(
          `[SecurityHubSync] page.processed org=${organizationId} page=${page.pageIndex} findings=${page.findings.length}`
        );
      }
    } catch (err: unknown) {
      // The connection changed mid-ingestion: pages already written belonged to the
      // connection that was active when they committed; nothing more is written, and
      // the sync result is not recorded over the current connection's state.
      if (isConnectionChanged(err)) {
        console.warn(`[SecurityHubSync] ${CONNECTION_CHANGED} org=${organizationId} pagesProcessed=${pagesProcessed}; stopped`);
        return connectionChangedOutcome(pagesProcessed, findingsCount);
      }
      // Partial failure: pages already processed remain persisted and fresh (their
      // last_seen_at was already updated). This sync is marked PARTIAL, not COMPLETED --
      // callers must not treat a PARTIAL sync's absence-of-findings-for-a-control as
      // proof that control has no findings; see security-hub-compliance.service.ts.
      syncStatus = 'PARTIAL';
      syncError = err instanceof Error ? err.message : String(err);
      console.error(
        `[SecurityHubSync] sync.partial_failure org=${organizationId} pagesProcessed=${pagesProcessed}`,
        syncError
      );
    }

    await this.stateRepo.recordSyncResult(organizationId, identity, {
      capability,
      enabledStandards,
      syncStatus,
      syncError,
      pagesProcessed,
      findingsCount,
    });

    console.log(
      `[SecurityHubSync] sync.end org=${organizationId} status=${syncStatus} pages=${pagesProcessed} findings=${findingsCount} durationMs=${Date.now() - startedAt}`
    );

    return { capability, syncStatus, pagesProcessed, findingsCount, error: syncError };
  }
}
