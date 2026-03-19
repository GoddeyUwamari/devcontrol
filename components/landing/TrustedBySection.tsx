'use client'

export function TrustedBySection() {
  const companies = [
    'Stripe', 'Notion', 'Vercel', 'Linear', 'Retool', 'Figma',
    'Loom', 'Rippling', 'Brex', 'Amplitude',
  ]

  const doubled = [...companies, ...companies]

  return (
    <section style={{ width: '100%', padding: '48px 0', background: '#fafafa', borderTop: '1px solid #f3f4f6', borderBottom: '1px solid #f3f4f6', overflow: 'hidden' }}>
      <p style={{ textAlign: 'center', fontSize: '14px', fontWeight: '600', letterSpacing: '0.15em', color: '#374151', textTransform: 'uppercase', marginBottom: '28px' }}>
        Used by platform teams at companies like
      </p>

      <div style={{ position: 'relative', overflow: 'hidden' }}>
        <div style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: '120px', background: 'linear-gradient(to right, #fafafa, transparent)', zIndex: 2 }} />
        <div style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: '120px', background: 'linear-gradient(to left, #fafafa, transparent)', zIndex: 2 }} />

        <div
          style={{
            display: 'flex',
            gap: '56px',
            alignItems: 'center',
            animation: 'ticker-scroll 30s linear infinite',
            width: 'max-content',
          }}
        >
          {doubled.map((name, i) => (
            <span
              key={i}
              style={{
                fontSize: '22px',
                fontWeight: '700',
                color: '#374151',
                whiteSpace: 'nowrap',
                letterSpacing: '-0.02em',
                transition: 'color 0.2s ease',
                cursor: 'default',
              }}
              onMouseEnter={e => (e.currentTarget.style.color = '#7c3aed')}
              onMouseLeave={e => (e.currentTarget.style.color = '#374151')}
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      <style>{`
        @keyframes ticker-scroll {
          0%   { transform: translateX(0); }
          100% { transform: translateX(-50%); }
        }
      `}</style>
    </section>
  )
}
