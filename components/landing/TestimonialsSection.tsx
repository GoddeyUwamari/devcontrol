'use client';

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

type Testimonial = {
  stars: number;
  before: string;
  highlight: string;
  after: string;
  name: string;
  title: string;
  company: string;
  outcome: string;
};

const testimonials: Testimonial[] = [
  {
    stars: 5,
    before: 'We cut our AWS bill by',
    highlight: '$3,100',
    after: 'in the first month. The AI identified three EC2 instances running under 20% utilization that we had missed entirely. Setup took 8 minutes.',
    name: 'Marcus R.',
    title: 'Staff Platform Engineer',
    company: 'Series B Fintech',
    outcome: 'Saved $3,100/month',
  },
  {
    stars: 5,
    before: 'DORA metrics used to take us',
    highlight: 'half a day',
    after: 'to compile for board reviews. Now it is real-time and fully automated. Our CTO uses it directly in quarterly board reporting.',
    name: 'Sophia P.',
    title: 'VP Engineering',
    company: 'Enterprise SaaS',
    outcome: 'Eliminated 4hrs/week',
  },
  {
    stars: 5,
    before: 'The security dashboard helped us catch a misconfiguration',
    highlight: 'before our SOC 2 audit',
    after: '. That alone justified the platform. Our CTO now checks it before every investor call.',
    name: 'Alex K.',
    title: 'Infrastructure Lead',
    company: 'Growth Startup',
    outcome: 'Passed SOC 2 clean',
  },
];

function Stars({ count }: { count: number }) {
  return (
    <div style={{ color: '#F59E0B', fontSize: '12px', letterSpacing: '2px' }}>
      {'★'.repeat(count)}
    </div>
  );
}

export function TestimonialsSection() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  return (
    <section
      style={{
        width: '100%',
        padding: isMobile ? '48px 16px' : isTablet ? '64px 24px' : '80px 24px',
        background: '#F9FAFB',
      }}
    >
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: isMobile ? '32px' : '56px' }}>
          <p
            style={{
              textTransform: 'uppercase',
              fontSize: '12px',
              letterSpacing: '0.15em',
              color: '#6B7280',
              marginBottom: '12px',
              fontWeight: 600,
            }}
          >
            Proven Results
          </p>
          <h2
            style={{
              fontSize: isMobile ? 'clamp(22px, 4vw, 32px)' : 'clamp(28px, 3vw, 40px)',
              fontWeight: 800,
              color: '#0F172A',
              marginBottom: '12px',
            }}
          >
            Trusted by Engineering Leaders
          </h2>
          <p style={{ color: '#475569', fontSize: isMobile ? '14px' : '16px' }}>
            Real outcomes from teams optimizing cost, performance, and risk at scale.
          </p>
        </div>

        {/* Grid */}
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: isMobile ? '1fr' : isTablet ? 'repeat(2, 1fr)' : 'repeat(3, 1fr)',
            gap: '24px',
          }}
        >
          {testimonials.map((t) => (
            <div
              key={t.name}
              style={{
                background: '#fff',
                border: '2px solid #e5e7eb',
                borderRadius: '18px',
                padding: isMobile ? '20px' : '28px',
                transition: 'all 0.25s ease',
              }}
              onMouseEnter={(e) => {
                const el = e.currentTarget;
                el.style.transform = 'translateY(-4px)';
                el.style.boxShadow = '0 10px 30px rgba(0,0,0,0.08)';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget;
                el.style.transform = 'translateY(0)';
                el.style.boxShadow = 'none';
              }}
            >
              <Stars count={t.stars} />

              <p
                style={{
                  marginTop: '16px',
                  fontSize: isMobile ? '14px' : '15px',
                  color: '#374151',
                  lineHeight: 1.7,
                }}
              >
                {'\u201C'}{t.before}{' '}
                <span style={{ fontWeight: 700, color: '#059669' }}>
                  {t.highlight}
                </span>
                {t.after}{'\u201D'}
              </p>

              <div
                style={{
                  marginTop: '16px',
                  display: 'inline-block',
                  background: '#ECFDF5',
                  color: '#059669',
                  padding: '4px 10px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: 600,
                }}
              >
                {t.outcome}
              </div>

              <div
                style={{
                  marginTop: '20px',
                  display: 'flex',
                  alignItems: 'center',
                  gap: '12px',
                }}
              >
                <div
                  style={{
                    width: '40px',
                    height: '40px',
                    borderRadius: '50%',
                    background: '#EDE9FE',
                    color: '#7C3AED',
                    fontWeight: 700,
                    fontSize: '12px',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    flexShrink: 0,
                  }}
                >
                  {t.name.split(' ').map((n) => n[0]).join('')}
                </div>
                <div>
                  <p style={{ fontSize: '14px', fontWeight: 600, color: '#0F172A' }}>
                    {t.name}
                  </p>
                  <p style={{ fontSize: '12px', color: '#64748B' }}>
                    {t.title}{' \u00B7 '}{t.company}
                  </p>
                </div>
              </div>
            </div>
          ))}
        </div>

        {/* Post-testimonial CTA */}
        <div style={{ textAlign: 'center', marginTop: isMobile ? '32px' : '48px' }}>
          <a
            href="/register"
            style={{
              color: '#7c3aed',
              fontWeight: 700,
              fontSize: '0.95rem',
              textDecoration: 'none',
              display: 'inline-flex',
              alignItems: 'center',
              gap: '6px',
            }}
          >
            {'Get similar results \u2014 start free \u2192'}
          </a>
        </div>

      </div>
    </section>
  );
}