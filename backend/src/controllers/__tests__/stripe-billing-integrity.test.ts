/**
 * Billing integrity (billing safety PR A), on real Postgres with Stripe
 * mocked at the StripeService boundary -- no Stripe call is ever made (no
 * STRIPE_SECRET_KEY is set, so an unmocked call would throw before any
 * request).
 *
 *  - One open Checkout per organization: the reservation on the org row
 *    (checkout-reservation.service), proven under truly concurrent requests
 *    and at the SQL level with two connections and a deterministic barrier.
 *  - The reservation lifecycle: same plan resumes the open session, a
 *    different plan expires it first, a Stripe failure releases it, an
 *    expired one is reusable, a canceled organization can subscribe again.
 *  - Webhooks: the subscription id is the identity. An event for another
 *    subscription of the same customer never downgrades or overwrites the
 *    organization; a completed checkout next to a billable subscription is
 *    never recorded and is logged for manual review.
 *  - Revenue Protection is never started or switched to self-serve, and an
 *    organization on it cannot change its plan itself.
 */

import { Request, Response } from 'express';
import { Client, Pool } from 'pg';
import {
  stripeController,
  ALREADY_SUBSCRIBED_MESSAGE,
  CHECKOUT_IN_PROGRESS_MESSAGE,
  CONTACT_SALES_MESSAGE,
} from '../stripe.controller';
import stripeService, { isSelfServePlan, isSalesLedTier } from '../../services/stripe.service';
import {
  CHECKOUT_SESSION_LIFETIME_SECONDS,
  RESERVATION_MARGIN_SECONDS,
  tryReserveCheckout,
} from '../../services/checkout-reservation.service';

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

// Test-only fake price ids (never real Stripe values), restored afterwards.
const FAKE_PRICE_ENV: Record<string, string> = {
  STRIPE_PRICE_STARTER_MONTHLY: 'price_test_integrity_starter_monthly',
  STRIPE_PRICE_PRO_MONTHLY: 'price_test_integrity_pro_monthly',
  STRIPE_PRICE_ENTERPRISE_MONTHLY: 'price_test_integrity_enterprise_monthly',
};
const originalEnv: Record<string, string | undefined> = {};
for (const [name, value] of Object.entries(FAKE_PRICE_ENV)) {
  originalEnv[name] = process.env[name];
  process.env[name] = value;
}

let counter = 0;
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(overrides: {
  tier?: string;
  status?: string;
  customerId?: string | null;
  subscriptionId?: string | null;
} = {}): Promise<{ orgId: string; customerId: string | null; subscriptionId: string | null }> {
  const suffix = uniqueSuffix();
  const customerId = overrides.customerId === undefined ? `cus_test_${suffix}` : overrides.customerId;
  const subscriptionId = overrides.subscriptionId === undefined ? null : overrides.subscriptionId;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id)
     VALUES ($1, $2, $1, $3, $4, $5, $6) RETURNING id`,
    [`Integrity Org ${suffix}`, `integrity-org-${suffix}`, overrides.tier ?? 'free', overrides.status ?? 'free', customerId, subscriptionId]
  );
  createdOrgIds.push(rows[0].id);
  return { orgId: rows[0].id as string, customerId, subscriptionId };
}

async function orgRow(orgId: string) {
  const { rows } = await pool.query(
    `SELECT subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id,
            billing_lifecycle_state, checkout_reservation_id, checkout_reservation_plan,
            extract(epoch FROM checkout_reservation_expires_at)::bigint AS reservation_expires_epoch,
            checkout_session_id
       FROM organizations WHERE id = $1`,
    [orgId]
  );
  return rows[0];
}

function checkoutReqRes(body: any, organizationId: string, role: string = 'owner') {
  const req = {
    user: { organizationId, userId: undefined, email: `${role}-${uniqueSuffix()}@example.com`, role },
    body,
  } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  return { req, res, json, status };
}

/** The HTTP status and body one controller call answered with. */
function answer(mock: { status: jest.Mock; json: jest.Mock }): { status: number; body: any } {
  return { status: mock.status.mock.calls[0]?.[0], body: mock.json.mock.calls[0]?.[0] };
}

function sessionFor(id: string, url: string, status: string = 'open') {
  return { id, url, status } as any;
}

/** Mocks for a successful first checkout: a customer (if created) and a session. */
function stubCheckoutStripe() {
  const customerSpy = jest.spyOn(stripeService, 'createCustomer').mockImplementation(async () => ({ id: `cus_new_${uniqueSuffix()}` } as any));
  const sessions: any[] = [];
  const sessionSpy = jest.spyOn(stripeService, 'createCheckoutSession').mockImplementation(async () => {
    const id = `cs_test_${uniqueSuffix()}`;
    const session = sessionFor(id, `https://checkout.example/${id}`);
    sessions.push(session);
    return session;
  });
  const retrieveSpy = jest
    .spyOn(stripeService, 'retrieveCheckoutSession')
    .mockImplementation(async (id: string) => sessions.find(s => s.id === id) ?? sessionFor(id, '', 'expired'));
  const expireSpy = jest.spyOn(stripeService, 'expireCheckoutSession').mockImplementation(async (id: string) => {
    const session = sessions.find(s => s.id === id);
    if (session) session.status = 'expired';
    return sessionFor(id, '', 'expired');
  });
  return { customerSpy, sessionSpy, retrieveSpy, expireSpy, sessions };
}

// ---- webhook helpers ----
let nextEventCreatedAt = Math.floor(Date.now() / 1000);
function fakeEvent(type: string, object: any, created?: number) {
  return { id: `evt_test_${uniqueSuffix()}`, type, data: { object }, created: created ?? nextEventCreatedAt++ };
}

async function deliver(event: any): Promise<{ status: jest.Mock; json: jest.Mock }> {
  jest.spyOn(stripeService, 'verifyWebhookSignature').mockReturnValue(event as any);
  const req = { headers: { 'stripe-signature': 'test-signature' }, body: Buffer.from(JSON.stringify(event)) } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  await stripeController.handleWebhook(req, res);
  (stripeService.verifyWebhookSignature as jest.Mock).mockRestore();
  return { status, json };
}

function subscriptionObject(id: string, customer: string, status: string, priceEnv: string, metadata?: Record<string, string>) {
  return {
    id,
    customer,
    status,
    items: { data: [{ price: { id: FAKE_PRICE_ENV[priceEnv] } }] },
    cancel_at_period_end: false,
    ...(metadata ? { metadata } : {}),
  };
}

beforeAll(() => {
  expect(process.env.STRIPE_SECRET_KEY).toBeUndefined();
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  for (const [name, value] of Object.entries(originalEnv)) {
    if (value === undefined) delete process.env[name];
    else process.env[name] = value;
  }
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1)', [createdOrgIds]).catch(() => undefined);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('concurrent first checkouts: one reservation, one customer, one session', () => {
  it('two admins at once (deterministic barrier): the second is refused while the first holds the reservation', async () => {
    const { orgId } = await insertOrg({ customerId: null });
    const { sessionSpy } = stubCheckoutStripe();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let reached!: () => void;
    const reachedCustomer = new Promise<void>(resolve => { reached = resolve; });
    // Only the first call waits at the barrier; any later call (which the
    // reservation must prevent) returns at once, so a broken reservation
    // fails on the assertions below instead of hanging.
    const customerSpy = jest
      .spyOn(stripeService, 'createCustomer')
      .mockImplementationOnce(async () => {
        reached();
        await gate;
        return { id: 'cus_test_barrier_winner' } as any;
      })
      .mockImplementation(async () => ({ id: 'cus_test_barrier_second' } as any));

    const first = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId, 'admin');
    const firstDone = stripeController.createCheckoutSession(first.req, first.res);
    await reachedCustomer; // the first request now holds the reservation, inside Stripe

    const second = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId, 'owner');
    await stripeController.createCheckoutSession(second.req, second.res);
    expect(answer(second)).toEqual({
      status: 409,
      body: { success: false, code: 'CHECKOUT_IN_PROGRESS', error: CHECKOUT_IN_PROGRESS_MESSAGE },
    });

    release();
    await firstDone;
    expect(answer(first).status).toBe(200);
    expect(customerSpy).toHaveBeenCalledTimes(1);
    expect(sessionSpy).toHaveBeenCalledTimes(1);
    const row = await orgRow(orgId);
    expect(row.stripe_customer_id).toBe('cus_test_barrier_winner');
    expect(row.checkout_session_id).toBe(sessionSpy.mock.results[0] && (await sessionSpy.mock.results[0].value).id);
  });

  it('SQL level, two connections: the reservation UPDATE of the second waits on the first and then takes nothing', async () => {
    const { orgId } = await insertOrg();
    const a = new Client(dbConfig());
    const b = new Client(dbConfig());
    await a.connect();
    await b.connect();
    try {
      const bPid = (await b.query('SELECT pg_backend_pid() AS pid')).rows[0].pid;
      await a.query('BEGIN');
      const first = await tryReserveCheckout(orgId, 'starter:monthly', a as any);
      expect(first).not.toBeNull();

      const secondPending = tryReserveCheckout(orgId, 'pro:monthly', b as any);
      // Barrier: proceed only once the second connection is blocked on the row lock.
      let blocked = false;
      for (let i = 0; i < 20000 && !blocked; i++) {
        const { rows } = await pool.query('SELECT wait_event_type FROM pg_stat_activity WHERE pid = $1', [bPid]);
        blocked = rows[0]?.wait_event_type === 'Lock';
        if (!blocked) await new Promise(resolve => setImmediate(resolve));
      }
      expect(blocked).toBe(true);

      await a.query('COMMIT');
      expect(await secondPending).toBeNull();
      const row = await orgRow(orgId);
      expect(row.checkout_reservation_id).toBe(first);
      expect(row.checkout_reservation_plan).toBe('starter:monthly');
    } finally {
      await a.query('ROLLBACK').catch(() => undefined);
      await a.end();
      await b.end();
    }
  });

  it('eight requests at once from two admins: exactly one customer and one session; the rest get that session or CHECKOUT_IN_PROGRESS', async () => {
    const { orgId } = await insertOrg({ customerId: null });
    const { customerSpy, sessionSpy } = stubCheckoutStripe();
    const calls = Array.from({ length: 8 }, (_, i) =>
      checkoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId, i % 2 === 0 ? 'admin' : 'owner')
    );

    await Promise.all(calls.map(c => stripeController.createCheckoutSession(c.req, c.res)));

    expect(customerSpy).toHaveBeenCalledTimes(1);
    expect(sessionSpy).toHaveBeenCalledTimes(1);
    const created = await sessionSpy.mock.results[0].value;
    for (const c of calls) {
      const { status, body } = answer(c);
      if (status === 200) expect(body.data).toEqual({ sessionId: created.id, url: created.url });
      else expect(body).toEqual({ success: false, code: 'CHECKOUT_IN_PROGRESS', error: CHECKOUT_IN_PROGRESS_MESSAGE });
    }
    expect(calls.filter(c => answer(c).status === 200).length).toBeGreaterThanOrEqual(1);
  });
});

describe('reservation lifecycle', () => {
  it('the approved copy, exactly', () => {
    expect(CONTACT_SALES_MESSAGE).toBe('Revenue Protection is set up with our team. Contact sales to get started.');
    expect(ALREADY_SUBSCRIBED_MESSAGE).toBe('This organization already has a subscription. Change plan from Billing settings.');
    expect(CHECKOUT_IN_PROGRESS_MESSAGE).toBe(
      'A checkout for this organization is already open. Finish it there, or try again in about 30 minutes.'
    );
  });

  it('reuses the organization\'s existing customer; session expires in 31 min, reservation 5 min later (36); idempotency keys carry the reservation', async () => {
    const { orgId, customerId } = await insertOrg();
    const { customerSpy, sessionSpy } = stubCheckoutStripe();
    const before = Math.floor(Date.now() / 1000);

    const c = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(c.req, c.res);

    expect(answer(c).status).toBe(200);
    expect(customerSpy).not.toHaveBeenCalled();
    const [calledCustomer, , calledOrg, , , options] = sessionSpy.mock.calls[0];
    expect(calledCustomer).toBe(customerId);
    expect(calledOrg).toBe(orgId);
    const row = await orgRow(orgId);
    expect(CHECKOUT_SESSION_LIFETIME_SECONDS).toBe(31 * 60);
    expect(RESERVATION_MARGIN_SECONDS).toBe(5 * 60);
    expect(options.expiresAt).toBeGreaterThanOrEqual(before + 31 * 60);
    expect(options.expiresAt).toBeLessThanOrEqual(Math.floor(Date.now() / 1000) + 31 * 60);
    expect(Number(row.reservation_expires_epoch)).toBe(options.expiresAt + 5 * 60);
    expect(options.idempotencyKey).toBe(`checkout-${row.checkout_reservation_id}`);
    expect(row.checkout_reservation_plan).toBe('starter:monthly');
  });

  it('a new customer is created only inside the reservation, with the reservation as its idempotency key', async () => {
    const { orgId } = await insertOrg({ customerId: null });
    const { customerSpy } = stubCheckoutStripe();
    const c = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(c.req, c.res);

    const row = await orgRow(orgId);
    expect(customerSpy).toHaveBeenCalledTimes(1);
    expect(customerSpy.mock.calls[0][3]).toEqual({ idempotencyKey: `customer-${row.checkout_reservation_id}` });
    expect(row.stripe_customer_id).toBe((await customerSpy.mock.results[0].value).id);
  });

  it('same plan while the session is open: that session\'s URL, no new session', async () => {
    const { orgId } = await insertOrg();
    const { sessionSpy, retrieveSpy } = stubCheckoutStripe();
    const first = checkoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(first.req, first.res);
    const second = checkoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(second.req, second.res);

    expect(sessionSpy).toHaveBeenCalledTimes(1);
    expect(answer(second)).toEqual({ status: 200, body: answer(first).body });
    expect(retrieveSpy).toHaveBeenCalledWith(answer(first).body.data.sessionId);
  });

  it('same plan whose session already completed: ALREADY_SUBSCRIBED', async () => {
    const { orgId } = await insertOrg();
    const { sessions } = stubCheckoutStripe();
    const first = checkoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(first.req, first.res);
    sessions[0].status = 'complete';

    const second = checkoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(second.req, second.res);
    expect(answer(second)).toEqual({
      status: 409,
      body: { success: false, code: 'ALREADY_SUBSCRIBED', error: ALREADY_SUBSCRIBED_MESSAGE },
    });
  });

  it('different plan: expires the open session first, then replaces the reservation', async () => {
    const { orgId } = await insertOrg();
    const { sessionSpy, expireSpy } = stubCheckoutStripe();
    const first = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(first.req, first.res);
    const firstSessionId = answer(first).body.data.sessionId;
    const firstReservation = (await orgRow(orgId)).checkout_reservation_id;

    const second = checkoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(second.req, second.res);

    expect(expireSpy).toHaveBeenCalledWith(firstSessionId);
    expect(expireSpy.mock.invocationCallOrder[0]).toBeLessThan(sessionSpy.mock.invocationCallOrder[1]);
    expect(sessionSpy).toHaveBeenCalledTimes(2);
    expect(answer(second).status).toBe(200);
    const row = await orgRow(orgId);
    expect(row.checkout_reservation_plan).toBe('pro:monthly');
    expect(row.checkout_reservation_id).not.toBe(firstReservation);
    expect(row.checkout_session_id).toBe(answer(second).body.data.sessionId);
  });

  it('different plan whose session Stripe will not expire: CHECKOUT_IN_PROGRESS, reservation unchanged', async () => {
    const { orgId } = await insertOrg();
    const { sessionSpy, expireSpy } = stubCheckoutStripe();
    const first = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(first.req, first.res);
    const before = await orgRow(orgId);
    expireSpy.mockRejectedValue(new Error('session is not open'));

    const second = checkoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(second.req, second.res);

    expect(answer(second)).toEqual({
      status: 409,
      body: { success: false, code: 'CHECKOUT_IN_PROGRESS', error: CHECKOUT_IN_PROGRESS_MESSAGE },
    });
    expect(sessionSpy).toHaveBeenCalledTimes(1);
    expect(await orgRow(orgId)).toEqual(before);
  });

  it('a Stripe session failure releases the reservation at once; the next request can check out', async () => {
    const { orgId } = await insertOrg();
    const { sessionSpy } = stubCheckoutStripe();
    sessionSpy.mockRejectedValueOnce(new Error('stripe unavailable'));

    const first = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(first.req, first.res);
    expect(answer(first).status).toBe(500);
    const cleared = await orgRow(orgId);
    expect(cleared.checkout_reservation_id).toBeNull();
    expect(cleared.checkout_session_id).toBeNull();
    expect(cleared.checkout_reservation_plan).toBeNull();

    const second = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(second.req, second.res);
    expect(answer(second).status).toBe(200);
    expect(sessionSpy).toHaveBeenCalledTimes(2);
  });

  it('a Stripe customer failure releases the reservation too', async () => {
    const { orgId } = await insertOrg({ customerId: null });
    const { customerSpy } = stubCheckoutStripe();
    customerSpy.mockRejectedValueOnce(new Error('stripe unavailable'));
    const c = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(c.req, c.res);
    expect(answer(c).status).toBe(500);
    const row = await orgRow(orgId);
    expect(row.checkout_reservation_id).toBeNull();
    expect(row.stripe_customer_id).toBeNull();
  });

  it('an expired reservation is reusable without asking Stripe about the old session', async () => {
    const { orgId } = await insertOrg();
    const { sessionSpy, retrieveSpy, expireSpy } = stubCheckoutStripe();
    const first = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(first.req, first.res);
    await pool.query(`UPDATE organizations SET checkout_reservation_expires_at = NOW() - interval '1 second' WHERE id = $1`, [orgId]);

    const second = checkoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(second.req, second.res);

    expect(answer(second).status).toBe(200);
    expect(sessionSpy).toHaveBeenCalledTimes(2);
    expect(retrieveSpy).not.toHaveBeenCalled();
    expect(expireSpy).not.toHaveBeenCalled();
    expect((await orgRow(orgId)).checkout_reservation_plan).toBe('pro:monthly');
  });

  it.each(['canceled', 'incomplete_expired'])('an organization whose recorded subscription is %s can subscribe again', async (status) => {
    const { orgId } = await insertOrg({ subscriptionId: `sub_test_${uniqueSuffix()}`, status });
    const { sessionSpy } = stubCheckoutStripe();
    const c = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(c.req, c.res);
    expect(answer(c).status).toBe(200);
    expect(sessionSpy).toHaveBeenCalledTimes(1);
  });

  it.each(['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused'])(
    'an organization whose recorded subscription is %s (billable): ALREADY_SUBSCRIBED, Stripe never called',
    async (status) => {
      const { orgId } = await insertOrg({ tier: 'starter', subscriptionId: `sub_test_${uniqueSuffix()}`, status });
      const { customerSpy, sessionSpy } = stubCheckoutStripe();
      const c = checkoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);
      await stripeController.createCheckoutSession(c.req, c.res);
      expect(answer(c)).toEqual({
        status: 409,
        body: { success: false, code: 'ALREADY_SUBSCRIBED', error: ALREADY_SUBSCRIBED_MESSAGE },
      });
      expect(customerSpy).not.toHaveBeenCalled();
      expect(sessionSpy).not.toHaveBeenCalled();
      expect((await orgRow(orgId)).checkout_reservation_id).toBeNull();
    }
  );

  it('a live subscription on an unrecognised price (stored tier free) still blocks Checkout', async () => {
    const { orgId } = await insertOrg({ tier: 'free', subscriptionId: `sub_test_${uniqueSuffix()}`, status: 'active' });
    const { sessionSpy } = stubCheckoutStripe();
    const c = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(c.req, c.res);
    expect(answer(c).status).toBe(409);
    expect(answer(c).body.code).toBe('ALREADY_SUBSCRIBED');
    expect(sessionSpy).not.toHaveBeenCalled();
  });

  it('the completed session releases its reservation and records the subscription', async () => {
    const { orgId, customerId } = await insertOrg();
    stubCheckoutStripe();
    const c = checkoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(c.req, c.res);
    const sessionId = answer(c).body.data.sessionId;
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(
      subscriptionObject(subscriptionId, customerId!, 'active', 'STRIPE_PRICE_PRO_MONTHLY', { organizationId: orgId }) as any
    );

    await deliver(fakeEvent('checkout.session.completed', { id: sessionId, metadata: { organizationId: orgId }, customer: customerId, subscription: subscriptionId }));

    const row = await orgRow(orgId);
    expect(row.stripe_subscription_id).toBe(subscriptionId);
    expect(row.subscription_tier).toBe('pro');
    expect(row.checkout_reservation_id).toBeNull();
    expect(row.checkout_session_id).toBeNull();
  });
});

describe('cross-organization isolation', () => {
  it('one organization\'s open reservation never blocks another\'s Checkout', async () => {
    const a = await insertOrg();
    const b = await insertOrg();
    const { sessionSpy } = stubCheckoutStripe();
    const ca = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, a.orgId);
    await stripeController.createCheckoutSession(ca.req, ca.res);
    const cb = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, b.orgId);
    await stripeController.createCheckoutSession(cb.req, cb.res);

    expect(answer(ca).status).toBe(200);
    expect(answer(cb).status).toBe(200);
    expect(sessionSpy).toHaveBeenCalledTimes(2);
    expect(sessionSpy.mock.calls[1][0]).toBe(b.customerId);
  });

  it('a completed checkout naming organization A under organization B\'s customer is applied to neither', async () => {
    const a = await insertOrg();
    const b = await insertOrg();
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(
      subscriptionObject(subscriptionId, b.customerId!, 'active', 'STRIPE_PRICE_PRO_MONTHLY') as any
    );
    const errorSpy = jest.spyOn(console, 'error');

    await deliver(fakeEvent('checkout.session.completed', { id: `cs_x_${uniqueSuffix()}`, metadata: { organizationId: a.orgId }, customer: b.customerId, subscription: subscriptionId }));

    expect((await orgRow(a.orgId)).stripe_subscription_id).toBeNull();
    expect((await orgRow(a.orgId)).subscription_tier).toBe('free');
    expect((await orgRow(b.orgId)).stripe_subscription_id).toBeNull();
    expect(errorSpy.mock.calls.some(args => String(args[0]).includes(a.orgId) && String(args[0]).includes('not under its Stripe customer'))).toBe(true);
  });

  it('a subscription event whose metadata names another organization is not applied', async () => {
    const a = await insertOrg({ tier: 'pro', status: 'active', subscriptionId: `sub_test_${uniqueSuffix()}` });
    const b = await insertOrg();
    await deliver(fakeEvent('customer.subscription.updated',
      subscriptionObject(a.subscriptionId!, a.customerId!, 'active', 'STRIPE_PRICE_STARTER_MONTHLY', { organizationId: b.orgId })));
    expect((await orgRow(a.orgId)).subscription_tier).toBe('pro');
  });
});

describe('webhooks: the subscription id is the identity', () => {
  it('a duplicate subscription\'s deletion never downgrades the organization', async () => {
    const recorded = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'pro', status: 'active', subscriptionId: recorded });

    await deliver(fakeEvent('customer.subscription.deleted', { id: `sub_dup_${uniqueSuffix()}`, customer: customerId, status: 'canceled' }));

    const row = await orgRow(orgId);
    expect(row.subscription_tier).toBe('pro');
    expect(row.subscription_status).toBe('active');
    expect(row.stripe_subscription_id).toBe(recorded);
  });

  it('a duplicate subscription\'s update never overwrites the recorded subscription, tier or status', async () => {
    const recorded = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'pro', status: 'active', subscriptionId: recorded });

    await deliver(fakeEvent('customer.subscription.updated', subscriptionObject(`sub_dup_${uniqueSuffix()}`, customerId!, 'past_due', 'STRIPE_PRICE_STARTER_MONTHLY')));

    const row = await orgRow(orgId);
    expect(row).toMatchObject({ subscription_tier: 'pro', subscription_status: 'active', stripe_subscription_id: recorded });
  });

  it('the recorded subscription\'s own deletion still downgrades it', async () => {
    const recorded = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'pro', status: 'active', subscriptionId: recorded });
    await deliver(fakeEvent('customer.subscription.deleted', { id: recorded, customer: customerId, status: 'canceled' }));
    expect(await orgRow(orgId)).toMatchObject({ subscription_tier: 'free', subscription_status: 'canceled' });
  });

  it('a new subscription is adopted once the recorded one has ended', async () => {
    const { orgId, customerId } = await insertOrg({ tier: 'free', status: 'canceled', subscriptionId: `sub_old_${uniqueSuffix()}` });
    const fresh = `sub_new_${uniqueSuffix()}`;
    await deliver(fakeEvent('customer.subscription.updated', subscriptionObject(fresh, customerId!, 'active', 'STRIPE_PRICE_PRO_MONTHLY')));
    expect(await orgRow(orgId)).toMatchObject({ subscription_tier: 'pro', stripe_subscription_id: fresh });
  });

  it('a completed checkout next to a billable subscription is never recorded: logged for review, nothing canceled or refunded', async () => {
    const recorded = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'starter', status: 'active', subscriptionId: recorded });
    const duplicate = `sub_dup_${uniqueSuffix()}`;
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(
      subscriptionObject(duplicate, customerId!, 'active', 'STRIPE_PRICE_PRO_MONTHLY', { organizationId: orgId }) as any
    );
    const cancelSpy = jest.spyOn(stripeService, 'cancelSubscription');
    const refundSpy = jest.spyOn(stripeService, 'createRefund');
    const updateSpy = jest.spyOn(stripeService, 'updateSubscription');
    const errorSpy = jest.spyOn(console, 'error');

    const { status } = await deliver(fakeEvent('checkout.session.completed', { id: `cs_dup_${uniqueSuffix()}`, metadata: { organizationId: orgId }, customer: customerId, subscription: duplicate }));

    expect(status).not.toHaveBeenCalledWith(400);
    expect(await orgRow(orgId)).toMatchObject({ subscription_tier: 'starter', subscription_status: 'active', stripe_subscription_id: recorded });
    expect(cancelSpy).not.toHaveBeenCalled();
    expect(refundSpy).not.toHaveBeenCalled();
    expect(updateSpy).not.toHaveBeenCalled();
    const logged = errorSpy.mock.calls.map(args => String(args[0])).find(m => m.includes('already has a billable subscription'));
    expect(logged).toContain(orgId);
    expect(logged).not.toContain(duplicate);
    expect(logged).not.toContain(String(customerId));
  });

  it('a duplicate subscription\'s invoice never starts or clears the grace period', async () => {
    const recorded = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'pro', status: 'active', subscriptionId: recorded });
    const invoiceOf = (subscription: string) => ({
      id: `in_test_${uniqueSuffix()}`,
      customer: customerId,
      created: nextEventCreatedAt++,
      parent: { subscription_details: { subscription } },
    });

    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(`sub_dup_${uniqueSuffix()}`)));
    expect((await orgRow(orgId)).billing_lifecycle_state).toBe('healthy');

    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(recorded)));
    expect((await orgRow(orgId)).billing_lifecycle_state).toBe('grace_period');

    await deliver(fakeEvent('invoice.paid', invoiceOf(`sub_dup_${uniqueSuffix()}`)));
    expect((await orgRow(orgId)).billing_lifecycle_state).toBe('grace_period');
  });
});

describe('out-of-order events', () => {
  it('a checkout completion retried after the cancellation cannot restore the paid tier', async () => {
    // The completion's first attempt failed; meanwhile the subscription was
    // set up by customer.subscription.updated and then canceled. Stripe
    // retries the completion afterwards: its write mark (now) is newer than
    // both events, so only the subscription's own status can stop it.
    const { orgId, customerId } = await insertOrg();
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const nowSec = Math.floor(Date.now() / 1000);
    await deliver(fakeEvent('customer.subscription.updated',
      subscriptionObject(subscriptionId, customerId!, 'active', 'STRIPE_PRICE_PRO_MONTHLY', { organizationId: orgId }), nowSec - 100));
    expect((await orgRow(orgId)).subscription_tier).toBe('pro');
    await deliver(fakeEvent('customer.subscription.deleted', { id: subscriptionId, customer: customerId, status: 'canceled' }, nowSec - 50));
    expect((await orgRow(orgId)).subscription_tier).toBe('free');

    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(
      subscriptionObject(subscriptionId, customerId!, 'canceled', 'STRIPE_PRICE_PRO_MONTHLY', { organizationId: orgId }) as any
    );
    await deliver(fakeEvent('checkout.session.completed',
      { id: `cs_late_${uniqueSuffix()}`, metadata: { organizationId: orgId }, customer: customerId, subscription: subscriptionId }));
    expect(await orgRow(orgId)).toMatchObject({ subscription_tier: 'free', subscription_status: 'canceled', stripe_subscription_id: subscriptionId });
  });

  it('an update older than the deletion it follows is ignored', async () => {
    const recorded = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'pro', status: 'active', subscriptionId: recorded });
    const t = nextEventCreatedAt + 100;
    nextEventCreatedAt += 200;
    await deliver(fakeEvent('customer.subscription.deleted', { id: recorded, customer: customerId, status: 'canceled' }, t));
    await deliver(fakeEvent('customer.subscription.updated', subscriptionObject(recorded, customerId!, 'active', 'STRIPE_PRICE_PRO_MONTHLY'), t - 10));
    expect(await orgRow(orgId)).toMatchObject({ subscription_tier: 'free', subscription_status: 'canceled' });
  });

  it('a delayed deletion of an old subscription never touches the subscription adopted after it', async () => {
    const old = `sub_old_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'free', status: 'canceled', subscriptionId: old });
    const fresh = `sub_new_${uniqueSuffix()}`;
    await deliver(fakeEvent('customer.subscription.updated', subscriptionObject(fresh, customerId!, 'active', 'STRIPE_PRICE_STARTER_MONTHLY')));
    await deliver(fakeEvent('customer.subscription.deleted', { id: old, customer: customerId, status: 'canceled' }));
    expect(await orgRow(orgId)).toMatchObject({ subscription_tier: 'starter', subscription_status: 'active', stripe_subscription_id: fresh });
  });
});

describe('Revenue Protection is Contact Sales', () => {
  it('the self-serve plan list is Cost Control and Optimization Engine only', () => {
    expect(isSelfServePlan('starter', 'monthly')).toBe(true);
    expect(isSelfServePlan('pro', 'annual')).toBe(true);
    expect(isSelfServePlan('enterprise', 'monthly')).toBe(false);
    expect(isSelfServePlan('enterprise', 'annual')).toBe(false);
    expect(isSalesLedTier('enterprise')).toBe(true);
    expect(isSalesLedTier('pro')).toBe(false);
    expect(isSalesLedTier('free')).toBe(false);
  });

  it('Checkout for Revenue Protection: CONTACT_SALES, no reservation, no Stripe call', async () => {
    const { orgId } = await insertOrg();
    const { customerSpy, sessionSpy } = stubCheckoutStripe();
    const c = checkoutReqRes({ tier: 'enterprise', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(c.req, c.res);
    expect(answer(c)).toEqual({ status: 400, body: { success: false, code: 'CONTACT_SALES', error: CONTACT_SALES_MESSAGE } });
    expect(customerSpy).not.toHaveBeenCalled();
    expect(sessionSpy).not.toHaveBeenCalled();
    expect((await orgRow(orgId)).checkout_reservation_id).toBeNull();
  });

  it('change-plan to Revenue Protection: CONTACT_SALES, Stripe never called', async () => {
    const { orgId } = await insertOrg({ tier: 'pro', status: 'active', subscriptionId: `sub_test_${uniqueSuffix()}` });
    const updateSpy = jest.spyOn(stripeService, 'updateSubscription');
    const c = checkoutReqRes({ tier: 'enterprise', billingInterval: 'monthly' }, orgId);
    await stripeController.changePlan(c.req, c.res);
    expect(answer(c)).toEqual({ status: 400, body: { success: false, code: 'CONTACT_SALES', error: CONTACT_SALES_MESSAGE } });
    expect(updateSpy).not.toHaveBeenCalled();
    expect((await orgRow(orgId)).subscription_tier).toBe('pro');
  });

  it.each([
    ['change-plan', 'changePlan'],
    ['Checkout', 'createCheckoutSession'],
  ] as const)('an organization on Revenue Protection cannot change its plan through %s', async (_label, method) => {
    const recorded = `sub_test_${uniqueSuffix()}`;
    const { orgId } = await insertOrg({ tier: 'enterprise', status: 'active', subscriptionId: recorded });
    const updateSpy = jest.spyOn(stripeService, 'updateSubscription');
    const { customerSpy, sessionSpy } = stubCheckoutStripe();
    const c = checkoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);
    await stripeController[method](c.req, c.res);
    expect(answer(c)).toEqual({ status: 400, body: { success: false, code: 'CONTACT_SALES', error: CONTACT_SALES_MESSAGE } });
    expect(updateSpy).not.toHaveBeenCalled();
    expect(customerSpy).not.toHaveBeenCalled();
    expect(sessionSpy).not.toHaveBeenCalled();
    expect(await orgRow(orgId)).toMatchObject({ subscription_tier: 'enterprise', stripe_subscription_id: recorded });
  });

  it('an existing Revenue Protection subscription keeps mapping to enterprise through its webhooks', async () => {
    const recorded = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'enterprise', status: 'active', subscriptionId: recorded });
    expect(stripeService.getTierFromPriceId(FAKE_PRICE_ENV.STRIPE_PRICE_ENTERPRISE_MONTHLY)).toBe('enterprise');
    await deliver(fakeEvent('customer.subscription.updated', subscriptionObject(recorded, customerId!, 'active', 'STRIPE_PRICE_ENTERPRISE_MONTHLY')));
    expect(await orgRow(orgId)).toMatchObject({ subscription_tier: 'enterprise', subscription_status: 'active', stripe_subscription_id: recorded });
  });
});
