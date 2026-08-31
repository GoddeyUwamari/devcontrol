/**
 * Billing admin-authorization tests.
 *
 * Audit finding: stripe.controller.ts had no role check at all -- any
 * authenticated org member, including the lowest-privilege 'viewer' role,
 * could cancel, resume, or change the organization's paid subscription, or
 * open its Stripe Customer Portal session. This suite proves
 * cancelSubscription, resumeSubscription, changePlan, and
 * createCustomerPortal are now gated to owner/admin only via the new
 * StripeController.requireBillingAdmin() helper.
 *
 * Role comes exclusively from req.user.role (set server-side by
 * authenticate() from the verified JWT) -- never from the request body,
 * query string, or headers. Several tests below explicitly prove a
 * client-supplied "role" in any of those locations has no effect.
 *
 * Same pattern as the other stripe controller suites: real Postgres for
 * "DB untouched on rejection" assertions, jest.spyOn on the actual
 * Stripe-network-touching service methods so the Stripe SDK is never
 * called for a rejected request, and so a spy call proves an allowed
 * request actually reached business logic.
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { stripeController } from '../stripe.controller';
import stripeService, { CHECKOUT_TIERS, BILLING_INTERVALS, CheckoutTier, BillingInterval, isSupportedPlan } from '../../services/stripe.service';

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

async function insertOrgWithSubscription(): Promise<{ orgId: string; subscriptionId: string; customerId: string }> {
  const suffix = uniqueSuffix();
  const customerId = `cus_test_${suffix}`;
  const subscriptionId = `sub_test_${suffix}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, stripe_customer_id, stripe_subscription_id, subscription_status)
     VALUES ($1, $2, $3, 'starter', $4, $5, 'active')
     RETURNING id`,
    [
      `Billing Authz Org ${suffix}`,
      `billing-authz-org-${suffix}`,
      `Billing Authz Org ${suffix}`,
      customerId,
      subscriptionId,
    ]
  );
  createdOrgIds.push(rows[0].id);
  return { orgId: rows[0].id as string, subscriptionId, customerId };
}

async function fetchOrgRow(orgId: string) {
  const { rows } = await pool.query(
    'SELECT subscription_tier, subscription_status, subscription_cancel_at_period_end FROM organizations WHERE id = $1',
    [orgId]
  );
  return rows[0];
}

function mockReqRes(
  body: any,
  organizationId: string | undefined,
  role: string | undefined,
  extra: { query?: any; headers?: any } = {}
) {
  const req = {
    user: organizationId === undefined ? undefined : { organizationId, email: `owner-${uniqueSuffix()}@example.com`, role },
    body,
    query: extra.query ?? {},
    headers: extra.headers ?? {},
  } as unknown as Request;

  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const res = { json, status } as unknown as Response;

  return { req, res, json, status };
}

// Fake price env, same pattern as stripe-checkout-session.security.test.ts --
// changePlan's authorization check must be provably independent of price
// configuration, but we still need a valid target price for the
// owner/admin "allowed" cases to reach stripeService.updateSubscription.
const FAKE_PRICE_IDS: Record<CheckoutTier, Partial<Record<BillingInterval, string>>> = {
  starter: { monthly: 'price_test_fake_starter_monthly', annual: 'price_test_fake_starter_annual' },
  pro: { monthly: 'price_test_fake_pro_monthly', annual: 'price_test_fake_pro_annual' },
  enterprise: { monthly: 'price_test_fake_enterprise_monthly' },
};
const PRICE_ENV_VAR: Record<CheckoutTier, Partial<Record<BillingInterval, string>>> = {
  starter: { monthly: 'STRIPE_PRICE_STARTER_MONTHLY', annual: 'STRIPE_PRICE_STARTER_ANNUAL' },
  pro: { monthly: 'STRIPE_PRICE_PRO_MONTHLY', annual: 'STRIPE_PRICE_PRO_ANNUAL' },
  enterprise: { monthly: 'STRIPE_PRICE_ENTERPRISE_MONTHLY' },
};
let originalPriceEnv: Record<string, string | undefined>;

beforeAll(() => {
  originalPriceEnv = {};
  for (const tier of CHECKOUT_TIERS) {
    for (const interval of BILLING_INTERVALS) {
      if (!isSupportedPlan(tier, interval)) continue;
      const envVar = PRICE_ENV_VAR[tier][interval]!;
      originalPriceEnv[envVar] = process.env[envVar];
      process.env[envVar] = FAKE_PRICE_IDS[tier][interval]!;
    }
  }
});

afterAll(async () => {
  for (const [envVar, value] of Object.entries(originalPriceEnv)) {
    if (value === undefined) delete process.env[envVar];
    else process.env[envVar] = value;
  }
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

afterEach(() => {
  jest.restoreAllMocks();
});

const ALLOWED_ROLES = ['owner', 'admin'];
const REJECTED_ROLES = ['member', 'viewer'];

describe('cancelSubscription authorization', () => {
  it.each(ALLOWED_ROLES)('%s role is allowed and reaches the Stripe service', async (role) => {
    const { orgId, subscriptionId } = await insertOrgWithSubscription();
    const spy = jest.spyOn(stripeService, 'cancelSubscriptionAtPeriodEnd').mockResolvedValue({
      status: 'active',
      cancel_at_period_end: true,
    } as any);
    const { req, res, status } = mockReqRes({ immediate: false }, orgId, role);

    await stripeController.cancelSubscription(req, res);

    expect(status).not.toHaveBeenCalledWith(403);
    expect(spy).toHaveBeenCalledWith(subscriptionId);
  });

  it.each(REJECTED_ROLES)('%s role is rejected 403, Stripe never called, DB unchanged', async (role) => {
    const { orgId } = await insertOrgWithSubscription();
    const before = await fetchOrgRow(orgId);
    const spyImmediate = jest.spyOn(stripeService, 'cancelSubscription');
    const spyAtPeriodEnd = jest.spyOn(stripeService, 'cancelSubscriptionAtPeriodEnd');
    const { req, res, status, json } = mockReqRes({ immediate: false }, orgId, role);

    await stripeController.cancelSubscription(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(spyImmediate).not.toHaveBeenCalled();
    expect(spyAtPeriodEnd).not.toHaveBeenCalled();
    expect(await fetchOrgRow(orgId)).toEqual(before);
  });

  it('unauthenticated request gets the existing 401, not 403', async () => {
    const { req, res, status, json } = mockReqRes({ immediate: false }, undefined, undefined);

    await stripeController.cancelSubscription(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Authentication required' }));
  });
});

describe('resumeSubscription authorization', () => {
  it.each(ALLOWED_ROLES)('%s role is allowed and reaches the Stripe service', async (role) => {
    const { orgId, subscriptionId } = await insertOrgWithSubscription();
    const spy = jest.spyOn(stripeService, 'resumeSubscription').mockResolvedValue({ status: 'active' } as any);
    const { req, res, status } = mockReqRes({}, orgId, role);

    await stripeController.resumeSubscription(req, res);

    expect(status).not.toHaveBeenCalledWith(403);
    expect(spy).toHaveBeenCalledWith(subscriptionId);
  });

  it.each(REJECTED_ROLES)('%s role is rejected 403, Stripe never called, DB unchanged', async (role) => {
    const { orgId } = await insertOrgWithSubscription();
    const before = await fetchOrgRow(orgId);
    const spy = jest.spyOn(stripeService, 'resumeSubscription');
    const { req, res, status, json } = mockReqRes({}, orgId, role);

    await stripeController.resumeSubscription(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(spy).not.toHaveBeenCalled();
    expect(await fetchOrgRow(orgId)).toEqual(before);
  });

  it('unauthenticated request gets the existing 401, not 403', async () => {
    const { req, res, status, json } = mockReqRes({}, undefined, undefined);

    await stripeController.resumeSubscription(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Authentication required' }));
  });
});

describe('changePlan authorization', () => {
  it.each(ALLOWED_ROLES)('%s role is allowed and reaches the Stripe service', async (role) => {
    const { orgId, subscriptionId } = await insertOrgWithSubscription();
    const spy = jest.spyOn(stripeService, 'updateSubscription').mockResolvedValue({ status: 'active' } as any);
    const { req, res, status } = mockReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId, role);

    await stripeController.changePlan(req, res);

    expect(status).not.toHaveBeenCalledWith(403);
    expect(spy).toHaveBeenCalledWith(subscriptionId, stripeService.getPriceIdForPlan('pro', 'monthly'));
  });

  it.each(REJECTED_ROLES)('%s role is rejected 403, Stripe never called, DB unchanged', async (role) => {
    const { orgId } = await insertOrgWithSubscription();
    const before = await fetchOrgRow(orgId);
    const spy = jest.spyOn(stripeService, 'updateSubscription');
    const { req, res, status, json } = mockReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId, role);

    await stripeController.changePlan(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(spy).not.toHaveBeenCalled();
    expect(await fetchOrgRow(orgId)).toEqual(before);
  });

  it('unauthenticated request gets the existing 401, not 403', async () => {
    const { req, res, status, json } = mockReqRes({ tier: 'pro', billingInterval: 'monthly' }, undefined, undefined);

    await stripeController.changePlan(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Authentication required' }));
  });

  it('a client-supplied "role" in the body, query, or headers cannot override the real (rejected) role', async () => {
    const { orgId } = await insertOrgWithSubscription();
    const spy = jest.spyOn(stripeService, 'updateSubscription');
    const { req, res, status } = mockReqRes(
      { tier: 'pro', billingInterval: 'monthly', role: 'owner' },
      orgId,
      'member',
      { query: { role: 'owner' }, headers: { 'x-role': 'owner', 'x-user-role': 'admin' } }
    );

    await stripeController.changePlan(req, res);

    // Still rejected: the body's "role" field isn't even in
    // ALLOWED_CHECKOUT_FIELDS, and query/headers are never read for role
    // anywhere in the controller -- only req.user.role (JWT-derived) counts.
    expect(status).toHaveBeenCalledWith(403);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('createCustomerPortal authorization', () => {
  it.each(ALLOWED_ROLES)('%s role is allowed and reaches the Stripe service', async (role) => {
    const { orgId, customerId } = await insertOrgWithSubscription();
    const spy = jest.spyOn(stripeService, 'createPortalSession').mockResolvedValue({ url: 'https://billing.stripe.com/test' } as any);
    const { req, res, status } = mockReqRes({}, orgId, role);

    await stripeController.createCustomerPortal(req, res);

    expect(status).not.toHaveBeenCalledWith(403);
    expect(spy).toHaveBeenCalledWith(customerId, expect.any(String));
  });

  it.each(REJECTED_ROLES)('%s role is rejected 403, Stripe never called', async (role) => {
    const { orgId } = await insertOrgWithSubscription();
    const spy = jest.spyOn(stripeService, 'createPortalSession');
    const { req, res, status, json } = mockReqRes({}, orgId, role);

    await stripeController.createCustomerPortal(req, res);

    expect(status).toHaveBeenCalledWith(403);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(spy).not.toHaveBeenCalled();
  });

  it('unauthenticated request gets the existing 401, not 403', async () => {
    const { req, res, status, json } = mockReqRes({}, undefined, undefined);

    await stripeController.createCustomerPortal(req, res);

    expect(status).toHaveBeenCalledWith(401);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ error: 'Authentication required' }));
  });
});
