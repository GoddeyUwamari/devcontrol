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
import { requireTier, requirePro, requireStarter, getOrganizationEntitlement } from '../../middleware/subscription.middleware';

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
} = {}): Promise<{ orgId: string; customerId: string; subscriptionId: string }> {
  const suffix = uniqueSuffix();
  const tier = overrides.tier ?? 'pro';
  const customerId = overrides.customerId ?? `cus_test_${suffix}`;
  // The organization's recorded subscription: subscription events below are
  // for this subscription (an event for another one is never applied).
  const subscriptionId = `sub_test_${suffix}`;

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
      subscriptionId,
      overrides.billingLifecycleState ?? 'healthy',
      overrides.paymentFailedAt ?? null,
      overrides.gracePeriodEndsAt ?? null,
      overrides.latestProcessedInvoiceCreatedAt ?? null,
    ]
  );
  createdOrgIds.push(rows[0].id);
  return { orgId: rows[0].id as string, customerId, subscriptionId };
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
            latest_processed_invoice_created_at, payment_failed_notification_sent_at,
            subscription_tier, subscription_status, xmin::text AS xmin
     FROM organizations WHERE id = $1`,
    [orgId]
  );
  return rows[0];
}

// Monotonically increasing default for fabricated events' Stripe Event
// envelope `created` (Unix seconds) -- see stripe-cancel-consistency.test.ts's
// identical helper for why this must not default to a fixed/colliding value
// now that subscription/checkout events feed the ordering high-water mark.
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
    const emailSpy = jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);
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
    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);
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
    const emailSpy = jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);

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
    const emailSpy = jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);
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

/**
 * Payment-failure notification reliability -- organizations.
 * payment_failed_notification_sent_at (database/migrations-admin/
 * 202609010800_add_payment_failed_notification_tracking.sql).
 *
 * Closes the gap the earlier "exactly one notification per episode" tests
 * above could not catch: those tests only ever exercised a first attempt
 * that succeeds. Before this fix, `wasNewFailure` (true only once, at the
 * exact instant billing_lifecycle_state flips healthy -> grace_period) was
 * the ONLY gate on sending the email -- so if that one attempt failed for
 * any reason (a crash, a transient error, Resend being down), the
 * notification was lost forever: no later delivery for the same episode
 * could ever re-trigger it, because that flag can only be true once. These
 * tests prove notificationPending (payment_failed_notification_sent_at IS
 * NULL while still in grace_period) recovers from exactly that failure
 * mode, without ever double-sending once a send is actually confirmed.
 */
describe('payment-failure notification reliability -- delivery tracking independent of the grace-period transition', () => {
  it('A. failed first send: DB still transitions to grace_period, but the marker stays NULL and notification remains pending', async () => {
    const { orgId, customerId } = await insertOrg();
    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValueOnce(false); // simulated Resend outage / crash-equivalent

    const event = fakeEvent('invoice.payment_failed', fakeInvoice(customerId));
    await deliverWebhook(event);

    const row = await fetchBillingRow(orgId);
    expect(row.billing_lifecycle_state).toBe('grace_period'); // entitlement-affecting state transition succeeded regardless
    expect(row.payment_failed_at).not.toBeNull();
    expect(row.grace_period_ends_at).not.toBeNull();
    expect(row.payment_failed_notification_sent_at).toBeNull(); // notification NOT confirmed -- remains pending
  });

  it('B. retry after failed first send: a genuinely separate subsequent invoice.payment_failed re-attempts and this time succeeds', async () => {
    const { orgId, customerId } = await insertOrg();
    const emailSpy = jest
      .spyOn(stripeService, 'sendPaymentFailedEmail')
      .mockResolvedValueOnce(false) // first attempt fails
      .mockResolvedValueOnce(true); // second attempt (the "retry") succeeds

    const firstInvoice = fakeInvoice(customerId);
    const firstEvent = fakeEvent('invoice.payment_failed', firstInvoice);
    await deliverWebhook(firstEvent);

    const afterFirst = await fetchBillingRow(orgId);
    expect(afterFirst.billing_lifecycle_state).toBe('grace_period');
    expect(afterFirst.payment_failed_notification_sent_at).toBeNull();
    expect(emailSpy).toHaveBeenCalledTimes(1);

    // A genuinely separate, distinct invoice.payment_failed delivery for
    // the SAME still-unresolved episode -- Stripe's own next dunning-retry
    // event, or a redelivered webhook after a crash; either way, a
    // different event id and a different (later) invoice.created, not the
    // literal same event.
    const secondInvoice = fakeInvoice(customerId, { created: firstInvoice.created + 3600 });
    const secondEvent = fakeEvent('invoice.payment_failed', secondInvoice);
    await deliverWebhook(secondEvent);

    expect(emailSpy).toHaveBeenCalledTimes(2); // the notification WAS attempted again
    const afterSecond = await fetchBillingRow(orgId);
    expect(afterSecond.payment_failed_notification_sent_at).not.toBeNull(); // and this time it's confirmed
    // The deadline/failure timestamp from the ORIGINAL episode start must
    // not have moved -- only the notification-tracking column changed.
    expect(afterSecond.payment_failed_at).toEqual(afterFirst.payment_failed_at);
    expect(afterSecond.grace_period_ends_at).toEqual(afterFirst.grace_period_ends_at);
  });

  it('C. successful first send: marker is populated, and a distinct subsequent delivery for the same episode does not send another notification', async () => {
    const { orgId, customerId } = await insertOrg();
    const emailSpy = jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);

    const firstInvoice = fakeInvoice(customerId);
    await deliverWebhook(fakeEvent('invoice.payment_failed', firstInvoice));

    const afterFirst = await fetchBillingRow(orgId);
    expect(afterFirst.payment_failed_notification_sent_at).not.toBeNull();
    expect(emailSpy).toHaveBeenCalledTimes(1);

    // A distinct event (different id, same still-open episode) -- e.g.
    // Stripe's own dunning retry generating another invoice.payment_failed
    // before the grace period ends. Must NOT resend.
    const secondInvoice = fakeInvoice(customerId, { created: firstInvoice.created + 3600 });
    await deliverWebhook(fakeEvent('invoice.payment_failed', secondInvoice));

    expect(emailSpy).toHaveBeenCalledTimes(1); // still just once
    const afterSecond = await fetchBillingRow(orgId);
    expect(afterSecond.payment_failed_notification_sent_at).toEqual(afterFirst.payment_failed_notification_sent_at); // unchanged, not re-stamped
  });

  it('D. recovery and new episode: the marker is cleared on recovery, and a later, distinct failure is eligible for its own notification', async () => {
    const { orgId, customerId } = await insertOrg();
    const emailSpy = jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);

    const firstInvoice = fakeInvoice(customerId);
    await deliverWebhook(fakeEvent('invoice.payment_failed', firstInvoice));
    const afterFailure = await fetchBillingRow(orgId);
    expect(afterFailure.billing_lifecycle_state).toBe('grace_period');
    expect(afterFailure.payment_failed_notification_sent_at).not.toBeNull();
    expect(emailSpy).toHaveBeenCalledTimes(1);

    // Recovery: invoice.paid for a later invoice.
    const paidInvoice = fakeInvoice(customerId, { created: firstInvoice.created + 3600 });
    await deliverWebhook(fakeEvent('invoice.paid', paidInvoice));
    const afterRecovery = await fetchBillingRow(orgId);
    expect(afterRecovery.billing_lifecycle_state).toBe('healthy');
    expect(afterRecovery.payment_failed_notification_sent_at).toBeNull(); // cleared on recovery

    // A later, genuinely NEW failure episode -- must be independently
    // eligible for its own notification, not permanently blocked by the
    // first episode's already-confirmed send.
    const secondFailureInvoice = fakeInvoice(customerId, { created: firstInvoice.created + 7200 });
    await deliverWebhook(fakeEvent('invoice.payment_failed', secondFailureInvoice));

    const afterSecondFailure = await fetchBillingRow(orgId);
    expect(afterSecondFailure.billing_lifecycle_state).toBe('grace_period');
    expect(afterSecondFailure.payment_failed_notification_sent_at).not.toBeNull();
    expect(emailSpy).toHaveBeenCalledTimes(2); // notified once per distinct episode
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
    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);
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
    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);
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
    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);
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
    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);
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

    jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);
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
    const { orgId, customerId, subscriptionId } = await insertOrg({ tier: 'pro' });
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: subscriptionId,
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
    const { orgId, customerId, subscriptionId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'grace_period',
      paymentFailedAt: new Date(),
      gracePeriodEndsAt: new Date(Date.now() + 5 * 24 * 60 * 60 * 1000),
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: subscriptionId,
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
    const { orgId, customerId, subscriptionId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'restricted',
      paymentFailedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
    });
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: subscriptionId,
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
    const { orgId, customerId, subscriptionId } = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'restricted',
      paymentFailedAt: new Date(Date.now() - 20 * 24 * 60 * 60 * 1000),
      gracePeriodEndsAt: new Date(Date.now() - 13 * 24 * 60 * 60 * 1000),
    });

    const subscription = { id: subscriptionId, customer: customerId, status: 'canceled' };
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
    const { orgId, customerId, subscriptionId } = await insertOrg({ tier: 'free' });
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: subscriptionId,
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

/**
 * F-1: a late failure of an invoice that has since been paid never reopens a
 * grace period.
 *
 * Stripe retries a failed invoice on the SAME invoice: every attempt's event
 * carries the same invoice id and the same Invoice.created, under a new event
 * id. So these tests reuse one invoice object across events (the suites above
 * mostly make a new invoice per attempt, which hides this case). A paid
 * invoice is final, so a failure of it delivered after its invoice.paid is a
 * late earlier attempt: no grace, no email, paid access kept.
 */
describe('F-1: a late failure of an invoice already paid never reopens grace', () => {
  const entitlement = (orgId: string) => getOrganizationEntitlement(orgId, pool);

  /** One renewal invoice, as every attempt on it carries it. */
  function renewalInvoice(customerId: string, subscriptionId: string, created = unixSeconds(daysAgo(1))) {
    return {
      id: `in_test_${uniqueSuffix()}`,
      customer: customerId,
      created,
      parent: { subscription_details: { subscription: subscriptionId } },
    };
  }

  function subscriptionEvent(subscriptionId: string, customerId: string, status: string, createdAt: number) {
    const nowSec = Math.floor(Date.now() / 1000);
    return fakeEvent('customer.subscription.updated', {
      id: subscriptionId,
      customer: customerId,
      status,
      items: { data: [{ price: { id: 'irrelevant' } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    }, createdAt);
  }

  async function expectPaidAndHealthy(orgId: string, tier = 'pro') {
    const row = await fetchBillingRow(orgId);
    expect(row.billing_lifecycle_state).toBe('healthy');
    expect(row.payment_failed_at).toBeNull();
    expect(row.grace_period_ends_at).toBeNull();
    expect(await entitlement(orgId)).toEqual({ storedTier: tier, effectiveTier: tier, hold: null });
  }

  let emailSpy: jest.SpyInstance;
  beforeEach(() => {
    emailSpy = jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);
    jest.spyOn(stripeService, 'getTierFromPriceId').mockReturnValue('pro');
  });

  it('attempt 2 paid, then attempt 1\'s failure arrives late: stays healthy and paid, no email, nothing for the grace job to restrict', async () => {
    const { orgId, customerId, subscriptionId } = await insertOrg({ tier: 'pro' });
    const invoice = renewalInvoice(customerId, subscriptionId);
    const attempt1Failed = fakeEvent('invoice.payment_failed', invoice);

    await deliverWebhook(fakeEvent('invoice.paid', invoice));
    await deliverWebhook(attempt1Failed);

    await expectPaidAndHealthy(orgId);
    expect(emailSpy).not.toHaveBeenCalled();

    const { GracePeriodEnforcementJob } = await import('../../jobs/grace-period-enforcement.job');
    await new GracePeriodEnforcementJob(pool as any).enforceExpiredGracePeriods();
    expect((await fetchBillingRow(orgId)).billing_lifecycle_state).toBe('healthy');

    const { req, res, next } = mockMiddlewareReqRes(orgId);
    await requirePro(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  // Real time: E1 (attempt 1 fails) < Sp (past_due) <= E2 (attempt 2 paid) <= Sa (active).
  // Delivery: every one of the 24 orders.
  const EVENTS = ['E1', 'Sp', 'E2', 'Sa'] as const;
  type EventName = typeof EVENTS[number];
  function permutations<T>(items: readonly T[]): T[][] {
    if (items.length <= 1) return [items.slice()];
    return items.flatMap((item, i) =>
      permutations([...items.slice(0, i), ...items.slice(i + 1)]).map(rest => [item, ...rest]));
  }
  const ORDERS = permutations(EVENTS);

  it('there are 24 delivery orders', () => {
    expect(ORDERS).toHaveLength(24);
    expect(new Set(ORDERS.map(o => o.join(','))).size).toBe(24);
  });

  it.each(ORDERS.map(order => [order.join(' -> '), order] as const))(
    'delivery order %s ends healthy, active and paid; the grace email only when the failure is processed before the payment',
    async (_label, order) => {
      const { orgId, customerId, subscriptionId } = await insertOrg({ tier: 'pro' });
      const invoice = renewalInvoice(customerId, subscriptionId);
      const base = Math.floor(Date.now() / 1000) + 10;
      const events: Record<EventName, any> = {
        E1: fakeEvent('invoice.payment_failed', invoice, base),
        Sp: subscriptionEvent(subscriptionId, customerId, 'past_due', base + 1),
        E2: fakeEvent('invoice.paid', invoice, base + 2),
        Sa: subscriptionEvent(subscriptionId, customerId, 'active', base + 3),
      };
      for (const name of order) {
        await deliverWebhook(events[name]);
      }

      await expectPaidAndHealthy(orgId);
      expect((await fetchBillingRow(orgId)).subscription_status).toBe('active');
      // Known residual (F-1b, f1-step1.md §1.2): a failure processed BEFORE
      // the payment opens the grace and sends the email; the payment then ends
      // it. A failure processed after the payment never does.
      const failureFirst = order.indexOf('E1') < order.indexOf('E2');
      expect(emailSpy).toHaveBeenCalledTimes(failureFirst ? 1 : 0);
    }
  );

  it('ledger re-run: the failure\'s first delivery fails, the payment is processed, then Stripe redelivers the same failure event: refused', async () => {
    const { orgId, customerId, subscriptionId } = await insertOrg({ tier: 'pro' });
    const invoice = renewalInvoice(customerId, subscriptionId);
    const attempt1Failed = fakeEvent('invoice.payment_failed', invoice);

    jest.spyOn(stripeService, 'getOrganizationByCustomerId').mockRejectedValueOnce(new Error('transient database error'));
    const first = await deliverWebhook(attempt1Failed);
    expect(first.status).toHaveBeenCalledWith(400);
    const failedRow = await pool.query('SELECT status FROM stripe_webhook_events WHERE stripe_event_id = $1', [attempt1Failed.id]);
    expect(failedRow.rows[0].status).toBe('failed');

    await deliverWebhook(fakeEvent('invoice.paid', invoice));
    const redelivered = await deliverWebhook(attempt1Failed);
    expect(redelivered.status).not.toHaveBeenCalled();
    expect(redelivered.json).toHaveBeenCalledWith({ success: true, received: true });

    const ledger = await pool.query('SELECT status, attempts FROM stripe_webhook_events WHERE stripe_event_id = $1', [attempt1Failed.id]);
    expect(ledger.rows[0]).toEqual({ status: 'processed', attempts: 2 });
    await expectPaidAndHealthy(orgId);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('duplicates: the refused failure redelivered (same event id) is a ledger duplicate; another attempt\'s event (new id) is refused too', async () => {
    const { orgId, customerId, subscriptionId } = await insertOrg({ tier: 'pro' });
    const invoice = renewalInvoice(customerId, subscriptionId);
    await deliverWebhook(fakeEvent('invoice.paid', invoice));
    const attempt1Failed = fakeEvent('invoice.payment_failed', invoice);
    await deliverWebhook(attempt1Failed);
    const before = await fetchBillingRow(orgId);

    const duplicate = await deliverWebhook(attempt1Failed);
    expect(duplicate.json).toHaveBeenCalledWith({ success: true, received: true, duplicate: true });
    expect((await fetchBillingRow(orgId)).xmin).toBe(before.xmin);

    await deliverWebhook(fakeEvent('invoice.payment_failed', invoice));
    expect((await fetchBillingRow(orgId)).xmin).toBe(before.xmin);
    await expectPaidAndHealthy(orgId);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('same-invoice recovery is unchanged: the invoice fails (grace, email), then the same invoice is paid: healthy; a late earlier attempt then changes nothing', async () => {
    const { orgId, customerId, subscriptionId } = await insertOrg({ tier: 'pro' });
    const invoice = renewalInvoice(customerId, subscriptionId);
    const lateAttempt = fakeEvent('invoice.payment_failed', invoice);

    await deliverWebhook(fakeEvent('invoice.payment_failed', invoice));
    expect((await fetchBillingRow(orgId)).billing_lifecycle_state).toBe('grace_period');
    expect(emailSpy).toHaveBeenCalledTimes(1);

    await deliverWebhook(fakeEvent('invoice.paid', invoice));
    await expectPaidAndHealthy(orgId);

    await deliverWebhook(lateAttempt);
    await expectPaidAndHealthy(orgId);
    expect(emailSpy).toHaveBeenCalledTimes(1);
  });

  it('in-grace attempts of the same invoice are unchanged: the deadline never moves, an unsent email is retried once, then never again', async () => {
    const { orgId, customerId, subscriptionId } = await insertOrg({ tier: 'pro' });
    await insertOwner(orgId);
    emailSpy.mockResolvedValueOnce(false).mockResolvedValue(true);
    const invoice = renewalInvoice(customerId, subscriptionId);

    await deliverWebhook(fakeEvent('invoice.payment_failed', invoice));
    const afterFirst = await fetchBillingRow(orgId);
    expect(afterFirst.billing_lifecycle_state).toBe('grace_period');
    expect(afterFirst.payment_failed_notification_sent_at).toBeNull();

    await deliverWebhook(fakeEvent('invoice.payment_failed', invoice)); // attempt 2, same invoice
    const afterSecond = await fetchBillingRow(orgId);
    expect(afterSecond.grace_period_ends_at).toEqual(afterFirst.grace_period_ends_at);
    expect(afterSecond.payment_failed_notification_sent_at).not.toBeNull();

    await deliverWebhook(fakeEvent('invoice.payment_failed', invoice)); // attempt 3
    expect((await fetchBillingRow(orgId)).grace_period_ends_at).toEqual(afterFirst.grace_period_ends_at);
    expect(emailSpy).toHaveBeenCalledTimes(2);
  });

  it('a new episode is unchanged: last month\'s invoice paid, this month\'s invoice fails: 7-day grace and one email', async () => {
    const { orgId, customerId, subscriptionId } = await insertOrg({ tier: 'pro' });
    await deliverWebhook(fakeEvent('invoice.paid', renewalInvoice(customerId, subscriptionId, unixSeconds(daysAgo(31)))));
    await deliverWebhook(fakeEvent('invoice.payment_failed', renewalInvoice(customerId, subscriptionId, unixSeconds(daysAgo(1)))));

    const row = await fetchBillingRow(orgId);
    expect(row.billing_lifecycle_state).toBe('grace_period');
    const graceDays = (new Date(row.grace_period_ends_at).getTime() - Date.now()) / 86400000;
    expect(graceDays).toBeGreaterThan(6.9);
    expect(graceDays).toBeLessThanOrEqual(7);
    expect(emailSpy).toHaveBeenCalledTimes(1);
  });

  it('subscription deleted during the grace, then a late attempt of the same invoice: no new grace, no second email', async () => {
    const { orgId, customerId, subscriptionId } = await insertOrg({ tier: 'pro' });
    const invoice = renewalInvoice(customerId, subscriptionId);
    await deliverWebhook(fakeEvent('invoice.payment_failed', invoice));
    expect(emailSpy).toHaveBeenCalledTimes(1);

    await deliverWebhook(fakeEvent('customer.subscription.deleted', { id: subscriptionId, customer: customerId, status: 'canceled' }));
    expect((await fetchBillingRow(orgId)).billing_lifecycle_state).toBe('healthy');

    await deliverWebhook(fakeEvent('invoice.payment_failed', invoice));
    const row = await fetchBillingRow(orgId);
    expect(row.billing_lifecycle_state).toBe('healthy');
    expect(row.grace_period_ends_at).toBeNull();
    expect(row.subscription_tier).toBe('free');
    expect(emailSpy).toHaveBeenCalledTimes(1);
  });

  it('known residual: a DIFFERENT invoice created in the same second as one already paid is refused while healthy (f1-step1.md §4 residual ii)', async () => {
    const { orgId, customerId, subscriptionId } = await insertOrg({ tier: 'pro' });
    const created = unixSeconds(daysAgo(1));
    await deliverWebhook(fakeEvent('invoice.paid', renewalInvoice(customerId, subscriptionId, created)));
    await deliverWebhook(fakeEvent('invoice.payment_failed', renewalInvoice(customerId, subscriptionId, created)));
    await expectPaidAndHealthy(orgId);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('a hand-provisioned organization billed by one-off invoices (no subscription): paid, then a late failure of that invoice: plan kept, no grace', async () => {
    const { orgId, customerId } = await insertOrg({ tier: 'pro' });
    await pool.query(
      `UPDATE organizations SET stripe_subscription_id = NULL, subscription_status = 'free' WHERE id = $1`,
      [orgId]
    );
    const oneOff = { id: `in_test_${uniqueSuffix()}`, customer: customerId, created: unixSeconds(daysAgo(1)) };
    await deliverWebhook(fakeEvent('invoice.paid', oneOff));
    await deliverWebhook(fakeEvent('invoice.payment_failed', oneOff));
    await expectPaidAndHealthy(orgId);
    expect(emailSpy).not.toHaveBeenCalled();
  });

  it('cross-organization: the refused late failure for organization A never touches organization B', async () => {
    const orgA = await insertOrg({ tier: 'pro' });
    const orgB = await insertOrg({
      tier: 'pro',
      billingLifecycleState: 'grace_period',
      paymentFailedAt: daysAgo(1),
      gracePeriodEndsAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
      latestProcessedInvoiceCreatedAt: daysAgo(1),
    });
    const beforeB = await fetchBillingRow(orgB.orgId);

    const invoiceA = renewalInvoice(orgA.customerId, orgA.subscriptionId, unixSeconds(daysAgo(1)));
    await deliverWebhook(fakeEvent('invoice.paid', invoiceA));
    await deliverWebhook(fakeEvent('invoice.payment_failed', invoiceA));

    await expectPaidAndHealthy(orgA.orgId);
    expect(await fetchBillingRow(orgB.orgId)).toEqual(beforeB);
  });

  describe('StripeService.recordPaymentFailure on an invoice as old as the mark', () => {
    it('while healthy: stale, nothing written', async () => {
      const created = daysAgo(1);
      const { orgId } = await insertOrg({ tier: 'pro', latestProcessedInvoiceCreatedAt: created });
      const before = await fetchBillingRow(orgId);

      const result = await stripeService.recordPaymentFailure(orgId, created);

      expect(result).toMatchObject({ wasNewFailure: false, wasStale: true, notificationPending: false });
      expect(result.row.billingLifecycleState).toBe('healthy');
      expect((await fetchBillingRow(orgId)).xmin).toBe(before.xmin);
    });

    it('while in a grace period: not stale (the next attempt of the open episode), the notification still pending', async () => {
      const created = daysAgo(1);
      const { orgId } = await insertOrg({
        tier: 'pro',
        billingLifecycleState: 'grace_period',
        paymentFailedAt: created,
        gracePeriodEndsAt: new Date(Date.now() + 6 * 24 * 60 * 60 * 1000),
        latestProcessedInvoiceCreatedAt: created,
      });

      const result = await stripeService.recordPaymentFailure(orgId, created);

      expect(result).toMatchObject({ wasNewFailure: false, wasStale: false, notificationPending: true });
    });
  });

  it('the invoice handlers never log a Stripe invoice or customer id', async () => {
    const lines: string[] = [];
    for (const level of ['log', 'warn', 'error'] as const) {
      jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
        lines.push(args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' '));
      });
    }
    emailSpy.mockResolvedValueOnce(false);
    const { orgId, customerId, subscriptionId } = await insertOrg({ tier: 'pro' });
    await insertOwner(orgId);
    const invoice = renewalInvoice(customerId, subscriptionId);
    const older = renewalInvoice(customerId, subscriptionId, unixSeconds(daysAgo(40)));
    const otherSubscription = renewalInvoice(customerId, `sub_test_other_${uniqueSuffix()}`);
    const unknownCustomer = renewalInvoice(`cus_test_unknown_${uniqueSuffix()}`, subscriptionId);
    const noCustomer = { id: `in_test_${uniqueSuffix()}`, created: invoice.created };
    const noCreated = { id: `in_test_${uniqueSuffix()}`, customer: customerId };

    for (const type of ['invoice.paid', 'invoice.payment_failed']) {
      await deliverWebhook(fakeEvent(type, noCustomer));
      await deliverWebhook(fakeEvent(type, noCreated));
      await deliverWebhook(fakeEvent(type, unknownCustomer));
      await deliverWebhook(fakeEvent(type, otherSubscription));
    }
    await deliverWebhook(fakeEvent('invoice.payment_failed', invoice)); // grace, email not confirmed
    await deliverWebhook(fakeEvent('invoice.payment_failed', invoice)); // retried, sent
    await deliverWebhook(fakeEvent('invoice.payment_failed', invoice)); // already notified
    await deliverWebhook(fakeEvent('invoice.paid', older)); // stale
    await deliverWebhook(fakeEvent('invoice.payment_failed', older)); // stale
    await deliverWebhook(fakeEvent('invoice.paid', invoice)); // recovered
    await deliverWebhook(fakeEvent('invoice.payment_failed', invoice)); // late attempt, refused

    const output = lines.join('\n');
    expect(output).toContain(`organization ${orgId}`);
    for (const id of [invoice.id, older.id, otherSubscription.id, unknownCustomer.id, noCustomer.id, noCreated.id,
      customerId, unknownCustomer.customer]) {
      expect(output).not.toContain(id);
    }
  });
});
