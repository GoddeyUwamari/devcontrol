'use client';

import { Shield, ShieldCheck, Zap } from 'lucide-react';

const badges = [
  {
    icon: ShieldCheck,
    text: 'SOC 2 Compliant',
    color: 'text-green-600 dark:text-green-400',
  },
  {
    icon: Shield,
    text: 'GDPR Ready',
    color: 'text-blue-600 dark:text-blue-400',
  },
  {
    icon: Zap,
    text: '99.9% Uptime SLA',
    color: 'text-purple-600 dark:text-purple-400',
  },
];

export function TrustBadges() {
  return (
    <div className="py-12 border-t border-b bg-muted/20">
      <div className="max-w-7xl mx-auto px-4">
        <div className="flex flex-col sm:flex-row justify-center items-center gap-8 sm:gap-12">
          {badges.map((badge, index) => {
            const Icon = badge.icon;
            return (
              <div key={index} className="flex items-center gap-3">
                <Icon className={`w-6 h-6 ${badge.color}`} />
                <span className="text-sm font-medium text-foreground">{badge.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
