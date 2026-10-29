'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { MonitorGroup, MonitorState } from './operationalHealthModel'
import { PAGE_COPY } from './operationalHealthCopy'
import { BUTTON, LINK, PILL } from './tones'
import type { Tone } from './operationalHealthModel'

const STATE_TONE: Record<MonitorState, Tone> = {
  monitored: 'success',
  none_found: 'neutral',
  not_measured: 'neutral',
  no_activity: 'neutral',
  couldnt_check: 'warning',
  none_set: 'neutral',
  not_in_plan: 'neutral',
  checking: 'neutral',
  on_plan: 'neutral',
}

/** Every row's state comes from a response (board G); none is inferred from a missing value. */
export function WhatWeMonitor({ groups, planNote, seePlans, onRetryAlarms, onRetrySlo }: {
  groups: MonitorGroup[]
  planNote: boolean
  seePlans: { label: string; href: string }
  onRetryAlarms: () => void
  onRetrySlo: () => void
}) {
  return (
    <section aria-labelledby="health-monitor" className="rounded-xl border border-slate-200 bg-white p-4 sm:px-5">
      <h2 id="health-monitor" className="m-0 text-card-title text-ink">{PAGE_COPY.monitorTitle}</h2>
      {planNote && (
        <p data-testid="health-plan-note" className="m-0 mt-2 text-meta text-ink-body">
          {PAGE_COPY.planNote} <Link href={seePlans.href} className="font-semibold text-ink-accent hover:underline">{seePlans.label} →</Link>
        </p>
      )}
      <div className="mt-3 grid gap-x-6 gap-y-4 [grid-template-columns:repeat(auto-fit,minmax(260px,1fr))]">
        {groups.map((group) => (
          <div key={group.title} className="flex min-w-0 flex-col gap-1">
            <h3 className="m-0 text-label uppercase tracking-[0.04em] text-ink-muted">{group.title}</h3>
            <ul className="m-0 flex list-none flex-col p-0">
              {group.rows.map((row) => (
                <li key={row.key} data-testid={`monitor-${row.key}`} data-state={row.state} className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-b-0">
                  <div className="flex items-start justify-between gap-3">
                    <span className="text-body text-ink">{row.label}</span>
                    <span className={cn('shrink-0 rounded-full border px-2 py-px text-meta font-semibold', PILL[STATE_TONE[row.state]])}>{row.stateText}</span>
                  </div>
                  {row.reason && <span className="text-meta text-ink-muted">{row.reason}</span>}
                  {row.link && <Link href={row.link.href} className={LINK}>{row.link.label}</Link>}
                  {row.retry && (
                    <button type="button" onClick={row.retry === 'slo' ? onRetrySlo : onRetryAlarms} className={cn(BUTTON, 'w-fit')}>{PAGE_COPY.retry}</button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  )
}
