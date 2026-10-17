'use client';

import { useEffect, useState } from 'react'
import { HeroSection } from '@/components/landing/HeroSection'
import { AIFeaturesSection } from '@/components/landing/AIFeaturesSection';
import { PersonaSection } from '@/components/landing/PersonaSection';
import { FounderSection } from './FounderSection';
import { FeaturePanels } from '@/components/landing/FeaturePanels';
import { PricingPreview } from '@/components/landing/PricingPreview';
import { CTASection } from '@/components/landing/CTASection';
import {
  Cloud,
  GitBranch,
  MessageSquare,
  Database,
  ShieldCheck,
  Lock,
  Eye,
  FileCheck,
} from 'lucide-react';

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

// Only integrations with real code behind them: AWS (the data source), GitHub
// (deployment webhooks for DORA metrics), Slack and Jira (alert-notification.service.ts).
// Do not re-add Kubernetes, Terraform, Datadog or PagerDuty without an integration.
const integrations = [
  { name: 'AWS',    desc: 'Cost, resource and security data, read-only',  icon: Cloud,         color: '#f97316' },
  { name: 'GitHub', desc: 'Deployment events for DORA metrics',           icon: GitBranch,     color: '#1f2937' },
  { name: 'Slack',  desc: 'Alert notifications and scheduled reports',    icon: MessageSquare, color: '#7c3aed' },
  { name: 'Jira',   desc: 'Tickets created from alerts',                  icon: Database,      color: '#7c3aed' },
];

const securityItems = [
  {
    icon: ShieldCheck,
    title: 'Read-Only by Default',
    description: 'Standard onboarding only requests read-only permissions. Optional remediation actions require separate, explicit permission and your approval — your infrastructure stays under your control.',
  },
  {
    icon: Lock,
    title: 'Encrypted Secrets',
    description: 'AWS credentials and SSO certificates are encrypted with AES-256-GCM before they are stored. Data in transit is sent over TLS.',
  },
  {
    icon: Eye,
    title: 'Zero Data Selling',
    description: "Your infrastructure data is yours. We never sell, share, or use it to train models beyond your own account's AI features.",
  },
  {
    icon: FileCheck,
    title: 'SOC 2 Readiness Planned',
    description: 'SOC 2 readiness planning underway (not an independent audit or certification), built from the ground up with compliance in mind.',
  },
];

export function MarketingContent() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  return (
    <>
      {/* Hero */}
      <HeroSection />

      {/* AI Features */}
      <FeaturePanels />
      <AIFeaturesSection />

      {/* Persona Tabs */}
      <PersonaSection />
      <FounderSection />

      {/* Integrations */}
      <section id="integrations" style={{ width: '100%', padding: isMobile ? '40px 0' : '64px 0', backgroundColor: '#f8f8f8' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: isMobile ? '0 16px' : isTablet ? '0 24px' : '0 32px' }}>
          <div style={{ textAlign: 'center', maxWidth: '640px', margin: isMobile ? '0 auto 28px' : '0 auto 40px' }}>
            <div style={{ marginBottom: '16px' }}>
              <span style={{
                display: 'inline-block',
                backgroundColor: '#7c3aed',
                color: '#ffffff',
                padding: '6px 14px',
                borderRadius: '999px',
                fontSize: '11px',
                fontWeight: 700,
                letterSpacing: '0.12em',
                textTransform: 'uppercase',
              }}>
                Integrations
              </span>
            </div>
            <h2
              className="font-extrabold"
              style={{ fontSize: isMobile ? '1.8rem' : isTablet ? '2.2rem' : 'clamp(2rem, 4vw, 2.8rem)', color: '#7c3aed', fontWeight: 800, marginBottom: '14px', lineHeight: 1.15, letterSpacing: '-0.02em' }}
            >
              Your Infrastructure Data, Unified in One Place
            </h2>
            <p style={{ fontSize: isMobile ? '1.1rem' : '1.2rem', color: '#1f2937', lineHeight: 1.75 }}>
              DevControl reads your AWS account and sends alerts and reports to the tools your team already uses.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5" style={{ marginBottom: '32px' }}>
            {integrations.map((integration) => {
              const Icon = integration.icon;
              return (
                <div
                  key={integration.name}
                  className="flex flex-col items-center bg-white rounded-2xl cursor-pointer"
                  style={{
                    padding: isMobile ? '20px 12px' : '24px 16px',
                    border: '2px solid #e5e7eb',
                    transition: 'all 0.2s ease',
                    textAlign: 'center',
                    gap: '10px',
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget;
                    el.style.boxShadow = '0 8px 30px rgba(124, 58, 237, 0.12)';
                    el.style.transform = 'translateY(-2px)';
                    el.style.borderColor = '#ede9fe';
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget;
                    el.style.boxShadow = 'none';
                    el.style.transform = 'translateY(0)';
                    el.style.borderColor = '#e5e7eb';
                  }}
                >
                  <Icon className="h-9 w-9" style={{ color: integration.color, flexShrink: 0 }} />
                  <div>
                    <div className="font-bold" style={{ fontSize: '14px', color: '#1e1b4b', marginBottom: '4px' }}>{integration.name}</div>
                    <div style={{ fontSize: '11px', color: '#374151', lineHeight: 1.4 }}>{integration.desc}</div>
                  </div>
                </div>
              );
            })}
          </div>

        </div>
      </section>

      {/* Security */}
      <section id="security" style={{ width: '100%', padding: isMobile ? '40px 0' : '64px 0', backgroundColor: '#f9f7ff' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: isMobile ? '0 16px' : isTablet ? '0 24px' : '0 32px' }}>
          <div style={{ textAlign: 'center', maxWidth: '600px', margin: isMobile ? '0 auto 32px' : '0 auto 48px' }}>
            <div style={{ marginBottom: '16px' }}>
              <span
                className="inline-flex items-center gap-2"
                style={{
                  backgroundColor: '#7c3aed',
                  color: '#ffffff',
                  padding: '6px 14px',
                  borderRadius: '999px',
                  fontSize: '11px',
                  fontWeight: 700,
                  letterSpacing: '0.12em',
                  textTransform: 'uppercase',
                }}
              >
                <ShieldCheck size={12} />
                Security &amp; Trust
              </span>
            </div>
            <h2
              className="font-extrabold"
              style={{ fontSize: isMobile ? '1.8rem' : isTablet ? '2.2rem' : 'clamp(2rem, 4vw, 2.8rem)', color: '#7c3aed', fontWeight: 800, marginBottom: '14px', lineHeight: 1.15, letterSpacing: '-0.02em' }}
            >
              Your data is safe with us
            </h2>
            <p style={{ fontSize: isMobile ? '1.1rem' : '1.2rem', color: '#1f2937', lineHeight: 1.75, marginBottom: '12px' }}>
              Here is exactly how DevControl handles your data.
            </p>
            <p style={{ fontSize: '15px', fontWeight: 600, color: '#7c3aed' }}>
              Standard onboarding uses a cross-account IAM role, so no AWS access keys are needed.
            </p>
          </div>

          <div className="grid sm:grid-cols-2 gap-6">
            {securityItems.map((item) => {
              const Icon = item.icon;
              return (
                <div
                  key={item.title}
                  className="flex items-start gap-5 bg-white rounded-2xl"
                  style={{
                    padding: isMobile ? '20px' : '32px',
                    border: '2px solid #e5e7eb',
                    transition: 'all 0.2s ease',
                  }}
                  onMouseEnter={(e) => {
                    const el = e.currentTarget;
                    el.style.boxShadow = '0 8px 30px rgba(124, 58, 237, 0.12)';
                    el.style.transform = 'translateY(-2px)';
                    el.style.borderColor = '#ede9fe';
                  }}
                  onMouseLeave={(e) => {
                    const el = e.currentTarget;
                    el.style.boxShadow = 'none';
                    el.style.transform = 'translateY(0)';
                    el.style.borderColor = '#e5e7eb';
                  }}
                >
                  <div
                    style={{
                      backgroundColor: '#7c3aed',
                      borderRadius: '14px',
                      padding: '12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon style={{ color: '#ffffff' }} size={22} />
                  </div>
                  <div>
                    <h3 className="font-bold" style={{ fontSize: isMobile ? '1rem' : '1.2rem', color: '#1e1b4b', marginBottom: '8px', lineHeight: 1.3 }}>{item.title}</h3>
                    <p style={{ color: '#1f2937', fontSize: isMobile ? '0.88rem' : '1.05rem', lineHeight: 1.65 }}>{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Pricing */}
      <PricingPreview />

      {/* Final CTA */}
      <CTASection />
    </>
  );
}