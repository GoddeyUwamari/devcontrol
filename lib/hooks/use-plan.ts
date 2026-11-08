import { useAuth } from '@/lib/contexts/auth-context';
import { PLAN_ENTITLEMENTS, type PlanEntitlement } from '@/lib/plan/entitlements';
import type { PaidTier, TierRequiredReason } from '@/lib/plan/tier-required';

type Tier = 'free' | 'starter' | 'pro' | 'enterprise';

/**
 * loading: the organization (and so the plan) isn't established yet.
 * known: it is, with a recognised tier.
 * error: it couldn't be loaded, the user is a member of no workspace
 * (`noWorkspace`), or its tier is missing or unrecognised. Never treated as
 * free.
 */
export type PlanStatus = 'loading' | 'known' | 'error';

const TIER_ORDER: Record<Tier, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };

function isTier(value: unknown): value is Tier {
  return typeof value === 'string' && Object.prototype.hasOwnProperty.call(TIER_ORDER, value);
}

/**
 * The organization's plan. `tier` and the booleans fall back to free while
 * the plan isn't known, as they always have -- so a gated page must also
 * require `isKnown`, and render `status` 'loading' / 'error' itself, never
 * its upgrade gate.
 *
 * `tier`, `canAccess` and the booleans are the stored plan, the one the
 * organization is shown as being on. `hasEntitlement` / `lacksEntitlement`
 * decide the features of lib/plan/entitlements.ts by the tier the server
 * enforces instead (organization.effectiveTier, computed by the server: free
 * while the organization is restricted or its grace period has ended), so the
 * page asks only for what the server will serve and shows the plan notice for
 * what it will refuse. Both are false until the plan is known: loading or an
 * unreadable plan neither grants a feature nor shows its upgrade state. A
 * response without effectiveTier (one from before the field existed) falls
 * back to the stored tier.
 */
export function usePlan() {
  const { organization, organizationStatus, retryOrganizationLoad } = useAuth();
  const tier: Tier = organization?.subscriptionTier ?? 'free';
  const enforcedTier: unknown = organization?.effectiveTier ?? organization?.subscriptionTier;

  const status: PlanStatus =
    organizationStatus === 'ready'
      ? isTier(organization?.subscriptionTier) && isTier(enforcedTier) ? 'known' : 'error'
      : organizationStatus === 'error' || organizationStatus === 'none' ? 'error' : 'loading';

  const isKnown = status === 'known';
  const hold = organization?.entitlementHold;
  /** Whether the enforced tier includes the feature; only asked once the plan is known. */
  const enforcedIncludes = (entitlement: PlanEntitlement) =>
    isTier(enforcedTier) && TIER_ORDER[enforcedTier] >= TIER_ORDER[PLAN_ENTITLEMENTS[entitlement]];

  return {
    tier,
    isFree: tier === 'free',
    isStarter: TIER_ORDER[tier] >= TIER_ORDER.starter,
    isPro: TIER_ORDER[tier] >= TIER_ORDER.pro,
    isEnterprise: tier === 'enterprise',
    canAccess: (minTier: Tier) => TIER_ORDER[tier] >= TIER_ORDER[minTier],
    /** The plan the server enforces is known and includes the feature: request it. */
    hasEntitlement: (entitlement: PlanEntitlement) => isKnown && enforcedIncludes(entitlement),
    /** The plan the server enforces is known and does not include the feature: show the plan notice. */
    lacksEntitlement: (entitlement: PlanEntitlement) => isKnown && !enforcedIncludes(entitlement),
    /**
     * Why the server refuses a feature of `requiredTier` although the stored
     * plan includes it: the organization's billing hold (organization.
     * entitlementHold, decided by the server), only while the enforced tier is
     * below `requiredTier`. Undefined otherwise -- the plan itself is too low,
     * or there is no hold -- so the plan notice is shown, as before.
     */
    holdReasonFor: (requiredTier: PaidTier): TierRequiredReason | undefined => {
      if (!isKnown || (hold !== 'payment' && hold !== 'subscription_inactive')) return undefined;
      if (TIER_ORDER[tier] < TIER_ORDER[requiredTier]) return undefined;
      if (isTier(enforcedTier) && TIER_ORDER[enforcedTier] >= TIER_ORDER[requiredTier]) return undefined;
      return hold === 'payment' ? 'BILLING_RESTRICTED' : 'SUBSCRIPTION_INACTIVE';
    },
    status,
    isKnown,
    retry: retryOrganizationLoad,
    /** A successful response confirmed the user has no workspace (status is 'error'). */
    noWorkspace: organizationStatus === 'none',
  };
}
