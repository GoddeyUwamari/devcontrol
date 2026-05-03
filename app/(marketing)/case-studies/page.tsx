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

const caseStudies = [
  {
    company: 'Axiom Labs',
    industry: 'B2B SaaS · Series B · 120 engineers',
    logo: 'AL',
    logoColor: '#0ea5e9',
    challenge:
      'Axiom Labs was spending $47,000/month on AWS with no visibility into which teams or services were driving costs. Engineers were getting surprise bills and had no way to correlate spend with product decisions.',
    solution:
      'After connecting DevControl, the team got instant visibility across 3 AWS accounts. AI recommendations identified $8,200/month in idle resources within the first week.',
    results: [
      { metric: '$8,200/mo', label: 'Cost reduction in week 1' },
      { metric: '3 accounts', label: 'Unified in one dashboard' },
      { metric: '94%', label: 'Security posture score' },
    ],
    quote:
      'DevControl paid for itself in the first week. We found $8,200 in idle EC2 instances we had completely forgotten about.',
    author: 'Marcus Chen',
    role: 'VP of Engineering',
    tags: ['Cost Optimization', 'Multi-Account', 'Security'],
  },
  {
    company: 'Streamline HQ',
    industry: 'FinTech · Series A · 45 engineers',
    logo: 'SH',
    logoColor: '#10b981',
    challenge:
      'As a FinTech company, Streamline HQ needed to demonstrate SOC 2 compliance to enterprise customers but had no automated way to monitor their security posture across AWS.',
    solution:
      "DevControl's continuous compliance monitoring gave the security team real-time visibility into their SOC 2 posture. Automated alerts caught misconfigurations before they became audit findings.",
    results: [
      { metric: '2 weeks', label: 'To establish SOC 2 compliance baseline' },
      { metric: '0 findings', label: 'In external security audit' },
      { metric: '$340K', label: 'Enterprise deal unlocked' },
    ],
    quote:
      'We closed a $340K enterprise deal because we could show real-time SOC 2 compliance monitoring. DevControl made that possible.',
    author: 'Sarah Okonkwo',
    role: 'CTO',
    tags: ['Security', 'Compliance', 'SOC 2'],
  },
  {
    company: 'NovaDeploy',
    industry: 'DevOps Platform · Seed · 18 engineers',
    logo: 'ND',
    logoColor: '#f59e0b',
    challenge:
      "NovaDeploy's small engineering team had no visibility into their DORA metrics. They knew they were shipping fast but couldn't prove it to investors or benchmark against industry standards.",
    solution:
      'DevControl automatically tracked all 4 DORA metrics from their existing GitHub and AWS setup. The team went from zero metrics visibility to Elite-tier benchmarks in under an hour.',
    results: [
      { metric: 'Elite', label: 'DORA performance tier' },
      { metric: '4.2hrs', label: 'Lead time for changes' },
      { metric: '15min', label: 'Setup time to first metric' },
    ],
    quote:
      'We showed our Series A investors our DORA metrics dashboard in the pitch deck. They were impressed we had this level of engineering visibility at our stage.',
    author: 'James Oduya',
    role: 'Co-founder & CTO',
    tags: ['DORA Metrics', 'Engineering Performance', 'Startups'],
  },
  {
    company: 'Meridian Analytics',
    industry: 'Data Infrastructure · Series C · 200 engineers',
    logo: 'MA',
    logoColor: '#7c3aed',
    challenge: 'Meridian was managing 47 AWS accounts across 3 business units with no unified visibility. Each team had their own cost tracking spreadsheet and security reviews took weeks.',
    solution: 'DevControl unified all 47 accounts into a single control plane. The platform team reduced infrastructure toil by 60% and the security team moved from quarterly reviews to continuous monitoring.',
    results: [
      { metric: '47', label: 'AWS accounts unified' },
      { metric: '60%', label: 'Reduction in platform toil' },
      { metric: '$31K/mo', label: 'Monthly savings identified' },
    ],
    quote: 'We were flying blind across 3 business units. DevControl gave us unified visibility in a single afternoon. Our CFO now uses the cost dashboard in every board meeting.',
    author: 'David K.',
    role: 'VP Platform Engineering',
    tags: ['Multi-Account', 'Platform Engineering', 'Cost Optimization'],
  },
]

const stats = [
  { value: '$2.4M+', label: 'Saved by customers annually' },
  { value: '500+', label: 'Engineering teams onboarded' },
  { value: '15min', label: 'Average time to first insight' },
]

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
          background: 'rgba(124,58,237,0.14)', border: '1px solid rgba(124,58,237,0.2)',
          borderRadius: '100px', padding: '6px 16px',
          fontSize: '0.78rem', fontWeight: 600, color: '#7c3aed',
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
          Real Teams. Real Results.
        </h1>

        <p style={{
          fontSize: isMobile ? '1.05rem' : '1.1rem', color: '#1f2937', lineHeight: 1.7,
          maxWidth: '520px', margin: '0 auto',
        }}>
          See how engineering teams use DevControl to cut AWS costs,
          improve security, and ship faster.
        </p>
      </section>

      {/* Stats bar */}
      <section style={{
        background: '#f9fafb',
        borderBottom: '1px solid #f3f4f6',
        padding: isMobile ? '32px 16px' : isTablet ? '32px 24px' : '40px 48px',
        width: '100%',
      }}>
        <div style={{
          maxWidth: '900px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
          gap: '32px',
          textAlign: 'center',
        }}>
          {stats.map(s => (
            <div key={s.label}>
              <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#7c3aed', lineHeight: 1, marginBottom: '6px' }}>
                {s.value}
              </div>
              <div style={{ fontSize: '0.9rem', color: '#6b7280', fontWeight: 500 }}>
                {s.label}
              </div>
            </div>
          ))}
        </div>
      </section>

      {/* Case study cards */}
      <section style={{
        maxWidth: '1400px', margin: '0 auto',
        padding: isMobile ? '40px 16px' : isTablet ? '48px 24px' : '64px 48px',
      }}>
        {caseStudies.slice(0, 3).map((cs) => (
          <div key={cs.company} style={{
            width: '100%',
            borderRadius: '20px',
            border: '1.5px solid #e5e7eb',
            padding: isMobile ? '24px' : '48px',
            marginBottom: '32px',
            background: '#fff',
            boxShadow: '0 4px 24px rgba(0,0,0,0.06)',
          }}>
            {/* Top row — company info + tags */}
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              marginBottom: '32px', flexWrap: 'wrap', gap: '16px',
            }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
                <div style={{
                  width: '48px', height: '48px', borderRadius: '12px',
                  background: cs.logoColor, color: '#fff',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontWeight: 800, fontSize: '0.9rem', flexShrink: 0,
                }}>
                  {cs.logo}
                </div>
                <div>
                  <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#0f172a' }}>{cs.company}</div>
                  <div style={{ fontSize: '0.82rem', color: '#6b7280', marginTop: '2px' }}>{cs.industry}</div>
                </div>
              </div>
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                {cs.tags.map(tag => (
                  <span key={tag} style={{
                    background: 'rgba(124,58,237,0.12)', color: '#7c3aed',
                    border: '1px solid rgba(124,58,237,0.15)',
                    borderRadius: '100px', padding: '4px 12px',
                    fontSize: '0.75rem', fontWeight: 600,
                  }}>
                    {tag}
                  </span>
                ))}
              </div>
            </div>

            {/* Two column — challenge/solution + results */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: isMobile ? '1fr' : 'minmax(0, 1.2fr) minmax(0, 1fr)',
              gap: isMobile ? '24px' : '48px',
              alignItems: 'start',
            }}>
              <div>
                <div style={{
                  fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                  textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: '8px',
                }}>
                  The Challenge
                </div>
                <p style={{ fontSize: '1.05rem', color: '#1f2937', lineHeight: 1.7, marginBottom: '24px' }}>
                  {cs.challenge}
                </p>

                <div style={{
                  fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                  textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: '8px',
                }}>
                  The Solution
                </div>
                <p style={{ fontSize: '1.05rem', color: '#1f2937', lineHeight: 1.7, marginBottom: '24px' }}>
                  {cs.solution}
                </p>

                {/* Quote */}
                <div style={{ borderLeft: '3px solid #7c3aed', paddingLeft: '16px', marginTop: '24px' }}>
                  <p style={{
                    fontSize: '1rem', color: '#0f172a', fontStyle: 'italic',
                    lineHeight: 1.6, marginBottom: '12px', fontWeight: 500,
                  }}>
                    &ldquo;{cs.quote}&rdquo;
                  </p>
                  <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#0f172a' }}>{cs.author}</div>
                  <div style={{ fontSize: '0.78rem', color: '#6b7280' }}>{cs.role}, {cs.company}</div>
                </div>
              </div>

              {/* Results panel */}
              <div style={{
                background: '#faf5ff',
                border: '1px solid rgba(124,58,237,0.12)',
                borderRadius: '16px',
                padding: isMobile ? '20px' : '32px',
              }}>
                <div style={{
                  fontSize: '0.75rem', fontWeight: 700, color: '#7c3aed',
                  textTransform: 'uppercase' as const, letterSpacing: '0.1em', marginBottom: '20px',
                }}>
                  Results
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
                  {cs.results.map((r, i) => (
                    <div key={r.label} style={{
                      borderBottom: i < cs.results.length - 1 ? '1px solid rgba(124,58,237,0.15)' : 'none',
                      paddingBottom: i < cs.results.length - 1 ? '20px' : '0',
                    }}>
                      <div style={{ fontSize: '2rem', fontWeight: 800, color: '#7c3aed', lineHeight: 1 }}>
                        {r.metric}
                      </div>
                      <div style={{ fontSize: '0.82rem', color: '#1f2937', fontWeight: 500, marginTop: '4px' }}>
                        {r.label}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        ))}

        {/* Meridian Analytics — dark banner card */}
        <div style={{
          width: '100%',
          background: '#0f172a',
          borderRadius: '20px',
          padding: isMobile ? '24px' : '48px',
          marginBottom: '32px',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr',
          gap: isMobile ? '32px' : '48px',
          alignItems: 'center',
        }}>
          {/* Left — quote + author */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '28px' }}>
              <div style={{
                width: '48px', height: '48px', borderRadius: '12px',
                background: '#7c3aed', color: '#fff',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontWeight: 800, fontSize: '0.9rem',
              }}>
                MA
              </div>
              <div>
                <div style={{ fontWeight: 800, fontSize: '1.1rem', color: '#fff' }}>Meridian Analytics</div>
                <div style={{ fontSize: '0.82rem', color: '#64748b', marginTop: '2px' }}>Data Infrastructure · Series C · 200 engineers</div>
              </div>
            </div>
            <p style={{
              fontSize: isMobile ? '1rem' : '1.2rem', color: '#e2e8f0', fontStyle: 'italic',
              lineHeight: 1.65, marginBottom: '24px', fontWeight: 500,
            }}>
              {'\u201C'}We were flying blind across 3 business units. DevControl gave us unified visibility in a single afternoon. Our CFO now uses the cost dashboard in{' '}
              <span style={{ color: '#a78bfa', fontWeight: 700 }}>every board meeting</span>
              {'.\u201D'}
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <div style={{
                width: '40px', height: '40px', borderRadius: '50%',
                background: 'rgba(124,58,237,0.3)', color: '#a78bfa',
                fontWeight: 700, fontSize: '12px',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                DK
              </div>
              <div>
                <div style={{ fontSize: '14px', fontWeight: 600, color: '#fff' }}>David K.</div>
                <div style={{ fontSize: '12px', color: '#64748b' }}>VP Platform Engineering · Meridian Analytics</div>
              </div>
            </div>
          </div>

          {/* Right — stats */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '0' }}>
            <p style={{ fontSize: '0.72rem', fontWeight: 700, color: '#a78bfa', textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '20px' }}>
              Results
            </p>
            {[
              { metric: '47', label: 'AWS accounts unified in one dashboard' },
              { metric: '60%', label: 'Reduction in platform toil' },
              { metric: '$31K/mo', label: 'Monthly savings identified' },
            ].map(({ metric, label }, i) => (
              <div key={label} style={{
                paddingTop: i === 0 ? 0 : '20px',
                paddingBottom: '20px',
                borderBottom: i < 2 ? '1px solid rgba(255,255,255,0.08)' : 'none',
              }}>
                <div style={{ fontSize: '2.2rem', fontWeight: 800, color: '#a78bfa', lineHeight: 1 }}>{metric}</div>
                <div style={{ fontSize: '0.85rem', color: '#94a3b8', marginTop: '4px' }}>{label}</div>
              </div>
            ))}
          </div>
        </div>
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
          Join 500+ engineering teams identifying $800–$8,000+/month in waste.
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
