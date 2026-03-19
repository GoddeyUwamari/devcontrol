'use client';

const stats = [
  { value: '$2,400', suffix: '/mo', label: 'Average monthly savings per team' },
  { value: '15', suffix: ' min', label: 'From signup to first insight' },
  { value: '99.9', suffix: '%', label: 'Platform uptime SLA' },
];

export function StatsBar() {
  return (
    <div
      style={{
        background: '#F9FAFB',
        borderTop: '1px solid #E2E8F0',
        borderBottom: '1px solid #E2E8F0',
        padding: '32px 56px',
      }}
    >
      <div
        style={{
          maxWidth: '900px',
          margin: '0 auto',
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
        }}
      >
        {stats.map((stat, index) => (
          <div
            key={stat.label}
            style={{
              textAlign: 'center',
              padding: '0 32px',
              borderRight: index < stats.length - 1 ? '1px solid #E2E8F0' : 'none',
            }}
          >
            <div
              style={{
                fontSize: '32px',
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
                fontSize: '13px',
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
