'use client'

import { RefreshCw } from 'lucide-react'
import { PAGE_SUBTITLE_CLASS, PAGE_TITLE_CLASS } from '@/components/ui/typography'
import { cn } from '@/lib/utils'
import type { MonitoringRange } from './observabilityTypes'
import type { HeaderView } from './operationalHealthModel'
import { PAGE_COPY, RANGES, cloudWatchHref, rangeLabel } from './operationalHealthCopy'
import { BUTTON, DOT, PILL } from './tones'

/**
 * The page's own range control (tidy mock). The shared TimeRangeSelector also serves the legacy
 * monitoring page, so it stays as it is. On a phone it is a 3-per-row grid of 44 px buttons reading
 * "Last 5m" … "Last 7d"; from md it is one 40 px row, the same height as Refresh and the console link,
 * reading "Last 5m · 15m · … · 7d" (one "Last", then the ranges) so row 1 fits on one line. Each
 * button's accessible name stays "Last <range>" at every width.
 */
function RangeControl({ selected, onChange }: { selected: MonitoringRange; onChange: (range: MonitoringRange) => void }) {
  return (
    <div
      role="group"
      aria-label={PAGE_COPY.rangeGroup}
      data-testid="health-range"
      className="grid grid-cols-3 gap-1 rounded-lg border border-slate-300 bg-white p-1 md:flex md:h-10 md:flex-nowrap md:items-stretch md:gap-0.5"
    >
      <span aria-hidden="true" data-testid="health-range-lead" className="hidden items-center pl-2 pr-1 text-ui text-ink-muted md:flex">{PAGE_COPY.rangeLead}</span>
      {RANGES.map((range) => (
        <button
          key={range}
          type="button"
          aria-pressed={range === selected}
          aria-label={rangeLabel(range)}
          onClick={() => onChange(range)}
          className={cn(
            'min-h-11 whitespace-nowrap rounded-md px-2.5 text-ui font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-violet-600 md:min-h-0 md:px-2',
            range === selected ? 'bg-violet-600 text-white' : 'text-ink-body hover:bg-slate-100'
          )}
        >
          <span className="md:hidden">{PAGE_COPY.rangeLead} </span>
          {range}
        </button>
      ))}
    </div>
  )
}

/**
 * Title on its own line. Row 1: the description left and one row of controls right (range, Refresh, the
 * console link), never wrapping. Row 2: connection and last successful check left, the range note right.
 * Below xl the description sits above the controls; on a phone the controls stack (range grid, then
 * Refresh and the console link on one row).
 */
export function HealthHeader({ view, range, onRange, onRefresh, busy }: {
  view: HeaderView
  range: MonitoringRange
  onRange: (range: MonitoringRange) => void
  onRefresh: () => void
  busy: boolean
}) {
  return (
    <header data-testid="health-header" className="flex flex-col gap-3">
      <h1 className={cn(PAGE_TITLE_CLASS, 'm-0')}>{PAGE_COPY.title}</h1>
      <div data-testid="health-header-row1" className="flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between xl:gap-4">
        <p className={cn(PAGE_SUBTITLE_CLASS, 'm-0 min-w-0')}>{PAGE_COPY.subtitle}</p>
        <div data-testid="health-controls" className="flex flex-col gap-2 md:flex-row md:flex-nowrap md:items-center xl:shrink-0">
          <RangeControl selected={range} onChange={onRange} />
          <div className="flex flex-nowrap items-center gap-2">
            <button type="button" onClick={onRefresh} disabled={busy} aria-label={PAGE_COPY.refresh} className={cn(BUTTON, 'min-h-11 w-11 shrink-0 px-0 md:min-h-10 md:w-10')}>
              <RefreshCw className={cn('size-4', busy && 'animate-spin')} aria-hidden="true" />
            </button>
            {view.region && (
              <a href={cloudWatchHref(view.region)} target="_blank" rel="noopener noreferrer" className={cn(BUTTON, 'min-h-11 flex-1 whitespace-nowrap md:min-h-10 md:flex-none')}>
                {PAGE_COPY.openCloudWatch}
              </a>
            )}
          </div>
        </div>
      </div>
      <div data-testid="health-header-row2" className="flex flex-col gap-1 lg:flex-row lg:items-center lg:justify-between lg:gap-6">
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-meta text-ink-body lg:shrink-0">
          {view.pill && (
            <span data-testid="health-pill" data-tone={view.pill.tone} className={cn('inline-flex items-center gap-1.5 rounded-full border px-2 py-px font-semibold', PILL[view.pill.tone])}>
              <span aria-hidden="true" className={cn('inline-block size-1.5 rounded-full', DOT[view.pill.tone])} />
              {view.pill.text}
            </span>
          )}
          {view.lastCheck && <span data-testid="health-last-check">{view.lastCheck}</span>}
          {view.incomplete && <span data-testid="health-incomplete">The latest check was incomplete.</span>}
        </div>
        <p data-testid="health-range-note" className="m-0 min-w-0 text-meta text-ink-muted lg:text-right">{PAGE_COPY.rangeNote}</p>
      </div>
    </header>
  )
}
