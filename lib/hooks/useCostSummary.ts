import { useEffect, useRef, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { platformStatsService } from '@/lib/services/platform-stats.service'
import type { CostSummary } from '@/lib/types'

/** 'YYYY-MM-DD' of an instant, in UTC (AWS Cost Explorer's own day boundary). */
export function utcDayOf(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10)
}

/** Milliseconds from `ms` to the next 00:00:00 UTC. */
export function msUntilNextUtcMidnight(ms: number): number {
  const d = new Date(ms)
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + 1) - ms
}

/**
 * Today's UTC date, re-rendered at every 00:00 UTC (DAY1-D10). Cost query keys
 * include it, so a page left open across midnight UTC -- the first of a month
 * above all -- asks for the new period on its own, without a reload, and an
 * entry fetched for yesterday is never shown as today's.
 */
export function useUtcDay(): string {
  const [day, setDay] = useState(() => utcDayOf(Date.now()))
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>
    const schedule = () => {
      // +1s so the timer never fires a hair before midnight and reschedules for the same day.
      timer = setTimeout(() => { setDay(utcDayOf(Date.now())); schedule() }, msUntilNextUtcMidnight(Date.now()) + 1000)
    }
    schedule()
    return () => clearTimeout(timer)
  }, [])
  return day
}

/**
 * The one cache identity of GET /api/platform/costs/summary: the organization
 * and the UTC day. Every page that shows month-to-date spend uses it, so they
 * share one entry per organization per day (and an invalidation of
 * ['platform-cost-summary'] still reaches all of them).
 */
export function costSummaryKey(orgId: string | null | undefined, utcDay: string) {
  return ['platform-cost-summary', orgId ?? null, utcDay] as const
}

export interface CostSummaryQueryOptions {
  enabled: boolean
  staleTime?: number
  gcTime?: number
  refetchOnMount?: boolean
  refetchOnWindowFocus?: boolean
  retry?: boolean
}

/**
 * The cost summary under costSummaryKey. If an answer's own month (its month
 * state's period) is earlier than this browser's UTC month, the answer is
 * from before the month rolled over: it is shown with its own period label,
 * as sent, and refetched once (DAY1-D11). The period shown always comes from
 * the response, never from this clock.
 */
export function useCostSummary(orgId: string | null | undefined, options: CostSummaryQueryOptions) {
  const utcDay = useUtcDay()
  const query = useQuery<CostSummary>({
    queryKey: costSummaryKey(orgId, utcDay),
    queryFn: platformStatsService.getCostSummary,
    ...options,
    enabled: options.enabled && !!orgId,
  })
  const refetchedFor = useRef<string | null>(null)
  const answeredMonth = query.data?.spend?.data?.monthState?.period.month
  const { refetch, isFetching } = query
  useEffect(() => {
    if (!answeredMonth || isFetching || answeredMonth >= utcDay.slice(0, 7) || refetchedFor.current === utcDay) return
    refetchedFor.current = utcDay
    void refetch()
  }, [answeredMonth, isFetching, utcDay, refetch])
  return query
}
