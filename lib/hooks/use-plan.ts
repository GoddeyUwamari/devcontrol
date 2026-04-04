import { useAuth } from '@/lib/contexts/auth-context';

type Tier = 'free' | 'starter' | 'pro' | 'enterprise';

const TIER_ORDER: Record<Tier, number> = { free: 0, starter: 1, pro: 2, enterprise: 3 };

export function usePlan() {
  const { organization } = useAuth();
  const tier: Tier = organization?.subscriptionTier ?? 'free';

  return {
    tier,
    isFree: tier === 'free',
    isStarter: TIER_ORDER[tier] >= TIER_ORDER.starter,
    isPro: TIER_ORDER[tier] >= TIER_ORDER.pro,
    isEnterprise: tier === 'enterprise',
    canAccess: (minTier: Tier) => TIER_ORDER[tier] >= TIER_ORDER[minTier],
  };
}
