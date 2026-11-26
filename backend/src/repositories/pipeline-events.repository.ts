/**
 * pipeline_events: GitHub App deliveries stored for one organization
 * (admin migration 202611201200_create_github_app_ingestion). Row level
 * security is forced; every statement runs on a connection tagged for the
 * organization AND names organization_id explicitly (a static test holds
 * every statement here to that).
 *
 * Events are never deleted: a failure only changes processing_status, and
 * expiry is a status too (D8a-3, founder ruling 1). Retention is a later
 * decision.
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
import { TRANSIENT_FAILURE_REASONS } from '../services/github-app/failure-class';

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

/** Records an outcome. Returns whether the row is linked to a deployment (an attempt committed; deployment_id is never cleared). */
export async function setProcessingOutcome(
  client: PoolClient,
  organizationId: string,
  eventId: string,
  status: ProcessingStatus,
  reason: string | null
): Promise<boolean> {
  if (reason !== null && !REASON.test(reason)) throw new Error('processing reason must be a code');
  const { rows } = await client.query(
    `UPDATE pipeline_events
        SET processing_status = $3, processing_reason = $4, processed_at = NOW(),
            processing_attempts = LEAST(processing_attempts + 1, 32767)
      WHERE organization_id = $1 AND id = $2
      RETURNING deployment_id IS NOT NULL AS linked`,
    [organizationId, eventId, status, reason]
  );
  return rows[0]?.linked === true;
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
 * of the held counts the GitHub screen shows (D8b-2 ruling R1). The screen
 * reads it as days (held_event_days).
 */
export const HELD_EVENT_DAYS = 7;
/**
 * D8a-3 ruling 7: the window as an explicit number of hours (168), so it is
 * the same length whatever the database session's TimeZone: subtracting a
 * days interval from a timestamptz follows that zone's daylight-saving
 * changes, an hours interval does not. Exactly 168 hours old is still
 * inside; anything older is outside (expired).
 */
export const HELD_EVENT_HOURS = HELD_EVENT_DAYS * 24;

/** The events the 7-day held window applies to: the deployment candidates (ruling R1). */
const DEPLOY_CANDIDATE_EVENTS_SQL = `event IN ('workflow_job', 'deployment_status')`;

/**
 * D8b-2 fix round 2 (S-2): the held window as SQL, received in the last
 * `hours` hours. `hours` is the placeholder that carries HELD_EVENT_HOURS
 * (D8a-3 ruling 7). The one window for a replay, the held counts, the
 * pick-up at a re-claim, claim-hold expiry, the scheduled retry and the
 * scheduled expiry.
 */
function heldWindowSql(hours: string): string {
  return `received_at >= NOW() - make_interval(hours => ${hours})`;
}

/** Placeholders that carry a ReplaySelection and HELD_EVENT_HOURS into replayEligibleSql. */
export interface ReplayEligibleParams {
  statuses: string;
  reasons: string;
  hours: string;
}

/**
 * D8b-2 fix round 2 (N-1): the one eligibility test for "a replay picks this
 * event up". findReplayableEvents reads with it, and listRepositoryActivity
 * counts with it, so the held count the GitHub screen shows is the number
 * of events the next step's replay picks up. A deployment candidate, in the
 * selection (statuses, or 'ignored' with one of its reasons), in the window.
 */
export function replayEligibleSql(p: ReplayEligibleParams): string {
  return `${DEPLOY_CANDIDATE_EVENTS_SQL}
        AND (processing_status = ANY(${p.statuses}::text[]) OR (processing_status = 'ignored' AND processing_reason = ANY(${p.reasons}::text[])))
        AND ${heldWindowSql(p.hours)}`;
}

export async function holdUntilClaimed(client: PoolClient, organizationId: string, eventId: string): Promise<void> {
  await client.query(
    `UPDATE pipeline_events
        SET processing_status = 'pending', processing_reason = $3, processed_at = NULL,
            processing_attempts = LEAST(processing_attempts + 1, 32767)
      WHERE organization_id = $1 AND id = $2`,
    [organizationId, eventId, NOT_CLAIMED_REASON]
  );
}

/** The expired mark (D8a-3 ruling 1: an existing status and reason; nothing is deleted). */
export const EXPIRED_STATUS = 'ignored';
export const EXPIRED_REASON = 'hold_expired';
const MARK_EXPIRED_SQL = `processing_status = '${EXPIRED_STATUS}', processing_reason = '${EXPIRED_REASON}', processed_at = NOW()`;

/**
 * A claim hold past the window: held for lack of a claim (NOT_CLAIMED_REASON,
 * never processed) and received more than HELD_EVENT_HOURS ago. `reason` and
 * `hours` are placeholders. The one test for both the claim's expiry and the
 * scheduled expiry (D8a-3 S2), so the two can never disagree.
 */
function expiredClaimHoldSql(p: { reason: string; hours: string }): string {
  return `processed_at IS NULL AND processing_reason = ${p.reason} AND NOT (${heldWindowSql(p.hours)})`;
}

/**
 * On a claim, before its unprocessed events are processed: events held for
 * lack of a claim longer than HELD_EVENT_HOURS end 'ignored' / hold_expired,
 * as a held delivery that old is purged. Returns how many.
 */
export async function expireClaimHolds(client: PoolClient, organizationId: string, installationId: number): Promise<number> {
  const { rowCount } = await client.query(
    `UPDATE pipeline_events
        SET ${MARK_EXPIRED_SQL}
      WHERE organization_id = $1 AND installation_id = $2 AND ${expiredClaimHoldSql({ reason: '$3', hours: '$4' })}`,
    [organizationId, installationId, NOT_CLAIMED_REASON, HELD_EVENT_HOURS]
  );
  return rowCount ?? 0;
}

/** Rows one expiry statement marks at most (the scheduled cleanup repeats it a bounded number of times). */
export const EXPIRE_BATCH = 5000;

/**
 * D8a-3 S2 (cleanup, founder ruling 1): claim holds of the organization past
 * the window, whatever the installation and whether or not the organization
 * ever claims it again, marked 'ignored' / hold_expired, oldest first, at
 * most `limit`. The same test as expireClaimHolds. Rows another transaction
 * is processing right now are skipped (the next run sees them). Nothing is
 * deleted. Returns how many were marked.
 */
export async function expireStaleClaimHolds(client: PoolClient, organizationId: string, limit = EXPIRE_BATCH): Promise<number> {
  const { rowCount } = await client.query(
    `UPDATE pipeline_events
        SET ${MARK_EXPIRED_SQL}
      WHERE organization_id = $1 AND id IN (
              SELECT id FROM pipeline_events
               WHERE organization_id = $1 AND ${expiredClaimHoldSql({ reason: '$2', hours: '$3' })}
               ORDER BY received_at, id
               LIMIT $4
                 FOR UPDATE SKIP LOCKED)`,
    [organizationId, NOT_CLAIMED_REASON, HELD_EVENT_HOURS, limit]
  );
  return rowCount ?? 0;
}

/**
 * D8a-3 cleanup: deployment candidates that were never processed and are
 * past the window, marked 'ignored' / hold_expired (EXPIRED_STATUS /
 * EXPIRED_REASON, the claim's own expiry mark):
 *  - released by a claim from github_held_deliveries (held_at set): the rows
 *    the reconnect pick-up leaves stored as released (ruling 6; D8b-2 S-2,
 *    RN-4);
 *  - stored live (held_at NULL) and never processed, e.g. a crash between
 *    storing and processing that the retry did not reach in time
 *    (Addendum 2 ruling 3).
 * Only 'pending' rows with no reason and no processed_at: recorded events
 * and every other final status are untouched, and nothing is recorded,
 * counted or deleted (held counts already leave out anything past the
 * window). Oldest first, at most `limit`.
 */
export async function expireStaleUnprocessedEvents(client: PoolClient, organizationId: string, limit = EXPIRE_BATCH): Promise<number> {
  const { rowCount } = await client.query(
    `UPDATE pipeline_events
        SET ${MARK_EXPIRED_SQL}
      WHERE organization_id = $1 AND id IN (
              SELECT id FROM pipeline_events
               WHERE organization_id = $1 AND ${DEPLOY_CANDIDATE_EVENTS_SQL}
                 AND processing_status = 'pending' AND processing_reason IS NULL AND processed_at IS NULL
                 AND NOT (${heldWindowSql('$2')})
               ORDER BY received_at, id
               LIMIT $3
                 FOR UPDATE SKIP LOCKED)`,
    [organizationId, HELD_EVENT_HOURS, limit]
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
 * D8b-2 ruling R1: only events received in the last HELD_EVENT_HOURS are
 * picked up ("held for 7 days … after 7 days, they're dropped"). Older events
 * are neither changed nor deleted here: they stay stored and are simply no
 * longer recorded (D8a-3 deletes nothing, founder ruling 1).
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
      WHERE organization_id = $1 AND github_repo_id = $2
        AND ${replayEligibleSql({ statuses: '$3', reasons: '$4', hours: '$8' })}
        AND ($6::timestamptz IS NULL OR (received_at, id) > ($6::timestamptz, $7::uuid))
      ORDER BY received_at, id
      LIMIT $5`,
    [organizationId, githubRepoId, [...selection.statuses], [...selection.ignoredReasons], limit, after?.at ?? null, after?.id ?? null,
      HELD_EVENT_HOURS]
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

/**
 * Events not processed yet (e.g. just released from hold by a claim), oldest first.
 *
 * D8b-2 fix round 2 (S-2): a deployment candidate is picked up only inside
 * the held window (HELD_EVENT_HOURS), as a replay is (ruling R1). A delivery
 * held during a disconnect keeps its original received_at when the claim
 * releases it, so one older than 7 days is left stored as it is: not
 * recorded, not changed, not deleted (the scheduled cleanup marks it expired,
 * D8a-3 ruling 6). Other events (installation,
 * installation_repositories, ...) are still processed whatever their age:
 * the held installation.created is kept past 7 days on purpose.
 */
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
        AND (NOT (${DEPLOY_CANDIDATE_EVENTS_SQL}) OR ${heldWindowSql('$4')})
      ORDER BY received_at, id
      LIMIT $3`,
    [organizationId, installationId, limit, HELD_EVENT_HOURS]
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

/**
 * D8a-3 S1: the scheduled retry's selection. It narrows replayEligibleSql
 * (deployment candidates, these statuses, the HELD_EVENT_HOURS window) and
 * never widens it: 'over_limit', 'unmapped' and 'ignored' are never retried
 * (founder ruling 3; the customer's mapping and rule replays own the last two).
 */
export const RETRY_SELECTION: ReplaySelection = { statuses: ['failed', 'pending'], ignoredReasons: [] };
/** Founder ruling 4: five processing attempts in all (the first one included). */
export const MAX_PROCESSING_ATTEMPTS = 5;
/** Ruling 5b: an event stored but never processed is picked up once it is this old (the live path has had its chance). */
export const STALE_PENDING_MINUTES = 15;

/** Placeholders for retryEligibleSql. */
interface RetryEligibleParams {
  organization: string;
  statuses: string;
  reasons: string;
  hours: string;
  maxAttempts: string;
  transient: string;
  staleMinutes: string;
  notClaimed: string;
}

/**
 * D8a-3: "the scheduled retry may process this event now". replayEligibleSql
 * narrowed by one of:
 *
 *  failed   backoff elapsed since the last attempt (processed_at): 1, 2, 4,
 *           then 8 hours after attempts 1, 2, 3, 4 (ruling 4), and
 *            - a transient failure code (failure-class.ts) with fewer than
 *              MAX_PROCESSING_ATTEMPTS attempts; any other code, an unknown
 *              one included, is permanent and never retried; or
 *            - deployment_id set: the attempt's transaction did commit (the
 *              link is written only inside it) and only its acknowledgement
 *              was lost, so it is no failure. One more pass finds the row and
 *              ends 'processed' / already_recorded, never a second row. The
 *              window and the backoff bound it, not the attempt count.
 *  pending  never processed (processed_at NULL), received more than
 *           STALE_PENDING_MINUTES ago, and either
 *            - no reason: stored but never processed (a crash between storing
 *              and processing; a redelivery is a duplicate and is not
 *              processed, ruling 5b), or released by a claim beyond the 500
 *              the claim itself processes (ruling 5); or
 *            - held for lack of a claim (NOT_CLAIMED_REASON) while this
 *              organization holds the installation's claim again. While it
 *              does not, the hold is left alone (D8b-1 RC-N2): only a claim,
 *              or the 7-day expiry, ends it.
 *
 * `organization` is the placeholder of the organization id; the claim test
 * names it, so a hold is matched only to its own organization's claim.
 */
function retryEligibleSql(p: RetryEligibleParams): string {
  return `${replayEligibleSql({ statuses: p.statuses, reasons: p.reasons, hours: p.hours })}
        AND (
              (processing_status = 'failed'
                AND processed_at < NOW() - make_interval(hours => 1 << LEAST(GREATEST(processing_attempts, 1) - 1, 3))
                AND (deployment_id IS NOT NULL
                     OR (processing_attempts < ${p.maxAttempts} AND processing_reason = ANY(${p.transient}::text[]))))
           OR (processing_status = 'pending' AND processed_at IS NULL
                AND received_at < NOW() - make_interval(mins => ${p.staleMinutes})
                AND (processing_reason IS NULL
                     OR (processing_reason = ${p.notClaimed}
                         AND EXISTS (SELECT 1 FROM github_installations gi
                                      WHERE gi.organization_id = ${p.organization}
                                        AND gi.installation_id = pipeline_events.installation_id))))
            )`;
}

/** The retry's parameters $2..$8, after the organization id ($1). */
function retryEligibleArgs(): unknown[] {
  return [[...RETRY_SELECTION.statuses], [...RETRY_SELECTION.ignoredReasons], HELD_EVENT_HOURS, MAX_PROCESSING_ATTEMPTS,
    [...TRANSIENT_FAILURE_REASONS], STALE_PENDING_MINUTES, NOT_CLAIMED_REASON];
}

const RETRY_ELIGIBLE = retryEligibleSql({
  organization: '$1', statuses: '$2', reasons: '$3', hours: '$4', maxAttempts: '$5', transient: '$6', staleMinutes: '$7', notClaimed: '$8',
});

/** A stored event the scheduled retry picked, with the state it was picked in. */
export interface RetryCandidate extends EventToProcess {
  processingStatus: ProcessingStatus;
  processingReason: string | null;
  processingAttempts: number;
  /** deployment_id was set: an earlier attempt committed (see retryEligibleSql). */
  committed: boolean;
}

/**
 * Up to `limit` of the organization's events the retry may process now,
 * oldest first (received_at, id). Bounded: the job calls it once per
 * organization per run, so one organization's backlog waits for the next
 * run instead of starving the others.
 */
export async function findRetryableEvents(client: PoolClient, organizationId: string, limit: number): Promise<RetryCandidate[]> {
  const { rows } = await client.query(
    `SELECT id, installation_id, event, action, occurred_at, received_at, facts, processing_status, processing_reason, processing_attempts,
            deployment_id IS NOT NULL AS committed
       FROM pipeline_events
      WHERE organization_id = $1 AND ${RETRY_ELIGIBLE}
      ORDER BY received_at, id
      LIMIT $9`,
    [organizationId, ...retryEligibleArgs(), limit]
  );
  return rows.map((r) => ({
    id: r.id,
    installationId: String(r.installation_id),
    event: r.event,
    action: r.action,
    occurredAt: r.occurred_at,
    receivedAt: r.received_at,
    facts: r.facts,
    processingStatus: r.processing_status,
    processingReason: r.processing_reason,
    processingAttempts: Number(r.processing_attempts),
    committed: r.committed === true,
  }));
}

/**
 * Ruling 4: inside the retry's own processing transaction, before anything
 * else runs, lock the event row (FOR UPDATE) and re-check that it is still
 * in the state it was picked in AND still eligible (the same retryEligibleSql).
 * False: another transaction processed, held or expired it meanwhile, or
 * its backoff or window changed; the caller skips it and writes nothing.
 */
export async function lockRetryCandidate(client: PoolClient, organizationId: string, candidate: RetryCandidate): Promise<boolean> {
  const { rowCount } = await client.query(
    `SELECT 1 FROM pipeline_events
      WHERE organization_id = $1 AND ${RETRY_ELIGIBLE}
        AND id = $9 AND processing_status = $10 AND processing_reason IS NOT DISTINCT FROM $11 AND processing_attempts = $12
        FOR UPDATE`,
    [organizationId, ...retryEligibleArgs(), candidate.id, candidate.processingStatus, candidate.processingReason, candidate.processingAttempts]
  );
  return rowCount === 1;
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
