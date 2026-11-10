/**
 * Trial PR: where a plan comes from, and whether "Upgrade Plan" is offered
 * (never on the top plan, never for a plan our team manages). Pure.
 */
import { entitlementFields, planSourceOf, upgradeAvailableOf, TOP_TIER } from '../subscription.middleware';

const row = (subscription_tier: string | null, stripe_subscription_id: string | null, subscription_status: string | null = 'active') => ({
  id: 'org-plan-source',
  subscription_tier,
  stripe_subscription_id,
  subscription_status,
  billing_lifecycle_state: 'healthy',
  grace_period_ends_at: null,
});

describe('planSourceOf / upgradeAvailableOf', () => {
  it('the top plan is Revenue Protection', () => {
    expect(TOP_TIER).toBe('enterprise');
  });

  it.each([
    // tier, subscription, source, upgrade offered
    ['free', null, 'none', true],
    [null, null, 'none', true],
    ['starter', null, 'managed', false],
    ['pro', null, 'managed', false],
    ['enterprise', null, 'managed', false],
    ['starter', 'sub_test_a', 'subscription', true],
    ['pro', 'sub_test_b', 'subscription', true],
    ['enterprise', 'sub_test_c', 'subscription', false],
    ['free', 'sub_test_d', 'subscription', true],
  ] as const)('stored %s, subscription %s: %s, upgrade %s', (tier, subscription, source, upgrade) => {
    expect(planSourceOf(row(tier, subscription))).toBe(source);
    expect(upgradeAvailableOf(row(tier, subscription))).toBe(upgrade);
  });

  it('organization responses carry upgradeAvailable next to the entitlement', () => {
    expect(entitlementFields(row('enterprise', null))).toEqual({ effectiveTier: 'enterprise', entitlementHold: null, upgradeAvailable: false });
    expect(entitlementFields(row('free', null, 'free'))).toEqual({ effectiveTier: 'free', entitlementHold: null, upgradeAvailable: true });
  });
});
