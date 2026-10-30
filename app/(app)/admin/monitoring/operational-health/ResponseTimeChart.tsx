'use client'

import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Num } from '@/components/ui/typography'
import { CHART_TICK, CHART_TOOLTIP } from '@/lib/chart-theme'
import type { ChartDatum, ResponseTimeView } from './responseTimeModel'
import { periodLabel, tickLabel } from './responseTimeModel'
import { RESPONSE_TIME_COPY } from './operationalHealthCopy'

/**
 * The line breaks at every gap (connectNulls off, a null per missing period) and is
 * straight between samples (no smoothing that would invent a shape between them).
 * Shared so the page test can check the props the line is drawn with.
 */
export const RESPONSE_TIME_LINE = { type: 'linear', connectNulls: false, isAnimationActive: false } as const

const LINE_COLOR = '#6D28D9'

/** A dot only where a value has no neighbour, since no line can be drawn through it. */
function IsolatedDot(props: { cx?: number; cy?: number; index?: number; payload?: ChartDatum }) {
  if (!props.payload?.isolated || props.cx === undefined || props.cy === undefined) return <g key={props.index} />
  return <circle key={props.index} cx={props.cx} cy={props.cy} r={3} fill={LINE_COLOR} />
}

/** Board D: shown under Resource checks only when a load balancer has data; never an empty chart. */
export function ResponseTimeChart({ view }: { view: ResponseTimeView | null }) {
  if (!view) return null
  return (
    <section
      aria-labelledby="lb-response-time-heading"
      data-testid="lb-response-time"
      className="flex min-w-0 flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-6"
    >
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 id="lb-response-time-heading" className="m-0 text-section text-ink">
          {RESPONSE_TIME_COPY.title} <span className="text-meta font-normal text-ink-muted">{RESPONSE_TIME_COPY.statistic}</span>
        </h2>
        <span data-testid="lb-response-time-value" className="text-ui font-semibold text-ink">
          <Num>{view.valueText}</Num>
        </span>
      </div>
      <div aria-hidden="true" className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={view.data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={view.domain}
              tickFormatter={(t: number) => tickLabel(t, view.multiDay)}
              tick={CHART_TICK}
              tickLine={false}
              axisLine={false}
              minTickGap={24}
            />
            <YAxis tick={CHART_TICK} tickLine={false} axisLine={false} width={48} tickFormatter={(ms: number) => `${ms} ms`} />
            <Tooltip {...CHART_TOOLTIP} labelFormatter={(t) => periodLabel(Number(t))} formatter={(ms) => [`${ms} ms`, RESPONSE_TIME_COPY.statistic]} />
            <Line {...RESPONSE_TIME_LINE} dataKey="ms" stroke={LINE_COLOR} strokeWidth={2} dot={IsolatedDot} activeDot={{ r: 3 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <ul className="sr-only" data-testid="lb-response-time-summary">
        {view.summary.map((s) => (
          <li key={s.key}>{s.text}</li>
        ))}
      </ul>
      <p data-testid="lb-response-time-caption" className="m-0 text-meta text-ink-muted">
        {view.caption}
      </p>
    </section>
  )
}
