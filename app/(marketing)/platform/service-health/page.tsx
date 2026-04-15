'use client'

import { useEffect, useState } from 'react'
import { Activity, Bell, Clock, Shield, Zap, BarChart3, AlertTriangle, CheckCircle } from 'lucide-react'

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

export default function ServiceHealthPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  const features = [
    {
      icon: Activity,
      title: 'Real-Time Uptime Monitoring',
      desc: 'Know the moment any service goes down. DevControl tracks uptime across every service, endpoint, and dependency — with instant alerts before your customers notice.',
    },
    {
      icon: BarChart3,
      title: 'SLO Tracking & Breach Alerts',
      desc: 'Define service level objectives and track them continuously. Get alerted before you breach SLOs — not after. Share reliability reports with stakeholders in one click.',
    },
    {
      icon: Clock,
      title: 'Mean Time to Recovery (MTTR)',
      desc: 'Track how fast your team recovers from incidents. Benchmark your MTTR against Elite engineering standards and identify where your incident response is slowing down.',
    },
    {
      icon: AlertTriangle,
      title: 'Incident Detection & Correlation',
      desc: 'When something breaks, DevControl shows you what changed, which services are affected, and the blast radius — so you spend time fixing, not investigating.',
    },
    {
      icon: Bell,
      title: 'Smart Alert Routing',
      desc: 'Route alerts to the right engineer via Slack or PagerDuty. Intelligent deduplication reduces noise so your on-call team focuses on real incidents.',
    },
    {
      icon: Shield,
      title: 'Dependency Impact Mapping',
      desc: 'Understand how every service connects before making changes. See upstream and downstream dependencies so you know the full blast radius of any incident.',
    },
  ]

  const impacts = [
    { value: '60%', label: 'Reduction in MTTR' },
    { value: '< 1min', label: 'Time to incident detection' },
    { value: '99.9%', label: 'Uptime visibility accuracy' },
  ]

  const steps = [
    { step: '01', title: 'Connect Your Services', desc: 'Link your AWS account and GitHub. DevControl automatically discovers every service, endpoint, and dependency — no manual configuration.' },
    { step: '02', title: 'Define Your SLOs', desc: 'Set uptime targets and error budgets per service. DevControl starts tracking immediately against your defined objectives.' },
    { step: '03', title: 'Get Alerted Instantly', desc: 'Configure Slack and PagerDuty routing. The right engineer gets alerted within seconds of any service degradation.' },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #faf5ff 0%, #f3e8ff 50%, #fff 100%)',
        padding: isMobile ? '48px 16px' : isTablet ? '64px 32px' : '80px 48px',
        borderBottom: '1px solid #f3f4f6',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', textAlign: 'center' }}>

          <div style={{
            display: 'inline-flex', alignItems: 'center',
            background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(124,58,237,0.2)',
            borderRadius: '100px', padding: '6px 16px',
            fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
            marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Platform · Service Health
          </div>

          <h1 style={{
            fontSize: isMobile ? 'clamp(1.8rem,5vw,2.6rem)' : 'clamp(2.2rem,5vw,3.2rem)',
            fontWeight: 800, color: '#0f172a',
            lineHeight: 1.15, marginBottom: '20px',
            letterSpacing: '-0.02em', maxWidth: '800px', margin: '0 auto 20px',
          }}>
            Know When Services Break.{' '}
            <span style={{ color: '#7c3aed' }}>Fix Them Before Customers Notice.</span>
          </h1>

          <p style={{
            fontSize: isMobile ? '0.95rem' : '1.15rem', color: '#374151',
            lineHeight: 1.75, maxWidth: '600px',
            margin: '0 auto 36px',
          }}>
            Real-time uptime monitoring, SLO tracking, and incident detection
            across every service — with smart alerts routed to the right engineer
            in under 60 seconds.
          </p>

          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: '16px',
            justifyContent: 'center',
            flexWrap: 'wrap',
            marginBottom: '36px',
            alignItems: 'center',
          }}>
            <a href="/register" style={{
              background: '#7c3aed', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              boxShadow: '0 4px 16px rgba(124,58,237,0.3)',
              width: isMobile ? '100%' : undefined,
              textAlign: 'center',
              boxSizing: 'border-box',
            }}>
              Monitor My Services Free
            </a>
            <a href="/tour" style={{
              background: 'transparent', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '1.5px solid #7c3aed',
              width: isMobile ? '100%' : undefined,
              textAlign: 'center',
              boxSizing: 'border-box',
            }}>
              See How It Works
            </a>
          </div>

          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            flexWrap: 'wrap',
            justifyContent: 'center',
            gap: isMobile ? '10px' : '24px',
            fontSize: '0.875rem', fontWeight: 500, color: '#0F172A',
            alignItems: 'center',
          }}>
            {['Real-time detection', 'SLO tracking built in', 'Slack & PagerDuty alerts'].map(t => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#16a34a' }}>✓</span> {t}
              </span>
            ))}
          </div>

          <p style={{ fontSize: isMobile ? '0.82rem' : '0.9rem', color: '#374151', marginTop: '24px', fontStyle: 'italic' }}>
            {'A DevOps team reduced their MTTR by 60% in the first month — from 4 hours to under 45 minutes.'}
          </p>
        </div>
      </section>

      {/* IMPACT BAR */}
      <section style={{
        padding: isMobile ? '32px 16px' : isTablet ? '40px 32px' : '48px',
        background: '#fafafa', borderBottom: '1px solid #f3f4f6',
      }}>
        <div style={{
          maxWidth: '1400px', margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
          gap: '32px', textAlign: 'center',
        }}>
          {impacts.map(({ value, label }) => (
            <div key={label}>
              <div style={{ fontSize: isMobile ? '1.8rem' : '2.5rem', fontWeight: 800, color: '#7c3aed', lineHeight: 1 }}>
                {value}
              </div>
              <div style={{ fontSize: isMobile ? '0.82rem' : '0.9rem', color: '#374151', fontWeight: 500, marginTop: '8px' }}>
                {label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* FEATURES */}
      <section style={{ padding: isMobile ? '48px 16px' : isTablet ? '64px 32px' : '80px 48px', width: '100%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: isMobile ? '32px' : '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Service Health Capabilities
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              Full Visibility Into Every Service
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              From uptime tracking to incident correlation — everything your team needs to keep services healthy.
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gap: '24px',
          }}>
            {features.map(({ icon: Icon, title, desc }, i) => (
              <div key={title} style={{
                background: i === 0 ? '#faf5ff' : '#fff',
                border: i === 0 ? '2px solid rgba(124,58,237,0.2)' : '1.5px solid #e5e7eb',
                borderRadius: '16px', padding: isMobile ? '20px' : '32px',
                transition: 'all 0.2s ease',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#7c3aed'
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(124,58,237,0.12)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = i === 0 ? 'rgba(124,58,237,0.2)' : '#e5e7eb'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                {i === 0 && (
                  <div style={{
                    fontSize: '0.7rem', fontWeight: 700, color: '#7c3aed',
                    marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}>
                    Most Critical
                  </div>
                )}
                <div style={{
                  width: '48px', height: '48px', borderRadius: '12px',
                  background: 'rgba(124,58,237,0.14)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '20px',
                }}>
                  <Icon size={22} style={{ color: '#7c3aed' }} />
                </div>
                <h3 style={{ fontSize: isMobile ? '1rem' : '1.15rem', fontWeight: 800, color: '#0f172a', marginBottom: '10px' }}>
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

      {/* SOCIAL PROOF */}
      <section style={{
        padding: isMobile ? '0 16px 48px' : isTablet ? '0 32px 64px' : '0 48px 80px',
        background: '#fff',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            background: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
            borderRadius: '20px',
            padding: isMobile ? '28px 20px' : '48px 56px',
            border: '1px solid rgba(124,58,237,0.15)',
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr auto',
            gap: isMobile ? '24px' : '48px',
            alignItems: 'center',
          }}>
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '16px' }}>
                DevOps Team Result
              </p>
              <p style={{ fontSize: isMobile ? '1rem' : '1.2rem', fontWeight: 600, color: '#0f172a', lineHeight: 1.65, marginBottom: '24px', maxWidth: '560px' }}>
                {'\u201C'}Our on-call engineers were spending 4 hours per incident just figuring out what broke and why. DevControl shows us the{' '}
                <span style={{ color: '#7c3aed', fontWeight: 800 }}>blast radius and root cause in under 2 minutes</span>
                {'. MTTR dropped by 60% in the first month.\u201D'}
              </p>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div style={{
                  width: '44px', height: '44px', borderRadius: '50%',
                  background: '#EDE9FE', color: '#7C3AED',
                  fontWeight: 700, fontSize: '13px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  AT
                </div>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A', margin: 0 }}>Alex T.</p>
                  <p style={{ fontSize: '12px', color: '#64748B', margin: 0 }}>Lead DevOps Engineer · Series B SaaS</p>
                </div>
                <div style={{
                  marginLeft: '12px',
                  background: '#ECFDF5', color: '#059669',
                  padding: '4px 12px', borderRadius: '999px',
                  fontSize: '11px', fontWeight: 600,
                }}>
                  60% MTTR reduction
                </div>
              </div>
            </div>
            <div style={{
              display: 'flex',
              flexDirection: isMobile ? 'row' : 'column',
              gap: isMobile ? '8px' : '16px',
              minWidth: isMobile ? undefined : '160px',
            }}>
              {[
                { value: '4hrs', label: 'Avg incident time before' },
                { value: '45min', label: 'Avg incident time after' },
                { value: '60%', label: 'MTTR reduction' },
              ].map(({ value, label }) => (
                <div key={label} style={{
                  textAlign: 'center',
                  padding: isMobile ? '12px 8px' : '16px',
                  background: '#fff', borderRadius: '12px', border: '1px solid #E2E8F0',
                  flex: isMobile ? '1' : undefined,
                }}>
                  <p style={{ fontSize: isMobile ? '1rem' : '1.3rem', fontWeight: 800, color: '#7c3aed', margin: '0 0 4px' }}>{value}</p>
                  <p style={{ fontSize: '0.72rem', color: '#64748B', margin: 0 }}>{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS */}
      <section style={{ padding: isMobile ? '48px 16px' : isTablet ? '64px 32px' : '80px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: isMobile ? '32px' : '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Quick Setup
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              Live Service Monitoring in 15 Minutes
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
            gap: '32px',
          }}>
            {steps.map(({ step, title, desc }) => (
              <div key={step} style={{ textAlign: 'center' }}>
                <div style={{
                  width: '56px', height: '56px', borderRadius: '50%',
                  background: '#7c3aed', color: '#fff',
                  fontSize: '1rem', fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  margin: '0 auto 20px',
                }}>
                  {step}
                </div>
                <h3 style={{ fontSize: '1.2rem', fontWeight: 800, color: '#0f172a', marginBottom: '12px' }}>
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

      {/* WHO IT'S FOR */}
      <section style={{ padding: isMobile ? '48px 16px' : isTablet ? '64px 32px' : '80px 48px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: isMobile ? '32px' : '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Built For Your Team
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              {"Who It's For"}
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
            gap: '24px',
          }}>
            <div style={{
              background: '#fff', border: '1.5px solid #e5e7eb',
              borderRadius: '20px', padding: isMobile ? '24px 20px' : '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: 'rgba(124,58,237,0.14)',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For DevOps & Platform Engineers
              </div>
              <h3 style={{ fontSize: isMobile ? '1.2rem' : '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Stop Flying Blind During Incidents
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Instant blast radius visibility when services degrade',
                  'Smart alerts routed to the right on-call engineer',
                  'Dependency maps show upstream and downstream impact',
                  'MTTR tracking shows if incident response is improving',
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
              borderRadius: '20px', padding: isMobile ? '24px 20px' : '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: '#7c3aed',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#fff',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For Engineering Leaders
              </div>
              <h3 style={{ fontSize: isMobile ? '1.2rem' : '1.3rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                Prove Reliability to Your Board
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'SLO compliance reports ready for board and investor reviews',
                  'MTTR trends show continuous improvement over time',
                  'Uptime history across every service and environment',
                  'Incident frequency and resolution time benchmarks',
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
        padding: isMobile ? '48px 24px' : isTablet ? '64px 32px' : '80px 48px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800,
            color: '#fff', marginBottom: '16px', letterSpacing: '-0.02em',
          }}>
            Know Before Your Customers Do.
          </h2>
          <p style={{
            fontSize: isMobile ? '0.95rem' : '1.1rem', color: 'rgba(255,255,255,0.85)',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            Real-time service health monitoring. SLO tracking. Instant incident alerts. All in 15 minutes.
          </p>
          <div style={{
            display: 'flex',
            flexDirection: isMobile ? 'column' : 'row',
            gap: '16px',
            justifyContent: 'center',
            flexWrap: 'wrap',
            alignItems: 'center',
          }}>
            <a href="/register" style={{
              background: '#fff', color: '#7c3aed',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              width: isMobile ? '100%' : undefined,
              textAlign: 'center',
              boxSizing: 'border-box',
            }}>
              Start Free Trial
            </a>
            <a href="/tour" style={{
              background: 'transparent', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '2px solid rgba(255,255,255,0.4)',
              width: isMobile ? '100%' : undefined,
              textAlign: 'center',
              boxSizing: 'border-box',
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
