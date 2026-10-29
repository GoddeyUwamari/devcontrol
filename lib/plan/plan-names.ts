/**
 * Customer-facing names of the paid plans, as on the pricing page
 * (app/(marketing)/pricing/page.tsx). Internal tier ids must not reach
 * the UI.
 */
export type PaidTier = 'starter' | 'pro' | 'enterprise'

export const PLAN_DISPLAY_NAME: Readonly<Record<PaidTier, string>> = {
  starter: 'Cost Control',
  pro: 'Optimization Engine',
  enterprise: 'Revenue Protection',
}
