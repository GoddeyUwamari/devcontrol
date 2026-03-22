/**
 * Cost Optimization Wins
 * Shows money saved with specific, believable examples
 *
 * Answers: "Where did you find the savings?"
 */

'use client';

import { DollarSign, TrendingDown } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { SALES_DEMO_DATA } from '@/lib/demo/sales-demo-data';

interface CostOptimizationWinsProps {
  demoMode?: boolean;
  realData?: {
    costSavings: Array<{
      title: string;
      monthlySavings: number;
      description: string;
      icon?: string;
    }>;
    twelveMonthReduction: number;
  };
}

export function CostOptimizationWins({ demoMode = false, realData }: CostOptimizationWinsProps) {
  const data = demoMode ? SALES_DEMO_DATA : realData;

  if (!data) return null;

  const totalSavings = data.costSavings.reduce((sum, item) => sum + item.monthlySavings, 0);

  return (
    <Card className="border-2 border-green-200 hover:shadow-lg transition-all">
      <CardHeader>
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="h-10 w-10 rounded-full bg-green-500/20 flex items-center justify-center">
              <DollarSign className="h-5 w-5 text-green-700" />
            </div>
            <div>
              <CardTitle className="text-xl">Cost Optimization</CardTitle>
              <p className="text-sm text-muted-foreground mt-1">
                ${totalSavings.toLocaleString()} saved this month
              </p>
            </div>
          </div>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        {/* Top Savings */}
        <div>
          <p className="text-sm font-semibold text-muted-foreground mb-3 uppercase tracking-wide">
            Top Savings This Month
          </p>
          <div className="space-y-3">
            {data.costSavings.map((saving, index) => (
              <div
                key={index}
                className="flex items-start gap-3 p-3 rounded-lg bg-green-50 border border-green-200 hover:bg-green-100 transition-colors"
              >
                <span className="text-2xl">{saving.icon}</span>
                <div className="flex-1 min-w-0">
                  <div className="flex items-start justify-between gap-2 mb-1">
                    <p className="font-semibold text-sm text-gray-900">{saving.title}</p>
                    <span className="text-lg font-bold text-green-700 whitespace-nowrap">
                      -${saving.monthlySavings.toLocaleString()}/mo
                    </span>
                  </div>
                  <p className="text-xs text-gray-600 italic">"{saving.description}"</p>
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* 12-Month Trend */}
        <div className="pt-4 border-t">
          <div className="flex items-center justify-between p-3 rounded-lg bg-gradient-to-r from-green-50 to-emerald-50">
            <div className="flex items-center gap-2">
              <TrendingDown className="h-5 w-5 text-green-600" />
              <span className="font-semibold text-gray-900">12-Month Trend</span>
            </div>
            <div className="text-right">
              <p className="text-2xl font-bold text-green-700">
                ↓ {data.twelveMonthReduction}%
              </p>
              <p className="text-xs text-gray-600">AWS spend reduction</p>
            </div>
          </div>
        </div>

        {/* Social Proof */}
        <div className="pt-2">
          <div className="bg-amber-50 rounded-lg p-4 flex items-start gap-3 border border-amber-200">
            <span className="text-2xl">💡</span>
            <div className="text-sm text-amber-900">
              <p className="font-semibold mb-1">
                DevControl finds $10-50k/year in waste for most customers
              </p>
              <p className="text-amber-700">
                That's 20-100x ROI on your subscription cost.
              </p>
            </div>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
