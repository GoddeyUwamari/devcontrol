'use client'

import { useCallback, useEffect, useRef, useState } from 'react'
import sloService from '@/lib/services/slo.service'
import { tierRequiredOf } from '@/lib/plan/tier-required'
import type { PlanInfo, SloState } from './observabilityTypes'
import { sloStateFor } from './operationalHealthModel'

type Result = { state: 'idle' } | { state: 'loading' } | { state: 'ok'; statuses: string[] } | { state: 'plan_required' } | { state: 'error' }

/**
 * The SLO row (O1 decision D13): GET /api/slos/evaluate once per page load, only
 * when the plan is known to be Enterprise (as the SLO page does), never on the
 * poll or Refresh. A TIER_REQUIRED answer means "On Revenue Protection"; any
 * other failure is "Couldn't check" with Retry, never 0.
 */
export function useSloSummary(plan: PlanInfo): { slo: SloState; retry: () => void } {
  const [result, setResult] = useState<Result>({ state: 'idle' })
  const started = useRef(false)
  const mounted = useRef(true)
  const enterprise = plan.status === 'known' && plan.tier === 'enterprise'

  const fetchSlos = useCallback(() => {
    sloService
      .evaluateAll()
      .then((items) => {
        if (mounted.current) setResult({ state: 'ok', statuses: items.map((i) => i.evaluation.status) })
      })
      .catch((err) => {
        if (mounted.current) setResult(tierRequiredOf(err) ? { state: 'plan_required' } : { state: 'error' })
      })
  }, [])

  useEffect(() => {
    mounted.current = true
    return () => {
      mounted.current = false
    }
  }, [])

  // The first load needs no loading state: 'idle' already reads as loading for Enterprise.
  useEffect(() => {
    if (!enterprise || started.current) return
    started.current = true
    fetchSlos()
  }, [enterprise, fetchSlos])

  const retry = useCallback(() => {
    setResult({ state: 'loading' })
    fetchSlos()
  }, [fetchSlos])

  return { slo: sloStateFor(plan, result), retry }
}
