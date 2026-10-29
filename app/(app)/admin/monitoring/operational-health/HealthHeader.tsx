'use client'

import { RefreshCw } from 'lucide-react'
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { TimeRangeSelector } from '@/components/monitoring/TimeRangeSelector'
import { cn } from '@/lib/utils'
import type { MonitoringRange } from './observabilityTypes'
import type { HeaderView } from './operationalHealthModel'
import { PAGE_COPY, cloudWatchHref } from './operationalHealthCopy'
import { BUTTON, DOT, PILL } from './tones'

/** Title, connection pill and last successful check left; range, Refresh and the console link right. */
export function HealthHeader({ view, range, onRange, onRefresh, busy }: {
  view: HeaderView
  range: MonitoringRange
  onRange: (range: MonitoringRange) => void
  onRefresh: () => void
  busy: boolean
}) {
  return (
    <header className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
      <div className="flex min-w-0 flex-col gap-1">
        <h1 className={cn(PAGE_TITLE_CLASS, 'm-0')}>{PAGE_COPY.title}</h1>
        <p className={cn(PAGE_SUBTITLE_CLASS, 'm-0')}>{PAGE_COPY.subtitle}</p>
        {(view.pill || view.lastCheck) && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-body">
            {view.pill && (
              <span data-testid="health-pill" data-tone={view.pill.tone} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-px font-semibold', PILL[view.pill.tone])}>
                <span aria-hidden="true" className={cn('inline-block size-1.5 rounded-full', DOT[view.pill.tone])} />
                {view.pill.text}
              </span>
            )}
            {view.lastCheck && <span data-testid="health-last-check">{view.lastCheck}</span>}
            {view.incomplete && <span data-testid="health-incomplete">The latest check was incomplete.</span>}
          </div>
        )}
      </div>
      <div className="flex flex-col gap-2 lg:items-end">
        <div className="flex flex-wrap items-center gap-2">
          <TimeRangeSelector selected={range} onChange={(value) => onRange(value as MonitoringRange)} />
          <button type="button" onClick={onRefresh} disabled={busy} aria-label={PAGE_COPY.refresh} className={cn(BUTTON, 'w-10 px-0')}>
            <RefreshCw className={cn('size-4', busy && 'animate-spin')} aria-hidden="true" />
          </button>
          {view.region && (
            <a href={cloudWatchHref(view.region)} target="_blank" rel="noopener noreferrer" className={BUTTON}>
              {PAGE_COPY.openCloudWatch}
            </a>
          )}
        </div>
        <p className="m-0 text-meta text-ink-muted">{PAGE_COPY.rangeNote}</p>
      </div>
    </header>
  )
}
