/**
 * Downstream processing of a stored GitHub App event (D8a-1): repository rows
 * and installation lifecycle only. No deployment is recorded here; D8a-2
 * consumes workflow_job and deployment_status events, which are left
 * 'pending' with reason deploy_detection_pending.
 *
 * Runs only after the event row is committed. A failure marks the event
 * 'failed' with a reason code and never deletes it.
 */
import { PoolClient } from 'pg';
import { EventToProcess, ProcessingStatus, setProcessingOutcome } from '../../repositories/pipeline-events.repository';
import { markRepositoryRemoved, upsertRepository } from '../../repositories/pipeline-repositories.repository';
import { applyInstallationLifecycle } from '../../repositories/github-installations.repository';
import { ConnectionSource, withOrgClient, withOrgTransaction } from './db';
import { permissionsStateOf } from './permissions';

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
        return { status: 'pending', reason: 'deploy_detection_pending' };
      }
      return { status: 'processed', reason: null };
    }
  }
};

/** Postgres SQLSTATE as a reason code, or a generic code. Never an error message. */
function failureReason(error: unknown): string {
  const code = (error as { code?: unknown } | null)?.code;
  return typeof code === 'string' && /^[0-9A-Z]{5}$/.test(code) ? `db_${code.toLowerCase()}` : 'processing_error';
}

/**
 * Processes one stored event in its own transaction and records the outcome.
 * On failure the processing transaction rolls back and the event is marked
 * 'failed' on a fresh statement; the event row itself always stays.
 */
export async function processStoredEvent(
  source: ConnectionSource,
  organizationId: string,
  event: EventToProcess,
  processor: EventProcessor = processEvent
): Promise<ProcessingOutcome> {
  try {
    return await withOrgTransaction(source, organizationId, async (client) => {
      const outcome = await processor(client, organizationId, event);
      await setProcessingOutcome(client, organizationId, event.id, outcome.status, outcome.reason);
      return outcome;
    });
  } catch (error) {
    const outcome: ProcessingOutcome = { status: 'failed', reason: failureReason(error) };
    await withOrgClient(source, organizationId, (client) =>
      setProcessingOutcome(client, organizationId, event.id, outcome.status, outcome.reason)
    ).catch(() => undefined);
    return outcome;
  }
}
