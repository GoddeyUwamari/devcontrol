'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { TrendingUp, TrendingDown, Rocket, Clock, AlertCircle, Wrench, HelpCircle, ExternalLink } from 'lucide-react';
import { BarChart, Bar, ResponsiveContainer, Tooltip } from 'recharts';

export type PerformanceLevel = 'elite' | 'high' | 'medium' | 'low';

export interface DORAMetric {
  name: string;
  value: string;
  trend?: {
    value: number;
    direction: 'up' | 'down';
    label: string;
  };
  performanceLevel: PerformanceLevel;
  target?: string;
  chartData?: number[];
  description: string;
}

interface DORAMetricsMiniProps {
  metrics?: {
    deploymentFrequency: DORAMetric;
    leadTime: DORAMetric;
    changeFailureRate: DORAMetric;
    mttr: DORAMetric;
  };
  isLoading?: boolean;
  onLearnMore?: () => void;
  onViewDetails?: () => void;
}

const performanceLevelConfig: Record<PerformanceLevel, {
  label: string;
  color: string;
  bgColor: string;
  borderColor: string;
}> = {
  elite: {
    label: 'Elite',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-200',
  },
  high: {
    label: 'High',
    color: 'text-blue-700',
    bgColor: 'bg-blue-100',
    borderColor: 'border-blue-200',
  },
  medium: {
    label: 'Medium',
    color: 'text-yellow-700',
    bgColor: 'bg-yellow-100',
    borderColor: 'border-yellow-200',
  },
  low: {
    label: 'Low',
    color: 'text-red-700',
    bgColor: 'bg-red-100',
    borderColor: 'border-red-200',
  },
};

const metricIcons = {
  deploymentFrequency: Rocket,
  leadTime: Clock,
  changeFailureRate: AlertCircle,
  mttr: Wrench,
};

function DORAMetricCard({
  metric,
  icon: Icon,
  isLoading,
}: {
  metric: DORAMetric;
  icon: React.ElementType;
  isLoading?: boolean;
}) {
  const levelConfig = performanceLevelConfig[metric.performanceLevel];

  if (isLoading) {
    return (
      <Card className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm rounded-xl">
        <CardContent className="p-6 lg:p-8">
          <div className="space-y-3">
            <Skeleton className="h-8 w-8 rounded-lg" />
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-6 w-16" />
            <Skeleton className="h-16 w-full" />
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-xl transition-all duration-200 rounded-xl">
      <CardContent className="p-6 lg:p-8">
        {/* Icon */}
        <div className={`h-10 w-10 rounded-lg ${levelConfig.bgColor} flex items-center justify-center mb-3`}>
          <Icon className={`h-5 w-5 ${levelConfig.color}`} />
        </div>

        {/* Metric Name */}
        <div className="flex items-start justify-between mb-2">
          <h4 className="text-sm font-medium text-muted-foreground">{metric.name}</h4>
          <button
            className="text-gray-400 hover:text-gray-600 transition-colors"
            title={metric.description}
            aria-label={`More information about ${metric.name}`}
          >
            <HelpCircle className="h-4 w-4" />
          </button>
        </div>

        {/* Value */}
        <div className="mb-3">
          <p className="text-3xl lg:text-4xl font-bold">{metric.value}</p>
        </div>

        {/* Performance Level Badge */}
        <div className="mb-3">
          <Badge
            variant="secondary"
            className={`${levelConfig.bgColor} ${levelConfig.color} border ${levelConfig.borderColor} font-semibold`}
          >
            {levelConfig.label} Performance
          </Badge>
        </div>

        {/* Trend */}
        {metric.trend && (
          <div className="flex items-center gap-1 text-xs mb-3">
            {metric.trend.direction === 'up' ? (
              <TrendingUp className={`h-3 w-3 ${metric.trend.value > 0 ? 'text-green-600' : 'text-red-600'}`} />
            ) : (
              <TrendingDown className={`h-3 w-3 ${metric.trend.value > 0 ? 'text-green-600' : 'text-red-600'}`} />
            )}
            <span className={metric.trend.value > 0 ? 'text-green-600' : 'text-red-600'}>
              {metric.trend.label}
            </span>
          </div>
        )}

        {/* Target */}
        {metric.target && (
          <div className="text-xs text-muted-foreground mb-3">
            Target: <span className="font-medium">{metric.target}</span>
          </div>
        )}

        {/* Mini Chart */}
        {metric.chartData && metric.chartData.length > 0 && (
          <div className="h-16 w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={metric.chartData.map((value, index) => ({ value, index }))}>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      return (
                        <div className="bg-white border border-gray-200 rounded-lg shadow-lg px-2 py-1">
                          <p className="text-xs font-semibold">{payload[0].value}</p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
                <Bar
                  dataKey="value"
                  fill={levelConfig.bgColor.replace('bg-', '#')}
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DORAMetricsMini({
  metrics,
  isLoading,
  onLearnMore,
  onViewDetails,
}: DORAMetricsMiniProps) {
  const defaultMetrics = {
    deploymentFrequency: {
      name: 'Deployment Frequency',
      value: '12/week',
      trend: { value: 20, direction: 'up' as const, label: '+20% vs last month' },
      performanceLevel: 'elite' as PerformanceLevel,
      target: 'Multiple deploys/day for Elite',
      chartData: [8, 10, 12, 15, 14, 12, 16],
      description: 'How often code is deployed to production',
    },
    leadTime: {
      name: 'Lead Time for Changes',
      value: '2.4 hours',
      trend: { value: 15, direction: 'down' as const, label: '-15% (faster)' },
      performanceLevel: 'elite' as PerformanceLevel,
      target: '<24 hours for Elite',
      chartData: [3.2, 2.8, 2.5, 2.4, 2.6, 2.3, 2.4],
      description: 'Time from commit to production deployment',
    },
    changeFailureRate: {
      name: 'Change Failure Rate',
      value: '8.3%',
      trend: { value: 2, direction: 'down' as const, label: '-2% (improving)' },
      performanceLevel: 'high' as PerformanceLevel,
      target: '<15% for Elite',
      chartData: [10, 9, 8.5, 8.3, 9, 8, 8.3],
      description: 'Percentage of deployments that fail',
    },
    mttr: {
      name: 'Mean Time to Recovery',
      value: '36 minutes',
      trend: { value: 12, direction: 'down' as const, label: '-12 min (improving)' },
      performanceLevel: 'elite' as PerformanceLevel,
      target: '<1 hour for Elite',
      chartData: [45, 42, 38, 36, 40, 35, 36],
      description: 'Average time to recover from failures',
    },
  };

  const displayMetrics = metrics || defaultMetrics;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle>DevOps Performance (DORA Metrics)</CardTitle>
            <CardDescription>
              Measure your team's software delivery performance
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {onLearnMore && (
              <Button variant="outline" size="sm" onClick={onLearnMore}>
                <HelpCircle className="h-4 w-4 mr-2" />
                Learn more
              </Button>
            )}
            {onViewDetails && (
              <Button variant="outline" size="sm" onClick={onViewDetails}>
                View details
                <ExternalLink className="h-4 w-4 ml-2" />
              </Button>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="grid gap-6 lg:gap-8 md:grid-cols-2 lg:grid-cols-4">
          <DORAMetricCard
            metric={displayMetrics.deploymentFrequency}
            icon={metricIcons.deploymentFrequency}
            isLoading={isLoading}
          />
          <DORAMetricCard
            metric={displayMetrics.leadTime}
            icon={metricIcons.leadTime}
            isLoading={isLoading}
          />
          <DORAMetricCard
            metric={displayMetrics.changeFailureRate}
            icon={metricIcons.changeFailureRate}
            isLoading={isLoading}
          />
          <DORAMetricCard
            metric={displayMetrics.mttr}
            icon={metricIcons.mttr}
            isLoading={isLoading}
          />
        </div>

        {/* Overall Performance Summary */}
        {!isLoading && (
          <div className="mt-8 p-6 lg:p-8 bg-green-50 border border-green-200 rounded-xl">
            <div className="flex items-start gap-3">
              <div className="h-10 w-10 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                <Rocket className="h-5 w-5 text-green-600" />
              </div>
              <div>
                <h4 className="text-sm font-semibold text-green-900 mb-1">
                  Elite Performance Achieved
                </h4>
                <p className="text-sm text-green-700">
                  Your team is performing at the highest level across 3 of 4 DORA metrics.
                  Keep up the excellent work!
                </p>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
