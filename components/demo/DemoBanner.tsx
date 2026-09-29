'use client'

import { useDemoMode } from '@/components/demo/demo-mode-toggle'
import { useSalesDemo } from '@/lib/demo/sales-demo-data'

/**
 * The only app-wide label for demo mode, so it is not dismissible: while demo
 * mode is on, sample data replaces real data on every page and must stay
 * visibly labelled. Leaving demo mode is the way to remove it.
 */
export function DemoBanner() {
  const demoMode = useDemoMode()
  const { enabled: salesDemoMode, toggle: toggleSalesDemo } = useSalesDemo()

  if (!demoMode && !salesDemoMode) return null

  const handleSwitch = () => {
    if (salesDemoMode) toggleSalesDemo()
    if (demoMode) {
      localStorage.setItem('devcontrol_demo_mode', 'false')
      window.dispatchEvent(new CustomEvent('demo-mode-changed', { detail: { enabled: false } }))
    }
  }

  return (
    <div
      role="status"
      data-testid="demo-banner"
      className="flex items-center justify-between flex-wrap gap-y-1 px-3 sm:px-6 py-2 relative z-[60]"
      style={{ background: '#6d28d9', borderTop: '1px solid #4c1d95', borderBottom: '1px solid #4c1d95' }}
    >
      <div className="flex items-center gap-2 min-w-0">
        <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0 inline-block" />
        <span className="text-xs sm:text-[0.82rem] font-semibold text-white">
          {salesDemoMode ? 'Sales Demo Mode active' : 'Demo Mode active'}
        </span>
        <span className="hidden sm:inline text-[0.82rem] text-white/80">
          · Showing sample data, not your AWS account
        </span>
      </div>

      <div className="flex items-center gap-2">
        <button
          onClick={handleSwitch}
          className="text-[0.72rem] sm:text-[0.78rem] font-semibold px-2 sm:px-3 py-1 rounded-md cursor-pointer"
          style={{
            background: 'transparent',
            color: '#fff',
            border: '1px solid #fff',
            fontWeight: 700,
          }}
        >
          Switch to real data
        </button>
      </div>
    </div>
  )
}
