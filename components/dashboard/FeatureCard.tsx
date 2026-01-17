/**
 * FeatureCard Component
 * Compact feature card with icon, title, and description
 */

'use client';

import React from 'react';
import { ArrowRight, LucideIcon } from 'lucide-react';
import { Card } from '@/components/ui/card';

interface FeatureCardProps {
  icon: LucideIcon;
  title: string;
  description: string;
  preview?: React.ReactNode;
  keyPoints?: string[];
  color: 'green' | 'blue' | 'purple' | 'orange' | 'cyan' | 'pink';
  compact?: boolean;
}

const colorClasses = {
  green: {
    iconBg: 'bg-green-50',
    iconText: 'text-green-600',
    border: 'border-gray-200',
    hoverBorder: 'hover:border-green-400',
  },
  blue: {
    iconBg: 'bg-blue-50',
    iconText: 'text-blue-600',
    border: 'border-gray-200',
    hoverBorder: 'hover:border-blue-400',
  },
  purple: {
    iconBg: 'bg-purple-50',
    iconText: 'text-purple-600',
    border: 'border-gray-200',
    hoverBorder: 'hover:border-purple-400',
  },
  orange: {
    iconBg: 'bg-orange-50',
    iconText: 'text-orange-600',
    border: 'border-gray-200',
    hoverBorder: 'hover:border-orange-400',
  },
  cyan: {
    iconBg: 'bg-cyan-50',
    iconText: 'text-cyan-600',
    border: 'border-gray-200',
    hoverBorder: 'hover:border-cyan-400',
  },
  pink: {
    iconBg: 'bg-pink-50',
    iconText: 'text-pink-600',
    border: 'border-gray-200',
    hoverBorder: 'hover:border-pink-400',
  },
};

export function FeatureCard({
  icon: Icon,
  title,
  description,
  color,
  compact = true,
}: FeatureCardProps) {
  const colors = colorClasses[color];

  return (
    <Card
      className={`bg-white rounded-xl border ${colors.border} p-6 hover:shadow-lg transition-all duration-300 ${colors.hoverBorder}`}
    >
      {/* Icon */}
      <div className={`w-12 h-12 rounded-lg ${colors.iconBg} flex items-center justify-center mb-4`}>
        <Icon className={`w-6 h-6 ${colors.iconText}`} />
      </div>

      {/* Title */}
      <h3 className="text-lg font-semibold text-gray-900 mb-2">
        {title}
      </h3>

      {/* Description - compact with line clamp */}
      <p className="text-sm text-gray-600 leading-relaxed line-clamp-3">
        {description}
      </p>

      {/* Learn more link */}
      <button className="inline-flex items-center text-sm text-blue-600 hover:text-blue-700 mt-4 font-medium transition-colors">
        Learn more
        <ArrowRight className="w-4 h-4 ml-1" />
      </button>
    </Card>
  );
}
