/**
 * P1 -- Immediate cancellation consistency.
 *
 * Audit finding this closes: StripeController.cancelSubscription's
 * immediate-cancel branch called stripeService.cancelSubscription (which
 * fully cancels the subscription in Stripe *synchronously*) but never
 * passed `tier` to updateOrganizationSubscription -- so subscription_tier
 * and its max_services/max_users/max_deployments_per_month override columns
 * stayed at their old paid values until the asynchronous
 * customer.subscription.deleted webhook eventually arrived and corrected
 * them. Stripe does not guarantee webhook delivery is instantaneous (retry
 * backoff can delay it by minutes if our endpoint is briefly unreachable),
 * so this was a real window of continued paid-tier access after a
 * successful, admin-authorized cancellation -- directly contradicted by the
 * frontend's own "Access has ended" toast (components/billing/
 * cancel-subscription-dialog.tsx), which was already claiming something
 * the backend hadn't yet made true.
 *
 * A second, related finding surfaced while fixing the first:
 * handleSubscriptionUpdated resolved tier purely from the subscription's
 * current price, with no awareness of subscription.status. Before this fix,
 * that was masked -- a customer.subscription.updated event carrying
 * status='canceled' (Stripe fires this for the status transition itself,
 * not necessarily after customer.subscription.deleted for the same
 * cancellation) would resolve tier from the still-referenced old price and
 * write it right back, but since nothing had downgraded the tier yet
 * either, it was a same-value no-op. Once cancelSubscription downgrades
 * synchronously, that same event would have *resurrected* paid entitlement
 * by overriding the correct 'free' value. Both fixes are covered here.
 *
 * Same pattern as stripe-billing-authorization.test.ts /
 * stripe-webhook-entitlement-sync.test.ts: real Postgres, jest.spyOn on the
 * Stripe-network-touching stripeService methods so the real Stripe SDK is
 * never exercised and no network call is made.
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { stripeController } from '../stripe.controller';
import stripeService from '../../services/stripe.service';
import { TIER_LIMITS } from '../../middleware/subscription.middleware';

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

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrgWithSubscription(tier: string = 'pro'): Promise<{ orgId: string; subscriptionId: string; customerId: string }> {
  const suffix = uniqueSuffix();
  const customerId = `cus_test_${suffix}`;
  const subscriptionId = `sub_test_${suffix}`;
  const tierDefaults = TIER_LIMITS[tier as keyof typeof TIER_LIMITS];
  const { rows } = await pool.query(
    `INSERT INTO organizations (
       name, slug, display_name, subscription_tier,
       max_services, max_users, max_deployments_per_month,
       stripe_customer_id, stripe_subscription_id, subscription_status
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'active')
     RETURNING id`,
    [
      `Cancel Consistency Org ${suffix}`,
      `cancel-consistency-org-${suffix}`,
      `Cancel Consistency Org ${suffix}`,
      tier,
      tierDefaults.maxServices,
      tierDefaults.maxUsers,
      tierDefaults.maxDeploymentsPerMonth,
      customerId,
      subscriptionId,
    ]
  );
  createdOrgIds.push(rows[0].id);
  return { orgId: rows[0].id as string, subscriptionId, customerId };
}

async function fetchOrgRow(orgId: string) {
  const { rows } = await pool.query(
    `SELECT subscription_tier, subscription_status, subscription_cancel_at_period_end,
            stripe_subscription_id, subscription_current_period_start, subscription_current_period_end,
            latest_processed_subscription_event_created_at,
            max_services, max_users, max_deployments_per_month, xmin::text AS xmin
     FROM organizations WHERE id = $1`,
    [orgId]
  );
  return rows[0];
}

function mockReqRes(body: any, organizationId: string, role: string = 'owner') {
  const req = {
    user: { organizationId, email: `owner-${uniqueSuffix()}@example.com`, role },
    body,
  } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

// Monotonically increasing default for fabricated events' Stripe Event
// envelope `created` (Unix seconds) -- StripeController.dispatchWebhookEvent
// now feeds this into the subscription-ordering high-water mark
// (organizations.latest_processed_subscription_event_created_at), so two
// fakeEvent() calls in the same test must not silently collide on the same
// second the way two calls in the same real millisecond otherwise would.
// Incrementing per call guarantees call order == event.created order unless
// a test explicitly overrides `createdAt` to test reordering/ties.
let nextEventCreatedAtSeconds = Math.floor(Date.now() / 1000);

function fakeEvent(type: string, object: any, createdAt?: number) {
  const created = createdAt ?? nextEventCreatedAtSeconds++;
  return { id: `evt_test_${uniqueSuffix()}`, type, data: { object }, created };
}

function mockWebhookReqRes(event: any) {
  const req = {
    headers: { 'stripe-signature': 'test-signature' },
    body: Buffer.from(JSON.stringify(event)),
  } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

async function deliverWebhook(event: any) {
  jest.spyOn(stripeService, 'verifyWebhookSignature').mockReturnValue(event as any);
  const { req, res, status, json } = mockWebhookReqRes(event);
  await stripeController.handleWebhook(req, res);
  return { status, json };
}

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('immediate cancellation -- synchronous entitlement transition', () => {
  it('a successful immediate cancellation downgrades tier/limits to free synchronously, before any webhook', async () => {
    const { orgId, subscriptionId } = await insertOrgWithSubscription('pro');
    jest.spyOn(stripeService, 'cancelSubscription').mockResolvedValue({
      status: 'canceled',
      cancel_at_period_end: false,
      cancel_at: null,
    } as any);

    const { req, res, status } = mockReqRes({ immediate: true }, orgId);
    await stripeController.cancelSubscription(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(status).not.toHaveBeenCalledWith(500);
    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('free');
    expect(row.subscription_status).toBe('canceled');
    expect(row.max_services).toBe(TIER_LIMITS.free.maxServices);
    expect(row.max_users).toBe(TIER_LIMITS.free.maxUsers);
    expect(row.max_deployments_per_month).toBe(TIER_LIMITS.free.maxDeploymentsPerMonth);
    void subscriptionId;
  });

  it('cancel-at-period-end does NOT downgrade tier synchronously -- access correctly continues until the period ends', async () => {
    const { orgId } = await insertOrgWithSubscription('pro');
    jest.spyOn(stripeService, 'cancelSubscriptionAtPeriodEnd').mockResolvedValue({
      status: 'active',
      cancel_at_period_end: true,
      cancel_at: Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60,
    } as any);

    const { req, res } = mockReqRes({ immediate: false }, orgId);
    await stripeController.cancelSubscription(req, res);

    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('pro'); // unchanged
    expect(row.subscription_cancel_at_period_end).toBe(true);
  });

  it('a failed Stripe cancellation leaves local tier/status completely unchanged', async () => {
    const { orgId } = await insertOrgWithSubscription('pro');
    const before = await fetchOrgRow(orgId);
    jest.spyOn(stripeService, 'cancelSubscription').mockRejectedValue(new Error('Stripe API unavailable'));

    const { req, res, status } = mockReqRes({ immediate: true }, orgId);
    await stripeController.cancelSubscription(req, res);

    expect(status).toHaveBeenCalledWith(500);
    const after = await fetchOrgRow(orgId);
    expect(after).toEqual(before); // no partial mutation at all
  });

  it('member/viewer cannot trigger the cancellation or its entitlement transition (403, Stripe never called)', async () => {
    const { orgId } = await insertOrgWithSubscription('pro');
    const before = await fetchOrgRow(orgId);
    const spy = jest.spyOn(stripeService, 'cancelSubscription');

    const { req, res, status } = mockReqRes({ immediate: true }, orgId, 'member');
    await stripeController.cancelSubscription(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(spy).not.toHaveBeenCalled();
    expect(await fetchOrgRow(orgId)).toEqual(before);
  });
});

describe('duplicate cancellation requests are safe', () => {
  it('a second immediate-cancel request after the first succeeded is a no-op that never calls Stripe again', async () => {
    const { orgId } = await insertOrgWithSubscription('pro');
    const spy = jest.spyOn(stripeService, 'cancelSubscription').mockResolvedValue({
      status: 'canceled',
      cancel_at_period_end: false,
      cancel_at: null,
    } as any);

    const first = mockReqRes({ immediate: true }, orgId);
    await stripeController.cancelSubscription(first.req, first.res);
    expect(spy).toHaveBeenCalledTimes(1);
    const afterFirst = await fetchOrgRow(orgId);
    expect(afterFirst.subscription_tier).toBe('free');

    const second = mockReqRes({ immediate: true }, orgId);
    await stripeController.cancelSubscription(second.req, second.res);

    expect(spy).toHaveBeenCalledTimes(1); // still just once
    expect(second.status).not.toHaveBeenCalledWith(400);
    expect(second.status).not.toHaveBeenCalledWith(500);
    expect(second.json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ status: 'canceled' }),
    }));
    const afterSecond = await fetchOrgRow(orgId);
    expect(afterSecond.subscription_tier).toBe('free');
  });

  it('a repeated cancel-at-period-end request is naturally safe (Stripe-side idempotent, no special-casing needed)', async () => {
    const { orgId } = await insertOrgWithSubscription('pro');
    const spy = jest.spyOn(stripeService, 'cancelSubscriptionAtPeriodEnd').mockResolvedValue({
      status: 'active',
      cancel_at_period_end: true,
      cancel_at: null,
    } as any);

    const first = mockReqRes({ immediate: false }, orgId);
    await stripeController.cancelSubscription(first.req, first.res);
    const second = mockReqRes({ immediate: false }, orgId);
    await stripeController.cancelSubscription(second.req, second.res);

    expect(spy).toHaveBeenCalledTimes(2); // both reach Stripe -- that's fine, Stripe itself is idempotent here
    const row = await fetchOrgRow(orgId);
    expect(row.subscription_cancel_at_period_end).toBe(true);
    expect(row.subscription_tier).toBe('pro');
  });
});

describe('customer.subscription.deleted -- reconciliation after a synchronous cancellation', () => {
  it('arriving AFTER the synchronous update is a safe no-op (tier/limits already correct, not re-derived incorrectly)', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('pro');
    jest.spyOn(stripeService, 'cancelSubscription').mockResolvedValue({
      status: 'canceled',
      cancel_at_period_end: false,
      cancel_at: null,
    } as any);
    const { req, res } = mockReqRes({ immediate: true }, orgId);
    await stripeController.cancelSubscription(req, res);
    const afterSync = await fetchOrgRow(orgId);
    expect(afterSync.subscription_tier).toBe('free');

    const event = fakeEvent('customer.subscription.deleted', { id: subscriptionId, customer: customerId, status: 'canceled' });
    const { status } = await deliverWebhook(event);

    expect(status).not.toHaveBeenCalledWith(400);
    const afterWebhook = await fetchOrgRow(orgId);
    expect(afterWebhook.subscription_tier).toBe('free');
    expect(afterWebhook.max_services).toBe(TIER_LIMITS.free.maxServices);
  });

  it('arriving WITHOUT any prior synchronous update still converges correctly on its own', async () => {
    // Simulates the synchronous DB write never happening at all (e.g. a
    // crash between the Stripe API call succeeding and that write) --
    // the webhook must be a fully independent, complete correction path.
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('pro');
    const event = fakeEvent('customer.subscription.deleted', { id: subscriptionId, customer: customerId, status: 'canceled' });

    const { status } = await deliverWebhook(event);

    expect(status).not.toHaveBeenCalledWith(400);
    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('free');
    expect(row.max_services).toBe(TIER_LIMITS.free.maxServices);
  });

  it('a duplicate customer.subscription.deleted delivery after reconciliation is also a safe no-op', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('starter');
    const event = fakeEvent('customer.subscription.deleted', { id: subscriptionId, customer: customerId, status: 'canceled' });

    await deliverWebhook(event);
    const afterFirst = await fetchOrgRow(orgId);
    expect(afterFirst.subscription_tier).toBe('free');

    await deliverWebhook(event);
    const afterSecond = await fetchOrgRow(orgId);
    expect(afterSecond.subscription_tier).toBe('free');
    expect(afterSecond.max_services).toBe(TIER_LIMITS.free.maxServices);
  });
});

describe('customer.subscription.updated cannot resurrect paid entitlement for a terminated subscription', () => {
  it('status=canceled resolves to free even though `items` still references the old paid price', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('pro');
    jest.spyOn(stripeService, 'cancelSubscription').mockResolvedValue({
      status: 'canceled',
      cancel_at_period_end: false,
      cancel_at: null,
    } as any);
    const { req, res } = mockReqRes({ immediate: true }, orgId);
    await stripeController.cancelSubscription(req, res);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('free');

    // Stripe's own customer.subscription.updated for the status transition,
    // still carrying the old (never-changed) price -- exactly what Stripe
    // sends alongside/around customer.subscription.deleted.
    const subscription = {
      id: subscriptionId,
      customer: customerId,
      status: 'canceled',
      items: { data: [{ price: { id: 'price_old_pro_price_still_referenced' } }] },
      cancel_at_period_end: false,
    };
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro'); // would resolve to 'pro' if status were ignored

    const event = fakeEvent('customer.subscription.updated', subscription);
    const { status } = await deliverWebhook(event);

    expect(status).not.toHaveBeenCalledWith(400);
    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('free'); // NOT resurrected to 'pro'
    expect(row.max_services).toBe(TIER_LIMITS.free.maxServices);
  });

  it('status=canceled resolves to free even with no prior synchronous cancellation at all (webhook-only path)', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('enterprise');
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('enterprise');

    const subscription = {
      id: subscriptionId,
      customer: customerId,
      status: 'canceled',
      items: { data: [{ price: { id: 'price_old_enterprise_price' } }] },
      cancel_at_period_end: false,
    };
    const event = fakeEvent('customer.subscription.updated', subscription);
    await deliverWebhook(event);

    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('free');
  });

  it('status=incomplete_expired also resolves to free, not the referenced price\'s tier', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('free');
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('starter');

    const subscription = {
      id: subscriptionId,
      customer: customerId,
      status: 'incomplete_expired',
      items: { data: [{ price: { id: 'price_starter' } }] },
      cancel_at_period_end: false,
    };
    const event = fakeEvent('customer.subscription.updated', subscription);
    await deliverWebhook(event);

    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('free');
  });

  it('regression: a normal active-status update still resolves tier from price exactly as before', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('free');
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('starter');

    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: subscriptionId,
      customer: customerId,
      status: 'active',
      items: { data: [{ price: { id: 'price_starter' } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };
    const event = fakeEvent('customer.subscription.updated', subscription);
    await deliverWebhook(event);

    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('starter');
    expect(row.max_services).toBe(TIER_LIMITS.starter.maxServices);
  });

  it('regression: past_due does not get forced to free -- grace-period tier retention is unaffected by this fix', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('pro');
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');

    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: subscriptionId,
      customer: customerId,
      status: 'past_due',
      items: { data: [{ price: { id: 'price_pro' } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };
    const event = fakeEvent('customer.subscription.updated', subscription);
    await deliverWebhook(event);

    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('pro'); // retained -- access restriction is billing_lifecycle_state's job, not this
  });
});

describe('resume behavior is unaffected', () => {
  it('cancel-at-period-end followed by resume never touches tier at any point', async () => {
    const { orgId, subscriptionId } = await insertOrgWithSubscription('pro');
    jest.spyOn(stripeService, 'cancelSubscriptionAtPeriodEnd').mockResolvedValue({
      status: 'active',
      cancel_at_period_end: true,
      cancel_at: null,
    } as any);
    const { req, res } = mockReqRes({ immediate: false }, orgId);
    await stripeController.cancelSubscription(req, res);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('pro');

    jest.spyOn(stripeService, 'resumeSubscription').mockResolvedValue({ status: 'active' } as any);
    const resumeReq = { user: { organizationId: orgId, role: 'owner' } } as unknown as Request;
    const resumeJson = jest.fn();
    const resumeRes = { json: resumeJson, status: jest.fn().mockReturnValue({ json: resumeJson }) } as unknown as Response;
    await stripeController.resumeSubscription(resumeReq, resumeRes);

    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('pro');
    expect(row.subscription_cancel_at_period_end).toBe(false);
    void subscriptionId;
  });
});

/**
 * P1 -- subscription-event ordering (organizations.latest_processed_
 * subscription_event_created_at). Closes the follow-on race the
 * customer.subscription.updated/deleted content-based terminal-status check
 * above cannot: a STALE event whose own payload is a perfectly valid,
 * non-terminal snapshot from BEFORE a cancellation/resubscription that has
 * since happened elsewhere. See database/migrations-admin/
 * 202608312300_add_subscription_event_ordering.sql and
 * StripeService.updateOrganizationSubscription for the full design.
 */
function subscriptionPayload(subscriptionId: string, customerId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: subscriptionId,
    customer: customerId,
    status: 'active',
    items: { data: [{ price: { id: 'price_pro' } }] },
    cancel_at_period_end: false,
    ...overrides,
  };
}

describe('stale customer.subscription.updated cannot resurrect entitlement (event-ordering guard)', () => {
  it('stale active update after immediate (synchronous) cancellation cannot restore paid tier', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('pro');
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');

    // Synchronous cancellation happens first -- asOf: new Date(), i.e. "now".
    jest.spyOn(stripeService, 'cancelSubscription').mockResolvedValue({
      status: 'canceled', cancel_at_period_end: false, cancel_at: null,
    } as any);
    const { req, res } = mockReqRes({ immediate: true }, orgId);
    await stripeController.cancelSubscription(req, res);
    const afterCancel = await fetchOrgRow(orgId);
    expect(afterCancel.subscription_tier).toBe('free');
    const markAfterCancel = new Date(afterCancel.latest_processed_subscription_event_created_at).getTime();

    // A stale event generated well BEFORE that synchronous call -- the
    // fakeEvent monotonic counter would otherwise make this LATER, so we
    // explicitly force it into the past relative to the mark just set.
    // Carries a DIFFERENT (old, pre-cancellation) subscription id so a
    // resurrection would also be visible as stripe_subscription_id reverting.
    const staleCreated = Math.floor(markAfterCancel / 1000) - 3600;
    const staleSubId = `sub_stale_${uniqueSuffix()}`;
    const event = fakeEvent('customer.subscription.updated', subscriptionPayload(staleSubId, customerId, { status: 'active' }), staleCreated);
    const { status } = await deliverWebhook(event);

    expect(status).not.toHaveBeenCalledWith(400);
    const after = await fetchOrgRow(orgId);
    expect(after.subscription_tier).toBe('free'); // NOT resurrected
    expect(after.subscription_status).toBe('canceled'); // NOT overwritten to stale 'active'
    expect(after.stripe_subscription_id).toBe(subscriptionId); // NOT reverted/changed by the stale event's id
    expect(new Date(after.latest_processed_subscription_event_created_at).getTime()).toBe(markAfterCancel); // mark unmoved
  });

  it('stale active update arriving after customer.subscription.deleted cannot restore paid tier', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('pro');
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');

    const deletedEvent = fakeEvent('customer.subscription.deleted', subscriptionPayload(subscriptionId, customerId, { status: 'canceled' }));
    await deliverWebhook(deletedEvent);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('free');

    const staleCreated = (deletedEvent as any).created - 3600;
    const staleUpdate = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), staleCreated);
    const { status } = await deliverWebhook(staleUpdate);

    expect(status).not.toHaveBeenCalledWith(400);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('free');
  });

  it('customer.subscription.deleted arriving after an older stale updated (processed first) still leaves the organization free', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('free');
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');

    // The "stale" update is actually the FIRST event this org has ever
    // received (mark is NULL), so it is legitimately accepted -- this is
    // the documented, accepted transient-window limitation: a stale event
    // processed before anything else establishes the mark can briefly
    // apply. The subsequent, chronologically-later .deleted still corrects
    // it, exactly as the pre-existing invoice mechanism accepts the same
    // class of transient window.
    const oldUpdate = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }));
    await deliverWebhook(oldUpdate);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('pro'); // transiently applied

    const newerDeleted = fakeEvent('customer.subscription.deleted', subscriptionPayload(subscriptionId, customerId, { status: 'canceled' }));
    await deliverWebhook(newerDeleted);

    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('free'); // corrected
  });

  it('subscription.updated arriving after deleted with an older event.created is rejected (explicit timestamp ordering)', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('pro');
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');

    const t0 = Math.floor(Date.now() / 1000);
    const deletedEvent = fakeEvent('customer.subscription.deleted', subscriptionPayload(subscriptionId, customerId, { status: 'canceled' }), t0 + 10);
    await deliverWebhook(deletedEvent);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('free');

    const olderUpdate = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), t0 + 5);
    await deliverWebhook(olderUpdate);

    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('free');
  });

  it('duplicate customer.subscription.updated (same event redelivered) is harmless', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('free');
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('starter');

    const event = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }));
    await deliverWebhook(event);
    const afterFirst = await fetchOrgRow(orgId);
    expect(afterFirst.subscription_tier).toBe('starter');

    // Same event.id -> the PR #20 ledger's already_processed short-circuit
    // is what actually stops the second delivery from re-running the
    // handler at all -- included here to prove that layering doesn't
    // change entitlement outcome either.
    const { json } = await deliverWebhook(event);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ duplicate: true }));
    const afterSecond = await fetchOrgRow(orgId);
    expect(afterSecond.subscription_tier).toBe('starter');
  });

  it('duplicate customer.subscription.deleted at the exact same event.created (allowTie) is harmless', async () => {
    // Distinct from the ledger-level duplicate test above: this exercises
    // the ordering CAS's own allowTie=true branch directly, simulating two
    // DIFFERENT event ids that happen to carry the identical Event.created
    // -- e.g. Stripe's own .updated/.deleted pair from one cancellation,
    // approximated here with two .deleted-shaped calls at one timestamp.
    const { orgId } = await insertOrgWithSubscription('pro');
    const asOf = new Date();

    const first = await stripeService.updateOrganizationSubscription(orgId, {
      status: 'canceled', tier: 'free', cancelAtPeriodEnd: false,
    }, { asOf, allowTie: true });
    const second = await stripeService.updateOrganizationSubscription(orgId, {
      status: 'canceled', tier: 'free', cancelAtPeriodEnd: false,
    }, { asOf, allowTie: true });

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(true); // tie accepted for deletion -- idempotent, both land on the same state
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('free');
  });

  it('two updated events arriving in reverse delivery order converge to the newer event', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('free');
    const t0 = Math.floor(Date.now() / 1000);

    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValueOnce('enterprise').mockReturnValueOnce('starter');
    const newerEvent = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), t0 + 20);
    const olderEvent = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), t0 + 10);

    // Delivered newer-first, older-second -- the reverse of generation
    // order, exactly the kind of reordering Stripe explicitly does not
    // rule out.
    await deliverWebhook(newerEvent);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('enterprise');

    await deliverWebhook(olderEvent);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('enterprise'); // NOT overwritten by the older, later-delivered event
  });

  it('equal-timestamp updated vs updated is deterministic (first-processed wins, tie rejected)', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('free');
    const tie = Math.floor(Date.now() / 1000) + 100;

    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValueOnce('starter').mockReturnValueOnce('enterprise');
    const eventA = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), tie);
    const eventB = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), tie);

    await deliverWebhook(eventA);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('starter');

    await deliverWebhook(eventB);
    // Strict `>` comparison: a second .updated at the IDENTICAL timestamp
    // as the one already recorded is a tie -> rejected, not applied.
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('starter');
  });

  it('equal-timestamp updated vs deleted results in deleted winning (free)', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('pro');
    const tie = Math.floor(Date.now() / 1000) + 200;

    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');
    const updatedEvent = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), tie);
    const deletedEvent = fakeEvent('customer.subscription.deleted', subscriptionPayload(subscriptionId, customerId, { status: 'canceled' }), tie);

    await deliverWebhook(updatedEvent);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('pro');

    await deliverWebhook(deletedEvent);
    // allowTie=true for deletion: an equal timestamp still wins.
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('free');
  });

  it('a stale updated arriving at the SAME timestamp as an already-applied deletion cannot undo it (deletion dominance)', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('pro');
    const tie = Math.floor(Date.now() / 1000) + 300;

    const deletedEvent = fakeEvent('customer.subscription.deleted', subscriptionPayload(subscriptionId, customerId, { status: 'canceled' }), tie);
    await deliverWebhook(deletedEvent);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('free');

    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');
    const updatedAtSameTie = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), tie);
    await deliverWebhook(updatedAtSameTie);

    // Strict `<` for .updated: a tie against the mark is rejected, not
    // accepted -- deletion's tie-win is one-directional.
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('free');
  });
});

describe('fresh and ordered subscription.updated deliveries (baseline, non-stale cases)', () => {
  it('a fresh active update with no prior mark is accepted, resolves the correct tier, and sets the mark', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('free');
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('starter');

    const before = await fetchOrgRow(orgId);
    expect(before.latest_processed_subscription_event_created_at).toBeNull();

    const event = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }));
    await deliverWebhook(event);

    const after = await fetchOrgRow(orgId);
    expect(after.subscription_tier).toBe('starter');
    expect(after.latest_processed_subscription_event_created_at).not.toBeNull();
    expect(new Date(after.latest_processed_subscription_event_created_at).getTime()).toBe((event as any).created * 1000);
  });

  it('an ordered upgrade chain (free -> starter -> pro) with strictly increasing timestamps is fully accepted at each step', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('free');
    const t0 = Math.floor(Date.now() / 1000);

    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValueOnce('starter').mockReturnValueOnce('pro');

    const toStarter = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), t0 + 10);
    await deliverWebhook(toStarter);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('starter');

    const toPro = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), t0 + 20);
    await deliverWebhook(toPro);
    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('pro');
    expect(new Date(row.latest_processed_subscription_event_created_at).getTime()).toBe((t0 + 20) * 1000);
  });

  it('an ordered downgrade (pro -> starter -> free) with strictly increasing timestamps is fully accepted at each step', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('pro');
    const t0 = Math.floor(Date.now() / 1000);

    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValueOnce('starter').mockReturnValueOnce('free');

    const toStarter = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), t0 + 10);
    await deliverWebhook(toStarter);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('starter');

    const toFree = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), t0 + 20);
    await deliverWebhook(toFree);
    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('free');
    expect(new Date(row.latest_processed_subscription_event_created_at).getTime()).toBe((t0 + 20) * 1000);
  });

  it('immediate cancellation synchronously sets free and advances the ordering mark', async () => {
    const { orgId } = await insertOrgWithSubscription('pro');
    jest.spyOn(stripeService, 'cancelSubscription').mockResolvedValue({
      status: 'canceled', cancel_at_period_end: false, cancel_at: null,
    } as any);

    const before = await fetchOrgRow(orgId);
    expect(before.latest_processed_subscription_event_created_at).toBeNull();

    const { req, res } = mockReqRes({ immediate: true }, orgId);
    await stripeController.cancelSubscription(req, res);

    const after = await fetchOrgRow(orgId);
    expect(after.subscription_tier).toBe('free');
    expect(after.latest_processed_subscription_event_created_at).not.toBeNull();
  });
});

describe('concurrent subscription-event processing (real database-backed race)', () => {
  it('concurrent updated + deleted for the same organization converge to the newer event, never resurrecting entitlement', async () => {
    const { orgId, subscriptionId, customerId } = await insertOrgWithSubscription('pro');
    const t0 = Math.floor(Date.now() / 1000);
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');

    const staleUpdate = fakeEvent('customer.subscription.updated', subscriptionPayload(subscriptionId, customerId, { status: 'active' }), t0 + 10);
    const newerDeleted = fakeEvent('customer.subscription.deleted', subscriptionPayload(subscriptionId, customerId, { status: 'canceled' }), t0 + 20);

    // Genuinely concurrent: each deliverWebhook() call does its own
    // pool.connect() and races against the other on Postgres's own row
    // lock for this UPDATE -- not two sequential awaits. Fired in the
    // "wrong" (stale-first) order deliberately; the assertion is that the
    // OUTCOME depends on event.created, not firing order.
    const [updateResult, deleteResult] = await Promise.all([
      deliverWebhook(staleUpdate),
      deliverWebhook(newerDeleted),
    ]);

    expect(updateResult.status).not.toHaveBeenCalledWith(400);
    expect(deleteResult.status).not.toHaveBeenCalledWith(400);

    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('free'); // the newer (deleted) event always wins, regardless of race outcome
    expect(new Date(row.latest_processed_subscription_event_created_at).getTime()).toBe((t0 + 20) * 1000);
  });

  it('PostgreSQL row-level serialization: two directly-concurrent updateOrganizationSubscription calls on the same org never both apply out of order', async () => {
    const { orgId } = await insertOrgWithSubscription('free');
    const t0 = Math.floor(Date.now() / 1000);

    // Two genuinely concurrent calls (no await between them), older one
    // fired "first" in program order but must not win because its asOf is
    // earlier. Both share the same `pool` -- pg's connection pool hands out
    // two separate physical connections for these two concurrent queries,
    // so this exercises real Postgres row-locking, not JS-level sequencing.
    const [olderResult, newerResult] = await Promise.all([
      stripeService.updateOrganizationSubscription(orgId, { tier: 'starter' }, { asOf: new Date((t0 + 5) * 1000) }),
      stripeService.updateOrganizationSubscription(orgId, { tier: 'enterprise' }, { asOf: new Date((t0 + 50) * 1000) }),
    ]);

    // Whichever statement's transaction actually committed first, the
    // final row state must reflect the LATER asOf -- Postgres's row lock
    // serializes the two UPDATEs, and each one's WHERE clause is evaluated
    // against whatever the row holds at the moment it actually runs, not
    // at the moment it was issued.
    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('enterprise');
    expect(new Date(row.latest_processed_subscription_event_created_at).getTime()).toBe((t0 + 50) * 1000);
    // Sanity: not both could have been rejected, and not both could have
    // "won" -- exactly one CAS matched the stale write depending on commit
    // order, but the row's FINAL state is unambiguous regardless.
    expect(olderResult.applied || newerResult.applied).toBe(true);
  });
});

describe('resubscription: an old subscription cannot interfere with a newer one', () => {
  it('a delayed event from a canceled old subscription cannot overwrite tier, status, stripe_subscription_id, period fields, or cancellation state established by a newer resubscription', async () => {
    const { orgId, subscriptionId: subOld, customerId } = await insertOrgWithSubscription('pro');
    const t0 = Math.floor(Date.now() / 1000);

    // sub_old is canceled.
    const oldDeleted = fakeEvent('customer.subscription.deleted', subscriptionPayload(subOld, customerId, { status: 'canceled' }), t0);
    await deliverWebhook(oldDeleted);
    expect((await fetchOrgRow(orgId)).subscription_tier).toBe('free');

    // Customer resubscribes: a brand new Subscription object, same Stripe
    // Customer. Modeled as customer.subscription.created, which routes
    // through the same handleSubscriptionUpdated path as .updated.
    const subNew = `sub_new_${uniqueSuffix()}`;
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');
    const periodStart = t0 + 100;
    const periodEnd = t0 + 100 + 30 * 24 * 60 * 60;
    const created = fakeEvent(
      'customer.subscription.created',
      subscriptionPayload(subNew, customerId, {
        status: 'active',
        current_period_start: periodStart,
        current_period_end: periodEnd,
      }),
      t0 + 100
    );
    await deliverWebhook(created);
    const afterResubscribe = await fetchOrgRow(orgId);
    expect(afterResubscribe.subscription_tier).toBe('pro');
    expect(afterResubscribe.stripe_subscription_id).toBe(subNew);

    // A long-delayed redelivery of a stale sub_old event -- generated
    // BEFORE sub_old's own cancellation, so its event.created necessarily
    // predates everything above. Different subscription id, SAME Stripe
    // customer (as a real resubscription would be).
    const staleOldEvent = fakeEvent(
      'customer.subscription.updated',
      subscriptionPayload(subOld, customerId, {
        status: 'past_due', // deliberately different from the real current status ('active') so this assertion is diagnostic, not coincidental
        current_period_start: t0 - 500,
        current_period_end: t0 - 200,
        cancel_at_period_end: true,
      }),
      t0 - 50
    );
    const { status } = await deliverWebhook(staleOldEvent);
    expect(status).not.toHaveBeenCalledWith(400);

    const final = await fetchOrgRow(orgId);
    expect(final.subscription_tier).toBe('pro'); // untouched
    expect(final.subscription_status).toBe('active'); // NOT overwritten to stale 'past_due'
    expect(final.stripe_subscription_id).toBe(subNew); // NOT reverted to sub_old
    expect(new Date(final.subscription_current_period_start).getTime()).toBe(periodStart * 1000); // NOT overwritten
    expect(new Date(final.subscription_current_period_end).getTime()).toBe(periodEnd * 1000); // NOT overwritten
    expect(final.subscription_cancel_at_period_end).toBe(false); // NOT flipped to true by the stale event
  });

  it('checkout.session.completed establishes a fresh projection correctly and advances the mark', async () => {
    const { orgId, customerId } = await insertOrgWithSubscription('free');
    const newSubId = `sub_checkout_${uniqueSuffix()}`;
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue({
      id: newSubId,
      status: 'active',
      items: { data: [{ price: { id: 'price_starter' } }] },
      cancel_at_period_end: false,
    } as any);
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('starter');

    const session = { metadata: { organizationId: orgId }, customer: customerId, subscription: newSubId };
    const event = fakeEvent('checkout.session.completed', session);
    const { status } = await deliverWebhook(event);

    expect(status).not.toHaveBeenCalledWith(400);
    const row = await fetchOrgRow(orgId);
    expect(row.subscription_tier).toBe('starter');
    expect(row.stripe_subscription_id).toBe(newSubId);
    expect(row.latest_processed_subscription_event_created_at).not.toBeNull();
  });
});
