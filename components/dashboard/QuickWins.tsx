/**
 * QuickWins Component
 * Shows immediate benefits and quick wins
 */

'use client';

import React from 'react';
import { TrendingDown, Clock, Zap, Shield, DollarSign, Gauge } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';

interface QuickWin {
  icon: React.ReactNode;
  number: string;
  title: string;
  description: string;
  color: string;
  bgColor: string;
}

const quickWins: QuickWin[] = [
  {
    icon: <TrendingDown className="h-8 w-8" />,
    number: '15%',
    title: 'Avg Cost Reduction',
    description: 'Teams save an average of $18K annually by identifying unused resources and rightsizing instances',
    color: 'text-green-600',
    bgColor: 'bg-green-50',
  },
  {
    icon: <Clock className="h-8 w-8" />,
    number: '2 hrs',
    title: 'Setup Time',
    description: 'From signup to full visibility in under 2 hours with our guided onboarding and AWS integration',
    color: 'text-blue-600',
    bgColor: 'bg-blue-50',
  },
  {
    icon: <Zap className="h-8 w-8" />,
    number: 'Zero',
    title: 'Infrastructure Changes',
    description: 'Read-only access means no modifications to your existing AWS setup or application code',
    color: 'text-purple-600',
    bgColor: 'bg-purple-50',
  },
];

export function QuickWins() {
  return (
    <div className="py-8">
      {/* Section Header */}
      <div className="mb-10 text-center">
        <h2 className="mb-3 text-3xl font-bold text-gray-900 md:text-4xl">
          Immediate Impact, Minimal Effort
        </h2>
        <p className="text-lg text-gray-600 max-w-2xl mx-auto">
          See the benefits from day one without disrupting your existing workflows
        </p>
      </div>

      {/* Quick Win Cards */}
      <div className="grid gap-6 md:grid-cols-3">
        {quickWins.map((win, index) => (
          <Card
            key={index}
            className="group border-2 border-gray-200 transition-all duration-300 hover:shadow-2xl hover:-translate-y-2 hover:border-[#7c3aed]/50 animate-in fade-in slide-in-from-bottom-4"
            style={{ animationDelay: `${index * 150}ms`, animationDuration: '600ms' }}
          >
            <CardContent className="p-6">
              {/* Icon with colored background */}
              <div className={`mb-5 inline-flex rounded-xl p-4 ${win.bgColor} ${win.color} transition-transform duration-300 group-hover:scale-110 group-hover:rotate-3`}>
                {win.icon}
              </div>

              {/* Number/Metric */}
              <div className={`mb-2 text-4xl font-bold ${win.color}`}>
                {win.number}
              </div>

              {/* Title */}
              <h3 className="mb-3 text-xl font-bold text-gray-900">
                {win.title}
              </h3>

              {/* Description */}
              <p className="text-sm leading-relaxed text-gray-600">
                {win.description}
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Bottom trust line */}
      <div className="mt-8 text-center">
        <p className="text-sm text-gray-500 flex items-center justify-center gap-2 flex-wrap">
          <span className="flex items-center gap-1">
            <DollarSign className="h-4 w-4 text-green-600" />
            <span className="font-medium">ROI positive in first month</span>
          </span>
          <span className="text-gray-400">•</span>
          <span className="flex items-center gap-1">
            <Shield className="h-4 w-4 text-blue-600" />
            <span className="font-medium">Enterprise-grade security</span>
          </span>
          <span className="text-gray-400">•</span>
          <span className="flex items-center gap-1">
            <Gauge className="h-4 w-4 text-purple-600" />
            <span className="font-medium">Real-time monitoring</span>
          </span>
        </p>
      </div>
    </div>
  );
}
