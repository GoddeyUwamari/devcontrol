'use client'

import { ArrowRight, Play } from 'lucide-react'
import { AnimatedBackground } from './AnimatedBackground'

const inner: React.CSSProperties = {
  maxWidth: '1400px',
  margin: '0 auto',
  padding: '0 32px',
}

export function HeroSection() {
  return (
    <section
      className="relative overflow-hidden flex items-center"
      style={{ width: '100%', paddingTop: '136px', paddingBottom: '32px' }}
    >
      <AnimatedBackground />
      <div className="absolute inset-0 -z-10" style={{ background: 'linear-gradient(to bottom, #faf5ff, #ffffff)', pointerEvents: 'none' }} />

      <div style={{ ...inner, width: '100%', textAlign: 'center', position: 'relative', zIndex: 1 }}>

        {/* Headline */}
       <h1 className="font-extrabold leading-tight" style={{ fontSize: 'clamp(2.5rem, 6vw, 4rem)', marginBottom: '20px' }}>
  <span style={{ color: '#7c3aed' }}>Your AWS Is Leaking Money.</span>
  <div style={{ marginTop: '-18px' }}>
    <span style={{ color: '#111827', fontSize: 'clamp(2rem, 5vw, 2.6rem)' }}>DevControl Shows You Exactly Where.</span>
  </div>
</h1>

        {/* Subheadline */}
        <p className="leading-relaxed" style={{ fontSize: '1.4rem', color: '#374151', maxWidth: '680px', margin: '0 auto 16px' }}>
          Cut cloud costs, detect risks early, and eliminate infrastructure blind spots — from one AI-powered command center.
        </p>

        {/* Tagline */}
        <p
          className="font-bold"
          style={{
            fontSize: '1.2rem',
            color: '#111827',
            letterSpacing: '0.02em',
            marginBottom: '12px',
          }}
        >
          Ship faster.{' '}
          <span style={{ color: '#7c3aed' }}>Spend less.</span>{' '}
          Reduce risk.
        </p>

        {/* ROI line */}
        <p style={{ fontSize: '1rem', color: '#374151', marginBottom: '36px' }}>
          <strong style={{ color: '#059669' }}>$2,400/month avg savings</strong>
          {' · '}
          First insight in <strong style={{ color: '#059669' }}>15 min</strong>
          {' · '}
          Read-only, zero risk to your infra
        </p>

        {/* CTA Buttons */}
        <div style={{ display: 'flex', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: '16px', flexWrap: 'wrap', marginBottom: '24px' }}>
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
              gap: '8px',
              boxShadow: '0 4px 20px rgba(124,58,237,0.35)',
              transition: 'all 0.2s ease',
              textDecoration: 'none',
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

        {/* Trust badges — tight under buttons */}
        <div style={{
          display: 'flex', flexWrap: 'wrap',
          justifyContent: 'center', gap: '20px',
          fontSize: '0.82rem', fontWeight: 500, color: '#374151',
          marginTop: '16px',
          marginBottom: '0',
        }}>
          <span>🔐 AES-256 Encrypted</span>
          <span>🏅 SOC 2 Ready</span>
          <span>☁️ AWS Cloud Partner</span>
          <span>🇪🇺 GDPR Friendly</span>
        </div>

        {/* How it works */}
        <div style={{
          width: '100%',
          background: 'rgba(124,58,237,0.04)',
          border: '1.5px solid rgba(124,58,237,0.1)',
          borderRadius: '20px',
          padding: '28px 32px',
          marginTop: '48px',
        }}>
          <div style={{
            textAlign: 'center',
            fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed',
            letterSpacing: '0.12em', textTransform: 'uppercase' as const,
            marginBottom: '20px',
          }}>
            How it works — 4 steps, 15 minutes
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: '16px',
            width: '100%',
          }}>
            {[
              { step: '1', title: 'Secure Connection', sub: 'Read-only IAM role' },
              { step: '2', title: 'Instant Analysis', sub: 'Automated scanning' },
              { step: '3', title: 'Get Insights', sub: 'Full dashboard access' },
              { step: '4', title: 'Take Action', sub: 'AI-powered recommendations' },
            ].map(({ step, title, sub }) => (
              <div key={step} style={{
                background: '#fff',
                border: '1.5px solid #e5e7eb',
                borderRadius: '14px',
                padding: '24px 16px',
                textAlign: 'center',
                boxShadow: '0 2px 8px rgba(0,0,0,0.05)',
              }}>
                <div style={{
                  width: '32px', height: '32px', borderRadius: '50%',
                  background: '#7c3aed', color: '#fff',
                  fontSize: '0.85rem', fontWeight: 700,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 12px',
                }}>
                  {step}
                </div>
                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#0f172a', marginBottom: '4px' }}>
                  {title}
                </div>
                <div style={{ fontSize: '0.78rem', color: '#374151' }}>
                  {sub}
                </div>
              </div>
            ))}
          </div>
        </div>

      </div>
    </section>
  )
}
