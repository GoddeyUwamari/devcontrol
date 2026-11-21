/**
 * Replay of stored events after a customer change (D8a-2, ruling Q11):
 *
 *   mapping a repository to a service -> its 'pending' and 'unmapped' events
 *   setting a deploy rule             -> its 'pending' and 'unmapped' events, and
 *                                        the 'ignored' ones a rule decides
 *
 * Only workflow_job and deployment_status events, oldest first, at most
 * REPLAY_LIMIT per call, each through the same processing as a live delivery
 * (its own transaction, the same quota lock, ON CONFLICT on the deployment
 * keys), so a replay is idempotent. A replay never deletes or changes an
 * existing deployment row. Retries of 'failed' and 'over_limit' events are
 * the scheduled job's (D8a-3).
 */
import { findReplayableEvents, ReplaySelection } from '../../repositories/pipeline-events.repository';
import { ConnectionSource, defaultSource, withOrgClient } from './db';
import { EventProcessor, processEvent, processStoredEvent } from './process';

export const MAPPING_REPLAY: ReplaySelection = { statuses: ['pending', 'unmapped'], ignoredReasons: [] };

export const RULE_REPLAY: ReplaySelection = {
  statuses: ['pending', 'unmapped'],
  ignoredReasons: ['no_deploy_rule', 'deploy_rule_invalid', 'not_deploy_job', 'branch_not_matched', 'other_mode', 'unknown_environment'],
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
  const events = await withOrgClient(source, organizationId, (client) =>
    findReplayableEvents(client, organizationId, githubRepoId, selection));
  let recorded = 0;
  for (const event of events) {
    const outcome = await processStoredEvent(source, organizationId, event, processor);
    if (outcome.status === 'processed' && outcome.reason === null) recorded += 1;
  }
  return { considered: events.length, recorded };
}
