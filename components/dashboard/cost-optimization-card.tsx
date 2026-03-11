'use client';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { Skeleton } from '@/components/ui/skeleton';
import {
  TrendingDown,
  CheckCircle2,
  AlertCircle,
  ChevronRight,
  Zap,
  HelpCircle,
} from 'lucide-react';

export interface CostSavingOpportunity {
  id: string;
  title: string;
  description: string;
  monthlySavings: number;
  confidence: 'high' | 'medium' | 'low';
  impact: 'high' | 'medium' | 'low';
  canAutoOptimize?: boolean;
  onReview?: () => void;
  onOptimize?: () => void;
}

interface CostOptimizationCardProps {
  opportunities?: CostSavingOpportunity[];
  isLoading?: boolean;
  currentSpend?: number;
  onViewAll?: () => void;
}

const confidenceConfig = {
  high: {
    label: 'High Confidence',
    color: 'text-green-700',
    bgColor: 'bg-green-100',
    borderColor: 'border-green-200',
  },
  medium: {
    label: 'Medium Confidence',
    color: 'text-orange-700',
    bgColor: 'bg-orange-100',
    borderColor: 'border-orange-200',
  },
  low: {
    label: 'Low Confidence',
    color: 'text-gray-700',
    bgColor: 'bg-gray-100',
    borderColor: 'border-gray-200',
  },
};

const impactConfig = {
  high: {
    icon: '🔥',
    label: 'High Impact',
  },
  medium: {
    icon: '📊',
    label: 'Medium Impact',
  },
  low: {
    icon: '📉',
    label: 'Low Impact',
  },
};

function OpportunityItem({
  opportunity,
}: {
  opportunity: CostSavingOpportunity;
}) {
  const confidence = confidenceConfig[opportunity.confidence];
  const impact = impactConfig[opportunity.impact];

  return (
    <div className="p-4 border rounded-lg hover:shadow-md transition-all">
      <div className="flex items-start gap-3">
        {/* Impact Icon */}
        <div className="text-2xl flex-shrink-0">{impact.icon}</div>

        {/* Content */}
        <div className="flex-1 min-w-0">
          <div className="flex items-start justify-between gap-2 mb-2">
            <h4 className="text-sm font-semibold text-gray-900">{opportunity.title}</h4>
            <div className="flex-shrink-0">
              <Badge
                variant="secondary"
                className={`${confidence.bgColor} ${confidence.color} border ${confidence.borderColor}`}
              >
                {confidence.label}
              </Badge>
            </div>
          </div>

          <p className="text-sm text-muted-foreground mb-3">
            {opportunity.description}
          </p>

          {/* Savings Amount */}
          <div className="flex items-center gap-2 mb-3">
            <TrendingDown className="h-4 w-4 text-green-600" />
            <span className="text-lg font-bold text-green-600">
              ${opportunity.monthlySavings}/mo
            </span>
            <span className="text-sm text-muted-foreground">potential savings</span>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {opportunity.canAutoOptimize && (
              <Button
                size="sm"
                onClick={opportunity.onOptimize}
                className="bg-[#7c3aed] hover:bg-[#4f46e5]"
              >
                <Zap className="h-4 w-4 mr-1" />
                One-click Optimize
              </Button>
            )}
            {opportunity.onReview && (
              <Button
                variant="outline"
                size="sm"
                onClick={opportunity.onReview}
              >
                Review Details
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function OpportunitySkeleton() {
  return (
    <div className="p-4 border rounded-lg">
      <div className="flex items-start gap-3">
        <Skeleton className="h-8 w-8 rounded-full flex-shrink-0" />
        <div className="flex-1 space-y-3">
          <Skeleton className="h-4 w-3/4" />
          <Skeleton className="h-3 w-full" />
          <Skeleton className="h-6 w-32" />
          <div className="flex gap-2">
            <Skeleton className="h-8 w-24" />
            <Skeleton className="h-8 w-28" />
          </div>
        </div>
      </div>
    </div>
  );
}

export function CostOptimizationCard({
  opportunities = [],
  isLoading,
  currentSpend = 1247,
  onViewAll,
}: CostOptimizationCardProps) {
  const totalPotentialSavings = opportunities.reduce(
    (sum, opp) => sum + opp.monthlySavings,
    0
  );

  const savingsPercentage = currentSpend > 0
    ? Math.round((totalPotentialSavings / currentSpend) * 100)
    : 0;

  // Sort by monthly savings (highest first)
  const sortedOpportunities = [...opportunities].sort(
    (a, b) => b.monthlySavings - a.monthlySavings
  );

  const topOpportunities = sortedOpportunities.slice(0, 3);

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between flex-wrap gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              Cost Savings Opportunities
              <button
                className="text-gray-400 hover:text-gray-600 transition-colors"
                title="AI-powered recommendations to reduce your AWS costs"
              >
                <HelpCircle className="h-4 w-4" />
              </button>
            </CardTitle>
            <CardDescription>
              Automated recommendations to optimize your infrastructure costs
            </CardDescription>
          </div>
          {onViewAll && opportunities.length > 3 && (
            <Button variant="outline" size="sm" onClick={onViewAll}>
              View all ({opportunities.length})
              <ChevronRight className="h-4 w-4 ml-1" />
            </Button>
          )}
        </div>
      </CardHeader>
      <CardContent>
        {isLoading ? (
          <div className="space-y-4">
            <OpportunitySkeleton />
            <OpportunitySkeleton />
            <OpportunitySkeleton />
          </div>
        ) : opportunities.length === 0 ? (
          <div className="text-center py-8">
            <CheckCircle2 className="h-12 w-12 mx-auto mb-3 text-green-500" />
            <p className="text-sm font-medium text-gray-900">All Optimized!</p>
            <p className="text-sm text-muted-foreground mt-1">
              No cost optimization opportunities found at this time.
            </p>
          </div>
        ) : (
          <>
            {/* Summary Card */}
            <div className="mb-6 p-4 bg-gradient-to-r from-green-50 to-teal-50 border border-green-200 rounded-lg">
              <div className="flex items-start gap-3">
                <div className="h-12 w-12 rounded-lg bg-green-100 flex items-center justify-center flex-shrink-0">
                  <TrendingDown className="h-6 w-6 text-green-600" />
                </div>
                <div className="flex-1">
                  <h3 className="text-lg font-bold text-gray-900 mb-1">
                    ${totalPotentialSavings.toLocaleString()}/mo
                  </h3>
                  <p className="text-sm text-gray-700 mb-3">
                    Total potential savings ({savingsPercentage}% of current spend)
                  </p>
                  <Progress value={savingsPercentage} className="h-2" />
                  <div className="flex items-center justify-between mt-2 text-xs text-gray-600">
                    <span>Current: ${currentSpend.toLocaleString()}/mo</span>
                    <span>Optimized: ${(currentSpend - totalPotentialSavings).toLocaleString()}/mo</span>
                  </div>
                </div>
              </div>
            </div>

            {/* Opportunities List */}
            <div className="space-y-4">
              {topOpportunities.map((opportunity) => (
                <OpportunityItem
                  key={opportunity.id}
                  opportunity={opportunity}
                />
              ))}
            </div>

            {/* Footer Note */}
            {opportunities.length > 3 && (
              <div className="mt-4 pt-4 border-t text-center">
                <p className="text-sm text-muted-foreground">
                  {opportunities.length - 3} more opportunities available
                </p>
              </div>
            )}
          </>
        )}
      </CardContent>
    </Card>
  );
}

// Demo data generator
export function generateDemoCostOpportunities(): CostSavingOpportunity[] {
  return [
    {
      id: '1',
      title: 'Underutilized EC2 Instances',
      description: '3 EC2 instances running at <20% CPU usage for the past 30 days',
      monthlySavings: 342,
      confidence: 'high',
      impact: 'high',
      canAutoOptimize: false,
      onReview: () => console.log('Review EC2 instances'),
    },
    {
      id: '2',
      title: 'RDS Reserved Instance Pricing',
      description: 'Switch 5 on-demand RDS instances to reserved pricing for 1-year commitment',
      monthlySavings: 890,
      confidence: 'high',
      impact: 'high',
      canAutoOptimize: false,
      onReview: () => console.log('Review RDS pricing'),
    },
    {
      id: '3',
      title: 'Unattached EBS Volumes',
      description: '12 EBS volumes not attached to any instance',
      monthlySavings: 89,
      confidence: 'high',
      impact: 'medium',
      canAutoOptimize: true,
      onOptimize: () => console.log('Auto-optimize EBS'),
      onReview: () => console.log('Review EBS volumes'),
    },
    {
      id: '4',
      title: 'Old EBS Snapshots',
      description: '47 snapshots older than 180 days that can be safely deleted',
      monthlySavings: 156,
      confidence: 'medium',
      impact: 'medium',
      canAutoOptimize: true,
      onOptimize: () => console.log('Auto-delete old snapshots'),
      onReview: () => console.log('Review snapshots'),
    },
    {
      id: '5',
      title: 'Idle RDS Instances',
      description: '2 RDS instances with no connections in the past 7 days',
      monthlySavings: 445,
      confidence: 'medium',
      impact: 'high',
      canAutoOptimize: false,
      onReview: () => console.log('Review idle RDS'),
    },
  ];
}
