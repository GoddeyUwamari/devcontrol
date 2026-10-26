'use client'

import { Area, AreaChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { Num } from '@/components/ui/typography'
import { CHART_TICK, CHART_TOOLTIP } from '@/lib/chart-theme'
import type { TrendView } from './securityModel'
import { PAGE_COPY } from './securityCopy'

/** The daily history (not the live score), its change, and when it's taken. */
export function ScoreTrend({ trend }: { trend: TrendView | null }) {
  return (
    <section aria-labelledby="security-trend-heading" aria-busy={trend === null || undefined} className="flex flex-col gap-3 rounded-xl border border-slate-200 bg-white p-4 sm:p-6">
      <div className="flex items-baseline justify-between gap-3">
        <h2 id="security-trend-heading" className="m-0 text-section text-ink">{PAGE_COPY.trendHeading}</h2>
        {trend?.delta && <span data-testid="security-trend-delta" className="text-ui font-semibold text-ink"><Num>{trend.delta}</Num></span>}
      </div>
      {trend?.note && <p className="m-0 text-body text-ink-body">{trend.note}</p>}
      {trend && trend.points.length > 0 && (
        <>
          <div aria-hidden="true" className="h-40 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={trend.points} margin={{ top: 4, right: 4, bottom: 0, left: -24 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#E2E8F0" vertical={false} />
                <XAxis dataKey="label" tick={CHART_TICK} tickLine={false} axisLine={false} minTickGap={24} />
                <YAxis domain={[0, 100]} tick={CHART_TICK} tickLine={false} axisLine={false} width={48} />
                <Tooltip {...CHART_TOOLTIP} />
                <Area type="monotone" dataKey="score" stroke="#6D28D9" fill="#EDE9FE" strokeWidth={2} isAnimationActive={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <ul className="sr-only">
            {trend.points.map((p) => <li key={p.label}>{p.label}: {p.score}</li>)}
          </ul>
        </>
      )}
      {trend && <p className="m-0 text-meta text-ink-muted">{trend.caption}</p>}
    </section>
  )
}
