'use client'

import { useCallback, useRef, useState } from 'react'
import { api } from '@/lib/api'
import { SCAN_IN_PROGRESS, type LocalStart, type StartProblem } from './evaluation'

export type { StartProblem } from './evaluation'

const without = <T,>(record: Readonly<Record<string, T>>, id: string): Record<string, T> =>
  Object.fromEntries(Object.entries(record).filter(([key]) => key !== id))

const toggled = (set: ReadonlySet<string>, id: string, on: boolean): ReadonlySet<string> => {
  const next = new Set(set)
  if (on) next.add(id)
  else next.delete(id)
  return next
}

const statusOf = (error: unknown) => (error as { response?: { status?: number } } | null)?.response?.status
const codeOf = (error: unknown) => (error as { response?: { data?: { error?: unknown } } } | null)?.response?.data?.error

/**
 * A 409 is "this framework already has an active run" only with the SCAN_IN_PROGRESS code: the controller sends
 * it only after finding this framework in this org and failing to take its per-framework lock. Any other 409
 * is a failed start (founder addition 2, Oct 27).
 */
const alreadyRunning = (error: unknown) => statusOf(error) === 409 && codeOf(error) === SCAN_IN_PROGRESS

/**
 * Starts a framework's evaluation in place with the existing POST /api/compliance-frameworks/:id/scan.
 * - One request per framework at a time: a second click while one is in flight sends nothing.
 * - A 200 means started, never completed: the run is tracked by its id until the list shows it.
 * - A 409 SCAN_IN_PROGRESS means a run is already active, so the framework shows Running until the list is read
 *   again; any other 409 is a failed start.
 * - Anything else keeps the previous state and records the problem; nothing is shown as running.
 * `refresh` reads the scan list again; it is awaited before a 409's local Running is dropped.
 */
export function useStartEvaluation(refresh: () => Promise<unknown>) {
  const inFlight = useRef(new Set<string>())
  const [starting, setStarting] = useState<ReadonlySet<string>>(new Set())
  const [started, setStarted] = useState<Readonly<Record<string, LocalStart>>>({})
  const [problems, setProblems] = useState<Readonly<Record<string, StartProblem>>>({})

  const start = useCallback(async (frameworkId: string) => {
    if (inFlight.current.has(frameworkId)) return
    inFlight.current.add(frameworkId)
    setStarting((prev) => toggled(prev, frameworkId, true))
    setProblems((prev) => without(prev, frameworkId))
    try {
      let response: { data?: { data?: { scanId?: unknown } } }
      try {
        response = await api.post(`/api/compliance-frameworks/${encodeURIComponent(frameworkId)}/scan`, {})
      } catch (error) {
        const status = statusOf(error)
        if (!alreadyRunning(error)) {
          setProblems((prev) => ({ ...prev, [frameworkId]: status === 403 ? 'viewer' : status === 402 ? 'plan' : 'failed' }))
          return
        }
        setStarted((prev) => ({ ...prev, [frameworkId]: { at: Date.now(), scanId: null } }))
        await refresh().catch(() => undefined)
        setStarted((prev) => (prev[frameworkId]?.scanId === null ? without(prev, frameworkId) : prev))
        return
      }
      const scanId = response?.data?.data?.scanId
      const local: LocalStart = { at: Date.now(), scanId: typeof scanId === 'string' && scanId !== '' ? scanId : null }
      setStarted((prev) => ({ ...prev, [frameworkId]: local }))
      await refresh().catch(() => undefined)
      // Without an id the run can't be told apart in the list: the refreshed list is the truth.
      if (local.scanId === null) setStarted((prev) => (prev[frameworkId] === local ? without(prev, frameworkId) : prev))
    } finally {
      inFlight.current.delete(frameworkId)
      setStarting((prev) => toggled(prev, frameworkId, false))
    }
  }, [refresh])

  return { start, starting, started, problems }
}
