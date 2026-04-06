'use client';

import { TrendingDown, Clock, Shield, DollarSign, Zap, BarChart3 } from 'lucide-react';

const roiMetrics = [
  {
    icon: TrendingDown,
    metric: '$2,400',
    sublabel: '/month average',
    title: 'AWS Cost Savings',
    description: '12-18% reduction in cloud spend through optimization recommendations',
    metricColor: '#16a34a',
    iconBg: 'rgba(22,163,74,0.1)',
    iconColor: '#16a34a',
    cardBg: 'linear-gradient(135deg, #f0fdf4, #ecfdf5)',
    cardBorder: 'rgba(22,163,74,0.2)',
  },
  {
    icon: Clock,
    metric: '20 hours',
    sublabel: '/month saved',
    title: 'Time Saved',
    description: '3-minute setup vs hours of manual tracking and configuration',
    metricColor: '#7c3aed',
    iconBg: 'rgba(124,58,237,0.1)',
    iconColor: '#7c3aed',
    cardBg: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
    cardBorder: 'rgba(124,58,237,0.2)',
  },
  {
    icon: Shield,
    metric: '$15K',
    sublabel: 'average prevented',
    title: 'Risk Reduction',
    description: 'Prevent budget overruns with real-time alerts and 100% infrastructure visibility',
    metricColor: '#7c3aed',
    iconBg: 'rgba(124,58,237,0.1)',
    iconColor: '#7c3aed',
    cardBg: 'linear-gradient(135deg, #faf5ff, #f3e8ff)',
    cardBorder: 'rgba(124,58,237,0.2)',
  },
];

const additionalBenefits = [
  {
    icon: DollarSign,
    title: 'Orphaned Resource Detection',
    value: '$800+',
    description: 'average monthly waste identified',
  },
  {
    icon: Zap,
    title: 'Right-sizing Recommendations',
    value: '25%',
    description: 'typical EC2 cost reduction',
  },
  {
    icon: BarChart3,
    title: 'Reserved Instance Opportunities',
    value: '40%',
    description: 'savings vs on-demand pricing',
  },
];

export function PricingROI() {
  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '40px' }}>

      {/* Main ROI Cards */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: '24px',
        width: '100%',
      }}>
        {roiMetrics.map((item, index) => {
          const Icon = item.icon;
          return (
            <div
              key={index}
              style={{
                background: item.cardBg,
                border: `1.5px solid ${item.cardBorder}`,
                borderRadius: '16px',
                padding: '32px',
                display: 'flex',
                flexDirection: 'column',
              }}
            >
              <div style={{
                width: '48px', height: '48px', borderRadius: '12px',
                background: item.iconBg,
                display: 'flex', alignItems: 'center', justifyContent: 'center',
                marginBottom: '20px', flexShrink: 0,
              }}>
                <Icon style={{ width: '24px', height: '24px', color: item.iconColor }} />
              </div>

              <div style={{ marginBottom: '16px' }}>
                <div style={{ fontSize: '2.8rem', fontWeight: 800, color: item.metricColor, lineHeight: 1 }}>
                  {item.metric}
                </div>
                <div style={{ fontSize: '0.875rem', color: '#374151', fontWeight: 500, marginTop: '4px' }}>
                  {item.sublabel}
                </div>
              </div>

              <h3 style={{ fontSize: '1rem', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
                {item.title}
              </h3>
              <p style={{ fontSize: '0.875rem', color: '#374151', lineHeight: 1.6 }}>
                {item.description}
              </p>
            </div>
          );
        })}
      </div>

      {/* Additional Benefits Bar */}
      <div style={{
        background: '#fff',
        border: '1.5px solid #e5e7eb',
        borderRadius: '16px',
        padding: '32px',
        width: '100%',
      }}>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: '32px',
        }}>
          {additionalBenefits.map((benefit, index) => {
            const Icon = benefit.icon;
            return (
              <div key={index} style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
                <div style={{
                  width: '40px', height: '40px', borderRadius: '10px',
                  background: 'rgba(124,58,237,0.08)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <Icon style={{ width: '20px', height: '20px', color: '#7c3aed' }} />
                </div>
                <div>
                  <div style={{ display: 'flex', alignItems: 'baseline', gap: '8px', marginBottom: '4px' }}>
                    <span style={{ fontSize: '1.3rem', fontWeight: 800, color: '#0f172a' }}>{benefit.value}</span>
                    <span style={{ fontSize: '0.78rem', color: '#374151' }}>{benefit.description}</span>
                  </div>
                  <p style={{ fontSize: '0.875rem', fontWeight: 600, color: '#0f172a' }}>{benefit.title}</p>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* ROI Teaser */}
      <div style={{
        textAlign: 'center',
        padding: '24px 32px',
        background: '#f9fafb',
        borderRadius: '12px',
        border: '1px dashed #d1d5db',
        width: '100%',
      }}>
        <p style={{ fontSize: '0.875rem', color: '#374151', marginBottom: '6px' }}>
          <strong style={{ color: '#0f172a' }}>Pro Plan Example:</strong>{' '}
          Typical ROI: Save $2,400/mo vs $199 cost ={' '}
          <strong style={{ color: '#16a34a' }}>8x return</strong>
        </p>
        <p style={{ fontSize: '0.78rem', color: '#6b7280' }}>
          Based on average customer data. Your actual savings may vary based on infrastructure size.
        </p>
      </div>

    </div>
  );
}
