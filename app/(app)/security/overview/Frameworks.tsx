'use client'

import Link from 'next/link'
import { EVALUATION_COPY } from '@/lib/compliance/evaluation'
import type { StartProblem } from '@/lib/compliance/useStartEvaluation'
import { SECURITY_COPY, SEE_PLANS, type FrameworksView } from './securityModel'
import { PAGE_COPY, PAGE_HREF } from './securityCopy'

const LINK = 'inline-flex min-h-11 w-fit items-center text-ui font-semibold text-ink-accent hover:underline'
const ACTION = 'inline-flex min-h-11 w-fit items-center rounded-lg border border-slate-200 bg-white px-3 text-ui font-semibold text-ink-accent hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-ink-muted'

/** The server's member floor on POST /:id/scan (requireMember); a viewer sees the action disabled with the reason. */
export const CAN_START_EVALUATION = ['owner', 'admin', 'member']

const PROBLEM_TEXT: Record<StartProblem, string> = {
  viewer: EVALUATION_COPY.viewerCantStart,
  plan: SECURITY_COPY.frameworksPlan,
  failed: EVALUATION_COPY.startFailed,
}

/**
 * Each framework's state (M5). Out of date and not found show "Re-evaluate now", Failed "Try again", Never evaluated
 * "Evaluate now" (F2c); F3 starts the evaluation in place. A role not read yet fails closed (disabled, no reason);
 * a viewer sees "Viewers can't start an evaluation". A start that didn't happen keeps the state and says why.
 */
export function Frameworks({ view, role, starting, problems, onStart }: {
  view: FrameworksView
  role: string | null
  starting: ReadonlySet<string>
  problems: Readonly<Record<string, StartProblem>>
  onStart: (frameworkId: string) => void
}) {
  const canStart = role !== null && CAN_START_EVALUATION.includes(role)
  const roleReason = role !== null && !canStart ? EVALUATION_COPY.viewerCantStart : null
  return (
    <section aria-labelledby="security-frameworks-heading" aria-busy={view.status === 'loading' || undefined} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex items-center justify-between gap-3">
        <h2 id="security-frameworks-heading" className="m-0 text-section text-ink">{PAGE_COPY.frameworksHeading}</h2>
        <Link href={PAGE_HREF.frameworks} className={LINK}>{PAGE_COPY.manage}</Link>
      </div>
      {view.note && <p className="m-0 text-body text-ink-body">{view.note}</p>}
      {view.action && <Link href={view.action.href} className={LINK}>{view.action.label}</Link>}
      {view.status === 'ready' && view.frameworks.length === 0 && <p className="m-0 text-body text-ink-body">{SECURITY_COPY.noFrameworks}</p>}
      {view.frameworks.length > 0 && (
        <ul className="m-0 flex list-none flex-col gap-3 p-0">
          {view.frameworks.map((f) => {
            const problem = problems[f.id]
            const reason = roleReason ?? (problem ? PROBLEM_TEXT[problem] : null)
            const reasonId = `security-framework-reason-${f.id}`
            const busy = starting.has(f.id)
            return (
              <li key={f.id} data-testid="security-framework" data-state={f.state} className="flex flex-col gap-1 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                  <span className="text-ui font-semibold text-ink">{f.name}</span>
                  <span className="text-meta text-ink-muted">{f.label}</span>
                </div>
                <p className="m-0 text-meta text-ink-body">{f.text}</p>
                {f.scoreNote && <p className="m-0 text-meta text-ink-muted">{f.scoreNote}</p>}
                {f.action && (
                  <button
                    type="button"
                    onClick={() => onStart(f.id)}
                    disabled={!canStart || busy}
                    aria-busy={busy || undefined}
                    aria-describedby={reason ? reasonId : undefined}
                    className={ACTION}
                  >
                    {f.action.label}
                  </button>
                )}
                {f.action && reason && (
                  <p id={reasonId} role={problem && !roleReason ? 'alert' : undefined} className="m-0 text-meta text-ink-muted">{reason}</p>
                )}
                {f.action && !roleReason && problem === 'plan' && <Link href={SEE_PLANS.href} className={LINK}>{SEE_PLANS.label}</Link>}
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
