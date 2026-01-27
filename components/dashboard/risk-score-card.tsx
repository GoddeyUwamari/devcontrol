'use client';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Shield, TrendingUp, TrendingDown, Minus, Lock, Globe, Database, FileCheck, Server } from 'lucide-react';
import type { RiskScoreTrendResponse } from '@/lib/services/risk-score.service';
import Link from 'next/link';

interface RiskScoreCardProps {
  data: RiskScoreTrendResponse | null;
  isLoading?: boolean;
  compact?: boolean;
}

const gradeColors: Record<string, string> = {
  A: '#22c55e',
  B: '#84cc16',
  C: '#eab308',
  D: '#f97316',
  F: '#ef4444',
};

const gradeBackgrounds: Record<string, string> = {
  A: 'bg-green-100 text-green-800 border-green-200',
  B: 'bg-lime-100 text-lime-800 border-lime-200',
  C: 'bg-yellow-100 text-yellow-800 border-yellow-200',
  D: 'bg-orange-100 text-orange-800 border-orange-200',
  F: 'bg-red-100 text-red-800 border-red-200',
};

const gradeDescriptions: Record<string, string> = {
  A: 'Excellent security posture',
  B: 'Good security posture',
  C: 'Moderate security posture',
  D: 'Poor security posture',
  F: 'Critical security issues',
};

export function RiskScoreCard({ data, isLoading, compact = false }: RiskScoreCardProps) {
  if (isLoading) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <Skeleton className="h-5 w-32" />
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4">
            <Skeleton className="h-16 w-16 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-8 w-20" />
              <Skeleton className="h-4 w-32" />
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card>
        <CardHeader className="pb-2">
          <CardTitle className="text-base flex items-center gap-2">
            <Shield className="h-4 w-4 text-blue-600" />
            Security Score
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col items-center justify-center py-4 text-muted-foreground">
            <Shield className="h-8 w-8 mb-2 opacity-50" />
            <p className="text-sm">No data available</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const { current, trend, trendPercentage } = data;

  const getTrendIcon = () => {
    if (trend === 'improving') return <TrendingUp className="h-3 w-3" />;
    if (trend === 'declining') return <TrendingDown className="h-3 w-3" />;
    return <Minus className="h-3 w-3" />;
  };

  const getTrendColor = () => {
    if (trend === 'improving') return 'text-green-600';
    if (trend === 'declining') return 'text-red-600';
    return 'text-gray-500';
  };

  const factors = [
    { key: 'encryption', label: 'Encryption', icon: Lock, value: current.factors.encryption },
    { key: 'publicAccess', label: 'Access Control', icon: Globe, value: current.factors.publicAccess },
    { key: 'backup', label: 'Backup', icon: Database, value: current.factors.backup },
    { key: 'compliance', label: 'Compliance', icon: FileCheck, value: current.factors.compliance },
    { key: 'resourceManagement', label: 'Resources', icon: Server, value: current.factors.resourceManagement },
  ];

  const getFactorColor = (value: number) => {
    if (value >= 90) return 'bg-green-500';
    if (value >= 75) return 'bg-lime-500';
    if (value >= 60) return 'bg-yellow-500';
    if (value >= 40) return 'bg-orange-500';
    return 'bg-red-500';
  };

  if (compact) {
    return (
      <Link href="/compliance">
        <Card className="hover:shadow-md transition-all cursor-pointer group">
          <CardContent className="pt-6">
            <div className="flex items-center justify-between mb-2">
              <p className="text-sm font-medium text-muted-foreground">Security Score</p>
              <div className="h-8 w-8 rounded-md bg-teal-100 flex items-center justify-center">
                <Shield className="h-4 w-4 text-teal-600" />
              </div>
            </div>
            <div className="space-y-1">
              <div className="flex items-baseline gap-2">
                <p className="text-2xl font-bold" style={{ color: gradeColors[current.grade] }}>
                  {current.score}/100
                </p>
                <Badge className={`${gradeBackgrounds[current.grade]} border text-xs`}>
                  {current.grade}
                </Badge>
              </div>
              <div className={`flex items-center text-xs ${getTrendColor()}`}>
                {getTrendIcon()}
                <span className="ml-1">
                  {trend === 'stable' ? 'Stable' : `${trendPercentage > 0 ? '+' : ''}${trendPercentage}%`}
                </span>
                <span className="text-muted-foreground ml-1">vs last period</span>
              </div>
            </div>
          </CardContent>
        </Card>
      </Link>
    );
  }

  return (
    <Card className="transition-shadow hover:shadow-md">
      <CardHeader className="pb-3">
        <div className="flex items-center justify-between">
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5 text-blue-600" />
            Security Risk Score
          </CardTitle>
          <Badge className={`${gradeBackgrounds[current.grade]} border`}>
            Grade {current.grade}
          </Badge>
        </div>
      </CardHeader>
      <CardContent>
        {/* Main Score Display */}
        <div className="flex items-center gap-6 mb-6">
          {/* Score Circle */}
          <div
            className="relative h-24 w-24 rounded-full flex items-center justify-center border-4"
            style={{ borderColor: gradeColors[current.grade] }}
          >
            <div className="text-center">
              <span
                className="text-3xl font-bold"
                style={{ color: gradeColors[current.grade] }}
              >
                {current.score}
              </span>
              <span className="text-sm text-muted-foreground block">/100</span>
            </div>
          </div>

          {/* Score Info */}
          <div className="flex-1">
            <p className="text-sm text-muted-foreground mb-1">
              {gradeDescriptions[current.grade]}
            </p>
            <div className={`flex items-center gap-1 ${getTrendColor()}`}>
              {getTrendIcon()}
              <span className="text-sm font-medium">
                {trend === 'improving' && 'Improving'}
                {trend === 'stable' && 'Stable'}
                {trend === 'declining' && 'Declining'}
              </span>
              {trendPercentage !== 0 && (
                <span className="text-sm">
                  ({trendPercentage > 0 ? '+' : ''}{trendPercentage}%)
                </span>
              )}
            </div>
            {current.frameworksAtRisk && current.frameworksAtRisk.length > 0 && (
              <div className="mt-2">
                <span className="text-xs text-orange-600 font-medium">
                  At Risk: {current.frameworksAtRisk.join(', ')}
                </span>
              </div>
            )}
          </div>
        </div>

        {/* Factor Breakdown */}
        <div className="space-y-3">
          <p className="text-sm font-semibold text-gray-700">Risk Factors</p>
          {factors.map((factor) => (
            <div key={factor.key} className="space-y-1">
              <div className="flex items-center justify-between text-sm">
                <div className="flex items-center gap-2 text-muted-foreground">
                  <factor.icon className="h-3.5 w-3.5" />
                  <span>{factor.label}</span>
                </div>
                <span className="font-medium">{factor.value}</span>
              </div>
              <Progress
                value={factor.value}
                className="h-1.5"
                indicatorClassName={getFactorColor(factor.value)}
              />
            </div>
          ))}
        </div>

        {/* Action Link */}
        <div className="mt-4 pt-4 border-t">
          <Link
            href="/compliance"
            className="text-sm text-blue-600 hover:text-blue-700 font-medium hover:underline"
          >
            View Compliance Details &rarr;
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}
