/**
 * Live-Postgres coverage for the Stripe Checkout security architecture:
 * the server is authoritative over what plan a client can buy, at what
 * billing cadence, and where it gets redirected.
 *
 * POST /api/stripe/create-checkout-session accepts exactly two fields:
 *   { tier: 'starter'|'pro'|'enterprise', billingInterval: 'monthly'|'annual' }
 * Anything else in the body -- priceId, customerId, subscriptionId, amount,
 * currency, line items, successUrl/cancelUrl -- is rejected with 400
 * (StripeController.ALLOWED_CHECKOUT_FIELDS), not silently ignored, so an
 * attempted bypass is observable and testable rather than a silent no-op.
 *
 * The Stripe Price ID is resolved exclusively through
 * StripeService.getPriceIdForPlan(tier, interval), which reads
 * PRICE_ENV_VAR_CANDIDATES (stripe.service.ts) -- the same table
 * getTierFromPriceId() reads in reverse for webhook tier detection, so
 * checkout and webhook can never disagree about which Price ID belongs to
 * which tier. There is no hardcoded fallback price anywhere in that path;
 * an unconfigured (tier, interval) throws and the controller turns that
 * into a 500, never a client-controlled price.
 *
 * Same pattern as stripe-webhook-entitlement-sync.test.ts: real Postgres
 * for the organization row, jest.spyOn on the actual Stripe-network-
 * touching service method (createCheckoutSession) so the Stripe SDK itself
 * is never called, while tier/interval validation and price resolution
 * (isCheckoutTier, isBillingInterval, getPriceIdForPlan, and the
 * controller's use of them) run for real.
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

// Test-only fake Price IDs -- never real Stripe values -- seeded for every
// *supported* tier x interval combination so this suite is fully hermetic.
// It must not depend on real Stripe configuration being present in the
// environment it runs in: CI sets no STRIPE_* vars at all (see
// .github/workflows/ci.yml's "Run backend tests" step) and backend/.env
// (the only place any of these are configured locally) is git-ignored, so
// neither can be assumed. enterprise/annual is deliberately excluded here
// (via isSupportedPlan) -- there is no such Price/env var to seed, since
// Enterprise is monthly-only self-service (annual is Contact Sales).
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

describe('every supported tier x billingInterval combination', () => {
  // Starter monthly, Starter annual, Pro monthly, Pro annual, Enterprise
  // monthly -- enterprise/annual is intentionally excluded here and covered
  // separately below as a rejected combination, not a valid one.
  const combos: Array<[CheckoutTier, BillingInterval]> = CHECKOUT_TIERS.flatMap(tier =>
    BILLING_INTERVALS.filter(interval => isSupportedPlan(tier, interval)).map(
      interval => [tier, interval] as [CheckoutTier, BillingInterval]
    )
  );

  it.each(combos)('%s / %s resolves that plan\'s server-configured Price ID', async (tier, interval) => {
    const { orgId, customerId } = await insertOrgWithCustomer();
    const createSession = stubCreateCheckoutSession();
    const { req, res, status } = mockReqRes({ tier, billingInterval: interval }, orgId);

    await stripeController.createCheckoutSession(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(status).not.toHaveBeenCalledWith(500);
    expect(createSession).toHaveBeenCalledTimes(1);

    const [calledCustomerId, calledPriceId] = createSession.mock.calls[0];
    expect(calledCustomerId).toBe(customerId);
    expect(calledPriceId).toBe(stripeService.getPriceIdForPlan(tier, interval));
  });
});

describe('enterprise does not support self-service annual billing', () => {
  it('enterprise/annual -> 400 before any Stripe call, with a clear reason', async () => {
    const { orgId } = await insertOrgWithCustomer();
    const createSession = stubCreateCheckoutSession();
    const { req, res, status, json } = mockReqRes({ tier: 'enterprise', billingInterval: 'annual' }, orgId);

    await stripeController.createCheckoutSession(req, res);

    expect(status).toHaveBeenCalledWith(400);
    const [[payload]] = json.mock.calls;
    expect(payload.success).toBe(false);
    expect(payload.error).toMatch(/enterprise/i);
    expect(payload.error).toMatch(/annual/i);
    expect(createSession).not.toHaveBeenCalled();
  });

  it('STRIPE_PRICE_ENTERPRISE_ANNUAL is never required by env validation, configured or not', () => {
    const original = process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL;
    delete process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL;
    try {
      expect(stripeService.getMissingCheckoutPriceEnvVars()).not.toContain('STRIPE_PRICE_ENTERPRISE_ANNUAL');
    } finally {
      if (original !== undefined) process.env.STRIPE_PRICE_ENTERPRISE_ANNUAL = original;
    }
  });

  it('isSupportedPlan rejects only enterprise/annual, not enterprise/monthly or any starter/pro combination', () => {
    expect(isSupportedPlan('enterprise', 'annual')).toBe(false);
    expect(isSupportedPlan('enterprise', 'monthly')).toBe(true);
    expect(isSupportedPlan('starter', 'monthly')).toBe(true);
    expect(isSupportedPlan('starter', 'annual')).toBe(true);
    expect(isSupportedPlan('pro', 'monthly')).toBe(true);
    expect(isSupportedPlan('pro', 'annual')).toBe(true);
  });
});

describe('input validation fails closed', () => {
  it.each([
    ['missing tier', { billingInterval: 'monthly' }],
    ['missing billingInterval', { tier: 'starter' }],
    ['empty body', {}],
    ['free tier (not purchasable via Checkout)', { tier: 'free', billingInterval: 'monthly' }],
    ['unknown tier name', { tier: 'admin', billingInterval: 'monthly' }],
    ['unknown billingInterval alias "year"', { tier: 'starter', billingInterval: 'year' }],
    ['unknown billingInterval alias "yearly"', { tier: 'starter', billingInterval: 'yearly' }],
    ['non-string tier', { tier: 42, billingInterval: 'monthly' }],
    ['non-string billingInterval', { tier: 'starter', billingInterval: true }],
  ])('%s -> 400, Stripe is never called', async (_label, body) => {
    const { orgId } = await insertOrgWithCustomer();
    const createSession = stubCreateCheckoutSession();
    const { req, res, status, json } = mockReqRes(body, orgId);

    await stripeController.createCheckoutSession(req, res);

    expect(status).toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
    expect(createSession).not.toHaveBeenCalled();
  });
});

describe('client cannot smuggle a Stripe object id or arbitrary line-item data', () => {
  it.each([
    ['priceId', { tier: 'pro', billingInterval: 'monthly', priceId: ATTACKER_PRICE_ID }],
    ['customerId', { tier: 'pro', billingInterval: 'monthly', customerId: 'cus_attacker' }],
    ['subscriptionId', { tier: 'pro', billingInterval: 'monthly', subscriptionId: 'sub_attacker' }],
    ['amount', { tier: 'pro', billingInterval: 'monthly', amount: 1 }],
    ['currency', { tier: 'pro', billingInterval: 'monthly', currency: 'usd' }],
    ['lineItems', { tier: 'pro', billingInterval: 'monthly', lineItems: [{ price: ATTACKER_PRICE_ID }] }],
    ['successUrl', { tier: 'pro', billingInterval: 'monthly', successUrl: 'https://evil.example.com' }],
    ['cancelUrl', { tier: 'pro', billingInterval: 'monthly', cancelUrl: 'https://evil.example.com' }],
  ])('a request containing "%s" is rejected with 400, not just ignored', async (_field, body) => {
    const { orgId } = await insertOrgWithCustomer();
    const createSession = stubCreateCheckoutSession();
    const { req, res, status, json } = mockReqRes(body, orgId);

    await stripeController.createCheckoutSession(req, res);

    expect(status).toHaveBeenCalledWith(400);
    const [[payload]] = json.mock.calls;
    expect(payload.success).toBe(false);
    expect(payload.error).toContain('Unsupported field');
    expect(createSession).not.toHaveBeenCalled();
  });

  it('a valid request with priceId attached never lets that price reach Stripe', async () => {
    const { orgId } = await insertOrgWithCustomer();
    const createSession = stubCreateCheckoutSession();
    const { req, res } = mockReqRes(
      { tier: 'pro', billingInterval: 'monthly', priceId: ATTACKER_PRICE_ID },
      orgId
    );

    await stripeController.createCheckoutSession(req, res);

    expect(createSession).not.toHaveBeenCalled();
  });
});

describe('missing server-side price configuration fails closed', () => {
  it('a valid tier/monthly combo whose env var (and legacy alias) are unset returns 500 and never calls Stripe', async () => {
    const { orgId } = await insertOrgWithCustomer();
    const createSession = stubCreateCheckoutSession();
    const originalMonthly = process.env.STRIPE_PRICE_STARTER_MONTHLY;
    const originalLegacy = process.env.STRIPE_PRICE_STARTER;
    delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
    delete process.env.STRIPE_PRICE_STARTER;

    try {
      const { req, res, status, json } = mockReqRes({ tier: 'starter', billingInterval: 'monthly' }, orgId);

      await stripeController.createCheckoutSession(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(createSession).not.toHaveBeenCalled();
    } finally {
      if (originalMonthly !== undefined) process.env.STRIPE_PRICE_STARTER_MONTHLY = originalMonthly;
      if (originalLegacy !== undefined) process.env.STRIPE_PRICE_STARTER = originalLegacy;
    }
  });

  it('a valid tier/annual combo whose env var is unset returns 500 and never calls Stripe (no silent fallback to monthly)', async () => {
    const { orgId } = await insertOrgWithCustomer();
    const createSession = stubCreateCheckoutSession();
    const original = process.env.STRIPE_PRICE_PRO_ANNUAL;
    delete process.env.STRIPE_PRICE_PRO_ANNUAL;

    try {
      const { req, res, status, json } = mockReqRes({ tier: 'pro', billingInterval: 'annual' }, orgId);

      await stripeController.createCheckoutSession(req, res);

      expect(status).toHaveBeenCalledWith(500);
      expect(json).toHaveBeenCalledWith(expect.objectContaining({ success: false }));
      expect(createSession).not.toHaveBeenCalled();
    } finally {
      if (original !== undefined) process.env.STRIPE_PRICE_PRO_ANNUAL = original;
    }
  });
});

describe('StripeService price resolver -- no hardcoded fallback IDs', () => {
  it('getPriceIdForPlan throws (does not return a default) when unconfigured', () => {
    const original = process.env.STRIPE_PRICE_PRO_ANNUAL;
    delete process.env.STRIPE_PRICE_PRO_ANNUAL;
    try {
      expect(() => stripeService.getPriceIdForPlan('pro', 'annual')).toThrow(/STRIPE_PRICE_PRO_ANNUAL/);
    } finally {
      if (original !== undefined) process.env.STRIPE_PRICE_PRO_ANNUAL = original;
    }
  });

  it('getMissingCheckoutPriceEnvVars lists every unconfigured (tier, interval) canonical var name', () => {
    const originalMonthly = process.env.STRIPE_PRICE_PRO_MONTHLY;
    const originalLegacy = process.env.STRIPE_PRICE_PRO;
    delete process.env.STRIPE_PRICE_PRO_MONTHLY;
    delete process.env.STRIPE_PRICE_PRO;
    try {
      expect(stripeService.getMissingCheckoutPriceEnvVars()).toContain('STRIPE_PRICE_PRO_MONTHLY');
    } finally {
      if (originalMonthly !== undefined) process.env.STRIPE_PRICE_PRO_MONTHLY = originalMonthly;
      if (originalLegacy !== undefined) process.env.STRIPE_PRICE_PRO = originalLegacy;
    }
  });

  it('monthly resolution falls back to the legacy unsuffixed var only when *_MONTHLY is unset', () => {
    const originalMonthly = process.env.STRIPE_PRICE_STARTER_MONTHLY;
    const originalLegacy = process.env.STRIPE_PRICE_STARTER;
    const fakeLegacyValue = 'price_test_fake_starter_legacy';
    delete process.env.STRIPE_PRICE_STARTER_MONTHLY;
    process.env.STRIPE_PRICE_STARTER = fakeLegacyValue;
    try {
      expect(stripeService.getPriceIdForPlan('starter', 'monthly')).toBe(fakeLegacyValue);
    } finally {
      if (originalMonthly !== undefined) process.env.STRIPE_PRICE_STARTER_MONTHLY = originalMonthly;
      if (originalLegacy !== undefined) process.env.STRIPE_PRICE_STARTER = originalLegacy;
      else delete process.env.STRIPE_PRICE_STARTER;
    }
  });
});

describe('webhook tier detection recognizes both monthly and annual prices for the same tier', () => {
  const annualCapableTiers = CHECKOUT_TIERS.filter(tier => isSupportedPlan(tier, 'annual'));

  it.each(annualCapableTiers)('%s: monthly and annual Price IDs both resolve to tier "%s"', (tier) => {
    const monthlyPriceId = stripeService.getPriceIdForPlan(tier, 'monthly');
    const annualPriceId = stripeService.getPriceIdForPlan(tier, 'annual');

    expect(stripeService.getTierFromPriceId(monthlyPriceId)).toBe(tier);
    expect(stripeService.getTierFromPriceId(annualPriceId)).toBe(tier);
  });

  it('enterprise: only the monthly Price is resolvable/mappable -- there is no annual Price to recognize', () => {
    const monthlyPriceId = stripeService.getPriceIdForPlan('enterprise', 'monthly');
    expect(stripeService.getTierFromPriceId(monthlyPriceId)).toBe('enterprise');
    expect(() => stripeService.getPriceIdForPlan('enterprise', 'annual')).toThrow();
  });

  it('an unrecognized Price ID still falls back to "free"', () => {
    expect(stripeService.getTierFromPriceId('price_totally_unknown')).toBe('free');
  });
});
