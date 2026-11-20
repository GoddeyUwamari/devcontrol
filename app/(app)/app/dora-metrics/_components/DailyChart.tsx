import Link from 'next/link'
import { Bar, BarChart, CartesianGrid, Cell, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import { CHART_TICK, CHART_TOOLTIP } from '@/lib/chart-theme'
import type { DORADailyEntry } from '@/lib/services/dora-metrics.service'
import { COPY, formatUtcDay } from '../_lib/dora-page'

/** Series fills (bars and legend swatches; never text). */
export const SUCCEEDED_FILL = '#7C3AED'
export const FAILED_FILL = '#EA580C'
/** Part days (the first and last UTC day of the period) are drawn lighter. */
const PART_DAY_FILL_OPACITY = 0.45

/**
 * Deploys per UTC day: exactly the API's `daily` entries, in its order, zero
 * days included. Nothing is added, dropped, merged or re-bucketed here; the
 * axis only thins its labels. A visually hidden table carries the same rows
 * for screen readers.
 */
export function DailyChart({
  daily,
  days,
  showFullReport,
}: {
  daily: DORADailyEntry[]
  days: number
  showFullReport: boolean
}) {
  // Label thinning only (every bar is drawn): about six date labels, ending on the last day (8 → all, 31 → every 6th, 91 → every 18th).
  const labelInterval = daily.length <= 8 ? 0 : daily.length <= 31 ? 5 : 17
  const hasPartDays = daily.some((d) => d.partial)
  const nothing = daily.every((d) => d.total === 0)

  return (
    <section className="bg-white border border-slate-200 rounded-xl p-4 sm:p-5 min-w-0 lg:col-span-2" data-testid="dora-daily-chart" aria-label="Deploys per day">
      <div className="flex items-start justify-between gap-3 mb-3">
        <h2 className="text-card-title text-ink">Deploys per day · last {days} days</h2>
        {showFullReport && (
          <Link href="/ai-reports" className="text-label text-ink-accent no-underline hover:underline whitespace-nowrap inline-flex items-center min-h-11 sm:min-h-0" data-testid="dora-full-report">
            {COPY.fullReport}
          </Link>
        )}
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-meta text-ink-muted" data-testid="dora-chart-legend">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: SUCCEEDED_FILL }} aria-hidden="true" />Succeeded
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2.5 h-2.5 rounded-sm" style={{ background: FAILED_FILL }} aria-hidden="true" />Failed
        </span>
        {hasPartDays && (
          <span className="inline-flex items-center gap-1.5">
            <span className="w-2.5 h-2.5 rounded-sm bg-violet-300" aria-hidden="true" />Part day (the period starts or ends mid-day)
          </span>
        )}
      </div>
      <div className="h-[220px] w-full relative">
        <div className="absolute inset-0" aria-hidden="true">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={daily} margin={{ top: 8, right: 20, bottom: 0, left: -12 }}>
            <CartesianGrid vertical={false} stroke="#F1F5F9" />
            <XAxis dataKey="date" tick={CHART_TICK} tickFormatter={formatUtcDay} interval={labelInterval} tickLine={false} axisLine={{ stroke: '#E2E8F0' }} />
            <YAxis allowDecimals={false} tick={CHART_TICK} tickLine={false} axisLine={false} width={36} />
            <Tooltip
              {...CHART_TOOLTIP}
              cursor={{ fill: '#F8FAFC' }}
              labelFormatter={(date) => {
                const entry = daily.find((d) => d.date === date)
                return `${formatUtcDay(String(date))}${entry?.partial ? ' · part day' : ''}`
              }}
            />
            <Bar dataKey="succeeded" name="Succeeded" stackId="deploys" fill={SUCCEEDED_FILL} isAnimationActive={false}>
              {daily.map((d) => <Cell key={d.date} fillOpacity={d.partial ? PART_DAY_FILL_OPACITY : 1} />)}
            </Bar>
            <Bar dataKey="failed" name="Failed" stackId="deploys" fill={FAILED_FILL} isAnimationActive={false}>
              {daily.map((d) => <Cell key={d.date} fillOpacity={d.partial ? PART_DAY_FILL_OPACITY : 1} />)}
            </Bar>
          </BarChart>
        </ResponsiveContainer>
        </div>
        {nothing && (
          <p className="absolute inset-0 flex items-center justify-center text-meta text-ink-muted">No finished deployments in this period.</p>
        )}
      </div>
      {/* sr-only on a wrapper: a <table> ignores overflow, so sr-only on the table itself still adds scroll height. */}
      <div className="sr-only">
      <table data-testid="dora-daily-table">
        <caption>Deploys per UTC day</caption>
        <thead><tr><th>Date</th><th>Succeeded</th><th>Failed</th><th>Part day</th></tr></thead>
        <tbody>
          {daily.map((d) => (
            <tr key={d.date} data-date={d.date} data-partial={d.partial ? 'true' : 'false'}>
              <td>{formatUtcDay(d.date)}</td><td>{d.succeeded}</td><td>{d.failed}</td><td>{d.partial ? 'yes' : 'no'}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </section>
  )
}
