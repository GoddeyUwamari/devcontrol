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
} from 'lucide-react';

interface FAQItem {
  icon: React.ElementType;
  question: string;
  answer: string;
}

const faqs: FAQItem[] = [
  {
    icon: RefreshCw,
    question: 'Can I change plans later?',
    answer:
      'Yes! You can upgrade or downgrade your plan at any time from your account settings. Changes are prorated, so you only pay for what you use. Upgrades take effect immediately, while downgrades apply at the end of your current billing period.',
  },
  {
    icon: CreditCard,
    question: 'What payment methods do you accept?',
    answer:
      'We accept all major credit cards (Visa, MasterCard, American Express, Discover) and debit cards through our secure payment processor, Stripe. For Enterprise plans, we also offer invoicing with NET-30 terms.',
  },
  {
    icon: XCircle,
    question: 'Can I cancel anytime?',
    answer:
      'Absolutely! You can cancel your subscription at any time with no cancellation fees or penalties. Your access will continue until the end of your current billing period, and you won\'t be charged again. You can always reactivate later.',
  },
  {
    icon: FileText,
    question: 'Is there a long-term contract?',
    answer:
      'No long-term contracts required. All plans are billed monthly or annually at your choice, and you can cancel anytime. Annual plans offer 20% savings but are still flexible - you can switch back to monthly billing when your annual term ends.',
  },
  {
    icon: AlertCircle,
    question: 'What happens if I exceed my resource limit?',
    answer:
      'If you approach your resource limit, we\'ll send you email notifications. You can either upgrade to a higher tier or remove resources to stay within your limit. We don\'t automatically charge overage fees - you have full control over when to upgrade.',
  },
  {
    icon: Tag,
    question: 'Do you offer discounts for startups or nonprofits?',
    answer:
      'Yes! We offer special pricing for early-stage startups (< 2 years, < $1M funding) and registered nonprofits. Contact sales@devcontrol.app with your details, and we\'ll create a custom plan with up to 50% off for your first year.',
  },
  {
    icon: Clock,
    question: 'What\'s included in the 14-day free trial?',
    answer:
      'The free trial gives you full access to all features of your chosen plan (Starter, Pro, or Enterprise) for 14 days. No credit card required to start. Connect your AWS account, explore all features, and see real cost optimization opportunities before you pay anything.',
  },
  {
    icon: Shield,
    question: 'How secure is my AWS data?',
    answer:
      'We take security seriously. DevControl uses read-only IAM roles - we never store your AWS credentials. All data is encrypted at rest (AES-256) and in transit (TLS 1.3). We\'re SOC 2 Type II compliant, GDPR ready, and follow AWS security best practices. Your infrastructure data never leaves our secure environment.',
  },
];

export function PricingFAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <div className="py-16 bg-muted/20">
      <div className="max-w-4xl mx-auto px-4">
        <div className="text-center mb-12">
          <h2 className="text-3xl font-bold mb-4">Frequently Asked Questions</h2>
          <p className="text-lg text-muted-foreground">
            Everything you need to know about pricing and plans
          </p>
        </div>

        <div className="grid md:grid-cols-2 gap-4">
          {faqs.map((faq, index) => {
            const Icon = faq.icon;
            const isOpen = openIndex === index;

            return (
              <div key={index} className="group">
                <button
                  onClick={() => toggleFAQ(index)}
                  className={`w-full text-left p-5 bg-card rounded-xl border-2 transition-all duration-300 ${
                    isOpen
                      ? 'border-primary shadow-lg'
                      : 'border-border hover:border-primary/50 hover:shadow-md'
                  }`}
                >
                  <div className="flex items-start gap-4">
                    <div className="w-10 h-10 rounded-lg bg-primary/10 flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110">
                      <Icon className="w-5 h-5 text-primary" />
                    </div>

                    <div className="flex-1 min-w-0">
                      <h3
                        className={`font-semibold mb-1 transition-colors ${
                          isOpen ? 'text-primary' : 'text-foreground group-hover:text-primary'
                        }`}
                      >
                        {faq.question}
                      </h3>

                      <div
                        className={`overflow-hidden transition-all duration-300 ${
                          isOpen ? 'max-h-96 mt-2' : 'max-h-0'
                        }`}
                      >
                        <p className="text-muted-foreground text-sm leading-relaxed">
                          {faq.answer}
                        </p>
                      </div>
                    </div>

                    <ChevronDown
                      className={`w-5 h-5 flex-shrink-0 transition-all duration-300 ${
                        isOpen ? 'rotate-180 text-primary' : 'text-muted-foreground'
                      }`}
                    />
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        <div className="mt-12 text-center p-8 bg-card rounded-2xl border shadow-sm">
          <h3 className="text-xl font-semibold mb-2">Still have questions?</h3>
          <p className="text-muted-foreground mb-6">
            Our team is here to help you find the perfect plan
          </p>
          <a
            href="mailto:sales@devcontrol.app"
            className="inline-flex items-center justify-center px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium hover:bg-primary/90 transition-colors"
          >
            Contact Sales
          </a>
        </div>
      </div>
    </div>
  );
}
