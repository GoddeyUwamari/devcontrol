'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  RefreshCw,
  CreditCard,
  XCircle,
  FileText,
  AlertCircle,
  Tag,
  Clock,
  Shield,
  RotateCcw,
  Download,
  CalendarDays,
  Headphones,
} from 'lucide-react';

interface FAQItem {
  icon: React.ElementType;
  question: string;
  answer: string;
}

const faqs: FAQItem[] = [
  {
    icon: RefreshCw,
    question: 'Can I change plans anytime?',
    answer:
      'Yes, upgrade or downgrade anytime from your account settings. Changes take effect immediately. Upgrades are prorated for the remainder of your billing cycle, and downgrades apply at the end of your current billing period. No penalties or fees.',
  },
  {
    icon: Clock,
    question: 'What happens after my free trial?',
    answer:
      "After your 14-day free trial, your account automatically converts to your chosen paid plan. You'll receive email reminders before the trial ends. If you don't want to continue, simply cancel before the trial ends - no charge.",
  },
  {
    icon: RotateCcw,
    question: 'Do you offer refunds?',
    answer:
      "Yes! We offer a 14-day money-back guarantee on all paid plans, no questions asked. If you're not satisfied within the first 14 days of your subscription, contact support for a full refund.",
  },
  {
    icon: CreditCard,
    question: 'What payment methods do you accept?',
    answer:
      'We accept all major credit cards (Visa, MasterCard, American Express, Discover) through Stripe. For Enterprise plans, we also offer ACH bank transfers and invoicing with NET-30 terms.',
  },
  {
    icon: Headphones,
    question: 'Is support included?',
    answer:
      'Yes! All plans include support. Free tier gets community support. Starter includes email support (24hr response). Pro gets priority support (4hr response) plus Slack integration. Enterprise includes a dedicated account manager and 24/7 priority support.',
  },
  {
    icon: FileText,
    question: "What's included in the 14-day free trial?",
    answer:
      "Full access to all features of your chosen plan for 14 days. No credit card required to start. Connect your AWS account, explore all features, and see real cost savings opportunities. If you need more time, just ask - we're happy to extend.",
  },
  {
    icon: CalendarDays,
    question: 'How does annual billing work?',
    answer:
      "Pay annually and save 20% compared to monthly billing. You'll receive a single invoice for the full year. Annual subscriptions can be cancelled anytime, with a prorated refund for unused months.",
  },
  {
    icon: Download,
    question: 'Can I export my data?',
    answer:
      'Yes, export all your data anytime in CSV or JSON format. We believe in data portability. Starter plans and above include export functionality. You can also access your data via API on Enterprise plans.',
  },
  {
    icon: XCircle,
    question: 'Can I cancel anytime?',
    answer:
      'Absolutely. Cancel your subscription at any time from your account settings. No cancellation fees, no penalties. Your access continues until the end of your billing period. You can reactivate anytime.',
  },
  {
    icon: AlertCircle,
    question: 'What happens if I exceed my resource limit?',
    answer:
      "We'll send you email notifications as you approach your limit. You can either upgrade or remove resources - we never charge surprise overage fees. You have full control over when to upgrade.",
  },
  {
    icon: Tag,
    question: 'Do you offer discounts for startups or nonprofits?',
    answer:
      'Yes! Early-stage startups (< 2 years, < $1M funding) and registered nonprofits get up to 50% off for the first year. Contact sales@devcontrol.app with your details.',
  },
  {
    icon: Shield,
    question: 'How secure is my AWS data?',
    answer:
      "DevControl uses read-only IAM roles - we never store your AWS credentials. All data is encrypted at rest (AES-256) and in transit (TLS 1.3). We're GDPR compliant and working toward SOC 2 Type II certification. Your infrastructure data never leaves our secure environment.",
  },
];

export function PricingFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  const midpoint = Math.ceil(faqs.length / 2);
  const leftColumn = faqs.slice(0, midpoint);
  const rightColumn = faqs.slice(midpoint);

  const renderFAQItem = (faq: FAQItem, index: number, columnOffset: number = 0) => {
    const actualIndex = index + columnOffset;
    const Icon = faq.icon;
    const isOpen = openIndex === actualIndex;

    return (
      <div key={actualIndex}>
        <button
          onClick={() => toggleFAQ(actualIndex)}
          style={{
            width: '100%',
            textAlign: 'left',
            padding: '20px',
            background: '#fff',
            borderRadius: '12px',
            border: isOpen ? '1.5px solid #7c3aed' : '1.5px solid #e5e7eb',
            cursor: 'pointer',
            boxShadow: isOpen ? '0 4px 16px rgba(124,58,237,0.1)' : 'none',
            transition: 'border-color 0.2s ease, box-shadow 0.2s ease',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
            <div style={{
              width: '40px', height: '40px', borderRadius: '10px',
              background: 'rgba(124,58,237,0.08)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0,
            }}>
              <Icon style={{ width: '18px', height: '18px', color: '#7c3aed' }} />
            </div>

            <div style={{ flex: 1, minWidth: 0 }}>
              <h3 style={{
                fontSize: '0.95rem', fontWeight: 600,
                color: isOpen ? '#7c3aed' : '#0f172a',
                marginBottom: isOpen ? '8px' : '0',
                transition: 'color 0.2s ease',
              }}>
                {faq.question}
              </h3>

              <div style={{
                overflow: 'hidden',
                maxHeight: isOpen ? '300px' : '0',
                transition: 'max-height 0.3s ease',
              }}>
                <p style={{
                  fontSize: '0.875rem', color: '#374151',
                  lineHeight: 1.6,
                }}>
                  {faq.answer}
                </p>
              </div>
            </div>

            <ChevronDown style={{
              width: '20px', height: '20px', flexShrink: 0,
              color: isOpen ? '#7c3aed' : '#9ca3af',
              transform: isOpen ? 'rotate(180deg)' : 'rotate(0deg)',
              transition: 'transform 0.2s ease, color 0.2s ease',
            }} />
          </div>
        </button>
      </div>
    );
  };

  return (
    <div style={{ width: '100%', maxWidth: '1400px', margin: '0 auto', padding: '0', display: 'flex', flexDirection: 'column', gap: '40px' }}>

      {/* FAQ Grid */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '16px', width: '100%' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {leftColumn.map((faq, index) => renderFAQItem(faq, index, 0))}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {rightColumn.map((faq, index) => renderFAQItem(faq, index, midpoint))}
        </div>
      </div>

      {/* Still have questions */}
      <div style={{
        textAlign: 'center',
        padding: '40px 32px',
        background: '#faf5ff',
        border: '1px solid rgba(124,58,237,0.15)',
        borderRadius: '16px',
      }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: 700, color: '#0f172a', marginBottom: '8px' }}>
          Still have questions?
        </h3>
        <p style={{ fontSize: '0.95rem', color: '#374151', marginBottom: '24px' }}>
          Our team is here to help you find the perfect plan
        </p>
        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center', flexWrap: 'wrap' }}>
          <a
            href="/contact"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '12px 24px',
              background: '#7c3aed', color: '#fff',
              borderRadius: '10px', fontWeight: 600, fontSize: '0.9rem',
              textDecoration: 'none',
            }}
          >
            Contact Sales
          </a>
          <a
            href="/docs"
            style={{
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              padding: '12px 24px',
              background: 'transparent', color: '#7c3aed',
              border: '1.5px solid #7c3aed',
              borderRadius: '10px', fontWeight: 600, fontSize: '0.9rem',
              textDecoration: 'none',
            }}
          >
            Read Documentation
          </a>
        </div>
      </div>

    </div>
  );
}
