'use client'

import { Layers, GitBranch, Shield, BarChart3, Zap, Search, RefreshCw, Lock } from 'lucide-react'
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

export default function PlatformEngineersPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  const features = [
    { icon: Layers, title: 'Internal Developer Portal Alternative', desc: 'Give every engineer a self-service view of infrastructure they own — costs, health, dependencies, and drift status — without building it yourself.' },
    { icon: GitBranch, title: 'Terraform & CDK Drift Detection', desc: 'Real-time alerts when live infrastructure diverges from IaC definitions. Know immediately which resources were modified outside of your standard deployment process.' },
    { icon: Search, title: 'Universal Resource Discovery', desc: 'Auto-discover every resource across every account and region. Build and maintain your CMDB automatically — no manual inventory, no stale data.' },
    { icon: Shield, title: 'Policy Enforcement at Scale', desc: 'Define tagging policies, security baselines, and cost guardrails that apply across all accounts. Auto-remediate violations without manual intervention.' },
    { icon: BarChart3, title: 'Platform Health Metrics', desc: 'Track the health and adoption of your internal platform. See which teams are following standards, where drift is highest, and which services need attention.' },
    { icon: RefreshCw, title: 'Change Management & Audit Trail', desc: 'Every infrastructure change logged with who made it, when, and what changed. Essential for post-incident reviews, compliance audits, and debugging complex issues.' },
    { icon: Zap, title: 'Developer Self-Service Dashboards', desc: 'Give product engineers read-only access to their own service costs and health metrics. Reduce platform team toil by letting engineers answer their own questions.' },
    { icon: Lock, title: 'Governance Without Gatekeeping', desc: 'Enforce standards automatically so platform engineers spend time building, not policing. Guardrails run in the background — teams move fast without breaking things.' },
  ]

  const impacts = [
    { value: '80%', label: 'Reduction in manual inventory work' },
    { value: '< 1min', label: 'Time to detect drift' },
    { value: '50+', label: 'AWS resource types governed' },
  ]

  const maturityLevels = [
    {
      level: '01',
      title: 'Reactive',
      subtitle: 'Where most teams start',
      color: '#ef4444',
      bg: 'rgba(239,68,68,0.06)',
      border: 'rgba(239,68,68,0.2)',
      points: [
        'Manual AWS console access for inventory',
        'No standard tagging or cost attribution',
        'Drift discovered during incidents',
        'Security issues found at audit time',
      ],
    },
    {
      level: '02',
      title: 'Proactive',
      subtitle: 'Where DevControl takes you in week 1',
      color: '#f59e0b',
      bg: 'rgba(245,158,11,0.06)',
      border: 'rgba(245,158,11,0.2)',
      points: [
        'Automated resource discovery across all accounts',
        'Tagging policies enforced automatically',
        'Drift detected within minutes of occurring',
        'Continuous security scanning active',
      ],
    },
    {
      level: '03',
      title: 'Elite',
      subtitle: 'Where DevControl takes you in month 1',
      color: '#7c3aed',
      bg: 'rgba(124,58,237,0.12)',
      border: 'rgba(124,58,237,0.2)',
      points: [
        'Self-service dashboards for every team',
        'Auto-remediation handles routine violations',
        'Platform health metrics tracked and improving',
        'Zero-toil governance running in the background',
      ],
    },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO — Dark with grid pattern */}
      <section style={{
        width: '100%',
        background: '#0f172a',
        padding: isMobile ? '60px 20px 48px' : isTablet ? '100px 32px 72px' : '140px 48px 100px',
        borderBottom: '1px solid #1e293b',
        position: 'relative',
        overflow: 'hidden',
      }}>
        {/* Grid pattern overlay */}
        <div style={{
          position: 'absolute', inset: 0,
          backgroundImage: 'linear-gradient(rgba(124,58,237,0.14) 1px, transparent 1px), linear-gradient(90deg, rgba(124,58,237,0.14) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
          pointerEvents: 'none',
        }} />

        <div style={{ maxWidth: '1400px', margin: '0 auto', textAlign: 'center', position: 'relative', zIndex: 1 }}>

          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
            borderRadius: '100px', padding: '6px 16px',
            fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa',
            marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Solutions · Platform Engineers
          </div>

          <h1 style={{
            fontSize: isMobile ? '1.9rem' : 'clamp(2.2rem, 5vw, 3.5rem)',
            fontWeight: 800, color: '#fff',
            lineHeight: 1.1, marginBottom: '20px',
            letterSpacing: '-0.02em', maxWidth: '900px', margin: '0 auto 20px',
          }}>
            The Control Plane Your{' '}
            <span style={{ color: '#a78bfa' }}>Internal Platform Is Missing</span>
          </h1>

          <p style={{
            fontSize: isMobile ? '1rem' : '1.15rem', color: '#94a3b8',
            lineHeight: 1.75, maxWidth: '640px',
            margin: '0 auto 36px',
          }}>
            Stop building internal tooling from scratch. DevControl gives platform engineering
            teams unified visibility, drift detection, policy enforcement, and developer
            self-service — deployed in 15 minutes, not 6 months.
          </p>

          <div style={{
            display: 'flex', gap: '16px', justifyContent: 'center',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'center' : undefined,
            flexWrap: 'wrap', marginBottom: '36px',
          }}>
            <a href="/register" style={{
              background: '#7c3aed', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              boxShadow: '0 4px 24px rgba(124,58,237,0.4)',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              Start Free Trial
            </a>
            <a href="/tour" style={{
              background: 'transparent', color: '#e2e8f0',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '1.5px solid #334155',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              See How It Works
            </a>
          </div>

          <div style={{
            display: 'flex', flexWrap: 'wrap',
            justifyContent: 'center', gap: isMobile ? '12px' : '24px',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: 'center',
            fontSize: '0.875rem', fontWeight: 500, color: '#94a3b8',
          }}>
            {['No agents required', 'IaC drift detection', 'Developer self-service'].map(t => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#a78bfa' }}>✓</span> {t}
              </span>
            ))}
          </div>

          <p style={{ fontSize: '0.9rem', color: '#94a3b8', marginTop: '24px', fontStyle: 'italic' }}>
            {'A platform team of 4 engineers replaced 3 internal tools with DevControl — reducing platform toil by 60% in 30 days.'}
          </p>
        </div>
      </section>

      {/* BUSINESS IMPACT BAR */}
      <section style={{ padding: isMobile ? '32px 20px' : isTablet ? '40px 32px' : '48px', background: '#fafafa', borderBottom: '1px solid #f3f4f6' }}>
        <div style={{
          maxWidth: '1400px', margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
          gap: isMobile ? '24px' : '32px', textAlign: 'center',
        }}>
          {impacts.map(({ value, label }) => (
            <div key={label}>
              <div style={{ fontSize: isMobile ? '2rem' : '2.5rem', fontWeight: 800, color: '#7c3aed', lineHeight: 1 }}>
                {value}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#374151', fontWeight: 500, marginTop: '8px' }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES — 2 col alternating backgrounds */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px', width: '100%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Platform Capabilities
            </div>
            <h2 style={{
              fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              Everything Your Platform Team Needs to Scale
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              Stop building internal tooling. Start governing infrastructure — automatically.
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
            gap: '20px',
          }}>
            {features.map(({ icon: Icon, title, desc }, i) => (
              <div key={title} style={{
                background: i % 2 === 0 ? '#faf5ff' : '#fff',
                border: i % 2 === 0 ? '1.5px solid rgba(124,58,237,0.15)' : '1.5px solid #e5e7eb',
                borderRadius: '16px', padding: isMobile ? '24px' : '32px',
                transition: 'all 0.2s ease',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#7c3aed'
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(124,58,237,0.12)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = i % 2 === 0 ? 'rgba(124,58,237,0.15)' : '#e5e7eb'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <div style={{
                  width: '48px', height: '48px', borderRadius: '12px',
                  background: 'rgba(124,58,237,0.14)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '20px',
                }}>
                  <Icon size={22} style={{ color: '#7c3aed' }} />
                </div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', marginBottom: '10px' }}>
                  {title}
                </h3>
                <p style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.75 }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* MATURITY MODEL */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Platform Engineering Maturity
            </div>
            <h2 style={{
              fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              Where Are You Today? Where Could You Be?
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              Most platform teams move from Reactive to Elite within 30 days of using DevControl.
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gap: '24px',
          }}>
            {maturityLevels.map(({ level, title, subtitle, color, bg, border, points }) => (
              <div key={level} style={{
                background: bg,
                border: `1.5px solid ${border}`,
                borderRadius: '20px',
                padding: isMobile ? '28px' : '36px',
              }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '50%',
                  background: color, color: '#fff',
                  fontSize: '1rem', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '16px',
                }}>
                  {level}
                </div>
                <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '4px' }}>
                  {title}
                </h3>
                <p style={{ fontSize: '0.8rem', color: '#374151', fontWeight: 500, marginBottom: '24px' }}>
                  {subtitle}
                </p>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {points.map(point => (
                    <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      <span style={{ color, fontWeight: 700, marginTop: '1px', fontSize: '1rem' }}>✓</span>
                      <span style={{ fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>{point}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section style={{ padding: isMobile ? '40px 20px' : isTablet ? '52px 32px' : '64px 48px', background: '#fff', borderTop: '1px solid #f1f5f9', borderBottom: '1px solid #f1f5f9' }}>
        <div style={{ maxWidth: '900px', margin: '0 auto', textAlign: 'center' }}>
          <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '24px' }}>
            Platform Engineering Result
          </p>
          <p style={{ fontSize: isMobile ? '1.05rem' : '1.25rem', fontWeight: 600, color: '#0f172a', lineHeight: 1.65, marginBottom: '28px', maxWidth: '700px', margin: '0 auto 28px' }}>
            {'\u201C'}We replaced our internal Backstage implementation, a custom drift detector, and a homegrown tagging enforcer with DevControl. Setup took an afternoon. We got{' '}
            <span style={{ color: '#7c3aed', fontWeight: 800 }}>3 months of platform work back</span>
            {' immediately.\u201D'}
          </p>
          <div style={{
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '16px',
            marginBottom: '40px',
            flexDirection: isMobile ? 'column' : 'row',
          }}>
            <div style={{
              width: '44px', height: '44px', borderRadius: '50%',
              background: '#EDE9FE', color: '#7C3AED',
              fontWeight: 700, fontSize: '13px',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              TN
            </div>
            <div style={{ textAlign: isMobile ? 'center' : 'left' }}>
              <p style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A', margin: 0 }}>Tom N.</p>
              <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>Staff Platform Engineer · Series B SaaS · 80 engineers</p>
            </div>
            <div style={{
              marginLeft: isMobile ? '0' : '8px',
              background: '#ECFDF5', color: '#059669',
              padding: '4px 12px', borderRadius: '999px',
              fontSize: '11px', fontWeight: 600,
            }}>
              Replaced 3 internal tools
            </div>
          </div>
          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
            gap: '0', border: '1px solid #E2E8F0', borderRadius: '12px', overflow: 'hidden',
          }}>
            {[
              { value: '3 tools', label: 'Replaced by DevControl' },
              { value: '1 afternoon', label: 'Setup time' },
              { value: '60%', label: 'Reduction in platform toil' },
              { value: '30 days', label: 'To Elite maturity tier' },
            ].map(({ value, label }, i) => (
              <div key={label} style={{
                padding: isMobile ? '16px 12px' : '20px 16px', textAlign: 'center',
                borderRight: isMobile ? (i % 2 === 0 ? '1px solid #E2E8F0' : 'none') : (i < 3 ? '1px solid #E2E8F0' : 'none'),
                borderBottom: isMobile && i < 2 ? '1px solid #E2E8F0' : 'none',
                background: i % 2 === 0 ? '#F8FAFC' : '#fff',
              }}>
                <p style={{ fontSize: isMobile ? '1.1rem' : '1.3rem', fontWeight: 800, color: '#7c3aed', margin: '0 0 4px' }}>{value}</p>
                <p style={{ fontSize: '0.72rem', color: '#64748B', margin: 0 }}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Built For Your Team
            </div>
            <h2 style={{
              fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              Who It&apos;s For
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
            gap: '24px',
          }}>
            <div style={{
              background: '#fff', border: '1.5px solid #e5e7eb',
              borderRadius: '20px', padding: isMobile ? '28px' : '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: 'rgba(124,58,237,0.14)',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For Platform Engineers
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Build Less. Govern More.
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Stop building internal dashboards from scratch',
                  'Drift detection without custom tooling',
                  'Policy enforcement that runs automatically',
                  'Developer self-service reduces platform team toil',
                ].map(point => (
                  <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ color: '#7c3aed', fontWeight: 700, marginTop: '1px' }}>✓</span>
                    <span style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6 }}>{point}</span>
                  </div>
                ))}
              </div>
            </div>

            <div style={{
              background: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
              border: '1.5px solid rgba(124,58,237,0.2)',
              borderRadius: '20px', padding: isMobile ? '28px' : '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: '#7c3aed',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For Engineering Leadership
              </div>
              <h3 style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Platform That Scales With Your Organization
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Platform adoption metrics across all engineering teams',
                  'Standards compliance tracked and improving over time',
                  'Reduce time-to-production for new services',
                  'Full audit trail for compliance and post-incident reviews',
                ].map(point => (
                  <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ color: '#7c3aed', fontWeight: 700, marginTop: '1px' }}>✓</span>
                    <span style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.6 }}>{point}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
        padding: isMobile ? '56px 20px' : isTablet ? '64px 32px' : '80px 48px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800,
            color: '#fff', marginBottom: '16px', letterSpacing: '-0.02em',
          }}>
            Your Platform. Finally Under Control.
          </h2>
          <p style={{
            fontSize: '1.1rem', color: 'rgba(255,255,255,0.85)',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            Stop building internal tools. Start governing your infrastructure automatically — in 15 minutes.
          </p>
          <div style={{
            display: 'flex', gap: '16px', justifyContent: 'center',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'center' : undefined,
            flexWrap: 'wrap',
          }}>
            <a href="/register" style={{
              background: '#fff', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              Start Free Trial
            </a>
            <a href="/tour" style={{
              background: 'transparent', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.4)',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              Take a Product Tour
            </a>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginTop: '16px' }}>
            No credit card required · Read-only AWS access · Cancel anytime
          </div>
        </div>
      </section>

    </div>
  )
}
