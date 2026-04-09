'use client'

import { TrendingUp, Users, Shield, BarChart3, Zap, GitBranch, DollarSign, Globe } from 'lucide-react'
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

export default function ScaleupsPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  const signatureFeature = {
    icon: TrendingUp,
    title: 'Multi-Account Cost Intelligence at Scale',
    desc: 'As you grow from 1 to 10+ AWS accounts, costs become impossible to track manually. DevControl unifies spend across every account, team, and environment — with AI recommendations that scale with your infrastructure.',
    stats: [
      { value: '10+', label: 'AWS accounts unified' },
      { value: '30%', label: 'Cost reduction typical' },
      { value: '$28,800', label: 'Average annual savings found' },
    ],
  }

  const features = [
    { icon: Users, title: 'Team-level Cost Attribution', desc: 'Break down AWS spend by team, product, environment, or any custom tag. Every engineer knows what they own and what it costs.' },
    { icon: Shield, title: 'Enterprise Security Posture', desc: 'Continuous SOC 2 and CIS compliance monitoring across all accounts. Close enterprise deals without a dedicated security team.' },
    { icon: BarChart3, title: 'DORA Metrics at Team Level', desc: 'Track engineering performance per team, service, or squad. Identify bottlenecks and benchmark against Elite-tier standards.' },
    { icon: GitBranch, title: 'Infrastructure Drift Detection', desc: 'Catch when actual infrastructure diverges from your Terraform definitions. Prevent configuration drift from causing production incidents.' },
    { icon: DollarSign, title: 'Reserved Instance Strategy', desc: 'AI identifies exactly which workloads to commit to reserved pricing — with projected savings calculated before you commit a dollar.' },
    { icon: Globe, title: 'Multi-region Visibility', desc: 'Single dashboard across every AWS region your team uses. No more logging into multiple consoles or stitching together reports.' },
  ]

  const impacts = [
    { value: '$2,400', label: 'Avg monthly savings' },
    { value: '10+', label: 'Accounts unified' },
    { value: 'Elite', label: 'DORA tier achieved' },
    { value: '2 weeks', label: 'To establish compliance baseline' },
  ]

  const timeline = [
    { step: '1', title: 'Connect All Accounts', desc: 'One CloudFormation template, all accounts and regions connected in minutes.' },
    { step: '2', title: 'Unified Dashboard', desc: 'Every account, team, and service visible in one place immediately.' },
    { step: '3', title: 'AI Finds the Waste', desc: 'Cost recommendations, security findings, and performance gaps surfaced automatically.' },
    { step: '4', title: 'Scale With Control', desc: 'Continuous monitoring keeps your infrastructure tight as you grow.' },
  ]

  const audiences = [
    {
      role: 'For VPs of Engineering',
      title: 'Visibility Across Every Team',
      points: ['Per-team cost attribution and budgets', 'Engineering performance benchmarks', 'Cross-account security posture', 'Board-ready infrastructure reports'],
    },
    {
      role: 'For CTOs',
      title: 'Strategic Infrastructure Control',
      points: ['Forecast AWS spend as you scale', 'SOC 2 compliance without extra headcount', 'Risk visibility before it becomes an incident', 'Data for investor and board conversations'],
    },
    {
      role: 'For Platform Engineers',
      title: 'One Tool for Everything',
      points: ['Multi-account resource discovery', 'Drift detection across Terraform stacks', 'DORA metrics from existing GitHub setup', 'Smart alerts routed to the right team'],
    },
  ]

  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO — 2 column left/right */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 100%)',
        padding: isMobile ? '60px 20px' : isTablet ? '70px 32px' : '80px 48px',
      }}>
        <div style={{
          maxWidth: '1400px', margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr',
          gap: isMobile ? '40px' : '64px',
          alignItems: 'center',
        }}>
          {/* Left — text */}
          <div>
            <div style={{
              display: 'inline-flex', alignItems: 'center',
              background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
              borderRadius: '100px', padding: '6px 16px',
              fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa',
              marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
            }}>
              Solutions · For Scale-ups
            </div>

            <h1 style={{
              fontSize: isMobile ? '1.9rem' : 'clamp(2rem, 4vw, 3rem)',
              fontWeight: 800, color: '#fff',
              lineHeight: 1.15, marginBottom: '20px',
              letterSpacing: '-0.02em',
            }}>
              Infrastructure Control{' '}
              <span style={{ color: '#a78bfa' }}>That Scales With You</span>
            </h1>

            <p style={{
              fontSize: isMobile ? '1rem' : '1.1rem', color: 'rgba(255,255,255,0.75)',
              lineHeight: 1.75, marginBottom: '36px', maxWidth: '520px',
            }}>
              You&apos;ve outgrown spreadsheets and gut feel. DevControl gives scale-up
              engineering teams unified visibility across every AWS account, team, and
              region — without the enterprise price tag.
            </p>

            <div style={{
              display: 'flex', gap: '16px',
              flexDirection: isMobile ? 'column' : 'row',
              alignItems: isMobile ? 'stretch' : undefined,
              flexWrap: 'wrap',
            }}>
              <a href="/register" style={{
                background: '#7c3aed', color: '#fff',
                padding: '14px 32px', borderRadius: '10px',
                fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
                boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
                textAlign: 'center', boxSizing: 'border-box',
              }}>
                Get Started Free
              </a>
              <a href="/case-studies" style={{
                background: 'transparent', color: '#fff',
                padding: '14px 32px', borderRadius: '10px',
                fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
                border: '1.5px solid rgba(255,255,255,0.3)',
                textAlign: 'center', boxSizing: 'border-box',
              }}>
                Read Case Studies
              </a>
            </div>
            <p style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.5)', marginTop: '24px', fontStyle: 'italic' }}>
              {'Axiom Labs unified 3 AWS accounts and found $8,200/month in idle resources within the first week.'}
            </p>
          </div>

          {/* Right — stat panel */}
          <div style={{
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '20px', padding: isMobile ? '28px 20px' : '40px',
          }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '24px',
            }}>
              What scale-ups achieve
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
              {impacts.map(({ value, label }) => (
                <div key={label} style={{
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between',
                  paddingBottom: '24px',
                  borderBottom: '1px solid rgba(255,255,255,0.08)',
                }}>
                  <span style={{ fontSize: '0.9rem', color: 'rgba(255,255,255,0.7)', fontWeight: 500 }}>
                    {label}
                  </span>
                  <span style={{ fontSize: isMobile ? '1.4rem' : '1.8rem', fontWeight: 800, color: '#a78bfa' }}>
                    {value}
                  </span>
                </div>
              ))}
            </div>
            <div style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,0.4)', marginTop: '8px' }}>
              Based on average customer results
            </div>
          </div>
        </div>
      </section>

      {/* SIGNATURE FEATURE */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            background: '#fff',
            border: '2px solid rgba(124,58,237,0.2)',
            borderRadius: '24px', padding: isMobile ? '28px 20px' : '48px',
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1.2fr 1fr',
            gap: isMobile ? '32px' : '48px',
            alignItems: 'center',
          }}>
            <div>
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: '8px',
                background: 'rgba(124,58,237,0.08)', border: '1px solid rgba(124,58,237,0.2)',
                borderRadius: '100px', padding: '6px 16px',
                fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.1em',
              }}>
                ✦ Signature Feature
              </div>
              <h2 style={{
                fontSize: isMobile ? '1.4rem' : 'clamp(1.6rem, 3vw, 2.2rem)', fontWeight: 800,
                color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
              }}>
                {signatureFeature.title}
              </h2>
              <p style={{ fontSize: '1rem', color: '#374151', lineHeight: 1.75 }}>
                {signatureFeature.desc}
              </p>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
              {signatureFeature.stats.map(({ value, label }) => (
                <div key={label} style={{
                  background: '#faf5ff',
                  border: '1px solid rgba(124,58,237,0.12)',
                  borderRadius: '14px', padding: '24px',
                  display: 'flex', alignItems: 'center',
                  justifyContent: 'space-between',
                }}>
                  <span style={{ fontSize: '0.9rem', color: '#374151', fontWeight: 500 }}>{label}</span>
                  <span style={{ fontSize: '2rem', fontWeight: 800, color: '#7c3aed' }}>{value}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FEATURES — 2 col grid */}
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
              Built for Teams Growing Fast
            </h2>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : 'repeat(2, 1fr)',
            gap: '24px',
          }}>
            {features.map(({ icon: Icon, title, desc }) => (
              <div key={title} style={{
                background: '#fff', border: '1.5px solid #e5e7eb',
                borderRadius: '16px', padding: isMobile ? '24px' : '36px',
                display: 'flex', gap: '24px', alignItems: 'flex-start',
                transition: 'all 0.2s ease',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#7c3aed'
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(124,58,237,0.12)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = '#e5e7eb'
                  e.currentTarget.style.boxShadow = 'none'
                }}
              >
                <div style={{
                  width: '52px', height: '52px', borderRadius: '14px',
                  background: 'rgba(124,58,237,0.08)', flexShrink: 0,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                  <Icon size={24} style={{ color: '#7c3aed' }} />
                </div>
                <div style={{ minWidth: 0 }}>
                  <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                    {title}
                  </h3>
                  <p style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.75 }}>
                    {desc}
                  </p>
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* SOCIAL PROOF */}
      <section style={{ padding: isMobile ? '0 20px 48px' : isTablet ? '0 32px 64px' : '0 48px 80px', width: '100%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            background: '#0f172a',
            borderRadius: '20px',
            padding: isMobile ? '28px 20px' : '48px',
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : '1fr auto',
            gap: isMobile ? '32px' : '48px',
            alignItems: 'center',
          }}>
            <div>
              <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '16px' }}>
                Scale-up Result
              </p>
              <p style={{ fontSize: isMobile ? '1rem' : '1.15rem', fontWeight: 600, color: '#e2e8f0', lineHeight: 1.65, marginBottom: '24px', maxWidth: '560px' }}>
                {'\u201C'}We had 3 AWS accounts, 4 teams, and no idea what anything cost. DevControl gave us full visibility in 15 minutes and found{' '}
                <span style={{ color: '#a78bfa', fontWeight: 800 }}>$8,200/month in idle resources</span>
                {' '}we had completely forgotten about.{'\u201D'}
              </p>
              <div style={{
                display: 'flex', alignItems: 'center', gap: '12px',
                flexDirection: isMobile ? 'column' : 'row',
              }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '50%',
                  background: 'rgba(124,58,237,0.3)', color: '#a78bfa',
                  fontWeight: 700, fontSize: '13px',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  MC
                </div>
                <div style={{ textAlign: isMobile ? 'center' : 'left' }}>
                  <p style={{ fontSize: '14px', fontWeight: 600, color: '#fff', margin: 0 }}>Marcus Chen</p>
                  <p style={{ fontSize: '12px', color: '#64748b', margin: 0 }}>VP Engineering · Axiom Labs · Series B</p>
                </div>
                <div style={{
                  marginLeft: isMobile ? '0' : '12px',
                  background: 'rgba(124,58,237,0.2)', color: '#a78bfa',
                  padding: '3px 12px', borderRadius: '999px',
                  fontSize: '11px', fontWeight: 600,
                }}>
                  Saved $8,200/month
                </div>
              </div>
            </div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(3, 1fr)' : '1fr',
              gap: '16px',
              minWidth: isMobile ? undefined : '180px',
            }}>
              {[
                { value: '3', label: 'Accounts unified' },
                { value: '$8,200', label: 'Monthly savings' },
                { value: '15 min', label: 'Time to insight' },
              ].map(({ value, label }) => (
                <div key={label} style={{ textAlign: 'center', padding: isMobile ? '12px 8px' : '16px', background: 'rgba(255,255,255,0.05)', borderRadius: '12px', border: '1px solid rgba(255,255,255,0.08)' }}>
                  <p style={{ fontSize: isMobile ? '1.1rem' : '1.5rem', fontWeight: 800, color: '#a78bfa', margin: '0 0 4px' }}>{value}</p>
                  <p style={{ fontSize: '0.72rem', color: '#64748b', margin: 0 }}>{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* HOW IT WORKS — horizontal timeline */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Quick Setup
            </div>
            <h2 style={{
              fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              Multi-Account Visibility in 15 Minutes
            </h2>
          </div>

          {/* Timeline */}
          <div style={{ position: 'relative' }}>
            {/* Connector line — desktop only */}
            {!isMobile && (
              <div style={{
                position: 'absolute', top: '28px', left: '12.5%', right: '12.5%',
                height: '2px', background: 'rgba(124,58,237,0.2)', zIndex: 0,
              }} />
            )}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? 'repeat(2, 1fr)' : 'repeat(4, 1fr)',
              gap: '24px', position: 'relative', zIndex: 1,
            }}>
              {timeline.map(({ step, title, desc }) => (
                <div key={step} style={{ textAlign: 'center' }}>
                  <div style={{
                    width: '56px', height: '56px', borderRadius: '50%',
                    background: '#7c3aed', color: '#fff',
                    fontSize: '1.1rem', fontWeight: 800,
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                    margin: '0 auto 20px',
                    boxShadow: '0 0 0 6px #fafafa, 0 0 0 8px rgba(124,58,237,0.2)',
                  }}>
                    {step}
                  </div>
                  <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>
                    {title}
                  </h3>
                  <p style={{ fontSize: '0.85rem', color: '#374151', lineHeight: 1.7 }}>
                    {desc}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* WHO IT'S FOR — 3 cards */}
      <section style={{ padding: isMobile ? '48px 20px' : isTablet ? '64px 32px' : '80px 48px' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <div style={{
              fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Every Role Covered
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
            gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gap: '24px',
          }}>
            {audiences.map(({ role, title, points }, i) => (
              <div key={role} style={{
                background: i === 1 ? 'linear-gradient(135deg, #faf5ff, #f3e8ff)' : '#fff',
                border: i === 1 ? '2px solid rgba(124,58,237,0.25)' : '1.5px solid #e5e7eb',
                borderRadius: '20px', padding: isMobile ? '28px' : '36px',
              }}>
                <div style={{
                  display: 'inline-flex',
                  background: i === 1 ? '#7c3aed' : 'rgba(124,58,237,0.08)',
                  borderRadius: '100px', padding: '5px 14px',
                  fontSize: '0.72rem', fontWeight: 700,
                  color: i === 1 ? '#fff' : '#7c3aed',
                  marginBottom: '16px', textTransform: 'uppercase', letterSpacing: '0.08em',
                }}>
                  {role}
                </div>
                <h3 style={{ fontSize: '1.15rem', fontWeight: 800, color: '#0f172a', marginBottom: '20px' }}>
                  {title}
                </h3>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
                  {points.map(point => (
                    <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                      <span style={{ color: '#7c3aed', fontWeight: 700, marginTop: '1px' }}>✓</span>
                      <span style={{ fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>{point}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BOTTOM CTA — dark navy */}
      <section style={{
        width: '100%',
        background: '#0f172a',
        padding: isMobile ? '56px 20px' : isTablet ? '64px 32px' : '80px 48px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex',
            background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.3)',
            borderRadius: '100px', padding: '6px 16px',
            fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa',
            marginBottom: '24px', textTransform: 'uppercase', letterSpacing: '0.1em',
          }}>
            Ready to Scale With Control?
          </div>
          <h2 style={{
            fontSize: isMobile ? '1.6rem' : 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800,
            color: '#fff', marginBottom: '16px', letterSpacing: '-0.02em',
          }}>
            Your Infrastructure Complexity Is About to Get Simple
          </h2>
          <p style={{
            fontSize: '1.1rem', color: 'rgba(255,255,255,0.65)',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            Join fast-growing teams using DevControl to unify AWS visibility and stay in control as they scale.
          </p>
          <div style={{
            display: 'flex', gap: '16px', justifyContent: 'center',
            flexDirection: isMobile ? 'column' : 'row',
            alignItems: isMobile ? 'center' : undefined,
            flexWrap: 'wrap',
          }}>
            <a href="/register" style={{
              background: '#7c3aed', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
              boxShadow: '0 4px 20px rgba(124,58,237,0.4)',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              Start Free Trial
            </a>
            <a href="/case-studies" style={{
              background: 'transparent', color: '#fff',
              padding: '14px 32px', borderRadius: '10px',
              fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
              border: '1.5px solid rgba(255,255,255,0.25)',
              width: isMobile ? '100%' : undefined,
              boxSizing: 'border-box', textAlign: 'center',
            }}>
              Read Case Studies
            </a>
          </div>
          <div style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.35)', marginTop: '16px' }}>
            14-day free trial · No credit card required · Cancel anytime
          </div>
        </div>
      </section>

    </div>
  )
}
