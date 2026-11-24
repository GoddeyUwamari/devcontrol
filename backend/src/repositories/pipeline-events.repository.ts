/**
 * pipeline_events: GitHub App deliveries stored for one organization
 * (admin migration 202611201200_create_github_app_ingestion). Row level
 * security is forced; every statement runs on a connection tagged for the
 * organization AND names organization_id explicitly (a static test holds
 * every statement here to that).
 *
 * Events are never deleted by processing: a failure only changes
 * processing_status. Deletion is the retention purge's job (D8a-3).
 */
import { PoolClient } from 'pg';
import {
  NORMALIZER_VERSION,
  NormalizedDelivery,
  PullRequestFacts,
  StoredPipelineEvent,
  SupportedEvent,
  WorkflowJobFacts,
} from '../services/github-app/contract';
import { ConnectionSource, defaultSource, withOrgClient } from '../services/github-app/db';

export type ProcessingStatus = 'pending' | 'processed' | 'ignored' | 'unmapped' | 'over_limit' | 'failed';

/** A reason code: lowercase snake case only, never an error message. */
const REASON = /^[a-z0-9_]{1,64}$/;

interface InsertedEvent {
  id: string;
  inserted: boolean;
}

/**
 * Stores one delivery. Idempotent on the delivery id (global) and on the
 * (organization, event_key) pair: a redelivery returns inserted=false and
 * changes nothing.
 */
export async function insertPipelineEvent(
  client: PoolClient,
  organizationId: string,
  deliveryId: string,
  record: NormalizedDelivery,
  payloadSha256: string
): Promise<InsertedEvent> {
  const { rows } = await client.query<{ id: string }>(
    `INSERT INTO pipeline_events
       (delivery_id, organization_id, installation_id, github_repo_id, event, action, event_key, occurred_at,
        normalizer_version, facts, payload_sha256)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10::jsonb, $11)
     ON CONFLICT DO NOTHING
     RETURNING id`,
    [deliveryId, organizationId, record.installationId, record.githubRepoId, record.event, record.action, record.eventKey,
      record.occurredAt, NORMALIZER_VERSION, JSON.stringify(record.facts), payloadSha256]
  );
  if (rows.length === 1) return { id: rows[0].id, inserted: true };
  const existing = await client.query<{ id: string }>(
    `SELECT id FROM pipeline_events
      WHERE organization_id = $1 AND (delivery_id = $2 OR ($3::text IS NOT NULL AND event_key = $3))
      LIMIT 1`,
    [organizationId, deliveryId, record.eventKey]
  );
  return { id: existing.rows[0]?.id ?? '', inserted: false };
}

export async function setProcessingOutcome(
  client: PoolClient,
  organizationId: string,
  eventId: string,
  status: ProcessingStatus,
  reason: string | null
): Promise<void> {
  if (reason !== null && !REASON.test(reason)) throw new Error('processing reason must be a code');
  await client.query(
    `UPDATE pipeline_events
        SET processing_status = $3, processing_reason = $4, processed_at = NOW(),
            processing_attempts = LEAST(processing_attempts + 1, 32767)
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, eventId, status, reason]
  );
}

/**
 * D8b-1 fix S-1: an event stored for this organization whose installation is
 * no longer claimed by it (disconnected while the event was in flight). It
 * is held under the held-delivery rule: left unprocessed ('pending',
 * processed_at NULL) so this organization's next claim of the installation
 * records it, if that claim comes within HELD_EVENT_DAYS of receipt.
 */
export const NOT_CLAIMED_REASON = 'installation_not_claimed';
/**
 * The same 7 days as github_held_deliveries (github_purge_held_deliveries).
 * Also the window a mapping or rule replay picks events from, and the window
 * of the held counts the GitHub screen shows (D8b-2 ruling R1).
 */
export const HELD_EVENT_DAYS = 7;

export async function holdUntilClaimed(client: PoolClient, organizationId: string, eventId: string): Promise<void> {
  await client.query(
    `UPDATE pipeline_events
        SET processing_status = 'pending', processing_reason = $3, processed_at = NULL,
            processing_attempts = LEAST(processing_attempts + 1, 32767)
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, eventId, NOT_CLAIMED_REASON]
  );
}

/**
 * On a claim, before its unprocessed events are processed: events held for
 * lack of a claim longer than HELD_EVENT_DAYS end 'ignored' / hold_expired,
 * as a held delivery that old is purged. Returns how many.
 */
export async function expireClaimHolds(client: PoolClient, organizationId: string, installationId: number): Promise<number> {
  const { rowCount } = await client.query(
    `UPDATE pipeline_events
        SET processing_status = 'ignored', processing_reason = 'hold_expired', processed_at = NOW()
      WHERE organization_id = $1 AND installation_id = $2 AND processed_at IS NULL AND processing_reason = $3
        AND received_at < NOW() - make_interval(days => $4)`,
    [organizationId, installationId, NOT_CLAIMED_REASON, HELD_EVENT_DAYS]
  );
  return rowCount ?? 0;
}

export interface EventToProcess {
  id: string;
  installationId: string;
  event: SupportedEvent;
  action: string;
  occurredAt: Date | null;
  receivedAt: Date;
  facts: StoredPipelineEvent['facts'];
}

/** Links a processed event to the deployment row it recorded (or found already recorded). */
export async function linkDeployment(client: PoolClient, organizationId: string, eventId: string, deploymentId: string): Promise<void> {
  await client.query(
    `UPDATE pipeline_events SET deployment_id = $3::uuid WHERE organization_id = $1 AND id = $2`,
    [organizationId, eventId, deploymentId]
  );
}

/** Which stored events a replay picks up (rulings Q11). */
export interface ReplaySelection {
  statuses: readonly ProcessingStatus[];
  /** Also 'ignored' events with one of these reasons. */
  ignoredReasons: readonly string[];
}

/** Events a replay reads per query; a replay pages until the selection is used up (review S-1). */
export const REPLAY_BATCH = 1000;

/**
 * Where the next page starts: the last row's (received_at, id). `at` is the
 * database's own text form of received_at, so the microseconds a JS Date
 * would drop survive the round trip and the cursor always moves forward.
 */
export interface ReplayCursor {
  at: string;
  id: string;
}

export interface ReplayPage {
  events: EventToProcess[];
  /** null when this page was the last one. */
  next: ReplayCursor | null;
}

/**
 * One page of a repository's deployment-candidate events (workflow_job and
 * deployment_status) in the selection, in receipt order (received_at, id),
 * strictly after `after`. pipeline_events has no created_at column:
 * received_at (DEFAULT NOW()) is the row's creation time.
 *
 * D8b-2 ruling R1: only events received in the last HELD_EVENT_DAYS are
 * picked up ("held for 7 days … after 7 days, they're dropped"). Older events
 * are neither changed nor deleted here: they stay stored until the retention
 * purge (D8a-3) exists, and are simply no longer recorded.
 */
export async function findReplayableEvents(
  client: PoolClient,
  organizationId: string,
  githubRepoId: number,
  selection: ReplaySelection,
  after: ReplayCursor | null = null,
  limit = REPLAY_BATCH
): Promise<ReplayPage> {
  const { rows } = await client.query(
    `SELECT id, installation_id, event, action, occurred_at, received_at, received_at::text AS cursor_at, facts
       FROM pipeline_events
      WHERE organization_id = $1 AND github_repo_id = $2 AND event IN ('workflow_job', 'deployment_status')
        AND (processing_status = ANY($3::text[]) OR (processing_status = 'ignored' AND processing_reason = ANY($4::text[])))
        AND ($6::timestamptz IS NULL OR (received_at, id) > ($6::timestamptz, $7::uuid))
        AND received_at >= NOW() - make_interval(days => $8)
      ORDER BY received_at, id
      LIMIT $5`,
    [organizationId, githubRepoId, [...selection.statuses], [...selection.ignoredReasons], limit, after?.at ?? null, after?.id ?? null,
      HELD_EVENT_DAYS]
  );
  const events = rows.map((r) => ({
    id: r.id,
    installationId: String(r.installation_id),
    event: r.event,
    action: r.action,
    occurredAt: r.occurred_at,
    receivedAt: r.received_at,
    facts: r.facts,
  }));
  const last = rows[rows.length - 1];
  return { events, next: rows.length === limit ? { at: last.cursor_at, id: last.id } : null };
}

/** Events not processed yet (e.g. just released from hold by a claim), oldest first. */
export async function findUnprocessedEvents(
  client: PoolClient,
  organizationId: string,
  installationId: number,
  limit = 500
): Promise<EventToProcess[]> {
  const { rows } = await client.query(
    `SELECT id, installation_id, event, action, occurred_at, received_at, facts
       FROM pipeline_events
      WHERE organization_id = $1 AND installation_id = $2 AND processed_at IS NULL
      ORDER BY received_at, id
      LIMIT $3`,
    [organizationId, installationId, limit]
  );
  return rows.map((r) => ({
    id: r.id,
    installationId: String(r.installation_id),
    event: r.event,
    action: r.action,
    occurredAt: r.occurred_at,
    receivedAt: r.received_at,
    facts: r.facts,
  }));
}

/** Most recent receipt time for the organization (connection status), or null. */
export async function lastEventReceivedAt(client: PoolClient, organizationId: string): Promise<Date | null> {
  const { rows } = await client.query<{ at: Date | null }>(
    `SELECT max(received_at) AS at FROM pipeline_events WHERE organization_id = $1`,
    [organizationId]
  );
  return rows[0]?.at ?? null;
}

function toStored<F extends StoredPipelineEvent['facts']>(r: any): StoredPipelineEvent<F> {
  return {
    id: r.id,
    deliveryId: r.delivery_id,
    organizationId: r.organization_id,
    installationId: String(r.installation_id),
    githubRepoId: r.github_repo_id === null ? null : String(r.github_repo_id),
    event: r.event,
    action: r.action,
    occurredAt: r.occurred_at,
    receivedAt: r.received_at,
    normalizerVersion: r.normalizer_version,
    facts: r.facts as F,
    processingStatus: r.processing_status,
  };
}

const STORED_COLUMNS = `id, delivery_id, organization_id, installation_id, github_repo_id, event, action, occurred_at,
                        received_at, normalizer_version, facts, processing_status`;
const SHA_LIST = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;

/**
 * The D6/D7 read side (d8a-build.md §1.7). Organization-scoped, typed facts,
 * no HTTP and no raw payloads.
 */
export class PipelineEventsReader {
  constructor(private readonly source: ConnectionSource = defaultSource) {}

  /** D6: merged pull requests of one repository whose merge commit is one of `mergeShas`. */
  async findMergedPullRequests(
    organizationId: string,
    githubRepoId: number | string,
    mergeShas: readonly string[]
  ): Promise<StoredPipelineEvent<PullRequestFacts>[]> {
    if (!mergeShas.some((s) => SHA_LIST.test(s))) return [];
    return withOrgClient(this.source, organizationId, (client) =>
      PipelineEventsReader.findMergedPullRequestsOn(client, organizationId, githubRepoId, mergeShas));
  }

  /**
   * The same read on a connection the caller already holds (tagged for the
   * organization), e.g. inside D8a-2's deployment transaction.
   */
  static async findMergedPullRequestsOn(
    client: PoolClient,
    organizationId: string,
    githubRepoId: number | string,
    mergeShas: readonly string[]
  ): Promise<StoredPipelineEvent<PullRequestFacts>[]> {
    const shas = mergeShas.filter((s) => SHA_LIST.test(s));
    if (shas.length === 0) return [];
    const { rows } = await client.query(
      `SELECT ${STORED_COLUMNS} FROM pipeline_events
        WHERE organization_id = $1 AND github_repo_id = $2 AND event = 'pull_request' AND action = 'closed'
          AND facts ->> 'merged' = 'true' AND facts ->> 'merge_commit_sha' = ANY($3::text[])
        ORDER BY occurred_at, id`,
      [organizationId, String(githubRepoId), shas]
    );
    return rows.map((r) => toStored<PullRequestFacts>(r));
  }

  /** D6: merged pull requests received since `since`, all repositories. */
  async findMergedPullRequestsSince(organizationId: string, since: Date): Promise<StoredPipelineEvent<PullRequestFacts>[]> {
    return withOrgClient(this.source, organizationId, async (client) => {
      const { rows } = await client.query(
        `SELECT ${STORED_COLUMNS} FROM pipeline_events
          WHERE organization_id = $1 AND event = 'pull_request' AND action = 'closed'
            AND facts ->> 'merged' = 'true' AND received_at >= $2
          ORDER BY occurred_at, id
          LIMIT 5000`,
        [organizationId, since]
      );
      return rows.map((r) => toStored<PullRequestFacts>(r));
    });
  }

  /** D7: completed workflow jobs by GitHub job id (steps, started_at, run_attempt). */
  async findWorkflowJobs(organizationId: string, jobIds: readonly number[]): Promise<StoredPipelineEvent<WorkflowJobFacts>[]> {
    const ids = jobIds.filter((n) => Number.isSafeInteger(n) && n > 0).map(String);
    if (ids.length === 0) return [];
    return withOrgClient(this.source, organizationId, async (client) => {
      const { rows } = await client.query(
        `SELECT ${STORED_COLUMNS} FROM pipeline_events
          WHERE organization_id = $1 AND event = 'workflow_job' AND action = 'completed'
            AND facts ->> 'job_id' = ANY($2::text[])
          ORDER BY occurred_at, id`,
        [organizationId, ids]
      );
      return rows.map((r) => toStored<WorkflowJobFacts>(r));
    });
  }
}
