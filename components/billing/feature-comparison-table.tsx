'use client';

import React from 'react';
import { Check, X, HelpCircle } from 'lucide-react';

interface Feature {
  category: string;
  name: string;
  free: boolean | string;
  starter: boolean | string;
  pro: boolean | string;
  enterprise: boolean | string;
  tooltip?: string;
  highlight?: boolean;
}

const features: Feature[] = [
  // Resources & Discovery
  { category: 'Resources & Discovery', name: 'AWS Account Connection', free: true, starter: true, pro: true, enterprise: true },
  { category: 'Resources & Discovery', name: 'AWS Resource Discovery & Inventory', free: true, starter: true, pro: true, enterprise: true },
  { category: 'Resources & Discovery', name: 'Expanded Resource Discovery', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Resources & Discovery', name: 'Multi-Account Visibility', free: false, starter: false, pro: false, enterprise: true },
  { category: 'Resources & Discovery', name: 'AWS Resources', free: '20', starter: '60', pro: '500', enterprise: 'Unlimited', tooltip: 'Number of AWS resources you can track and manage' },
  { category: 'Resources & Discovery', name: 'Team Members', free: '1', starter: '3', pro: '10', enterprise: 'Unlimited' },
  { category: 'Resources & Discovery', name: 'Cost History', free: 'Real-time only', starter: '30-day', pro: '90-day', enterprise: '90-day' },

  // Cost Management
  { category: 'Cost Management', name: 'Cost Overview (real-time spend tracking)', free: true, starter: true, pro: true, enterprise: true },
  { category: 'Cost Management', name: 'Orphaned Resource Detection', free: false, starter: true, pro: true, enterprise: true, tooltip: 'Find and eliminate unused resources wasting money' },
  { category: 'Cost Management', name: 'Cost Optimization Opportunities', free: false, starter: true, pro: true, enterprise: true, highlight: true },
  { category: 'Cost Management', name: 'Cost Data Export', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Cost Management', name: 'Cost Optimization — EC2, EBS, RDS, S3, Lambda, DynamoDB', free: false, starter: false, pro: true, enterprise: true },
  { category: 'Cost Management', name: 'Reserved Instance & Rightsizing Opportunities', free: false, starter: false, pro: true, enterprise: true },
  { category: 'Cost Management', name: 'Resource Efficiency Analysis', free: false, starter: false, pro: true, enterprise: true },
  { category: 'Cost Management', name: 'Team Cost Attribution', free: false, starter: false, pro: true, enterprise: true, tooltip: 'See costs broken down by team, project, or service' },
  { category: 'Cost Management', name: 'Predictive Budget Forecasting', free: false, starter: false, pro: true, enterprise: true },
  { category: 'Cost Management', name: 'Enterprise Optimization Rules', free: false, starter: false, pro: false, enterprise: true },
  { category: 'Cost Management', name: 'Custom Optimization Policies', free: false, starter: false, pro: false, enterprise: true },

  // Security & Compliance
  { category: 'Security & Compliance', name: 'Security Overview', free: true, starter: true, pro: true, enterprise: true },
  { category: 'Security & Compliance', name: 'IAM & MFA Visibility', free: true, starter: true, pro: true, enterprise: true },
  { category: 'Security & Compliance', name: 'Security Group Risk Detection', free: true, starter: true, pro: true, enterprise: true },
  { category: 'Security & Compliance', name: 'EC2 Encryption Visibility', free: true, starter: true, pro: true, enterprise: true },
  { category: 'Security & Compliance', name: 'Security Findings', free: false, starter: true, pro: true, enterprise: true, tooltip: 'Automated detection of security misconfigurations' },
  { category: 'Security & Compliance', name: 'Advanced Security Overview', free: false, starter: false, pro: true, enterprise: true },
  { category: 'Security & Compliance', name: 'Risk Score', free: false, starter: false, pro: true, enterprise: true, tooltip: 'Track infrastructure health over time' },
  { category: 'Security & Compliance', name: 'SOC 2, NIST, PCI DSS, CIS Compliance Readiness', free: false, starter: false, pro: true, enterprise: true, highlight: true, tooltip: 'Automated compliance checks against industry frameworks' },
  { category: 'Security & Compliance', name: 'Enterprise Security Command Center', free: false, starter: false, pro: false, enterprise: true, highlight: true },
  { category: 'Security & Compliance', name: 'Advanced Compliance Management', free: false, starter: false, pro: false, enterprise: true, highlight: true },
  { category: 'Security & Compliance', name: 'Full PDF Compliance Reports', free: false, starter: false, pro: false, enterprise: true },
  { category: 'Security & Compliance', name: 'Custom Anomaly Rules', free: false, starter: false, pro: false, enterprise: true },

  // AI & Automation
  { category: 'AI & Automation', name: 'AI Chat Assistant', free: false, starter: false, pro: true, enterprise: true },
  { category: 'AI & Automation', name: 'Natural-Language Queries', free: false, starter: false, pro: true, enterprise: true },
  { category: 'AI & Automation', name: 'AI-Generated Reports', free: false, starter: false, pro: true, enterprise: true },
  { category: 'AI & Automation', name: 'Scheduled AI Reports', free: false, starter: false, pro: true, enterprise: true },

  // Alerts & Monitoring
  { category: 'Alerts & Monitoring', name: 'Active Alerts', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Alerts & Monitoring', name: 'Alert History', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Alerts & Monitoring', name: 'Advanced Alert Configuration', free: false, starter: false, pro: true, enterprise: true },
  { category: 'Alerts & Monitoring', name: 'DORA Metrics', free: false, starter: false, pro: true, enterprise: true },
  { category: 'Alerts & Monitoring', name: 'SLO Dashboard & Management', free: false, starter: false, pro: false, enterprise: true },

  // Remediation & Governance
  { category: 'Remediation & Governance', name: 'Approval-Based Remediation Workflows', free: false, starter: false, pro: false, enterprise: true, highlight: true, tooltip: 'Automatically fix issues based on your defined policies' },

  // Team & Access
  { category: 'Team & Access', name: 'Team Management', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Team & Access', name: 'SAML/SSO', free: false, starter: false, pro: false, enterprise: true, highlight: true },

  // Integrations & Notifications
  { category: 'Integrations & Notifications', name: 'Email Notifications', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Integrations & Notifications', name: 'Slack Notifications', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Integrations & Notifications', name: 'Webhook Integrations', free: false, starter: false, pro: true, enterprise: true },
  { category: 'Integrations & Notifications', name: 'Custom Integrations', free: false, starter: false, pro: false, enterprise: true },

  // Reporting & Records
  { category: 'Reporting & Records', name: 'Activity Audit Trail', free: true, starter: true, pro: true, enterprise: true },
  { category: 'Reporting & Records', name: 'Billing & Invoices', free: false, starter: true, pro: true, enterprise: true },
  { category: 'Reporting & Records', name: 'Scheduled Reports', free: false, starter: false, pro: false, enterprise: true },

  // Platform Health
  { category: 'Platform Health', name: 'System Health Status', free: true, starter: true, pro: true, enterprise: true },

  // Support
  { category: 'Support', name: 'Priority Support', free: false, starter: false, pro: true, enterprise: true },
  { category: 'Support', name: 'Dedicated CSM', free: false, starter: false, pro: false, enterprise: true, highlight: true },
  { category: 'Support', name: 'SLA', free: false, starter: false, pro: false, enterprise: true },

  // Enterprise Extras
  { category: 'Enterprise Extras', name: 'Implementation Rules', free: false, starter: false, pro: false, enterprise: true },
];

function FeatureValue({ value, highlight, isProCol }: { value: boolean | string; highlight?: boolean; isProCol?: boolean }) {
  if (typeof value === 'boolean') {
    return value ? (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <Check style={{ width: '16px', height: '16px', color: '#16a34a' }} />
      </div>
    ) : (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <X style={{ width: '16px', height: '16px', color: '#d1d5db' }} />
      </div>
    );
  }
  return (
    <span style={{
      fontSize: '0.85rem',
      fontWeight: highlight ? 700 : 500,
      color: highlight ? '#7c3aed' : '#374151',
    }}>
      {value}
    </span>
  );
}

function FeatureName({ feature }: { feature: Feature }) {
  const nameContent = (
    <span style={{
      fontSize: '0.875rem',
      fontWeight: feature.highlight ? 600 : 400,
      color: '#374151',
      display: 'flex',
      alignItems: 'center',
      gap: '6px',
    }}>
      {feature.name}
      {feature.highlight && (
        <span style={{
          background: 'rgba(124,58,237,0.08)',
          color: '#7c3aed',
          borderRadius: '4px',
          padding: '1px 6px',
          fontSize: '0.65rem',
          fontWeight: 700,
        }}>
          Key
        </span>
      )}
    </span>
  );

  if (feature.tooltip) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }} title={feature.tooltip}>
        {nameContent}
        <HelpCircle style={{ width: '14px', height: '14px', color: '#9ca3af', flexShrink: 0 }} />
      </div>
    );
  }

  return nameContent;
}

const cellBase: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid #f3f4f6',
  fontSize: '0.875rem',
};

const proColStyle: React.CSSProperties = {
  background: 'rgba(124,58,237,0.04)',
  borderLeft: '1px solid rgba(124,58,237,0.15)',
  borderRight: '1px solid rgba(124,58,237,0.15)',
};

export function FeatureComparisonTable() {
  const categories = Array.from(new Set(features.map((f) => f.category)));

  return (
    <div style={{ width: '100%', display: 'flex', flexDirection: 'column', gap: '24px' }}>

      {/* Table */}
      <div style={{
        background: '#fff',
        border: '1.5px solid #e5e7eb',
        borderRadius: '16px',
        overflow: 'hidden',
        width: '100%',
      }}>
        <p className="sm:hidden text-xs text-gray-400 text-center py-2 border-b border-gray-100">
          ← Scroll to see all plans →
        </p>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', minWidth: '800px', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ background: '#f9fafb', borderBottom: '2px solid #e5e7eb' }}>
                <th style={{ ...cellBase, width: '280px', textAlign: 'left', fontWeight: 600, color: '#0f172a', position: 'sticky', left: 0, background: '#f9fafb', zIndex: 10 }}>
                  Feature
                </th>
                <th style={{ ...cellBase, width: '120px', textAlign: 'center', fontWeight: 600, color: '#0f172a' }}>
                  <div>Free</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 400, color: '#6b7280', marginTop: '2px' }}>$0/mo</div>
                </th>
                <th style={{ ...cellBase, width: '120px', textAlign: 'center', fontWeight: 600, color: '#0f172a' }}>
                  <div>Starter</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 400, color: '#6b7280', marginTop: '2px' }}>$49/mo</div>
                </th>
                <th style={{ ...cellBase, ...proColStyle, width: '140px', textAlign: 'center', fontWeight: 600, color: '#0f172a', borderTop: '2px solid #7c3aed' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '6px' }}>
                    Pro
                    <span style={{
                      background: 'rgba(124,58,237,0.1)', color: '#7c3aed',
                      borderRadius: '100px', padding: '1px 8px',
                      fontSize: '0.65rem', fontWeight: 700,
                    }}>Popular</span>
                  </div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 400, color: '#6b7280', marginTop: '2px' }}>$199/mo</div>
                </th>
                <th style={{ ...cellBase, width: '140px', textAlign: 'center', fontWeight: 600, color: '#0f172a' }}>
                  <div>Enterprise</div>
                  <div style={{ fontSize: '0.75rem', fontWeight: 400, color: '#6b7280', marginTop: '2px' }}>Custom</div>
                </th>
              </tr>
            </thead>
            <tbody>
              {categories.map((category) => {
                const categoryFeatures = features.filter((f) => f.category === category);
                return (
                  <React.Fragment key={category}>
                    <tr style={{ background: '#f9fafb' }}>
                      <td colSpan={5} style={{ ...cellBase, fontWeight: 700, fontSize: '0.8rem', color: '#7c3aed', textTransform: 'uppercase', letterSpacing: '0.08em', position: 'sticky', left: 0, background: '#f9fafb', zIndex: 10 }}>
                        {category}
                      </td>
                    </tr>
                    {categoryFeatures.map((feature, index) => (
                      <tr
                        key={`${category}-${index}`}
                        style={{ background: feature.highlight ? 'rgba(124,58,237,0.02)' : '#fff' }}
                      >
                        <td style={{ ...cellBase, position: 'sticky', left: 0, background: feature.highlight ? 'rgba(124,58,237,0.02)' : '#fff', zIndex: 10 }}>
                          <FeatureName feature={feature} />
                        </td>
                        <td style={{ ...cellBase, textAlign: 'center' }}>
                          <FeatureValue value={feature.free} highlight={feature.highlight} />
                        </td>
                        <td style={{ ...cellBase, textAlign: 'center' }}>
                          <FeatureValue value={feature.starter} highlight={feature.highlight} />
                        </td>
                        <td style={{ ...cellBase, ...proColStyle, textAlign: 'center' }}>
                          <FeatureValue value={feature.pro} highlight={feature.highlight} isProCol />
                        </td>
                        <td style={{ ...cellBase, textAlign: 'center' }}>
                          <FeatureValue value={feature.enterprise} highlight={feature.highlight} />
                        </td>
                      </tr>
                    ))}
                  </React.Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Footer Note */}
      <div style={{ textAlign: 'center' }}>
        <p style={{ fontSize: '0.875rem', color: '#374151', marginBottom: '4px' }}>
          All paid plans include a <strong style={{ color: '#0f172a' }}>14-day free trial</strong>. No credit card required to start.
        </p>
        <p style={{ fontSize: '0.78rem', color: '#6b7280' }}>
          Need a custom plan?{' '}
          <a href="mailto:sales@devcontrol.app" style={{ color: '#7c3aed', textDecoration: 'underline' }}>
            Contact our sales team
          </a>
        </p>
      </div>

    </div>
  );
}
