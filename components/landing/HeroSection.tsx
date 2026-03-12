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
        <h1 className="font-extrabold leading-tight" style={{ fontSize: 'clamp(2.5rem, 6vw, 4.5rem)', marginBottom: '20px' }}>
          <span style={{ color: '#7c3aed' }}>Stop Firefighting</span>
          <br />
          <span style={{ color: '#111827' }}>Your AWS Infrastructure</span>
        </h1>

        {/* Subheadline */}
        <p className="leading-relaxed" style={{ fontSize: '1.25rem', color: '#374151', maxWidth: '680px', margin: '0 auto 16px' }}>
          Eliminate AWS waste and security blind spots in 15 minutes. One dashboard for cost, performance, and peace of mind.
        </p>

        {/* Tagline */}
        <p
          className="font-bold"
          style={{
            fontSize: '1.1rem',
            color: '#111827',
            letterSpacing: '0.02em',
            marginBottom: '36px',
          }}
        >
          Ship faster.{' '}
          <span style={{ color: '#7c3aed' }}>Spend less.</span>{' '}
          Reduce risk.
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
            See My AWS Costs Free
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

        {/* Security trust badges */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          flexWrap: 'wrap',
          gap: '28px',
          marginTop: '20px',
        }}>
          {[
            { icon: '🔐', label: 'AES-256 Encrypted' },
            { icon: '🛡️', label: 'SOC 2 In Progress' },
            { icon: '☁️', label: 'AWS Cloud Partner' },
            { icon: '🇪🇺', label: 'GDPR Friendly' },
          ].map(badge => (
            <div key={badge.label} style={{
              display: 'flex',
              alignItems: 'center',
              gap: '6px',
              fontSize: '0.82rem',
              fontWeight: 500,
              color: '#374151',
            }}>
              <span>{badge.icon}</span>
              <span>{badge.label}</span>
            </div>
          ))}
        </div>

        {/* Mini how-it-works */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '8px',
          marginTop: '32px',
          flexWrap: 'wrap',
        }}>
          {[
            { step: '1', text: 'Deploy read-only IAM role' },
            { step: '2', text: 'DevControl scans your account' },
            { step: '3', text: 'See costs, risks & insights instantly' },
          ].map((item, i) => (
            <div key={i} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div style={{
                width: '24px',
                height: '24px',
                borderRadius: '50%',
                backgroundColor: '#7c3aed',
                color: '#fff',
                fontSize: '0.75rem',
                fontWeight: 700,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                flexShrink: 0,
              }}>
                {item.step}
              </div>
              <span style={{
                fontSize: '0.85rem',
                fontWeight: 500,
                color: '#374151',
              }}>
                {item.text}
              </span>
              {i < 2 && (
                <span style={{ color: '#d1d5db', fontSize: '1.2rem', margin: '0 4px' }}>→</span>
              )}
            </div>
          ))}
        </div>

      </div>
    </section>
  )
}
