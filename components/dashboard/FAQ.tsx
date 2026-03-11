/**
 * FAQ Component - Professional Enhancement
 * Two-column layout with icons and enhanced visual design
 */

'use client';

import React, { useState } from 'react';
import {
  ChevronDown,
  HelpCircle,
  Clock,
  Shield,
  CreditCard,
  Globe,
  DollarSign,
  Lock,
  Users,
  Zap,
  Download,
  Plug,
  MessageCircle,
} from 'lucide-react';
import { Button } from '@/components/ui/button';

interface FAQItem {
  icon: React.ElementType;
  question: string;
  answer: string;
  accentColor: string;
}

const faqs: FAQItem[] = [
  {
    icon: Clock,
    question: 'How long does setup take?',
    answer: 'Most teams are up and running in under 2 minutes. Simply connect your AWS account using our secure IAM role, and DevControl will automatically discover and catalog your infrastructure. No code changes required.',
    accentColor: 'blue',
  },
  {
    icon: Shield,
    question: 'Do you store our AWS credentials?',
    answer: 'No. DevControl uses AWS IAM roles with read-only permissions. We never store your AWS access keys or credentials. Your data stays in your AWS account, and we only read metadata for monitoring.',
    accentColor: 'green',
  },
  {
    icon: CreditCard,
    question: 'Can I cancel anytime?',
    answer: 'Yes, absolutely. There are no long-term contracts or cancellation fees. You can cancel your subscription at any time from your account settings, and you\'ll retain access until the end of your billing period.',
    accentColor: 'purple',
  },
  {
    icon: Globe,
    question: 'What AWS regions do you support?',
    answer: 'We support all major AWS regions including us-east-1, us-west-2, eu-west-1, ap-southeast-1, and more. Multi-region monitoring is available on all plans with automatic resource discovery.',
    accentColor: 'indigo',
  },
  {
    icon: DollarSign,
    question: 'How do you calculate cost savings?',
    answer: 'We analyze your AWS usage patterns, identify idle resources, right-sizing opportunities, and reserved instance recommendations. Our automated engine compares your current spend against optimized configurations.',
    accentColor: 'emerald',
  },
  {
    icon: Lock,
    question: 'Is my data secure?',
    answer: 'Yes. We use enterprise-grade encryption (AES-256) and follow AWS security best practices. Your infrastructure data is encrypted at rest and in transit with TLS 1.3. We are GDPR compliant and working toward SOC 2 Type II certification.',
    accentColor: 'red',
  },
  {
    icon: Users,
    question: 'Do you offer team collaboration features?',
    answer: 'Yes! All plans include role-based access control, shared dashboards, team activity feeds, and collaborative workflows. Enterprise plans add SSO and advanced permissions.',
    accentColor: 'orange',
  },
  {
    icon: Zap,
    question: 'Do you offer a free trial?',
    answer: 'Yes! We offer a 14-day free trial with full access to all features. No credit card required to start. You can explore the platform, connect your AWS account, and see real cost optimization opportunities.',
    accentColor: 'yellow',
  },
  {
    icon: Download,
    question: 'Can I export data and reports?',
    answer: 'Yes. You can export cost reports, resource inventories, and compliance data in CSV, JSON, or PDF formats. API access is available for custom integrations and automated reporting.',
    accentColor: 'teal',
  },
  {
    icon: Plug,
    question: 'Does it integrate with Slack/PagerDuty?',
    answer: 'Yes! DevControl integrates with Slack, PagerDuty, Microsoft Teams, Jira, and more. Get real-time alerts, deployment notifications, and cost anomalies sent directly to your team\'s tools.',
    accentColor: 'pink',
  },
];

// Accent color mapping
const accentColors = {
  blue: {
    bg: 'bg-blue-50',
    text: 'text-blue-600',
    border: 'border-blue-500',
    hoverBorder: 'hover:border-blue-300',
  },
  green: {
    bg: 'bg-green-50',
    text: 'text-green-600',
    border: 'border-green-500',
    hoverBorder: 'hover:border-green-300',
  },
  purple: {
    bg: 'bg-purple-50',
    text: 'text-purple-600',
    border: 'border-purple-500',
    hoverBorder: 'hover:border-purple-300',
  },
  indigo: {
    bg: 'bg-indigo-50',
    text: 'text-indigo-600',
    border: 'border-indigo-500',
    hoverBorder: 'hover:border-indigo-300',
  },
  emerald: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-600',
    border: 'border-emerald-500',
    hoverBorder: 'hover:border-emerald-300',
  },
  red: {
    bg: 'bg-red-50',
    text: 'text-red-600',
    border: 'border-red-500',
    hoverBorder: 'hover:border-red-300',
  },
  orange: {
    bg: 'bg-orange-50',
    text: 'text-orange-600',
    border: 'border-orange-500',
    hoverBorder: 'hover:border-orange-300',
  },
  yellow: {
    bg: 'bg-yellow-50',
    text: 'text-yellow-600',
    border: 'border-yellow-500',
    hoverBorder: 'hover:border-yellow-300',
  },
  teal: {
    bg: 'bg-teal-50',
    text: 'text-teal-600',
    border: 'border-teal-500',
    hoverBorder: 'hover:border-teal-300',
  },
  pink: {
    bg: 'bg-pink-50',
    text: 'text-pink-600',
    border: 'border-pink-500',
    hoverBorder: 'hover:border-pink-300',
  },
};

export function FAQ() {
  const [openIndex, setOpenIndex] = useState<number | null>(null);

  const toggleFAQ = (index: number) => {
    setOpenIndex(openIndex === index ? null : index);
  };

  return (
    <section className="py-20 bg-gradient-to-b from-white to-gray-50">
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Enhanced Header */}
        <div className="text-center mb-12">
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-full mb-4">
            <MessageCircle className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-600">FAQ</span>
          </div>
          <h2 className="text-4xl font-bold text-gray-900 mb-4">
            Frequently Asked Questions
          </h2>
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Everything you need to know about DevControl.{' '}
            <button className="text-[#7c3aed] hover:text-[#4f46e5] font-medium hover:underline">
              Contact us →
            </button>
          </p>
        </div>

        {/* Two-Column FAQ Grid */}
        <div className="grid md:grid-cols-2 gap-4 mb-12">
          {faqs.map((faq, index) => {
            const Icon = faq.icon;
            const colors = accentColors[faq.accentColor as keyof typeof accentColors];
            const isOpen = openIndex === index;

            return (
              <div
                key={index}
                className="group animate-in fade-in slide-in-from-bottom-2"
                style={{ animationDelay: `${index * 50}ms`, animationDuration: '400ms' }}
              >
                <button
                  onClick={() => toggleFAQ(index)}
                  className={`w-full text-left p-4 bg-white rounded-xl border-2 transition-all duration-300 ${
                    isOpen
                      ? `${colors.border} shadow-lg`
                      : `border-gray-200 ${colors.hoverBorder} hover:shadow-md`
                  }`}
                >
                  <div className="flex items-start gap-4">
                    {/* Icon */}
                    <div
                      className={`w-10 h-10 rounded-lg ${colors.bg} flex items-center justify-center flex-shrink-0 transition-transform group-hover:scale-110`}
                    >
                      <Icon className={`w-5 h-5 ${colors.text}`} />
                    </div>

                    {/* Question */}
                    <div className="flex-1 min-w-0">
                      <h3
                        className={`font-semibold text-gray-900 transition-colors ${
                          isOpen ? colors.text : 'group-hover:text-[#7c3aed]'
                        }`}
                      >
                        {faq.question}
                      </h3>

                      {/* Answer */}
                      <div
                        className={`overflow-hidden transition-all duration-300 ${
                          isOpen ? 'max-h-96 mt-3' : 'max-h-0'
                        }`}
                      >
                        <p className="text-gray-600 text-sm leading-relaxed">{faq.answer}</p>
                      </div>
                    </div>

                    {/* Chevron */}
                    <ChevronDown
                      className={`w-5 h-5 flex-shrink-0 transition-all duration-300 ${
                        isOpen ? `rotate-180 ${colors.text}` : 'text-gray-400'
                      }`}
                    />
                  </div>
                </button>
              </div>
            );
          })}
        </div>

        {/* Bottom CTA Section */}
        <div className="text-center p-8 bg-white rounded-2xl border-2 border-gray-200 shadow-sm">
          <div className="inline-flex items-center justify-center w-12 h-12 rounded-full bg-[#7c3aed]/10 mb-4">
            <HelpCircle className="h-6 w-6 text-[#7c3aed]" />
          </div>
          <h3 className="text-xl font-semibold text-gray-900 mb-2">Still have questions?</h3>
          <p className="text-gray-600 mb-6">
            Our team is here to help you get started
          </p>
          <div className="flex flex-col sm:flex-row gap-3 justify-center">
            <Button
              size="lg"
              className="bg-[#7c3aed] hover:bg-[#4f46e5] text-white"
            >
              Contact Support
            </Button>
            <Button size="lg" variant="outline" className="border-gray-300 hover:border-[#7c3aed]">
              Schedule Demo
            </Button>
          </div>
        </div>
      </div>
    </section>
  );
}
