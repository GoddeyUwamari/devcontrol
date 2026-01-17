/**
 * PlatformPreview Component
 * Feature-focused showcase with compact cards
 */

'use client';

import React from 'react';
import { DollarSign, Rocket, Shield, TrendingUp, Search, Users, Sparkles } from 'lucide-react';
import { FeatureCard } from './FeatureCard';

export function PlatformPreview() {
  const features = [
    {
      icon: DollarSign,
      title: 'Cost Optimization',
      description: 'Monitor AWS spending in real-time with actionable insights. Identify savings opportunities and reduce costs by 15-30%.',
      color: 'green' as const,
    },
    {
      icon: Rocket,
      title: 'Deployment Tracking',
      description: 'Track all deployments across your infrastructure with detailed history, rollback capabilities, and deployment frequency metrics.',
      color: 'blue' as const,
    },
    {
      icon: Shield,
      title: 'Security & Compliance',
      description: 'Automated security scanning and compliance monitoring. Stay compliant with SOC 2, HIPAA, and PCI standards effortlessly.',
      color: 'purple' as const,
    },
    {
      icon: TrendingUp,
      title: 'Performance Insights',
      description: 'Real-time performance monitoring with DORA metrics. Measure deployment frequency, lead time, and change failure rate.',
      color: 'orange' as const,
    },
    {
      icon: Search,
      title: 'Resource Discovery',
      description: 'Automatically discover and catalog all AWS resources across regions. Get complete visibility into your infrastructure.',
      color: 'cyan' as const,
    },
    {
      icon: Users,
      title: 'Team Collaboration',
      description: 'Role-based access control, shared dashboards, and team activity feeds. Collaborate seamlessly across your organization.',
      color: 'pink' as const,
    },
  ];

  return (
    <section className="py-16 bg-white">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">

        {/* Section Header */}
        <div className="text-center mb-12">
          {/* Badge */}
          <div className="inline-flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-full mb-6">
            <Sparkles className="w-4 h-4 text-blue-600" />
            <span className="text-sm font-medium text-blue-600">Platform Overview</span>
          </div>

          {/* Title */}
          <h2 className="text-3xl font-bold text-gray-900 mb-4">
            Everything You Need in One Platform
          </h2>

          {/* Description - Shorter */}
          <p className="text-lg text-gray-600 max-w-3xl mx-auto">
            Complete AWS infrastructure management with real-time insights,
            cost optimization, and security monitoring.
          </p>
        </div>

        {/* Feature Grid - 3 columns */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {features.map((feature, index) => (
            <FeatureCard
              key={index}
              icon={feature.icon}
              title={feature.title}
              description={feature.description}
              color={feature.color}
            />
          ))}
        </div>
      </div>
    </section>
  );
}
