'use client'

import Link from 'next/link'
import { cn } from '@/lib/utils'
import type { MonitorGroup, MonitorState } from './operationalHealthModel'
import { MONITOR_COLUMNS, PAGE_COPY } from './operationalHealthCopy'
import { BUTTON, LINK } from './tones'

/**
 * The chip's look: green "checked now", grey "checked, but you have none", a dashed outline for "not checked yet",
 * amber for "couldn't check", and a solid grey outline with slate text for "Needs AWS" (nothing to check until AWS
 * is connected; distinct from the dashed "Not measured yet").
 */
export type ChipKind = 'monitored' | 'none' | 'not_measured' | 'warning' | 'needs_aws'

const CHIP: Record<ChipKind, string> = {
  monitored: 'border-green-200 bg-green-50 text-ink-success-strong',
  none: 'border-slate-200 bg-slate-50 text-ink-muted',
  not_measured: 'border-dashed border-slate-400 bg-white text-ink-muted',
  warning: 'border-amber-200 bg-amber-50 text-ink-warning-strong',
  needs_aws: 'border-slate-400 bg-white text-slate-700',
}

/** Each state keeps its meaning (and its text from the model); only the chip's look is chosen here. */
export const STATE_CHIP: Record<MonitorState, ChipKind> = {
  monitored: 'monitored',
  none_found: 'none',
  not_measured: 'not_measured',
  no_activity: 'none',
  couldnt_check: 'warning',
  needs_aws: 'needs_aws',
  none_set: 'none',
  not_in_plan: 'none',
  checking: 'none',
  on_plan: 'none',
}

function Chip({ kind, children }: { kind: ChipKind; children: React.ReactNode }) {
  return (
    <span data-testid="monitor-chip" data-chip={kind} className={cn('inline-flex w-fit max-w-full shrink-0 rounded-full border px-2 py-px text-meta font-semibold', CHIP[kind])}>
      {children}
    </span>
  )
}

/** Every row's state comes from a response (board G); none is inferred from a missing value. */
export function WhatWeMonitor({ groups, planNote, seePlans, onRetryAlarms, onRetrySlo, notConnected = false }: {
  groups: MonitorGroup[]
  planNote: boolean
  /** No AWS account (PR3): a "Needs AWS" legend entry, no plan note and no "See plans" link; the rows and their plan chips stay. */
  notConnected?: boolean
  seePlans: { label: string; href: string }
  onRetryAlarms: () => void
  onRetrySlo: () => void
}) {
  // Every group lands in a column; one the column list doesn't name goes to the end of the last column.
  const placed = new Set(MONITOR_COLUMNS.flat())
  const columns = MONITOR_COLUMNS.map((titles, i) => [
    ...titles.map((title) => groups.find((g) => g.title === title)).filter((g): g is MonitorGroup => Boolean(g)),
    ...(i === MONITOR_COLUMNS.length - 1 ? groups.filter((g) => !placed.has(g.title)) : []),
  ])
  return (
    <section aria-labelledby="health-monitor" className="rounded-xl border border-slate-200 bg-white p-4 sm:px-5">
      <h2 id="health-monitor" className="m-0 text-card-title text-ink">{PAGE_COPY.monitorTitle}</h2>
      <p data-testid="health-monitor-intro" className="m-0 mt-1 text-body text-ink-body">{PAGE_COPY.monitorIntro}</p>
      <ul data-testid="health-monitor-legend" aria-label={PAGE_COPY.monitorLegendLabel} className="m-0 mt-3 flex list-none flex-wrap gap-x-5 gap-y-2 p-0">
        {[...PAGE_COPY.monitorLegend, ...(notConnected ? [PAGE_COPY.monitorLegendNeedsAws] : [])].map((item) => (
          <li key={item.kind} className="flex flex-wrap items-center gap-2 text-meta text-ink-muted">
            <Chip kind={item.kind}>{item.chip}</Chip>
            <span>{item.meaning}</span>
          </li>
        ))}
      </ul>
      {planNote && !notConnected && (
        <p data-testid="health-plan-note" className="m-0 mt-3 text-meta text-ink-body">
          {PAGE_COPY.planNote} <Link href={seePlans.href} className="font-semibold text-ink-accent hover:underline">{seePlans.label} →</Link>
        </p>
      )}
      <div data-testid="health-monitor-columns" className="mt-4 grid grid-cols-1 gap-x-8 gap-y-4 lg:grid-cols-2">
        {columns.map((column, i) => (
          <div key={i} data-testid={`health-monitor-column-${i + 1}`} className="flex min-w-0 flex-col gap-4">
            {column.map((group) => (
              <div key={group.title} className="flex min-w-0 flex-col gap-1">
                <h3 className="m-0 text-label uppercase tracking-[0.04em] text-ink-muted">{group.title}</h3>
                <ul className="m-0 flex list-none flex-col p-0">
                  {group.rows.map((row) => (
                    <li key={row.key} data-testid={`monitor-${row.key}`} data-state={row.state} className="flex flex-col gap-0.5 border-b border-slate-100 py-2 last:border-b-0">
                      <div className="flex flex-col items-start gap-1 sm:flex-row sm:justify-between sm:gap-3">
                        <span data-testid="monitor-label" className="min-w-0 text-body text-ink">
                          <span className="font-semibold">{row.service}</span>
                          {row.signals && <span className="text-ink-muted"> · {row.signals}</span>}
                        </span>
                        <Chip kind={STATE_CHIP[row.state]}>{row.stateText}</Chip>
                      </div>
                      {row.reason && <span className="text-meta text-ink-muted">{row.reason}</span>}
                      {row.link && !(notConnected && row.state === 'on_plan') && <Link href={row.link.href} className={LINK}>{row.link.label}</Link>}
                      {row.retry && (
                        <button type="button" onClick={row.retry === 'slo' ? onRetrySlo : onRetryAlarms} className={cn(BUTTON, 'w-fit')}>{PAGE_COPY.retry}</button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  )
}
