'use client';

/**
 * AI Insight Card Component
 * Displays AI-powered cost analysis insights with visual indicators
 */

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Lightbulb, TrendingUp, DollarSign, AlertCircle, Sparkles, Clock } from 'lucide-react';

interface AIInsightCardProps {
  rootCause: string;
  recommendation: string;
  estimatedSavings: number | null;
  confidence: 'high' | 'medium' | 'low';
  isLoading?: boolean;
  cached?: boolean;
  cacheAge?: number;
  onViewDetails?: () => void;
}

export function AIInsightCard({
  rootCause,
  recommendation,
  estimatedSavings,
  confidence,
  isLoading = false,
  cached = false,
  cacheAge = 0,
  onViewDetails
}: AIInsightCardProps) {
  if (isLoading) {
    return (
      <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50">
        <CardContent className="py-6">
          <div className="flex items-center gap-3">
            <div className="animate-spin">
              <Sparkles className="w-5 h-5 text-blue-600" />
            </div>
            <div className="space-y-1">
              <p className="text-sm font-medium text-gray-900">Analyzing with AI...</p>
              <p className="text-xs text-gray-600">Using Claude to analyze your cost patterns</p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  const confidenceColors = {
    high: 'bg-green-100 text-green-700 border-green-200',
    medium: 'bg-blue-100 text-blue-700 border-blue-200',
    low: 'bg-gray-100 text-gray-700 border-gray-200'
  };

  const confidenceLabels = {
    high: 'High confidence',
    medium: 'Medium confidence',
    low: 'Low confidence'
  };

  return (
    <Card className="border-blue-200 bg-gradient-to-br from-blue-50 to-purple-50 shadow-md hover:shadow-lg transition-shadow">
      <CardHeader className="pb-3">
        <div className="flex items-start justify-between">
          <div className="flex items-center gap-2">
            <div className="h-10 w-10 rounded-lg bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center shadow-md">
              <Sparkles className="w-5 h-5 text-white" />
            </div>
            <div>
              <CardTitle className="text-lg flex items-center gap-2">
                AI Cost Analysis
                {cached && (
                  <Badge variant="outline" className="bg-white/50 text-xs font-normal">
                    <Clock className="w-3 h-3 mr-1" />
                    Cached {Math.floor(cacheAge / 60)}m ago
                  </Badge>
                )}
              </CardTitle>
              <p className="text-xs text-gray-600 mt-0.5">Powered by Claude Sonnet 4</p>
            </div>
          </div>
          <Badge variant="outline" className={confidenceColors[confidence]}>
            {confidenceLabels[confidence]}
          </Badge>
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Root Cause */}
        <div className="space-y-2 bg-white/60 backdrop-blur-sm rounded-lg p-4 border border-blue-100">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-blue-100 flex items-center justify-center">
              <AlertCircle className="w-4 h-4 text-blue-600" />
            </div>
            <h4 className="font-semibold text-sm text-gray-900">Root Cause</h4>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed pl-8">{rootCause}</p>
        </div>

        {/* Recommendation */}
        <div className="space-y-2 bg-white/60 backdrop-blur-sm rounded-lg p-4 border border-purple-100">
          <div className="flex items-center gap-2">
            <div className="h-6 w-6 rounded-md bg-purple-100 flex items-center justify-center">
              <TrendingUp className="w-4 h-4 text-purple-600" />
            </div>
            <h4 className="font-semibold text-sm text-gray-900">Recommendation</h4>
          </div>
          <p className="text-sm text-gray-700 leading-relaxed pl-8">{recommendation}</p>
        </div>

        {/* Estimated Savings */}
        {estimatedSavings && estimatedSavings > 0 && (
          <div className="space-y-2 bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-4 border border-green-200">
            <div className="flex items-center gap-2">
              <div className="h-6 w-6 rounded-md bg-green-100 flex items-center justify-center">
                <DollarSign className="w-4 h-4 text-green-600" />
              </div>
              <h4 className="font-semibold text-sm text-gray-900">Potential Savings</h4>
            </div>
            <div className="pl-8">
              <p className="text-2xl font-bold text-green-600">
                ${estimatedSavings.toLocaleString()}<span className="text-sm font-normal text-green-600">/month</span>
              </p>
              <p className="text-xs text-gray-600 mt-1">
                ${(estimatedSavings * 12).toLocaleString()}/year if implemented
              </p>
            </div>
          </div>
        )}

        {/* Action Button */}
        {onViewDetails && (
          <div className="pt-2">
            <Button
              variant="outline"
              size="sm"
              className="w-full border-blue-200 hover:bg-blue-50 hover:border-blue-300"
              onClick={onViewDetails}
            >
              <Lightbulb className="w-4 h-4 mr-2" />
              View Detailed Analysis
            </Button>
          </div>
        )}

        {/* Footer Info */}
        <div className="pt-2 border-t border-blue-100">
          <p className="text-xs text-gray-500 text-center">
            AI-powered insights are suggestions only. Always verify before implementing changes.
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
