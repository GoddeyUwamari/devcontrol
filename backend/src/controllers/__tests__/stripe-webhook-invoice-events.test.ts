/**
 * Coverage for the invoice-success webhook event name.
 *
 * The production Stripe Dashboard webhook endpoint is subscribed to
 * `invoice.paid`, not `invoice.payment_succeeded` -- so a handler keyed on
 * `invoice.payment_succeeded` (the previous code) is dead: Stripe only
 * delivers events an endpoint is actually subscribed to, so that branch
 * could never run in production.
 *
 * `handleInvoicePaid` (formerly `handleInvoicePaymentSucceeded`) is a
 * log-only stub with no state-changing side effects, so this suite proves
 * dispatch only (event type -> handled without error), not persistence.
 *
 * No Postgres dependency needed here -- unlike
 * stripe-webhook-entitlement-sync.test.ts, this handler never touches the
 * database. Stripe signature verification is stubbed the same way that
 * suite does it, so no real Stripe network call is made.
 */

import { Request, Response } from 'express';
import { stripeController } from '../stripe.controller';
import stripeService from '../../services/stripe.service';

function fakeEvent(type: string, object: any) {
  return { id: `evt_test_${Date.now()}`, type, data: { object } };
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

/** Bypasses real Stripe signature verification -- no Stripe call is made. */
function stubSignatureVerification(event: any) {
  return jest.spyOn(stripeService, 'verifyWebhookSignature').mockReturnValue(event as any);
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe('invoice.paid -- the event production actually sends', () => {
  it('is dispatched successfully (200, no error) and does not fall through to the default/unhandled branch', async () => {
    const invoice = { id: `in_test_${Date.now()}`, status: 'paid' };
    const event = fakeEvent('invoice.paid', invoice);
    stubSignatureVerification(event);
    const { req, res, json, status } = mockWebhookReqRes(event);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await stripeController.handleWebhook(req, res);
    logSpy.mockRestore();

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });
    expect(logSpy.mock.calls.flat()).not.toContainEqual(
      expect.stringContaining('Unhandled event type')
    );
  });
});

describe('invoice.payment_succeeded -- the event production does NOT send', () => {
  it('is intentionally left unhandled (falls to default), proving the old event was replaced, not duplicated', async () => {
    const invoice = { id: `in_test_${Date.now()}`, status: 'paid' };
    const event = fakeEvent('invoice.payment_succeeded', invoice);
    stubSignatureVerification(event);
    const { req, res, json, status } = mockWebhookReqRes(event);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await stripeController.handleWebhook(req, res);
    const loggedUnhandled = logSpy.mock.calls
      .flat()
      .some(arg => typeof arg === 'string' && arg.includes('Unhandled event type'));
    logSpy.mockRestore();

    // Webhook still acknowledges receipt (200) even for an event type it
    // doesn't specially handle -- Stripe requires a 2xx for any event it
    // sends, handled or not.
    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });
    expect(loggedUnhandled).toBe(true);
  });
});

describe('invoice.payment_failed -- unaffected by this change', () => {
  it('remains its own distinct, still-handled event', async () => {
    const invoice = { id: `in_test_${Date.now()}`, status: 'open' };
    const event = fakeEvent('invoice.payment_failed', invoice);
    stubSignatureVerification(event);
    const { req, res, json, status } = mockWebhookReqRes(event);

    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});
    await stripeController.handleWebhook(req, res);
    const loggedUnhandled = logSpy.mock.calls
      .flat()
      .some(arg => typeof arg === 'string' && arg.includes('Unhandled event type'));
    logSpy.mockRestore();

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });
    expect(loggedUnhandled).toBe(false);
  });
});
