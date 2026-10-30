/**
 * The load balancer response-time chart (O3b), from the resources response's
 * lb_response_time block as the backend sent it. Pure: no requests, no React.
 *
 * Shown only when the block says ok and sends points (Board D: "never an empty
 * chart"); no data or a failure shows nothing here, and the row and banner say why.
 * A period CloudWatch returned nothing for is a gap: a null the line breaks at,
 * never 0 and never joined to its neighbours. No value is ever made up.
 */
import type { LbResponseTimePoint, ResourcesData, Source } from './observabilityTypes'
import { RESPONSE_TIME_COPY } from './operationalHealthCopy'

export interface ChartDatum {
  t: number
  ms: number | null
  /** A value with no value on either side: drawn as a dot, since a line needs two. */
  isolated: boolean
}

export interface ResponseTimeView {
  name: string
  valueText: string
  caption: string
  data: ChartDatum[]
  /** The queried window, so the axis shows the range CloudWatch was asked for. */
  domain: [number, number]
  /** The 7d range labels ticks by day. */
  multiDay: boolean
  /** One line per period for screen readers; a gap reads "no data". */
  summary: Array<{ key: string; text: string }>
}

/**
 * The points with a null wherever at least one period is missing: between two points
 * more than one period apart, before the first when the window's first period is
 * missing (CloudWatch rounds the start down to the minute), and after the last when
 * the window's last period is missing.
 */
export function chartData(points: LbResponseTimePoint[], windowStart: number, windowEnd: number, periodMs: number): ChartDatum[] {
  const sorted = points
    .map((p) => ({ t: Date.parse(p.t), ms: p.ms }))
    .filter((p) => Number.isFinite(p.t) && typeof p.ms === 'number' && Number.isFinite(p.ms))
    .sort((a, b) => a.t - b.t)
  if (sorted.length === 0 || !(periodMs > 0)) return []
  const out: Array<{ t: number; ms: number | null }> = []
  const firstPeriod = Math.floor(windowStart / 60_000) * 60_000
  if (sorted[0].t - firstPeriod >= periodMs) out.push({ t: firstPeriod, ms: null })
  sorted.forEach((p, i) => {
    if (i > 0 && p.t - sorted[i - 1].t > periodMs) out.push({ t: sorted[i - 1].t + periodMs, ms: null })
    out.push(p)
  })
  const last = sorted[sorted.length - 1]
  if (windowEnd - last.t > periodMs) out.push({ t: last.t + periodMs, ms: null })
  return out.map((d, i) => ({
    ...d,
    isolated: d.ms !== null && (out[i - 1]?.ms ?? null) === null && (out[i + 1]?.ms ?? null) === null,
  }))
}

const msText = (ms: number) => `${ms.toLocaleString(undefined, { maximumFractionDigits: 0 })} ms`

/** "Oct 30, 1:05 PM UTC": the period's start, local time with its zone. */
export function periodLabel(t: number): string {
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(t))
}

/** Axis tick: "1:05 PM", or "Oct 30" on the 7d range. */
export function tickLabel(t: number, multiDay: boolean): string {
  const options: Intl.DateTimeFormatOptions = multiDay ? { month: 'short', day: 'numeric' } : { hour: 'numeric', minute: '2-digit' }
  return new Intl.DateTimeFormat(undefined, options).format(new Date(t))
}

export function responseTimeView(resources: Source<ResourcesData>): ResponseTimeView | null {
  if (resources.state !== 'ok' || resources.data.status !== 'ok') return null
  const block = resources.data.lb_response_time
  // The block must be for the range the rest of the answer is for.
  if (!block || block.state !== 'ok' || !block.charted || block.range !== resources.data.range) return null
  const start = Date.parse(block.window_start)
  const end = Date.parse(block.window_end)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || typeof block.charted.value_ms !== 'number') return null
  const data = chartData(block.charted.points ?? [], start, end, block.period_seconds * 1000)
  if (!data.some((d) => d.ms !== null)) return null
  return {
    name: block.charted.name,
    valueText: msText(block.charted.value_ms),
    caption: RESPONSE_TIME_COPY.caption(block.charted.name, block.range),
    data,
    domain: [start, end],
    multiDay: end - start > 24 * 3600 * 1000,
    summary: data.map((d) => ({ key: String(d.t), text: `${periodLabel(d.t)}: ${d.ms === null ? RESPONSE_TIME_COPY.noData : msText(d.ms)}` })),
  }
}
