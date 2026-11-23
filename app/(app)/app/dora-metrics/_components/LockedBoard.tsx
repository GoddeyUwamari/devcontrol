import Link from 'next/link'
import { PlanLabel } from '@/components/plan/plan-label'
import { SEE_PLANS } from '@/lib/plan/tier-required'
import { PLAN_DISPLAY_NAME } from '@/lib/plan/plan-names'
import { PLAN_ENTITLEMENTS } from '@/lib/plan/entitlements'
import { COPY } from '../_lib/dora-page'

/**
 * The page below the DORA metrics plan (PR3): what Engineering Intelligence measures, in words. No figure,
 * level or chart, and nothing is requested. Each plan name is the entitlement's own (PLAN_ENTITLEMENTS),
 * so a plan move updates the board. A billing hold on a plan that includes it shows PlanRequiredNotice instead.
 */
export function LockedBoard() {
  const plan = PLAN_DISPLAY_NAME[PLAN_ENTITLEMENTS.doraMetrics]
  return (
    <section aria-labelledby="dora-board-title" data-testid="dora-locked-board" className="bg-white border border-slate-200 rounded-xl p-4 sm:p-6 flex flex-col gap-5 min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <h2 id="dora-board-title" className="m-0 text-card-title text-ink">{COPY.boardTitle}</h2>
        <PlanLabel testId="dora-board-plan">{plan}</PlanLabel>
      </div>
      <ul className="m-0 p-0 list-none grid grid-cols-1 sm:grid-cols-2 gap-3">
        {COPY.boardItems.map((item) => (
          <li key={item.name} data-testid="dora-board-item" className="flex flex-col gap-1 rounded-lg border border-slate-200 px-4 py-3.5 min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h3 className="m-0 text-ui font-semibold text-ink">{item.name}</h3>
              {item.ownPlan && <PlanLabel testId="dora-board-item-plan">{PLAN_DISPLAY_NAME[PLAN_ENTITLEMENTS.doraCustomBenchmarks]}</PlanLabel>}
            </div>
            <p className="m-0 text-meta text-ink-muted">{item.text}</p>
          </li>
        ))}
      </ul>
      <p className="m-0 text-body text-ink-body">{COPY.boardSource}</p>
      <div data-testid="dora-board-footer" className="flex flex-col gap-1 border-t border-slate-100 pt-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4">
        <p className="m-0 text-ui text-ink-body">{COPY.boardFooter(plan)}</p>
        <Link href={SEE_PLANS.href} className="inline-flex min-h-11 items-center self-start text-ui font-semibold text-ink-accent no-underline hover:underline sm:min-h-0 sm:self-auto">
          {SEE_PLANS.label} →
        </Link>
      </div>
    </section>
  )
}
