'use client'

import { useState, useEffect } from 'react'

function useWindowWidth() {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    setWidth(window.innerWidth)
    const handler = () => setWidth(window.innerWidth)
    window.addEventListener('resize', handler)
    return () => window.removeEventListener('resize', handler)
  }, [])
  return width
}

export default function CaseStudiesPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  return (
    <main style={{ width: '100%', minHeight: '100vh', background: '#fff' }}>

      {/* Hero */}
      <section style={{
        background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #fff 100%)',
        padding: isMobile ? '48px 16px 36px' : isTablet ? '64px 32px 48px' : '80px 48px 60px',
        textAlign: 'center',
        borderBottom: '1px solid #f3f4f6',
        width: '100%',
      }}>
        <div style={{
          display: 'inline-flex', alignItems: 'center', gap: '6px',
          background: '#7c3aed', border: 'none',
          borderRadius: '999px', padding: '6px 14px',
          fontSize: '0.78rem', fontWeight: 600, color: '#ffffff',
          marginBottom: '24px', letterSpacing: '0.04em', textTransform: 'uppercase' as const,
        }}>
          Customer Stories
        </div>

        <h1 style={{
          fontSize: isMobile ? 'clamp(1.8rem,5vw,2.4rem)' : 'clamp(2rem, 4vw, 3rem)',
          fontWeight: 700,
          color: '#1e1b4b', lineHeight: 1.15, marginBottom: '16px',
          letterSpacing: '-0.02em',
        }}>
          See It Work On Your Own AWS Account
        </h1>

        <p style={{
          fontSize: isMobile ? '1.05rem' : '1.1rem', color: '#1f2937', lineHeight: 1.7,
          maxWidth: '520px', margin: '0 auto',
        }}>
          We&apos;re early, so instead of someone else&apos;s story, connect your AWS
          account and see your own cost, security, and infrastructure insights in minutes.
        </p>
      </section>

      {/* Bottom CTA */}
      <section style={{
        background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
        padding: isMobile ? '48px 24px' : isTablet ? '64px 32px' : '80px 48px',
        textAlign: 'center', width: '100%',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
        <h2 style={{
          fontSize: isMobile ? '1.6rem' : '2.2rem', fontWeight: 800, color: '#fff',
          marginBottom: '16px', letterSpacing: '-0.02em',
        }}>
          Ready to write your own success story?
        </h2>
        <p style={{
          fontSize: isMobile ? '0.95rem' : '1.1rem', color: 'rgba(255,255,255,0.85)',
          maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
        }}>
          Connect your AWS account and find your own savings opportunities in minutes.
        </p>
        <div style={{
          display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap',
          flexDirection: isMobile ? 'column' : 'row',
          alignItems: isMobile ? 'stretch' : undefined,
        }}>
          <a
            href="/register"
            style={{
              background: '#fff', color: '#7c3aed', padding: '14px 32px',
              borderRadius: '10px', fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              width: isMobile ? '100%' : undefined, boxSizing: 'border-box',
              textAlign: 'center', display: 'inline-block',
            }}
          >
            Start Free Trial
          </a>
          <a
            href="/tour"
            style={{
              background: 'transparent', color: '#fff', padding: '14px 32px',
              borderRadius: '10px', fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.4)',
              width: isMobile ? '100%' : undefined, boxSizing: 'border-box',
              textAlign: 'center', display: 'inline-block',
            }}
          >
            Take a Product Tour
          </a>
        </div>
        <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginTop: '16px' }}>
          No credit card required · 14-day free trial · Read-only AWS access
        </div>
        </div>
      </section>

    </main>
  )
}
