/**
 * MonitoringProFeatures Component
 * Displays upgrade prompts for Pro monitoring features
 */

'use client';

import { Lock, TrendingUp, Zap, Bell, History, LineChart } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { useRouter } from 'next/navigation';

interface ProFeatureCardProps {
  title: string;
  description: string;
  icon: React.ElementType;
  tier: 'pro' | 'enterprise';
}

export function ProFeatureCard({ title, description, icon: Icon, tier }: ProFeatureCardProps) {
  const router = useRouter();

  return (
    <Card className="relative overflow-hidden hover:shadow-xl hover:-translate-y-1 transition-all duration-200 border-2 border-dashed border-primary/30">
      <CardHeader className="pb-4">
        <div className="flex items-start justify-between">
          <div className="w-12 h-12 bg-gradient-to-br from-purple-100 to-blue-100 dark:from-purple-900/30 dark:to-blue-900/30 rounded-lg flex items-center justify-center">
            <Icon className="w-6 h-6 text-purple-600 dark:text-purple-400" />
          </div>
          <Badge className="bg-gradient-to-r from-purple-600 to-blue-600 text-white border-0">
            {tier === 'pro' ? 'Pro' : 'Enterprise'}
          </Badge>
        </div>
      </CardHeader>

      <CardContent className="space-y-4">
        <div>
          <CardTitle className="text-lg mb-2">{title}</CardTitle>
          <p className="text-sm text-muted-foreground">{description}</p>
        </div>

        {/* Blurred preview */}
        <div className="relative">
          <div className="blur-sm select-none pointer-events-none bg-gradient-to-br from-gray-100 to-gray-200 dark:from-gray-800 dark:to-gray-900 rounded-lg p-4 h-32">
            <div className="space-y-2">
              <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-3/4 animate-pulse" />
              <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-1/2 animate-pulse" />
              <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-5/6 animate-pulse" />
              <div className="h-4 bg-gray-300 dark:bg-gray-700 rounded w-2/3 animate-pulse" />
            </div>
          </div>

          <div className="absolute inset-0 flex items-center justify-center">
            <Button
              className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white shadow-lg"
              onClick={() => router.push('/pricing')}
              aria-label={`Upgrade to ${tier === 'pro' ? 'Pro' : 'Enterprise'} plan to unlock ${title}`}
            >
              <Lock className="w-4 h-4 mr-2" aria-hidden="true" />
              Upgrade to {tier === 'pro' ? 'Pro' : 'Enterprise'}
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

/**
 * Grid of Pro monitoring features
 */
export function MonitoringProFeaturesGrid() {
  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
      <ProFeatureCard
        title="30-Day Historical Data"
        description="Analyze trends and identify patterns with full metric history. Free tier limited to 1 hour of data."
        icon={History}
        tier="pro"
      />
      <ProFeatureCard
        title="Real-Time Monitoring"
        description="30-second refresh rate for critical metrics. Free tier updates every 5 minutes."
        icon={Zap}
        tier="pro"
      />
      <ProFeatureCard
        title="Advanced Alerting"
        description="Custom alert rules with Slack, PagerDuty, and email notifications. Escalation policies included."
        icon={Bell}
        tier="pro"
      />
      <ProFeatureCard
        title="Anomaly Detection"
        description="ML-powered baseline detection with automatic alerting on unusual patterns and trends."
        icon={TrendingUp}
        tier="enterprise"
      />
      <ProFeatureCard
        title="Custom Dashboards"
        description="Build unlimited dashboards with drag-and-drop widgets. Save, share, and export to PDF."
        icon={LineChart}
        tier="pro"
      />
      <ProFeatureCard
        title="Multi-Region Monitoring"
        description="Monitor services across multiple AWS regions with unified dashboards and cross-region alerts."
        icon={Zap}
        tier="enterprise"
      />
    </div>
  );
}

/**
 * Inline upgrade prompt for specific features
 */
interface InlineUpgradePromptProps {
  feature: string;
  description: string;
  tier: 'pro' | 'enterprise';
}

export function InlineUpgradePrompt({ feature, description, tier }: InlineUpgradePromptProps) {
  const router = useRouter();

  return (
    <div
      className="flex items-center justify-between p-4 border-2 border-dashed rounded-lg bg-gradient-to-r from-purple-50 to-blue-50 dark:from-purple-950/20 dark:to-blue-950/20 border-purple-200 dark:border-purple-800"
      role="region"
      aria-label={`${feature} requires upgrade`}
    >
      <div className="flex items-center gap-3">
        <Lock className="h-5 w-5 text-purple-600 dark:text-purple-400" aria-hidden="true" />
        <div>
          <div className="font-medium text-sm">{feature}</div>
          <div className="text-xs text-muted-foreground">{description}</div>
        </div>
      </div>
      <Button
        size="sm"
        className="bg-gradient-to-r from-purple-600 to-blue-600 hover:from-purple-700 hover:to-blue-700 text-white"
        onClick={() => router.push('/pricing')}
        aria-label={`Upgrade to ${tier === 'pro' ? 'Pro' : 'Enterprise'} plan for ${feature}`}
      >
        Upgrade to {tier === 'pro' ? 'Pro' : 'Enterprise'}
      </Button>
    </div>
  );
}
