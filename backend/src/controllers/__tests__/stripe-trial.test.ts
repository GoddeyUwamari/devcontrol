/**
 * The 14-day free trial, end to end through Checkout, the webhooks and the
 * billing summary, on real Postgres with Stripe mocked at the StripeService
 * boundary (no STRIPE_SECRET_KEY, so an unmocked call throws before any
 * request). Ids are test placeholders.
 *
 *  - Eligibility is read in PR A's reservation statement; the trial is
 *    claimed only when Stripe shows it on a subscription verified as the
 *    organization's own. Abandoned, expired, replaced and failed checkouts
 *    never use it up; a canceled trial does.
 *  - A second trialing subscription is canceled automatically.
 *  - The first charge after the trial has no grace period and no email of
 *    ours, in every delivery order; later charges keep the ordinary grace.
 *  - Hand-provisioned organizations cannot start self-serve Checkout.
 *  - The server switch (BILLING_TRIAL_ENABLED) gates every trial offer.
 *  - The billing summary keeps plan, subscription, trial, usage and actions
 *    apart, and never carries a Stripe id.
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { stripeController, MANAGED_PLAN_MESSAGE, CONTACT_SALES_MESSAGE } from '../stripe.controller';
import stripeService, { TrialIntervalChangeError } from '../../services/stripe.service';
import { getOrganizationEntitlement } from '../../middleware/subscription.middleware';
import * as middleware from '../../middleware/subscription.middleware';
import { clearSubscriptionSnapshots } from '../../services/subscription-snapshot.service';

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

const FAKE_PRICE_ENV: Record<string, string> = {
  STRIPE_PRICE_STARTER_MONTHLY: 'price_test_trial_starter_monthly',
  STRIPE_PRICE_STARTER_ANNUAL: 'price_test_trial_starter_annual',
  STRIPE_PRICE_PRO_MONTHLY: 'price_test_trial_pro_monthly',
  STRIPE_PRICE_PRO_ANNUAL: 'price_test_trial_pro_annual',
  STRIPE_PRICE_ENTERPRISE_MONTHLY: 'price_test_trial_enterprise_monthly',
};
const originalEnv: Record<string, string | undefined> = {};
for (const [name, value] of Object.entries(FAKE_PRICE_ENV)) {
  originalEnv[name] = process.env[name];
  process.env[name] = value;
}
originalEnv.BILLING_TRIAL_ENABLED = process.env.BILLING_TRIAL_ENABLED;
originalEnv.FRONTEND_URL = process.env.FRONTEND_URL;
process.env.FRONTEND_URL = 'https://app.example';

let counter = 0;
function uniqueSuffix(): string {
  counter += 1;
  return `${Date.now()}-${counter}-${Math.random().toString(36).slice(2, 8)}`;
}

interface OrgOptions {
  tier?: string;
  status?: string | null;
  subscriptionId?: string | null;
  trialUsed?: boolean;
  trialSubscriptionId?: string | null;
}

async function insertOrg(options: OrgOptions = {}) {
  const suffix = uniqueSuffix();
  const customerId = `cus_test_${suffix}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, subscription_status, stripe_customer_id,
                                stripe_subscription_id, trial_used_at, trial_subscription_id)
     VALUES ($1, $2, $1, $3, $4, $5, $6, CASE WHEN $7 THEN NOW() ELSE NULL END, $8) RETURNING id`,
    [`Trial Org ${suffix}`, `trial-org-${suffix}`, options.tier ?? 'free', options.status === undefined ? 'free' : options.status,
     customerId, options.subscriptionId ?? null, options.trialUsed === true, options.trialSubscriptionId ?? null]
  );
  createdOrgIds.push(rows[0].id);
  return { orgId: rows[0].id as string, customerId };
}

async function orgRow(orgId: string) {
  const { rows } = await pool.query(
    `SELECT subscription_tier, subscription_status, stripe_subscription_id, billing_lifecycle_state,
            grace_period_ends_at, payment_failed_at, trial_used_at, trial_subscription_id,
            checkout_reservation_id, checkout_session_id
       FROM organizations WHERE id = $1`,
    [orgId]
  );
  return rows[0];
}

const entitlement = (orgId: string) => getOrganizationEntitlement(orgId, pool);

async function funnelCount(orgId: string, eventName: string): Promise<number> {
  const { rows } = await pool.query(
    'SELECT count(*)::int AS n FROM analytics_events WHERE organization_id = $1 AND event_name = $2',
    [orgId, eventName]
  );
  return rows[0].n;
}

// Event and invoice times run ahead of the wall clock so they always order
// after any synchronous write a test makes, and increase strictly.
let nextCreated = Math.floor(Date.now() / 1000) + 3600;
function fakeEvent(type: string, object: any, created?: number) {
  return { id: `evt_test_${uniqueSuffix()}`, type, data: { object }, created: created ?? nextCreated++ };
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

const TRIAL_START = Math.floor(Date.now() / 1000) - 60;
const TRIAL_END = TRIAL_START + 14 * 24 * 3600;

function subscriptionObject(
  id: string, customer: string, status: string, priceEnv: string,
  extra: { trial?: boolean; metadata?: Record<string, string>; amount?: number; interval?: 'month' | 'year' } = {}
) {
  return {
    id,
    customer,
    status,
    items: { data: [{
      id: `si_test_${id}`,
      current_period_start: TRIAL_START,
      current_period_end: TRIAL_END,
      price: {
        id: FAKE_PRICE_ENV[priceEnv],
        unit_amount: extra.amount ?? 19900,
        currency: 'usd',
        recurring: { interval: extra.interval ?? (priceEnv.endsWith('ANNUAL') ? 'year' : 'month') },
      },
    }] },
    cancel_at_period_end: false,
    cancel_at: null,
    trial_start: extra.trial ? TRIAL_START : null,
    trial_end: extra.trial ? TRIAL_END : null,
    ...(extra.metadata ? { metadata: extra.metadata } : {}),
  };
}

function invoiceOf(customer: string, subscription: string, created?: number) {
  return {
    id: `in_test_${uniqueSuffix()}`,
    customer,
    created: created ?? nextCreated++,
    parent: { subscription_details: { subscription } },
  };
}

function reqRes(body: any, organizationId: string, role = 'owner') {
  const req = {
    user: { organizationId, userId: undefined, email: `owner-${uniqueSuffix()}@example.com`, role },
    body,
  } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  return { req, res: { json, status } as unknown as Response, json, status };
}

function answer(mock: { status: jest.Mock; json: jest.Mock }): { status: number; body: any } {
  return { status: mock.status.mock.calls[0]?.[0], body: mock.json.mock.calls[0]?.[0] };
}

/** Mocks session creation; returns the trial flag of every created session. */
function mockSessions(): { trials: Array<boolean | undefined>; sessions: any[] } {
  const record = { trials: [] as Array<boolean | undefined>, sessions: [] as any[] };
  jest.spyOn(stripeService, 'createCheckoutSession').mockImplementation(async (...args: any[]) => {
    record.trials.push(args[5]?.trial);
    const id = `cs_test_${uniqueSuffix()}`;
    const session = { id, url: `https://checkout.example/${id}`, status: 'open' };
    record.sessions.push(session);
    return session as any;
  });
  jest.spyOn(stripeService, 'retrieveCheckoutSession').mockImplementation(async (id: string) => record.sessions.find(s => s.id === id));
  jest.spyOn(stripeService, 'expireCheckoutSession').mockImplementation(async (id: string) => {
    const session = record.sessions.find(s => s.id === id);
    session.status = 'expired';
    return session;
  });
  return record;
}

async function checkout(orgId: string, tier: string, billingInterval = 'monthly', extraBody: Record<string, unknown> = {}) {
  const call = reqRes({ tier, billingInterval, ...extraBody }, orgId);
  await stripeController.createCheckoutSession(call.req, call.res);
  return answer(call);
}

async function summary(orgId: string, role = 'owner') {
  const call = reqRes({}, orgId, role);
  await stripeController.getSubscription(call.req, call.res);
  return answer(call);
}

/** An organization on a recorded trial subscription, claimed. */
async function trialingOrg(tier: 'starter' | 'pro' = 'pro', interval: 'MONTHLY' | 'ANNUAL' = 'MONTHLY') {
  const { orgId, customerId } = await insertOrg();
  const subscriptionId = `sub_test_${uniqueSuffix()}`;
  const priceEnv = `STRIPE_PRICE_${tier.toUpperCase()}_${interval}`;
  await deliver(fakeEvent('customer.subscription.created',
    subscriptionObject(subscriptionId, customerId, 'trialing', priceEnv, { trial: true, metadata: { organizationId: orgId } })));
  // The $0 invoice at the trial's start.
  await deliver(fakeEvent('invoice.paid', invoiceOf(customerId, subscriptionId)));
  return { orgId, customerId, subscriptionId, priceEnv };
}

/**
 * Test events are dated ahead of the clock; a synchronous write (cancel,
 * change plan) made after them is dated now, so the ordering mark is moved
 * back first, as if those events had arrived at their real time.
 */
async function rewindOrdering(orgId: string) {
  await pool.query(
    `UPDATE organizations SET latest_processed_subscription_event_created_at = NOW() - interval '1 hour' WHERE id = $1`,
    [orgId]
  );
}

const updated = (subscriptionId: string, customerId: string, status: string, priceEnv: string, orgId: string, created?: number) =>
  fakeEvent('customer.subscription.updated',
    subscriptionObject(subscriptionId, customerId, status, priceEnv, { trial: true, metadata: { organizationId: orgId } }), created);

let emailSpy: jest.SpyInstance;
let logLines: () => string;

beforeAll(() => {
  expect(process.env.STRIPE_SECRET_KEY).toBeUndefined();
});

beforeEach(() => {
  const spies = (['log', 'warn', 'error'] as const).map(level => jest.spyOn(console, level).mockImplementation(() => {}));
  logLines = () => spies.flatMap(s => s.mock.calls.flat()).map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join('\n');
  emailSpy = jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);
  process.env.BILLING_TRIAL_ENABLED = 'true';
  clearSubscriptionSnapshots();
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
    await pool.query('DELETE FROM stripe_webhook_events WHERE stripe_event_id LIKE $1', ['evt_test_%']).catch(() => undefined);
    await pool.query('DELETE FROM analytics_events WHERE organization_id = ANY($1)', [createdOrgIds]).catch(() => undefined);
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

// ─── Checkout: who gets the trial ────────────────────────────────────────────

describe('Checkout: the trial is offered only to eligible organizations, decided with the reservation', () => {
  it.each([
    ['starter', 'monthly'],
    ['starter', 'annual'],
    ['pro', 'monthly'],
    ['pro', 'annual'],
  ])('%s/%s, never used, switch on: the session carries the trial; nothing is claimed yet', async (tier, interval) => {
    const { orgId } = await insertOrg();
    const record = mockSessions();
    expect((await checkout(orgId, tier, interval)).status).toBe(200);
    expect(record.trials).toEqual([true]);
    expect((await orgRow(orgId)).trial_used_at).toBeNull();
  });

  it('switch off (unset): no trial in Checkout, and the summary offers none', async () => {
    delete process.env.BILLING_TRIAL_ENABLED;
    const { orgId } = await insertOrg();
    const record = mockSessions();
    expect((await checkout(orgId, 'pro')).status).toBe(200);
    expect(record.trials).toEqual([false]);
    expect((await summary(orgId)).body.data.trial).toEqual({ used: false, active: false, endsAt: null, eligible: false });
  });

  it.each([['false'], ['TRUE'], ['1']])('switch value %s is not "true": off', async (value) => {
    process.env.BILLING_TRIAL_ENABLED = value;
    const { orgId } = await insertOrg();
    const record = mockSessions();
    await checkout(orgId, 'starter');
    expect(record.trials).toEqual([false]);
  });

  it('an organization that already used its trial (here, a canceled one) gets a normal paid Checkout', async () => {
    const old = `sub_test_${uniqueSuffix()}`;
    const { orgId } = await insertOrg({ status: 'free', trialUsed: true, trialSubscriptionId: old });
    const record = mockSessions();
    expect((await checkout(orgId, 'pro')).status).toBe(200);
    expect(record.trials).toEqual([false]);
  });

  it('an organization that ever recorded a subscription (now canceled) gets no trial', async () => {
    const { orgId } = await insertOrg({ status: 'canceled', subscriptionId: `sub_test_${uniqueSuffix()}` });
    const record = mockSessions();
    expect((await checkout(orgId, 'starter')).status).toBe(200);
    expect(record.trials).toEqual([false]);
  });

  it('Revenue Protection: Contact Sales, no reservation, no session', async () => {
    const { orgId } = await insertOrg();
    const record = mockSessions();
    expect(await checkout(orgId, 'enterprise')).toEqual({ status: 400, body: { success: false, code: 'CONTACT_SALES', error: CONTACT_SALES_MESSAGE } });
    expect(record.sessions).toHaveLength(0);
    expect((await orgRow(orgId)).checkout_reservation_id).toBeNull();
  });

  it('the client cannot ask for a trial: unknown body fields are refused', async () => {
    const { orgId } = await insertOrg();
    const record = mockSessions();
    for (const field of ['trial_period_days', 'trialEnd', 'trial']) {
      expect((await checkout(orgId, 'pro', 'monthly', { [field]: 30 })).status).toBe(400);
    }
    expect(record.sessions).toHaveLength(0);
  });

  it('concurrent checkouts: one session, one trial offer', async () => {
    const { orgId } = await insertOrg();
    const record = mockSessions();
    const answers = await Promise.all(Array.from({ length: 6 }, () => checkout(orgId, 'pro')));
    expect(record.sessions).toHaveLength(1);
    expect(record.trials).toEqual([true]);
    expect(answers.every(a => a.status === 200 || a.body.code === 'CHECKOUT_IN_PROGRESS')).toBe(true);
    expect((await orgRow(orgId)).trial_used_at).toBeNull();
  });
});

describe('F-2: a plan our team set up cannot start self-serve Checkout', () => {
  it.each([
    ['pro', 'free'],
    ['starter', 'active'],
    ['pro', null],
  ])('stored %s (status %s), no subscription: 400 MANAGED_PLAN with the approved text, no reservation, no Stripe call', async (tier, status) => {
    const { orgId } = await insertOrg({ tier, status });
    const record = mockSessions();
    expect(await checkout(orgId, 'starter')).toEqual({ status: 400, body: { success: false, code: 'MANAGED_PLAN', error: MANAGED_PLAN_MESSAGE } });
    expect(MANAGED_PLAN_MESSAGE).toBe('Your plan is set up and billed by our team. Contact us to make changes.');
    expect(record.sessions).toHaveLength(0);
    expect((await orgRow(orgId)).checkout_reservation_id).toBeNull();
  });

  it('a hand-provisioned Revenue Protection org keeps the Contact Sales answer', async () => {
    const { orgId } = await insertOrg({ tier: 'enterprise', status: 'active' });
    mockSessions();
    expect((await checkout(orgId, 'pro')).body.code).toBe('CONTACT_SALES');
  });
});

describe('abandoned, expired, replaced or failed checkouts never use up the trial', () => {
  it('session creation fails: reservation released, trial untouched, the next checkout still gets the trial', async () => {
    const { orgId } = await insertOrg();
    jest.spyOn(stripeService, 'createCheckoutSession').mockRejectedValueOnce(Object.assign(new Error('boom'), { name: 'StripeAPIError' }));
    expect((await checkout(orgId, 'pro')).status).toBe(500);
    expect(await orgRow(orgId)).toMatchObject({ trial_used_at: null, checkout_reservation_id: null });
    const record = mockSessions();
    expect((await checkout(orgId, 'pro')).status).toBe(200);
    expect(record.trials).toEqual([true]);
  });

  it('a different plan expires the open session and replaces the reservation: the new session still carries the trial', async () => {
    const { orgId } = await insertOrg();
    const record = mockSessions();
    await checkout(orgId, 'starter');
    expect((await checkout(orgId, 'pro')).status).toBe(200);
    expect(record.trials).toEqual([true, true]);
    expect(record.sessions[0].status).toBe('expired');
    expect((await orgRow(orgId)).trial_used_at).toBeNull();
  });

  it('an abandoned session that expired: the reservation is taken again and the trial is still offered', async () => {
    const { orgId } = await insertOrg();
    const record = mockSessions();
    await checkout(orgId, 'pro');
    record.sessions[0].status = 'expired';
    await pool.query(`UPDATE organizations SET checkout_reservation_expires_at = NOW() - interval '1 second' WHERE id = $1`, [orgId]);
    expect((await checkout(orgId, 'pro')).status).toBe(200);
    expect(record.trials).toEqual([true, true]);
    expect((await orgRow(orgId)).trial_used_at).toBeNull();
  });

  it('a completed checkout of a subscription without a trial claims nothing', async () => {
    const { orgId, customerId } = await insertOrg();
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(
      subscriptionObject(subscriptionId, customerId, 'active', 'STRIPE_PRICE_PRO_MONTHLY', { metadata: { organizationId: orgId } }) as any);
    await deliver(fakeEvent('checkout.session.completed',
      { id: `cs_test_${uniqueSuffix()}`, metadata: { organizationId: orgId }, customer: customerId, subscription: subscriptionId }));
    expect(await orgRow(orgId)).toMatchObject({ stripe_subscription_id: subscriptionId, trial_used_at: null, trial_subscription_id: null });
  });
});

// ─── The claim ───────────────────────────────────────────────────────────────

describe('the claim: once Stripe shows a trial on the organization\'s own subscription', () => {
  it('checkout completion claims it; trial_started once; redelivery and a later update change nothing', async () => {
    const { orgId, customerId } = await insertOrg();
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const sub = subscriptionObject(subscriptionId, customerId, 'trialing', 'STRIPE_PRICE_STARTER_MONTHLY', { trial: true, metadata: { organizationId: orgId } });
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(sub as any);
    const completion = fakeEvent('checkout.session.completed',
      { id: `cs_test_${uniqueSuffix()}`, metadata: { organizationId: orgId }, customer: customerId, subscription: subscriptionId });
    await deliver(completion);
    const first = await orgRow(orgId);
    expect(first).toMatchObject({ subscription_status: 'trialing', subscription_tier: 'starter', trial_subscription_id: subscriptionId });
    expect(first.trial_used_at).not.toBeNull();
    expect(await entitlement(orgId)).toEqual({ storedTier: 'starter', effectiveTier: 'starter', hold: null });

    await deliver({ ...completion, id: `evt_test_${uniqueSuffix()}` });
    await deliver(updated(subscriptionId, customerId, 'trialing', 'STRIPE_PRICE_STARTER_MONTHLY', orgId));
    const after = await orgRow(orgId);
    expect(after.trial_used_at.toISOString()).toBe(first.trial_used_at.toISOString());
    expect(await funnelCount(orgId, 'trial_started')).toBe(1);
    // A trial is not a paying activation.
    expect(await funnelCount(orgId, 'subscription_activated')).toBe(0);
  });

  it('subscription.created before the completion: claimed once', async () => {
    const { orgId, customerId, subscriptionId } = await trialingOrg('starter');
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(
      subscriptionObject(subscriptionId, customerId, 'trialing', 'STRIPE_PRICE_STARTER_MONTHLY', { trial: true, metadata: { organizationId: orgId } }) as any);
    await deliver(fakeEvent('checkout.session.completed',
      { id: `cs_test_${uniqueSuffix()}`, metadata: { organizationId: orgId }, customer: customerId, subscription: subscriptionId }));
    expect((await orgRow(orgId)).trial_subscription_id).toBe(subscriptionId);
    expect(await funnelCount(orgId, 'trial_started')).toBe(1);
  });

  it('a trial canceled (in the Portal) before any event was recorded still uses up the trial', async () => {
    const { orgId, customerId } = await insertOrg();
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    await deliver(fakeEvent('customer.subscription.deleted',
      subscriptionObject(subscriptionId, customerId, 'canceled', 'STRIPE_PRICE_PRO_MONTHLY', { trial: true, metadata: { organizationId: orgId } })));
    const row = await orgRow(orgId);
    expect(row.trial_used_at).not.toBeNull();
    expect(row.trial_subscription_id).toBe(subscriptionId);
    expect(row.stripe_subscription_id).toBeNull();
    const record = mockSessions();
    await checkout(orgId, 'pro');
    expect(record.trials).toEqual([false]);
  });

  it('cancel during the trial (immediately): free at once, trial still used, the next checkout has no trial', async () => {
    const { orgId, subscriptionId } = await trialingOrg('pro');
    await rewindOrdering(orgId);
    jest.spyOn(stripeService, 'cancelSubscription').mockResolvedValue({ id: subscriptionId, status: 'canceled', cancel_at_period_end: false, cancel_at: null } as any);
    const call = reqRes({ immediate: true }, orgId);
    await stripeController.cancelSubscription(call.req, call.res);
    expect(answer(call).status).toBe(200);
    expect(await entitlement(orgId)).toMatchObject({ effectiveTier: 'free' });
    expect((await orgRow(orgId)).trial_used_at).not.toBeNull();
    const record = mockSessions();
    await checkout(orgId, 'pro');
    expect(record.trials).toEqual([false]);
  });

  it('cancel at the trial\'s end: paid until the deletion, then free; trial still used', async () => {
    const { orgId, customerId, subscriptionId, priceEnv } = await trialingOrg('pro');
    await rewindOrdering(orgId);
    jest.spyOn(stripeService, 'cancelSubscriptionAtPeriodEnd').mockResolvedValue(
      { ...subscriptionObject(subscriptionId, customerId, 'trialing', priceEnv, { trial: true }), cancel_at_period_end: true } as any);
    const call = reqRes({}, orgId);
    await stripeController.cancelSubscription(call.req, call.res);
    expect(await entitlement(orgId)).toMatchObject({ effectiveTier: 'pro' });
    await deliver(fakeEvent('customer.subscription.deleted',
      subscriptionObject(subscriptionId, customerId, 'canceled', priceEnv, { trial: true, metadata: { organizationId: orgId } })));
    expect(await entitlement(orgId)).toMatchObject({ effectiveTier: 'free', hold: null });
    expect((await orgRow(orgId)).trial_used_at).not.toBeNull();
  });

  it('a subscription whose metadata names another organization claims nothing', async () => {
    const { orgId, customerId } = await insertOrg();
    const { orgId: other } = await insertOrg();
    await deliver(fakeEvent('customer.subscription.created',
      subscriptionObject(`sub_test_${uniqueSuffix()}`, customerId, 'trialing', 'STRIPE_PRICE_PRO_MONTHLY', { trial: true, metadata: { organizationId: other } })));
    expect((await orgRow(orgId)).trial_used_at).toBeNull();
    expect((await orgRow(other)).trial_used_at).toBeNull();
  });

  it('two claims at once for different subscriptions: exactly one wins', async () => {
    const { orgId, customerId } = await insertOrg();
    const results = await Promise.all([
      stripeService.claimTrial(orgId, customerId, `sub_test_a_${uniqueSuffix()}`),
      stripeService.claimTrial(orgId, customerId, `sub_test_b_${uniqueSuffix()}`),
    ]);
    expect(results.filter(r => r === 'claimed')).toHaveLength(1);
    expect(results.filter(r => r === 'other_subscription')).toHaveLength(1);
  });
});

// ─── A second trial ──────────────────────────────────────────────────────────

describe('TR-Q3: a second trialing subscription is canceled automatically', () => {
  it('completion of a second trial: canceled with an idempotency key, never recorded, reservation released, logged with the org id only', async () => {
    const { orgId, customerId, subscriptionId: first } = await trialingOrg('pro');
    const second = `sub_test_${uniqueSuffix()}`;
    const sessionId = `cs_test_${uniqueSuffix()}`;
    await pool.query(
      `UPDATE organizations SET checkout_reservation_id = gen_random_uuid(), checkout_reservation_plan = 'pro:monthly',
              checkout_reservation_expires_at = NOW() + interval '30 minutes', checkout_session_id = $2 WHERE id = $1`,
      [orgId, sessionId]
    );
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(
      subscriptionObject(second, customerId, 'trialing', 'STRIPE_PRICE_PRO_MONTHLY', { trial: true, metadata: { organizationId: orgId } }) as any);
    const cancel = jest.spyOn(stripeService, 'cancelSubscription').mockResolvedValue({ id: second, status: 'canceled' } as any);
    await deliver(fakeEvent('checkout.session.completed', { id: sessionId, metadata: { organizationId: orgId }, customer: customerId, subscription: second }));

    expect(cancel).toHaveBeenCalledTimes(1);
    expect(cancel).toHaveBeenCalledWith(second, { idempotencyKey: `cancel-duplicate-trial-${second}` });
    expect(await orgRow(orgId)).toMatchObject({
      stripe_subscription_id: first, subscription_status: 'trialing', trial_subscription_id: first,
      checkout_reservation_id: null, checkout_session_id: null,
    });
    const logs = logLines();
    expect(logs).toContain(`[Billing] Organization ${orgId} had already used its free trial; a second trialing subscription was canceled automatically (nothing was charged).`);
    expect(logs).not.toContain(second);
    expect(logs).not.toContain(customerId);
  });

  it('subscription.updated of a second trial: canceled; its later canceled/deleted events change nothing and are not canceled again', async () => {
    const { orgId, customerId, subscriptionId: first } = await trialingOrg('starter');
    const second = `sub_test_${uniqueSuffix()}`;
    const cancel = jest.spyOn(stripeService, 'cancelSubscription').mockResolvedValue({ id: second, status: 'canceled' } as any);
    await deliver(updated(second, customerId, 'trialing', 'STRIPE_PRICE_PRO_MONTHLY', orgId));
    await deliver(updated(second, customerId, 'canceled', 'STRIPE_PRICE_PRO_MONTHLY', orgId));
    await deliver(fakeEvent('customer.subscription.deleted',
      subscriptionObject(second, customerId, 'canceled', 'STRIPE_PRICE_PRO_MONTHLY', { trial: true, metadata: { organizationId: orgId } })));
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(await orgRow(orgId)).toMatchObject({ stripe_subscription_id: first, subscription_tier: 'starter', subscription_status: 'trialing' });
    expect(await entitlement(orgId)).toEqual({ storedTier: 'starter', effectiveTier: 'starter', hold: null });
  });

  it('a second subscription with a trial that is no longer trialing is left for manual review (no automatic cancel)', async () => {
    const { orgId, customerId } = await trialingOrg('pro');
    const second = `sub_test_${uniqueSuffix()}`;
    const cancel = jest.spyOn(stripeService, 'cancelSubscription');
    await deliver(updated(second, customerId, 'active', 'STRIPE_PRICE_PRO_MONTHLY', orgId));
    expect(cancel).not.toHaveBeenCalled();
    expect(logLines()).toContain(`[Billing] Organization ${orgId} had already used its free trial; another subscription with a trial is past its trial and needs manual review in Stripe (not canceled automatically).`);
  });

  it('M-1: a trialing subscription without this organization\'s checkout metadata (e.g. a Dashboard sales pilot) is logged, never canceled', async () => {
    const { orgId, customerId, subscriptionId: first } = await trialingOrg('pro');
    const pilot = `sub_test_${uniqueSuffix()}`;
    const cancel = jest.spyOn(stripeService, 'cancelSubscription');
    await deliver(fakeEvent('customer.subscription.updated',
      subscriptionObject(pilot, customerId, 'trialing', 'STRIPE_PRICE_ENTERPRISE_MONTHLY', { trial: true })));
    expect(cancel).not.toHaveBeenCalled();
    expect(logLines()).toContain(`[Billing] Organization ${orgId} had already used its free trial; another subscription with a trial does not carry this organization's checkout metadata and needs manual review in Stripe (not canceled automatically).`);
    expect(logLines()).not.toContain(pilot);
    expect((await orgRow(orgId)).stripe_subscription_id).toBe(first);
  });

  it('a Stripe failure while canceling the duplicate fails the event (Stripe redelivers), the duplicate is not recorded', async () => {
    const { orgId, customerId, subscriptionId: first } = await trialingOrg('pro');
    const second = `sub_test_${uniqueSuffix()}`;
    jest.spyOn(stripeService, 'cancelSubscription').mockRejectedValueOnce(Object.assign(new Error('down'), { name: 'StripeConnectionError' }));
    expect(await deliver(updated(second, customerId, 'trialing', 'STRIPE_PRICE_PRO_MONTHLY', orgId))).toBe(400);
    expect((await orgRow(orgId)).stripe_subscription_id).toBe(first);
  });
});

// ─── Lifecycle ───────────────────────────────────────────────────────────────

describe('lifecycle through entitlementOf', () => {
  it('trialing -> active: paid throughout; trial_converted and subscription_activated once, even when redelivered', async () => {
    const { orgId, customerId, subscriptionId, priceEnv } = await trialingOrg('pro');
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'pro', hold: null });
    await deliver(fakeEvent('invoice.paid', invoiceOf(customerId, subscriptionId)));
    const active = updated(subscriptionId, customerId, 'active', priceEnv, orgId);
    await deliver(active);
    await deliver({ ...active, id: `evt_test_${uniqueSuffix()}`, created: nextCreated++ });
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'pro', hold: null });
    expect(await funnelCount(orgId, 'trial_converted')).toBe(1);
    expect(await funnelCount(orgId, 'subscription_activated')).toBe(1);
  });

  it('a tier change within the interval during the trial: allowed, status stays trialing', async () => {
    const { orgId, customerId, subscriptionId } = await trialingOrg('starter');
    await rewindOrdering(orgId);
    const change = jest.spyOn(stripeService, 'updateSubscription').mockResolvedValue(
      subscriptionObject(subscriptionId, customerId, 'trialing', 'STRIPE_PRICE_PRO_MONTHLY', { trial: true }) as any);
    const call = reqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);
    await stripeController.changePlan(call.req, call.res);
    expect(answer(call).status).toBe(200);
    expect(change).toHaveBeenCalledWith(subscriptionId, FAKE_PRICE_ENV.STRIPE_PRICE_PRO_MONTHLY, 'monthly');
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'pro', hold: null });
  });

  it('monthly <-> annual during the trial: 409 TRIAL_INTERVAL_CHANGE with the existing text; nothing written', async () => {
    const { orgId } = await trialingOrg('starter');
    jest.spyOn(stripeService, 'updateSubscription').mockRejectedValue(new TrialIntervalChangeError());
    const call = reqRes({ tier: 'starter', billingInterval: 'annual' }, orgId);
    await stripeController.changePlan(call.req, call.res);
    expect(answer(call)).toEqual({ status: 409, body: { success: false, code: 'TRIAL_INTERVAL_CHANGE', error: 'That plan is not available right now' } });
    expect((await orgRow(orgId)).subscription_tier).toBe('starter');
  });
});

describe('the first charge after the trial: no grace, in every order; later charges keep the grace', () => {
  async function expectFirstChargeEnded(orgId: string) {
    const row = await orgRow(orgId);
    expect(row.billing_lifecycle_state).toBe('restricted');
    expect(row.grace_period_ends_at).toBeNull();
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'free', hold: 'payment' });
  }

  it('subscription event first (trialing -> past_due), then the invoice failure: access ends, no grace, no email', async () => {
    const { orgId, customerId, subscriptionId, priceEnv } = await trialingOrg('pro');
    await deliver(updated(subscriptionId, customerId, 'past_due', priceEnv, orgId));
    await expectFirstChargeEnded(orgId);
    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, subscriptionId)));
    await expectFirstChargeEnded(orgId);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('invoice failure first (still trialing), then past_due: access ends, no grace, no email', async () => {
    const { orgId, customerId, subscriptionId, priceEnv } = await trialingOrg('pro');
    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, subscriptionId)));
    await expectFirstChargeEnded(orgId);
    await deliver(updated(subscriptionId, customerId, 'past_due', priceEnv, orgId));
    await expectFirstChargeEnded(orgId);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('duplicates and Stripe\'s retries (more failed attempts, unpaid) never open a grace period', async () => {
    const { orgId, customerId, subscriptionId, priceEnv } = await trialingOrg('pro');
    const failure = fakeEvent('invoice.payment_failed', invoiceOf(customerId, subscriptionId));
    await deliver(failure);
    expect(await deliver(failure)).toBe(200);
    for (let attempt = 0; attempt < 3; attempt++) {
      await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, subscriptionId)));
    }
    await deliver(updated(subscriptionId, customerId, 'past_due', priceEnv, orgId));
    await deliver(updated(subscriptionId, customerId, 'unpaid', priceEnv, orgId));
    await expectFirstChargeEnded(orgId);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('late events: an older trialing update after past_due is ignored; access stays ended', async () => {
    const { orgId, customerId, subscriptionId, priceEnv } = await trialingOrg('pro');
    const older = nextCreated++;
    await deliver(updated(subscriptionId, customerId, 'past_due', priceEnv, orgId));
    await deliver(updated(subscriptionId, customerId, 'trialing', priceEnv, orgId, older));
    await expectFirstChargeEnded(orgId);
  });

  it('a late failure of the first invoice after it was paid (status not yet updated) never ends access at once', async () => {
    const { orgId, customerId, subscriptionId } = await trialingOrg('pro');
    const firstInvoiceCreated = nextCreated++;
    await deliver(fakeEvent('invoice.paid', invoiceOf(customerId, subscriptionId, firstInvoiceCreated)));
    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, subscriptionId, firstInvoiceCreated)));
    expect((await orgRow(orgId)).billing_lifecycle_state).not.toBe('restricted');
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'pro', hold: null });
  });

  it('the subscription ends after the failed first charge: free; a late failure of that invoice opens no grace and sends no email', async () => {
    const { orgId, customerId, subscriptionId, priceEnv } = await trialingOrg('pro');
    const firstInvoiceCreated = nextCreated++;
    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, subscriptionId, firstInvoiceCreated)));
    await deliver(fakeEvent('customer.subscription.deleted',
      subscriptionObject(subscriptionId, customerId, 'canceled', priceEnv, { trial: true, metadata: { organizationId: orgId } })));
    expect(await entitlement(orgId)).toEqual({ storedTier: 'free', effectiveTier: 'free', hold: null });
    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, subscriptionId, firstInvoiceCreated)));
    const row = await orgRow(orgId);
    expect(row.billing_lifecycle_state).toBe('restricted');
    expect(row.grace_period_ends_at).toBeNull();
    expect(emailSpy).not.toHaveBeenCalled();
    expect((await summary(orgId)).body.data.plan.entitlementHold).toBeNull();
  });

  it('and a new subscription afterwards is paid once its first invoice is paid', async () => {
    const { orgId, customerId, subscriptionId, priceEnv } = await trialingOrg('pro');
    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, subscriptionId)));
    await deliver(fakeEvent('customer.subscription.deleted',
      subscriptionObject(subscriptionId, customerId, 'canceled', priceEnv, { trial: true, metadata: { organizationId: orgId } })));
    const next = `sub_test_${uniqueSuffix()}`;
    await deliver(fakeEvent('customer.subscription.created',
      subscriptionObject(next, customerId, 'active', 'STRIPE_PRICE_STARTER_MONTHLY', { metadata: { organizationId: orgId } })));
    await deliver(fakeEvent('invoice.paid', invoiceOf(customerId, next)));
    expect(await entitlement(orgId)).toEqual({ storedTier: 'starter', effectiveTier: 'starter', hold: null });
  });

  it('Stripe\'s retry succeeds: paid again; a later recurring failure gets the ordinary 7-day grace and the email', async () => {
    const { orgId, customerId, subscriptionId, priceEnv } = await trialingOrg('pro');
    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, subscriptionId)));
    await deliver(fakeEvent('invoice.paid', invoiceOf(customerId, subscriptionId)));
    await deliver(updated(subscriptionId, customerId, 'active', priceEnv, orgId));
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'pro', hold: null });

    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, subscriptionId)));
    await deliver(updated(subscriptionId, customerId, 'past_due', priceEnv, orgId));
    const row = await orgRow(orgId);
    expect(row.billing_lifecycle_state).toBe('grace_period');
    const graceDays = (new Date(row.grace_period_ends_at).getTime() - Date.now()) / 86400000;
    expect(graceDays).toBeGreaterThan(6.9);
    expect(graceDays).toBeLessThanOrEqual(7);
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'pro', hold: null });
    expect(emailSpy).toHaveBeenCalledTimes(1);
  });

  it('a subscription that never had a trial: active -> past_due keeps the ordinary grace (unchanged)', async () => {
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'pro', status: 'active', subscriptionId });
    await deliver(fakeEvent('customer.subscription.updated',
      subscriptionObject(subscriptionId, customerId, 'past_due', 'STRIPE_PRICE_PRO_MONTHLY')));
    expect((await orgRow(orgId)).billing_lifecycle_state).toBe('healthy');
    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, subscriptionId)));
    expect((await orgRow(orgId)).billing_lifecycle_state).toBe('grace_period');
    expect(emailSpy).toHaveBeenCalledTimes(1);
  });

  it.todo('F-1 (separate PR): a late attempt-1 failure delivered after attempt-2 was paid reopens the ordinary grace');
});

describe('H-1: a recovered first charge never leaves a paying organization restricted', () => {
  // The first post-trial invoice is created at the trial's end, as Stripe does.
  const firstInvoice = (customerId: string, subscriptionId: string) => invoiceOf(customerId, subscriptionId, TRIAL_END + 5);
  const paidAndHealthy = async (orgId: string) => {
    const row = await orgRow(orgId);
    expect(row.billing_lifecycle_state).toBe('healthy');
    expect(row.payment_failed_at).toBeNull();
    expect(await entitlement(orgId)).toEqual({ storedTier: 'pro', effectiveTier: 'pro', hold: null });
  };

  it('reviewer\'s order: failure -> retry paid -> delayed trialing->past_due -> active: paid throughout after the payment', async () => {
    const { orgId, customerId, subscriptionId, priceEnv } = await trialingOrg('pro');
    const pastDueCreated = nextCreated++;
    const activeCreated = nextCreated++;
    const invoice = firstInvoice(customerId, subscriptionId);
    await deliver(fakeEvent('invoice.payment_failed', invoice));
    expect((await orgRow(orgId)).billing_lifecycle_state).toBe('restricted');
    await deliver(fakeEvent('invoice.paid', { ...invoice, id: invoice.id }));
    await paidAndHealthy(orgId);
    await deliver(updated(subscriptionId, customerId, 'past_due', priceEnv, orgId, pastDueCreated));
    await paidAndHealthy(orgId);
    await deliver(updated(subscriptionId, customerId, 'active', priceEnv, orgId, activeCreated));
    await paidAndHealthy(orgId);
    expect((await orgRow(orgId)).subscription_status).toBe('active');
  });

  it('no failure event seen first: paid -> delayed trialing->past_due -> active: never restricted', async () => {
    const { orgId, customerId, subscriptionId, priceEnv } = await trialingOrg('pro');
    const pastDueCreated = nextCreated++;
    await deliver(fakeEvent('invoice.paid', firstInvoice(customerId, subscriptionId)));
    await deliver(updated(subscriptionId, customerId, 'past_due', priceEnv, orgId, pastDueCreated));
    await paidAndHealthy(orgId);
    await deliver(updated(subscriptionId, customerId, 'active', priceEnv, orgId));
    await paidAndHealthy(orgId);
  });

  it('reverse order: trialing->past_due restricts; active (before invoice.paid) clears it; the invoice, duplicates and replays change nothing', async () => {
    const { orgId, customerId, subscriptionId, priceEnv } = await trialingOrg('pro');
    const pastDue = updated(subscriptionId, customerId, 'past_due', priceEnv, orgId);
    const olderPastDue = updated(subscriptionId, customerId, 'past_due', priceEnv, orgId, pastDue.created);
    await deliver(pastDue);
    expect((await orgRow(orgId)).billing_lifecycle_state).toBe('restricted');
    const active = updated(subscriptionId, customerId, 'active', priceEnv, orgId);
    await deliver(active);
    await paidAndHealthy(orgId);
    const paid = fakeEvent('invoice.paid', firstInvoice(customerId, subscriptionId));
    await deliver(paid);
    await paidAndHealthy(orgId);
    // Exact redeliveries (ledger duplicates) and a different event as old as the past_due one.
    expect(await deliver(pastDue)).toBe(200);
    expect(await deliver(active)).toBe(200);
    expect(await deliver(paid)).toBe(200);
    await deliver({ ...olderPastDue, id: `evt_test_${uniqueSuffix()}` });
    await paidAndHealthy(orgId);
    expect((await orgRow(orgId)).subscription_status).toBe('active');
  });

  it('the clear touches only the first-charge restriction: an ordinary grace episode is not ended by an active update', async () => {
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'pro', status: 'active', subscriptionId });
    await deliver(fakeEvent('invoice.payment_failed', invoiceOf(customerId, subscriptionId)));
    const deadline = (await orgRow(orgId)).grace_period_ends_at;
    await deliver(fakeEvent('customer.subscription.updated', subscriptionObject(subscriptionId, customerId, 'active', 'STRIPE_PRICE_PRO_MONTHLY')));
    const row = await orgRow(orgId);
    expect(row.billing_lifecycle_state).toBe('grace_period');
    expect(row.grace_period_ends_at.toISOString()).toBe(deadline.toISOString());
  });
});

// ─── Hand-provisioned organizations ──────────────────────────────────────────

describe('hand-provisioned organizations are unaffected', () => {
  it.each([
    ['enterprise', 'active'],
    ['enterprise', 'free'],
    ['pro', 'free'],
  ])('stored %s with status %s and no subscription: their plan, managed, no trial, no upgrade, no Stripe call', async (tier, status) => {
    const { orgId } = await insertOrg({ tier, status });
    const read = jest.spyOn(stripeService, 'getSubscription');
    const { status: code, body } = await summary(orgId);
    expect(code).toBe(200);
    expect(body.data).toMatchObject({
      tier,
      status: null,
      plan: { storedTier: tier, effectiveTier: tier, entitlementHold: null, source: 'managed', isTopPlan: tier === 'enterprise' },
      subscription: null,
      trial: { used: false, active: false, endsAt: null, eligible: false },
      actions: { selfServe: 'none', showUpgrade: false, manageSubscription: false },
    });
    expect(read).not.toHaveBeenCalled();
    expect(await entitlement(orgId)).toEqual({ storedTier: tier, effectiveTier: tier, hold: null });
  });
});

// ─── The billing summary ─────────────────────────────────────────────────────

describe('the billing summary', () => {
  it('free, never subscribed: free plan, checkout, upgrade shown, trial eligible (switch on) and usage against the real limit', async () => {
    const { orgId } = await insertOrg();
    const { body } = await summary(orgId);
    expect(body.data).toEqual({
      tier: 'free',
      status: null,
      currentPeriodEnd: null,
      cancelAtPeriodEnd: false,
      cancelAt: null,
      billingLifecycleState: 'healthy',
      paymentFailedAt: null,
      graceEndsAt: null,
      isRestricted: false,
      plan: { storedTier: 'free', effectiveTier: 'free', entitlementHold: null, source: 'none', isTopPlan: false },
      subscription: null,
      trial: { used: false, active: false, endsAt: null, eligible: true },
      usage: { awsResources: { used: 0, limit: 20 } },
      actions: { selfServe: 'checkout', showUpgrade: true, manageSubscription: false },
    });
  });

  it('trialing: trial end, price and interval from the subscription data received; Stripe is not called to render it', async () => {
    const { orgId } = await trialingOrg('pro', 'ANNUAL');
    const read = jest.spyOn(stripeService, 'getSubscription');
    const { body } = await summary(orgId);
    await summary(orgId);
    expect(read).not.toHaveBeenCalled();
    expect(body.data.trial).toEqual({ used: true, active: true, endsAt: TRIAL_END, eligible: false });
    expect(body.data.subscription).toEqual({
      status: 'trialing', currentPeriodEnd: TRIAL_END, cancelAtPeriodEnd: false, cancelAt: null,
      price: { amount: 19900, currency: 'usd', interval: 'year' },
    });
    expect(body.data.plan).toEqual({ storedTier: 'pro', effectiveTier: 'pro', entitlementHold: null, source: 'subscription', isTopPlan: false });
    expect(body.data.actions).toEqual({ selfServe: 'change_plan', showUpgrade: true, manageSubscription: true });
    expect(body.data.usage.awsResources).toEqual({ used: 0, limit: 500 });
  });

  it('a cache miss reads the subscription once, then serves it from the cache', async () => {
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'starter', status: 'active', subscriptionId });
    const read = jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(
      subscriptionObject(subscriptionId, customerId, 'active', 'STRIPE_PRICE_STARTER_MONTHLY', { amount: 4900 }) as any);
    await summary(orgId);
    const { body } = await summary(orgId);
    expect(read).toHaveBeenCalledTimes(1);
    expect(body.data.subscription.price).toEqual({ amount: 4900, currency: 'usd', interval: 'month' });
    expect(body.data.trial).toEqual({ used: false, active: false, endsAt: null, eligible: false });
  });

  it('Stripe unreadable: the stored status, no dates or price (never a made-up "active")', async () => {
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const { orgId } = await insertOrg({ tier: 'pro', status: 'past_due', subscriptionId });
    jest.spyOn(stripeService, 'getSubscription').mockRejectedValue(Object.assign(new Error('down'), { name: 'StripeConnectionError' }));
    const { body } = await summary(orgId);
    expect(body.data.status).toBe('past_due');
    expect(body.data.subscription).toEqual({ status: 'past_due', currentPeriodEnd: null, cancelAtPeriodEnd: false, cancelAt: null, price: null });
  });

  it.each([
    ['payment', { status: 'unpaid' }],
    ['subscription_inactive', { status: 'paused' }],
  ])('a %s hold is reported as decided by entitlementOf', async (hold, { status }) => {
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'pro', status, subscriptionId });
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(subscriptionObject(subscriptionId, customerId, status, 'STRIPE_PRICE_PRO_MONTHLY') as any);
    const { body } = await summary(orgId);
    expect(body.data.plan).toMatchObject({ storedTier: 'pro', effectiveTier: 'free', entitlementHold: hold });
    expect(body.data.usage.awsResources.limit).toBe(20);
  });

  it('Revenue Protection with a subscription: top plan, no upgrade, no self-serve change, but it can be managed', async () => {
    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const { orgId, customerId } = await insertOrg({ tier: 'enterprise', status: 'active', subscriptionId });
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(subscriptionObject(subscriptionId, customerId, 'active', 'STRIPE_PRICE_ENTERPRISE_MONTHLY') as any);
    const { body } = await summary(orgId);
    expect(body.data.plan).toMatchObject({ source: 'subscription', isTopPlan: true });
    expect(body.data.actions).toEqual({ selfServe: 'none', showUpgrade: false, manageSubscription: true });
    expect(body.data.usage.awsResources.limit).toBeNull();
  });

  it('usage that cannot be read is null (shown as unavailable), never a made-up number', async () => {
    const { orgId } = await insertOrg();
    jest.spyOn(middleware, 'getResourceUsage').mockRejectedValue(new Error('relation missing'));
    expect((await summary(orgId)).body.data.usage).toEqual({ awsResources: null });
  });

  it('never carries a Stripe subscription or customer id; members read the same summary', async () => {
    const { orgId, customerId, subscriptionId } = await trialingOrg('starter');
    for (const role of ['owner', 'member', 'viewer']) {
      const text = JSON.stringify((await summary(orgId, role)).body);
      expect(text).not.toContain(subscriptionId);
      expect(text).not.toContain(customerId);
      expect(text).not.toContain('price_test_');
    }
  });

  it('organization isolation: one organization\'s summary never reflects another\'s trial', async () => {
    const { orgId: trialing } = await trialingOrg('pro');
    const { orgId: other } = await insertOrg();
    expect((await summary(other)).body.data.trial).toEqual({ used: false, active: false, endsAt: null, eligible: true });
    expect((await summary(trialing)).body.data.trial.used).toBe(true);
  });
});
