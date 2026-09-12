'use client'

import { useEffect, useState } from 'react'

function useWindowWidth() {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const update = () => setWidth(window.innerWidth)
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])
  return width
}

export function DashboardPreview() {
  const [imageError, setImageError] = useState(false)
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640

  return (
    <>
      {/* Dashboard screenshot section */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(to bottom, #ede9fe, #ffffff)',
        padding: isMobile ? '24px 16px 32px' : '56px 48px 72px',
      }}>
        <div style={{ maxWidth: '1300px', margin: '0 auto', width: '100%' }}>
          {!imageError ? (
            <img
              src="/landing/dashboard-preview.png"
              alt="DevControl Dashboard"
              style={{
                width: '100%',
                borderRadius: isMobile ? '12px' : '20px',
                boxShadow: isMobile ? '0 8px 32px rgba(0,0,0,0.2)' : '0 32px 80px rgba(0,0,0,0.5)',
                display: 'block',
              }}
              onError={() => setImageError(true)}
            />
          ) : (
            <div style={{
              background: 'rgba(255,255,255,0.08)',
              borderRadius: isMobile ? '12px' : '20px',
              aspectRatio: '16/9',
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              border: '2px dashed rgba(255,255,255,0.2)',
            }}>
              <div style={{ fontSize: '3rem', marginBottom: '16px' }}>📊</div>
              <p style={{ fontSize: '1.1rem', fontWeight: 600, color: '#fff', marginBottom: '8px' }}>Dashboard Preview</p>
              <p style={{ fontSize: '0.875rem', color: 'rgba(255,255,255,0.6)' }}>Add screenshot at /public/landing/dashboard-preview.png</p>
            </div>
          )}
        </div>
      </section>
    </>
  )
}