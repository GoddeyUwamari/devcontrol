/**
 * P0 Payment Failure Lifecycle.
 *
 * Audit finding this closes: invoice.payment_failed and invoice.paid were
 * pure console.log stubs (backend/src/controllers/stripe.controller.ts),
 * subscription_status was exposed by the API/UI but never enforced by
 * subscription.middleware.ts, and a past_due organization retained paid
 * access indefinitely. This suite proves the full lifecycle: failure ->
 * grace period -> (recovery | restriction), driven exclusively by Stripe
 * webhook events and enforced through the real Express middleware
 * (requireTier/requirePro), not just by inspecting internal functions.
 *
 * Same pattern as stripe-webhook-entitlement-sync.test.ts /
 * stripe-refunds.test.ts: real Postgres, jest.spyOn on the
 * Stripe-network-touching stripeService methods and on emailService so
 * neither Stripe nor Resend is ever actually called.
 */

import { Request, Response, NextFunction } from 'express';
import { Pool } from 'pg';
import { stripeController } from '../stripe.controller';
import stripeService from '../../services/stripe.service';
import { emailService } from '../../services/email.service';
import { requireTier, requirePro, requireStarter } from '../../middleware/subscription.middleware';

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

async function insertOrg(overrides: {
  tier?: string;
  customerId?: string;
  billingLifecycleState?: string;
  paymentFailedAt?: Date | null;
  gracePeriodEndsAt?: Date | null;
  latestProcessedInvoiceCreatedAt?: Date | null;
} = {}): Promise<{ orgId: string; customerId: string }> {
  const suffix = uniqueSuffix();
  const tier = overrides.tier ?? 'pro';
  const customerId = overrides.customerId ?? `cus_test_${suffix}`;

  const { rows } = await pool.query(
    `INSERT INTO organizations (
       name, slug, display_name, subscription_tier, subscription_status,
       stripe_customer_id, stripe_subscription_id,
       billing_lifecycle_state, payment_failed_at, grace_period_ends_at,
       latest_processed_invoice_created_at
     ) VALUES ($1, $2, $3, $4, 'active', $5, $6, $7, $8, $9, $10)
     RETURNING id`,
    [
      `Payment Failure Org ${suffix}`,
      `payment-failure-org-${suffix}`,
      `Payment Failure Org ${suffix}`,
      tier,
      customerId,
      `sub_test_${suffix}`,
      overrides.billingLifecycleState ?? 'healthy',
      overrides.paymentFailedAt ?? null,
      overrides.gracePeriodEndsAt ?? null,
      overrides.latestProcessedInvoiceCreatedAt ?? null,
    ]
  );
  createdOrgIds.push(rows[0].id);
  return { orgId: rows[0].id as string, customerId };
}

async function insertOwner(orgId: string): Promise<string> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, full_name, is_email_verified)
     VALUES ($1, 'x', 'Test Owner', true) RETURNING id`,
    [`owner-${suffix}@example.com`]
  );
  const userId = rows[0].id as string;
  createdUserIds.push(userId);
  await pool.query(
    `INSERT INTO organization_memberships (organization_id, user_id, role) VALUES ($1, $2, 'owner')`,
    [orgId, userId]
  );
  return userId;
}

async function fetchBillingRow(orgId: string) {
  const { rows } = await pool.query(
    `SELECT billing_lifecycle_state, payment_failed_at, grace_period_ends_at,
            latest_processed_invoice_created_at,
            subscription_tier, subscription_status, xmin::text AS xmin
     FROM organizations WHERE id = $1`,
    [orgId]
  );
  return rows[0];
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

function stubSignatureVerification(event: any) {
  return jest.spyOn(stripeService, 'verifyWebhookSignature').mockReturnValue(event as any);
}

/** Stubs signature verification and delivers the event through the real handleWebhook dispatch. */
async function deliverWebhook(event: any) {
  stubSignatureVerification(event);
  const { req, res, status, json } = mockWebhookReqRes(event);
  await stripeController.handleWebhook(req, res);
  return { status, json };
}

/**
 * `created` defaults to "now" -- Invoice.created (Unix seconds) is the
 * shared ordering key recordPaymentFailure/recordPaymentRecovery compare
 * against latest_processed_invoice_created_at (see stripe.service.ts).
 * Tests that care about ordering pass an explicit `created` override.
 */
function fakeInvoice(customerId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `in_test_${uniqueSuffix()}`,
    customer: customerId,
    created: Math.floor(Date.now() / 1000),
    ...overrides,
  };
}

function daysAgo(days: number): Date {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000);
}

function unixSeconds(date: Date): number {
  return Math.floor(date.getTime() / 1000);
}

/** Direct middleware invocation -- exercises the real authorization boundary, not just an internal helper. */
function mockMiddlewareReqRes(organizationId: string | undefined, extra: { body?: any; query?: any } = {}) {
  const req = {
    user: organizationId ? { organizationId, role: 'owner' } : undefined,
    organizationId,
    body: extra.body ?? {},
    query: extra.query ?? {},
  } as unknown as Request;
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;
  const next = jest.fn() as unknown as NextFunction;
  return { req, res, next, json, status };
}

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdUserIds.length > 0) {
    await pool.query('DELETE FROM users WHERE id = ANY($1)', [createdUserIds]);
  }
  await pool.end();
});

describe('invoice.payment_failed -- failure', () => {
  it('maps to the correct organization via Stripe customer id', async () => {
    const { orgId, customerId } = await insertOrg();
    const emailSpy = jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue();
    const event = fakeEvent('invoice.payment_failed', fakeInvoice(customerId));
    stubSignatureVerification(event);
    const { req, res, status } = mockWebhookReqRes(event);

    await stripeController.handleWebhook(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    const row = await fetchBillingRow(orgId);
    expect(row.billing_lifecycle_state).toBe('grace_period');
    expect(emailSpy).toHaveBeenCalledWith(orgId, expect.any(Date));
  });

  it('resolves the real organization owner and sends via EmailService (only the Resend call itself is mocked)', async () => {
    const { orgId, customerId } = await insertOrg();
    const ownerUserId = await insertOwner(orgId);
    const { rows } = await pool.query('SELECT email FROM users WHERE id = $1', [ownerUserId]);
    const ownerEmail = rows[0].email as string;

    const sendSpy = jest.spyOn(emailService, 'sendPaymentFailedEmail').mockResolvedValue(true);
    const event = fakeEvent('invoice.payment_failed', fakeInvoice(customerId));
    await deliverWebhook(event);

    expect(sendSpy).toHaveBeenCalledWith(expect.objectContaining({
      to: ownerEmail,
      graceEndsAt: expect.any(Date),
    }));
  });

  it('first failure establishes payment_failed_at and a grace deadline ~7 days out', async () => {
    const { orgId, customerId } = await insertOrg();
    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue();
    const before = Date.now();
    const event = fakeEvent('invoice.payment_failed', fakeInvoice(customerId));
    stubSignatureVerification(event);
    const { req, res } = mockWebhookReqRes(event);

    await stripeController.handleWebhook(req, res);

    const row = await fetchBillingRow(orgId);
    expect(row.payment_failed_at).not.toBeNull();
    const graceMs = new Date(row.grace_period_ends_at).getTime();
    const expectedMs = before + 7 * 24 * 60 * 60 * 1000;
    expect(Math.abs(graceMs - expectedMs)).toBeLessThan(60_000); // within 1 minute
  });

  it('repeated failure does not extend the grace deadline, and preserves the paid tier', async () => {
    const { orgId, customerId } = await insertOrg({ tier: 'pro' });
    const emailSpy = jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue();

    const first = fakeEvent('invoice.payment_failed', fakeInvoice(customerId));
    await deliverWebhook(first);

    const afterFirst = await fetchBillingRow(orgId);
    expect(afterFirst.billing_lifecycle_state).toBe('grace_period');
    expect(afterFirst.subscription_tier).toBe('pro');

    // A distinct invoice (Stripe's own retry), same customer, same episode.
    const second = fakeEvent('invoice.payment_failed', fakeInvoice(customerId));
    await deliverWebhook(second);

    const afterSecond = await fetchBillingRow(orgId);
    expect(afterSecond.grace_period_ends_at).toEqual(afterFirst.grace_period_ends_at);
    expect(afterSecond.payment_failed_at).toEqual(afterFirst.payment_failed_at);
    expect(afterSecond.subscription_tier).toBe('pro');
    // Exactly one notification for the whole episode, not one per failed invoice.
    expect(emailSpy).toHaveBeenCalledTimes(1);
  });

  it('an unknown Stripe customer does not mutate any organization', async () => {
    const { orgId } = await insertOrg();
    const before = await fetchBillingRow(orgId);
    const emailSpy = jest.spyOn(stripeService, 'sendPaymentFailedEmail');

    const event = fakeEvent('invoice.payment_failed', fakeInvoice('cus_does_not_exist_anywhere'));
    stubSignatureVerification(event);
    const { req, res, status } = mockWebhookReqRes(event);

    await stripeController.handleWebhook(req, res);

    expect(status).not.toHaveBeenCalledWith(400); // webhook still acknowledges receipt
    expect(await fetchBillingRow(orgId)).toEqual(before);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('an exact duplicate webhook delivery is idempotent (same invoice id redelivered)', async () => {
    const { orgId, customerId } = await insertOrg();
    const emailSpy = jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue();
    const invoice = fakeInvoice(customerId);
    const event = fakeEvent('invoice.payment_failed', invoice);

    await deliverWebhook(event);
    const afterFirst = await fetchBillingRow(orgId);

    await deliverWebhook(event);
    const afterSecond = await fetchBillingRow(orgId);

    expect(afterSecond).toEqual(afterFirst);
    expect(emailSpy).toHaveBeenCalledTimes(1);
  });
});

describe('invoice.paid -- recovery', () => {
  it('clears the failure/grace state and preserves the paid tier', async () => {
    const graceEndsAt = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
    const { orgId, customerId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'grace_period',
      paymentFailedAt: new Date(Date.now() - 2 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: graceEndsAt,
    });

    const event = fakeEvent('invoice.paid', fakeInvoice(customerId));
    stubSignatureVerification(event);
    const { req, res, status } = mockWebhookReqRes(event);

    await stripeController.handleWebhook(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    const row = await fetchBillingRow(orgId);
    expect(row.billing_lifecycle_state).toBe('healthy');
    expect(row.payment_failed_at).toBeNull();
    expect(row.grace_period_ends_at).toBeNull();
    expect(row.subscription_tier).toBe('pro');
  });

  it('restores access after a previous failure (verified through the real requireTier middleware)', async () => {
    const { orgId, customerId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'restricted',
      paymentFailedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000),
    });

    // Sanity: currently restricted -> requirePro blocks.
    const before = mockMiddlewareReqRes(orgId);
    await requirePro(before.req, before.res, before.next);
    expect(before.next).not.toHaveBeenCalled();
    expect(before.status).toHaveBeenCalledWith(402);

    const event = fakeEvent('invoice.paid', fakeInvoice(customerId));
    await deliverWebhook(event);

    const after = mockMiddlewareReqRes(orgId);
    await requirePro(after.req, after.res, after.next);
    expect(after.next).toHaveBeenCalled();
    expect(after.status).not.toHaveBeenCalledWith(402);
  });

  it('leaves lifecycle fields untouched on an already-healthy organization, only advancing the ordering high-water mark', async () => {
    // Note: this organization's row IS touched now (unlike before the P1
    // fix) -- every accepted invoice.paid advances
    // latest_processed_invoice_created_at, even on a healthy org, since
    // that's what lets a later STALE invoice.payment_failed for an even
    // older invoice be correctly rejected (see the "critical stale
    // failure case" tests below). What must NOT change is the actual
    // lifecycle state itself.
    const { orgId, customerId } = await insertOrg({ tier: 'starter' });
    const before = await fetchBillingRow(orgId);
    expect(before.latest_processed_invoice_created_at).toBeNull();

    const event = fakeEvent('invoice.paid', fakeInvoice(customerId));
    await deliverWebhook(event);

    const after = await fetchBillingRow(orgId);
    expect(after.billing_lifecycle_state).toBe('healthy');
    expect(after.payment_failed_at).toBeNull();
    expect(after.grace_period_ends_at).toBeNull();
    expect(after.latest_processed_invoice_created_at).not.toBeNull();
  });

  it('duplicate invoice.paid delivery after recovery is safe', async () => {
    const { orgId, customerId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'grace_period',
      paymentFailedAt: new Date(),
      gracePeriodEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });

    const event = fakeEvent('invoice.paid', fakeInvoice(customerId));
    await deliverWebhook(event);
    const afterFirst = await fetchBillingRow(orgId);
    expect(afterFirst.billing_lifecycle_state).toBe('healthy');

    await deliverWebhook(event);
    const afterSecond = await fetchBillingRow(orgId);
    expect(afterSecond.xmin).toBe(afterFirst.xmin); // second delivery touched nothing
  });
});

describe('out-of-order webhook delivery -- P1 fix (Stripe does not guarantee event order)', () => {
  it('critical stale recovery case: current failure, then a delayed invoice.paid for an OLDER invoice, does not restore access', async () => {
    const { orgId, customerId } = await insertOrg({ tier: 'pro' });

    // The current, real failure -- a newer invoice than the stale one below.
    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue();
    const currentFailure = fakeInvoice(customerId, { created: unixSeconds(daysAgo(1)) });
    await deliverWebhook(fakeEvent('invoice.payment_failed', currentFailure));

    const afterFailure = await fetchBillingRow(orgId);
    expect(afterFailure.billing_lifecycle_state).toBe('grace_period');
    const deadlineAfterFailure = afterFailure.grace_period_ends_at;

    // A delayed invoice.paid for an OLDER, already-superseded invoice
    // (e.g. last billing period's receipt, redelivered late).
    const staleOldInvoice = fakeInvoice(customerId, { created: unixSeconds(daysAgo(30)) });
    await deliverWebhook(fakeEvent('invoice.paid', staleOldInvoice));

    const after = await fetchBillingRow(orgId);
    expect(after.billing_lifecycle_state).toBe('grace_period'); // NOT restored
    expect(after.payment_failed_at).not.toBeNull();
    expect(after.grace_period_ends_at).toEqual(deadlineAfterFailure); // deadline untouched
  });

  it('critical stale failure case: current recovery, then a delayed invoice.payment_failed for an OLDER invoice, does not reopen grace', async () => {
    const { orgId, customerId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'grace_period',
      paymentFailedAt: daysAgo(3),
      gracePeriodEndsAt: new Date(Date.now() + 4 * 24 * 60 * 60 * 1000),
      latestProcessedInvoiceCreatedAt: daysAgo(3),
    });

    // The current, real recovery -- newer than the stale failure below.
    const currentPaid = fakeInvoice(customerId, { created: unixSeconds(daysAgo(1)) });
    await deliverWebhook(fakeEvent('invoice.paid', currentPaid));

    const afterRecovery = await fetchBillingRow(orgId);
    expect(afterRecovery.billing_lifecycle_state).toBe('healthy');

    // A delayed invoice.payment_failed for an OLDER invoice than the one
    // that just recovered the org (e.g. a redelivered retry notification
    // for the episode that already resolved).
    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue();
    const staleOldFailure = fakeInvoice(customerId, { created: unixSeconds(daysAgo(5)) });
    await deliverWebhook(fakeEvent('invoice.payment_failed', staleOldFailure));

    const after = await fetchBillingRow(orgId);
    expect(after.billing_lifecycle_state).toBe('healthy'); // NOT reopened
    expect(after.payment_failed_at).toBeNull();
    expect(after.grace_period_ends_at).toBeNull();
  });

  it('multiple invoices, ordering A: invoice A fails, invoice B (newer) succeeds, A\'s failure event arrives late -- final state reflects B (healthy)', async () => {
    const { orgId, customerId } = await insertOrg({ tier: 'pro' });
    const invoiceA = fakeInvoice(customerId, { created: unixSeconds(daysAgo(10)) });
    const invoiceB = fakeInvoice(customerId, { created: unixSeconds(daysAgo(1)) });

    // B (newer) succeeds, delivered first.
    await deliverWebhook(fakeEvent('invoice.paid', invoiceB));
    expect((await fetchBillingRow(orgId)).billing_lifecycle_state).toBe('healthy');

    // A's failure (older than B) arrives late.
    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue();
    await deliverWebhook(fakeEvent('invoice.payment_failed', invoiceA));

    const after = await fetchBillingRow(orgId);
    expect(after.billing_lifecycle_state).toBe('healthy'); // reflects B, the newer state
    expect(after.payment_failed_at).toBeNull();
  });

  it('multiple invoices, ordering B: invoice A succeeds, invoice B (newer) fails, A\'s success event arrives late -- final state reflects B (grace_period)', async () => {
    const { orgId, customerId } = await insertOrg({ tier: 'pro' });
    const invoiceA = fakeInvoice(customerId, { created: unixSeconds(daysAgo(10)) });
    const invoiceB = fakeInvoice(customerId, { created: unixSeconds(daysAgo(1)) });

    // B (newer) fails, delivered first.
    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue();
    await deliverWebhook(fakeEvent('invoice.payment_failed', invoiceB));
    const afterB = await fetchBillingRow(orgId);
    expect(afterB.billing_lifecycle_state).toBe('grace_period');

    // A's success (older than B) arrives late.
    await deliverWebhook(fakeEvent('invoice.paid', invoiceA));

    const after = await fetchBillingRow(orgId);
    expect(after.billing_lifecycle_state).toBe('grace_period'); // still reflects B, not incorrectly cleared by A
    expect(after.grace_period_ends_at).toEqual(afterB.grace_period_ends_at);
  });

  it('cross-organization isolation: an out-of-order event for organization A never touches organization B', async () => {
    const orgA = await insertOrg({ tier: 'pro' });
    const orgB = await insertOrg({ tier: 'enterprise', billingLifecycleState: 'grace_period', paymentFailedAt: daysAgo(2), gracePeriodEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000) });
    const beforeB = await fetchBillingRow(orgB.orgId);

    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue();
    // A stale/current event for org A's customer, regardless of ordering,
    // must never be attributable to org B -- stripe_customer_id is UNIQUE,
    // so this is also a direct proof of that constraint doing its job.
    await deliverWebhook(fakeEvent('invoice.payment_failed', fakeInvoice(orgA.customerId, { created: unixSeconds(daysAgo(20)) })));
    await deliverWebhook(fakeEvent('invoice.paid', fakeInvoice(orgA.customerId, { created: unixSeconds(daysAgo(1)) })));

    const afterB = await fetchBillingRow(orgB.orgId);
    expect(afterB).toEqual(beforeB);
  });
});

describe('grace period enforcement -- exercised through the real Express middleware', () => {
  it('a paid organization inside an active grace period retains full access', async () => {
    const { orgId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'grace_period',
      paymentFailedAt: new Date(),
      gracePeriodEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000), // future
    });

    const { req, res, next, status } = mockMiddlewareReqRes(orgId);
    await requirePro(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(status).not.toHaveBeenCalledWith(402);
  });

  it('an organization whose grace period has expired loses paid entitlement (lazy check, no job run required)', async () => {
    const { orgId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'grace_period', // deliberately NOT yet flipped to 'restricted'
      paymentFailedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: new Date(Date.now() - 1000), // just passed
    });

    const { req, res, next } = mockMiddlewareReqRes(orgId);
    await requirePro(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
    expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ code: 'TIER_REQUIRED' }));
  });

  it('an explicitly restricted organization is blocked identically', async () => {
    const { orgId } = await insertOrg({
      tier: 'enterprise',
      billingLifecycleState: 'restricted',
      paymentFailedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
    });

    const { req, res, next } = mockMiddlewareReqRes(orgId);
    await requireTier('enterprise')(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
  });

  it('a lower-tier requirement (starter) is also blocked while restricted -- restriction means free, not "one tier down"', async () => {
    const { orgId } = await insertOrg({
      tier: 'enterprise',
      billingLifecycleState: 'restricted',
    });

    const { req, res, next } = mockMiddlewareReqRes(orgId);
    await requireStarter(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
  });

  it('a client-supplied billing_lifecycle_state/subscription_status in the body or query cannot bypass restriction', async () => {
    const { orgId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'restricted',
    });

    const { req, res, next } = mockMiddlewareReqRes(orgId, {
      body: { billing_lifecycle_state: 'healthy', subscription_status: 'active' },
      query: { billing_lifecycle_state: 'healthy' },
    });
    await requirePro(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
  });

  it('a client-supplied future grace_period_ends_at cannot bypass an already-expired real deadline', async () => {
    const { orgId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'grace_period',
      paymentFailedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: new Date(Date.now() - 1000),
    });

    const spoofedFutureDate = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const { req, res, next } = mockMiddlewareReqRes(orgId, {
      body: { grace_period_ends_at: spoofedFutureDate },
    });
    await requirePro(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(402);
  });

  it('a restricted organization can still reach billing endpoints (getSubscription, createCustomerPortal) -- never locked out of fixing payment', async () => {
    const { orgId, customerId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'restricted',
      paymentFailedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
    });

    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue({
      id: 'sub_test', status: 'past_due', cancel_at_period_end: false, cancel_at: null,
    } as any);
    const getSubReq = { user: { organizationId: orgId, role: 'owner' } } as unknown as Request;
    const getSubJson = jest.fn();
    const getSubRes = { json: getSubJson, status: jest.fn().mockReturnValue({ json: getSubJson }) } as unknown as Response;
    await stripeController.getSubscription(getSubReq, getSubRes);
    expect(getSubJson).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ billingLifecycleState: 'restricted', isRestricted: true, tier: 'pro' }),
    }));

    const portalSpy = jest.spyOn(stripeService, 'createPortalSession').mockResolvedValue({ url: 'https://billing.stripe.com/test' } as any);
    const portalReq = { user: { organizationId: orgId, role: 'owner' }, body: {} } as unknown as Request;
    const portalJson = jest.fn();
    const portalStatus = jest.fn().mockReturnValue({ json: portalJson });
    const portalRes = { json: portalJson, status: portalStatus } as unknown as Response;
    await stripeController.createCustomerPortal(portalReq, portalRes);
    expect(portalStatus).not.toHaveBeenCalledWith(402);
    expect(portalStatus).not.toHaveBeenCalledWith(403);
    expect(portalSpy).toHaveBeenCalled();
    void customerId;
  });
});

describe('status transitions -- billing lifecycle is driven only by invoice.* events', () => {
  it('customer.subscription.updated alone (status -> past_due, same price) does not start a grace period', async () => {
    const { orgId, customerId } = await insertOrg({ tier: 'pro' });
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: `sub_test_${uniqueSuffix()}`,
      customer: customerId,
      status: 'past_due',
      items: { data: [{ price: { id: 'irrelevant' } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');

    const event = fakeEvent('customer.subscription.updated', subscription);
    await deliverWebhook(event);

    const row = await fetchBillingRow(orgId);
    expect(row.billing_lifecycle_state).toBe('healthy');
    expect(row.subscription_status).toBe('past_due');
  });

  it('customer.subscription.updated alone (status -> active) does not clear an existing grace period -- only invoice.paid recovers', async () => {
    const { orgId, customerId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'grace_period',
      paymentFailedAt: new Date(),
      gracePeriodEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: `sub_test_${uniqueSuffix()}`,
      customer: customerId,
      status: 'active',
      items: { data: [{ price: { id: 'irrelevant' } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');

    const event = fakeEvent('customer.subscription.updated', subscription);
    await deliverWebhook(event);

    const row = await fetchBillingRow(orgId);
    expect(row.billing_lifecycle_state).toBe('grace_period'); // unchanged -- not accidentally restored
  });

  it('customer.subscription.updated -> unpaid does not change billing_lifecycle_state on a restricted org', async () => {
    const { orgId, customerId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'restricted',
      paymentFailedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: `sub_test_${uniqueSuffix()}`,
      customer: customerId,
      status: 'unpaid',
      items: { data: [{ price: { id: 'irrelevant' } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');

    const event = fakeEvent('customer.subscription.updated', subscription);
    await deliverWebhook(event);

    const row = await fetchBillingRow(orgId);
    expect(row.billing_lifecycle_state).toBe('restricted');
    expect(row.subscription_status).toBe('unpaid');
  });

  it('cancellation/deletion after a payment failure resets billing lifecycle to healthy alongside the existing free-tier downgrade', async () => {
    const { orgId, customerId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'restricted',
      paymentFailedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
    });

    const subscription = { id: `sub_test_${uniqueSuffix()}`, customer: customerId, status: 'canceled' };
    const event = fakeEvent('customer.subscription.deleted', subscription);
    await deliverWebhook(event);

    const row = await fetchBillingRow(orgId);
    expect(row.subscription_tier).toBe('free');
    expect(row.subscription_status).toBe('canceled');
    expect(row.billing_lifecycle_state).toBe('healthy');
    expect(row.payment_failed_at).toBeNull();
    expect(row.grace_period_ends_at).toBeNull();
  });
});

describe('grace-period-enforcement.job.ts -- reconciliation backstop', () => {
  it('flips an expired grace_period organization to restricted, and leaves a still-in-grace one alone', async () => {
    const { GracePeriodEnforcementJob } = await import('../../jobs/grace-period-enforcement.job');
    const job = new GracePeriodEnforcementJob(pool as any);

    const expired = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'grace_period',
      paymentFailedAt: new Date(Date.now() - 10 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: new Date(Date.now() - 1000),
    });
    const stillInGrace = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'grace_period',
      paymentFailedAt: new Date(),
      gracePeriodEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });

    await job.enforceExpiredGracePeriods();

    expect((await fetchBillingRow(expired.orgId)).billing_lifecycle_state).toBe('restricted');
    expect((await fetchBillingRow(stillInGrace.orgId)).billing_lifecycle_state).toBe('grace_period');
  });
});

describe('regression: existing entitlement-sync behavior on a healthy org is unaffected', () => {
  it('a normal tier-changing customer.subscription.updated on a healthy org does not touch billing_lifecycle_state', async () => {
    const { orgId, customerId } = await insertOrg({ tier: 'free' });
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: `sub_test_${uniqueSuffix()}`,
      customer: customerId,
      status: 'active',
      items: { data: [{ price: { id: 'irrelevant' } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('starter');

    const event = fakeEvent('customer.subscription.updated', subscription);
    await deliverWebhook(event);

    const row = await fetchBillingRow(orgId);
    expect(row.subscription_tier).toBe('starter');
    expect(row.billing_lifecycle_state).toBe('healthy');
  });
});
