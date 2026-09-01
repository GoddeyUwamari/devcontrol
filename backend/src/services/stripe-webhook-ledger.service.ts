/**
 * Stripe webhook event-ID idempotency ledger.
 *
 * Backs the `stripe_webhook_events` table (see
 * database/migrations/202608312200_create_stripe_webhook_events.sql for the
 * full design rationale). This module owns exactly two things: claiming an
 * event before its handler runs, and resolving it after. It intentionally
 * knows nothing about *what* a handler does -- see
 * StripeController.handleWebhook for the dispatcher that calls this.
 *
 * Concurrency model (why there is no timeout anywhere in this file):
 * Claiming acquires a session-level Postgres advisory lock keyed on the
 * event's own id (`pg_try_advisory_lock(hashtextextended(stripe_event_id, 0))`)
 * on the caller-supplied `client` -- a single connection checked out for the
 * whole claim-through-resolve lifecycle of one webhook request. That lock is
 * held only by a connection that is actually alive and working on this
 * event. If that connection dies (process crash, restart, forced
 * disconnect), Postgres releases the lock itself as soon as it notices --
 * there is no reclaim window to size and no risk of two live attempts
 * running concurrently, because a merely-slow (not dead) handler keeps
 * holding its lock and a concurrent claim attempt simply fails to acquire
 * it. This deliberately replaces the more common "reclaim a 'processing'
 * row after N minutes" pattern, which cannot tell a slow handler from a
 * dead one without guessing a duration.
 *
 * The lock key is a 64-bit hash of the event id, not the id itself
 * (Postgres advisory locks only take integer keys). A hash collision
 * between two different, genuinely concurrent event ids is astronomically
 * unlikely (64-bit space) but not impossible, and this module never lets a
 * collision cause a silent drop: on failing to acquire the lock, it
 * consults the real (unhashed, unique-constrained) row for this exact
 * stripe_event_id before deciding anything. Only a real match against that
 * row is trusted; an ambiguous case (no row, or a 'failed' row, while the
 * lock is contended) is reported as retryable rather than guessed at.
 */

import { PoolClient } from 'pg';
import { pool } from '../config/database';

const MAX_ERROR_MESSAGE_LENGTH = 2000;

export type WebhookClaimResult =
  // Freshly claimed (first delivery) or reclaimed (previous attempt failed
  // or died mid-processing). The caller should run the handler.
  | { kind: 'claimed'; attempts: number }
  // stripe_event_id already has a 'processed' row. The caller must not run
  // the handler again.
  | { kind: 'already_processed' }
  // Another live connection currently holds this event's lock -- a genuine
  // concurrent/duplicate delivery in flight right now. The caller must not
  // run the handler.
  | { kind: 'in_progress_elsewhere' }
  // The lock was contended but this exact stripe_event_id's row doesn't
  // prove it's the same event (no row, or status='failed' -- see module
  // doc). Could be a same-event race resolving itself within milliseconds,
  // or -- vanishingly rarely -- a hash collision with a different event.
  // Never assumed safe to skip; the caller must ask Stripe to retry.
  | { kind: 'ambiguous_retry' };

function lockKeyQuery() {
  return 'SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked';
}

function unlockKeyQuery() {
  return 'SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS unlocked';
}

/**
 * Claims a webhook event for processing on `client` -- a connection the
 * caller checked out via pool.connect() and will keep for the lifetime of
 * this event's processing (see StripeController.handleWebhook). Must be
 * paired with exactly one later call to `resolveWebhookEvent` on the same
 * client/event id when this returns `{ kind: 'claimed' }` -- every other
 * outcome has already released anything it acquired before returning.
 */
export async function claimWebhookEvent(
  client: PoolClient,
  stripeEventId: string,
  eventType: string
): Promise<WebhookClaimResult> {
  const lockResult = await client.query<{ locked: boolean }>(lockKeyQuery(), [stripeEventId]);

  if (!lockResult.rows[0].locked) {
    // Don't guess from the lock alone -- confirm against the real,
    // unhashed, unique-constrained row for this exact event id.
    const { rows } = await pool.query<{ status: string }>(
      'SELECT status FROM stripe_webhook_events WHERE stripe_event_id = $1',
      [stripeEventId]
    );
    if (rows[0]?.status === 'processed') return { kind: 'already_processed' };
    if (rows[0]?.status === 'processing') return { kind: 'in_progress_elsewhere' };
    return { kind: 'ambiguous_retry' };
  }

  // We now hold this event's lock exclusively -- no other live connection
  // can be mid-processing it. Any existing non-'processed' row is therefore
  // provably stale (its holder, if any, would need this exact lock), so
  // reclaiming it here needs no time-based staleness check at all.
  const claim = await client.query<{ attempts: number }>(
    `INSERT INTO stripe_webhook_events (stripe_event_id, event_type, status, attempts, last_attempted_at)
     VALUES ($1, $2, 'processing', 1, NOW())
     ON CONFLICT (stripe_event_id) DO UPDATE SET
       status = 'processing',
       attempts = stripe_webhook_events.attempts + 1,
       last_attempted_at = NOW()
     WHERE stripe_webhook_events.status != 'processed'
     RETURNING attempts`,
    [stripeEventId, eventType]
  );

  if (claim.rows.length === 0) {
    // Holding the lock proved nothing else is concurrently processing this
    // event, yet the row is already 'processed' -- this exact event
    // completed on a previous delivery. Nothing left to do.
    await client.query(unlockKeyQuery(), [stripeEventId]);
    return { kind: 'already_processed' };
  }

  return { kind: 'claimed', attempts: claim.rows[0].attempts };
}

/**
 * Resolves a previously-claimed event and always releases its advisory
 * lock, whether the ledger write itself succeeds or throws. Must be called
 * exactly once per successful `claimWebhookEvent` -> `{ kind: 'claimed' }`.
 */
export async function resolveWebhookEvent(
  client: PoolClient,
  stripeEventId: string,
  outcome: { success: true } | { success: false; errorMessage: string }
): Promise<void> {
  try {
    if (outcome.success) {
      await client.query(
        `UPDATE stripe_webhook_events SET status = 'processed', processed_at = NOW() WHERE stripe_event_id = $1`,
        [stripeEventId]
      );
    } else {
      await client.query(
        `UPDATE stripe_webhook_events SET status = 'failed', last_error = $2 WHERE stripe_event_id = $1`,
        [stripeEventId, outcome.errorMessage.slice(0, MAX_ERROR_MESSAGE_LENGTH)]
      );
    }
  } finally {
    await client.query(unlockKeyQuery(), [stripeEventId]);
  }
}
