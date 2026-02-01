'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Loader2 } from 'lucide-react'

/**
 * Costs Page Redirect
 *
 * This page doesn't exist yet - it's a placeholder that redirects
 * filtered cost queries to the infrastructure page or general cost
 * overview to the dashboard.
 *
 * Future: Could be a dedicated cost analysis page with:
 * - Cost trends and forecasting
 * - Budget tracking
 * - Cost allocation by team/project
 * - Savings recommendations
 */
export default function CostsPage() {
  const router = useRouter()

  useEffect(() => {
    // Redirect to dashboard (main cost overview)
    console.log('[Costs Page] Redirecting to dashboard for cost overview')
    router.push('/dashboard')
  }, [router])

  // Show loading while redirecting
  return (
    <div className="flex items-center justify-center h-screen">
      <div className="text-center">
        <Loader2 className="h-8 w-8 animate-spin mx-auto mb-4 text-blue-600" />
        <p className="text-sm text-muted-foreground">Redirecting to cost overview...</p>
      </div>
    </div>
  )
}
