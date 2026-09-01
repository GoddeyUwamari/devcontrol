/**
 * P1 -- persisted Stripe webhook event-ID idempotency ledger
 * (stripe_webhook_events, database/migrations/202608312200_create_stripe_webhook_events.sql).
 *
 * Audit finding this closes: event.id was read once for a console.log and
 * never persisted anywhere (backend/src/controllers/stripe.controller.ts).
 * Every handler's tolerance for redelivery was incidental (absolute-value
 * UPDATEs, the invoice ordering high-water mark, the refunds ON CONFLICT
 * upsert) -- safe, but untracked and invisible to an operator, and not a
 * structural guarantee a future handler could rely on.
 *
 * This suite exercises the real StripeController.handleWebhook path (real
 * Postgres, real claim/resolve/advisory-lock code in
 * stripe-webhook-ledger.service.ts) -- it does not mock the dispatcher.
 * `dispatchWebhookEvent` is spied on WITHOUT mockImplementation purely to
 * count real invocations; it always still runs for real.
 *
 * invoice.payment_failed (already covered end-to-end by
 * stripe-payment-failure-lifecycle.test.ts) is reused here as the concrete
 * "did the handler actually run" probe, via
 * organizations.billing_lifecycle_state -- this suite is not re-testing
 * that lifecycle's own ordering/grace-period semantics, only proving the
 * ledger sits correctly in front of it. Stripe and Resend are always
 * stubbed; no network call is made anywhere in this file.
 */

import { Request, Response } from 'express';
import { Pool, type PoolClient } from 'pg';
import { stripeController } from '../stripe.controller';
import stripeService from '../../services/stripe.service';
import { claimWebhookEvent, resolveWebhookEvent } from '../../services/stripe-webhook-ledger.service';

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
const createdEventIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(): Promise<{ orgId: string; customerId: string }> {
  const suffix = uniqueSuffix();
  const customerId = `cus_test_${suffix}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (
       name, slug, display_name, subscription_tier, subscription_status,
       stripe_customer_id, stripe_subscription_id, billing_lifecycle_state
     ) VALUES ($1, $2, $3, 'pro', 'active', $4, $5, 'healthy')
     RETURNING id`,
    [
      `Ledger Test Org ${suffix}`,
      `ledger-test-org-${suffix}`,
      `Ledger Test Org ${suffix}`,
      customerId,
      `sub_test_${suffix}`,
    ]
  );
  createdOrgIds.push(rows[0].id);
  return { orgId: rows[0].id as string, customerId };
}

async function fetchLedgerRow(eventId: string) {
  const { rows } = await pool.query('SELECT * FROM stripe_webhook_events WHERE stripe_event_id = $1', [eventId]);
  return rows[0];
}

async function fetchOrgLifecycle(orgId: string) {
  const { rows } = await pool.query(
    'SELECT billing_lifecycle_state FROM organizations WHERE id = $1',
    [orgId]
  );
  return rows[0]?.billing_lifecycle_state as string | undefined;
}

function fakeEvent(id: string, type: string, object: any) {
  return { id, type, data: { object } };
}

function newEventId(): string {
  const id = `evt_test_${uniqueSuffix()}`;
  createdEventIds.push(id);
  return id;
}

function fakeFailedInvoice(customerId: string) {
  return {
    id: `in_test_${uniqueSuffix()}`,
    customer: customerId,
    status: 'open',
    created: Math.floor(Date.now() / 1000),
  };
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

/** Delivers `event` through the real, unmocked handleWebhook dispatch. */
async function deliverWebhook(event: any) {
  stubSignatureVerification(event);
  const { req, res, status, json } = mockWebhookReqRes(event);
  await stripeController.handleWebhook(req, res);
  return { status, json };
}

/** Spies on the real dispatchWebhookEvent to count invocations without altering behavior. */
function spyOnDispatch() {
  return jest.spyOn(stripeController as any, 'dispatchWebhookEvent');
}

beforeEach(() => {
  jest.spyOn(stripeService, 'sendPaymentFailedEmail').mockResolvedValue(true);
  jest.spyOn(console, 'log').mockImplementation(() => {});
  jest.spyOn(console, 'warn').mockImplementation(() => {});
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  if (createdEventIds.length > 0) {
    await pool.query('DELETE FROM stripe_webhook_events WHERE stripe_event_id = ANY($1)', [createdEventIds]);
  }
  await pool.end();
});

describe('first delivery', () => {
  it('runs the handler exactly once and reaches status=processed', async () => {
    const { orgId, customerId } = await insertOrg();
    const eventId = newEventId();
    const event = fakeEvent(eventId, 'invoice.payment_failed', fakeFailedInvoice(customerId));
    const dispatchSpy = spyOnDispatch();

    const { status, json } = await deliverWebhook(event);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const row = await fetchLedgerRow(eventId);
    expect(row).toBeDefined();
    expect(row.status).toBe('processed');
    expect(row.attempts).toBe(1);
    expect(row.processed_at).not.toBeNull();
    expect(row.event_type).toBe('invoice.payment_failed');

    expect(await fetchOrgLifecycle(orgId)).toBe('grace_period');
  });
});

describe('duplicate delivery after successful processing', () => {
  it('does not re-run the handler and still returns success', async () => {
    const { customerId } = await insertOrg();
    const eventId = newEventId();
    const event = fakeEvent(eventId, 'invoice.payment_failed', fakeFailedInvoice(customerId));
    const dispatchSpy = spyOnDispatch();

    await deliverWebhook(event);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const { status, json } = await deliverWebhook(event);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: true, received: true, duplicate: true })
    );
    // The handler must not have run a second time.
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const row = await fetchLedgerRow(eventId);
    expect(row.status).toBe('processed');
    expect(row.attempts).toBe(1);
  });
});

describe('concurrent duplicate delivery', () => {
  it('executes the handler only once when two requests for the same event arrive simultaneously', async () => {
    const { orgId, customerId } = await insertOrg();
    const eventId = newEventId();
    const event = fakeEvent(eventId, 'invoice.payment_failed', fakeFailedInvoice(customerId));
    const dispatchSpy = spyOnDispatch();

    // Two independent handleWebhook invocations, each doing its own
    // pool.connect() -- exactly what two different backend instances
    // hitting Postgres concurrently would look like. Correctness here comes
    // from the DB-level advisory lock in stripe-webhook-ledger.service.ts,
    // not from any in-process lock -- see the "multiple backend instances"
    // test below for a lower-level, explicit proof of that.
    const [first, second] = await Promise.all([deliverWebhook(event), deliverWebhook(event)]);

    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    // Neither request should have been told to error out.
    expect(first.status).not.toHaveBeenCalledWith(400);
    expect(second.status).not.toHaveBeenCalledWith(400);
    expect(first.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));
    expect(second.json).toHaveBeenCalledWith(expect.objectContaining({ success: true }));

    const row = await fetchLedgerRow(eventId);
    expect(row.status).toBe('processed');
    expect(row.attempts).toBe(1);
    expect(await fetchOrgLifecycle(orgId)).toBe('grace_period');
  });
});

describe('handler failure', () => {
  it('leaves the event retryable (status=failed, last_error set, 400 returned)', async () => {
    const { customerId } = await insertOrg();
    const eventId = newEventId();
    const event = fakeEvent(eventId, 'invoice.payment_failed', fakeFailedInvoice(customerId));

    jest.spyOn(stripeService, 'getOrganizationByCustomerId').mockRejectedValueOnce(new Error('simulated DB blip'));

    const { status, json } = await deliverWebhook(event);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false, error: 'simulated DB blip' })
    );

    const row = await fetchLedgerRow(eventId);
    expect(row.status).toBe('failed');
    expect(row.last_error).toBe('simulated DB blip');
    expect(row.attempts).toBe(1);
  });
});

describe('retry after failure', () => {
  it('reclaims the event and lets the handler run again, reaching processed', async () => {
    const { orgId, customerId } = await insertOrg();
    const eventId = newEventId();
    const event = fakeEvent(eventId, 'invoice.payment_failed', fakeFailedInvoice(customerId));
    const dispatchSpy = spyOnDispatch();

    jest.spyOn(stripeService, 'getOrganizationByCustomerId').mockRejectedValueOnce(new Error('simulated DB blip'));
    const firstAttempt = await deliverWebhook(event);
    expect(firstAttempt.status).toHaveBeenCalledWith(400);
    expect(dispatchSpy).toHaveBeenCalledTimes(1);
    expect((await fetchLedgerRow(eventId)).status).toBe('failed');

    // Simulate Stripe's redelivery of the same event id. No further mock
    // rejection queued, so this attempt runs the real handler to completion.
    const retry = await deliverWebhook(event);

    expect(retry.status).not.toHaveBeenCalledWith(400);
    expect(retry.json).toHaveBeenCalledWith({ success: true, received: true });
    expect(dispatchSpy).toHaveBeenCalledTimes(2);

    const row = await fetchLedgerRow(eventId);
    expect(row.status).toBe('processed');
    expect(row.attempts).toBe(2);
    expect(await fetchOrgLifecycle(orgId)).toBe('grace_period');
  });
});

describe('unhandled event type', () => {
  it('reaches a terminal processed state instead of staying processing forever', async () => {
    const eventId = newEventId();
    const event = fakeEvent(eventId, 'payment_intent.created', { id: `pi_test_${uniqueSuffix()}` });
    const dispatchSpy = spyOnDispatch();

    const { status, json } = await deliverWebhook(event);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });
    expect(dispatchSpy).toHaveBeenCalledTimes(1);

    const row = await fetchLedgerRow(eventId);
    expect(row.status).toBe('processed');
    expect(row.event_type).toBe('payment_intent.created');
  });
});

describe('event type persistence', () => {
  it('stores the exact Stripe event type string', async () => {
    const { customerId } = await insertOrg();
    const eventId = newEventId();
    const event = fakeEvent(eventId, 'invoice.payment_failed', fakeFailedInvoice(customerId));

    await deliverWebhook(event);

    expect((await fetchLedgerRow(eventId)).event_type).toBe('invoice.payment_failed');
  });
});

describe('stripe_event_id uniqueness', () => {
  it('is enforced by a real database constraint, not merely application logic', async () => {
    const eventId = newEventId();
    await pool.query(
      `INSERT INTO stripe_webhook_events (stripe_event_id, event_type) VALUES ($1, 'invoice.paid')`,
      [eventId]
    );

    await expect(
      pool.query(
        `INSERT INTO stripe_webhook_events (stripe_event_id, event_type) VALUES ($1, 'invoice.paid')`,
        [eventId]
      )
    ).rejects.toMatchObject({ code: '23505' }); // unique_violation
  });
});

describe('cross-organization isolation', () => {
  it('two different organizations delivering concurrently never affect each other', async () => {
    const orgA = await insertOrg();
    const orgB = await insertOrg();
    const eventA = fakeEvent(newEventId(), 'invoice.payment_failed', fakeFailedInvoice(orgA.customerId));
    const eventB = fakeEvent(newEventId(), 'invoice.payment_failed', fakeFailedInvoice(orgB.customerId));
    const dispatchSpy = spyOnDispatch();

    await Promise.all([deliverWebhook(eventA), deliverWebhook(eventB)]);

    expect(dispatchSpy).toHaveBeenCalledTimes(2);
    expect(await fetchOrgLifecycle(orgA.orgId)).toBe('grace_period');
    expect(await fetchOrgLifecycle(orgB.orgId)).toBe('grace_period');
    expect((await fetchLedgerRow(eventA.id)).status).toBe('processed');
    expect((await fetchLedgerRow(eventB.id)).status).toBe('processed');
  });
});

describe('multiple backend instances (no process-local state)', () => {
  it('the concurrency guard is a real Postgres advisory lock, not an in-process mutex', async () => {
    const eventId = newEventId();

    // Two genuinely separate connections -- exactly what two different
    // backend processes/instances would each hold. Nothing here is shared
    // in-process except the test's own assertions.
    const clientA: PoolClient = await pool.connect();
    const clientB: PoolClient = await pool.connect();
    try {
      const resultA = await claimWebhookEvent(clientA, eventId, 'invoice.paid');
      const resultB = await claimWebhookEvent(clientB, eventId, 'invoice.paid');

      expect(resultA.kind).toBe('claimed');
      expect(resultB.kind).toBe('in_progress_elsewhere');

      // clientB never acquired the lock, so it has nothing to release.
      // clientA must resolve (and thereby release) before this connection
      // is handed back to the pool, or the lock would sit on a pooled,
      // idle connection.
      await resolveWebhookEvent(clientA, eventId, { success: true });

      // Now that clientA's lock is released, a third "instance" can claim
      // the same event id -- but the row is already 'processed', so it
      // must be told there's nothing left to do, not run the handler again.
      const resultC = await claimWebhookEvent(clientA, eventId, 'invoice.paid');
      expect(resultC.kind).toBe('already_processed');
    } finally {
      clientA.release();
      clientB.release();
    }
  });
});
