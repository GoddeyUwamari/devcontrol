/**
 * MonitoringEmptyState Component
 * Professional empty state for first-time monitoring users
 */

'use client';

import { Activity, Zap, BarChart3, Clock, Shield, TrendingUp } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';

interface MonitoringEmptyStateProps {
  onSetup: () => void;
}

export function MonitoringEmptyState({ onSetup }: MonitoringEmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center min-h-[600px] p-4 sm:p-8">
      <div className="max-w-4xl w-full space-y-8">
        {/* Icon */}
        <div className="flex justify-center">
          <div className="w-20 h-20 bg-gradient-to-br from-blue-100 to-purple-100 dark:from-blue-900/30 dark:to-purple-900/30 rounded-2xl flex items-center justify-center shadow-lg">
            <Activity className="w-10 h-10 text-blue-600 dark:text-blue-400" />
          </div>
        </div>

        {/* Heading */}
        <div className="text-center space-y-3">
          <h2 className="text-3xl sm:text-4xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
            Enterprise-Grade System Monitoring
          </h2>
          <p className="text-lg text-muted-foreground max-w-2xl mx-auto">
            Monitor your infrastructure in real-time with comprehensive metrics, SLO tracking, and intelligent alerting
          </p>
        </div>

        {/* Value Props Grid */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <Card className="p-6 space-y-3 hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
            <div className="w-12 h-12 bg-green-100 dark:bg-green-900/30 rounded-lg flex items-center justify-center">
              <Zap className="w-6 h-6 text-green-600 dark:text-green-400" />
            </div>
            <h3 className="font-semibold text-lg">Real-Time Metrics</h3>
            <p className="text-sm text-muted-foreground">
              Track uptime, response time, and errors with 30-second refresh intervals
            </p>
          </Card>

          <Card className="p-6 space-y-3 hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
            <div className="w-12 h-12 bg-purple-100 dark:bg-purple-900/30 rounded-lg flex items-center justify-center">
              <BarChart3 className="w-6 h-6 text-purple-600 dark:text-purple-400" />
            </div>
            <h3 className="font-semibold text-lg">SLO Tracking</h3>
            <p className="text-sm text-muted-foreground">
              Define and monitor service level objectives with error budget alerts
            </p>
          </Card>

          <Card className="p-6 space-y-3 hover:shadow-xl hover:-translate-y-1 transition-all duration-200">
            <div className="w-12 h-12 bg-orange-100 dark:bg-orange-900/30 rounded-lg flex items-center justify-center">
              <Clock className="w-6 h-6 text-orange-600 dark:text-orange-400" />
            </div>
            <h3 className="font-semibold text-lg">Historical Analysis</h3>
            <p className="text-sm text-muted-foreground">
              30-day metric history with trend analysis and anomaly detection
            </p>
          </Card>
        </div>

        {/* CTA */}
        <div className="flex flex-col items-center gap-4">
          <Button
            size="lg"
            className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white shadow-lg px-8"
            onClick={onSetup}
            aria-label="Setup monitoring in 5 minutes"
          >
            <Activity className="w-5 h-5 mr-2" aria-hidden="true" />
            Setup Monitoring
          </Button>
          <p className="text-sm text-muted-foreground">
            ⏱️ <strong className="text-foreground">5 minutes</strong> to full visibility • 🔒 Secure connection • ✅ No credit card required
          </p>
        </div>

        {/* Setup Steps */}
        <div className="bg-gradient-to-br from-gray-50 to-blue-50 dark:from-gray-900 dark:to-blue-950/20 rounded-lg border p-6 sm:p-8">
          <h3 className="text-xl font-bold text-center mb-6">
            Quick Setup Process
          </h3>

          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-6">
            {[
              { step: '1', title: 'Connect', desc: 'Link Prometheus endpoint', icon: '🔗' },
              { step: '2', title: 'Configure', desc: 'Set SLO targets', icon: '⚙️' },
              { step: '3', title: 'Monitor', desc: 'Real-time dashboards', icon: '📊' },
              { step: '4', title: 'Alert', desc: 'Get notified instantly', icon: '🔔' },
            ].map((item, idx) => (
              <div key={idx} className="text-center">
                <div className="w-12 h-12 bg-gradient-to-br from-blue-600 to-purple-600 text-white rounded-full flex items-center justify-center mx-auto mb-3 text-lg font-bold shadow-lg">
                  {item.step}
                </div>
                <div className="text-2xl mb-2">{item.icon}</div>
                <h4 className="font-semibold mb-1">
                  {item.title}
                </h4>
                <p className="text-sm text-muted-foreground">
                  {item.desc}
                </p>
              </div>
            ))}
          </div>
        </div>

        {/* Features */}
        <div className="bg-blue-50 dark:bg-blue-950/20 rounded-lg border border-blue-200 dark:border-blue-800 p-6">
          <h3 className="text-lg font-semibold text-center mb-4">
            What You Get
          </h3>
          <div className="flex flex-wrap items-center justify-center gap-6 text-sm text-muted-foreground">
            <div className="flex items-center gap-2">
              <Shield className="w-4 h-4 text-green-600 dark:text-green-400" />
              <span>99.9% uptime SLA</span>
            </div>
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Real-time updates</span>
            </div>
            <div className="flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-purple-600 dark:text-purple-400" />
              <span>Advanced analytics</span>
            </div>
            <div className="flex items-center gap-2">
              <BarChart3 className="w-4 h-4 text-orange-600 dark:text-orange-400" />
              <span>Custom dashboards</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
