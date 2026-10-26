'use client'

import Link from 'next/link'
import { SECURITY_COPY, type FrameworksView } from './securityModel'
import { PAGE_COPY, PAGE_HREF } from './securityCopy'

const LINK = 'inline-flex min-h-11 w-fit items-center text-ui font-semibold text-ink-accent hover:underline'

/**
 * Each framework's state (M5). In F2 every action ("Evaluate now", "Re-evaluate now", "Try again") is a link
 * to /compliance/frameworks; running an evaluation from here comes later (founder decision 4).
 */
export function Frameworks({ view }: { view: FrameworksView }) {
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
          {view.frameworks.map((f) => (
            <li key={f.id} data-testid="security-framework" data-state={f.state} className="flex flex-col gap-1 border-t border-slate-100 pt-3 first:border-t-0 first:pt-0">
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-ui font-semibold text-ink">{f.name}</span>
                <span className="text-meta text-ink-muted">{f.label}</span>
              </div>
              <p className="m-0 text-meta text-ink-body">{f.text}</p>
              {f.action && <Link href={PAGE_HREF.frameworks} className={LINK}>{f.action.label}</Link>}
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
