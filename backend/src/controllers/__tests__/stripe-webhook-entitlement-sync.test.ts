/**
 * Live-Postgres coverage for Phase 2A: Stripe subscription tier changes must
 * synchronize the organization's entitlement limits.
 *
 * Root cause under test: StripeService.updateOrganizationSubscription()
 * (stripe.service.ts) previously wrote subscription_tier but never touched
 * max_services/max_users/max_deployments_per_month -- those columns are only
 * ever set once, at organization-creation time (see
 * free-tier-plan-limits.test.ts). Every tier change driven by a Stripe
 * webhook therefore left the org enforced against its *original* tier's
 * limits forever, regardless of what it was actually billed for.
 *
 * The fix derives max_services/max_users/max_deployments_per_month from the
 * canonical TIER_LIMITS[tier] map (subscription.middleware.ts) and writes
 * them in the same UPDATE as subscription_tier, only when the tier is
 * actually changing.
 *
 * Same rationale/pattern as free-tier-plan-limits.test.ts and
 * services.routes.lifecycle.test.ts: real Postgres for the actual
 * column/UPDATE semantics, jest.spyOn the Stripe-facing methods
 * (verifyWebhookSignature, getSubscription) so the Stripe SDK itself is
 * never exercised and no network call is made -- everything else
 * (getOrganizationByCustomerId, updateOrganizationSubscription,
 * getTierFromPriceId) runs for real against local Postgres, so the actual
 * webhook dispatch -> handler -> sync-logic path is proven, not mocked away.
 *
 * The "no unnecessary rewrite on a same-tier update" case is proven via
 * Postgres's own xmin system column rather than updated_at: the
 * update_organizations_updated_at trigger (004_add_multi_tenancy.sql) bumps
 * updated_at on ANY UPDATE that touches the row -- including a same-value
 * rewrite, and including updates that only touch unrelated fields like
 * subscription_cancel_at_period_end -- so it cannot distinguish "entitlement
 * columns were skipped" from "some other field changed". xmin, by contrast,
 * only advances when an UPDATE statement is actually issued against the row
 * (verified manually: a same-value UPDATE still bumps xmin), which is
 * exactly what "no unnecessary rewrite" needs to prove.
 */

import { Request, Response } from 'express';
import { Pool } from 'pg';
import { stripeController } from '../stripe.controller';
import stripeService from '../../services/stripe.service';
import { TIER_LIMITS } from '../../middleware/subscription.middleware';

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

// This suite must not depend on any real Stripe configuration being present
// in the environment it runs in -- CI sets none (see .github/workflows/
// ci.yml's "Run backend tests" step) and backend/.env is git-ignored, so
// neither can be assumed. Every price env var this file needs is seeded
// here with a fake test-only value (never a real Stripe id) and restored in
// afterAll, so resolution below always goes through the real
// StripeService.getPriceIdForPlan() -- exercising actual production code,
// not a locally-duplicated constant -- while being fully hermetic.
const FAKE_PRICE_ENV: Record<string, string> = {
  STRIPE_PRICE_STARTER_MONTHLY: 'price_test_fake_starter_monthly',
  STRIPE_PRICE_STARTER_ANNUAL: 'price_test_fake_starter_annual',
  STRIPE_PRICE_PRO_MONTHLY: 'price_test_fake_pro_monthly',
};
const originalPriceEnv: Record<string, string | undefined> = {};
for (const [envVar, fakeValue] of Object.entries(FAKE_PRICE_ENV)) {
  originalPriceEnv[envVar] = process.env[envVar];
  process.env[envVar] = fakeValue;
}

const STARTER_PRICE_ID = stripeService.getPriceIdForPlan('starter', 'monthly');
const PRO_PRICE_ID = stripeService.getPriceIdForPlan('pro', 'monthly');
const STARTER_ANNUAL_PRICE_ID = stripeService.getPriceIdForPlan('starter', 'annual');

const createdOrgIds: string[] = [];

function uniqueSuffix(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

async function insertOrg(overrides: {
  tier?: string;
  maxServices?: number;
  maxUsers?: number;
  maxDeploymentsPerMonth?: number;
  stripeCustomerId?: string;
  cancelAtPeriodEnd?: boolean;
} = {}): Promise<string> {
  const suffix = uniqueSuffix();
  const tier = overrides.tier ?? 'free';
  const tierDefaults = TIER_LIMITS[tier as keyof typeof TIER_LIMITS];

  const { rows } = await pool.query(
    `INSERT INTO organizations (
       name, slug, display_name, subscription_tier,
       max_services, max_users, max_deployments_per_month,
       stripe_customer_id, subscription_cancel_at_period_end
     ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
     RETURNING id`,
    [
      `Entitlement Sync Org ${suffix}`,
      `entitlement-sync-org-${suffix}`,
      `Entitlement Sync Org ${suffix}`,
      tier,
      overrides.maxServices ?? tierDefaults.maxServices,
      overrides.maxUsers ?? tierDefaults.maxUsers,
      overrides.maxDeploymentsPerMonth ?? tierDefaults.maxDeploymentsPerMonth,
      overrides.stripeCustomerId ?? null,
      overrides.cancelAtPeriodEnd ?? false,
    ]
  );
  createdOrgIds.push(rows[0].id);
  return rows[0].id as string;
}

async function fetchOrgRow(organizationId: string) {
  const { rows } = await pool.query(
    `SELECT subscription_tier, max_services, max_users, max_deployments_per_month,
            subscription_cancel_at_period_end, xmin::text AS xmin
     FROM organizations WHERE id = $1`,
    [organizationId]
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

/** Bypasses real Stripe signature verification -- no Stripe call is made. */
function stubSignatureVerification(event: any) {
  return jest.spyOn(stripeService, 'verifyWebhookSignature').mockReturnValue(event as any);
}

afterEach(() => {
  jest.restoreAllMocks();
});

afterAll(async () => {
  for (const [envVar, original] of Object.entries(originalPriceEnv)) {
    if (original !== undefined) process.env[envVar] = original;
    else delete process.env[envVar];
  }
  if (createdOrgIds.length > 0) {
    await pool.query('DELETE FROM organizations WHERE id = ANY($1)', [createdOrgIds]);
  }
  await pool.end();
});

describe('customer.subscription.updated -- upgrade reaches entitlement sync', () => {
  it('free -> pro webhook lifecycle raises max_services/max_users/max_deployments_per_month to TIER_LIMITS.pro', async () => {
    const customerId = `cus_test_${uniqueSuffix()}`;
    const orgId = await insertOrg({ tier: 'free', stripeCustomerId: customerId });

    const before = await fetchOrgRow(orgId);
    expect(before.subscription_tier).toBe('free');
    expect(before.max_services).toBe(TIER_LIMITS.free.maxServices);
    expect(before.max_users).toBe(TIER_LIMITS.free.maxUsers);
    expect(before.max_deployments_per_month).toBe(TIER_LIMITS.free.maxDeploymentsPerMonth);

    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: `sub_test_${uniqueSuffix()}`,
      customer: customerId,
      status: 'active',
      items: { data: [{ price: { id: PRO_PRICE_ID } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };

    stubSignatureVerification(fakeEvent('customer.subscription.updated', subscription));
    const { req, res, json, status } = mockWebhookReqRes(fakeEvent('customer.subscription.updated', subscription));

    await stripeController.handleWebhook(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });

    const after = await fetchOrgRow(orgId);
    expect(after.subscription_tier).toBe('pro');
    expect(after.max_services).toBe(TIER_LIMITS.pro.maxServices);
    expect(after.max_users).toBe(TIER_LIMITS.pro.maxUsers);
    expect(after.max_deployments_per_month).toBe(TIER_LIMITS.pro.maxDeploymentsPerMonth);
  });
});

describe('customer.subscription.deleted -- downgrade/cancellation reaches entitlement sync', () => {
  it('pro -> free (cancellation) webhook lifecycle lowers max_services/max_users/max_deployments_per_month to TIER_LIMITS.free', async () => {
    const customerId = `cus_test_${uniqueSuffix()}`;
    const orgId = await insertOrg({ tier: 'pro', stripeCustomerId: customerId });

    const before = await fetchOrgRow(orgId);
    expect(before.subscription_tier).toBe('pro');
    expect(before.max_services).toBe(TIER_LIMITS.pro.maxServices);

    const subscription = {
      id: `sub_test_${uniqueSuffix()}`,
      customer: customerId,
      status: 'canceled',
    };

    const { req, res, json, status } = mockWebhookReqRes(fakeEvent('customer.subscription.deleted', subscription));
    stubSignatureVerification(fakeEvent('customer.subscription.deleted', subscription));

    await stripeController.handleWebhook(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });

    const after = await fetchOrgRow(orgId);
    expect(after.subscription_tier).toBe('free');
    expect(after.max_services).toBe(TIER_LIMITS.free.maxServices);
    expect(after.max_users).toBe(TIER_LIMITS.free.maxUsers);
    expect(after.max_deployments_per_month).toBe(TIER_LIMITS.free.maxDeploymentsPerMonth);
  });
});

describe('checkout.session.completed -- the other lifecycle entry point also reaches entitlement sync', () => {
  it('free -> starter checkout-completion webhook raises entitlements to TIER_LIMITS.starter', async () => {
    const customerId = `cus_test_${uniqueSuffix()}`;
    const orgId = await insertOrg({ tier: 'free', stripeCustomerId: customerId });

    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: subscriptionId,
      customer: customerId,
      status: 'active',
      items: { data: [{ price: { id: STARTER_PRICE_ID } }] },
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };
    // handleCheckoutSessionCompleted fetches the full subscription from
    // Stripe by id -- stub it so no real Stripe call is made.
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(subscription as any);

    const session = {
      metadata: { organizationId: orgId },
      customer: customerId,
      subscription: subscriptionId,
    };

    const { req, res, json, status } = mockWebhookReqRes(fakeEvent('checkout.session.completed', session));
    stubSignatureVerification(fakeEvent('checkout.session.completed', session));

    await stripeController.handleWebhook(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });

    const after = await fetchOrgRow(orgId);
    expect(after.subscription_tier).toBe('starter');
    expect(after.max_services).toBe(TIER_LIMITS.starter.maxServices);
    expect(after.max_users).toBe(TIER_LIMITS.starter.maxUsers);
    expect(after.max_deployments_per_month).toBe(TIER_LIMITS.starter.maxDeploymentsPerMonth);
  });
});

describe('same-tier update -- protection against unnecessary entitlement rewrites', () => {
  it('StripeService.updateOrganizationSubscription() issues no UPDATE at all when the tier is unchanged (proven via xmin, not updated_at)', async () => {
    const orgId = await insertOrg({ tier: 'pro' });

    const before = await fetchOrgRow(orgId);
    expect(before.subscription_tier).toBe('pro');

    // Same tier as already stored, and nothing else supplied -- this is the
    // exact shape a same-tier customer.subscription.updated resolves the
    // tier portion of `data` to.
    // `asOf` is never reached here -- the function returns before touching
    // ordering at all once it determines there's nothing to write (tier
    // unchanged, no other fields supplied); see the early `updates.length
    // === 0` return in updateOrganizationSubscription.
    await stripeService.updateOrganizationSubscription(orgId, { tier: 'pro' }, { asOf: new Date() });

    const after = await fetchOrgRow(orgId);
    // xmin only advances when Postgres actually executes an UPDATE against
    // the row (confirmed manually: even a same-value UPDATE bumps it) --
    // an unchanged xmin proves no SQL UPDATE was issued, not merely that
    // the values happened to come out the same.
    expect(after.xmin).toBe(before.xmin);
    expect(after.subscription_tier).toBe('pro');
    expect(after.max_services).toBe(TIER_LIMITS.pro.maxServices);
    expect(after.max_users).toBe(TIER_LIMITS.pro.maxUsers);
    expect(after.max_deployments_per_month).toBe(TIER_LIMITS.pro.maxDeploymentsPerMonth);
  });

  it('a real same-tier customer.subscription.updated webhook still applies other changed fields (e.g. cancel_at_period_end) while entitlement values remain correct for the unchanged tier', async () => {
    const customerId = `cus_test_${uniqueSuffix()}`;
    const orgId = await insertOrg({ tier: 'pro', stripeCustomerId: customerId, cancelAtPeriodEnd: false });

    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: `sub_test_${uniqueSuffix()}`,
      customer: customerId,
      status: 'active',
      items: { data: [{ price: { id: PRO_PRICE_ID } }] }, // same tier: pro
      current_period_start: nowSec,
      current_period_end: nowSec + 30 * 24 * 60 * 60,
      cancel_at_period_end: true, // genuinely changed field
    };

    const { req, res, json, status } = mockWebhookReqRes(fakeEvent('customer.subscription.updated', subscription));
    stubSignatureVerification(fakeEvent('customer.subscription.updated', subscription));

    await stripeController.handleWebhook(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });

    const after = await fetchOrgRow(orgId);
    expect(after.subscription_cancel_at_period_end).toBe(true);
    expect(after.subscription_tier).toBe('pro');
    expect(after.max_services).toBe(TIER_LIMITS.pro.maxServices);
    expect(after.max_users).toBe(TIER_LIMITS.pro.maxUsers);
    expect(after.max_deployments_per_month).toBe(TIER_LIMITS.pro.maxDeploymentsPerMonth);
  });
});

describe('annual billing cadence gets identical entitlements to monthly for the same tier', () => {
  it('an annual-Price checkout.session.completed webhook raises entitlements to TIER_LIMITS.starter, same as monthly', async () => {
    const customerId = `cus_test_${uniqueSuffix()}`;
    const orgId = await insertOrg({ tier: 'free', stripeCustomerId: customerId });

    const subscriptionId = `sub_test_${uniqueSuffix()}`;
    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: subscriptionId,
      customer: customerId,
      status: 'active',
      items: { data: [{ price: { id: STARTER_ANNUAL_PRICE_ID } }] }, // annual Price, same tier as STARTER_PRICE_ID
      current_period_start: nowSec,
      current_period_end: nowSec + 365 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };
    jest.spyOn(stripeService, 'getSubscription').mockResolvedValue(subscription as any);

    const session = {
      metadata: { organizationId: orgId },
      customer: customerId,
      subscription: subscriptionId,
    };

    const { req, res, json, status } = mockWebhookReqRes(fakeEvent('checkout.session.completed', session));
    stubSignatureVerification(fakeEvent('checkout.session.completed', session));

    await stripeController.handleWebhook(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });

    const after = await fetchOrgRow(orgId);
    expect(after.subscription_tier).toBe('starter');
    // Identical to the monthly starter checkout-completion assertions above --
    // entitlements are derived from TIER_LIMITS[tier] only, never from
    // billing cadence.
    expect(after.max_services).toBe(TIER_LIMITS.starter.maxServices);
    expect(after.max_users).toBe(TIER_LIMITS.starter.maxUsers);
    expect(after.max_deployments_per_month).toBe(TIER_LIMITS.starter.maxDeploymentsPerMonth);
  });

  it('switching an existing subscription from monthly-starter Price to annual-starter Price is a same-tier update: no entitlement rewrite, still safe', async () => {
    const customerId = `cus_test_${uniqueSuffix()}`;
    const orgId = await insertOrg({ tier: 'starter', stripeCustomerId: customerId });

    const before = await fetchOrgRow(orgId);
    expect(before.subscription_tier).toBe('starter');

    const nowSec = Math.floor(Date.now() / 1000);
    const subscription = {
      id: `sub_test_${uniqueSuffix()}`,
      customer: customerId,
      status: 'active',
      items: { data: [{ price: { id: STARTER_ANNUAL_PRICE_ID } }] }, // annual Price, still tier "starter"
      current_period_start: nowSec,
      current_period_end: nowSec + 365 * 24 * 60 * 60,
      cancel_at_period_end: false,
    };

    const { req, res, json, status } = mockWebhookReqRes(fakeEvent('customer.subscription.updated', subscription));
    stubSignatureVerification(fakeEvent('customer.subscription.updated', subscription));

    await stripeController.handleWebhook(req, res);

    expect(status).not.toHaveBeenCalledWith(400);
    expect(json).toHaveBeenCalledWith({ success: true, received: true });

    const after = await fetchOrgRow(orgId);
    expect(after.subscription_tier).toBe('starter');
    expect(after.max_services).toBe(TIER_LIMITS.starter.maxServices);
    expect(after.max_users).toBe(TIER_LIMITS.starter.maxUsers);
    expect(after.max_deployments_per_month).toBe(TIER_LIMITS.starter.maxDeploymentsPerMonth);
  });
});
