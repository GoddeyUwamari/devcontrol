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

const stats = [
  { value: '$2,400', suffix: '/mo', label: 'Average monthly savings per team' },
  { value: '15', suffix: ' min', label: 'From signup to first insight' },
  { value: '99.9', suffix: '%', label: 'Platform uptime SLA' },
];

export function StatsBar() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640

  return (
    <div
      style={{
        background: '#F9FAFB',
        borderTop: '1px solid #E2E8F0',
        borderBottom: '1px solid #E2E8F0',
        padding: isMobile ? '24px 16px' : '32px 56px',
      }}
    >
      <div
        style={{
          maxWidth: '900px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: isMobile ? '1fr' : 'repeat(3, 1fr)',
        }}
      >
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            style={{
              textAlign: 'center',
              padding: isMobile ? '16px 0' : '0 32px',
              borderRight: isMobile ? 'none' : index < stats.length - 1 ? '1px solid #E2E8F0' : 'none',
              borderBottom: isMobile && index < stats.length - 1 ? '1px solid #E2E8F0' : 'none',
            }}
          >
            <div
              style={{
                fontSize: isMobile ? '24px' : '32px',
                fontWeight: 600,
                letterSpacing: '-0.03em',
                color: '#0F172A',
                lineHeight: 1,
                marginBottom: '6px',
              }}
            >
              <span style={{ color: '#7C3AED' }}>{stat.value}</span>{stat.suffix}
            </div>
            <div
              style={{
                fontSize: isMobile ? '12px' : '13px',
                color: '#475569',
                fontWeight: 400,
              }}
            >
              {stat.label}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
