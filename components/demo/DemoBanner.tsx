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
    <div style={{
      background: '#7C3AED',
      borderBottom: '1px solid #6D28D9',
      padding: '8px 24px',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      position: 'relative',
      zIndex: 60,
    }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
        <span style={{
          width: '6px',
          height: '6px',
          borderRadius: '50%',
          background: '#EDE9FE',
          display: 'inline-block',
          flexShrink: 0,
        }} />
        <span style={{ fontSize: '0.82rem', fontWeight: 600, color: '#FFFFFF' }}>
          {salesDemoMode ? 'Sales Demo Mode active' : 'Demo Mode active'}
        </span>
        <span style={{ fontSize: '0.82rem', color: '#EDE9FE' }}>
          · Showing curated data for presentations
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
        <button
          onClick={handleSwitch}
          style={{
            background: 'rgba(255,255,255,0.15)',
            border: '1px solid rgba(255,255,255,0.25)',
            borderRadius: '6px',
            padding: '4px 12px',
            fontSize: '0.78rem',
            fontWeight: 600,
            color: '#FFFFFF',
            cursor: 'pointer',
          }}
        >
          Switch to real data
        </button>
        <button
          onClick={handleDismiss}
          style={{
            background: 'transparent',
            border: 'none',
            padding: '4px',
            cursor: 'pointer',
            color: '#EDE9FE',
            display: 'flex',
            alignItems: 'center',
          }}
        >
          <X size={14} />
        </button>
      </div>
    </div>
  )
}
