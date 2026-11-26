/**
 * Downstream processing of a stored GitHub App event: repository rows,
 * installation lifecycle (D8a-1) and, for workflow_job and deployment_status,
 * deploy detection and the deployment row (D8a-2: detect.ts, record.ts).
 *
 * Runs only after the event row is committed. A failure marks the event
 * 'failed' with a reason code and never deletes it.
 */
import { PoolClient } from 'pg';
import { EventToProcess, holdUntilClaimed, NOT_CLAIMED_REASON, ProcessingStatus, setProcessingOutcome } from '../../repositories/pipeline-events.repository';
import { findRepositoryForEvent, markRepositoryRemoved, upsertRepository } from '../../repositories/pipeline-repositories.repository';
import { applyInstallationLifecycle, lockOwnClaim } from '../../repositories/github-installations.repository';
import { ConnectionSource, withOrgClient, withOrgTransaction } from './db';
import { permissionsStateOf } from './permissions';
import { detectDeployment } from './detect';
import { recordDeployment } from './record';
import { isTransientFailure } from './failure-class';

interface ProcessingOutcome {
  status: ProcessingStatus;
  reason: string | null;
}

/** The processing step, injectable so tests can make it fail. */
export type EventProcessor = (client: PoolClient, organizationId: string, event: EventToProcess) => Promise<ProcessingOutcome>;

export const processEvent: EventProcessor = async (client, organizationId, ev) => {
  const at = (ev.occurredAt ?? ev.receivedAt).toISOString();
  const installationId = Number(ev.installationId);
  const facts = ev.facts;

  switch (facts.kind) {
    case 'installation': {
      if (ev.action === 'deleted') {
        await applyInstallationLifecycle(client, organizationId, installationId, { kind: 'deleted', at });
      } else if (ev.action === 'suspend') {
        await applyInstallationLifecycle(client, organizationId, installationId, { kind: 'suspend', at });
      } else if (ev.action === 'unsuspend') {
        await applyInstallationLifecycle(client, organizationId, installationId, { kind: 'unsuspend' });
      } else {
        // created / new_permissions_accepted: the payload's own installation details.
        await applyInstallationLifecycle(client, organizationId, installationId, {
          kind: 'details',
          accountLogin: facts.account?.login ?? null,
          repositorySelection: facts.repository_selection,
          permissions: facts.permissions,
          events: facts.events,
          permissionsState: permissionsStateOf(facts.permissions),
        });
        for (const repo of facts.repositories) {
          await upsertRepository(client, organizationId, { githubRepoId: repo.id, installationId, fullName: repo.full_name, defaultBranch: null, at });
        }
      }
      return { status: 'processed', reason: null };
    }
    case 'installation_repositories': {
      for (const repo of facts.added) {
        await upsertRepository(client, organizationId, { githubRepoId: repo.id, installationId, fullName: repo.full_name, defaultBranch: null, at });
      }
      for (const repo of facts.removed) {
        await markRepositoryRemoved(client, organizationId, repo.id, at);
      }
      return { status: 'processed', reason: null };
    }
    default: {
      if (facts.repository) {
        await upsertRepository(client, organizationId, {
          githubRepoId: facts.repository.id,
          installationId,
          fullName: facts.repository.full_name,
          defaultBranch: facts.repository.default_branch,
          at,
        });
      }
      if (facts.kind === 'workflow_job' || facts.kind === 'deployment_status') {
        const repository = facts.repository ? await findRepositoryForEvent(client, organizationId, facts.repository.id) : null;
        const detection = detectDeployment({
          facts,
          repository,
          receivedAt: ev.receivedAt,
          legacyWebhookOrganization: isLegacyWebhookOrganization(organizationId),
        });
        if (detection.kind === 'skip') return { status: detection.status, reason: detection.reason };
        const recorded = await recordDeployment(client, organizationId, ev.id, facts, detection.candidate);
        return { status: recorded.status, reason: recorded.reason };
      }
      return { status: 'processed', reason: null };
    }
  }
};

/**
 * Ruling Q12: while the legacy repository webhook is configured
 * (GITHUB_WEBHOOK_ORG_ID set, read at call time), the App path writes no
 * deployment row for that organization; its events are kept as
 * ignored / legacy_webhook_org. Keyed on the organization id alone, so a
 * half-configured legacy webhook still blocks. D8c unsets the variable.
 */
export function isLegacyWebhookOrganization(organizationId: string): boolean {
  const legacy = (process.env.GITHUB_WEBHOOK_ORG_ID ?? '').trim().toLowerCase();
  return legacy !== '' && legacy === organizationId.toLowerCase();
}

/** Postgres SQLSTATE as a reason code, or a generic code. Never an error message. */
export function failureReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? `db_${code.toLowerCase()}` : 'processing_error';
}

/**
 * Processes one stored event in its own transaction and records the outcome.
 * On failure the processing transaction rolls back and the event is marked
 * 'failed' on a fresh statement; the event row itself always stays.
 *
 * First the organization's claim on the event's installation is locked
 * (D8b-1 fix S-1). Gone (disconnected after the event was stored): the event
 * is held, pending / installation_not_claimed, for this organization's next
 * claim, and nothing else runs. Held, it can never fail on the repository's
 * foreign key to the claim.
 */
export async function processStoredEvent(
  source: ConnectionSource,
  organizationId: string,
  event: EventToProcess,
  processor: EventProcessor = processEvent
): Promise<ProcessingOutcome> {
  return (await runProcessing(source, organizationId, event, processor, null)) as ProcessingOutcome;
}

/**
 * The scheduled retry's guard (D8a-3 ruling 4): runs first inside the
 * processing transaction. True: process. False: the event is no longer what
 * the retry picked; nothing is written. It takes its locks before the claim
 * lock, so it must take them in an order the other paths can't reverse
 * (retry.ts).
 */
export type ProcessingGuard = (client: PoolClient) => Promise<boolean>;

/** The guard said no, or the guard itself failed: nothing was written. */
export const SKIPPED = 'skipped' as const;

/**
 * processStoredEvent for the scheduled retry: the same processing, after the
 * guard. A guard that fails (a lock or statement timeout, say) skips the
 * event without marking it 'failed': another transaction may be finishing
 * it, and a 'failed' stamped over that would be wrong.
 */
export async function processRetryCandidate(
  source: ConnectionSource,
  organizationId: string,
  event: EventToProcess,
  guard: ProcessingGuard,
  processor: EventProcessor = processEvent
): Promise<ProcessingOutcome | typeof SKIPPED> {
  return runProcessing(source, organizationId, event, processor, guard);
}

class GuardFailure extends Error {
  constructor() {
    super('processing guard failed');
  }
}

async function runProcessing(
  source: ConnectionSource,
  organizationId: string,
  event: EventToProcess,
  processor: EventProcessor,
  guard: ProcessingGuard | null
): Promise<ProcessingOutcome | typeof SKIPPED> {
  try {
    return await withOrgTransaction(source, organizationId, async (client) => {
      if (guard) {
        let eligible: boolean;
        try {
          eligible = await guard(client);
        } catch {
          throw new GuardFailure();
        }
        if (!eligible) return SKIPPED;
      }
      if (!(await lockOwnClaim(client, organizationId, Number(event.installationId)))) {
        await holdUntilClaimed(client, organizationId, event.id);
        return { status: 'pending', reason: NOT_CLAIMED_REASON };
      }
      const outcome = await processor(client, organizationId, event);
      await setProcessingOutcome(client, organizationId, event.id, outcome.status, outcome.reason);
      return outcome;
    });
  } catch (error) {
    if (error instanceof GuardFailure) return SKIPPED;
    const outcome: ProcessingOutcome = { status: 'failed', reason: failureReason(error) };
    await withOrgClient(source, organizationId, (client) =>
      setProcessingOutcome(client, organizationId, event.id, outcome.status, outcome.reason)
    ).catch(() => undefined);
    // Ruling 8: a failure the scheduled retry will never try again is logged (codes only, never a message).
    if (!isTransientFailure(outcome.reason)) {
      console.log(`[github-app] processing failed event=${event.id} reason=${outcome.reason} retry=no`);
    }
    return outcome;
  }
}
