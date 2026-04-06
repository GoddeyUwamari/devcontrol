'use client';

import { TrendingUp, Users, Layers, ArrowRight, Lock } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { useRouter } from 'next/navigation';

interface CostAttributionTeaserProps {
  currentPlan: 'free' | 'starter' | 'pro' | 'enterprise';
  onUpgrade?: () => void;
}

export function CostAttributionTeaser({ currentPlan, onUpgrade }: CostAttributionTeaserProps) {
  const router = useRouter();
  const hasAccess = currentPlan === 'pro' || currentPlan === 'enterprise';

  // If user has access, don't show teaser (show actual component)
  if (hasAccess) return null;

  const handleUpgrade = () => {
    if (onUpgrade) {
      onUpgrade();
    } else {
      router.push('/pricing');
    }
  };

  return (
    <Card className="relative overflow-hidden border-2 border-dashed border-gray-300 dark:border-gray-700">
      {/* Blurred Preview Background */}
      <div className="absolute inset-0 bg-gradient-to-br from-blue-50 to-purple-50 dark:from-blue-950/20 dark:to-purple-950/20 opacity-50" />

      <div className="relative p-8">
        {/* Header */}
        <div className="flex items-start justify-between mb-6">
          <div>
            <div className="flex items-center gap-2 mb-2">
              <TrendingUp className="w-5 h-5 text-blue-600 dark:text-blue-400" />
              <h3 className="text-xl font-semibold text-gray-900 dark:text-white">
                Cost Attribution
              </h3>
              <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 text-xs font-medium rounded-full">
                Pro Feature
              </span>
            </div>
            <p className="text-sm text-gray-600 dark:text-gray-400">
              Track AWS costs by team, service, and environment
            </p>
          </div>

          <Lock className="w-5 h-5 text-gray-400" />
        </div>

        {/* Preview Features */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-6">
          <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <Users className="w-8 h-8 text-blue-600 dark:text-blue-400 mb-2" />
            <h4 className="font-semibold text-gray-900 dark:text-white mb-1">
              By Team
            </h4>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              See which teams drive AWS costs
            </p>
            <div className="mt-3 space-y-1">
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-3/4" />
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-1/2" />
            </div>
          </div>

          <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <Layers className="w-8 h-8 text-purple-600 dark:text-purple-400 mb-2" />
            <h4 className="font-semibold text-gray-900 dark:text-white mb-1">
              By Service
            </h4>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Identify expensive services
            </p>
            <div className="mt-3 space-y-1">
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-5/6" />
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-2/3" />
            </div>
          </div>

          <div className="bg-white/70 dark:bg-gray-800/70 backdrop-blur-sm rounded-lg p-4 border border-gray-200 dark:border-gray-700">
            <TrendingUp className="w-8 h-8 text-green-600 dark:text-green-400 mb-2" />
            <h4 className="font-semibold text-gray-900 dark:text-white mb-1">
              By Environment
            </h4>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Dev vs staging vs production
            </p>
            <div className="mt-3 space-y-1">
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-full" />
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-4/5" />
              <div className="h-2 bg-gray-200 dark:bg-gray-700 rounded w-3/5" />
            </div>
          </div>
        </div>

        {/* Benefits */}
        <div className="mb-6">
          <h4 className="text-sm font-semibold text-gray-900 dark:text-white mb-3">
            What you'll unlock:
          </h4>
          <ul className="space-y-2 text-sm text-gray-700 dark:text-gray-300">
            <li className="flex items-center gap-2">
              <span className="text-green-600">✓</span>
              <span>Automatically tag costs by team and project</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-600">✓</span>
              <span>Track environment-specific spending (dev/staging/prod)</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-600">✓</span>
              <span>Identify cost optimization opportunities by service</span>
            </li>
            <li className="flex items-center gap-2">
              <span className="text-green-600">✓</span>
              <span>Export attribution reports for finance teams</span>
            </li>
          </ul>
        </div>

        {/* CTA */}
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm font-medium text-gray-900 dark:text-white">
              Available on Pro plan
            </p>
            <p className="text-xs text-gray-600 dark:text-gray-400">
              Starting at $199/month
            </p>
          </div>

          <Button
            onClick={handleUpgrade}
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          >
            Upgrade to Pro
            <ArrowRight className="w-4 h-4 ml-2" />
          </Button>
        </div>
      </div>
    </Card>
  );
}
