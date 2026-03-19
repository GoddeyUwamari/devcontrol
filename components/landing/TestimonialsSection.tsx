'use client';

// TODO: Replace with real customer quotes
const testimonials = [
  {
    stars: '★★★★★',
    quote: 'We cut our AWS bill by $3,100 in the first month. The AI spotted three EC2 instances running at under 20% utilisation that we\'d completely missed. Setup took 8 minutes.',
    highlight: '$3,100 in the first month',
    initials: 'MR',
    name: 'Marcus R.',
    title: 'Staff Platform Engineer · Series B fintech',
    outcome: 'Saved $3,100/mo',
  },
  {
    stars: '★★★★★',
    quote: 'DORA metrics used to take us half a day to compile for board reviews. Now it\'s real-time and automatic. Our CTO uses it directly in QBRs.',
    highlight: 'real-time and automatic',
    initials: 'SP',
    name: 'Sophia P.',
    title: 'VP Engineering · Enterprise SaaS',
    outcome: 'Eliminated 4hrs manual reporting/week',
  },
  {
    stars: '★★★★★',
    quote: 'The security compliance dashboard is the first thing our CTO checks before investor calls. It caught a misconfigured S3 bucket before our SOC 2 audit — that alone was worth it.',
    highlight: 'before our SOC 2 audit',
    initials: 'AK',
    name: 'Alex K.',
    title: 'Infrastructure Lead · Growth-stage startup',
    outcome: 'Passed SOC 2 audit clean',
  },
];

function renderQuoteWithHighlight(quote: string, highlight: string) {
  const parts = quote.split(highlight);
  if (parts.length !== 2) return <span>{quote}</span>;
  return (
    <>
      {parts[0]}
      <strong style={{ color: '#059669', fontStyle: 'normal', fontWeight: 600 }}>{highlight}</strong>
      {parts[1]}
    </>
  );
}

export function TestimonialsSection() {
  return (
    <section style={{ width: '100%', padding: '64px 56px', backgroundColor: '#F9FAFB' }}>
      <div style={{ maxWidth: '1320px', margin: '0 auto' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: '48px' }}>
          <p
            style={{
              fontSize: '0.72rem',
              fontWeight: 700,
              color: '#475569',
              textTransform: 'uppercase',
              letterSpacing: '0.08em',
              marginBottom: '12px',
            }}
          >
            Results
          </p>
          <h2
            style={{
              fontSize: 'clamp(24px, 3vw, 36px)',
              fontWeight: 700,
              letterSpacing: '-0.02em',
              color: '#0F172A',
              marginBottom: '12px',
              lineHeight: 1.2,
            }}
          >
            What teams are saying
          </h2>
          <p style={{ fontSize: '16px', color: '#475569' }}>
            Real outcomes from teams using DevControl.
          </p>
        </div>

        {/* Cards */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: '24px',
          }}
        >
          {testimonials.map((t) => (
            <div
              key={t.name}
              style={{
                background: '#FFFFFF',
                border: '1px solid #E2E8F0',
                borderRadius: '16px',
                padding: '28px',
              }}
            >
              {/* Stars */}
              <div
                style={{
                  color: '#F59E0B',
                  fontSize: '13px',
                  letterSpacing: '2px',
                  marginBottom: '16px',
                }}
              >
                {t.stars}
              </div>

              {/* Quote */}
              <p
                style={{
                  fontSize: '15px',
                  color: '#374151',
                  lineHeight: 1.65,
                  fontStyle: 'italic',
                  marginBottom: '24px',
                }}
              >
                &ldquo;{renderQuoteWithHighlight(t.quote, t.highlight)}&rdquo;
              </p>

              {/* Author */}
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: '#EDE9FE',
                    color: '#7C3AED',
                    fontSize: '13px',
                    fontWeight: 600,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {t.initials}
                </div>
                <div>
                  <div style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>
                    {t.name}
                  </div>
                  <div style={{ fontSize: '12px', color: '#475569', marginTop: '1px' }}>
                    {t.title}
                  </div>
                  <span
                    style={{
                      display: 'inline-block',
                      marginTop: '4px',
                      fontSize: '11px',
                      fontWeight: 600,
                      color: '#059669',
                      background: '#ECFDF5',
                      padding: '2px 8px',
                      borderRadius: '99px',
                    }}
                  >
                    {t.outcome}
                  </span>
                </div>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
