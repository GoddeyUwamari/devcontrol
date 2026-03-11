import { Shield, Lock, Award, Cloud, DollarSign, Clock, TrendingUp } from 'lucide-react'

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
  { icon: Shield, label: 'SOC 2 Ready' },
  { icon: Lock, label: 'GDPR Compliant' },
  { icon: Award, label: 'ISO 27001' },
]

const inner: React.CSSProperties = {
  maxWidth: '1200px',
  margin: '0 auto',
  padding: '0 48px',
}

const eyebrow: React.CSSProperties = {
  color: '#7c3aed',
  fontSize: '13px',
  letterSpacing: '0.1em',
  fontWeight: 600,
  textTransform: 'uppercase',
  marginBottom: '12px',
}

export function SocialProofSection() {
  return (
    <section
      style={{
        width: '100%',
        padding: '64px 0',
        background: 'linear-gradient(to bottom, #faf5ff, #f3e8ff)',
      }}
    >
      <div style={inner}>
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <p style={eyebrow}>Results</p>
          <h2 className="font-extrabold" style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', color: '#111827', marginBottom: '14px', lineHeight: 1.2 }}>
            Trusted by platform engineering teams
          </h2>
          <p style={{ fontSize: '1.125rem', color: '#6b7280', maxWidth: '480px', margin: '0 auto', lineHeight: 1.7 }}>
            Real results from teams saving real money with DevControl.
          </p>
        </div>

        <div className="grid md:grid-cols-3 gap-6" style={{ marginBottom: '40px' }}>
          {stats.map((stat) => {
            const Icon = stat.icon
            return (
              <div
                key={stat.label}
                style={{
                  textAlign: 'center',
                  backgroundColor: '#fff',
                  borderRadius: '16px',
                  padding: '40px 32px',
                  border: '1px solid #f3f4f6',
                  boxShadow: '0 4px 20px rgba(124,58,237,0.06)',
                }}
              >
                <div
                  className="rounded-xl flex items-center justify-center"
                  style={{ width: '52px', height: '52px', backgroundColor: '#ede9fe', margin: '0 auto 20px' }}
                >
                  <Icon className="h-6 w-6" style={{ color: '#7c3aed' }} />
                </div>
                <div className="font-extrabold" style={{ fontSize: 'clamp(2rem, 5vw, 3rem)', color: '#7c3aed', marginBottom: '10px' }}>
                  {stat.value}
                </div>
                <div style={{ color: '#6b7280', fontWeight: 500, fontSize: '15px' }}>{stat.label}</div>
              </div>
            )
          })}
        </div>

        <div className="flex flex-wrap items-center justify-center gap-4">
          {badges.map((badge) => {
            const Icon = badge.icon
            return (
              <div
                key={badge.label}
                className="flex items-center gap-3 rounded-full bg-white"
                style={{ padding: '10px 24px', border: '1px solid #e5e7eb', boxShadow: '0 1px 4px rgba(0,0,0,0.05)' }}
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
