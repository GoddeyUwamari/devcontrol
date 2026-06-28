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

const companies = [
  'Stripe', 'Notion', 'Vercel', 'Linear', 'Retool', 'Figma',
  'Loom', 'Rippling', 'Brex', 'Amplitude',
]
const doubled = [...companies, ...companies]

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

      {/* Ticker section — white background */}
      <div style={{
        overflow: 'hidden',
        maxWidth: '100%',
        backgroundColor: '#fafafa',
        paddingTop: isMobile ? '40px' : '70px',
        paddingBottom: isMobile ? '40px' : '56px',
        borderBottom: '1px solid #f3f4f6',
      }}>
        <p style={{
          textAlign: 'center',
          fontSize: isMobile ? '11px' : '13px',
          fontWeight: 600,
          letterSpacing: '0.15em',
          color: '#6b7280',
          textTransform: 'uppercase',
          marginBottom: isMobile ? '20px' : '28px',
        }}>
          Trusted by engineers from companies including
        </p>

        <div style={{ position: 'relative', overflow: 'hidden', maxWidth: '100vw', contain: 'paint' }}>
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: isMobile ? '40px' : '120px', background: 'linear-gradient(to right, #fafafa, transparent)', zIndex: 2 }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: isMobile ? '40px' : '120px', background: 'linear-gradient(to left, #fafafa, transparent)', zIndex: 2 }} />

          <div
            style={{
              display: 'flex',
              gap: isMobile ? '24px' : '56px',
              alignItems: 'center',
              animation: 'ticker-scroll 30s linear infinite',
              width: 'max-content',
            }}
          >
            {doubled.map((name, i) => (
              <span
                key={i}
                style={{
                  fontSize: isMobile ? '18px' : '24px',
                  fontWeight: 700,
                  color: '#1f2937',
                  whiteSpace: 'nowrap',
                  letterSpacing: '-0.02em',
                  transition: 'color 0.2s ease',
                  cursor: 'default',
                }}
                onMouseEnter={e => (e.currentTarget.style.color = '#7c3aed')}
                onMouseLeave={e => (e.currentTarget.style.color = '#1f2937')}
              >
                {name}
              </span>
            ))}
          </div>
        </div>
      </div>

      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </>
  )
}