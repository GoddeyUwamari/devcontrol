'use client'

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts'
import { CHART_TOOLTIP } from '@/lib/chart-theme'
import { TREND_TOTALS_NOTE } from '@/lib/cost-trend-basis'
import { formatDriverAmount, windowTotalLabel, type CostDrivers } from './cost-intelligence'

/** A share of the total: whole percent, "<1%" for a positive share that rounds to 0. */
function share(amount: number, total: number): string {
  if (!(total > 0)) return ''
  const pct = Math.round((amount / total) * 100)
  return pct === 0 && amount > 0 ? '<1%' : `${pct}%`
}

/**
 * Cost drivers (spec item 10, founder ruling Q4): AWS spend by AWS service over
 * the SAME days the Spend Trend draws (safeguard 1), largest first, with the
 * window's own total and dates. `drivers` null with `message`: no donut.
 */
export function CostDriversCard({ drivers, message, showBasis, className = '' }: { drivers: CostDrivers | null; message: string | null; showBasis: boolean; className?: string }) {
  return (
    <section aria-labelledby="cost-drivers-heading" className={`bg-white rounded-xl p-5 sm:p-6 border border-slate-200 flex flex-col min-w-0 ${className}`}>
      <div className="mb-4">
        <h2 id="cost-drivers-heading" className="text-section font-semibold text-slate-900 m-0 tracking-tight">Cost drivers</h2>
        {showBasis && <p className="text-meta text-ink-muted m-0 mt-0.5" data-testid="cost-drivers-basis">AWS Cost Explorer · by AWS service · {TREND_TOTALS_NOTE}</p>}
      </div>
      {!drivers ? (
        <p className="text-meta text-ink-muted m-0 py-6 text-center">{message}</p>
      ) : (
        <>
          <p className="text-meta text-ink-muted m-0 mb-4" data-testid="drivers-total">
            <span className="font-semibold text-slate-900">{windowTotalLabel(drivers.days)}</span>
            {' · '}{drivers.dates}{': '}
            <span className="text-ui font-semibold text-slate-900 tabular-nums">{formatDriverAmount(drivers.total)}</span>
            {drivers.includesUpdating && <> · includes the latest day so far</>}
          </p>
          {drivers.slices.length === 0 ? (
            <p className="text-meta text-ink-muted m-0 py-6 text-center">AWS Cost Explorer reported no charges for these days.</p>
          ) : (
            // Mock-match: a small donut beside the list (96px on a phone, 128px from sm); where the column is too narrow for
            // both (the three-column row), the list wraps under the donut instead of truncating the service names.
            <div className="flex flex-wrap items-center gap-4 sm:gap-6">
              <div className="h-24 w-24 sm:h-32 sm:w-32 shrink-0" aria-hidden="true">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={drivers.slices} dataKey="amount" nameKey="service" innerRadius="60%" outerRadius="100%" paddingAngle={1} isAnimationActive={false} stroke="none">
                      {drivers.slices.map((slice) => <Cell key={slice.service} fill={slice.fill} />)}
                    </Pie>
                    <Tooltip contentStyle={CHART_TOOLTIP.contentStyle} labelStyle={CHART_TOOLTIP.labelStyle} formatter={(value: unknown, name: unknown) => [formatDriverAmount(Number(value)), String(name)]} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <ol className="flex-1 basis-[180px] sm:basis-[240px] min-w-0 m-0 p-0 list-none flex flex-col gap-2.5" data-testid="cost-drivers-list">
                {drivers.slices.map((slice) => (
                  <li key={slice.service} className="flex items-center justify-between gap-3" data-testid="cost-driver">
                    <span className="flex items-center gap-2 min-w-0">
                      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ background: slice.fill }} aria-hidden="true" />
                      <span className="text-label text-slate-700 font-medium truncate">{slice.service}</span>
                    </span>
                    <span className="flex items-center gap-3 shrink-0">
                      <span className="text-label text-ink-muted font-medium tabular-nums">{share(slice.amount, drivers.total)}</span>
                      <span className="text-ui font-semibold text-slate-900 min-w-[64px] text-right tabular-nums">{formatDriverAmount(slice.amount)}</span>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          )}
        </>
      )}
    </section>
  )
}
