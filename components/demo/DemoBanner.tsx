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
      style={{ background: 'linear-gradient(to right, #2563eb, #4f46e5, #7c3aed)', borderBottom: '1px solid rgba(0,0,0,0.15)' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0 inline-block" />
        <span className="text-xs sm:text-[0.82rem] font-semibold text-white">
          {salesDemoMode ? 'Sales Demo Mode active' : 'Demo Mode active'}
        </span>
        <span className="hidden sm:inline text-[0.82rem] text-white/80">
          · Showing curated data for presentations
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSwitch}
          className="text-[0.72rem] sm:text-[0.78rem] font-semibold px-2 sm:px-3 py-1 rounded-md cursor-pointer"
          style={{
            background: '#fff',
            color: '#4c1d95',
            border: '1px solid #fff',
            fontWeight: 700,
          }}
        >
          Switch to real data
        </button>
        <button
          onClick={handleDismiss}
          className="p-2 flex items-center text-purple-100 hover:text-white hover:bg-white/10 rounded-md cursor-pointer"
          style={{ background: 'transparent', border: 'none' }}
          aria-label="Dismiss banner"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  )
}
