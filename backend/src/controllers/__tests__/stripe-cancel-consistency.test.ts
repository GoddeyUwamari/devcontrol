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

function fakeEvent(type: string, object: any) {
  return { id: `evt_test_${uniqueSuffix()}`, type, data: { object } };
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
