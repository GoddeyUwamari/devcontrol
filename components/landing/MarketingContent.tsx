'use client';

import { useEffect, useState } from 'react'
import { HeroSection } from '@/components/landing/HeroSection'
import { DashboardPreview } from '@/components/landing/DashboardPreview';
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
  Layers,
  AlertCircle,
  Container,
  Database,
  BarChart2,
  ShieldCheck,
  Lock,
  Eye,
  FileCheck,
  ArrowRight,
} from 'lucide-react';
import Link from 'next/link';

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

const integrations = [
  { name: 'AWS', icon: Cloud, color: '#f97316' },
  { name: 'GitHub', icon: GitBranch, color: '#1f2937' },
  { name: 'Slack', icon: MessageSquare, color: '#7c3aed' },
  { name: 'Terraform', icon: Layers, color: '#6d28d9' },
  { name: 'PagerDuty', icon: AlertCircle, color: '#16a34a' },
  { name: 'Kubernetes', icon: Container, color: '#7c3aed' },
  { name: 'Datadog', icon: BarChart2, color: '#a855f7' },
  { name: 'Jira', icon: Database, color: '#7c3aed' },
];

const securityItems = [
  {
    icon: ShieldCheck,
    title: 'Read-Only AWS Access',
    description:
      'We only request the minimum permissions needed. No write access, ever. Your infrastructure stays fully under your control.',
  },
  {
    icon: Lock,
    title: 'End-to-End Encryption',
    description:
      'All data is encrypted in transit with TLS 1.3 and at rest with AES-256. Your cloud metadata never leaves our secure environment unencrypted.',
  },
  {
    icon: Eye,
    title: 'Zero Data Selling',
    description:
      "Your infrastructure data is yours. We never sell, share, or use it to train models beyond your own account's AI features.",
  },
  {
    icon: FileCheck,
    title: 'SOC 2 Audit Underway',
    description:
      'SOC 2 Type II audit in progress, built from the ground up with compliance in mind. GDPR and HIPAA-friendly architecture.',
  },
];

const inner: React.CSSProperties = {
  maxWidth: '1400px',
  margin: '0 auto',
  padding: '0 32px',
};

export function MarketingContent() {
  const width = useWindowWidth()
  const isMobile = width > 0 && width < 640
  const isTablet = width >= 640 && width < 1024

  return (
    <>
      {/* Hero */}
      <HeroSection />

      {/* Social Proof / Logo Ticker */}
      <DashboardPreview />

      {/* AI Features */}
      <FeaturePanels />
      <AIFeaturesSection />

      {/* Persona Tabs */}
      <PersonaSection />
      <FounderSection />

      {/* Integrations */}
      <section id="integrations" style={{ width: '100%', padding: isMobile ? '40px 0' : '64px 0', backgroundColor: '#f8f8f8' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: isMobile ? '0 16px' : isTablet ? '0 24px' : '0 32px' }}>
          <div style={{ textAlign: 'center', maxWidth: '600px', margin: isMobile ? '0 auto 28px' : '0 auto 40px' }}>

            {/* Eyebrow pill — solid violet matching page standard */}
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
              Connects With Your Existing Stack
            </h2>
            <p style={{ fontSize: isMobile ? '1.1rem' : '1.2rem', color: '#1f2937', lineHeight: 1.75 }}>
              DevControl connects with the tools your engineering teams already use — bringing cloud costs, reliability signals, and operational insights together without replacing your workflow.
            </p>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-5" style={{ marginBottom: '32px' }}>
            {integrations.map((integration) => {
              const Icon = integration.icon;
              return (
                <div
                  key={integration.name}
                  className="flex flex-col items-center gap-3 bg-white rounded-2xl cursor-pointer"
                  style={{
                    padding: isMobile ? '20px 12px' : '28px 16px',
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
                  <Icon className="h-10 w-10" style={{ color: integration.color }} />
                  <span className="font-semibold" style={{ fontSize: '14px', color: '#1f2937' }}>{integration.name}</span>
                </div>
              );
            })}
          </div>

          <div style={{ textAlign: 'center' }}>
            <Link
              href="/platform/infrastructure"
              className="inline-flex items-center gap-2 font-semibold"
              style={{ color: '#7c3aed', fontSize: '15px', textDecoration: 'none', transition: 'all 0.15s ease' }}
              onMouseEnter={(e) => {
                const el = e.currentTarget as HTMLAnchorElement;
                el.style.color = '#6b21a8';
                el.style.textDecoration = 'underline';
              }}
              onMouseLeave={(e) => {
                const el = e.currentTarget as HTMLAnchorElement;
                el.style.color = '#7c3aed';
                el.style.textDecoration = 'none';
              }}
            >
              View all integrations
              <ArrowRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      </section>

      {/* Security */}
      <section id="security" style={{ width: '100%', padding: isMobile ? '40px 0' : '64px 0', backgroundColor: '#f9f7ff' }}>
        <div style={{ maxWidth: '1400px', margin: '0 auto', padding: isMobile ? '0 16px' : isTablet ? '0 24px' : '0 32px' }}>
          <div style={{ textAlign: 'center', maxWidth: '600px', margin: isMobile ? '0 auto 32px' : '0 auto 48px' }}>

            {/* Eyebrow pill — solid violet matching page standard */}
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
              We built DevControl with a security-first mindset. Enterprise-grade protections out of the box — no add-ons required.
            </p>
            <p style={{ fontSize: '15px', fontWeight: 600, color: '#7c3aed' }}>
              We never store your AWS credentials. Ever.
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
                  {/* Solid violet icon background with white icon */}
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