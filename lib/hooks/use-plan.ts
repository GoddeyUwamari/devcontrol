import { useAuth } from '@/lib/contexts/auth-context';

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
 */
export function usePlan() {
  const { organization, organizationStatus, retryOrganizationLoad } = useAuth();
  const tier: Tier = organization?.subscriptionTier ?? 'free';

  const status: PlanStatus =
    organizationStatus === 'ready'
      ? isTier(organization?.subscriptionTier) ? 'known' : 'error'
      : organizationStatus === 'error' || organizationStatus === 'none' ? 'error' : 'loading';

  return {
    tier,
    isFree: tier === 'free',
    isStarter: TIER_ORDER[tier] >= TIER_ORDER.starter,
    isPro: TIER_ORDER[tier] >= TIER_ORDER.pro,
    isEnterprise: tier === 'enterprise',
    canAccess: (minTier: Tier) => TIER_ORDER[tier] >= TIER_ORDER[minTier],
    status,
    isKnown: status === 'known',
    retry: retryOrganizationLoad,
    /** A successful response confirmed the user has no workspace (status is 'error'). */
    noWorkspace: organizationStatus === 'none',
  };
}
