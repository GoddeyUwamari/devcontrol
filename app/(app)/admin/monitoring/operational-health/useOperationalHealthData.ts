'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import { api } from '@/lib/api'
import type { AlarmsData, MonitoringRange, ResourcesData, Source } from './observabilityTypes'

/** The poll interval; both backend caches are about this long (45 s resources, 60 s alarms). */
export const POLL_MS = 60_000
/** O1 decision D5: the first page of rows, which O2's table will reuse. */
export const PAGE_SIZE = 25

const isHidden = () => typeof document !== 'undefined' && document.visibilityState === 'hidden'
const statusOf = (err: unknown) => (err as { response?: { status?: number } } | null)?.response?.status

/**
 * GET /api/observability/resources and GET /api/observability/alarms, as one
 * cycle (O1 decision D7: plain state, no shared cache across organizations).
 *
 * - A cycle runs on mount, on a range change, on refresh/retry, on the poll and
 *   when the tab becomes visible again. Each source settles on its own.
 * - Never two cycles at once: a range change or refresh aborts the one in
 *   flight; a poll tick or a visibility change while one is in flight is skipped.
 * - A response is applied only if it belongs to the latest cycle and, for
 *   resources, to the range that cycle asked for.
 * - The next poll is scheduled 60 s after a cycle settles, and only while the
 *   tab is visible (decision D14); becoming visible runs a cycle at once.
 * - Unmount aborts the cycle and stops the poll.
 */
export function useOperationalHealthData(range: MonitoringRange) {
  // Stored with the range it was loaded for: under any other range it reads as loading,
  // so numbers for one range are never shown under another.
  const [loaded, setLoaded] = useState<{ range: MonitoringRange; source: Source<ResourcesData> } | null>(null)
  const [alarms, setAlarms] = useState<Source<AlarmsData>>({ state: 'loading' })
  const [busy, setBusy] = useState(false)

  const seq = useRef(0)
  const controller = useRef<AbortController | null>(null)
  // An alarms-only retry: superseded (and aborted) by any cycle that starts after it.
  const alarmsSeq = useRef(0)
  const alarmsController = useRef<AbortController | null>(null)
  const inFlight = useRef(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const mounted = useRef(true)
  const rangeRef = useRef(range)
  // The poll timer calls the latest run through this ref.
  const runRef = useRef<(opts: { refresh: boolean; cancelInFlight: boolean }) => void>(() => {})

  const clearTimer = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = null
  }

  const run = useCallback((opts: { refresh: boolean; cancelInFlight: boolean }) => {
    if (inFlight.current && !opts.cancelInFlight) return
    controller.current?.abort()
    alarmsController.current?.abort()
    alarmsSeq.current += 1
    clearTimer()
    const mine = ++seq.current
    const ctrl = new AbortController()
    controller.current = ctrl
    inFlight.current = true
    setBusy(true)
    const requested = rangeRef.current
    const current = () => mounted.current && mine === seq.current && !ctrl.signal.aborted

    const params = new URLSearchParams({ range: requested, pageSize: String(PAGE_SIZE) })
    if (opts.refresh) params.set('refresh', 'true')

    const resourcesDone = api
      .get<{ success: boolean; data: ResourcesData }>(`/api/observability/resources?${params}`, { signal: ctrl.signal })
      .then((res) => {
        if (!current()) return
        const data = res.data?.data
        // A response for another range is never shown under this one.
        if (!data || (data.status === 'ok' && data.range !== requested)) setLoaded({ range: requested, source: { state: 'error', kind: 'failed' } })
        else setLoaded({ range: requested, source: { state: 'ok', data } })
      })
      .catch((err) => {
        if (!current()) return
        setLoaded({ range: requested, source: { state: 'error', kind: statusOf(err) === 503 ? 'unavailable' : 'failed' } })
      })

    const alarmsDone = api
      .get<{ success: boolean; data: AlarmsData }>('/api/observability/alarms', { signal: ctrl.signal })
      .then((res) => {
        if (!current()) return
        const data = res.data?.data
        setAlarms(data ? { state: 'ok', data } : { state: 'error', kind: 'failed' })
      })
      .catch((err) => {
        if (!current()) return
        setAlarms({ state: 'error', kind: statusOf(err) === 503 ? 'unavailable' : 'failed' })
      })

    void Promise.all([resourcesDone, alarmsDone]).then(() => {
      if (mine !== seq.current || !mounted.current) return
      inFlight.current = false
      setBusy(false)
      if (!isHidden()) timer.current = setTimeout(() => runRef.current({ refresh: false, cancelInFlight: false }), POLL_MS)
    })
  }, [])

  useEffect(() => {
    runRef.current = run
  }, [run])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
      controller.current?.abort()
      alarmsController.current?.abort()
      clearTimer()
    }
  }, [])

  // Mount and every range change. Alarms don't depend on the range and are kept.
  useEffect(() => {
    rangeRef.current = range
    run({ refresh: false, cancelInFlight: true })
  }, [range, run])

  useEffect(() => {
    const onVisibility = () => {
      if (isHidden()) clearTimer()
      else run({ refresh: false, cancelInFlight: false })
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [run])

  /** Refresh and Retry: a cache-bypassing cycle for resources (alarms have no bypass). */
  const refresh = useCallback(() => run({ refresh: true, cancelInFlight: true }), [run])

  const resources: Source<ResourcesData> = loaded && loaded.range === range ? loaded.source : { state: 'loading' }
  /**
   * Retry on the alarms tile and row: GET /alarms only, no resources sweep. Skipped while a
   * cycle runs (that cycle reads alarms too); a cycle that starts later wins over it. The last
   * answer stays on screen until the retry answers, so the banner doesn't blink.
   */
  const retryAlarms = useCallback(() => {
    if (inFlight.current) return
    alarmsController.current?.abort()
    const mine = ++alarmsSeq.current
    const ctrl = new AbortController()
    alarmsController.current = ctrl
    const current = () => mounted.current && mine === alarmsSeq.current && !ctrl.signal.aborted
    api
      .get<{ success: boolean; data: AlarmsData }>('/api/observability/alarms', { signal: ctrl.signal })
      .then((res) => {
        if (!current()) return
        const data = res.data?.data
        setAlarms(data ? { state: 'ok', data } : { state: 'error', kind: 'failed' })
      })
      .catch((err) => {
        if (!current()) return
        setAlarms({ state: 'error', kind: statusOf(err) === 503 ? 'unavailable' : 'failed' })
      })
  }, [])

  return { resources, alarms, busy, refresh, retryAlarms }
}
