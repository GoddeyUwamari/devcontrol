import { usePlan } from '@/lib/hooks/use-plan'
import { useCurrentRole } from '@/lib/hooks/use-current-role'
import { canManageBillingRole, planNoticeOf, type PlanNotice, type TierRequired } from './tier-required'

/**
 * The notice for a TIER_REQUIRED refusal (planNoticeOf), with the
 * organization's stored plan and whether the user is an owner or admin.
 * Until the role is read, the user is treated as not an admin (no billing
 * link), as on the billing page. Null when there is no refusal.
 */
export function usePlanNotice(tierRequired: TierRequired | null): PlanNotice | null {
  const plan = usePlan()
  const canManageBilling = canManageBillingRole(useCurrentRole())
  return tierRequired ? planNoticeOf(tierRequired, { planTier: plan.tier, canManageBilling }) : null
}
