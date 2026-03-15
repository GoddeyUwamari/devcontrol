'use client'

import { useEffect } from 'react'
import { useRouter } from 'next/navigation'

export default function DemoPage() {
  const router = useRouter()

  useEffect(() => {
    // Activate Dev Demo Mode
    localStorage.setItem('devcontrol_demo_mode', 'true')
    window.dispatchEvent(new CustomEvent('demo-mode-changed', { detail: { enabled: true } }))

    // Activate Sales Demo Mode (Zustand persist)
    const store = JSON.parse(localStorage.getItem('sales-demo-mode') || '{}')
    localStorage.setItem('sales-demo-mode', JSON.stringify({
      ...store,
      state: { ...store.state, enabled: true }
    }))

    // Redirect to dashboard
    router.replace('/dashboard')
  }, [router])

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: '#F9FAFB',
      fontFamily: 'Inter, system-ui, sans-serif',
    }}>
      <div style={{ textAlign: 'center' }}>
        <div style={{
          width: '48px',
          height: '48px',
          borderRadius: '12px',
          background: '#7C3AED',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          margin: '0 auto 16px',
        }}>
          <span style={{ color: '#fff', fontSize: '20px' }}>DC</span>
        </div>
        <p style={{ fontSize: '0.875rem', color: '#475569', margin: 0 }}>
          Activating demo mode...
        </p>
      </div>
    </div>
  )
}
