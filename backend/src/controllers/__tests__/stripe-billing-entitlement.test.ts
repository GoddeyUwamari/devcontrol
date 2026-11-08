/**
 * Billing safety PR B, through the Stripe webhooks and Checkout, on real
 * Postgres with Stripe mocked at the StripeService boundary (no
 * STRIPE_SECRET_KEY is set, so an unmocked call would throw before any
 * request). Ids are test placeholders.
 *
 *  - Late or retried events never restore paid access for a canceled or
 *    expired subscription: the stored tier stays free, and the effective
 *    tier (entitlementOf) is free even where a paid tier was left next to a
 *    terminal status.
 *  - Transitions out of the payment and inactive holds, and into them.
 *  - The grace deadline is never moved by a subscription event.
 *  - PR A review leftovers: a reservation that changed before the session
 *    was recorded never hands out the URL; the Checkout 500 is a fixed
 *    message; the reservation replace is compare-and-swap; subscription
 *    writes never log Stripe ids.
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { stripeController, CHECKOUT_IN_PROGRESS_MESSAGE } from '../stripe.controller';
import stripeService from '../../services/stripe.service';
import { replaceCheckoutReservation, tryReserveCheckout } from '../../services/checkout-reservation.service';
import { getOrganizationEntitlement } from '../../middleware/subscription.middleware';

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
  STRIPE_PRICE_STARTER_MONTHLY: 'price_test_entitlement_starter_monthly',
  STRIPE_PRICE_PRO_MONTHLY: 'price_test_entitlement_pro_monthly',
  STRIPE_PRICE_ENTERPRISE_MONTHLY: 'price_test_entitlement_enterprise_monthly',
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

async function insertOrg(overrides: { tier?: string; status?: string; subscriptionId?: string | null } = {}) {
  const suffix = uniqueSuffix();
  const customerId = `cus_test_${suffix}`;
  const subscriptionId = overrides.subscriptionId === undefined ? null : overrides.subscriptionId;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status, stripe_customer_id, stripe_subscription_id)
     VALUES ($1, $2, $1, $3, $4, $5, $6) RETURNING id`,
    [`Entitlement Org ${suffix}`, `entitlement-org-${suffix}`, overrides.tier ?? 'free', overrides.status ?? 'free', customerId, subscriptionId]
  );
  createdOrgIds.push(rows[0].id);
  return { orgId: rows[0].id as string, customerId, subscriptionId };
}

async function orgRow(orgId: string) {
  const { rows } = await pool.query(
    `SELECT subscription_tier, subscription_status, stripe_subscription_id, billing_lifecycle_state,
            grace_period_ends_at, checkout_reservation_id, checkout_session_id
       FROM organizations WHERE id = $1`,
    [orgId]
  );
  return rows[0];
}

const entitlement = (orgId: string) => getOrganizationEntitlement(orgId, pool);

let nextEventCreatedAt = Math.floor(Date.now() / 1000);
function fakeEvent(type: string, object: any, created?: number) {
  return { id: `evt_test_${uniqueSuffix()}`, type, data: { object }, created: created ?? nextEventCreatedAt++ };
}

async function deliver(event: any): Promise<number> {
  jest.spyOn(stripeService, 'verifyWebhookSignature').mockReturnValue(event as any);
  const req = { headers: { 'stripe-signature': 'test-signature' }, body: Buffer.from(JSON.stringify(event)) } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  await stripeController.handleWebhook(req, { json, status } as unknown as Response);
  (stripeService.verifyWebhookSignature as jest.Mock).mockRestore();
  return status.mock.calls[0]?.[0] ?? 200;
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

function invoiceOf(customer: string, subscription: string) {
  return {
    id: `in_test_${uniqueSuffix()}`,
    customer,
    created: nextEventCreatedAt++,
    parent: { subscription_details: { subscription } },
  };
}

function checkoutReqRes(body: any, organizationId: string) {
  const req = {
    user: { organizationId, userId: undefined, email: `owner-${uniqueSuffix()}@example.com`, role: 'owner' },
    body,
  } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { req, res: { json, status } as unknown as Response, json, status };
}

function answer(mock: { status: jest.Mock; json: jest.Mock }): { status: number; body: any } {
  return { status: mock.status.mock.calls[0]?.[0], body: mock.json.mock.calls[0]?.[0] };
}

beforeAll(() => {
  expect(process.env.STRIPE_SECRET_KEY).toBeUndefined();
});

beforeEach(() => {
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
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

// ─── Late and retried events ─────────────────────────────────────────────────

describe('late or retried events never restore paid access for an ended subscription', () => {
  it.each([
    ['canceled', 'customer.subscription.deleted'],
    ['incomplete_expired', 'customer.subscription.updated'],
  ])('a checkout completion retried after the subscription became %s: stored and effective tier stay free', async (terminal, endingEvent) => {
    const { orgId, customerId } = await insertOrg();
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const firstStatus = terminal === 'canceled' ? 'active' : 'incomplete';
    await deliver(fakeEvent('customer.subscription.updated',
      subscriptionObject(subscriptionId, customerId, firstStatus, 'STRIPE_PRICE_PRO_MONTHLY', { organizationId: orgId }), nowSec - 100));
    await deliver(fakeEvent(endingEvent,
      subscriptionObject(subscriptionId, customerId, terminal, 'STRIPE_PRICE_PRO_MONTHLY', { organizationId: orgId }), nowSec - 50));
    expect(await entitlement(orgId)).toMatchObject({ effectiveTier: 'free', hold: null });

    // The retried completion re-reads the subscription, which has ended.
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(
      subscriptionObject(subscriptionId, customerId, terminal, 'STRIPE_PRICE_PRO_MONTHLY', { organizationId: orgId }) as any
    );
    await deliver(fakeEvent('checkout.session.completed',
      { id: `cs_late_${uniqueSuffix()}`, metadata: { organizationId: orgId }, customer: customerId, subscription: subscriptionId }));

    expect(await orgRow(orgId)).toMatchObject({ subscription_tier: 'free', subscription_status: terminal, stripe_subscription_id: subscriptionId });
    expect(await entitlement(orgId)).toEqual({ storedTier: 'free', effectiveTier: 'free', hold: null });
  });

  it('a paid tier left next to a canceled recorded subscription (written before this fix) is not access; a late completion changes nothing', async () => {
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'pro', status: 'canceled', subscriptionId });
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'free', hold: null });

    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(
      subscriptionObject(subscriptionId, customerId, 'canceled', 'STRIPE_PRICE_PRO_MONTHLY', { organizationId: orgId }) as any
    );
    await deliver(fakeEvent('checkout.session.completed',
      { id: `cs_late_${uniqueSuffix()}`, metadata: { organizationId: orgId }, customer: customerId, subscription: subscriptionId }));
    expect((await entitlement(orgId))!.effectiveTier).toBe('free');
  });

  it('an older active update delivered after the cancellation is ignored; access stays off', async () => {
    const recorded = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'pro', status: 'active', subscriptionId: recorded });
    const t = nextEventCreatedAt + 100;
    nextEventCreatedAt += 200;
    await deliver(fakeEvent('customer.subscription.deleted', { id: recorded, customer: customerId, status: 'canceled' }, t));
    await deliver(fakeEvent('customer.subscription.updated', subscriptionObject(recorded, customerId, 'active', 'STRIPE_PRICE_PRO_MONTHLY'), t - 10));
    expect(await entitlement(orgId)).toEqual({ storedTier: 'free', effectiveTier: 'free', hold: null });
  });

  it('an older unpaid update after a newer active one stays active (no stale hold)', async () => {
    const recorded = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'pro', status: 'active', subscriptionId: recorded });
    const t = nextEventCreatedAt + 100;
    nextEventCreatedAt += 200;
    await deliver(fakeEvent('customer.subscription.updated', subscriptionObject(recorded, customerId, 'active', 'STRIPE_PRICE_PRO_MONTHLY'), t));
    await deliver(fakeEvent('customer.subscription.updated', subscriptionObject(recorded, customerId, 'unpaid', 'STRIPE_PRICE_PRO_MONTHLY'), t - 10));
    expect(await entitlement(orgId)).toMatchObject({ effectiveTier: 'pro', hold: null });
  });
});

// ─── Transitions ─────────────────────────────────────────────────────────────

describe('transitions into and out of the holds', () => {
  async function recordedOrg(status: string) {
    const recorded = `sub_test_${uniqueSuffix()}`;
    const org = await insertOrg({ tier: 'pro', status, subscriptionId: recorded });
    return { ...org, recorded };
  }
  const update = (sub: string, customer: string, status: string) =>
    deliver(fakeEvent('customer.subscription.updated', subscriptionObject(sub, customer, status, 'STRIPE_PRICE_PRO_MONTHLY')));

  it.each([
    ['unpaid', 'payment'],
    ['incomplete', 'subscription_inactive'],
    ['paused', 'subscription_inactive'],
  ])('%s (hold %s) -> active: access returns, hold clears', async (status, hold) => {
    const { orgId, customerId, recorded } = await recordedOrg('active');
    await update(recorded, customerId, status);
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'free', hold });
    await update(recorded, customerId, 'active');
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'pro', hold: null });
  });

  it('restricted -> a newer invoice.paid: access returns, hold clears', async () => {
    const { orgId, customerId, recorded } = await recordedOrg('past_due');
    await pool.query(
      `UPDATE organizations SET billing_lifecycle_state = 'restricted', payment_failed_at = NOW() - interval '9 days',
              grace_period_ends_at = NOW() - interval '2 days' WHERE id = $1`,
      [orgId]
    );
    expect(await entitlement(orgId)).toMatchObject({ effectiveTier: 'free', hold: 'payment' });
    await deliver(fakeEvent('invoice.paid', invoiceOf(customerId, recorded)));
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'pro', hold: null });
  });

  it('a stale invoice.paid (older than the failure) does not lift the restriction', async () => {
    const { orgId, customerId, recorded } = await recordedOrg('past_due');
    const failure = invoiceOf(customerId, recorded);
    const stale = { ...invoiceOf(customerId, recorded), created: failure.created - 1000 };
    await deliver(fakeEvent('invoice.payment_failed', failure));
    await pool.query(`UPDATE organizations SET grace_period_ends_at = NOW() - interval '1 minute' WHERE id = $1`, [orgId]);
    await deliver(fakeEvent('invoice.paid', stale));
    expect(await entitlement(orgId)).toMatchObject({ effectiveTier: 'free', hold: 'payment' });
  });

  it('unpaid after the grace ended -> active alone keeps the payment hold until the invoice is paid', async () => {
    const { orgId, customerId, recorded } = await recordedOrg('active');
    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, recorded)));
    await update(recorded, customerId, 'unpaid');
    await pool.query(`UPDATE organizations SET grace_period_ends_at = NOW() - interval '1 minute' WHERE id = $1`, [orgId]);
    expect(await entitlement(orgId)).toMatchObject({ effectiveTier: 'free', hold: 'payment' });
    await update(recorded, customerId, 'active');
    expect(await entitlement(orgId)).toMatchObject({ effectiveTier: 'free', hold: 'payment' });
    await deliver(fakeEvent('invoice.paid', invoiceOf(customerId, recorded)));
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'pro', hold: null });
  });

  it('a held organization whose subscription is deleted: free with no hold (a new subscription is needed)', async () => {
    const { orgId, customerId, recorded } = await recordedOrg('active');
    await update(recorded, customerId, 'unpaid');
    expect((await entitlement(orgId))!.hold).toBe('payment');
    await deliver(fakeEvent('customer.subscription.deleted', { id: recorded, customer: customerId, status: 'canceled' }));
    expect(await entitlement(orgId)).toEqual({ storedTier: 'free', effectiveTier: 'free', hold: null });
  });
});

// ─── Grace never moved by subscription events ───────────────────────────────

describe('the existing grace is never shortened, reset or extended by another Stripe event', () => {
  it('payment_failed starts it; past_due, unpaid, another failure and a renewal update leave the deadline exactly as it was', async () => {
    const recorded = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'pro', status: 'active', subscriptionId: recorded });
    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, recorded)));
    const deadline = (await orgRow(orgId)).grace_period_ends_at.toISOString();

    for (const status of ['past_due', 'unpaid', 'unpaid']) {
      await deliver(fakeEvent('customer.subscription.updated', subscriptionObject(recorded, customerId, status, 'STRIPE_PRICE_PRO_MONTHLY')));
      expect((await orgRow(orgId)).grace_period_ends_at.toISOString()).toBe(deadline);
      // Still paid while the grace runs, unpaid included.
      expect(await entitlement(orgId)).toMatchObject({ effectiveTier: 'pro', hold: null });
    }
    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, recorded)));
    expect((await orgRow(orgId)).grace_period_ends_at.toISOString()).toBe(deadline);
    expect((await orgRow(orgId)).billing_lifecycle_state).toBe('grace_period');
  });
});

// ─── PR A review leftovers ───────────────────────────────────────────────────

describe('PR A leftovers: Checkout', () => {
  function stubSession(onCreate?: (orgId: string) => Promise<void>) {
    return jest.spyOn(stripeService, 'createCheckoutSession').mockImplementation(async (_customer, _price, orgId) => {
      if (onCreate) await onCreate(orgId as string);
      const id = `cs_test_${uniqueSuffix()}`;
      return { id, url: `https://checkout.example/${id}`, status: 'open' } as any;
    });
  }

  it('the reservation changed before the session was recorded: CHECKOUT_IN_PROGRESS, the URL is never returned, no funnel event', async () => {
    const { orgId } = await insertOrg();
    let otherReservation = '';
    stubSession(async (id) => {
      // Another request takes the organization's reservation meanwhile.
      const { rows } = await pool.query(
        `UPDATE organizations SET checkout_reservation_id = gen_random_uuid(), checkout_reservation_plan = 'pro:monthly',
                checkout_reservation_expires_at = NOW() + interval '30 minutes', checkout_session_id = NULL
          WHERE id = $1 RETURNING checkout_reservation_id`,
        [id]
      );
      otherReservation = rows[0].checkout_reservation_id;
    });
    const c = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(c.req, c.res);

    const { status, body } = answer(c);
    expect(status).toBe(409);
    expect(body).toEqual({ success: false, code: 'CHECKOUT_IN_PROGRESS', error: CHECKOUT_IN_PROGRESS_MESSAGE });
    expect(JSON.stringify(body)).not.toContain('checkout.example');
    expect((await orgRow(orgId)).checkout_reservation_id).toBe(otherReservation);
    const funnel = await pool.query(
      `SELECT count(*)::int AS n FROM analytics_events WHERE organization_id = $1 AND event_name = 'checkout_started'`,
      [orgId]
    );
    expect(funnel.rows[0].n).toBe(0);
  });

  it('a Checkout failure answers the fixed message; the error text only reaches the server log', async () => {
    const { orgId } = await insertOrg();
    const internal = 'No such price: price_test_internal_detail';
    jest.spyOn(stripeService, 'createCheckoutSession').mockRejectedValue(new Error(internal));
    const c = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(c.req, c.res);

    expect(answer(c)).toEqual({ status: 500, body: { success: false, error: 'Failed to create checkout session' } });
    const logged = (console.error as jest.Mock).mock.calls.flat().map(a => (a instanceof Error ? a.message : String(a))).join('\n');
    expect(logged).toContain(internal);
  });
});

describe('PR A leftovers: the reservation replace is compare-and-swap', () => {
  it('replaces only while the reservation is still the one the caller expired', async () => {
    const { orgId } = await insertOrg();
    const first = await tryReserveCheckout(orgId, 'pro:monthly', pool);
    expect(first).not.toBeNull();
    // Another request clears it and takes a new one.
    await pool.query(
      `UPDATE organizations SET checkout_reservation_id = NULL, checkout_reservation_plan = NULL,
              checkout_reservation_expires_at = NULL, checkout_session_id = NULL WHERE id = $1`,
      [orgId]
    );
    const second = await tryReserveCheckout(orgId, 'pro:monthly', pool);
    expect(second).not.toBeNull();

    expect(await replaceCheckoutReservation(orgId, first!, 'starter:monthly')).toBeNull();
    expect((await orgRow(orgId)).checkout_reservation_id).toBe(second);
  });

  it('still replaces its own reservation', async () => {
    const { orgId } = await insertOrg();
    const first = await tryReserveCheckout(orgId, 'pro:monthly', pool);
    const replaced = await replaceCheckoutReservation(orgId, first!, 'starter:monthly');
    expect(replaced).not.toBeNull();
    expect(replaced).not.toBe(first);
    expect((await orgRow(orgId)).checkout_reservation_id).toBe(replaced);
  });

  it('through Checkout: a different-plan request whose reservation is taken while Stripe expires the old session answers CHECKOUT_IN_PROGRESS and leaves the new reservation', async () => {
    const { orgId } = await insertOrg();
    const sessions: any[] = [];
    jest.spyOn(stripeService, 'createCheckoutSession').mockImplementation(async () => {
      const id = `cs_test_${uniqueSuffix()}`;
      const session = { id, url: `https://checkout.example/${id}`, status: 'open' };
      sessions.push(session);
      return session as any;
    });
    jest.spyOn(stripeService, 'retrieveCheckoutSession').mockImplementation(async (id: string) => sessions.find(s => s.id === id));
    let taken = '';
    jest.spyOn(stripeService, 'expireCheckoutSession').mockImplementation(async (id: string) => {
      // Meanwhile a same-plan request found the session expired, cleared the
      // reservation and took a new one.
      await pool.query(
        `UPDATE organizations SET checkout_reservation_id = NULL, checkout_reservation_plan = NULL,
                checkout_reservation_expires_at = NULL, checkout_session_id = NULL WHERE id = $1`,
        [orgId]
      );
      taken = (await tryReserveCheckout(orgId, 'pro:monthly', pool))!;
      return { id, status: 'expired' } as any;
    });

    const first = checkoutReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(first.req, first.res);
    expect(answer(first).status).toBe(200);

    const second = checkoutReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);
    await stripeController.createCheckoutSession(second.req, second.res);
    expect(answer(second)).toEqual({ status: 409, body: { success: false, code: 'CHECKOUT_IN_PROGRESS', error: CHECKOUT_IN_PROGRESS_MESSAGE } });
    expect((await orgRow(orgId)).checkout_reservation_id).toBe(taken);
    expect(sessions).toHaveLength(1);
  });
});

describe('PR A leftovers: subscription writes never log Stripe ids', () => {
  it('a completion, an update and a deletion log neither the customer nor the subscription id', async () => {
    const { orgId, customerId } = await insertOrg();
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(
      subscriptionObject(subscriptionId, customerId, 'active', 'STRIPE_PRICE_PRO_MONTHLY', { organizationId: orgId }) as any
    );
    await deliver(fakeEvent('checkout.session.completed',
      { id: `cs_test_${uniqueSuffix()}`, metadata: { organizationId: orgId }, customer: customerId, subscription: subscriptionId }));
    await deliver(fakeEvent('customer.subscription.updated', subscriptionObject(subscriptionId, customerId, 'past_due', 'STRIPE_PRICE_PRO_MONTHLY')));
    await deliver(fakeEvent('customer.subscription.deleted', { id: subscriptionId, customer: customerId, status: 'canceled' }));
    expect(await orgRow(orgId)).toMatchObject({ subscription_status: 'canceled', stripe_subscription_id: subscriptionId });

    const everything = ['log', 'warn', 'error']
      .flatMap(level => (console as any)[level].mock.calls.flat())
      .map((a: unknown) => (typeof a === 'string' ? a : JSON.stringify(a)))
      .join('\n');
    expect(everything).not.toContain(subscriptionId);
    expect(everything).not.toContain(customerId);
  });
});
