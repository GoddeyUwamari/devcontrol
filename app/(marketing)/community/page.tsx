'use client'

import { Users, MessageCircle, Zap, BookOpen, ArrowRight, Star, Shield, Rocket } from 'lucide-react'
import Link from 'next/link'

const benefits = [
  {
    icon: MessageCircle,
    title: 'Ask & Answer Questions',
    desc: 'Get help from engineers who have solved the same AWS cost, security, and DevOps challenges you are facing.',
  },
  {
    icon: Zap,
    title: 'Early Access to Features',
    desc: 'Community members get early access to new DevControl features before general release. Shape the roadmap.',
  },
  {
    icon: BookOpen,
    title: 'Share Best Practices',
    desc: 'Learn how other platform teams structure their AWS governance, cost allocation, and DORA metric tracking.',
  },
  {
    icon: Shield,
    title: 'Security & Compliance Playbooks',
    desc: 'Access community-contributed SOC 2, HIPAA, and CIS benchmark guides built by practitioners.',
  },
  {
    icon: Star,
    title: 'Real-World Case Studies',
    desc: 'Members share real savings numbers, architecture decisions, and lessons learned from production environments.',
  },
  {
    icon: Rocket,
    title: 'Office Hours with the Team',
    desc: 'Weekly live sessions with the DevControl engineering team. Ask questions, see demos, influence the product.',
  },
]

const stats = [
  { value: '500+', label: 'Engineering teams' },
  { value: 'Weekly', label: 'Office hours' },
  { value: 'Free', label: 'Always' },
]

export default function CommunityPage() {
  return (
    <div style={{ minHeight: '100vh', background: '#fff' }}>

      {/* HERO */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #0f172a 0%, #1e1b4b 50%, #0f172a 100%)',
        padding: '100px 48px',
        textAlign: 'center',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{
            display: 'inline-flex', alignItems: 'center', gap: '8px',
            background: 'rgba(124,58,237,0.2)', border: '1px solid rgba(124,58,237,0.4)',
            borderRadius: '100px', padding: '6px 16px',
            fontSize: '0.75rem', fontWeight: 700, color: '#a78bfa',
            marginBottom: '24px', letterSpacing: '0.12em', textTransform: 'uppercase',
          }}>
            <Users size={14} />
            DevControl Community
          </div>

          <h1 style={{
            fontSize: 'clamp(2.2rem, 5vw, 3.5rem)',
            fontWeight: 800, color: '#fff',
            lineHeight: 1.1, marginBottom: '20px',
            letterSpacing: '-0.02em', maxWidth: '800px', margin: '0 auto 20px',
          }}>
            Join 500+ Engineers Building{' '}
            <span style={{ color: '#a78bfa' }}>Smarter Cloud Infrastructure</span>
          </h1>

          <p style={{
            fontSize: '1.15rem', color: '#94a3b8',
            lineHeight: 1.75, maxWidth: '560px',
            margin: '0 auto 40px',
          }}>
            Connect with platform engineers, DevOps teams, and FinOps practitioners who use DevControl to cut AWS costs, improve security, and ship faster.
          </p>

          {/* CTA */}
          <div style={{ display: 'flex', gap: '16px', justifyContent: 'center', flexWrap: 'wrap', marginBottom: '48px' }}>
            <a
              href="https://join.slack.com/t/devcontrolcommunity/shared_invite/zt-3ul72iy4x-EJmlkBxEP8M2mvOP8KmFBg"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                background: '#7c3aed', color: '#fff',
                padding: '16px 36px', borderRadius: '10px',
                fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
                boxShadow: '0 4px 24px rgba(124,58,237,0.4)',
                display: 'inline-flex', alignItems: 'center', gap: '8px',
              }}
            >
              <Users size={18} />
              Join the Community — Free
            </a>
            <Link
              href="/contact"
              style={{
                background: 'transparent', color: '#e2e8f0',
                padding: '16px 32px', borderRadius: '10px',
                fontWeight: 600, fontSize: '1rem', textDecoration: 'none',
                border: '1.5px solid #334155',
                display: 'inline-flex', alignItems: 'center', gap: '8px',
              }}
            >
              Contact the Team
            </Link>
          </div>

          {/* Stats */}
          <div style={{
            display: 'inline-flex', gap: '48px', flexWrap: 'wrap',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.1)',
            borderRadius: '16px', padding: '24px 40px',
          }}>
            {stats.map(({ value, label }) => (
              <div key={label} style={{ textAlign: 'center' }}>
                <p style={{ fontSize: '1.8rem', fontWeight: 800, color: '#a78bfa', margin: '0 0 4px', lineHeight: 1 }}>{value}</p>
                <p style={{ fontSize: '0.82rem', color: '#64748b', margin: 0 }}>{label}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BENEFITS */}
      <section style={{ padding: '80px 48px', width: '100%' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '56px' }}>
            <p style={{
              fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Why Join
            </p>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em', marginBottom: '16px',
            }}>
              Everything in One Place
            </h2>
            <p style={{ fontSize: '1rem', color: '#374151', maxWidth: '520px', margin: '0 auto', lineHeight: 1.75 }}>
              A private community for engineers who take AWS infrastructure seriously.
            </p>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '24px' }}>
            {benefits.map(({ icon: Icon, title, desc }) => (
              <div key={title} style={{
                background: '#fff', border: '1.5px solid #e5e7eb',
                borderRadius: '16px', padding: '32px',
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
                  width: '48px', height: '48px', borderRadius: '12px',
                  background: 'rgba(124,58,237,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  marginBottom: '20px',
                }}>
                  <Icon size={22} style={{ color: '#7c3aed' }} />
                </div>
                <h3 style={{ fontSize: '1.05rem', fontWeight: 700, color: '#0f172a', marginBottom: '10px' }}>
                  {title}
                </h3>
                <p style={{ fontSize: '0.9rem', color: '#374151', lineHeight: 1.75, margin: 0 }}>
                  {desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CHANNELS */}
      <section style={{ padding: '80px 48px', background: '#fafafa' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <div style={{ textAlign: 'center', marginBottom: '48px' }}>
            <p style={{
              fontSize: '0.72rem', fontWeight: 700, color: '#7c3aed',
              textTransform: 'uppercase', letterSpacing: '0.12em', marginBottom: '12px',
            }}>
              Community Channels
            </p>
            <h2 style={{
              fontSize: 'clamp(1.8rem, 3vw, 2.4rem)', fontWeight: 800,
              color: '#0f172a', letterSpacing: '-0.02em',
            }}>
              Find Your People
            </h2>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', maxWidth: '900px', margin: '0 auto' }}>
            {[
              { channel: '#aws-cost-optimization', desc: 'Share savings wins, ask for advice on rightsizing and Reserved Instances', members: '280+' },
              { channel: '#security-compliance', desc: 'SOC 2, HIPAA, CIS benchmarks — real practitioner discussions', members: '190+' },
              { channel: '#dora-metrics', desc: 'Deployment frequency, lead time, MTTR — compare notes with other teams', members: '150+' },
              { channel: '#platform-engineering', desc: 'Internal developer platforms, service catalogs, drift detection', members: '210+' },
              { channel: '#devcontrol-feedback', desc: 'Direct line to the product team — bug reports, feature requests, roadmap discussion', members: '500+' },
              { channel: '#show-and-tell', desc: 'Share dashboards, architecture decisions, and AWS wins with the community', members: '320+' },
            ].map(({ channel, desc, members }) => (
              <div key={channel} style={{
                background: '#fff', border: '1px solid #e5e7eb',
                borderRadius: '12px', padding: '20px 24px',
                display: 'flex', flexDirection: 'column', gap: '8px',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <p style={{ fontSize: '0.9rem', fontWeight: 700, color: '#7c3aed', margin: 0, fontFamily: 'monospace' }}>
                    {channel}
                  </p>
                  <span style={{
                    fontSize: '11px', fontWeight: 600, color: '#059669',
                    background: '#ECFDF5', padding: '2px 8px', borderRadius: '100px',
                  }}>
                    {members} members
                  </span>
                </div>
                <p style={{ fontSize: '0.82rem', color: '#475569', margin: 0, lineHeight: 1.6 }}>{desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* BOTTOM CTA */}
      <section style={{
        width: '100%',
        background: 'linear-gradient(135deg, #7c3aed, #6d28d9)',
        padding: '80px 48px', textAlign: 'center',
      }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto' }}>
          <h2 style={{
            fontSize: 'clamp(1.8rem, 4vw, 2.8rem)', fontWeight: 800,
            color: '#fff', marginBottom: '16px', letterSpacing: '-0.02em',
          }}>
            Ready to Join?
          </h2>
          <p style={{
            fontSize: '1.1rem', color: 'rgba(255,255,255,0.85)',
            maxWidth: '480px', margin: '0 auto 32px', lineHeight: 1.7,
          }}>
            It's free. Always will be. Join 500+ engineers building smarter cloud infrastructure.
          </p>
          <a
            href="https://join.slack.com/t/devcontrolcommunity/shared_invite/zt-3ul72iy4x-EJmlkBxEP8M2mvOP8KmFBg"
            target="_blank"
            rel="noopener noreferrer"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: '8px',
              background: '#fff', color: '#7c3aed',
              padding: '16px 36px', borderRadius: '10px',
              fontWeight: 700, fontSize: '1rem', textDecoration: 'none',
            }}
          >
            <Users size={18} />
            Join the Community
          </a>
          <p style={{ fontSize: '0.8rem', color: 'rgba(255,255,255,0.6)', marginTop: '16px' }}>
            No credit card · No commitment · Just engineers helping engineers
          </p>
        </div>
      </section>

    </div>
  )
}
