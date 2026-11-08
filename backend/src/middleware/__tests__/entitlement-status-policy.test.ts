/**
 * Billing safety PR B (B3): the one effective-tier decision, entitlementOf
 * (subscription.middleware.ts), over every Stripe subscription status and
 * every billing lifecycle state, with the 402 reason derived from it.
 *
 * Pure: no database. Expected values are written out, never computed from
 * the code under test. Time is pinned with a Date.now spy for the exact
 * grace boundaries.
 */
import {
  entitlementOf,
  effectiveTierOf,
  tierRequiredReasonOf,
  type EntitlementRow,
} from '../subscription.middleware';

const NOW = Date.UTC(2026, 10, 7, 12, 0, 0);
const HOUR = 3_600_000;
const RECORDED = 'sub_test_policy_recorded';

type Lifecycle = 'healthy' | 'grace running' | 'grace ended' | 'restricted';

function lifecycle(state: Lifecycle): Pick<EntitlementRow, 'billing_lifecycle_state' | 'grace_period_ends_at'> {
  switch (state) {
    case 'healthy':
      return { billing_lifecycle_state: 'healthy', grace_period_ends_at: null };
    case 'grace running':
      return { billing_lifecycle_state: 'grace_period', grace_period_ends_at: new Date(NOW + 48 * HOUR) };
    case 'grace ended':
      return { billing_lifecycle_state: 'grace_period', grace_period_ends_at: new Date(NOW - HOUR) };
    case 'restricted':
      return { billing_lifecycle_state: 'restricted', grace_period_ends_at: new Date(NOW - 72 * HOUR) };
  }
}

function row(over: Partial<EntitlementRow> & { lifecycle?: Lifecycle } = {}): EntitlementRow {
  const { lifecycle: state = 'healthy', ...rest } = over;
  return {
    id: 'org-policy-test',
    subscription_tier: 'pro',
    stripe_subscription_id: RECORDED,
    subscription_status: 'active',
    ...lifecycle(state),
    ...rest,
  };
}

let warn: jest.SpyInstance;
beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(NOW);
  warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

// [status, lifecycle] -> [effective tier, hold], for a stored Pro organization
// with a recorded subscription. Written out from the founder's policy.
const PAY = 'payment';
const INACTIVE = 'subscription_inactive';
const MATRIX: Array<[string | null, Lifecycle, string, string | null]> = [
  ['active', 'healthy', 'pro', null],
  ['active', 'grace running', 'pro', null],
  ['active', 'grace ended', 'free', PAY],
  ['active', 'restricted', 'free', PAY],
  ['trialing', 'healthy', 'pro', null],
  ['trialing', 'grace running', 'pro', null],
  ['trialing', 'grace ended', 'free', PAY],
  ['trialing', 'restricted', 'free', PAY],
  ['past_due', 'healthy', 'pro', null],
  ['past_due', 'grace running', 'pro', null],
  ['past_due', 'grace ended', 'free', PAY],
  ['past_due', 'restricted', 'free', PAY],
  ['unpaid', 'healthy', 'free', PAY],
  ['unpaid', 'grace running', 'pro', null],
  ['unpaid', 'grace ended', 'free', PAY],
  ['unpaid', 'restricted', 'free', PAY],
  ['incomplete', 'healthy', 'free', INACTIVE],
  ['incomplete', 'grace running', 'free', INACTIVE],
  ['incomplete', 'grace ended', 'free', PAY],
  ['incomplete', 'restricted', 'free', PAY],
  ['paused', 'healthy', 'free', INACTIVE],
  ['paused', 'grace running', 'free', INACTIVE],
  ['paused', 'grace ended', 'free', PAY],
  ['paused', 'restricted', 'free', PAY],
  ['canceled', 'healthy', 'free', null],
  ['canceled', 'grace running', 'free', null],
  ['canceled', 'grace ended', 'free', null],
  ['canceled', 'restricted', 'free', null],
  ['incomplete_expired', 'healthy', 'free', null],
  ['incomplete_expired', 'grace running', 'free', null],
  ['incomplete_expired', 'grace ended', 'free', null],
  ['incomplete_expired', 'restricted', 'free', null],
  // Unrecognised on a recorded subscription: the stored tier is kept.
  ['free', 'healthy', 'pro', null],
  ['free', 'grace running', 'pro', null],
  ['free', 'grace ended', 'free', PAY],
  ['free', 'restricted', 'free', PAY],
  [null, 'healthy', 'pro', null],
  [null, 'restricted', 'free', PAY],
  ['some_future_status', 'healthy', 'pro', null],
  ['some_future_status', 'grace running', 'pro', null],
  ['some_future_status', 'grace ended', 'free', PAY],
  ['some_future_status', 'restricted', 'free', PAY],
];

describe('the status matrix (stored Pro, recorded subscription)', () => {
  it.each(MATRIX)('%s, %s: effective %s, hold %s', (status, state, effective, hold) => {
    const decision = entitlementOf(row({ subscription_status: status, lifecycle: state }));
    expect(decision).toEqual({ storedTier: 'pro', effectiveTier: effective, hold });
    expect(effectiveTierOf(row({ subscription_status: status, lifecycle: state }))).toBe(effective);
  });
});

describe('no recorded subscription: the status never lowers the stored tier', () => {
  const STATUSES = ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused', 'canceled', 'incomplete_expired', 'free', null, 'some_future_status'];
  it.each(STATUSES)('%s, healthy: the stored tier', (status) => {
    expect(entitlementOf(row({ stripe_subscription_id: null, subscription_status: status }))).toEqual({
      storedTier: 'pro', effectiveTier: 'pro', hold: null,
    });
    expect(warn).not.toHaveBeenCalled();
  });
  it.each(STATUSES)('%s, restricted: the existing grace still applies (free, payment hold)', (status) => {
    expect(entitlementOf(row({ stripe_subscription_id: null, subscription_status: status, lifecycle: 'restricted' }))).toEqual({
      storedTier: 'pro', effectiveTier: 'free', hold: 'payment',
    });
  });
});

describe('the three hand-provisioned paid organizations (no subscription) keep their stored tier', () => {
  it.each([
    ['enterprise', 'active'],
    ['enterprise', 'free'],
    ['pro', 'free'],
  ])('%s + %s', (tier, status) => {
    expect(entitlementOf({
      id: 'org-hand-provisioned',
      subscription_tier: tier,
      subscription_status: status,
      stripe_subscription_id: null,
      billing_lifecycle_state: 'healthy',
      grace_period_ends_at: null,
    })).toEqual({ storedTier: tier, effectiveTier: tier, hold: null });
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('an unrecognised status on a recorded subscription', () => {
  it('keeps the stored tier and warns once with the organization id and the status string only', () => {
    const decision = entitlementOf(row({ id: 'org-unknown-status', subscription_status: 'some_future_status' }));
    expect(decision).toEqual({ storedTier: 'pro', effectiveTier: 'pro', hold: null });
    expect(warn).toHaveBeenCalledTimes(1);
    const message = String(warn.mock.calls[0][0]);
    expect(message).toContain('org-unknown-status');
    expect(message).toContain('"some_future_status"');
    expect(warn.mock.calls[0]).toHaveLength(1);
    expect(message).not.toContain(RECORDED);
  });

  it('a known status never warns', () => {
    for (const status of ['active', 'trialing', 'past_due', 'unpaid', 'incomplete', 'paused', 'canceled', 'incomplete_expired']) {
      entitlementOf(row({ subscription_status: status }));
    }
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('exact grace boundaries (deadline D; restricted only once D has passed)', () => {
  const D = NOW + 7 * 24 * HOUR;
  const at = (ms: number) => (Date.now as jest.Mock).mockReturnValue(ms);
  const grace = { billing_lifecycle_state: 'grace_period', grace_period_ends_at: new Date(D) };

  it.each(['past_due', 'unpaid'])('%s: paid 1 ms before D and at D, free with the payment hold 1 ms after', (status) => {
    at(D - 1);
    expect(entitlementOf(row({ subscription_status: status, ...grace }))).toMatchObject({ effectiveTier: 'pro', hold: null });
    at(D);
    expect(entitlementOf(row({ subscription_status: status, ...grace }))).toMatchObject({ effectiveTier: 'pro', hold: null });
    at(D + 1);
    expect(entitlementOf(row({ subscription_status: status, ...grace }))).toMatchObject({ effectiveTier: 'free', hold: 'payment' });
  });

  it('unpaid never shortens a running grace: still paid 1 ms before the deadline', () => {
    at(D - 1);
    expect(entitlementOf(row({ subscription_status: 'unpaid', ...grace })).effectiveTier).toBe('pro');
  });

  it('unpaid with no grace running is free at once (no grace is invented)', () => {
    expect(entitlementOf(row({ subscription_status: 'unpaid' }))).toMatchObject({ effectiveTier: 'free', hold: 'payment' });
  });
});

describe('a hold is reported only when it lowers a paid stored tier', () => {
  it.each(['unpaid', 'incomplete', 'paused'])('stored free + %s: free, no hold', (status) => {
    expect(entitlementOf(row({ subscription_tier: 'free', subscription_status: status }))).toEqual({
      storedTier: 'free', effectiveTier: 'free', hold: null,
    });
  });
  it('stored free + restricted: free, no hold', () => {
    expect(entitlementOf(row({ subscription_tier: 'free', lifecycle: 'restricted' })).hold).toBeNull();
  });
  it('stored NULL tier: free, no hold', () => {
    expect(entitlementOf(row({ subscription_tier: null, subscription_status: 'unpaid' }))).toEqual({
      storedTier: 'free', effectiveTier: 'free', hold: null,
    });
  });
});

describe('the 402 reason: only when updating billing would unlock the feature', () => {
  const decide = (over: Partial<EntitlementRow> & { lifecycle?: Lifecycle }) => entitlementOf(row(over));

  it.each([
    // [label, row, required, reason]
    ['Pro restricted, Pro feature', { lifecycle: 'restricted' as Lifecycle }, 'pro', 'BILLING_RESTRICTED'],
    ['Pro unpaid (no grace), Pro feature', { subscription_status: 'unpaid' }, 'pro', 'BILLING_RESTRICTED'],
    ['Pro unpaid (no grace), Cost Control feature', { subscription_status: 'unpaid' }, 'starter', 'BILLING_RESTRICTED'],
    ['Pro incomplete, Pro feature', { subscription_status: 'incomplete' }, 'pro', 'SUBSCRIPTION_INACTIVE'],
    ['Pro paused, Pro feature', { subscription_status: 'paused' }, 'pro', 'SUBSCRIPTION_INACTIVE'],
    ['Pro restricted, Revenue Protection feature (paying would not unlock it)', { lifecycle: 'restricted' as Lifecycle }, 'enterprise', undefined],
    ['Cost Control restricted, Pro feature', { subscription_tier: 'starter', lifecycle: 'restricted' as Lifecycle }, 'pro', undefined],
    ['Pro canceled, Pro feature (a new subscription is needed, not billing)', { subscription_status: 'canceled' }, 'pro', undefined],
    ['Pro incomplete_expired, Pro feature', { subscription_status: 'incomplete_expired' }, 'pro', undefined],
    ['Free, Pro feature', { subscription_tier: 'free' }, 'pro', undefined],
    ['Free unpaid, Pro feature', { subscription_tier: 'free', subscription_status: 'unpaid' }, 'pro', undefined],
    ['Pro active, Pro feature (allowed: no reason)', {}, 'pro', undefined],
  ] as const)('%s', (_label, over, required, reason) => {
    expect(tierRequiredReasonOf(decide(over), required)).toBe(reason);
  });
});
