/**
 * Live-Postgres coverage for the Stripe Checkout security fix: the server
 * must be authoritative over what a client can buy and where it gets
 * redirected.
 *
 * Root cause under test: POST /api/stripe/create-checkout-session used to
 * take priceId/successUrl/cancelUrl directly from the request body and pass
 * them straight to stripe.checkout.sessions.create(). A caller could request
 * checkout against an arbitrary Stripe price (any amount/product, not just
 * the platform's own starter/pro/enterprise plans) and redirect the
 * completed/cancelled session to an attacker-controlled URL.
 *
 * The fix: the client may only supply a tier name (starter/pro/enterprise).
 * The controller resolves the actual Stripe Price ID exclusively from
 * server-side env vars (StripeService.getPriceIdForTier) and always uses
 * fixed FRONTEND_URL-based success/cancel URLs -- any priceId/successUrl/
 * cancelUrl the client sends is read from nowhere and has no effect.
 *
 * Same pattern as stripe-webhook-entitlement-sync.test.ts: real Postgres for
 * the organization row, jest.spyOn on the actual Stripe-network-touching
 * service methods (createCustomer, createCheckoutSession) so the Stripe SDK
 * itself is never called, while the tier-validation and price-resolution
 * logic under test (isCheckoutTier, getPriceIdForTier, and the controller's
 * use of them) runs for real.
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { stripeController } from '../stripe.controller';
import stripeService, { CHECKOUT_TIERS, CheckoutTier, isCheckoutTier } from '../../services/stripe.service';

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
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, stripe_customer_id)
     VALUES ($1, $2, $3, 'free', $4)
     RETURNING id`,
    [
      `Checkout Security Org ${suffix}`,
      `checkout-security-org-${suffix}`,
      `Checkout Security Org ${suffix}`,
      customerId,
    ]
  );
  createdOrgIds.push(rows[0].id);
  return { orgId: rows[0].id as string, customerId };
}

function mockReqRes(body: any, organizationId: string) {
  const req = {
    user: { organizationId, email: `owner-${uniqueSuffix()}@example.com` },
    body,
  } as unknown as Request;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;

  return { req, res, json, status };
}

/** Stubs the real Stripe network call, capturing exactly what the controller resolved. */
function stubCreateCheckoutSession() {
  return jest.spyOn(stripeService, 'createCheckoutSession').mockResolvedValue({
    id: `cs_test_${uniqueSuffix()}`,
    url: 'https://checkout.stripe.com/test-session',
  } as any);
}

const ATTACKER_PRICE_ID = 'price_ATTACKER_CONTROLLED_ARBITRARY_AMOUNT';
const ATTACKER_SUCCESS_URL = 'https://evil.example.com/success';
const ATTACKER_CANCEL_URL = 'https://evil.example.com/cancel';

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('tier validation fails closed', () => {
  it.each([
    ['missing tier', {}],
    ['null tier', { tier: null }],
    ['free tier (not a purchasable Checkout tier)', { tier: 'free' }],
    ['unknown tier name', { tier: 'admin' }],
    ['non-string tier', { tier: 42 }],
  ])('%s -> 400, Stripe is never called', async (_label, body) => {
    const { orgId } = await insertOrgWithCustomer();
    const createSession = stubCreateCheckoutSession();
    const { req, res, json, status } = mockReqRes(body, orgId);

    await stripeController.createCheckoutSession(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ success: false })
    );
    expect(createSession).not.toHaveBeenCalled();
  });

  it('lists the valid tiers in the 400 error', async () => {
    const { orgId } = await insertOrgWithCustomer();
    stubCreateCheckoutSession();
    const { req, res, json } = mockReqRes({ tier: 'admin' }, orgId);

    await stripeController.createCheckoutSession(req, res);

    const [[payload]] = json.mock.calls;
    expect(payload.error).toContain('starter');
    expect(payload.error).toContain('pro');
    expect(payload.error).toContain('enterprise');
  });
});

describe('server resolves price ID and redirect URLs itself, ignoring client input', () => {
  it.each(CHECKOUT_TIERS)('valid tier "%s" resolves the price ID exclusively from its env var', async (tier) => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const createSession = stubCreateCheckoutSession();
    const { req, res, status } = mockReqRes({ tier }, orgId);

    await stripeController.createCheckoutSession(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(status).not.toHaveBeenCalledWith(500);
    expect(createSession).toHaveBeenCalledTimes(1);

    const [calledCustomerId, calledPriceId] = createSession.mock.calls[0];
    expect(calledCustomerId).toBe(customerId);
    expect(calledPriceId).toBe(stripeService.getPriceIdForTier(tier as CheckoutTier));
  });

  it('a client-supplied priceId/successUrl/cancelUrl is read from nowhere and has zero effect', async () => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const createSession = stubCreateCheckoutSession();
    const { req, res, status } = mockReqRes(
      {
        tier: 'pro',
        priceId: ATTACKER_PRICE_ID,
        successUrl: ATTACKER_SUCCESS_URL,
        cancelUrl: ATTACKER_CANCEL_URL,
      },
      orgId
    );

    await stripeController.createCheckoutSession(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    const [calledCustomerId, calledPriceId, , calledSuccessUrl, calledCancelUrl] =
      createSession.mock.calls[0];

    expect(calledCustomerId).toBe(customerId);
    expect(calledPriceId).toBe(stripeService.getPriceIdForTier('pro'));
    expect(calledPriceId).not.toBe(ATTACKER_PRICE_ID);
    expect(calledSuccessUrl).not.toBe(ATTACKER_SUCCESS_URL);
    expect(calledCancelUrl).not.toBe(ATTACKER_CANCEL_URL);
    expect(calledSuccessUrl).toBe(`${process.env.FRONTEND_URL}/billing/success?session_id={CHECKOUT_SESSION_ID}`);
    expect(calledCancelUrl).toBe(`${process.env.FRONTEND_URL}/billing/cancel`);
  });
});

describe('missing server-side price configuration fails closed, not with a client-controlled price', () => {
  it('a valid tier whose env var is unset returns 500 and never calls Stripe', async () => {
    const { orgId } = await insertOrgWithCustomer();
    const createSession = stubCreateCheckoutSession();
    const original = process.env.STRIPE_PRICE_STARTER;
    delete process.env.STRIPE_PRICE_STARTER;

    try {
      const { req, res, status, json } = mockReqRes({ tier: 'starter' }, orgId);

      await stripeController.createCheckoutSession(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(
        expect.objectContaining({ success: false })
      );
      expect(createSession).not.toHaveBeenCalled();
    } finally {
      if (original !== undefined) process.env.STRIPE_PRICE_STARTER = original;
    }
  });
});

describe('StripeService.getPriceIdForTier / isCheckoutTier', () => {
  it('has no hardcoded fallback -- throws when the env var is unset', () => {
    const original = process.env.STRIPE_PRICE_ENTERPRISE;
    delete process.env.STRIPE_PRICE_ENTERPRISE;
    try {
      expect(() => stripeService.getPriceIdForTier('enterprise')).toThrow(
        /STRIPE_PRICE_ENTERPRISE/
      );
    } finally {
      if (original !== undefined) process.env.STRIPE_PRICE_ENTERPRISE = original;
    }
  });

  it('rejects tiers outside starter/pro/enterprise', () => {
    expect(isCheckoutTier('free')).toBe(false);
    expect(isCheckoutTier('admin')).toBe(false);
    expect(isCheckoutTier(undefined)).toBe(false);
    expect(isCheckoutTier('starter')).toBe(true);
    expect(isCheckoutTier('pro')).toBe(true);
    expect(isCheckoutTier('enterprise')).toBe(true);
  });
});
