'use client'

import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { Skeleton } from '@/components/ui/skeleton'

const PAGE_FRAME = 'max-w-[1320px] mx-auto px-4 pt-page-top pb-6 sm:px-6 sm:pb-8 lg:px-14 lg:pb-10 min-h-screen'

/**
 * Shown by a plan-gated page while the plan isn't known: neither the
 * upgrade gate nor the paid content.
 */
export function PlanLoadingState() {
  return (
    <div className={PAGE_FRAME} role="status" aria-busy="true" data-testid="plan-loading">
      <span className="sr-only">Loading your workspace…</span>
      <Skeleton className="h-8 w-64 mb-3" />
      <Skeleton className="h-4 w-96 max-w-full mb-8" />
      <Skeleton className="h-48 w-full rounded-xl" />
    </div>
  )
}

/**
 * Shown by a plan-gated page when the organization couldn't be loaded --
 * never the upgrade gate, and never treated as the free plan.
 */
export function WorkspaceLoadError({ onRetry }: { onRetry: () => Promise<void> }) {
  const [retrying, setRetrying] = useState(false)

  const handleRetry = async () => {
    if (retrying) return
    setRetrying(true)
    try {
      await onRetry()
    } finally {
      setRetrying(false)
    }
  }

  return (
    <div className={PAGE_FRAME}>
      <div role="alert" className="bg-white border border-gray-200 rounded-xl py-16 px-10 text-center">
        <p className="text-ui font-semibold text-gray-900 mb-4">Couldn&apos;t load your workspace.</p>
        <button
          type="button"
          onClick={handleRetry}
          disabled={retrying}
          className="inline-flex items-center gap-2 bg-white border border-gray-300 text-gray-800 px-5 py-2 rounded-lg text-ui font-semibold disabled:opacity-60"
        >
          {retrying && <Loader2 className="w-4 h-4 animate-spin" aria-hidden="true" />}
          Try again
        </button>
      </div>
    </div>
  )
}
