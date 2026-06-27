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
        padding: '56px 48px 72px',
      }}>
        <div style={{ maxWidth: '1300px', margin: '0 auto', width: '100%' }}>
          {!imageError ? (
            <img
              src="/landing/dashboard-preview.png"
              alt="DevControl Dashboard"
              style={{
                width: '100%',
                borderRadius: '20px',
                boxShadow: '0 32px 80px rgba(0,0,0,0.5)',
                display: 'block',
              }}
              onError={() => setImageError(true)}
            />
          ) : (
            <div style={{
              background: 'rgba(255,255,255,0.08)',
              borderRadius: '20px',
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
        paddingTop: '70px',
        paddingBottom: '56px',
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
          <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: isMobile ? '60px' : '120px', background: 'linear-gradient(to right, #ffffff, transparent)', zIndex: 2 }} />
          <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: isMobile ? '60px' : '120px', background: 'linear-gradient(to left, #ffffff, transparent)', zIndex: 2 }} />

          <div
            style={{
              display: 'flex',
              gap: isMobile ? '32px' : '56px',
              alignItems: 'center',
              animation: 'ticker-scroll 30s linear infinite',
              width: 'max-content',
            }}
          >
            {doubled.map((name, i) => (
              <span
                key={i}
                style={{
                  fontSize: '24px',
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