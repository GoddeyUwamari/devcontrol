/**
 * Refunds/payment-history phase: real backend refund issuance (Stripe
 * Refund API), authorization, and webhook idempotency.
 *
 * Audit finding this phase closes: app/(app)/refunds/page.tsx,
 * app/(app)/payments/[id]/page.tsx, components/refunds/*,
 * components/payments/issue-refund-dialog.tsx, and
 * lib/services/payments.service.ts's refundsService/paymentsService were
 * fully built on the frontend but called /api/refunds, /api/payments, and
 * /api/payment-methods -- none of which existed anywhere in
 * backend/src/routes. "Issue Refund" was a dead button with no backend
 * behind it at all.
 *
 * Same pattern as stripe-billing-authorization.test.ts /
 * stripe-webhook-entitlement-sync.test.ts: real Postgres for actual
 * row/RLS-adjacent semantics and idempotency, jest.spyOn on the
 * Stripe-network-touching stripeService methods so the real Stripe SDK is
 * never exercised and no network call is made, and a spy call proves an
 * allowed request actually reached business logic while its absence proves
 * a rejected one didn't.
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
const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrgWithCustomer(): Promise<{ orgId: string; customerId: string }> {
  const suffix = uniqueSuffix();
  const customerId = `cus_test_${suffix}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, stripe_customer_id, subscription_status)
     VALUES ($1, $2, $3, 'starter', $4, 'active')
     RETURNING id`,
    [`Refunds Org ${suffix}`, `refunds-org-${suffix}`, `Refunds Org ${suffix}`, customerId]
  );
  createdOrgIds.push(rows[0].id);
  return { orgId: rows[0].id as string, customerId };
}

async function fetchRefundRows(orgId: string) {
  const { rows } = await pool.query(
    'SELECT * FROM refunds WHERE organization_id = $1 ORDER BY created_at ASC',
    [orgId]
  );
  return rows;
}

function mockReqRes(
  body: any,
  organizationId: string | undefined,
  role: string | undefined,
  extra: { query?: any; headers?: any; params?: any } = {}
) {
  const req = {
    user: organizationId === undefined ? undefined : { organizationId, email: `user-${uniqueSuffix()}@example.com`, role },
    body,
    query: extra.query ?? {},
    headers: extra.headers ?? {},
    params: extra.params ?? {},
  } as unknown as Request;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;

  return { req, res, json, status };
}

/** Fake invoice paid against `customerId`, resolvable to a fake PaymentIntent/Charge. */
function fakeInvoice(customerId: string, overrides: Record<string, unknown> = {}) {
  return {
    id: `in_test_${uniqueSuffix()}`,
    customer: customerId,
    status: 'paid',
    amount_paid: 5000,
    amount_due: 5000,
    currency: 'usd',
    created: Math.floor(Date.now() / 1000),
    number: `INV-${uniqueSuffix()}`,
    ...overrides,
  };
}

function stubResolvedInvoice(invoice: any, paymentIntentId: string, charge: any) {
  jest.spyOn(stripeService, 'getInvoice').mockResolvedValue(invoice as any);
  jest.spyOn(stripeService, 'listInvoicePayments').mockResolvedValue([
    {
      status: 'paid',
      is_default: true,
      payment: { type: 'payment_intent', payment_intent: paymentIntentId },
    } as any,
  ]);
  jest.spyOn(stripeService, 'getPaymentIntentWithCharge').mockResolvedValue({
    id: paymentIntentId,
    latest_charge: charge,
  } as any);
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

const ALLOWED_ROLES = ['owner', 'admin'];
const REJECTED_ROLES = ['member', 'viewer'];

describe('POST /api/refunds (issueRefund) authorization', () => {
  it.each(ALLOWED_ROLES)('%s role can issue a full refund and it reaches Stripe + is persisted', async (role) => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const paymentIntentId = `pi_test_${uniqueSuffix()}`;
    const chargeId = `ch_test_${uniqueSuffix()}`;
    const invoice = fakeInvoice(customerId);
    const charge = { id: chargeId, amount: 5000, amount_refunded: 0, currency: 'usd', customer: customerId };
    stubResolvedInvoice(invoice, paymentIntentId, charge);

    const refundId = `re_test_${uniqueSuffix()}`;
    const createSpy = jest.spyOn(stripeService, 'createRefund').mockResolvedValue({
      id: refundId,
      amount: 5000,
      currency: 'usd',
      status: 'succeeded',
      reason: null,
      payment_intent: paymentIntentId,
      charge: chargeId,
      metadata: { organizationId: orgId, invoiceId: invoice.id },
    } as any);

    const { req, res, status, json } = mockReqRes({ paymentId: invoice.id, reason: 'requested_by_customer' }, orgId, role);

    await stripeController.issueRefund(req, res);

    expect(status).not.toHaveBeenCalledWith(403);
    expect(status).not.toHaveBeenCalledWith(400);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        payment_intent: paymentIntentId,
        amount: 5000,
        reason: 'requested_by_customer',
      }),
      expect.objectContaining({ idempotencyKey: expect.any(String) })
    );
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: expect.objectContaining({ id: refundId }) }));

    const rows = await fetchRefundRows(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].stripe_refund_id).toBe(refundId);
    expect(rows[0].amount).toBe(5000);
    expect(rows[0].status).toBe('succeeded');
    expect(rows[0].stripe_payment_intent_id).toBe(paymentIntentId);
  });

  it.each(ALLOWED_ROLES)('%s role can issue a partial refund with the exact requested amount', async (role) => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const paymentIntentId = `pi_test_${uniqueSuffix()}`;
    const chargeId = `ch_test_${uniqueSuffix()}`;
    const invoice = fakeInvoice(customerId, { amount_paid: 5000 });
    const charge = { id: chargeId, amount: 5000, amount_refunded: 0, currency: 'usd', customer: customerId };
    stubResolvedInvoice(invoice, paymentIntentId, charge);

    const refundId = `re_test_${uniqueSuffix()}`;
    const createSpy = jest.spyOn(stripeService, 'createRefund').mockResolvedValue({
      id: refundId,
      amount: 2000,
      currency: 'usd',
      status: 'succeeded',
      reason: null,
      payment_intent: paymentIntentId,
      charge: chargeId,
      metadata: {},
    } as any);

    const { req, res, status } = mockReqRes({ paymentId: invoice.id, amount: 2000 }, orgId, role);

    await stripeController.issueRefund(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(createSpy).toHaveBeenCalledWith(
      expect.objectContaining({ payment_intent: paymentIntentId, amount: 2000 }),
      expect.objectContaining({ idempotencyKey: expect.any(String) })
    );

    const rows = await fetchRefundRows(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(2000);
  });

  it.each(REJECTED_ROLES)('%s role is rejected 403 and Stripe is never called', async (role) => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const invoice = fakeInvoice(customerId);
    const getInvoiceSpy = jest.spyOn(stripeService, 'getInvoice');
    const createSpy = jest.spyOn(stripeService, 'createRefund');

    const { req, res, status, json } = mockReqRes({ paymentId: invoice.id }, orgId, role);

    await stripeController.issueRefund(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(getInvoiceSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
    expect(await fetchRefundRows(orgId)).toHaveLength(0);
  });

  it('unauthenticated request gets 401, not 403, and Stripe is never called', async () => {
    const createSpy = jest.spyOn(stripeService, 'createRefund');
    const { req, res, status, json } = mockReqRes({ paymentId: 'in_whatever' }, undefined, undefined);

    await stripeController.issueRefund(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Authentication required' }));
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('a client-supplied "role" in the body, query, or headers cannot override the real (rejected) role', async () => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const invoice = fakeInvoice(customerId);
    const createSpy = jest.spyOn(stripeService, 'createRefund');

    const { req, res, status } = mockReqRes(
      { paymentId: invoice.id, role: 'owner' },
      orgId,
      'member',
      { query: { role: 'owner' }, headers: { 'x-role': 'owner', 'x-user-role': 'admin' } }
    );

    await stripeController.issueRefund(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('POST /api/refunds -- server-side validation cannot be bypassed by the client', () => {
  it('rejects an unsupported field outright (e.g. a client-supplied chargeId/paymentIntentId)', async () => {
    const { orgId } = await insertOrgWithCustomer();
    const getInvoiceSpy = jest.spyOn(stripeService, 'getInvoice');
    const createSpy = jest.spyOn(stripeService, 'createRefund');

    const { req, res, status, json } = mockReqRes(
      { paymentId: 'in_test', chargeId: 'ch_evil_smuggled', paymentIntentId: 'pi_evil_smuggled' },
      orgId,
      'owner'
    );

    await stripeController.issueRefund(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('Unsupported field'),
    }));
    expect(getInvoiceSpy).not.toHaveBeenCalled();
    expect(createSpy).not.toHaveBeenCalled();
  });

  it.each([0, -500, 12.5])('rejects an invalid refund amount (%p)', async (badAmount) => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const invoice = fakeInvoice(customerId);
    jest.spyOn(stripeService, 'getInvoice').mockResolvedValue(invoice as any);
    const createSpy = jest.spyOn(stripeService, 'createRefund');

    const { req, res, status, json } = mockReqRes({ paymentId: invoice.id, amount: badAmount }, orgId, 'owner');

    await stripeController.issueRefund(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects an amount greater than the actual refundable balance, without ever calling Stripe refunds.create', async () => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const paymentIntentId = `pi_test_${uniqueSuffix()}`;
    const invoice = fakeInvoice(customerId, { amount_paid: 5000 });
    // Already partially refunded: only 1000 of the original 5000 remains refundable.
    const charge = { id: `ch_test_${uniqueSuffix()}`, amount: 5000, amount_refunded: 4000, currency: 'usd', customer: customerId };
    stubResolvedInvoice(invoice, paymentIntentId, charge);
    const createSpy = jest.spyOn(stripeService, 'createRefund');

    const { req, res, status, json } = mockReqRes({ paymentId: invoice.id, amount: 2000 }, orgId, 'owner');

    await stripeController.issueRefund(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      error: expect.stringContaining('exceeds the refundable balance'),
    }));
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects a nonexistent payment id (Stripe 404) without calling refunds.create', async () => {
    const { orgId } = await insertOrgWithCustomer();
    jest.spyOn(stripeService, 'getInvoice').mockRejectedValue(new Error('No such invoice'));
    const createSpy = jest.spyOn(stripeService, 'createRefund');

    const { req, res, status, json } = mockReqRes({ paymentId: 'in_does_not_exist' }, orgId, 'owner');

    await stripeController.issueRefund(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Payment not found' }));
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('a client-supplied paymentId belonging to a DIFFERENT organization\'s Stripe customer is rejected as not found, and Stripe refunds.create is never called', async () => {
    const { orgId } = await insertOrgWithCustomer();
    // Invoice genuinely exists in Stripe, but belongs to some other customer
    // -- not this organization's stripe_customer_id.
    const invoice = fakeInvoice('cus_someone_else_entirely');
    jest.spyOn(stripeService, 'getInvoice').mockResolvedValue(invoice as any);
    const createSpy = jest.spyOn(stripeService, 'createRefund');

    const { req, res, status, json } = mockReqRes({ paymentId: invoice.id }, orgId, 'owner');

    await stripeController.issueRefund(req, res);

    expect(status).toHaveBeenCalledWith(404);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Payment not found' }));
    expect(createSpy).not.toHaveBeenCalled();
  });

  it('rejects refunding an invoice that is not paid', async () => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const invoice = fakeInvoice(customerId, { status: 'open' });
    jest.spyOn(stripeService, 'getInvoice').mockResolvedValue(invoice as any);
    const createSpy = jest.spyOn(stripeService, 'createRefund');

    const { req, res, status } = mockReqRes({ paymentId: invoice.id }, orgId, 'owner');

    await stripeController.issueRefund(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(createSpy).not.toHaveBeenCalled();
  });
});

describe('refund webhook idempotency and status sync', () => {
  // See stripe-cancel-consistency.test.ts's identical fakeEvent helper:
  // event.created now feeds the subscription-ordering high-water mark for
  // any customer.subscription.* event, so it must not default to a
  // colliding/fixed value.
  let nextEventCreatedAtSeconds = Math.floor(Date.now() / 1000);

  function fakeRefundEvent(type: string, object: any, createdAt?: number) {
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
    const handlers: Record<string, Array<() => void>> = {};
    const on = jest.fn((eventName: string, cb: () => void) => {
      (handlers[eventName] ??= []).push(cb);
    });
    const res = { json, status, on } as unknown as Response;
    const finish = () => { (handlers['finish'] || []).forEach(cb => cb()); };

    return { req, res, json, status, finish };
  }

  function stubSignatureVerification(event: any) {
    return jest.spyOn(stripeService, 'verifyWebhookSignature').mockReturnValue(event as any);
  }

  it('a duplicate charge.refunded delivery (same refund id twice) does not create a duplicate row', async () => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const paymentIntentId = `pi_test_${uniqueSuffix()}`;
    const chargeId = `ch_test_${uniqueSuffix()}`;
    const refundId = `re_test_${uniqueSuffix()}`;

    const refund = {
      id: refundId,
      amount: 5000,
      currency: 'usd',
      status: 'succeeded',
      reason: null,
      payment_intent: paymentIntentId,
      charge: chargeId,
      metadata: { organizationId: orgId, invoiceId: `in_test_${uniqueSuffix()}` },
    };
    const charge = { id: chargeId, customer: customerId, refunds: { data: [refund] } };

    const event = fakeRefundEvent('charge.refunded', charge);
    stubSignatureVerification(event);
    const first = mockWebhookReqRes(event);
    await stripeController.handleWebhook(first.req, first.res);
    first.finish();

    expect(first.status).not.toHaveBeenCalledWith(400);
    let rows = await fetchRefundRows(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].stripe_refund_id).toBe(refundId);

    // Redelivery of the exact same event (Stripe's at-least-once guarantee).
    const second = mockWebhookReqRes(event);
    stubSignatureVerification(event);
    await stripeController.handleWebhook(second.req, second.res);
    second.finish();

    expect(second.status).not.toHaveBeenCalledWith(400);
    rows = await fetchRefundRows(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].stripe_refund_id).toBe(refundId);
  });

  it('a refund.updated webhook advances an existing refund\'s status (pending -> succeeded) without creating a duplicate row', async () => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const paymentIntentId = `pi_test_${uniqueSuffix()}`;
    const chargeId = `ch_test_${uniqueSuffix()}`;
    const refundId = `re_test_${uniqueSuffix()}`;

    const pendingRefund = {
      id: refundId,
      amount: 5000,
      currency: 'usd',
      status: 'pending',
      reason: null,
      payment_intent: paymentIntentId,
      charge: chargeId,
      metadata: { organizationId: orgId },
    };
    const chargeEvent = { id: chargeId, customer: customerId, refunds: { data: [pendingRefund] } };

    const createdEvent = fakeRefundEvent('charge.refunded', chargeEvent);
    stubSignatureVerification(createdEvent);
    const first = mockWebhookReqRes(createdEvent);
    await stripeController.handleWebhook(first.req, first.res);
    first.finish();

    let rows = await fetchRefundRows(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe('pending');

    const succeededRefund = { ...pendingRefund, status: 'succeeded' };
    const updatedEvent = fakeRefundEvent('refund.updated', succeededRefund);
    stubSignatureVerification(updatedEvent);
    const second = mockWebhookReqRes(updatedEvent);
    await stripeController.handleWebhook(second.req, second.res);
    second.finish();

    expect(second.status).not.toHaveBeenCalledWith(400);
    rows = await fetchRefundRows(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].stripe_refund_id).toBe(refundId);
    expect(rows[0].status).toBe('succeeded');
  });

  it('existing subscription webhook handling is unaffected by the new refund event cases', async () => {
    // customer.subscription.deleted must still dispatch cleanly (no
    // "Unhandled event type" fallthrough, no error) alongside the new
    // charge.refunded/refund.updated cases added to the same switch.
    const customerId = `cus_test_${uniqueSuffix()}`;
    const { orgId } = await insertOrgWithCustomer();
    await pool.query('UPDATE organizations SET stripe_customer_id = $1, subscription_tier = $2 WHERE id = $3', [customerId, 'pro', orgId]);

    const subscription = { id: `sub_test_${uniqueSuffix()}`, customer: customerId, status: 'canceled' };
    const event = fakeRefundEvent('customer.subscription.deleted', subscription);
    stubSignatureVerification(event);
    const { req, res, json, status } = mockWebhookReqRes(event);

    await stripeController.handleWebhook(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });

    const { rows } = await pool.query('SELECT subscription_tier FROM organizations WHERE id = $1', [orgId]);
    expect(rows[0].subscription_tier).toBe('free');
  });
});

describe('outbound Stripe Idempotency-Key on refund creation', () => {
  function stubCreateRefund(refundId: string, paymentIntentId: string, chargeId: string) {
    return jest.spyOn(stripeService, 'createRefund').mockResolvedValue({
      id: refundId,
      amount: 2000,
      currency: 'usd',
      status: 'succeeded',
      reason: null,
      payment_intent: paymentIntentId,
      charge: chargeId,
      metadata: {},
    } as any);
  }

  function capturedIdempotencyKey(createSpy: jest.SpyInstance, callIndex = 0): string {
    const call = createSpy.mock.calls[callIndex];
    expect(call?.[1]).toEqual(expect.objectContaining({ idempotencyKey: expect.any(String) }));
    return (call![1] as { idempotencyKey: string }).idempotencyKey;
  }

  it('supplies an idempotency key on the outbound Stripe refund creation call', async () => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const paymentIntentId = `pi_test_${uniqueSuffix()}`;
    const chargeId = `ch_test_${uniqueSuffix()}`;
    const invoice = fakeInvoice(customerId, { amount_paid: 5000 });
    const charge = { id: chargeId, amount: 5000, amount_refunded: 0, currency: 'usd', customer: customerId };
    stubResolvedInvoice(invoice, paymentIntentId, charge);
    const createSpy = stubCreateRefund(`re_test_${uniqueSuffix()}`, paymentIntentId, chargeId);

    const { req, res } = mockReqRes({ paymentId: invoice.id, amount: 2000, reason: 'requested_by_customer' }, orgId, 'owner');
    await stripeController.issueRefund(req, res);

    const key = capturedIdempotencyKey(createSpy);
    expect(typeof key).toBe('string');
    expect(key.length).toBeGreaterThan(0);
  });

  it('a retry of the exact same logical refund request produces the same idempotency key', async () => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const paymentIntentId = `pi_test_${uniqueSuffix()}`;
    const chargeId = `ch_test_${uniqueSuffix()}`;
    const invoice = fakeInvoice(customerId, { amount_paid: 5000 });
    // amount_refunded stays 0 across both attempts: this models the
    // ambiguous-failure case (Stripe never actually processed the first
    // attempt, or the app never learned that it did), which is exactly the
    // scenario an outbound idempotency key needs to protect.
    const charge = { id: chargeId, amount: 5000, amount_refunded: 0, currency: 'usd', customer: customerId };
    stubResolvedInvoice(invoice, paymentIntentId, charge);
    const createSpy = stubCreateRefund(`re_test_${uniqueSuffix()}`, paymentIntentId, chargeId);

    const body = { paymentId: invoice.id, amount: 2000, reason: 'requested_by_customer' };

    const first = mockReqRes(body, orgId, 'owner');
    await stripeController.issueRefund(first.req, first.res);
    const firstKey = capturedIdempotencyKey(createSpy, 0);

    const second = mockReqRes(body, orgId, 'owner');
    await stripeController.issueRefund(second.req, second.res);
    const secondKey = capturedIdempotencyKey(createSpy, 1);

    expect(secondKey).toBe(firstKey);
  });

  it('two independent legitimate refunds (different amounts) receive different idempotency keys', async () => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const paymentIntentId = `pi_test_${uniqueSuffix()}`;
    const chargeId = `ch_test_${uniqueSuffix()}`;
    const invoice = fakeInvoice(customerId, { amount_paid: 5000 });
    const charge = { id: chargeId, amount: 5000, amount_refunded: 0, currency: 'usd', customer: customerId };
    stubResolvedInvoice(invoice, paymentIntentId, charge);
    const createSpy = stubCreateRefund(`re_test_${uniqueSuffix()}`, paymentIntentId, chargeId);

    const first = mockReqRes({ paymentId: invoice.id, amount: 1000, reason: 'requested_by_customer' }, orgId, 'owner');
    await stripeController.issueRefund(first.req, first.res);
    const firstKey = capturedIdempotencyKey(createSpy, 0);

    const second = mockReqRes({ paymentId: invoice.id, amount: 2000, reason: 'requested_by_customer' }, orgId, 'owner');
    await stripeController.issueRefund(second.req, second.res);
    const secondKey = capturedIdempotencyKey(createSpy, 1);

    expect(secondKey).not.toBe(firstKey);
  });

  it('two independent legitimate refunds on different invoices receive different idempotency keys even with identical amount/reason', async () => {
    const { orgId, customerId } = await insertOrgWithCustomer();

    const paymentIntentId1 = `pi_test_${uniqueSuffix()}`;
    const chargeId1 = `ch_test_${uniqueSuffix()}`;
    const invoice1 = fakeInvoice(customerId, { amount_paid: 5000 });
    stubResolvedInvoice(invoice1, paymentIntentId1, { id: chargeId1, amount: 5000, amount_refunded: 0, currency: 'usd', customer: customerId });
    const createSpy = stubCreateRefund(`re_test_${uniqueSuffix()}`, paymentIntentId1, chargeId1);

    const first = mockReqRes({ paymentId: invoice1.id, amount: 1500, reason: 'duplicate' }, orgId, 'owner');
    await stripeController.issueRefund(first.req, first.res);
    const firstKey = capturedIdempotencyKey(createSpy, 0);

    const paymentIntentId2 = `pi_test_${uniqueSuffix()}`;
    const chargeId2 = `ch_test_${uniqueSuffix()}`;
    const invoice2 = fakeInvoice(customerId, { amount_paid: 5000 });
    stubResolvedInvoice(invoice2, paymentIntentId2, { id: chargeId2, amount: 5000, amount_refunded: 0, currency: 'usd', customer: customerId });
    createSpy.mockResolvedValueOnce({
      id: `re_test_${uniqueSuffix()}`,
      amount: 1500,
      currency: 'usd',
      status: 'succeeded',
      reason: null,
      payment_intent: paymentIntentId2,
      charge: chargeId2,
      metadata: {},
    } as any);

    const second = mockReqRes({ paymentId: invoice2.id, amount: 1500, reason: 'duplicate' }, orgId, 'owner');
    await stripeController.issueRefund(second.req, second.res);
    const secondKey = capturedIdempotencyKey(createSpy, 1);

    expect(secondKey).not.toBe(firstKey);
  });

  it('existing refund success behavior (response shape, amount, persistence) is unchanged by the idempotency key addition', async () => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const paymentIntentId = `pi_test_${uniqueSuffix()}`;
    const chargeId = `ch_test_${uniqueSuffix()}`;
    const invoice = fakeInvoice(customerId, { amount_paid: 5000 });
    const charge = { id: chargeId, amount: 5000, amount_refunded: 0, currency: 'usd', customer: customerId };
    stubResolvedInvoice(invoice, paymentIntentId, charge);
    const refundId = `re_test_${uniqueSuffix()}`;
    stubCreateRefund(refundId, paymentIntentId, chargeId);

    const { req, res, status, json } = mockReqRes({ paymentId: invoice.id, amount: 2000 }, orgId, 'owner');
    await stripeController.issueRefund(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: true, data: expect.objectContaining({ id: refundId }) }));

    const rows = await fetchRefundRows(orgId);
    expect(rows).toHaveLength(1);
    expect(rows[0].amount).toBe(2000);
  });

  it('existing refund error behavior (Stripe rejection) is unchanged by the idempotency key addition', async () => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const paymentIntentId = `pi_test_${uniqueSuffix()}`;
    const chargeId = `ch_test_${uniqueSuffix()}`;
    const invoice = fakeInvoice(customerId, { amount_paid: 5000 });
    const charge = { id: chargeId, amount: 5000, amount_refunded: 0, currency: 'usd', customer: customerId };
    stubResolvedInvoice(invoice, paymentIntentId, charge);
    jest.spyOn(stripeService, 'createRefund').mockRejectedValue(new Error('Stripe: refund failed'));

    const { req, res, status, json } = mockReqRes({ paymentId: invoice.id, amount: 2000 }, orgId, 'owner');
    await stripeController.issueRefund(req, res);

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false, error: 'Stripe: refund failed' }));
    expect(await fetchRefundRows(orgId)).toHaveLength(0);
  });
});
