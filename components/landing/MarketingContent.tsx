'use client';

import { HeroSection } from '@/components/landing/HeroSection'
import { TrustedBySection } from '@/components/landing/TrustedBySection';
import { HowItWorks } from '@/components/landing/HowItWorks';
import { FeatureShowcase } from '@/components/landing/FeatureShowcase';
import { AIFeaturesSection } from '@/components/landing/AIFeaturesSection';
import { SocialProofSection } from '@/components/landing/SocialProofSection';
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

const integrations = [
  { name: 'AWS', icon: Cloud, color: '#f97316' },
  { name: 'GitHub', icon: GitBranch, color: '#1f2937' },
  { name: 'Slack', icon: MessageSquare, color: '#7c3aed' },
  { name: 'Terraform', icon: Layers, color: '#6d28d9' },
  { name: 'PagerDuty', icon: AlertCircle, color: '#16a34a' },
  { name: 'Kubernetes', icon: Container, color: '#2563eb' },
  { name: 'Datadog', icon: BarChart2, color: '#a855f7' },
  { name: 'Jira', icon: Database, color: '#1d4ed8' },
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
    title: 'SOC 2 Type II Ready',
    description:
      'Built from the ground up with compliance in mind. SOC 2 Type II audit in progress. GDPR and HIPAA-friendly architecture.',
  },
];


const inner: React.CSSProperties = {
  maxWidth: '1400px',
  margin: '0 auto',
  padding: '0 32px',
};

const eyebrow: React.CSSProperties = {
  color: '#7c3aed',
  fontSize: '13px',
  letterSpacing: '0.1em',
  fontWeight: 600,
  textTransform: 'uppercase',
  marginBottom: '12px',
};

export function MarketingContent() {
  return (
    <>
      {/* Hero */}
      <HeroSection />

      {/* Social Proof / Logo Ticker */}
      <TrustedBySection />

      {/* Platform Features */}
      <FeatureShowcase />

      {/* AI Features */}
      <AIFeaturesSection />

      {/* How It Works */}
      <HowItWorks />

      {/* Integrations */}
      <section id="integrations" style={{ width: '100%', padding: '64px 0', backgroundColor: '#f8f8f8' }}>
        <div style={inner}>
          <div style={{ textAlign: 'center', maxWidth: '600px', margin: '0 auto 40px' }}>
            <p style={eyebrow}>Integrations</p>
            <h2
              className="font-extrabold"
              style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', color: '#7c3aed', marginBottom: '14px', lineHeight: 1.2 }}
            >
              Works with your entire stack
            </h2>
            <p style={{ fontSize: '1.125rem', color: '#6b7280', lineHeight: 1.7 }}>
              DevControl connects to the tools your team already uses. One platform, zero friction.
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
                    padding: '28px 16px',
                    border: '1px solid #f3f4f6',
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
                    el.style.borderColor = '#f3f4f6';
                  }}
                >
                  <Icon className="h-10 w-10" style={{ color: integration.color }} />
                  <span className="font-semibold" style={{ fontSize: '14px', color: '#374151' }}>{integration.name}</span>
                </div>
              );
            })}
          </div>

          <div style={{ textAlign: 'center' }}>
            <Link
              href="/platform/integrations"
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
      <section id="security" style={{ width: '100%', padding: '64px 0', backgroundColor: '#fff' }}>
        <div style={inner}>
          <div style={{ textAlign: 'center', maxWidth: '600px', margin: '0 auto 48px' }}>
            <div
              className="inline-flex items-center gap-2 rounded-full font-semibold"
              style={{ color: '#7c3aed', backgroundColor: '#ede9fe', padding: '6px 16px', fontSize: '13px', marginBottom: '16px' }}
            >
              <ShieldCheck className="w-4 h-4" />
              Security &amp; Trust
            </div>
            <h2
              className="font-extrabold"
              style={{ fontSize: 'clamp(1.75rem, 4vw, 2.75rem)', color: '#7c3aed', marginBottom: '14px', lineHeight: 1.2 }}
            >
              Your data is safe with us
            </h2>
            <p style={{ fontSize: '1.125rem', color: '#6b7280', lineHeight: 1.7, marginBottom: '12px' }}>
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
                    padding: '32px',
                    border: '1px solid #f3f4f6',
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
                    el.style.borderColor = '#f3f4f6';
                  }}
                >
                  <div
                    style={{
                      backgroundColor: 'rgba(124,58,237,0.12)',
                      borderRadius: '14px',
                      padding: '12px',
                      display: 'inline-flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      flexShrink: 0,
                    }}
                  >
                    <Icon style={{ color: '#7c3aed' }} size={22} />
                  </div>
                  <div>
                    <h3 className="font-bold" style={{ fontSize: '1.0625rem', color: '#111827', marginBottom: '8px' }}>{item.title}</h3>
                    <p style={{ color: '#6b7280', fontSize: '14px', lineHeight: 1.7 }}>{item.description}</p>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </section>

      {/* Social Proof / Stats */}
      <SocialProofSection />

      {/* Pricing */}
      <PricingPreview />

      {/* Final CTA */}
      <CTASection />
    </>
  );
}
