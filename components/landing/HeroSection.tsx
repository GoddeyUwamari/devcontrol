'use client'

import { useState, useEffect } from 'react'
import { ArrowRight, Play } from 'lucide-react'
import { AnimatedBackground } from './AnimatedBackground'
import { DashboardPreview } from './DashboardPreview'

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

const inner: React.CSSProperties = {
  maxWidth: '1400px',
  margin: '0 auto',
  padding: '0 32px',
}

export function HeroSection() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  return (
    <section
      className="relative overflow-hidden flex items-center"
      style={{ width: '100%', paddingTop: isMobile ? '40px' : '60px', paddingBottom: '0' }}
    >
      <AnimatedBackground />
      <div className="absolute inset-0 -z-10" style={{ background: 'linear-gradient(to bottom, #faf5ff, #ffffff)', pointerEvents: 'none' }} />

      <div style={{
        ...inner,
        padding: isMobile ? '0 16px' : isTablet ? '0 24px' : '0 32px',
        width: '100%', textAlign: 'center', position: 'relative', zIndex: 1,
      }}>

        {/* Headline */}
        <h1 className="font-extrabold leading-tight" style={{ fontSize: isMobile ? '2rem' : isTablet ? '2.8rem' : 'clamp(2.5rem, 6vw, 4rem)', marginBottom: '20px' }}>
          <span style={{ color: '#7c3aed' }}>Your AWS Is Leaking Money.</span>
          <div style={{ marginTop: isMobile ? '-8px' : '-18px' }}>
            <span style={{ color: '#111827', fontSize: isMobile ? '1.5rem' : isTablet ? '2rem' : 'clamp(2rem, 5vw, 2.6rem)' }}>DevControl Shows You Exactly Where.</span>
          </div>
        </h1>

        {/* Subheadline */}
        <p className="leading-relaxed" style={{ fontSize: isMobile ? '1rem' : '1.4rem', color: '#374151', maxWidth: '680px', margin: '0 auto 16px' }}>
         See exactly where your cloud spend is leaking, what risks exist, and what's slowing your team down — in one unified view.
        </p>

        {/* ROI line */}
        <p style={{ fontSize: isMobile ? '0.85rem' : '1rem', color: '#374151', marginBottom: '36px' }}>
          <strong style={{ color: '#059669' }}>$2,400/month avg savings (~$28,800/year)</strong>
          {' · '}
          First insight in <strong style={{ color: '#059669' }}>15 min</strong>
          {' · '}
          Read-only, zero risk
        </p>

        {/* CTA Buttons */}
        <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
          <a
            href="/register"
            style={{
              backgroundColor: '#7c3aed',
              color: '#fff',
              fontSize: '1rem',
              fontWeight: 700,
              padding: '14px 32px',
              borderRadius: '10px',
              border: 'none',
              cursor: 'pointer',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              boxShadow: '0 4px 20px rgba(124,58,237,0.35)',
              transition: 'all 0.2s ease',
              textDecoration: 'none',
              width: isMobile ? '100%' : 'auto',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.opacity = '0.9'
              e.currentTarget.style.transform = 'translateY(-1px)'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.opacity = '1'
              e.currentTarget.style.transform = 'translateY(0)'
            }}
          >
            Scan My AWS for Waste
            <ArrowRight size={18} />
          </a>

          <a
            href="/tour"
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: '8px',
              backgroundColor: 'transparent',
              color: '#374151',
              fontSize: '0.95rem',
              fontWeight: 500,
              padding: '14px 24px',
              borderRadius: '10px',
              border: '1.5px solid #e5e7eb',
              cursor: 'pointer',
              transition: 'all 0.2s ease',
              textDecoration: 'none',
              width: isMobile ? '100%' : 'auto',
            }}
            onMouseEnter={e => {
              e.currentTarget.style.borderColor = '#7c3aed'
              e.currentTarget.style.color = '#7c3aed'
            }}
            onMouseLeave={e => {
              e.currentTarget.style.borderColor = '#e5e7eb'
              e.currentTarget.style.color = '#374151'
            }}
          >
            <Play className="h-4 w-4" />
            Take a Product Tour
          </a>
        </div>

        <p style={{ fontSize: '0.9rem', color: '#374151', marginBottom: '24px' }}>
          Or <a href="/contact" style={{ color: '#7c3aed', fontWeight: 600, textDecoration: 'none' }}>book a 15-min AWS audit</a> with our team — free, no commitment
        </p>

        {/* Trust badges — tight under buttons */}
        <div style={{
          display: 'flex', flexWrap: 'wrap',
          justifyContent: 'center', gap: isMobile ? '12px' : '20px',
          fontSize: isMobile ? '0.75rem' : '0.82rem', fontWeight: 500, color: '#0F172A',
          marginTop: '16px',
          marginBottom: '0',
        }}>
          <span>🔐 AES-256 Encrypted</span>
          <span>🏅 SOC 2 In Progress</span>
          <span>☁️ AWS Cloud Partner</span>
          <span>🇪🇺 GDPR Friendly</span>
        </div>

        {/* Micro-preview strip */}
        <div style={{
          width: '100%',
          borderTop: '1px solid #e5e7eb',
          borderBottom: '1px solid #e5e7eb',
          padding: '14px 0',
          marginTop: '32px',
          background: 'rgba(255,255,255,0.6)',
        }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#0F172A', textTransform: 'uppercase', letterSpacing: '0.1em', textAlign: 'center', marginBottom: '10px' }}>
            What you get in 15 minutes
          </p>
          <div style={{ display: 'flex', flexDirection: isMobile ? 'column' : 'row', alignItems: 'center', justifyContent: 'center', gap: '0', flexWrap: 'wrap' }}>
            {[
              'Top cost leaks by service',
              'Risk exposure summary',
              'Service-level health breakdown',
              'Ranked fixes with dollar impact',
            ].map((item, i) => (
              <div key={item} style={{ display: 'flex', alignItems: 'center' }}>
                <span style={{ fontSize: '0.82rem', fontWeight: 500, color: '#0F172A', padding: isMobile ? '4px 12px' : '0 20px' }}>
                  {item}
                </span>
                {i < 3 && !isMobile && (
                  <span style={{ color: '#CBD5E1', fontSize: '1rem' }}>·</span>
                )}
              </div>
            ))}
          </div>
        </div>

        {/* Dashboard Screenshot */}
        <div style={{ marginTop: '24px', width: '100%' }}>
          <DashboardPreview />
        </div>

      </div>
    </section>
  )
}
