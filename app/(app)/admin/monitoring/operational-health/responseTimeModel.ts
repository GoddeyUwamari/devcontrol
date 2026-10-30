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
  /** On a gap (ms null): the start of its last missing period (t itself when one period is missing). */
  until?: number
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
  /** One line per period for screen readers; a run of missing periods is one "no data" line. */
  summary: Array<{ key: string; text: string }>
}

/**
 * The points with a null wherever at least one period is missing: between two points
 * more than one period apart, before the first when the window's first period is
 * missing (CloudWatch rounds the start down to the minute), and after the last when
 * the window's last period is missing. One null breaks the line; its `until` says how
 * far the run of missing periods goes, for the text alternative.
 */
export function chartData(points: LbResponseTimePoint[], windowStart: number, windowEnd: number, periodMs: number): ChartDatum[] {
  const sorted = points
    .map((p) => ({ t: Date.parse(p.t), ms: p.ms }))
    .filter((p) => Number.isFinite(p.t) && typeof p.ms === 'number' && Number.isFinite(p.ms))
    .sort((a, b) => a.t - b.t)
  if (sorted.length === 0 || !(periodMs > 0)) return []
  const out: Array<{ t: number; ms: number | null; until?: number }> = []
  // The missing periods after `from` and before `before`: from + period, ..., the last start before `before`.
  const gap = (from: number, before: number) => ({ t: from + periodMs, ms: null, until: from + periodMs * Math.floor((before - from - 1) / periodMs) })
  const firstPeriod = Math.floor(windowStart / 60_000) * 60_000
  if (sorted[0].t - firstPeriod >= periodMs) out.push(gap(firstPeriod - periodMs, sorted[0].t))
  sorted.forEach((p, i) => {
    if (i > 0 && p.t - sorted[i - 1].t > periodMs) out.push(gap(sorted[i - 1].t, p.t))
    out.push(p)
  })
  const last = sorted[sorted.length - 1]
  if (windowEnd - last.t > periodMs) out.push(gap(last.t, windowEnd))
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

const RANGE_PARTS: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }

/**
 * A run of missing periods, first to last period start: "Oct 30, 1:10–1:25 PM UTC" on one
 * day (the shared AM/PM and zone said once), else "Oct 30, 11:55 PM UTC – Oct 31, 12:10 AM UTC".
 */
export function periodRangeLabel(from: number, to: number): string {
  const parts = (t: number) => {
    const out: Record<string, string> = {}
    for (const p of new Intl.DateTimeFormat(undefined, RANGE_PARTS).formatToParts(new Date(t))) out[p.type] = (out[p.type] ?? '') + p.value
    return out
  }
  const a = parts(from)
  const b = parts(to)
  const clock = (x: Record<string, string>) => `${x.hour}:${x.minute}`
  if (a.month && a.day && a.hour && a.minute && a.month === b.month && a.day === b.day && a.timeZoneName === b.timeZoneName) {
    const startPeriod = a.dayPeriod && a.dayPeriod !== b.dayPeriod ? ` ${a.dayPeriod}` : ''
    const endPeriod = b.dayPeriod ? ` ${b.dayPeriod}` : ''
    const zone = b.timeZoneName ? ` ${b.timeZoneName}` : ''
    return `${a.month} ${a.day}, ${clock(a)}${startPeriod}–${clock(b)}${endPeriod}${zone}`
  }
  return `${periodLabel(from)} – ${periodLabel(to)}`
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
    summary: data.map((d) => {
      if (d.ms !== null) return { key: String(d.t), text: `${periodLabel(d.t)}: ${msText(d.ms)}` }
      const when = d.until !== undefined && d.until > d.t ? periodRangeLabel(d.t, d.until) : periodLabel(d.t)
      return { key: String(d.t), text: `${when}: ${RESPONSE_TIME_COPY.noData}` }
    }),
  }
}
