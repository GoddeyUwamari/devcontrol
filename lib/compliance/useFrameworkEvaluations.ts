'use client'

import { useCallback, useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { api, handleApiResponse } from '@/lib/api'
import type { ComplianceFramework, ComplianceScan } from '@/lib/services/compliance-frameworks.service'
import {
  EVALUATION_POLL_CEILING_MS,
  activeRunStarts,
  evaluateFramework,
  evaluationPollInterval,
  type EvaluationOverlay,
  type LocalStart,
} from './evaluation'
import { useStartEvaluation } from './useStartEvaluation'

/**
 * The org's newest scans, all frameworks together, are read with this limit, and the same value is what the
 * models are told was requested: a list shorter than it is the whole history.
 */
export const FRAMEWORK_SCANS_LIMIT = 50

export interface FrameworkResults {
  frameworks: ComplianceFramework[]
  scans: ComplianceScan[]
  scansLimit: number
}

/** Both reads keep their axios error, so a 402 (Enterprise) stays distinguishable from a failure (D7). */
export async function readFrameworkResults(): Promise<FrameworkResults> {
  const [frameworks, scans] = await Promise.all([
    api.get('/api/compliance-frameworks').then((r) => handleApiResponse<ComplianceFramework[]>(r)),
    api.get(`/api/compliance-frameworks/scans/list?limit=${FRAMEWORK_SCANS_LIMIT}`).then((r) => handleApiResponse<ComplianceScan[]>(r)),
  ])
  return { frameworks, scans, scansLimit: FRAMEWORK_SCANS_LIMIT }
}

/**
 * The Security and Compliance pages' frameworks and runs, and starting a run in place (Security V2 F3).
 * - Read again every 5 s for the first minute of the youngest active run, then every 15 s, until it ends or passes
 *   the ceiling; never in a hidden tab (refetchIntervalInBackground: false).
 * - `overlay` carries the runs this page started that the list doesn't show yet, and the clock the ceiling is
 *   measured with. It moves forward with every answered start and with the ceiling timer, never by render.
 */
export function useFrameworkEvaluations(queryKey: readonly unknown[], enabled: boolean, now: number) {
  const query = useQuery({
    queryKey,
    queryFn: readFrameworkResults,
    enabled,
    retry: false,
    refetchOnWindowFocus: false,
    refetchInterval: (q: { state: { data?: FrameworkResults } }) =>
      evaluationPollInterval(activeRunStarts(q.state.data?.scans ?? []), Date.now()),
    refetchIntervalInBackground: false,
  })

  const { refetch } = query
  const evaluation = useStartEvaluation(useCallback(() => refetch(), [refetch]))
  // Fires at once for a run first seen already past the ceiling.
  const [ceilingTick, setCeilingTick] = useState(0)
  const data = query.data
  const listedScanIds = new Set(data?.scans.map((s) => s.id) ?? [])
  const startedLocally: Record<string, LocalStart> = {}
  for (const [frameworkId, local] of Object.entries(evaluation.started)) {
    if (local.scanId === null || !listedScanIds.has(local.scanId)) startedLocally[frameworkId] = local
  }
  const overlay: EvaluationOverlay = {
    clock: Math.max(now, ceilingTick, ...Object.values(startedLocally).map((local) => local.at)),
    startedLocally,
  }

  const historyComplete = !!data && data.scans.length < data.scansLimit
  const running = (data?.frameworks ?? []).flatMap((f) => {
    const e = evaluateFramework(f.id, data!.scans, overlay.clock, historyComplete, startedLocally[f.id] ?? null)
    return e.state === 'running' && !e.overdue && e.startedAt !== null ? [e.startedAt] : []
  })
  const runningKey = running.join(',')
  useEffect(() => {
    if (runningKey === '') return
    // Re-render when the oldest live run passes the ceiling, so its start action shows again.
    const next = Math.min(...runningKey.split(',').map(Number)) + EVALUATION_POLL_CEILING_MS - Date.now()
    const timer = setTimeout(() => setCeilingTick(Date.now()), Math.max(0, next) + 1)
    return () => clearTimeout(timer)
  }, [runningKey])

  return { query, evaluation, overlay }
}
