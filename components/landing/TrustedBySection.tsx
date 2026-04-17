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

export function TrustedBySection() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const companies = [
    'Stripe', 'Notion', 'Vercel', 'Linear', 'Retool', 'Figma',
    'Loom', 'Rippling', 'Brex', 'Amplitude',
  ]

  const doubled = [...companies, ...companies]

  return (
    <div style={{ overflow: 'hidden', maxWidth: '100%' }}>
    <section style={{ width: '100%', padding: isMobile ? '32px 0' : '48px 0', background: '#fafafa', borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6', overflow: 'hidden' }}>
      <p style={{ textAlign: 'center', fontSize: isMobile ? '11px' : '14px', fontWeight: '600', letterSpacing: '0.15em', color: '#1f2937', textTransform: 'uppercase', marginBottom: isMobile ? '20px' : '28px' }}>
        Trusted by engineers from companies including
      </p>

      <div style={{ position: 'relative', overflow: 'hidden', maxWidth: '100vw', contain: 'paint' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: isMobile ? '60px' : '120px', background: 'linear-gradient(to right, #fafafa, transparent)', zIndex: 2 }} />
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: isMobile ? '60px' : '120px', background: 'linear-gradient(to left, #fafafa, transparent)', zIndex: 2 }} />

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
                fontSize: '22px',
                fontWeight: '700',
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

      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </section>
    </div>
  )
}
