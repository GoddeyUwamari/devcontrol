import { useEffect, useState } from 'react'
import { Shield, Lock, Cloud, DollarSign, Clock, TrendingUp } from 'lucide-react'

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

const stats = [
  {
    icon: DollarSign,
    value: '$2,400/mo',
    label: 'Average monthly savings per team',
  },
  {
    icon: Clock,
    value: '15 minutes',
    label: 'Average time to first insight',
  },
  {
    icon: TrendingUp,
    value: '99.9%',
    label: 'Platform uptime SLA',
  },
]

const badges = [
  { icon: Cloud, label: 'AWS Partner' },
  { icon: Shield, label: 'SOC 2 In Progress' },
  { icon: Lock, label: 'GDPR Compliant' },
  { icon: Lock, label: 'Zero Credential Storage' },
]

const inner: React.CSSProperties = {
  maxWidth: '1400px',
  margin: '0 auto',
  padding: '0 32px',
}

const eyebrow: React.CSSProperties = {
  color: '#7c3aed',
  fontSize: '11px',
  letterSpacing: '0.12em',
  fontWeight: 700,
  textTransform: 'uppercase',
  marginBottom: '12px',
}

export function SocialProofSection() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640

  return (
    <section
      style={{
        width: '100%',
        padding: isMobile ? '40px 0' : '64px 0',
        background: 'linear-gradient(to bottom, #faf5ff, #f3e8ff)',
      }}
    >
      <div style={{ maxWidth: '1400px', margin: '0 auto', padding: isMobile ? '0 16px' : '0 32px' }}>
        <div className="grid md:grid-cols-3 gap-6" style={{ marginBottom: isMobile ? '24px' : '40px' }}>
          {stats.map((stat) => {
            const Icon = stat.icon
            return (
              <div
                key={stat.label}
                style={{
                  textAlign: 'center',
                  backgroundColor: '#fff',
                  borderRadius: '16px',
                  padding: isMobile ? '24px 20px' : '40px 32px',
                  border: '2px solid #e5e7eb',
                  boxShadow: 'none',
                }}
              >
                <div
                  style={{
                    backgroundColor: 'rgba(124,58,237,0.12)',
                    borderRadius: '14px',
                    padding: '12px',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    margin: '0 auto 20px',
                  }}
                >
                  <Icon style={{ color: '#7c3aed' }} size={22} />
                </div>
                <div className="font-extrabold" style={{ fontSize: isMobile ? 'clamp(1.6rem, 4vw, 2.2rem)' : 'clamp(2rem, 4vw, 2.8rem)', color: '#7c3aed', fontWeight: 800, lineHeight: 1, marginBottom: '10px' }}>
                  {stat.value}
                </div>
                <div style={{ color: '#374151', fontWeight: 500, fontSize: isMobile ? '0.8rem' : '0.875rem', marginTop: '6px' }}>{stat.label}</div>
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center justify-center" style={{ gap: isMobile ? '8px' : '16px' }}>
          {badges.map((badge) => {
            const Icon = badge.icon
            return (
              <div
                key={badge.label}
                className="flex items-center gap-3 rounded-full bg-white"
                style={{ padding: isMobile ? '8px 16px' : '10px 24px', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
              >
                <Icon className="h-5 w-5" style={{ color: '#7c3aed' }} />
                <span className="font-medium" style={{ color: '#374151' }}>{badge.label}</span>
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
