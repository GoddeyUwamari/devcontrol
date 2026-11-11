/**
 * Customer-facing names of the plans, as on the pricing page
 * (app/(marketing)/pricing/page.tsx). Internal tier ids must not reach
 * the UI.
 */
export type PaidTier = 'starter' | 'pro' | 'enterprise'
export type Tier = 'free' | PaidTier

export const PLAN_DISPLAY_NAME: Readonly<Record<PaidTier, string>> = {
  starter: 'Cost Control',
  pro: 'Optimization Engine',
  enterprise: 'Revenue Protection',
}

/** Every plan's customer-facing name, the free plan included. */
export const PLAN_NAME: Readonly<Record<Tier, string>> = {
  free: 'Visibility',
  ...PLAN_DISPLAY_NAME,
}

/** The customer-facing name for any stored tier; an unknown tier reads as the free plan. */
export function planName(tier: string | null | undefined): string {
  return tier && Object.prototype.hasOwnProperty.call(PLAN_NAME, tier)
    ? PLAN_NAME[tier as Tier]
    : PLAN_NAME.free
}
