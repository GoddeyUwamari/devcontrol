'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  RefreshCw,
  CreditCard,
  XCircle,
  FileText,
  AlertCircle,
  Clock,
  Shield,
  RotateCcw,
  Download,
  CalendarDays,
  Headphones,
} from 'lucide-react';
import { useTrialOn } from '@/components/billing/trial-line';
import { annual, formatUsd, plan } from '@/lib/plan/plan-catalog';
import { PLAN_NAME } from '@/lib/plan/plan-names';

interface FAQItem {
  icon: React.ElementType;
  question: string;
  answer: string;
}

/** Annual figures, computed from the catalog prices (never typed). */
function annualAnswer(): string {
  const starter = annual('starter');
  const pro = annual('pro');
  if (!starter || !pro) throw new Error('Annual prices missing from the plan catalog');
  const percent = Math.round((starter.savingPerYear / ((plan('starter').monthly ?? 0) * 12)) * 100);
  const months = 12 - starter.monthsFree;
  return `Annual billing costs the same as ${months} months: ${formatUsd(starter.total)} a year for ${PLAN_NAME.starter} and ${formatUsd(pro.total)} for ${PLAN_NAME.pro}, about ${percent}% less than monthly. You get one invoice for the year. If you cancel, your plan stays active until the end of the paid year; unused months aren't refunded automatically.`;
}

/** The pricing FAQ. Trial questions appear only while the trial is on (GET /api/billing/offer). */
export function pricingFaqs(trial: { on: boolean; days: number; plans: string }): FAQItem[] {
  const items: (FAQItem | null)[] = [
    {
      icon: RefreshCw,
      question: 'Can I change plans anytime?',
      answer:
        'Yes. An organization owner or admin can change plans from Billing settings. Changes take effect immediately: an upgrade adds a prorated charge and a downgrade a prorated credit to your next invoice. No penalties or fees.',
    },
    trial.on ? {
      icon: Clock,
      question: 'What happens after my free trial?',
      answer:
        `When the ${trial.days}-day trial ends, your plan continues and your card is charged, unless you cancel before then. Cancel before the trial ends and you aren't charged.`,
    } : null,
    {
      icon: RotateCcw,
      question: 'Do you offer refunds?',
      answer:
        "If a charge looks wrong, email support@getdevcontrol.com within 14 days of it and we'll review it. Unused time in a billing period isn't refunded automatically.",
    },
    {
      icon: CreditCard,
      question: 'What payment methods do you accept?',
      answer:
        `We accept all major credit cards (Visa, MasterCard, American Express, Discover) through Stripe. For ${PLAN_NAME.enterprise}, we can also invoice you; talk to us.`,
    },
    {
      icon: Headphones,
      question: 'Is support included?',
      answer:
        `Yes. ${PLAN_NAME.free} includes community support (Slack). ${PLAN_NAME.starter} adds email support. ${PLAN_NAME.pro} adds priority email support. ${PLAN_NAME.enterprise} adds a named support contact; talk to us about an SLA.`,
    },
    trial.on ? {
      icon: FileText,
      question: `What's included in the ${trial.days}-day free trial?`,
      answer:
        `Everything in the plan you choose, for ${trial.days} days, on ${trial.plans.replace(' and ', ' or ')}. A card is required; you're charged when the trial ends unless you cancel.`,
    } : null,
    {
      icon: CalendarDays,
      question: 'How does annual billing work?',
      answer: annualAnswer(),
    },
    {
      icon: Download,
      question: 'Can I export my data?',
      answer:
        `${PLAN_NAME.starter} and above can export the resource inventory, with each resource's estimated monthly cost, as CSV or PDF. API access is coming soon.`,
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
        "You're never charged automatically for going over. Once you're over your plan's resource limit, the inventory asks you to upgrade, and DevControl keeps discovering every resource. Email warnings as you approach the limit are coming soon.",
    },
    {
      icon: Shield,
      question: 'How secure is my AWS data?',
      answer:
        'DevControl uses a read-only IAM role, so it never stores AWS access keys. Data is encrypted in transit, and stored credentials and SSO certificates are encrypted at rest (AES-256-GCM). AI features send the relevant data to our AI provider to answer you. We have initiated SOC 2 readiness planning (not an independent audit or certification).',
    },
  ];
  return items.filter((item): item is FAQItem => item !== null);
}


export function PricingFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);
  const faqs = pricingFaqs(useTrialOn());

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
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full">
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
