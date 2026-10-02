'use client'

import { useEffect, useRef, useState, type RefObject } from 'react'
import { requestCloudWatchMetrics, RESOURCE_CHECKS_DEFAULT_RANGE, type CloudWatchMetricsData } from '@/lib/resource-checks'

export const IN_VIEW_THRESHOLD = 0.25

/**
 * True once the element has entered the viewport, and from then on. Nothing is
 * observed until `active`: while content above the element is still loading,
 * its position is not final. Where IntersectionObserver does not exist, it is
 * true as soon as `active`.
 */
export function useInViewOnce<T extends Element>(active = true): [RefObject<T | null>, boolean] {
  const ref = useRef<T | null>(null)
  const [seen, setSeen] = useState(false)
  const supported = typeof IntersectionObserver !== 'undefined'
  useEffect(() => {
    const el = ref.current
    if (!active || seen || !supported || !el) return
    // A quarter of the element must be on screen: a section whose top edge only
    // peeks above the fold has not been scrolled to.
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) { setSeen(true); observer.disconnect() }
    }, { threshold: IN_VIEW_THRESHOLD })
    observer.observe(el)
    return () => observer.disconnect()
  }, [active, seen, supported])
  return [ref, seen || (active && !supported)]
}

export type ResourceChecksState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'ok'; data: CloudWatchMetricsData }
  | { status: 'not_connected' }
  | { status: 'failed' }

/**
 * The Dashboard's read of the canonical resource checks: one GET
 * /api/cloudwatch/metrics, at /admin/monitoring's range so both pages share
 * the backend's 45s cache entry, never with refresh=true, and only once
 * `enabled` (the section has been scrolled into view). No client cache and no
 * polling; a different organization starts over.
 */
export function useResourceChecks(enabled: boolean, organizationId: string | null | undefined): ResourceChecksState {
  // The last response, with the organization it belongs to: a response for an
  // organization no longer shown is never returned.
  const [result, setResult] = useState<{ organizationId: string; state: ResourceChecksState } | null>(null)
  useEffect(() => {
    if (!enabled || !organizationId) return
    let current = true
    requestCloudWatchMetrics({ range: RESOURCE_CHECKS_DEFAULT_RANGE }).then((r) => {
      if (!current) return
      setResult({ organizationId, state: r.kind === 'ok' ? { status: 'ok', data: r.data } : { status: r.kind } })
    })
    return () => { current = false }
  }, [enabled, organizationId])
  if (!enabled || !organizationId) return { status: 'idle' }
  return result?.organizationId === organizationId ? result.state : { status: 'loading' }
}
