/**
 * ValuePropCards Component
 * Display key value propositions with metrics
 */

'use client';

import React from 'react';
import {
  DollarSign,
  Shield,
  Activity,
  TrendingUp,
  Search,
  Users,
  ArrowRight,
  Sparkles
} from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';

interface ValueCard {
  icon: React.ReactNode;
  title: string;
  description: string;
  features: string[];
  metric: string;
  bgColor: string;
  borderColor: string;
}

const valueCards: ValueCard[] = [
  {
    icon: <DollarSign className="h-10 w-10" />,
    title: 'Cost Optimization',
    description: 'Identify waste, rightsize resources, and reduce spending automatically with smart recommendations',
    features: ['Unused resource detection', 'Rightsizing recommendations', 'Cost anomaly alerts'],
    metric: 'Avg savings: $18K/year',
    bgColor: 'bg-green-100 text-green-700',
    borderColor: 'border-green-200',
  },
  {
    icon: <Shield className="h-10 w-10" />,
    title: 'Security Scanning',
    description: 'Continuous security posture monitoring with automated compliance checks and vulnerability detection',
    features: ['Compliance tracking', 'Vulnerability scanning', 'Access control audits'],
    metric: '100,000+ resources scanned',
    bgColor: 'bg-blue-100 text-blue-700',
    borderColor: 'border-blue-200',
  },
  {
    icon: <Search className="h-10 w-10" />,
    title: 'Resource Discovery',
    description: 'Automatically discover and catalog all your AWS resources across regions and accounts',
    features: ['Multi-region support', 'Auto-tagging', 'Resource relationships'],
    metric: '500+ resource types',
    bgColor: 'bg-purple-100 text-purple-700',
    borderColor: 'border-purple-200',
  },
  {
    icon: <Activity className="h-10 w-10" />,
    title: 'Compliance Tracking',
    description: 'Monitor compliance with industry standards and internal policies with automated reporting',
    features: ['SOC 2 compliance', 'GDPR tracking', 'Custom policies'],
    metric: '99.9% compliance rate',
    bgColor: 'bg-orange-100 text-orange-700',
    borderColor: 'border-orange-200',
  },
  {
    icon: <Users className="h-10 w-10" />,
    title: 'Team Collaboration',
    description: 'Centralized dashboard for your entire engineering team with role-based access and permissions',
    features: ['Role-based access', 'Team workspaces', 'Activity logging'],
    metric: 'Role-based access',
    bgColor: 'bg-indigo-100 text-indigo-700',
    borderColor: 'border-indigo-200',
  },
  {
    icon: <TrendingUp className="h-10 w-10" />,
    title: 'Custom Dashboards',
    description: 'Create personalized views with widgets for metrics that matter most to your team',
    features: ['Drag-and-drop builder', 'Custom widgets', 'Export & sharing'],
    metric: 'Unlimited dashboards',
    bgColor: 'bg-pink-100 text-pink-700',
    borderColor: 'border-pink-200',
  },
];

export function ValuePropCards() {
  return (
    <div className="py-8">
      {/* Section Header */}
      <div className="mb-12 text-center">
        <Badge className="mb-4 bg-[#7c3aed]/10 text-[#7c3aed] border-[#7c3aed]/20 hover:bg-[#7c3aed]/20">
          <Sparkles className="h-3 w-3 mr-1" />
          Key Features
        </Badge>
        <h2 className="mb-4 text-3xl font-bold text-gray-900 md:text-4xl">
          Built for Modern Platform Teams
        </h2>
        <p className="text-lg text-gray-600 max-w-3xl mx-auto">
          Everything you need to manage, optimize, and secure your AWS infrastructure
        </p>
      </div>

      {/* Feature Grid - 3x2 layout */}
      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        {valueCards.map((card, index) => (
          <Card
            key={index}
            className={`group border-2 ${card.borderColor} transition-all duration-300 hover:shadow-2xl hover:-translate-y-2 hover:border-[#7c3aed] animate-in fade-in slide-in-from-bottom-4`}
            style={{ animationDelay: `${index * 100}ms`, animationDuration: '600ms' }}
          >
            <CardContent className="p-6">
              {/* Icon */}
              <div className={`mb-5 inline-flex rounded-xl p-4 transition-all duration-300 group-hover:scale-110 group-hover:rotate-3 ${card.bgColor}`}>
                {card.icon}
              </div>

              {/* Title */}
              <h3 className="mb-3 text-xl font-bold text-gray-900">
                {card.title}
              </h3>

              {/* Description */}
              <p className="mb-4 text-sm leading-relaxed text-gray-600">
                {card.description}
              </p>

              {/* Features list */}
              <ul className="mb-4 space-y-2">
                {card.features.map((feature, i) => (
                  <li key={i} className="flex items-start gap-2 text-xs text-gray-600">
                    <ArrowRight className="h-3 w-3 mt-0.5 text-[#7c3aed] flex-shrink-0" />
                    <span>{feature}</span>
                  </li>
                ))}
              </ul>

              {/* Metric */}
              <div className="pt-4 border-t border-gray-100">
                <p className="text-sm font-semibold text-[#7c3aed]">
                  {card.metric}
                </p>
              </div>

              {/* Learn more link */}
              <button className="mt-4 text-sm font-medium text-[#7c3aed] hover:text-[#4f46e5] flex items-center gap-1 group-hover:gap-2 transition-all">
                Learn more
                <ArrowRight className="h-4 w-4" />
              </button>
            </CardContent>
          </Card>
        ))}
      </div>
    </div>
  );
}
