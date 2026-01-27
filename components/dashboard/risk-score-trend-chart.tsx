'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { TrendingUp, TrendingDown, Minus, Shield } from 'lucide-react';
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from 'recharts';
import { format, parseISO } from 'date-fns';
import type { RiskScoreTrendResponse, DateRange } from '@/lib/services/risk-score.service';

interface RiskScoreTrendChartProps {
  data: RiskScoreTrendResponse | null;
  isLoading?: boolean;
  dateRange?: DateRange;
  onDateRangeChange?: (range: DateRange) => void;
}

const gradeColors: Record<string, string> = {
  A: '#22c55e',
  B: '#84cc16',
  C: '#eab308',
  D: '#f97316',
  F: '#ef4444',
};

const gradeBackgrounds: Record<string, string> = {
  A: 'bg-green-100 text-green-800',
  B: 'bg-lime-100 text-lime-800',
  C: 'bg-yellow-100 text-yellow-800',
  D: 'bg-orange-100 text-orange-800',
  F: 'bg-red-100 text-red-800',
};

export function RiskScoreTrendChart({
  data,
  isLoading,
  dateRange = '30d',
  onDateRangeChange,
}: RiskScoreTrendChartProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <Skeleton className="h-6 w-48" />
              <Skeleton className="h-4 w-64 mt-2" />
            </div>
            <Skeleton className="h-9 w-32" />
          </div>
        </CardHeader>
        <CardContent>
          <Skeleton className="h-[280px] w-full" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            Risk Score Trend
          </CardTitle>
          <CardDescription>No risk score data available</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center h-[280px] text-muted-foreground">
            <Shield className="h-12 w-12 mb-4 opacity-50" />
            <p>Risk score data will appear once resources are scanned</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { current, trend, trendPercentage, history, period } = data;

  const formatDate = (dateStr: string) => {
    try {
      const date = parseISO(dateStr);
      if (dateRange === '7d') return format(date, 'EEE');
      return format(date, 'MMM d');
    } catch {
      return dateStr;
    }
  };

  const getTrendIcon = () => {
    if (trend === 'improving') return <TrendingUp className="h-4 w-4 text-green-600" />;
    if (trend === 'declining') return <TrendingDown className="h-4 w-4 text-red-600" />;
    return <Minus className="h-4 w-4 text-gray-500" />;
  };

  const getTrendBadge = () => {
    const variants = {
      improving: 'bg-green-100 text-green-800 border-green-200',
      stable: 'bg-gray-100 text-gray-800 border-gray-200',
      declining: 'bg-red-100 text-red-800 border-red-200',
    };
    const labels = {
      improving: 'Improving',
      stable: 'Stable',
      declining: 'Declining',
    };
    return (
      <Badge className={`${variants[trend]} border gap-1`}>
        {getTrendIcon()}
        {labels[trend]}
        {trendPercentage !== 0 && ` (${trendPercentage > 0 ? '+' : ''}${trendPercentage}%)`}
      </Badge>
    );
  };

  const CustomTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      const point = payload[0].payload;
      return (
        <div className="bg-white border border-gray-200 rounded-lg shadow-lg p-4">
          <p className="text-sm font-semibold text-gray-900 mb-2">{formatDate(label)}</p>
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">Score:</span>
              <span className="font-bold text-gray-900">{point.score}/100</span>
            </div>
            <div className="flex items-center justify-between gap-4">
              <span className="text-sm text-gray-600">Grade:</span>
              <Badge className={gradeBackgrounds[point.grade]}>{point.grade}</Badge>
            </div>
          </div>
          <div className="mt-3 pt-3 border-t border-gray-100 space-y-1.5">
            <p className="text-xs font-semibold text-gray-700 mb-1">Risk Factors:</p>
            <div className="grid grid-cols-2 gap-2 text-xs">
              <div className="flex justify-between">
                <span className="text-gray-500">Encryption:</span>
                <span className="font-medium">{point.factors?.encryption ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Public Access:</span>
                <span className="font-medium">{point.factors?.publicAccess ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Backup:</span>
                <span className="font-medium">{point.factors?.backup ?? 0}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-gray-500">Compliance:</span>
                <span className="font-medium">{point.factors?.compliance ?? 0}</span>
              </div>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  const dateRangeOptions: { value: DateRange; label: string }[] = [
    { value: '7d', label: '7 Days' },
    { value: '30d', label: '30 Days' },
    { value: '90d', label: '90 Days' },
  ];

  // Define grade threshold lines
  const gradeThresholds = [
    { value: 90, label: 'A', color: '#22c55e' },
    { value: 75, label: 'B', color: '#84cc16' },
    { value: 60, label: 'C', color: '#eab308' },
    { value: 40, label: 'D', color: '#f97316' },
  ];

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Shield className="h-5 w-5 text-blue-600" />
              Risk Score Trend
            </CardTitle>
            <CardDescription>
              Security posture over the last {period.days} days
            </CardDescription>
          </div>
          <div className="flex items-center gap-3">
            {/* Current Score */}
            <div className="flex items-center gap-2 px-3 py-1.5 bg-gray-50 rounded-lg border">
              <span className="text-sm text-gray-600">Current:</span>
              <span className="text-lg font-bold" style={{ color: gradeColors[current.grade] }}>
                {current.score}
              </span>
              <Badge className={gradeBackgrounds[current.grade]}>{current.grade}</Badge>
            </div>
            {/* Trend Badge */}
            {getTrendBadge()}
            {/* Date Range Selector */}
            {onDateRangeChange && (
              <div className="flex items-center gap-1 bg-gray-100 rounded-lg p-1">
                {dateRangeOptions.map((option) => (
                  <Button
                    key={option.value}
                    variant={dateRange === option.value ? 'default' : 'ghost'}
                    size="sm"
                    onClick={() => onDateRangeChange(option.value)}
                    className={`h-7 px-3 text-xs ${
                      dateRange === option.value
                        ? 'bg-white shadow-sm'
                        : 'hover:bg-white/50'
                    }`}
                  >
                    {option.label}
                  </Button>
                ))}
              </div>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent>
        {history.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-[280px] text-muted-foreground">
            <Shield className="h-12 w-12 mb-4 opacity-50" />
            <p>Not enough historical data yet</p>
            <p className="text-sm mt-1">Risk scores are captured daily</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={280}>
            <AreaChart data={history} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
              <defs>
                <linearGradient id="riskScoreGradient" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis
                dataKey="date"
                tickFormatter={formatDate}
                stroke="#9ca3af"
                style={{ fontSize: '12px' }}
              />
              <YAxis
                domain={[0, 100]}
                ticks={[0, 25, 50, 75, 100]}
                stroke="#9ca3af"
                style={{ fontSize: '12px' }}
              />
              <Tooltip content={<CustomTooltip />} />

              {/* Grade threshold reference lines */}
              {gradeThresholds.map((threshold) => (
                <ReferenceLine
                  key={threshold.label}
                  y={threshold.value}
                  stroke={threshold.color}
                  strokeDasharray="3 3"
                  strokeOpacity={0.5}
                />
              ))}

              <Area
                type="monotone"
                dataKey="score"
                stroke="#3b82f6"
                fill="url(#riskScoreGradient)"
                strokeWidth={2}
                dot={{ fill: '#3b82f6', strokeWidth: 2, r: 3 }}
                activeDot={{ r: 5, strokeWidth: 2 }}
              />
            </AreaChart>
          </ResponsiveContainer>
        )}

        {/* Frameworks at Risk */}
        {current.frameworksAtRisk && current.frameworksAtRisk.length > 0 && (
          <div className="mt-4 p-3 bg-orange-50 border border-orange-200 rounded-lg">
            <p className="text-sm text-orange-800">
              <span className="font-semibold">Compliance Frameworks at Risk:</span>{' '}
              {current.frameworksAtRisk.join(', ')}
            </p>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
