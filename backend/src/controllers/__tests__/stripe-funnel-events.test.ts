/**
 * Focused coverage for the two P0 billing funnel events:
 *
 *   checkout_started        -- StripeController.createCheckoutSession
 *   subscription_activated  -- StripeController.handleCheckoutSessionCompleted
 *
 * Same pattern as stripe-checkout-session.security.test.ts and
 * stripe-webhook-entitlement-sync.test.ts: real Postgres for the
 * organization row and the analytics_events assertions, jest.spyOn on the
 * actual Stripe-network-touching service methods (createCheckoutSession,
 * verifyWebhookSignature, getSubscription) so the Stripe SDK itself is
 * never exercised, while the controller's own validation/price-resolution/
 * entitlement logic all runs for real.
 */
import { Request, Response } from 'express';
import { Pool } from 'pg';
import { stripeController } from '../stripe.controller';
import stripeService from '../../services/stripe.service';

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

// Hermetic price-env seeding -- same rationale as the two files this test
// mirrors: CI sets no real STRIPE_* vars, backend/.env is git-ignored, so
// resolution must go through fake-but-real env vars, never assumed config.
const FAKE_PRICE_ENV: Record<string, string> = {
  STRIPE_PRICE_STARTER_MONTHLY: 'price_test_fake_starter_monthly_funnel',
  STRIPE_PRICE_PRO_MONTHLY: 'price_test_fake_pro_monthly_funnel',
};
const originalPriceEnv: Record<string, string | undefined> = {};
for (const [envVar, fakeValue] of Object.entries(FAKE_PRICE_ENV)) {
  originalPriceEnv[envVar] = process.env[envVar];
  process.env[envVar] = fakeValue;
}

const STARTER_PRICE_ID = stripeService.getPriceIdForPlan('starter', 'monthly');
const PRO_PRICE_ID = stripeService.getPriceIdForPlan('pro', 'monthly');

const createdOrgIds: string[] = [];
const createdUserIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// analytics_events.user_id is a real FK to users(id) -- a fabricated string
// fails the insert's uuid cast/FK check entirely, so every test needs a
// real users row.
async function insertUser(): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name) VALUES ($1, 'x', 'Stripe Funnel User') RETURNING id`,
    [`stripe-funnel-${suffix}@example.com`]
  );
  createdUserIds.push(rows[0].id);
  return rows[0].id as string;
}

async function insertOrg(overrides: { tier?: string; status?: string; stripeCustomerId?: string } = {}): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status, stripe_customer_id)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING id`,
    [
      `Stripe Funnel Org ${suffix}`,
      `stripe-funnel-org-${suffix}`,
      `Stripe Funnel Org ${suffix}`,
      overrides.tier ?? 'free',
      overrides.status ?? 'free',
      overrides.stripeCustomerId ?? null,
    ]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function fetchEvents(orgId: string, eventName: string) {
  const { rows } = await pool.query(
    `SELECT * FROM analytics_events WHERE organization_id = $1 AND event_name = $2 ORDER BY created_at ASC`,
    [orgId, eventName]
  );
  return rows;
}

function mockCheckoutReqRes(body: any, organizationId: string, userId: string) {
  const req = {
    user: { organizationId, userId, email: `owner-${uniqueSuffix()}@example.com`, role: 'owner' },
    body,
  } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

let nextEventCreatedAtSeconds = Math.floor(Date.now() / 1000);

function fakeEvent(type: string, object: any) {
  const created = nextEventCreatedAtSeconds++;
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

function stubSignatureVerification(event: any) {
  return jest.spyOn(stripeService, 'verifyWebhookSignature').mockReturnValue(event as any);
}

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  for (const [envVar, original] of Object.entries(originalPriceEnv)) {
    if (original !== undefined) process.env[envVar] = original;
    else delete process.env[envVar];
  }
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
  await pool.end();
});

describe('createCheckoutSession -> checkout_started', () => {
  it('emits checkout_started only after Stripe actually creates the session', async () => {
    const orgId = await insertOrg({ stripeCustomerId: `cus_test_${uniqueSuffix()}` });
    const userId = await insertUser();
    const createSpy = jest.spyOn(stripeService, 'createCheckoutSession').mockResolvedValue({
      id: `cs_test_${uniqueSuffix()}`,
      url: 'https://checkout.stripe.com/test-session',
    } as any);

    const { req, res, status } = mockCheckoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId, userId);
    await stripeController.createCheckoutSession(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(status).not.toHaveBeenCalledWith(500);
    expect(createSpy).toHaveBeenCalled();

    const rows = await fetchEvents(orgId, 'checkout_started');
    expect(rows).toHaveLength(1);
    expect(rows[0].properties).toEqual({ tier: 'starter', billingInterval: 'monthly' });
  });

  it('does NOT emit checkout_started merely because the endpoint was requested (invalid tier rejected before Stripe is ever called)', async () => {
    const orgId = await insertOrg({ stripeCustomerId: `cus_test_${uniqueSuffix()}` });
    const createSpy = jest.spyOn(stripeService, 'createCheckoutSession');

    const { req, res, status } = mockCheckoutReqRes({ tier: 'not-a-real-tier', billingInterval: 'monthly' }, orgId, await insertUser());
    await stripeController.createCheckoutSession(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(createSpy).not.toHaveBeenCalled();
    expect(await fetchEvents(orgId, 'checkout_started')).toHaveLength(0);
  });

  it('a second, distinct checkout attempt is a legitimate separate event -- not deduped', async () => {
    const orgId = await insertOrg({ stripeCustomerId: `cus_test_${uniqueSuffix()}` });
    jest.spyOn(stripeService, 'createCheckoutSession').mockResolvedValue({
      id: `cs_test_${uniqueSuffix()}`,
      url: 'https://checkout.stripe.com/test-session',
    } as any);

    const sharedUserId = await insertUser();
    const first = mockCheckoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId, sharedUserId);
    await stripeController.createCheckoutSession(first.req, first.res);

    const second = mockCheckoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId, sharedUserId);
    await stripeController.createCheckoutSession(second.req, second.res);

    const rows = await fetchEvents(orgId, 'checkout_started');
    expect(rows).toHaveLength(2);
  });
});

describe('checkout.session.completed webhook -> subscription_activated', () => {
  it('a genuine free -> starter transition emits subscription_activated exactly once', async () => {
    const customerId = `cus_test_${uniqueSuffix()}`;
    const orgId = await insertOrg({ tier: 'free', status: 'free', stripeCustomerId: customerId });

    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: subscriptionId,
      customer: customerId,
      status: 'active',
      items: { data: [{ price: { id: STARTER_PRICE_ID } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(subscription as any);

    const session = { metadata: { organizationId: orgId }, customer: customerId, subscription: subscriptionId };
    const event = fakeEvent('checkout.session.completed', session);
    stubSignatureVerification(event);
    const { req, res, status, json } = mockWebhookReqRes(event);

    await stripeController.handleWebhook(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });

    const rows = await fetchEvents(orgId, 'subscription_activated');
    expect(rows).toHaveLength(1);
    expect(rows[0].properties).toEqual({ tier: 'starter' });
  });

  it('a redelivered webhook for a checkout already applied does NOT emit a second subscription_activated', async () => {
    const customerId = `cus_test_${uniqueSuffix()}`;
    const orgId = await insertOrg({ tier: 'free', status: 'free', stripeCustomerId: customerId });

    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: subscriptionId,
      customer: customerId,
      status: 'active',
      items: { data: [{ price: { id: PRO_PRICE_ID } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(subscription as any);

    const session = { metadata: { organizationId: orgId }, customer: customerId, subscription: subscriptionId };

    const firstEvent = fakeEvent('checkout.session.completed', session);
    stubSignatureVerification(firstEvent);
    const first = mockWebhookReqRes(firstEvent);
    await stripeController.handleWebhook(first.req, first.res);

    // Redelivery: same underlying checkout session completed again (Stripe
    // guarantees at-least-once delivery). The org is already on 'pro' from
    // the first delivery, so this must NOT look like a fresh activation.
    const secondEvent = fakeEvent('checkout.session.completed', session);
    stubSignatureVerification(secondEvent);
    const second = mockWebhookReqRes(secondEvent);
    await stripeController.handleWebhook(second.req, second.res);

    const rows = await fetchEvents(orgId, 'subscription_activated');
    expect(rows).toHaveLength(1);
  });

  it('an org already on a paid tier going through checkout again (e.g. re-adding a card) does not double-count as activation', async () => {
    const customerId = `cus_test_${uniqueSuffix()}`;
    // Already paying -- not a free/non-paying org.
    const orgId = await insertOrg({ tier: 'pro', status: 'active', stripeCustomerId: customerId });

    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: subscriptionId,
      customer: customerId,
      status: 'active',
      items: { data: [{ price: { id: PRO_PRICE_ID } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(subscription as any);

    const session = { metadata: { organizationId: orgId }, customer: customerId, subscription: subscriptionId };
    const event = fakeEvent('checkout.session.completed', session);
    stubSignatureVerification(event);
    const { req, res } = mockWebhookReqRes(event);

    await stripeController.handleWebhook(req, res);

    expect(await fetchEvents(orgId, 'subscription_activated')).toHaveLength(0);
  });

  it('customer.subscription.updated (a renewal/update, never a Checkout completion) never emits subscription_activated', async () => {
    const customerId = `cus_test_${uniqueSuffix()}`;
    const orgId = await insertOrg({ tier: 'pro', status: 'active', stripeCustomerId: customerId });

    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: `sub_test_${uniqueSuffix()}`,
      customer: customerId,
      status: 'active',
      items: { data: [{ price: { id: PRO_PRICE_ID } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };
    const event = fakeEvent('customer.subscription.updated', subscription);
    stubSignatureVerification(event);
    const { req, res } = mockWebhookReqRes(event);

    await stripeController.handleWebhook(req, res);

    expect(await fetchEvents(orgId, 'subscription_activated')).toHaveLength(0);
  });
});
