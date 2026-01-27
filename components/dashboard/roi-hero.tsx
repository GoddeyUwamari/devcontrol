/**
 * ROI Hero Section
 * The most important component - answers "Why pay $499/mo?" in first 30 seconds
 *
 * Shows:
 * - Monthly cost savings
 * - Time saved (hours → FTE)
 * - Security incidents prevented
 * - 26x ROI calculation
 */

'use client';

import { TrendingUp, Clock, Shield, DollarSign } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { SALES_DEMO_DATA } from '@/lib/demo/sales-demo-data';

interface ROIHeroProps {
  demoMode?: boolean;
  realData?: {
    monthlySavings: number;
    monthlySavingsChange: number;
    hoursSaved: number;
    hoursSavedChange: number;
    securityIncidents: number;
    daysSafe: number;
  };
}

export function ROIHero({ demoMode = false, realData }: ROIHeroProps) {
  // Use demo data or real data
  const data = demoMode ? SALES_DEMO_DATA : realData;

  if (!data) return null;

  const roiMultiplier = demoMode
    ? SALES_DEMO_DATA.roiMultiplier
    : Math.round((data.monthlySavings * 12) / 5988);
  const annualSavings = data.monthlySavings * 12;
  const annualCost = 5988; // $499/mo * 12

  return (
    <div className="space-y-4">
      {/* Giant ROI Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Cost Savings */}
        <Card className="border-2 border-green-200 bg-green-50/50 hover:shadow-lg transition-all">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-green-700 mb-1">
                  💰 YOUR SAVINGS
                </p>
                <div className="space-y-1">
                  <p className="text-5xl font-bold text-green-900">
                    ${data.monthlySavings.toLocaleString()}
                    <span className="text-2xl text-green-700">/mo</span>
                  </p>
                  <p className="text-sm text-green-600">AWS costs saved</p>
                </div>
              </div>
              <div className="h-12 w-12 rounded-full bg-green-500/20 flex items-center justify-center">
                <DollarSign className="h-6 w-6 text-green-700" />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-3 border-t border-green-200">
              <TrendingUp className="h-4 w-4 text-green-600" />
              <span className="text-sm text-green-700 font-medium">
                +${data.monthlySavingsChange.toLocaleString()} vs last month
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Time Saved */}
        <Card className="border-2 border-blue-200 bg-blue-50/50 hover:shadow-lg transition-all">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-blue-700 mb-1">
                  ⏱️ TEAM TIME SAVED
                </p>
                <div className="space-y-1">
                  <p className="text-5xl font-bold text-blue-900">
                    {data.hoursSaved}
                    <span className="text-2xl text-blue-700">h/mo</span>
                  </p>
                  <p className="text-sm text-blue-600">
                    = {demoMode ? SALES_DEMO_DATA.fteEquivalent : Math.round(data.hoursSaved / 160)} full-time engineers
                  </p>
                </div>
              </div>
              <div className="h-12 w-12 rounded-full bg-blue-500/20 flex items-center justify-center">
                <Clock className="h-6 w-6 text-blue-700" />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-3 border-t border-blue-200">
              <TrendingUp className="h-4 w-4 text-blue-600" />
              <span className="text-sm text-blue-700 font-medium">
                +{data.hoursSavedChange}h vs last month
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Security */}
        <Card className="border-2 border-emerald-200 bg-emerald-50/50 hover:shadow-lg transition-all">
          <CardContent className="pt-6">
            <div className="flex items-start justify-between mb-3">
              <div>
                <p className="text-sm font-medium text-emerald-700 mb-1">
                  🛡️ SECURITY INCIDENTS
                </p>
                <div className="space-y-1">
                  <p className="text-5xl font-bold text-emerald-900">
                    {data.securityIncidents}
                  </p>
                  <p className="text-sm text-emerald-600">
                    {data.daysSafe} days incident-free
                  </p>
                </div>
              </div>
              <div className="h-12 w-12 rounded-full bg-emerald-500/20 flex items-center justify-center">
                <Shield className="h-6 w-6 text-emerald-700" />
              </div>
            </div>
            <div className="flex items-center gap-2 pt-3 border-t border-emerald-200">
              <span className="text-sm text-emerald-700 font-medium">
                ✅ SOC 2 audit-ready
              </span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ROI Calculation Callout */}
      <Card className="border-2 border-blue-500 bg-gradient-to-r from-blue-50 to-blue-100">
        <CardContent className="py-4">
          <div className="flex items-center justify-center gap-3 text-center">
            <span className="text-3xl">💡</span>
            <div>
              <p className="text-lg font-semibold text-blue-900">
                That's{' '}
                <span className="text-2xl font-bold text-blue-700">
                  ${annualSavings.toLocaleString()}/year
                </span>{' '}
                savings for{' '}
                <span className="text-lg font-medium">
                  ${annualCost.toLocaleString()}/year
                </span>{' '}
                cost
              </p>
              <p className="text-3xl font-bold text-blue-900 mt-1">
                {roiMultiplier}x ROI on your DevControl subscription
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
