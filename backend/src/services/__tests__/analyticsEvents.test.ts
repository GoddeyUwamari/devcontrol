/**
 * Direct coverage for the trackFunnelEvent/trackFunnelEventOnce helpers
 * against real Postgres -- no Stripe/AWS involved, this is the shared
 * primitive every funnel call site (auth.service.ts, aws.routes.ts,
 * awsResourceDiscovery.ts, optimization.controller.ts, stripe.controller.ts)
 * builds on.
 */
import { Pool } from 'pg';
import { trackFunnelEvent, trackFunnelEventOnce } from '../analyticsEvents';

function dbConfig() {
  return {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || 'platform_portal',
    user: process.env.DB_USER || 'postgres',
    password: process.env.DB_PASSWORD || 'postgres',
  };
}

const pool = new Pool(dbConfig());
const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status)
     VALUES ($1, $2, $3, 'free', 'free')
     RETURNING id`,
    [`Funnel Event Org ${suffix}`, `funnel-event-org-${suffix}`, `Funnel Event Org ${suffix}`]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertUser(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Funnel Test User') RETURNING id`,
    [`funnel-event-${suffix}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function fetchEvents(organizationId: string, eventName: string) {
  const { rows } = await pool.query(
    `SELECT * FROM analytics_events WHERE organization_id = $1 AND event_name = $2 ORDER BY created_at ASC`,
    [organizationId, eventName]
  );
  return rows;
}

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
  await pool.end();
});

describe('trackFunnelEvent', () => {
  it('records the event with the funnel category and given properties', async () => {
    const orgId = await insertOrg();
    const userId = await insertUser();

    await trackFunnelEvent({
      organizationId: orgId,
      userId,
      eventName: 'checkout_started',
      properties: { tier: 'pro', billingInterval: 'monthly' },
    });

    const rows = await fetchEvents(orgId, 'checkout_started');
    expect(rows).toHaveLength(1);
    expect(rows[0].event_category).toBe('funnel');
    expect(rows[0].user_id).toBe(userId);
    expect(rows[0].properties).toEqual({ tier: 'pro', billingInterval: 'monthly' });
  });

  it('is NOT deduped -- repeat calls for the same org/event each record a new row', async () => {
    const orgId = await insertOrg();

    await trackFunnelEvent({ organizationId: orgId, eventName: 'checkout_started', properties: { attempt: 1 } });
    await trackFunnelEvent({ organizationId: orgId, eventName: 'checkout_started', properties: { attempt: 2 } });

    const rows = await fetchEvents(orgId, 'checkout_started');
    expect(rows).toHaveLength(2);
  });

  it('swallows a DB error rather than throwing -- a funnel-tracking failure must never break the caller', async () => {
    await expect(
      trackFunnelEvent({
        // Not a real UUID -- forces a DB-level error inside the write.
        organizationId: 'not-a-uuid',
        eventName: 'checkout_started',
      })
    ).resolves.toBeUndefined();
  });
});

describe('trackFunnelEventOnce', () => {
  it('records the first occurrence and returns true', async () => {
    const orgId = await insertOrg();

    const firstResult = await trackFunnelEventOnce({
      organizationId: orgId,
      eventName: 'signup_completed',
      properties: { tier: 'free' },
    });

    expect(firstResult).toBe(true);
    const rows = await fetchEvents(orgId, 'signup_completed');
    expect(rows).toHaveLength(1);
  });

  it('a second call for the same org/event is a no-op and returns false', async () => {
    const orgId = await insertOrg();

    const first = await trackFunnelEventOnce({ organizationId: orgId, eventName: 'signup_completed' });
    const second = await trackFunnelEventOnce({ organizationId: orgId, eventName: 'signup_completed' });

    expect(first).toBe(true);
    expect(second).toBe(false);
    const rows = await fetchEvents(orgId, 'signup_completed');
    expect(rows).toHaveLength(1);
  });

  it('the same event name for a DIFFERENT org is independent -- no cross-org dedup', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();

    const resultA = await trackFunnelEventOnce({ organizationId: orgA, eventName: 'discovery_completed' });
    const resultB = await trackFunnelEventOnce({ organizationId: orgB, eventName: 'discovery_completed' });

    expect(resultA).toBe(true);
    expect(resultB).toBe(true);
    expect(await fetchEvents(orgA, 'discovery_completed')).toHaveLength(1);
    expect(await fetchEvents(orgB, 'discovery_completed')).toHaveLength(1);
  });

  it('a DIFFERENT event name for the same org is independent -- dedup is scoped per event_name', async () => {
    const orgId = await insertOrg();

    await trackFunnelEventOnce({ organizationId: orgId, eventName: 'aws_connection_completed' });
    const discoveryResult = await trackFunnelEventOnce({ organizationId: orgId, eventName: 'discovery_completed' });

    expect(discoveryResult).toBe(true);
    expect(await fetchEvents(orgId, 'aws_connection_completed')).toHaveLength(1);
    expect(await fetchEvents(orgId, 'discovery_completed')).toHaveLength(1);
  });

  it('returns false rather than throwing on a DB error', async () => {
    await expect(
      trackFunnelEventOnce({ organizationId: 'not-a-uuid', eventName: 'signup_completed' })
    ).resolves.toBe(false);
  });
});
