'use client'

import { useEffect, useState } from 'react'
import { Search, Tag, Globe, Filter, RefreshCw, Database } from 'lucide-react'

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

export default function ResourceDiscoveryPage() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  const features = [
    { icon: Search, title: 'Auto-Discovery', desc: 'Discover EC2, RDS, Lambda, S3, and other supported resource types in your connected AWS account — no manual inventory.', highlight: true },
    { icon: Globe, title: 'Single-Region Discovery', desc: 'Discovery covers one AWS account in a single region (us-east-1 today), plus CloudFront, which is global. Multi-region and multi-account discovery are not available yet.' },
    { icon: Tag, title: 'Smart Tag Management', desc: 'Find every untagged resource instantly. Enforce tagging policies, auto-tag by environment or team, and generate compliance reports for finance and security.' },
    { icon: Filter, title: 'Powerful Search & Filtering', desc: 'Find any resource in seconds by type, tag, region, cost, health status, or custom attribute. Natural language search powered by AI.' },
    { icon: RefreshCw, title: 'Real-time Inventory Sync', desc: 'Resource inventory updates in real time as your infrastructure changes. Always accurate — no stale data, no manual refresh required.' },
    { icon: Database, title: 'Resource Relationship Mapping', desc: 'See how every resource connects to every other. Understand blast radius before making changes and avoid accidental outages from hidden dependencies.' },
  ]

  const steps = [
    { step: '01', title: 'Connect Your AWS Account', desc: 'Grant read-only IAM access with our one-click CloudFormation template.' },
    { step: '02', title: 'Inventory of Supported Resources', desc: 'DevControl scans a single region (us-east-1 today) for the supported resource types and records each resource with its metadata.' },
    { step: '03', title: 'Search, Tag & Govern', desc: 'Find anything instantly, enforce tagging standards, and export compliance reports for finance, security, and operations teams.' },
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
            background: '#7c3aed', border: 'none',
            borderRadius: '999px', padding: '6px 14px',
            fontSize: '0.75rem', fontWeight: 700, color: '#ffffff',
            marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            Platform · Resource Discovery
          </div>

          <h1 style={{
            fontSize: isMobile ? 'clamp(1.8rem,5vw,2.6rem)' : 'clamp(2.2rem,5vw,3.2rem)',
            fontWeight: 700, color: '#1e1b4b',
            lineHeight: 1.15, marginBottom: '20px',
            letterSpacing: '-0.02em', maxWidth: '800px', margin: '0 auto 20px',
          }}>
            Find Every AWS Resource{' '}
            <span style={{ color: '#7c3aed' }}>Across Every Account</span>
          </h1>

          <p style={{
            fontSize: isMobile ? '1.05rem' : '1.2rem', color: '#1f2937',
            lineHeight: 1.75, maxWidth: '600px',
            margin: '0 auto 36px',
          }}>
            Stop losing track of cloud resources. DevControl automatically discovers
            and catalogs the supported resource types in your connected AWS account,
            in a single region (us-east-1 today), with no manual inventory.
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
              Discover My AWS Resources Free
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
            fontSize: '0.875rem', fontWeight: 500, color: '#1f2937',
            alignItems: 'center',
          }}>
            {['Supported AWS resource types', 'Single region (us-east-1)', 'Real-time sync'].map(t => (
              <span key={t} style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                <span style={{ color: '#16a34a' }}>✓</span> {t}
              </span>
            ))}
          </div>
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
              Discovery Capabilities
            </div>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 700,
              color: '#1e1b4b', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              Your Complete AWS Asset Register
            </h2>
            <p style={{ fontSize: '1.1rem', color: '#1f2937', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              The supported resource types in your connected account, in a single region (us-east-1 today).
            </p>
          </div>

          <div style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gap: '24px',
          }}>
            {features.map(({ icon: Icon, title, desc, highlight }) => (
              <div key={title} style={{
                background: '#fff',
                border: highlight ? '2px solid #7c3aed' : '1.5px solid #e5e7eb',
                borderRadius: '16px', padding: isMobile ? '20px' : '32px',
                boxShadow: highlight ? '0 8px 32px rgba(124,58,237,0.15)' : 'none',
                transition: 'all 0.2s ease',
              }}
                onMouseEnter={e => {
                  e.currentTarget.style.borderColor = '#7c3aed'
                  e.currentTarget.style.boxShadow = '0 8px 32px rgba(124,58,237,0.12)'
                }}
                onMouseLeave={e => {
                  e.currentTarget.style.borderColor = highlight ? '#7c3aed' : '#e5e7eb'
                  e.currentTarget.style.boxShadow = highlight ? '0 8px 32px rgba(124,58,237,0.15)' : 'none'
                }}
              >
                {highlight && (
                  <div style={{
                    fontSize: '0.7rem', fontWeight: 700, color: '#7c3aed',
                    marginBottom: '10px', textTransform: 'uppercase', letterSpacing: '0.08em',
                  }}>
                    Most Used
                  </div>
                )}
                <div style={{
                  width: '48px', height: '48px', borderRadius: '12px',
                  background: '#7c3aed',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '20px',
                }}>
                  <Icon size={22} style={{ color: '#ffffff' }} />
                </div>
                <h3 style={{ fontSize: isMobile ? '1rem' : '1.15rem', fontWeight: 700, color: '#1e1b4b', marginBottom: '10px' }}>
                  {title}
                </h3>
                <p style={{ fontSize: '0.9rem', color: '#1f2937', lineHeight: 1.75 }}>
                  {desc}
                </p>
              </div>
            ))}
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
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 700,
              color: '#1e1b4b', letterSpacing: '-0.02em',
            }}>
              Full Inventory in Under 15 Minutes
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
                <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#1e1b4b', marginBottom: '12px' }}>
                  {title}
                </h3>
                <p style={{ fontSize: '0.9rem', color: '#1f2937', lineHeight: 1.75 }}>
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
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 700,
              color: '#1e1b4b', letterSpacing: '-0.02em',
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
              borderRadius: '20px', padding: isMobile ? '24px 20px' : '40px',
            }}>
              <div style={{
                display: 'inline-flex', background: '#7c3aed',
                borderRadius: '999px', padding: '6px 14px',
                fontSize: '0.75rem', fontWeight: 700, color: '#ffffff',
                marginBottom: '20px', textTransform: 'uppercase', letterSpacing: '0.08em',
              }}>
                For CTOs &amp; Engineering Leaders
              </div>
              <h3 style={{ fontSize: isMobile ? '1.2rem' : '1.3rem', fontWeight: 700, color: '#1e1b4b', marginBottom: '20px' }}>
                Complete Cloud Asset Governance
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Full visibility into every cloud asset your team owns',
                  'Enforce tagging standards for cost allocation',
                  'Audit-ready resource inventory at all times',
                  'Eliminate shadow IT and untracked infrastructure',
                ].map(point => (
                  <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ color: '#7c3aed', fontWeight: 700, marginTop: '1px' }}>✓</span>
                    <span style={{ fontSize: '0.9rem', color: '#1f2937', lineHeight: 1.6 }}>{point}</span>
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
                For Platform Engineers &amp; DevOps
              </div>
              <h3 style={{ fontSize: isMobile ? '1.2rem' : '1.3rem', fontWeight: 700, color: '#1e1b4b', marginBottom: '20px' }}>
                Find Anything. Fix Everything.
              </h3>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
                {[
                  'Discover orphaned resources draining your budget',
                  'Map resource dependencies before making changes',
                  'Natural language search across your entire estate',
                  'Real-time sync — never work from stale inventory again',
                ].map(point => (
                  <div key={point} style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                    <span style={{ color: '#7c3aed', fontWeight: 700, marginTop: '1px' }}>✓</span>
                    <span style={{ fontSize: '0.9rem', color: '#1f2937', lineHeight: 1.6 }}>{point}</span>
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
            Every Resource. Always Accounted For.
          </h2>
          <p style={{
            fontSize: isMobile ? '0.95rem' : '1.1rem', color: 'rgba(255,255,255,0.85)',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            Connect your AWS accounts and get a complete resource inventory in under 15 minutes.
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
