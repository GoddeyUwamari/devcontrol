/**
 * Replay of stored events after a customer change (D8a-2, ruling Q11):
 *
 *   mapping a repository to a service -> its 'pending' and 'unmapped' events
 *   setting a deploy rule             -> its 'pending' and 'unmapped' events, and
 *                                        the 'ignored' ones a rule decides
 *
 * Only workflow_job and deployment_status events, in receipt order, read in
 * keyset pages of REPLAY_BATCH by (received_at, id) until the selection is
 * used up (review S-1: events the new rule still ignores stay in the
 * selection, so a fixed oldest-first window would never reach newer ones).
 * Each event goes through the same processing as a live delivery (its own
 * transaction, the same quota lock, ON CONFLICT on the deployment keys), so a
 * replay is idempotent. A replay never deletes or changes an
 * existing deployment row. Retries of 'failed' and 'over_limit' events are
 * the scheduled job's (D8a-3).
 *
 * 'legacy_webhook_org' is in both selections (review S-2): once
 * GITHUB_WEBHOOK_ORG_ID is unset, re-saving the deploy rule (or mapping the
 * repository) records what the guard held; a job the legacy route already
 * recorded is found by its job id and ends 'already_recorded'. While the
 * variable is still set, the guard ignores them again.
 */
import { findReplayableEvents, ReplayCursor, ReplayPage, ReplaySelection } from '../../repositories/pipeline-events.repository';
import { ConnectionSource, defaultSource, withOrgClient } from './db';
import { EventProcessor, processEvent, processStoredEvent } from './process';

export const MAPPING_REPLAY: ReplaySelection = { statuses: ['pending', 'unmapped'], ignoredReasons: ['legacy_webhook_org'] };

export const RULE_REPLAY: ReplaySelection = {
  statuses: ['pending', 'unmapped'],
  ignoredReasons: [
    'no_deploy_rule', 'deploy_rule_invalid', 'not_deploy_job', 'branch_not_matched', 'other_mode', 'unknown_environment', 'legacy_webhook_org',
  ],
};

export interface ReplayResult {
  considered: number;
  recorded: number;
}

export async function replayRepository(
  organizationId: string,
  githubRepoId: number,
  selection: ReplaySelection,
  source: ConnectionSource = defaultSource,
  processor: EventProcessor = processEvent
): Promise<ReplayResult> {
  let considered = 0;
  let recorded = 0;
  let after: ReplayCursor | null = null;
  do {
    const page: ReplayPage = await withOrgClient(source, organizationId, (client) =>
      findReplayableEvents(client, organizationId, githubRepoId, selection, after));
    for (const event of page.events) {
      const outcome = await processStoredEvent(source, organizationId, event, processor);
      if (outcome.status === 'processed' && outcome.reason === null) recorded += 1;
    }
    considered += page.events.length;
    after = page.next;
  } while (after !== null);
  return { considered, recorded };
}
