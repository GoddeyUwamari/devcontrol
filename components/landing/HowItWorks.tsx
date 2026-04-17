import { Link2, BarChart3, Zap, ArrowRight } from 'lucide-react'

const steps = [
  {
    number: 1,
    title: 'Connect AWS',
    description: 'Deploy a read-only IAM role. 2 minutes, no credentials stored.',
    icon: Link2,
  },
  {
    number: 2,
    title: 'Get Instant Insights',
    description: 'See costs, security posture, and resource health across all accounts instantly.',
    icon: BarChart3,
  },
  {
    number: 3,
    title: 'Take Action',
    description: 'Optimize costs, fix security issues, and improve performance with one-click actions.',
    icon: Zap,
  },
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

export function HowItWorks() {
  return (
    <section id="how-it-works" style={{ width: '100%', padding: '64px 0', backgroundColor: '#f9f7ff' }}>
      <div style={inner}>
        <div style={{ textAlign: 'center', maxWidth: '600px', margin: '0 auto 48px' }}>
          <p style={eyebrow}>Simple Setup</p>
          <h2 className="font-extrabold" style={{ fontSize: 'clamp(2rem, 4vw, 2.8rem)', color: '#7c3aed', fontWeight: 800, marginBottom: '16px', lineHeight: 1.15, letterSpacing: '-0.02em' }}>
            From zero to insights in 15 minutes
          </h2>
          <p style={{ fontSize: '1.2rem', color: '#1f2937', lineHeight: 1.75 }}>
            No complex configuration. No agents to install. Just connect and go.
          </p>
        </div>

        <div className="flex flex-col md:flex-row items-start md:items-center justify-center gap-0">
          {steps.map((step, index) => {
            const Icon = step.icon
            return (
              <div key={index} className="flex flex-col md:flex-row items-center" style={{ flex: index < steps.length - 1 ? '1' : 'unset' }}>
                {/* Step card */}
                <div style={{ textAlign: 'center', padding: '0 16px', minWidth: '200px', maxWidth: '280px' }}>
                  <div className="relative inline-flex" style={{ marginBottom: '20px' }}>
                    <div
                      style={{
                        backgroundColor: 'rgba(124,58,237,0.12)',
                        borderRadius: '14px',
                        padding: '22px',
                        display: 'inline-flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                      }}
                    >
                      <Icon style={{ color: '#7c3aed' }} size={22} />
                    </div>
                    <div
                      className="absolute flex items-center justify-center text-white font-bold rounded-full shadow-lg"
                      style={{
                        top: '-8px',
                        right: '-8px',
                        width: '28px',
                        height: '28px',
                        backgroundColor: '#7c3aed',
                        fontSize: '13px',
                      }}
                    >
                      {step.number}
                    </div>
                  </div>
                  <h3 className="font-bold" style={{ fontSize: '1.2rem', color: '#1e1b4b', marginBottom: '8px', lineHeight: 1.3 }}>{step.title}</h3>
                  <p style={{ color: '#1f2937', fontSize: '1.05rem', lineHeight: 1.65 }}>{step.description}</p>
                </div>

                {/* Arrow connector (desktop only, between steps) */}
                {index < steps.length - 1 && (
                  <div className="hidden md:flex items-center justify-center" style={{ flex: 1, color: '#c4b5fd' }}>
                    <ArrowRight className="h-8 w-8" style={{ color: '#c4b5fd' }} />
                  </div>
                )}

                {/* Mobile vertical connector */}
                {index < steps.length - 1 && (
                  <div className="flex md:hidden justify-center" style={{ padding: '12px 0', color: '#c4b5fd' }}>
                    <ArrowRight className="h-6 w-6 rotate-90" style={{ color: '#c4b5fd' }} />
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </section>
  )
}
