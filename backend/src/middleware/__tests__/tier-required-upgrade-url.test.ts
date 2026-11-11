/**
 * requireTier's 402: upgrade.url names the plan the route requires (not the
 * plan after the organization's current one). Everything else in the body is
 * as before: currentTier is the effective tier (free while billing is
 * restricted or the grace period has ended), nextTier and cta still describe
 * the plan after the current one, and an unrecognised stored tier still fails
 * closed with 500.
 *
 * The organization row is the only input, served by a stubbed pool.
 */
import { Request, Response } from 'express';

const query = jest.fn();
jest.mock('../../config/database', () => ({ pool: { query: (...args: unknown[]) => query(...args) } }));

import { requireTier, SubscriptionTier } from '../subscription.middleware';
import { PLAN_NAME } from '../../config/plan-names';

const ORG = '00000000-0000-4000-8000-00000000000a';
const HOUR = 60 * 60 * 1000;

interface Row {
  subscription_tier: string;
  billing_lifecycle_state?: string | null;
  grace_period_ends_at?: Date | null;
}

async function gate(row: Row, minimum: SubscriptionTier) {
  query.mockResolvedValueOnce({
    rows: [{ billing_lifecycle_state: 'healthy', grace_period_ends_at: null, ...row }],
  });
  const res: any = { statusCode: 200, body: undefined };
  res.status = jest.fn((code: number) => ((res.statusCode = code), res));
  res.json = jest.fn((body: unknown) => ((res.body = body), res));
  const next = jest.fn();
  await requireTier(minimum)({ user: { userId: 'u' }, organizationId: ORG } as unknown as Request, res as Response, next);
  return { status: res.statusCode, body: res.body, passed: next.mock.calls.length === 1 };
}

beforeEach(() => {
  query.mockReset();
  jest.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe('upgrade.cta names the next plan with the customer-facing names', () => {
  it.each([
    ['free', 'enterprise', 'Upgrade to Cost Control for more resources and team members.'],
    ['starter', 'enterprise', 'Upgrade to Optimization Engine for AI features, forecasting and DORA metrics.'],
    ['pro', 'enterprise', 'Upgrade to Revenue Protection for unlimited resources, SAML/SSO and a named support contact.'],
  ] as const)('%s org below %s: %s', async (current, minimum, cta) => {
    const { body } = await gate({ subscription_tier: current }, minimum);
    expect(body.upgrade.cta).toBe(cta);
    expect(body.upgrade.cta).not.toMatch(/dedicated account manager|SLA|API access|\b(Starter|Pro|Enterprise)\b/);
  });
});

describe('upgrade.url names the required plan', () => {
  it.each([
    ['free', 'starter', 'starter'],
    ['free', 'pro', 'starter'],
    ['free', 'enterprise', 'starter'],
    ['starter', 'pro', 'pro'],
    ['starter', 'enterprise', 'pro'],
    ['pro', 'enterprise', 'enterprise'],
  ] as const)('%s organization on a %s route (nextTier stays %s)', async (current, minimum, nextTier) => {
    const result = await gate({ subscription_tier: current }, minimum);

    expect(result.status).toBe(402);
    expect(result.passed).toBe(false);
    expect(result.body).toEqual({
      success: false,
      error: 'Subscription tier insufficient',
      code: 'TIER_REQUIRED',
      details: {
        currentTier: current,
        requiredTier: minimum,
        message: `This feature is on the ${PLAN_NAME[minimum as keyof typeof PLAN_NAME]} plan.`,
      },
      upgrade: {
        cta: expect.any(String),
        url: `/settings/billing?upgrade=${minimum}`,
        nextTier,
      },
    });
  });
});

describe('billing restrictions', () => {
  it('a restricted Pro organization on a Pro route: currentTier free, link to Pro', async () => {
    const result = await gate({ subscription_tier: 'pro', billing_lifecycle_state: 'restricted' }, 'pro');

    expect(result.status).toBe(402);
    expect(result.body.details.currentTier).toBe('free');
    expect(result.body.upgrade.url).toBe('/settings/billing?upgrade=pro');
  });

  it('an Enterprise organization whose grace period ended: currentTier free, link to Enterprise', async () => {
    const result = await gate(
      { subscription_tier: 'enterprise', billing_lifecycle_state: 'grace_period', grace_period_ends_at: new Date(Date.now() - HOUR) },
      'enterprise'
    );

    expect(result.status).toBe(402);
    expect(result.body.details.currentTier).toBe('free');
    expect(result.body.upgrade.url).toBe('/settings/billing?upgrade=enterprise');
  });

  it('a grace period still running passes', async () => {
    const result = await gate(
      { subscription_tier: 'enterprise', billing_lifecycle_state: 'grace_period', grace_period_ends_at: new Date(Date.now() + HOUR) },
      'enterprise'
    );

    expect(result.passed).toBe(true);
  });
});

describe('unchanged', () => {
  it('a plan that meets the requirement passes', async () => {
    expect((await gate({ subscription_tier: 'enterprise' }, 'pro')).passed).toBe(true);
  });

  it('an unrecognised stored tier fails closed with 500', async () => {
    const result = await gate({ subscription_tier: 'team' }, 'pro');

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ success: false, error: 'Failed to verify subscription tier' });
    expect(result.passed).toBe(false);
  });
});
