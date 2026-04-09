'use client'

import { useState, useEffect } from 'react'
import { X } from 'lucide-react'
import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'

export function DemoBanner() {
  const demoMode = useDemoMode()
  const { enabled: salesDemoMode, toggle: toggleSalesDemo } = useSalesDemo()
  const [dismissed, setDismissed] = useState(false)

  useEffect(() => {
    if (demoMode || salesDemoMode) {
      // Always show banner fresh when demo mode activates
      localStorage.removeItem('demo_banner_dismissed')
      setDismissed(false)
    }
  }, [demoMode, salesDemoMode])

  const handleDismiss = () => {
    localStorage.setItem('demo_banner_dismissed', 'true')
    setDismissed(true)
  }

  if ((!demoMode && !salesDemoMode) || dismissed) return null

  const handleSwitch = () => {
    if (salesDemoMode) toggleSalesDemo()
    if (demoMode) {
      localStorage.setItem('devcontrol_demo_mode', 'false')
      localStorage.removeItem('demo_banner_dismissed')
      window.dispatchEvent(new CustomEvent('demo-mode-changed', { detail: { enabled: false } }))
    }
  }

  return (
    <div
      className="flex items-center justify-between flex-wrap gap-y-1 px-3 sm:px-6 py-2 relative z-[60]"
      style={{ background: '#7C3AED', borderBottom: '1px solid #6D28D9' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full bg-purple-100 shrink-0 inline-block" />
        <span className="text-xs sm:text-[0.82rem] font-semibold text-white">
          {salesDemoMode ? 'Sales Demo Mode active' : 'Demo Mode active'}
        </span>
        <span className="hidden sm:inline text-[0.82rem] text-purple-100">
          · Showing curated data for presentations
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSwitch}
          className="text-[0.72rem] sm:text-[0.78rem] font-semibold text-white px-2 sm:px-3 py-1 rounded-md cursor-pointer"
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
          }}
        >
          Switch to real data
        </button>
        <button
          onClick={handleDismiss}
          className="p-1.5 flex items-center text-purple-100 hover:text-white cursor-pointer"
          style={{ background: 'transparent', border: 'none' }}
          aria-label="Dismiss banner"
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
