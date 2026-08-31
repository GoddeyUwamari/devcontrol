/**
 * Live-Postgres coverage for POST /api/stripe/change-plan (upgrade/downgrade
 * an existing subscription), wiring StripeService.updateSubscription --
 * previously implemented but completely unreachable (no route, no
 * controller method, no frontend caller) -- into the app.
 *
 * Deliberately mirrors stripe-checkout-session.security.test.ts's security
 * architecture exactly, since changePlan reuses the same
 * ALLOWED_CHECKOUT_FIELDS / isCheckoutTier / isBillingInterval /
 * isSupportedPlan / getPriceIdForPlan pipeline as createCheckoutSession --
 * only the downstream Stripe call (updateSubscription vs
 * createCheckoutSession) and the precondition (must already have a
 * subscription, vs must not need one) differ.
 *
 * Real Postgres for the organization row, jest.spyOn on the actual
 * Stripe-network-touching service method (updateSubscription) so the
 * Stripe SDK itself is never called.
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { stripeController } from '../stripe.controller';
import stripeService, {
  CHECKOUT_TIERS,
  BILLING_INTERVALS,
  CheckoutTier,
  BillingInterval,
  isSupportedPlan,
} from '../../services/stripe.service';

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

async function insertOrgWithSubscription(tier: string = 'starter'): Promise<{ orgId: string; subscriptionId: string }> {
  const suffix = uniqueSuffix();
  const customerId = `cus_test_${suffix}`;
  const subscriptionId = `sub_test_${suffix}`;
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier, stripe_customer_id, stripe_subscription_id, subscription_status)
     VALUES ($1, $2, $3, $4, $5, $6, 'active')
     RETURNING id`,
    [
      `Change Plan Org ${suffix}`,
      `change-plan-org-${suffix}`,
      `Change Plan Org ${suffix}`,
      tier,
      customerId,
      subscriptionId,
    ]
  );
  createdOrgIds.push(rows[0].id);
  return { orgId: rows[0].id as string, subscriptionId };
}

async function insertOrgWithoutSubscription(): Promise<{ orgId: string }> {
  const suffix = uniqueSuffix();
  const { rows } = await pool.query(
    `INSERT INTO organizations (name, slug, display_name, subscription_tier)
     VALUES ($1, $2, $3, 'free')
     RETURNING id`,
    [
      `Change Plan No-Sub Org ${suffix}`,
      `change-plan-no-sub-org-${suffix}`,
      `Change Plan No-Sub Org ${suffix}`,
    ]
  );
  createdOrgIds.push(rows[0].id);
  return { orgId: rows[0].id as string };
}

async function fetchOrgTier(orgId: string): Promise<string> {
  const { rows } = await pool.query('SELECT subscription_tier FROM organizations WHERE id = $1', [orgId]);
  return rows[0].subscription_tier;
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
function stubUpdateSubscription(status: string = 'active') {
  return jest.spyOn(stripeService, 'updateSubscription').mockResolvedValue({
    id: `sub_test_${uniqueSuffix()}`,
    status,
  } as any);
}

// Same fake-price seeding as stripe-checkout-session.security.test.ts --
// this suite must not depend on real Stripe configuration.
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

const ATTACKER_PRICE_ID = 'price_ATTACKER_CONTROLLED_ARBITRARY_AMOUNT';

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

describe('upgrade/downgrade resolves the target plan and calls updateSubscription with it', () => {
  it('starter -> pro monthly: calls updateSubscription with the existing subscription id and the resolved Pro price', async () => {
    const { orgId, subscriptionId } = await insertOrgWithSubscription('starter');
    const updateSpy = stubUpdateSubscription();
    const { req, res, status, json } = mockReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);

    await stripeController.changePlan(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(status).not.toHaveBeenCalledWith(500);
    expect(updateSpy).toHaveBeenCalledTimes(1);
    expect(updateSpy).toHaveBeenCalledWith(subscriptionId, stripeService.getPriceIdForPlan('pro', 'monthly'));
    expect(json).toHaveBeenCalledWith(expect.objectContaining({
      success: true,
      data: expect.objectContaining({ tier: 'pro', billingInterval: 'monthly' }),
    }));

    expect(await fetchOrgTier(orgId)).toBe('pro');
  });

  it('pro -> starter annual (downgrade + cadence switch): resolves the Starter annual price', async () => {
    const { orgId, subscriptionId } = await insertOrgWithSubscription('pro');
    const updateSpy = stubUpdateSubscription();
    const { req, res } = mockReqRes({ tier: 'starter', billingInterval: 'annual' }, orgId);

    await stripeController.changePlan(req, res);

    expect(updateSpy).toHaveBeenCalledWith(subscriptionId, stripeService.getPriceIdForPlan('starter', 'annual'));
    expect(await fetchOrgTier(orgId)).toBe('starter');
  });
});

describe('no existing subscription -> 400, Stripe never called', () => {
  it('an org with no stripe_subscription_id cannot change plan', async () => {
    const { orgId } = await insertOrgWithoutSubscription();
    const updateSpy = stubUpdateSubscription();
    const { req, res, status, json } = mockReqRes({ tier: 'pro', billingInterval: 'monthly' }, orgId);

    await stripeController.changePlan(req, res);

    expect(status).toHaveBeenCalledWith(400);
    const [[payload]] = json.mock.calls;
    expect(payload.success).toBe(false);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('enterprise does not support self-service annual billing, same as checkout', () => {
  it('enterprise/annual -> 400 before any Stripe call', async () => {
    const { orgId } = await insertOrgWithSubscription('enterprise');
    const updateSpy = stubUpdateSubscription();
    const { req, res, status, json } = mockReqRes({ tier: 'enterprise', billingInterval: 'annual' }, orgId);

    await stripeController.changePlan(req, res);

    expect(status).toHaveBeenCalledWith(400);
    const [[payload]] = json.mock.calls;
    expect(payload.error).toMatch(/enterprise/i);
    expect(payload.error).toMatch(/annual/i);
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('client cannot smuggle a Stripe object id or arbitrary field', () => {
  it.each([
    ['priceId', { tier: 'pro', billingInterval: 'monthly', priceId: ATTACKER_PRICE_ID }],
    ['subscriptionId', { tier: 'pro', billingInterval: 'monthly', subscriptionId: 'sub_attacker' }],
    ['amount', { tier: 'pro', billingInterval: 'monthly', amount: 1 }],
  ])('a request containing "%s" is rejected with 400, not just ignored', async (_field, body) => {
    const { orgId } = await insertOrgWithSubscription('starter');
    const updateSpy = stubUpdateSubscription();
    const { req, res, status, json } = mockReqRes(body, orgId);

    await stripeController.changePlan(req, res);

    expect(status).toHaveBeenCalledWith(400);
    const [[payload]] = json.mock.calls;
    expect(payload.error).toContain('Unsupported field');
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('input validation fails closed', () => {
  it.each([
    ['missing tier', { billingInterval: 'monthly' }],
    ['missing billingInterval', { tier: 'pro' }],
    ['unknown tier name', { tier: 'admin', billingInterval: 'monthly' }],
    ['unknown billingInterval alias "yearly"', { tier: 'pro', billingInterval: 'yearly' }],
  ])('%s -> 400, Stripe is never called', async (_label, body) => {
    const { orgId } = await insertOrgWithSubscription('starter');
    const updateSpy = stubUpdateSubscription();
    const { req, res, status, json } = mockReqRes(body, orgId);

    await stripeController.changePlan(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(updateSpy).not.toHaveBeenCalled();
  });
});

describe('missing server-side price configuration fails closed', () => {
  it('a valid target plan whose env var is unset returns 500 and never calls Stripe', async () => {
    const { orgId } = await insertOrgWithSubscription('starter');
    const updateSpy = stubUpdateSubscription();
    const original = process.env.STRIPE_PRICE_PRO_ANNUAL;
    delete process.env.STRIPE_PRICE_PRO_ANNUAL;

    try {
      const { req, res, status, json } = mockReqRes({ tier: 'pro', billingInterval: 'annual' }, orgId);

      await stripeController.changePlan(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(updateSpy).not.toHaveBeenCalled();
    } finally {
      if (original !== undefined) process.env.STRIPE_PRICE_PRO_ANNUAL = original;
    }
  });
});
