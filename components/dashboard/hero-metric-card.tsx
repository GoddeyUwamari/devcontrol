'use client';

import { Card, CardContent } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { TrendingUp, TrendingDown, LucideIcon } from 'lucide-react';
import { LineChart, Line, ResponsiveContainer } from 'recharts';
import { useRouter } from 'next/navigation';

interface HeroMetricCardProps {
  title: string;
  value: string | number;
  trend?: {
    value: number;
    direction: 'up' | 'down' | 'neutral';
    label?: string;
  };
  icon: LucideIcon;
  loading?: boolean;
  iconColor?: string;
  iconBgColor?: string;
  status?: {
    label: string;
    variant: 'success' | 'warning' | 'error' | 'info';
  };
  sparklineData?: number[];
  onClick?: () => void;
  href?: string;
  trendInverted?: boolean; // When true, down is good (green) and up is bad (red) - for costs
}

export function HeroMetricCard({
  title,
  value,
  trend,
  icon: Icon,
  loading,
  iconColor = 'text-[#635BFF]',
  iconBgColor = 'bg-[#635BFF]/10',
  status,
  sparklineData,
  onClick,
  href,
  trendInverted = false,
}: HeroMetricCardProps) {
  const router = useRouter();

  const handleClick = () => {
    if (onClick) {
      onClick();
    } else if (href) {
      router.push(href);
    }
  };

  const isClickable = Boolean(onClick || href);

  if (loading) {
    return (
      <Card className="border border-gray-200 dark:border-gray-800">
        <CardContent className="p-6 lg:p-8">
          <div className="flex items-center justify-between mb-2">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-10 w-10 rounded-lg" />
          </div>
          <Skeleton className="h-9 w-28 mb-3" />
          <Skeleton className="h-4 w-24" />
          {sparklineData && <Skeleton className="h-12 w-full mt-4" />}
        </CardContent>
      </Card>
    );
  }

  // Determine trend color based on whether it's inverted
  const getTrendColor = () => {
    if (!trend || trend.direction === 'neutral') return 'text-gray-500';

    if (trendInverted) {
      // For costs: down is good (green), up is bad (red)
      return trend.direction === 'down' ? 'text-green-600' : 'text-red-600';
    } else {
      // For normal metrics: up is good (green), down is bad (red)
      return trend.direction === 'up' ? 'text-green-600' : 'text-red-600';
    }
  };

  const statusColors = {
    success: 'bg-green-100 text-green-700 border-green-200',
    warning: 'bg-yellow-100 text-yellow-700 border-yellow-200',
    error: 'bg-red-100 text-red-700 border-red-200',
    info: 'bg-blue-100 text-blue-700 border-blue-200',
  };

  return (
    <Card
      className={`bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 shadow-sm hover:shadow-xl transition-all duration-200 rounded-xl ${
        isClickable ? 'cursor-pointer hover:-translate-y-1' : ''
      }`}
      onClick={isClickable ? handleClick : undefined}
    >
      <CardContent className="p-6 lg:p-8">
        {/* Header Row */}
        <div className="flex items-start justify-between mb-3">
          <div className="flex-1">
            <p className="text-sm font-medium text-muted-foreground">{title}</p>
          </div>
          <div className={`h-10 w-10 rounded-lg ${iconBgColor} flex items-center justify-center flex-shrink-0`}>
            <Icon className={`h-5 w-5 ${iconColor}`} />
          </div>
        </div>

        {/* Value */}
        <div className="mb-3">
          <p className="text-3xl font-bold tracking-tight">{value}</p>
        </div>

        {/* Trend Indicator */}
        {trend && (
          <div className={`flex items-center text-sm ${getTrendColor()}`}>
            {trend.direction === 'up' ? (
              <TrendingUp className="h-4 w-4 mr-1" />
            ) : trend.direction === 'down' ? (
              <TrendingDown className="h-4 w-4 mr-1" />
            ) : null}
            <span className="font-medium">
              {trend.direction !== 'neutral' && (trend.direction === 'up' ? '+' : '-')}
              {trend.value}%
            </span>
            {trend.label && (
              <span className="text-muted-foreground ml-1">{trend.label}</span>
            )}
          </div>
        )}

        {/* Status Badge */}
        {status && (
          <div className="mt-3">
            <div className={`inline-flex items-center px-2.5 py-1 rounded-md text-xs font-medium border ${statusColors[status.variant]}`}>
              {status.label}
            </div>
          </div>
        )}

        {/* Sparkline Chart */}
        {sparklineData && sparklineData.length > 0 && (
          <div className="mt-4 h-12 w-full opacity-70 hover:opacity-100 transition-opacity">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={sparklineData.map((value, index) => ({ value, index }))}>
                <Line
                  type="monotone"
                  dataKey="value"
                  stroke={
                    iconColor === 'text-blue-600'
                      ? '#2563eb'
                      : iconColor === 'text-green-600'
                      ? '#16a34a'
                      : iconColor === 'text-purple-600'
                      ? '#9333ea'
                      : iconColor === 'text-orange-600'
                      ? '#ea580c'
                      : '#635BFF'
                  }
                  strokeWidth={2}
                  dot={false}
                />
              </LineChart>
            </ResponsiveContainer>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
