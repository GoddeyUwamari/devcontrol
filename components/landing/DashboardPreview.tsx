'use client'

import { useState } from 'react'

/**
 * DashboardPreview Component
 *
 * Displays a dashboard screenshot with browser chrome.
 * Falls back to placeholder if image doesn't exist.
 */
export function DashboardPreview() {
  const [imageError, setImageError] = useState(false)

  return (
    <div style={{ maxWidth: '1400px', margin: '0 auto', width: '100%' }}>
      {!imageError ? (
        <img
          src="/landing/dashboard-preview.png"
          alt="DevControl Dashboard"
          style={{ width: '100%', borderRadius: '16px', boxShadow: '0 8px 40px rgba(0,0,0,0.12)', display: 'block' }}
          onError={() => setImageError(true)}
        />
      ) : (
        <div style={{ background: 'linear-gradient(135deg, #faf5ff, #f3e8ff)', borderRadius: '16px', aspectRatio: '16/9', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', border: '2px dashed #e5e7eb' }}>
          <div style={{ fontSize: '3rem', marginBottom: '16px' }}>📊</div>
          <p style={{ fontSize: '1rem', fontWeight: 600, color: '#374151', marginBottom: '8px' }}>Dashboard Preview</p>
          <p style={{ fontSize: '0.875rem', color: '#6b7280' }}>Add screenshot at /public/landing/dashboard-preview.png</p>
        </div>
      )}
    </div>
  )
}
