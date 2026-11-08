import { Lock } from 'lucide-react'
import type { PaidTier } from '@/lib/plan/tier-required'
import { usePlan } from '@/lib/hooks/use-plan'
import { usePlanNotice } from '@/lib/plan/use-plan-notice'

/**
 * The TIER_REQUIRED state for one part of a page: the same sentence and link
 * the plan-gated pages show when the server answers TIER_REQUIRED
 * (lib/plan/tier-required.ts planNoticeOf), shown in place of a feature the
 * plan does not include so that the page never asks the server for it. When
 * the organization's own plan includes the feature and a billing hold is why
 * it is withheld (usePlan holdReasonFor), the billing sentence instead, with
 * Go to billing for an owner or admin and the ask-an-admin sentence for
 * everyone else.
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
  const plan = usePlan()
  const reason = plan.holdReasonFor(requiredTier)
  const notice = usePlanNotice(reason ? { requiredTier, reason } : { requiredTier })
  if (!notice) return null
  return (
    <div data-testid={testId} className={`flex flex-col items-start gap-1.5 ${className}`}>
      <p className="m-0 flex items-center gap-1.5 text-ui text-ink-body">
        <Lock size={13} className="text-violet-600 shrink-0" aria-hidden="true" />
        {notice.text}
      </p>
      {notice.link && (
        <a href={notice.link.href} className="text-label font-semibold text-violet-600 no-underline hover:underline">
          {notice.link.label}
        </a>
      )}
      {notice.note && <p className="m-0 text-label text-ink-body">{notice.note}</p>}
    </div>
  )
}
