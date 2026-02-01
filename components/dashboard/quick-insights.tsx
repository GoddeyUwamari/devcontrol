'use client';

import { useState } from 'react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { X, ChevronRight, Lightbulb, AlertTriangle, Target, CheckCircle2, TrendingDown, Shield } from 'lucide-react';

export type InsightType = 'info' | 'warning' | 'critical' | 'success';

export interface Insight {
  id: string;
  type: InsightType;
  title: string;
  description: string;
  cta?: {
    label: string;
    action: () => void;
  };
  dismissible?: boolean;
  priority?: number;
}

interface QuickInsightsProps {
  insights: Insight[];
  onDismiss?: (id: string) => void;
}

const insightConfig: Record<InsightType, {
  icon: React.ElementType;
  borderColor: string;
  bgColor: string;
  iconBgColor: string;
  iconColor: string;
  badgeColor: string;
}> = {
  info: {
    icon: Lightbulb,
    borderColor: 'border-l-blue-500',
    bgColor: 'bg-white dark:bg-gray-900',
    iconBgColor: 'bg-blue-100 dark:bg-blue-900/20',
    iconColor: 'text-blue-600 dark:text-blue-400',
    badgeColor: 'bg-blue-100 text-blue-700',
  },
  warning: {
    icon: AlertTriangle,
    borderColor: 'border-l-yellow-500',
    bgColor: 'bg-white dark:bg-gray-900',
    iconBgColor: 'bg-yellow-100 dark:bg-yellow-900/20',
    iconColor: 'text-yellow-600 dark:text-yellow-400',
    badgeColor: 'bg-yellow-100 text-yellow-700',
  },
  critical: {
    icon: AlertTriangle,
    borderColor: 'border-l-red-500',
    bgColor: 'bg-white dark:bg-gray-900',
    iconBgColor: 'bg-red-100 dark:bg-red-900/20',
    iconColor: 'text-red-600 dark:text-red-400',
    badgeColor: 'bg-red-100 text-red-700',
  },
  success: {
    icon: CheckCircle2,
    borderColor: 'border-l-green-500',
    bgColor: 'bg-white dark:bg-gray-900',
    iconBgColor: 'bg-green-100 dark:bg-green-900/20',
    iconColor: 'text-green-600 dark:text-green-400',
    badgeColor: 'bg-green-100 text-green-700',
  },
};

function InsightCard({ insight, onDismiss }: { insight: Insight; onDismiss?: (id: string) => void }) {
  const [isVisible, setIsVisible] = useState(true);
  const config = insightConfig[insight.type];
  const Icon = config.icon;

  const handleDismiss = () => {
    setIsVisible(false);
    setTimeout(() => {
      onDismiss?.(insight.id);
    }, 300);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <Card className={`${config.bgColor} ${config.borderColor} border-l-4 hover:shadow-lg transition-all duration-200 animate-in fade-in slide-in-from-left-2`}>
      <div className="p-4">
        <div className="flex items-start gap-3">
          {/* Icon */}
          <div className="flex-shrink-0">
            <div className={`h-10 w-10 rounded-lg ${config.iconBgColor} flex items-center justify-center`}>
              <Icon className={`h-5 w-5 ${config.iconColor}`} />
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            <div className="flex items-start justify-between gap-2 mb-2">
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{insight.title}</h4>
              {insight.dismissible && (
                <button
                  onClick={handleDismiss}
                  className="flex-shrink-0 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                  aria-label="Dismiss insight"
                >
                  <X className="h-4 w-4" />
                </button>
              )}
            </div>
            <p className="text-sm text-gray-700 dark:text-gray-300 mb-3">{insight.description}</p>

            {/* CTA Button */}
            {insight.cta && (
              <Button
                variant="outline"
                size="sm"
                onClick={insight.cta.action}
                className={`${config.iconColor} border-current hover:bg-white`}
              >
                {insight.cta.label}
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </Card>
  );
}

export function QuickInsights({ insights, onDismiss }: QuickInsightsProps) {
  // Sort insights by priority (higher first) and type (critical > warning > info > success)
  const sortedInsights = [...insights].sort((a, b) => {
    const priorityDiff = (b.priority || 0) - (a.priority || 0);
    if (priorityDiff !== 0) return priorityDiff;

    const typeOrder = { critical: 3, warning: 2, info: 1, success: 0 };
    return typeOrder[b.type] - typeOrder[a.type];
  });

  if (sortedInsights.length === 0) {
    return null;
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h3 className="text-lg font-semibold text-gray-900">Quick Insights</h3>
        <Badge variant="secondary" className="bg-gray-100 text-gray-700">
          {sortedInsights.length} {sortedInsights.length === 1 ? 'insight' : 'insights'}
        </Badge>
      </div>
      <div className="grid gap-6 lg:gap-8 md:grid-cols-2 lg:grid-cols-3">
        {sortedInsights.map((insight) => (
          <InsightCard
            key={insight.id}
            insight={insight}
            onDismiss={onDismiss}
          />
        ))}
      </div>
    </div>
  );
}

// Example usage and demo insights generator
export function generateDemoInsights(): Insight[] {
  return [
    {
      id: '1',
      type: 'info',
      title: 'Potential Savings: $342/mo',
      description: '3 underutilized EC2 instances detected running at <20% CPU usage',
      cta: {
        label: 'View recommendations',
        action: () => console.log('View recommendations'),
      },
      dismissible: true,
      priority: 5,
    },
    {
      id: '2',
      type: 'warning',
      title: 'Security Alert',
      description: '2 S3 buckets are publicly accessible. Review permissions to prevent data exposure.',
      cta: {
        label: 'Review now',
        action: () => console.log('Review security'),
      },
      dismissible: true,
      priority: 8,
    },
    {
      id: '3',
      type: 'info',
      title: 'Cost Optimization',
      description: 'Switch 5 RDS instances to reserved pricing to save $890/mo (32% reduction)',
      cta: {
        label: 'See details',
        action: () => console.log('See cost details'),
      },
      dismissible: true,
      priority: 6,
    },
    {
      id: '4',
      type: 'success',
      title: 'Great Job!',
      description: 'All resources are properly tagged. Maintaining 100% compliance.',
      dismissible: true,
      priority: 2,
    },
    {
      id: '5',
      type: 'critical',
      title: 'Budget Alert',
      description: 'AWS spending is 15% above monthly budget. Current: $1,247 vs Budget: $1,000',
      cta: {
        label: 'Review costs',
        action: () => console.log('Review costs'),
      },
      dismissible: false,
      priority: 10,
    },
  ];
}
