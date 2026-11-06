import { Lock } from 'lucide-react'
import { planRequiredText, SEE_PLANS, type PaidTier } from '@/lib/plan/tier-required'

/**
 * The TIER_REQUIRED state for one part of a page: the same sentence and link
 * the plan-gated pages show when the server answers TIER_REQUIRED
 * (lib/plan/tier-required.ts), shown in place of a feature the plan does not
 * include so that the page never asks the server for it.
 */
export function PlanRequiredNotice({
  requiredTier,
  testId = 'plan-required',
  className = '',
}: {
  requiredTier: PaidTier
  testId?: string
  className?: string
}) {
  return (
    <div data-testid={testId} className={`flex flex-col items-start gap-1.5 ${className}`}>
      <p className="m-0 flex items-center gap-1.5 text-ui text-ink-body">
        <Lock size={13} className="text-violet-600 shrink-0" aria-hidden="true" />
        {planRequiredText({ requiredTier })}
      </p>
      <a href={SEE_PLANS.href} className="text-label font-semibold text-violet-600 no-underline hover:underline">
        {SEE_PLANS.label}
      </a>
    </div>
  )
}
