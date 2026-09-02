/**
 * Thin wrapper over the existing `analytics_events` table (and its
 * `track_event()` SQL function) for authoritative, server-side funnel
 * instrumentation. Not a new analytics system -- both already exist in
 * production (see database/migrations-admin/010_create_analytics_events.sql).
 *
 * `analytics_events` is RLS-protected: its INSERT policy requires
 * `organization_id = current_setting('app.current_organization_id')`. The
 * shared `pool` export (backend/src/config/database.ts) only auto-resolves
 * that session variable when called from inside an active HTTP request's
 * AsyncLocalStorage context -- several of this module's callers run outside
 * that (pre-auth registration, a fire-and-forget background discovery job,
 * a Stripe webhook with no request-scoped org client at all). Rather than
 * rely on ambient context that isn't guaranteed at every call site, every
 * write here opens its own short-lived connection and transaction, sets the
 * org context on it explicitly (transaction-local, so it never leaks back
 * into the pool for an unrelated request/org to inherit), and commits --
 * safe and correct regardless of what, if anything, called it.
 */
import { pool } from '../config/database';
import type { PoolClient } from 'pg';

export type FunnelEventName =
  | 'signup_completed'
  | 'aws_connection_completed'
  | 'discovery_completed'
  | 'first_insight_generated'
  | 'first_value_viewed'
  | 'checkout_started'
  | 'subscription_activated';

// Stable IDs, counts, and amounts only -- never free text, request bodies,
// or secrets. Enforced at the type level so a call site can't accidentally
// pass through something richer.
export interface FunnelEventProperties {
  [key: string]: string | number | boolean | null;
}

interface FunnelEventInput {
  organizationId: string;
  userId?: string | null;
  eventName: FunnelEventName;
  properties?: FunnelEventProperties;
}

const FUNNEL_EVENT_CATEGORY = 'funnel';

async function withOrgTransaction<T>(
  organizationId: string,
  run: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_organization_id', $1, true)", [organizationId]);
    const result = await run(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => { /* connection already broken */ });
    throw error;
  } finally {
    client.release();
  }
}

/**
 * Record a funnel event every time it's called. Use only for events where a
 * repeat occurrence is itself legitimate (e.g. `checkout_started` -- a
 * customer abandoning and retrying checkout is a real, distinct event each
 * time). Never throws -- a funnel-tracking failure must never break the
 * request/job that triggered it.
 */
export async function trackFunnelEvent(input: FunnelEventInput): Promise<void> {
  try {
    await withOrgTransaction(input.organizationId, (client) =>
      client.query('SELECT track_event($1, $2, $3, $4, $5)', [
        input.userId ?? null,
        input.organizationId,
        input.eventName,
        FUNNEL_EVENT_CATEGORY,
        JSON.stringify(input.properties ?? {}),
      ])
    );
  } catch (error) {
    console.error(`[FunnelEvent] Failed to record ${input.eventName} for org ${input.organizationId}:`, error);
  }
}

/**
 * Record a funnel event only the first time it occurs for this
 * organization -- safe to call on every retry/rescan/refresh of a "first X"
 * moment. The guard is a single atomic `INSERT ... WHERE NOT EXISTS`
 * against `analytics_events` itself (scoped to organization_id + event_name),
 * not a business-state flag, so it needs no schema change and works
 * uniformly across every "first X" event in the funnel. Returns whether
 * this call was the one that actually recorded it. Never throws.
 */
export async function trackFunnelEventOnce(input: FunnelEventInput): Promise<boolean> {
  try {
    return await withOrgTransaction(input.organizationId, async (client) => {
      const result = await client.query(
        `INSERT INTO analytics_events (user_id, organization_id, event_name, event_category, properties)
         SELECT $1::uuid, $2::uuid, $3::varchar, $4::varchar, $5::jsonb
         WHERE NOT EXISTS (
           SELECT 1 FROM analytics_events
           WHERE organization_id = $2::uuid AND event_name = $3::varchar
         )
         RETURNING id`,
        [
          input.userId ?? null,
          input.organizationId,
          input.eventName,
          FUNNEL_EVENT_CATEGORY,
          JSON.stringify(input.properties ?? {}),
        ]
      );
      return (result.rowCount ?? 0) > 0;
    });
  } catch (error) {
    console.error(`[FunnelEvent] Failed to record ${input.eventName} (once) for org ${input.organizationId}:`, error);
    return false;
  }
}
